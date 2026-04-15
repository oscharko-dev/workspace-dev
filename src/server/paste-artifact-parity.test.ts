/**
 * HTTP-level artifact parity tests for figma_paste vs local_json (Issue #988, Wave 3).
 *
 * Submitting the same fixture via `local_json` (file path) and via `figma_paste`
 * (inline JSON payload) MUST produce identical generated artifacts. The paste
 * handler normalizes into `local_json` before queueing the job, so the only
 * expected differences between the two HTTP responses are non-deterministic
 * fields (job IDs, timestamps, tmp paths). After normalizing those away,
 * `design-ir`, `component-manifest`, and the `/files` listing should match.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createWorkspaceServer } from "../server.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(
  MODULE_DIR,
  "../parity/fixtures/golden/prototype-navigation/figma.json",
);

const PARITY_JOB_TIMEOUT_MS = 120_000;

interface WorkspaceServerInstance {
  app: {
    inject: (opts: {
      method: string;
      url: string;
      headers?: Record<string, string>;
      payload?: unknown;
    }) => Promise<{
      statusCode: number;
      json: <T = unknown>() => T;
      body: string;
    }>;
    close: () => Promise<void>;
  };
}

const createTempOutputRoot = async (): Promise<string> =>
  await mkdtemp(path.join(os.tmpdir(), "workspace-paste-parity-"));

const allocateRandomPort = (): number =>
  19830 + Math.floor(Math.random() * 1000);

const waitForJobTerminalState = async ({
  server,
  jobId,
  timeoutMs,
}: {
  server: WorkspaceServerInstance;
  jobId: string;
  timeoutMs: number;
}): Promise<Record<string, unknown>> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await server.app.inject({
      method: "GET",
      url: `/workspace/jobs/${jobId}`,
    });
    assert.equal(response.statusCode, 200);
    const body = response.json<Record<string, unknown>>();
    if (body.status === "completed") {
      return body;
    }
    if (
      body.status === "failed" ||
      body.status === "canceled" ||
      body.status === "partial"
    ) {
      throw new Error(
        `Job ${jobId} reached unexpected terminal status ${body.status}: ${JSON.stringify(body)}`,
      );
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 120);
    });
  }
  throw new Error(`Timed out waiting for terminal state of job ${jobId}`);
};

const submitLocalJsonJob = async ({
  server,
  fixturePath,
}: {
  server: WorkspaceServerInstance;
  fixturePath: string;
}): Promise<string> => {
  const response = await server.app.inject({
    method: "POST",
    url: "/workspace/submit",
    headers: { "content-type": "application/json" },
    payload: {
      figmaSourceMode: "local_json",
      figmaJsonPath: fixturePath,
      llmCodegenMode: "deterministic",
    },
  });
  assert.equal(
    response.statusCode,
    202,
    `local_json submit expected 202, got ${response.statusCode}: ${response.body}`,
  );
  const body = response.json<Record<string, unknown>>();
  const jobId = body.jobId;
  assert.equal(typeof jobId, "string");
  return String(jobId);
};

const submitPasteJob = async ({
  server,
  payload,
}: {
  server: WorkspaceServerInstance;
  payload: string;
}): Promise<string> => {
  const response = await server.app.inject({
    method: "POST",
    url: "/workspace/submit",
    headers: { "content-type": "application/json" },
    payload: {
      figmaSourceMode: "figma_paste",
      figmaJsonPayload: payload,
      llmCodegenMode: "deterministic",
    },
  });
  assert.equal(
    response.statusCode,
    202,
    `figma_paste submit expected 202, got ${response.statusCode}: ${response.body}`,
  );
  const body = response.json<Record<string, unknown>>();
  const jobId = body.jobId;
  assert.equal(typeof jobId, "string");
  return String(jobId);
};

/**
 * Strip non-deterministic fields so two responses from different jobs can be
 * compared for semantic equality. The only expected divergence between
 * local_json and figma_paste is the job ID.
 */
