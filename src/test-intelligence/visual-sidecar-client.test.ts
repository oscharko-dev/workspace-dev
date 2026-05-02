import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ALLOWED_VISUAL_SIDECAR_INPUT_MIME_TYPES,
  MAX_VISUAL_SIDECAR_INPUT_BYTES,
  VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME,
  VISUAL_SIDECAR_RESULT_SCHEMA_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type LlmGatewayCapabilities,
  type LlmGenerationRequest,
  type LlmGenerationResult,
  type VisualScreenDescription,
  type VisualSidecarCaptureInput,
  type VisualSidecarResultArtifact,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  createMockLlmGatewayClientBundle,
  type LlmGatewayClientBundle,
} from "./llm-gateway-bundle.js";
import {
  type CreateMockLlmGatewayClientInput,
  type MockResponder,
} from "./llm-mock-gateway.js";
import {
  assertNoImagePayloadToTestGeneration,
  buildVisualSidecarResponseSchema,
  describeVisualScreens,
  preflightCaptures,
  VISUAL_SIDECAR_RESPONSE_SCHEMA_NAME,
  writeVisualSidecarResultArtifact,
} from "./visual-sidecar-client.js";

const TEST_GENERATION_CAPS: LlmGatewayCapabilities = {
  structuredOutputs: true,
  seedSupport: true,
  reasoningEffortSupport: false,
  maxOutputTokensSupport: true,
  streamingSupport: false,
  imageInputSupport: false,
};

const VISUAL_CAPS: LlmGatewayCapabilities = {
  ...TEST_GENERATION_CAPS,
  imageInputSupport: true,
};

const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000400000004080200000026930929000000174944415478da63f8ffff3f030303846480b340244e19006de217e9b6f165090000000049454e44ae426082",
  "hex",
);
const PNG_BASE64 = PNG_BYTES.toString("base64");
const PNG_SHA256 = createHash("sha256").update(PNG_BYTES).digest("hex");

const captureFor = (screenId: string): VisualSidecarCaptureInput => ({
  screenId,
  mimeType: "image/png",
  base64Data: PNG_BASE64,
  screenName: screenId,
});

const buildIntent = (
  screenIds: ReadonlyArray<string>,
): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: "0".repeat(64) },
  screens: screenIds.map((id) => ({
    screenId: id,
    screenName: id,
    sources: ["figma"],
    visualSidecarUsed: true,
  })),
  detectedFields: [],
  detectedActions: [],
  detectedValidations: [],
  detectedNavigation: [],
  inferredBusinessObjects: [],
  risks: [],
  assumptions: [],
  openQuestions: [],
  piiIndicators: [],
  redactions: [],
});

const buildScreenDescriptions = (
  captures: ReadonlyArray<VisualSidecarCaptureInput>,
  deployment: VisualScreenDescription["sidecarDeployment"] = "llama-4-maverick-vision",
): VisualScreenDescription[] =>
  captures.map((capture) => ({
    screenId: capture.screenId,
    sidecarDeployment: deployment,
    regions: [
      {
        regionId: `${capture.screenId}-r1`,
        confidence: 0.9,
        label: "field-1",
        controlType: "text_input",
      },
    ],
    confidenceSummary: { min: 0.9, max: 0.95, mean: 0.92 },
  }));

const buildEnvelope = (
  captures: ReadonlyArray<VisualSidecarCaptureInput>,
  deployment: VisualScreenDescription["sidecarDeployment"] = "llama-4-maverick-vision",
): { screens: VisualScreenDescription[] } => ({
  screens: buildScreenDescriptions(captures, deployment),
});

const buildSuccess = (
  request: LlmGenerationRequest,
  attempt: number,
  content: unknown,
  config: { deployment: string; modelRevision: string; gatewayRelease: string },
): LlmGenerationResult => ({
  outcome: "success",
  content,
  finishReason: "stop",
  usage: { inputTokens: 0, outputTokens: 0 },
  modelDeployment: config.deployment,
  modelRevision: config.modelRevision,
  gatewayRelease: config.gatewayRelease,
  attempt,
});

