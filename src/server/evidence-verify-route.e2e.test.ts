/**
 * End-to-end tests for `GET /workspace/jobs/:jobId/evidence/verify`
 * (Issue #1380). Brings up an in-process HTTP server with the
 * test-intelligence subsurface enabled, then drives the route via
 * `fetch` against a real POC run materialized by `runWave1Poc`.
 *
 * Covers all status codes named in the issue acceptance criteria
 * (200 ok, 200 fail, 404, 409, 401, 503, 405, 429, feature-disabled
 * 503), plus secret-redaction regression coverage of the response
 * body.
 */
import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { TEST_INTELLIGENCE_ENV } from "../contracts/index.js";
import { runWave1Poc } from "../test-intelligence/poc-harness.js";
import { createJobEngine, resolveRuntimeSettings } from "../job-engine.js";
import { createWorkspaceRequestHandler } from "./request-handler.js";

const moduleDir = fileURLToPath(new URL(".", import.meta.url));

const TEST_BEARER_TOKEN =
  "test-evidence-verify-bearer-token-do-not-use-in-prod";
const POC_FIXTURE_GENERATED_AT = "2026-04-25T10:00:00.000Z";

interface TestServerHandle {
  baseUrl: string;
  artifactsRoot: string;
  jobId: string;
  close: () => Promise<void>;
}

const startTestServer = async (
  overrides: {
    reviewBearerToken?: string | undefined;
    testIntelligenceEnabled?: boolean;
    envValue?: string | undefined;
    rateLimitPerMinute?: number;
  } = {},
): Promise<TestServerHandle> => {
  const previousEnv = process.env[TEST_INTELLIGENCE_ENV];
  if ("envValue" in overrides) {
    if (overrides.envValue === undefined) {
      delete process.env[TEST_INTELLIGENCE_ENV];
    } else {
      process.env[TEST_INTELLIGENCE_ENV] = overrides.envValue;
    }
  } else {
    process.env[TEST_INTELLIGENCE_ENV] = "1";
  }

  const tempRoot = await mkdtemp(join(tmpdir(), "evidence-verify-e2e-"));
  const artifactsRoot = join(tempRoot, "test-intelligence");
  await mkdir(artifactsRoot, { recursive: true });
  const jobId = "evidence-verify-job";
  const runDir = join(artifactsRoot, jobId);
  await mkdir(runDir, { recursive: true });
  await runWave1Poc({
    fixtureId: "poc-onboarding",
    jobId,
    generatedAt: POC_FIXTURE_GENERATED_AT,
    runDir,
  });

  const host = "127.0.0.1";
  const runtimeSettings = resolveRuntimeSettings({
    enablePreview: false,
    enableUiValidation: false,
    enableUnitTestValidation: false,
    installPreferOffline: true,
  });
  const jobEngine = createJobEngine({
    resolveBaseUrl: () => `http://${host}:0`,
    paths: {
      outputRoot: tempRoot,
      jobsRoot: join(tempRoot, "jobs"),
      reprosRoot: join(tempRoot, "repros"),
      workspaceRoot: tempRoot,
    },
    runtime: runtimeSettings,
  });

  let resolvedPort = 0;
  const handler = createWorkspaceRequestHandler({
    host,
    getResolvedPort: () => resolvedPort,
    startedAt: Date.now(),
    absoluteOutputRoot: tempRoot,
    workspaceRoot: tempRoot,
    defaults: { figmaSourceMode: "rest", llmCodegenMode: "deterministic" },
    runtime: {
      previewEnabled: false,
      ...(overrides.rateLimitPerMinute !== undefined
        ? { rateLimitPerMinute: overrides.rateLimitPerMinute }
        : {}),
      testIntelligenceEnabled:
        overrides.testIntelligenceEnabled !== undefined
          ? overrides.testIntelligenceEnabled
          : true,
      ...("reviewBearerToken" in overrides
        ? overrides.reviewBearerToken === undefined
          ? {}
          : { testIntelligenceReviewBearerToken: overrides.reviewBearerToken }
        : { testIntelligenceReviewBearerToken: TEST_BEARER_TOKEN }),
      testIntelligenceArtifactRoot: artifactsRoot,
    },
    jobEngine,
    moduleDir,
  });

  const server: Server = createServer((request, response) => {
    void handler(request, response).catch(() => {
      if (!response.writableEnded) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "INTERNAL_ERROR" }));
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, host, () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        resolvedPort = address.port;
      }
      resolve();
    });
  });

  const baseUrl = `http://${host}:${resolvedPort}`;

  const close = async (): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await rm(tempRoot, { recursive: true, force: true });
    if (previousEnv === undefined) {
      delete process.env[TEST_INTELLIGENCE_ENV];
    } else {
      process.env[TEST_INTELLIGENCE_ENV] = previousEnv;
    }
  };

  return { baseUrl, artifactsRoot, jobId, close };
};