const normalizeForComparison = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForComparison(entry));
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const normalized: Record<string, unknown> = {};
    for (const [key, raw] of entries) {
      if (key === "jobId") continue;
      normalized[key] = normalizeForComparison(raw);
    }
    return normalized;
  }
  return value;
};

const fetchDesignIr = async ({
  server,
  jobId,
}: {
  server: WorkspaceServerInstance;
  jobId: string;
}): Promise<Record<string, unknown>> => {
  const response = await server.app.inject({
    method: "GET",
    url: `/workspace/jobs/${jobId}/design-ir`,
  });
  assert.equal(
    response.statusCode,
    200,
    `design-ir expected 200, got ${response.statusCode}: ${response.body}`,
  );
  return response.json<Record<string, unknown>>();
};

const fetchComponentManifest = async ({
  server,
  jobId,
}: {
  server: WorkspaceServerInstance;
  jobId: string;
}): Promise<Record<string, unknown>> => {
  const response = await server.app.inject({
    method: "GET",
    url: `/workspace/jobs/${jobId}/component-manifest`,
  });
  assert.equal(
    response.statusCode,
    200,
    `component-manifest expected 200, got ${response.statusCode}: ${response.body}`,
  );
  return response.json<Record<string, unknown>>();
};

interface FileEntry {
  path: string;
  sizeBytes: number;
}

const fetchFilesListing = async ({
  server,
  jobId,
}: {
  server: WorkspaceServerInstance;
  jobId: string;
}): Promise<FileEntry[]> => {
  const response = await server.app.inject({
    method: "GET",
    url: `/workspace/jobs/${jobId}/files`,
  });
  assert.equal(
    response.statusCode,
    200,
    `files expected 200, got ${response.statusCode}: ${response.body}`,
  );
  const body = response.json<{ files: FileEntry[] }>();
  return body.files;
};

const fetchGeneratedFileContent = async ({
  server,
  jobId,
  filePath,
}: {
  server: WorkspaceServerInstance;
  jobId: string;
  filePath: string;
}): Promise<string> => {
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const response = await server.app.inject({
    method: "GET",
    url: `/workspace/jobs/${jobId}/files/${encodedPath}`,
  });
  assert.equal(
    response.statusCode,
    200,
    `file ${filePath} expected 200, got ${response.statusCode}: ${response.body}`,
  );
  return response.body;
};

const runParityJobs = async (): Promise<{
  outputRoot: string;
  server: WorkspaceServerInstance;
  localJobId: string;
  pasteJobId: string;
}> => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateRandomPort();
  // local_json mode never performs a network fetch; reject to prove it.
  const server = (await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: async () => {
      throw new Error("Unexpected network fetch in parity test.");
    },
  })) as WorkspaceServerInstance;

  // Write fixture to a stable path inside outputRoot so the job can reference it.
  const localFixturePath = path.join(outputRoot, "parity-local-fixture.json");
  const fixtureContent = readFileSync(FIXTURE_PATH, "utf8");
  await writeFile(localFixturePath, fixtureContent, "utf8");

  const localJobId = await submitLocalJsonJob({
    server,
    fixturePath: localFixturePath,
  });
  const pasteJobId = await submitPasteJob({ server, payload: fixtureContent });

  await waitForJobTerminalState({
    server,
    jobId: localJobId,
    timeoutMs: PARITY_JOB_TIMEOUT_MS,
  });
  await waitForJobTerminalState({
    server,
    jobId: pasteJobId,
    timeoutMs: PARITY_JOB_TIMEOUT_MS,
  });

  return { outputRoot, server, localJobId, pasteJobId };
};