const PRIMARY_DEPLOYMENT = "llama-4-maverick-vision";
const FALLBACK_DEPLOYMENT = "phi-4-multimodal-poc";

const buildBundle = (overrides: {
  primary?: Pick<
    CreateMockLlmGatewayClientInput,
    "responder" | "staticResponse"
  >;
  fallback?: Pick<
    CreateMockLlmGatewayClientInput,
    "responder" | "staticResponse"
  >;
}): LlmGatewayClientBundle =>
  createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
      declaredCapabilities: TEST_GENERATION_CAPS,
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: PRIMARY_DEPLOYMENT,
      modelRevision: `${PRIMARY_DEPLOYMENT}@test`,
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      ...(overrides.primary?.responder !== undefined
        ? { responder: overrides.primary.responder }
        : {}),
      ...(overrides.primary?.staticResponse !== undefined
        ? { staticResponse: overrides.primary.staticResponse }
        : {}),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: FALLBACK_DEPLOYMENT,
      modelRevision: `${FALLBACK_DEPLOYMENT}@test`,
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      ...(overrides.fallback?.responder !== undefined
        ? { responder: overrides.fallback.responder }
        : {}),
      ...(overrides.fallback?.staticResponse !== undefined
        ? { staticResponse: overrides.fallback.staticResponse }
        : {}),
    },
  });

const monotonicClock = (): (() => number) => {
  let now = 0;
  return () => {
    now += 5;
    return now;
  };
};

test("primary success: visualPrimary wins, fallback is never called, fallbackReason=none", async () => {
  const captures = [captureFor("s-1"), captureFor("s-2")];
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const primaryResponder: MockResponder = (request, attempt) => {
    primaryCalls += 1;
    return buildSuccess(request, attempt, buildEnvelope(captures), {
      deployment: PRIMARY_DEPLOYMENT,
      modelRevision: `${PRIMARY_DEPLOYMENT}@test`,
      gatewayRelease: "mock",
    });
  };
  const fallbackResponder: MockResponder = (request, attempt) => {
    fallbackCalls += 1;
    return buildSuccess(request, attempt, buildEnvelope(captures), {
      deployment: FALLBACK_DEPLOYMENT,
      modelRevision: `${FALLBACK_DEPLOYMENT}@test`,
      gatewayRelease: "mock",
    });
  };
  const bundle = buildBundle({
    primary: { responder: primaryResponder },
    fallback: { responder: fallbackResponder },
  });
  const result = await describeVisualScreens({
    bundle,
    captures,
    jobId: "job-1",
    generatedAt: "2026-04-25T00:00:00.000Z",
    intent: buildIntent(["s-1", "s-2"]),
    primaryDeployment: PRIMARY_DEPLOYMENT,
    clock: monotonicClock(),
  });
  assert.equal(result.outcome, "success");
  if (result.outcome !== "success") return;
  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 0);
  assert.equal(result.fallbackReason, "none");
  assert.equal(result.selectedDeployment, PRIMARY_DEPLOYMENT);
  assert.equal(result.visual.length, 2);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0]?.deployment, PRIMARY_DEPLOYMENT);
  assert.equal(result.validationReport.blocked, false);
});