const verifyUrl = (baseUrl: string, jobId: string): string =>
  `${baseUrl}/workspace/jobs/${encodeURIComponent(jobId)}/evidence/verify`;

const fetchVerify = async (
  baseUrl: string,
  jobId: string,
  options: {
    method?: string;
    bearer?: string | null;
    extraHeaders?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: unknown; headers: Headers }> => {
  const headers: Record<string, string> = {
    accept: "application/json",
    ...(options.extraHeaders ?? {}),
  };
  if (options.bearer !== null) {
    headers.authorization = `Bearer ${options.bearer ?? TEST_BEARER_TOKEN}`;
  }
  const response = await fetch(verifyUrl(baseUrl, jobId), {
    method: options.method ?? "GET",
    headers,
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return { status: response.status, body, headers: response.headers };
};

test("e2e #1380: GET evidence/verify returns 200 ok=true for an untouched POC run", async () => {
  const handle = await startTestServer();
  try {
    const result = await fetchVerify(handle.baseUrl, handle.jobId);
    assert.equal(result.status, 200);
    assert.ok(result.body && typeof result.body === "object");
    const body = result.body as Record<string, unknown>;
    assert.equal(body.ok, true);
    assert.equal(body.jobId, handle.jobId);
    assert.equal(body.schemaVersion, "1.0.0");
    assert.equal(Array.isArray(body.failures), true);
    assert.equal((body.failures as unknown[]).length, 0);
    assert.equal(Array.isArray(body.checks), true);
    assert.ok((body.checks as unknown[]).length > 0);
    const manifestSha = body.manifestSha256;
    assert.equal(typeof manifestSha, "string");
    assert.match(manifestSha as string, /^[0-9a-f]{64}$/);
  } finally {
    await handle.close();
  }
});

test("e2e #1380: GET evidence/verify returns 200 ok=false after artifact tampering", async () => {
  const handle = await startTestServer();
  try {
    const tamperPath = join(
      handle.artifactsRoot,
      handle.jobId,
      "generated-testcases.json",
    );
    await appendFile(tamperPath, "\n");
    const result = await fetchVerify(handle.baseUrl, handle.jobId);
    assert.equal(result.status, 200);
    const body = result.body as Record<string, unknown>;
    assert.equal(body.ok, false);
    const failures = body.failures as Array<Record<string, unknown>>;
    assert.ok(failures.length > 0);
    const codes = failures.map((f) => f.code);
    assert.ok(
      codes.includes("artifact_resized") || codes.includes("artifact_mutated"),
      `expected artifact_resized or artifact_mutated, saw: ${codes.join(",")}`,
    );
  } finally {
    await handle.close();
  }
});

test("e2e #1380: GET evidence/verify returns 404 for an unknown job", async () => {
  const handle = await startTestServer();
  try {
    const result = await fetchVerify(handle.baseUrl, "unknown-job-id-xyz");
    assert.equal(result.status, 404);
    const body = result.body as Record<string, unknown>;
    assert.equal(body.error, "JOB_NOT_FOUND");
    // Must not echo any path information.
    assert.equal(typeof body.message, "string");
    assert.ok(!(body.message as string).includes("/"));
  } finally {
    await handle.close();
  }
});

test("e2e #1380: GET evidence/verify returns 409 when job dir exists but no manifest", async () => {
  const handle = await startTestServer();
  try {
    const emptyJobId = "empty-job";
    await mkdir(join(handle.artifactsRoot, emptyJobId), { recursive: true });
    const result = await fetchVerify(handle.baseUrl, emptyJobId);
    assert.equal(result.status, 409);
    const body = result.body as Record<string, unknown>;
    assert.equal(body.error, "EVIDENCE_NOT_AVAILABLE");
  } finally {
    await handle.close();
  }
});

test("e2e #1380: GET evidence/verify returns 401 with a wrong Bearer token", async () => {
  const handle = await startTestServer();
  try {
    const result = await fetchVerify(handle.baseUrl, handle.jobId, {
      bearer: "totally-wrong-token",
    });
    assert.equal(result.status, 401);
    const body = result.body as Record<string, unknown>;
    assert.equal(body.error, "UNAUTHORIZED");
    assert.match(
      result.headers.get("www-authenticate") ?? "",
      /Bearer realm="workspace-dev"/,
    );
  } finally {
    await handle.close();
  }
});

test("e2e #1380: GET evidence/verify returns 503 when the bearer token is unconfigured", async () => {
  const handle = await startTestServer({ reviewBearerToken: "" });
  try {
    const result = await fetchVerify(handle.baseUrl, handle.jobId);
    assert.equal(result.status, 503);
    const body = result.body as Record<string, unknown>;
    assert.equal(body.error, "AUTHENTICATION_UNAVAILABLE");
  } finally {
    await handle.close();
  }
});

test("e2e #1380: GET evidence/verify returns 503 FEATURE_DISABLED when the test-intelligence env gate is off", async () => {
  const handle = await startTestServer({ envValue: undefined });
  try {
    const result = await fetchVerify(handle.baseUrl, handle.jobId);
    assert.equal(result.status, 503);
    const body = result.body as Record<string, unknown>;
    assert.equal(body.error, "FEATURE_DISABLED");
  } finally {
    await handle.close();
  }
});

test("e2e #1380: GET evidence/verify returns 503 FEATURE_DISABLED when testIntelligenceEnabled is false", async () => {
  const handle = await startTestServer({ testIntelligenceEnabled: false });
  try {
    const result = await fetchVerify(handle.baseUrl, handle.jobId);
    assert.equal(result.status, 503);
    const body = result.body as Record<string, unknown>;
    assert.equal(body.error, "FEATURE_DISABLED");
  } finally {
    await handle.close();
  }
});

test("e2e #1380: POST/PUT/DELETE evidence/verify returns 405 with Allow: GET", async () => {
  const handle = await startTestServer();
  try {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const result = await fetchVerify(handle.baseUrl, handle.jobId, {
        method,
      });
      assert.equal(result.status, 405, `method ${method} should be 405`);
      const body = result.body as Record<string, unknown>;
      assert.equal(body.error, "METHOD_NOT_ALLOWED");
      assert.equal(result.headers.get("allow"), "GET");
    }
  } finally {
    await handle.close();
  }
});

test("e2e #1380: GET evidence/verify enforces the per-IP rate limiter (429 after limit)", async () => {
  // Allow only 2 reads per window, then expect 429 on the 3rd attempt.
  const handle = await startTestServer({ rateLimitPerMinute: 2 });
  try {
    const first = await fetchVerify(handle.baseUrl, handle.jobId);
    assert.equal(first.status, 200);
    const second = await fetchVerify(handle.baseUrl, handle.jobId);
    assert.equal(second.status, 200);
    const third = await fetchVerify(handle.baseUrl, handle.jobId);
    assert.equal(third.status, 429);
    const body = third.body as Record<string, unknown>;
    assert.equal(body.error, "RATE_LIMIT_EXCEEDED");
    assert.ok(third.headers.get("retry-after"));
  } finally {
    await handle.close();
  }
});

test("e2e #1380: GET evidence/verify response body never leaks bearer tokens, absolute paths, or signer secrets", async () => {
  const handle = await startTestServer();
  try {
    const result = await fetchVerify(handle.baseUrl, handle.jobId);
    assert.equal(result.status, 200);
    const serialized = JSON.stringify(result.body);
    // Bearer tokens never round-trip into the response body.
    assert.equal(serialized.includes(TEST_BEARER_TOKEN), false);
    assert.equal(serialized.toLowerCase().includes("bearer "), false);
    // The response carries only artifact basenames + identity stamps;
    // no absolute filesystem path may leak.
    assert.equal(serialized.includes(handle.artifactsRoot), false);
    // Common sensitive substrings the manifest would contain on disk
    // but should never reach the verifier response surface.
    assert.equal(serialized.toLowerCase().includes("authorization"), false);
    assert.equal(serialized.toLowerCase().includes("private_key"), false);
    assert.equal(serialized.toLowerCase().includes("privatekeypem"), false);
  } finally {
    await handle.close();
  }
});

test("e2e #1380: GET evidence/verify on a malformed jobId returns 404 NOT_FOUND from the parser", async () => {
  const handle = await startTestServer();
  try {
    // The parser rejects path-traversal attempts; the dispatcher maps
    // parse errors to 404 NOT_FOUND so unknown-job vs unsafe-id are
    // indistinguishable to the caller (no path leakage).
    const url = `${handle.baseUrl}/workspace/jobs/$(whoami)/evidence/verify`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${TEST_BEARER_TOKEN}`,
      },
    });
    assert.equal(response.status, 404);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.error, "NOT_FOUND");
  } finally {
    await handle.close();
  }
});