test("waitForJobTerminalState fails fast on partial terminal jobs", async () => {
  const server: WorkspaceServerInstance = {
    app: {
      inject: async () => ({
        statusCode: 200,
        json: () =>
          ({
            jobId: "job-partial",
            status: "partial",
            outcome: "partial",
          }) as Record<string, unknown>,
        body: '{"jobId":"job-partial","status":"partial","outcome":"partial"}',
      }),
      close: async () => {},
    },
  };

  await assert.rejects(
    waitForJobTerminalState({
      server,
      jobId: "job-partial",
      timeoutMs: 1_000,
    }),
    /unexpected terminal status partial/,
  );
});

test(
  "figma_paste produces a design-ir equivalent to local_json for prototype-navigation",
  { timeout: PARITY_JOB_TIMEOUT_MS + 30_000 },
  async () => {
    const { outputRoot, server, localJobId, pasteJobId } =
      await runParityJobs();
    try {
      const localIr = await fetchDesignIr({ server, jobId: localJobId });
      const pasteIr = await fetchDesignIr({ server, jobId: pasteJobId });

      // Sanity: both jobs produced a non-empty screens list for this fixture.
      assert.ok(Array.isArray(localIr.screens));
      assert.ok(
        (localIr.screens as unknown[]).length >= 2,
        "fixture expected >= 2 screens in design-ir",
      );
      assert.equal(
        (localIr.screens as unknown[]).length,
        (pasteIr.screens as unknown[]).length,
        "paste and local screen counts must match",
      );

      assert.deepEqual(
        normalizeForComparison(localIr),
        normalizeForComparison(pasteIr),
        "design-ir payloads diverged between local_json and figma_paste modes",
      );
    } finally {
      await server.app.close();
      await rm(outputRoot, { recursive: true, force: true });
    }
  },
);

test(
  "figma_paste produces a component-manifest equivalent to local_json for prototype-navigation",
  { timeout: PARITY_JOB_TIMEOUT_MS + 30_000 },
  async () => {
    const { outputRoot, server, localJobId, pasteJobId } =
      await runParityJobs();
    try {
      const localManifest = await fetchComponentManifest({
        server,
        jobId: localJobId,
      });
      const pasteManifest = await fetchComponentManifest({
        server,
        jobId: pasteJobId,
      });

      // Sanity: manifest has the screens array present.
      assert.ok(Array.isArray(localManifest.screens));
      assert.equal(
        (localManifest.screens as unknown[]).length,
        (pasteManifest.screens as unknown[]).length,
        "component manifest screen counts must match",
      );

      assert.deepEqual(
        normalizeForComparison(localManifest),
        normalizeForComparison(pasteManifest),
        "component-manifest payloads diverged between local_json and figma_paste modes",
      );
    } finally {
      await server.app.close();
      await rm(outputRoot, { recursive: true, force: true });
    }
  },
);

test(
  "figma_paste produces identical generated files as local_json for prototype-navigation",
  { timeout: PARITY_JOB_TIMEOUT_MS + 30_000 },
  async () => {
    const { outputRoot, server, localJobId, pasteJobId } =
      await runParityJobs();
    try {
      const localFiles = await fetchFilesListing({ server, jobId: localJobId });
      const pasteFiles = await fetchFilesListing({ server, jobId: pasteJobId });

      const localPaths = localFiles.map((entry) => entry.path).sort();
      const pastePaths = pasteFiles.map((entry) => entry.path).sort();

      assert.ok(
        localPaths.length > 0,
        "local_json mode should generate at least one file",
      );
      assert.deepEqual(
        localPaths,
        pastePaths,
        "generated file path sets diverged between local_json and figma_paste modes",
      );

      for (const { path: filePath } of localFiles) {
        const [localContent, pasteContent] = await Promise.all([
          fetchGeneratedFileContent({
            server,
            jobId: localJobId,
            filePath,
          }),
          fetchGeneratedFileContent({
            server,
            jobId: pasteJobId,
            filePath,
          }),
        ]);
        assert.equal(
          localContent,
          pasteContent,
          `generated file contents diverged for ${filePath}`,
        );
      }
    } finally {
      await server.app.close();
      await rm(outputRoot, { recursive: true, force: true });
    }
  },
);