test("fallback success on primary timeout: fallbackReason=primary_unavailable", async () => {
  const captures = [captureFor("s-1")];
  const primaryResponder: MockResponder = (_request, attempt) => ({
    outcome: "error",
    errorClass: "timeout",
    message: "request timed out",
    retryable: true,
    attempt,
  });
  const fallbackResponder: MockResponder = (request, attempt) =>
    buildSuccess(
      request,
      attempt,
      buildEnvelope(captures, "phi-4-multimodal-poc"),
      {
        deployment: FALLBACK_DEPLOYMENT,
        modelRevision: `${FALLBACK_DEPLOYMENT}@test`,
        gatewayRelease: "mock",
      },
    );
  const bundle = buildBundle({
    primary: { responder: primaryResponder },
    fallback: { responder: fallbackResponder },
  });
  const result = await describeVisualScreens({
    bundle,
    captures,
    jobId: "job-2",
    generatedAt: "2026-04-25T00:00:00.000Z",
    intent: buildIntent(["s-1"]),
    primaryDeployment: PRIMARY_DEPLOYMENT,
    clock: monotonicClock(),
  });
  assert.equal(result.outcome, "success");
  if (result.outcome !== "success") return;
  assert.equal(result.fallbackReason, "primary_unavailable");
  assert.equal(result.selectedDeployment, FALLBACK_DEPLOYMENT);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0]?.errorClass, "timeout");
  assert.equal(result.attempts[1]?.deployment, FALLBACK_DEPLOYMENT);
});

test("fallback on primary rate_limited: fallbackReason=primary_quota_exceeded", async () => {
  const captures = [captureFor("s-1")];
  const primaryResponder: MockResponder = (_request, attempt) => ({
    outcome: "error",
    errorClass: "rate_limited",
    message: "rate limited",
    retryable: true,
    attempt,
  });
  const fallbackResponder: MockResponder = (request, attempt) =>
    buildSuccess(
      request,
      attempt,
      buildEnvelope(captures, "phi-4-multimodal-poc"),
      {
        deployment: FALLBACK_DEPLOYMENT,
        modelRevision: `${FALLBACK_DEPLOYMENT}@test`,
        gatewayRelease: "mock",
      },
    );
  const bundle = buildBundle({
    primary: { responder: primaryResponder },
    fallback: { responder: fallbackResponder },
  });
  const result = await describeVisualScreens({
    bundle,
    captures,
    jobId: "job-3",
    generatedAt: "2026-04-25T00:00:00.000Z",
    intent: buildIntent(["s-1"]),
    primaryDeployment: PRIMARY_DEPLOYMENT,
    clock: monotonicClock(),
  });
  assert.equal(result.outcome, "success");
  if (result.outcome !== "success") return;
  assert.equal(result.fallbackReason, "primary_quota_exceeded");
});

test("both fail: VisualSidecarFailure with both_sidecars_failed and union of attempts", async () => {
  const captures = [captureFor("s-1")];
  const primaryResponder: MockResponder = (_request, attempt) => ({
    outcome: "error",
    errorClass: "timeout",
    message: "timeout",
    retryable: true,
    attempt,
  });
  const fallbackResponder: MockResponder = (_request, attempt) => ({
    outcome: "error",
    errorClass: "transport",
    message: "boom",
    retryable: true,
    attempt,
  });
  const bundle = buildBundle({
    primary: { responder: primaryResponder },
    fallback: { responder: fallbackResponder },
  });
  const result = await describeVisualScreens({
    bundle,
    captures,
    jobId: "job-4",
    generatedAt: "2026-04-25T00:00:00.000Z",
    intent: buildIntent(["s-1"]),
    primaryDeployment: PRIMARY_DEPLOYMENT,
    clock: monotonicClock(),
  });
  assert.equal(result.outcome, "failure");
  if (result.outcome !== "failure") return;
  assert.equal(result.failureClass, "both_sidecars_failed");
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0]?.errorClass, "timeout");
  assert.equal(result.attempts[1]?.errorClass, "transport");
  // No PII / tokens in the failureMessage.
  assert.match(result.failureMessage, /both_sidecars_failed/);
});

