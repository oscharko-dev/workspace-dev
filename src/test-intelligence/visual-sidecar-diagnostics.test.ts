/**
 * Regression coverage for Issue #2017: visual sidecar diagnostics.
 *
 * The visual sidecar client must surface enough evidence on a failed
 * attempt for a reviewer to debug the model response without re-running
 * the live LLM call. This file exercises the contract:
 *
 *   - Protocol failure on the primary attempt persists a raw-response
 *     diagnostic with the gateway's error class and (redacted) message.
 *   - Schema-invalid fallback persists a diagnostic with a normalized
 *     parser error and a bounded slice of the model's reply text.
 *   - The relative path on each `VisualSidecarAttempt` matches the
 *     filename the diagnostic carries, so callers can write both
 *     atomically and trust the cross-reference in the persisted result.
 *   - The diagnostic enforces `rawScreenshotsIncluded: false` and never
 *     leaks PII present in the model's textual response.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  VISUAL_SIDECAR_DIAGNOSTIC_ARTIFACT_SCHEMA_VERSION,
  VISUAL_SIDECAR_DIAGNOSTIC_RAW_TEXT_BYTE_LIMIT,
  VISUAL_SIDECAR_DIAGNOSTICS_ARTIFACT_DIRECTORY,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type LlmGatewayCapabilities,
  type LlmGenerationRequest,
  type LlmGenerationResult,
  type VisualScreenDescription,
  type VisualSidecarCaptureInput,
  type VisualSidecarDiagnosticArtifact,
} from "../contracts/index.js";
import {
  createMockLlmGatewayClientBundle,
  type LlmGatewayClientBundle,
} from "./llm-gateway-bundle.js";
import {
  type CreateMockLlmGatewayClientInput,
  type MockResponder,
} from "./llm-mock-gateway.js";
import { describeVisualScreens } from "./visual-sidecar-client.js";

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

const PRIMARY_DEPLOYMENT = "llama-4-maverick-vision";
const FALLBACK_DEPLOYMENT = "phi-4-multimodal-poc";

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
  deployment: VisualScreenDescription["sidecarDeployment"] = PRIMARY_DEPLOYMENT,
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
  deployment: VisualScreenDescription["sidecarDeployment"] = PRIMARY_DEPLOYMENT,
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

test("issue #2017: protocol failure on primary persists a diagnostic with errorClass and gateway message", async () => {
  const captures = [captureFor("s-1")];
  const primaryResponder: MockResponder = (_request, attempt) => ({
    outcome: "error",
    errorClass: "transport",
    message: "TLS handshake aborted by deployment mistral-document-ai-2512",
    retryable: true,
    attempt,
  });
  const fallbackResponder: MockResponder = (request, attempt) =>
    buildSuccess(
      request,
      attempt,
      buildEnvelope(captures, FALLBACK_DEPLOYMENT),
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

  const { result, diagnostics } = await describeVisualScreens({
    bundle,
    captures,
    jobId: "job-#2017-protocol",
    generatedAt: "2026-05-07T14:53:57.699Z",
    intent: buildIntent(["s-1"]),
    primaryDeployment: PRIMARY_DEPLOYMENT,
    clock: monotonicClock(),
  });

  // The primary attempt failed with `transport`; the fallback succeeded.
  assert.equal(result.outcome, "success");
  assert.equal(diagnostics.length, 1);
  const [diagnostic] = diagnostics;
  assert.ok(diagnostic !== undefined);
  // Filename is namespaced under the diagnostic directory.
  assert.match(
    diagnostic.filename,
    new RegExp(`^${VISUAL_SIDECAR_DIAGNOSTICS_ARTIFACT_DIRECTORY}/`),
  );
  assert.match(diagnostic.filename, /attempt-01-/);
  assert.match(diagnostic.filename, /-transport\.json$/);
  // SHA-256 matches the bytes the caller will persist.
  assert.equal(
    diagnostic.sha256,
    createHash("sha256").update(diagnostic.bytes).digest("hex"),
  );
  // Decoded artifact carries diagnostic context.
  const artifact = diagnostic.artifact;
  assert.equal(
    artifact.schemaVersion,
    VISUAL_SIDECAR_DIAGNOSTIC_ARTIFACT_SCHEMA_VERSION,
  );
  assert.equal(artifact.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
  assert.equal(
    artifact.visualSidecarSchemaVersion,
    VISUAL_SIDECAR_SCHEMA_VERSION,
  );
  assert.equal(artifact.attempt, 1);
  assert.equal(artifact.errorClass, "transport");
  assert.equal(artifact.responseShape, "missing");
  assert.equal(artifact.rawScreenshotsIncluded, false);
  assert.match(artifact.gatewayMessage ?? "", /TLS handshake aborted/);
  // The persisted attempt cross-references the diagnostic by relative path.
  if (result.outcome !== "success") return;
  const persistedAttempt = result.attempts[0];
  assert.equal(persistedAttempt?.errorClass, "transport");
  assert.equal(persistedAttempt?.rawResponseArtifactPath, diagnostic.filename);
  assert.match(
    persistedAttempt?.normalizedParserError ?? "",
    /TLS handshake aborted/,
  );
});

test("issue #2017: schema-invalid fallback persists a diagnostic with normalized parser error and bounded raw text", async () => {
  const captures = [captureFor("s-1")];
  // Primary returns a real protocol failure to mimic the benchmark trace.
  const primaryResponder: MockResponder = (_request, attempt) => ({
    outcome: "error",
    errorClass: "schema_invalid_response",
    message: "primary returned malformed JSON envelope",
    retryable: false,
    attempt,
  });
  // Fallback returns a 200 with a body that does not match the envelope:
  // a `regions` array that is missing the required `confidence` field.
  // The local parser must surface this as `schema_invalid_response` AND
  // capture the raw text so a reviewer can see what arrived.
  const malformedBody =
    '{"screens":[{"screenId":"s-1","sidecarDeployment":"phi-4-multimodal-poc","regions":[{"regionId":"r-1"}],"confidenceSummary":{"min":0.4,"max":0.6,"mean":0.5}}]}';
  const fallbackResponder: MockResponder = (request, attempt) =>
    buildSuccess(request, attempt, malformedBody, {
      deployment: FALLBACK_DEPLOYMENT,
      modelRevision: `${FALLBACK_DEPLOYMENT}@test`,
      gatewayRelease: "mock",
    });

  const bundle = buildBundle({
    primary: { responder: primaryResponder },
    fallback: { responder: fallbackResponder },
  });
  const { result, diagnostics } = await describeVisualScreens({
    bundle,
    captures,
    jobId: "job-#2017-schema",
    generatedAt: "2026-05-07T14:53:57.699Z",
    intent: buildIntent(["s-1"]),
    primaryDeployment: PRIMARY_DEPLOYMENT,
    clock: monotonicClock(),
  });

  assert.equal(result.outcome, "failure");
  if (result.outcome !== "failure") return;
  assert.equal(result.failureClass, "schema_invalid_response");

  // Two failed attempts → two diagnostic artifacts.
  assert.equal(diagnostics.length, 2);
  const [primaryDiagnostic, fallbackDiagnostic] = diagnostics;
  assert.ok(primaryDiagnostic !== undefined);
  assert.ok(fallbackDiagnostic !== undefined);
  assert.match(primaryDiagnostic.filename, /attempt-01-/);
  assert.match(primaryDiagnostic.filename, /-schema_invalid_response\.json$/);
  assert.match(fallbackDiagnostic.filename, /attempt-02-/);
  assert.match(fallbackDiagnostic.filename, /-schema_invalid_response\.json$/);

  // The fallback diagnostic captured the local parser error AND a
  // bounded slice of the raw response text.
  const fallbackArtifact = fallbackDiagnostic.artifact;
  assert.equal(fallbackArtifact.errorClass, "schema_invalid_response");
  assert.equal(fallbackArtifact.responseShape, "string");
  // The normalized parser error names the structural breakage. The
  // exact wording is owned by the parser; we only require a non-empty
  // diagnostic string.
  assert.ok(
    (fallbackArtifact.normalizedParserError ?? "").length > 0,
    "expected normalizedParserError to be populated",
  );
  assert.match(fallbackArtifact.rawTextContent ?? "", /"regionId":"r-1"/);
  assert.ok(
    Buffer.byteLength(fallbackArtifact.rawTextContent ?? "", "utf8") <=
      VISUAL_SIDECAR_DIAGNOSTIC_RAW_TEXT_BYTE_LIMIT,
  );

  // Per-attempt cross-reference is in place on the persisted result.
  const [primaryAttempt, fallbackAttempt] = result.attempts;
  assert.equal(
    primaryAttempt?.rawResponseArtifactPath,
    primaryDiagnostic.filename,
  );
  assert.equal(
    fallbackAttempt?.rawResponseArtifactPath,
    fallbackDiagnostic.filename,
  );
  assert.ok(
    (fallbackAttempt?.normalizedParserError ?? "").length > 0,
    "expected fallback attempt normalizedParserError to be populated",
  );
});

test("issue #2017: pre-flight failure produces no diagnostics (no gateway round-trip occurred)", async () => {
  // Empty capture set is a caller-side bug, intercepted by `preflightCaptures`
  // before any gateway call. The contract: no diagnostics, the failure
  // is still policy-readable via `failureClass`.
  const bundle = buildBundle({});
  const { result, diagnostics } = await describeVisualScreens({
    bundle,
    captures: [],
    jobId: "job-#2017-empty",
    generatedAt: "2026-05-07T14:53:57.699Z",
    intent: buildIntent([]),
    primaryDeployment: PRIMARY_DEPLOYMENT,
    clock: monotonicClock(),
  });
  assert.equal(result.outcome, "failure");
  if (result.outcome !== "failure") return;
  assert.equal(result.failureClass, "empty_screen_capture_set");
  assert.equal(diagnostics.length, 0);
});

test("issue #2017: PII inside a malformed response is redacted before it lands in the diagnostic", async () => {
  const captures = [captureFor("s-1")];
  // Body misses `screens` so the parser surfaces schema_invalid_response.
  // The body also contains an IBAN — the diagnostic must redact it.
  const bodyWithPii =
    '{"unexpected":"the user\'s account is DE89370400440532013000 and tax id 123-45-6789"}';
  const primaryResponder: MockResponder = (request, attempt) =>
    buildSuccess(request, attempt, bodyWithPii, {
      deployment: PRIMARY_DEPLOYMENT,
      modelRevision: `${PRIMARY_DEPLOYMENT}@test`,
      gatewayRelease: "mock",
    });
  const bundle = buildBundle({ primary: { responder: primaryResponder } });
  const { diagnostics } = await describeVisualScreens({
    bundle,
    captures,
    jobId: "job-#2017-pii",
    generatedAt: "2026-05-07T14:53:57.699Z",
    intent: buildIntent(["s-1"]),
    primaryDeployment: PRIMARY_DEPLOYMENT,
    clock: monotonicClock(),
  });
  assert.equal(diagnostics.length >= 1, true);
  const artifact = diagnostics[0]?.artifact as
    | VisualSidecarDiagnosticArtifact
    | undefined;
  assert.ok(artifact !== undefined);
  // The IBAN must NOT survive into the persisted raw text.
  assert.doesNotMatch(artifact.rawTextContent ?? "", /DE89370400440532013000/);
  // The redaction marker confirms the secret-redactor ran.
  assert.match(artifact.rawTextContent ?? "", /\[REDACTED\]/);
});