test("invalid sidecar JSON: schema_invalid on primary triggers fallback; both bad → schema_invalid_response", async () => {
  const captures = [captureFor("s-1")];
  const primaryResponder: MockResponder = (request, attempt) =>
    buildSuccess(
      request,
      attempt,
      // missing required fields -> envelope validation fails
      { screens: [{ screenId: "s-1" }] },
      {
        deployment: PRIMARY_DEPLOYMENT,
        modelRevision: `${PRIMARY_DEPLOYMENT}@test`,
        gatewayRelease: "mock",
      },
    );
  const fallbackResponder: MockResponder = (request, attempt) =>
    buildSuccess(
      request,
      attempt,
      // also bad: not even an envelope shape
      { unexpected: true },
      {
        deployment: FALLBACK_DEPLOYMENT,
        modelRevision: `${FALLBACK_DEPLOYMENT}@test`,
        gatewayRelease: "mock",
      },
    );
  const bundle = buildBundle({
    primary: { responder: primaryResponder },
    fallback: { responder: fallbackResponder },
  });
  const result = await describeVisualScreens({
    bundle,
    captures,
    jobId: "job-5",
    generatedAt: "2026-04-25T00:00:00.000Z",
    intent: buildIntent(["s-1"]),
    primaryDeployment: PRIMARY_DEPLOYMENT,
    clock: monotonicClock(),
  });
  assert.equal(result.outcome, "failure");
  if (result.outcome !== "failure") return;
  assert.equal(result.failureClass, "schema_invalid_response");
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0]?.errorClass, "schema_invalid_response");
  assert.equal(result.attempts[1]?.errorClass, "schema_invalid_response");
});

test("preflight: image too large → image_payload_too_large; no gateway call", async () => {
  // Generate a buffer larger than the limit. We use random bytes so we
  // know the decoded length is exactly the buffer length.
  const oversized = randomBytes(MAX_VISUAL_SIDECAR_INPUT_BYTES + 1).toString(
    "base64",
  );
  const captures: VisualSidecarCaptureInput[] = [
    {
      screenId: "s-1",
      mimeType: "image/png",
      base64Data: oversized,
    },
  ];
  let primaryCalls = 0;
  const bundle = buildBundle({
    primary: {
      responder: () => {
        primaryCalls += 1;
        throw new Error("must not be called");
      },
    },
  });
  const result = await describeVisualScreens({
    bundle,
    captures,
    jobId: "job-6",
    generatedAt: "2026-04-25T00:00:00.000Z",
    intent: buildIntent(["s-1"]),
    primaryDeployment: PRIMARY_DEPLOYMENT,
  });
  assert.equal(result.outcome, "failure");
  if (result.outcome !== "failure") return;
  assert.equal(result.failureClass, "image_payload_too_large");
  assert.equal(result.attempts.length, 0);
  assert.equal(primaryCalls, 0);
});

test("finops preflight: image budget applies to the whole outbound request", async () => {
  const captureA = randomBytes(80).toString("base64");
  const captureB = randomBytes(80).toString("base64");
  const captures: VisualSidecarCaptureInput[] = [
    { screenId: "s-1", mimeType: "image/png", base64Data: captureA },
    { screenId: "s-2", mimeType: "image/png", base64Data: captureB },
  ];
  let primaryCalls = 0;
  const bundle = buildBundle({
    primary: {
      responder: () => {
        primaryCalls += 1;
        throw new Error("must not be called");
      },
    },
  });
  const result = await describeVisualScreens({
    bundle,
    captures,
    jobId: "job-6b",
    generatedAt: "2026-04-25T00:00:00.000Z",
    intent: buildIntent(["s-1", "s-2"]),
    primaryDeployment: PRIMARY_DEPLOYMENT,
    maxImageBytesPerRequest: { visualPrimary: 81 },
  });
  assert.equal(result.outcome, "failure");
  if (result.outcome !== "failure") return;
  assert.equal(result.failureClass, "image_payload_too_large");
  assert.equal(result.attempts.length, 0);
  assert.equal(primaryCalls, 0);
  assert.match(result.failureMessage, /request decoded byte length/);
});

test("preflight: unsupported MIME (image/svg+xml) → image_mime_unsupported", () => {
  // Direct preflight test — SVG is NOT in the allowlist for XML safety.
  const result = preflightCaptures([
    {
      screenId: "s-1",
      // The MIME field is typed as a union, but at API boundaries
      // user input arrives as a plain string. Cast through unknown for
      // the test to exercise the runtime allowlist.
      mimeType:
        "image/svg+xml" as unknown as VisualSidecarCaptureInput["mimeType"],
      base64Data: PNG_BASE64,
    },
  ]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.failureClass, "image_mime_unsupported");
});

test("preflight: duplicate screenId → duplicate_screen_id", () => {
  const result = preflightCaptures([captureFor("s-dup"), captureFor("s-dup")]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.failureClass, "duplicate_screen_id");
});

test("preflight: empty captures → empty_screen_capture_set", () => {
  const result = preflightCaptures([]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.failureClass, "empty_screen_capture_set");
});

test("test-generation guard: bundle with imageInputSupport=true on testGeneration throws RangeError at entry", async () => {
  // assertBundle in createMockLlmGatewayClientBundle would normally reject
  // such a configuration. To exercise the entry-point check, we hand-build
  // a bundle whose role assertion has been bypassed (the protective
  // factory is correctly strict, so we craft the bundle in-test with a
  // proxy mock that lies about its declaredCapabilities).
  const bundle = buildBundle({});
  const tampered: LlmGatewayClientBundle = {
    ...bundle,
    testGeneration: {
      ...bundle.testGeneration,
      declaredCapabilities: {
        ...bundle.testGeneration.declaredCapabilities,
        imageInputSupport: true,
      },
    },
  };
  await assert.rejects(
    () =>
      describeVisualScreens({
        bundle: tampered,
        captures: [captureFor("s-1")],
        jobId: "job-7",
        generatedAt: "2026-04-25T00:00:00.000Z",
        intent: buildIntent(["s-1"]),
      }),
    /imageInputSupport/,
  );

  // Conversely, the recorded-requests assertion catches accidental
  // image submissions even when the gateway declared no image support.
  const recordedRequests: LlmGenerationRequest[] = [
    {
      jobId: "job-7",
      systemPrompt: "sys",
      userPrompt: "usr",
      imageInputs: [{ mimeType: "image/png", base64Data: "[mock:80b]" }],
    },
  ];
  assert.throws(
    () =>
      assertNoImagePayloadToTestGeneration({
        bundle,
        recordedRequests,
      }),
    /must never receive image payloads/,
  );

  // And: empty recorded requests are accepted.
  assertNoImagePayloadToTestGeneration({
    bundle,
    recordedRequests: [],
  });
});

test("validation gate integration: PII-containing visibleText still surfaces success with possible_pii outcome", async () => {
  const captures = [captureFor("s-pii")];
  const screens: VisualScreenDescription[] = [
    {
      screenId: "s-pii",
      sidecarDeployment: "llama-4-maverick-vision",
      regions: [
        {
          regionId: "r-pii",
          confidence: 0.95,
          label: "email",
          controlType: "text_input",
          visibleText: "leak@example.com",
        },
      ],
      confidenceSummary: { min: 0.95, max: 0.95, mean: 0.95 },
    },
  ];
  const primaryResponder: MockResponder = (request, attempt) =>
    buildSuccess(
      request,
      attempt,
      { screens },
      {
        deployment: PRIMARY_DEPLOYMENT,
        modelRevision: `${PRIMARY_DEPLOYMENT}@test`,
        gatewayRelease: "mock",
      },
    );
  const bundle = buildBundle({ primary: { responder: primaryResponder } });
  const result = await describeVisualScreens({
    bundle,
    captures,
    jobId: "job-8",
    generatedAt: "2026-04-25T00:00:00.000Z",
    intent: buildIntent(["s-pii"]),
    primaryDeployment: PRIMARY_DEPLOYMENT,
  });
  assert.equal(result.outcome, "success");
  if (result.outcome !== "success") return;
  // The success record carries the validator's report verbatim — the
  // client does NOT silently strip findings.
  assert.equal(result.validationReport.blocked, true);
  const records = result.validationReport.records;
  assert.equal(records.length, 1);
  assert.ok(records[0]?.outcomes.includes("possible_pii"));
});

test("capture identity hashing: SHA-256 matches the decoded bytes; no base64 in identity", async () => {
  const captures = [captureFor("s-1")];
  const primaryResponder: MockResponder = (request, attempt) =>
    buildSuccess(request, attempt, buildEnvelope(captures), {
      deployment: PRIMARY_DEPLOYMENT,
      modelRevision: `${PRIMARY_DEPLOYMENT}@test`,
      gatewayRelease: "mock",
    });
  const bundle = buildBundle({ primary: { responder: primaryResponder } });
  const result = await describeVisualScreens({
    bundle,
    captures,
    jobId: "job-9",
    generatedAt: "2026-04-25T00:00:00.000Z",
    intent: buildIntent(["s-1"]),
    primaryDeployment: PRIMARY_DEPLOYMENT,
  });
  assert.equal(result.outcome, "success");
  if (result.outcome !== "success") return;
  const identity = result.captureIdentities[0];
  assert.ok(identity !== undefined);
  assert.equal(identity.sha256, PNG_SHA256);
  assert.equal(identity.byteLength, PNG_BYTES.byteLength);
  assert.equal(identity.mimeType, "image/png");
  // Identity record must not carry the base64 bytes.
  assert.equal((identity as Record<string, unknown>)["base64Data"], undefined);
});

test("determinism: identical inputs produce byte-identical artifacts (canonical JSON)", async () => {
  const captures = [captureFor("s-1"), captureFor("s-2")];
  const buildResponder =
    (deployment: string): MockResponder =>
    (request, attempt) =>
      buildSuccess(request, attempt, buildEnvelope(captures), {
        deployment,
        modelRevision: `${deployment}@test`,
        gatewayRelease: "mock",
      });

  const runOnce = async (jobId: string) => {
    const bundle = buildBundle({
      primary: { responder: buildResponder(PRIMARY_DEPLOYMENT) },
    });
    const result = await describeVisualScreens({
      bundle,
      captures,
      jobId,
      generatedAt: "2026-04-25T00:00:00.000Z",
      intent: buildIntent(["s-1", "s-2"]),
      primaryDeployment: PRIMARY_DEPLOYMENT,
      // Use a deterministic clock so attempt durations are stable.
      clock: monotonicClock(),
    });
    return result;
  };

  const r1 = await runOnce("job-deterministic");
  const r2 = await runOnce("job-deterministic");
  assert.equal(canonicalJson(r1), canonicalJson(r2));

  const dir = await mkdtemp(join(tmpdir(), "ti-sidecar-"));
  const path1 = join(dir, "result-1.json");
  const path2 = join(dir, "result-2.json");
  await writeVisualSidecarResultArtifact({
    result: r1,
    destinationPath: path1,
    jobId: "job-deterministic",
    generatedAt: "2026-04-25T00:00:00.000Z",
  });
  await writeVisualSidecarResultArtifact({
    result: r2,
    destinationPath: path2,
    jobId: "job-deterministic",
    generatedAt: "2026-04-25T00:00:00.000Z",
  });
  const bytes1 = await readFile(path1);
  const bytes2 = await readFile(path2);
  assert.deepEqual(bytes1, bytes2);

  // The persisted artifact carries the negative invariant flag.
  const parsed = JSON.parse(
    bytes1.toString("utf8"),
  ) as VisualSidecarResultArtifact;
  assert.equal(parsed.rawScreenshotsIncluded, false);
  assert.equal(parsed.schemaVersion, VISUAL_SIDECAR_RESULT_SCHEMA_VERSION);
  assert.equal(
    parsed.visualSidecarSchemaVersion,
    VISUAL_SIDECAR_SCHEMA_VERSION,
  );
});

test("write artifact: filename matches contract and lands at the requested path", async () => {
  const captures = [captureFor("s-1")];
  const result = await describeVisualScreens({
    bundle: buildBundle({
      primary: {
        responder: (request, attempt) =>
          buildSuccess(request, attempt, buildEnvelope(captures), {
            deployment: PRIMARY_DEPLOYMENT,
            modelRevision: `${PRIMARY_DEPLOYMENT}@test`,
            gatewayRelease: "mock",
          }),
      },
    }),
    captures,
    jobId: "job-write",
    generatedAt: "2026-04-25T00:00:00.000Z",
    intent: buildIntent(["s-1"]),
    primaryDeployment: PRIMARY_DEPLOYMENT,
  });
  assert.equal(result.outcome, "success");
  const dir = await mkdtemp(join(tmpdir(), "ti-sidecar-write-"));
  const path = join(dir, VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME);
  await writeVisualSidecarResultArtifact({
    result,
    destinationPath: path,
    jobId: "job-write",
    generatedAt: "2026-04-25T00:00:00.000Z",
  });
  const bytes = await readFile(path);
  const parsed = JSON.parse(
    bytes.toString("utf8"),
  ) as VisualSidecarResultArtifact;
  assert.equal(parsed.jobId, "job-write");
  assert.equal(parsed.rawScreenshotsIncluded, false);
});

test("response schema: structure is locked; required fields enforce descent into screens", () => {
  const schema = buildVisualSidecarResponseSchema();
  assert.equal(schema["additionalProperties"], false);
  const required = schema["required"] as ReadonlyArray<string>;
  assert.deepEqual(required, ["screens"]);
  // Schema name is stable.
  assert.equal(
    VISUAL_SIDECAR_RESPONSE_SCHEMA_NAME,
    "workspace-dev-visual-sidecar-v1",
  );
  assert.match(VISUAL_SIDECAR_RESPONSE_SCHEMA_NAME, /^[a-zA-Z0-9_-]{1,64}$/);
});

test("allowlists: SVG is intentionally excluded from the MIME allowlist", () => {
  const allowed =
    ALLOWED_VISUAL_SIDECAR_INPUT_MIME_TYPES as ReadonlyArray<string>;
  assert.ok(!allowed.includes("image/svg+xml"));
});

test("policy_downgrade: forceFallback skips primary entirely", async () => {
  const captures = [captureFor("s-1")];
  let primaryCalls = 0;
  const primaryResponder: MockResponder = () => {
    primaryCalls += 1;
    throw new Error("primary must not be called when forceFallback=true");
  };
  const fallbackResponder: MockResponder = (request, attempt) =>
    buildSuccess(
      request,
      attempt,
      buildEnvelope(captures, "phi-4-multimodal-poc"),
      {
        deployment: FALLBACK_DEPLOYMENT,
        modelRevision: `${FALLBACK_DEPLOYMENT}@test`,
        gatewayRelease: "mock",
      },
    );
  const bundle = buildBundle({
    primary: { responder: primaryResponder },
    fallback: { responder: fallbackResponder },
  });
  const result = await describeVisualScreens({
    bundle,
    captures,
    jobId: "job-force",
    generatedAt: "2026-04-25T00:00:00.000Z",
    intent: buildIntent(["s-1"]),
    primaryDeployment: PRIMARY_DEPLOYMENT,
    forceFallback: true,
  });
  assert.equal(primaryCalls, 0);
  assert.equal(result.outcome, "success");
  if (result.outcome !== "success") return;
  assert.equal(result.fallbackReason, "policy_downgrade");
  assert.equal(result.selectedDeployment, FALLBACK_DEPLOYMENT);
});
