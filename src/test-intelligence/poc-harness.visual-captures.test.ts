/**
 * Integration tests for the `visualCaptures` opt-in path in `runWave1Poc`
 * (Issue #1386, AC4). Exercises the multimodal visual sidecar end-to-end at
 * the harness level.
 *
 * Three scenarios:
 *   1. Happy path — primary wins, artefacts land on disk.
 *   2. Fallback path — primary times out, fallback succeeds.
 *   3. Invalid sidecar JSON — harness throws; no downstream test cases are produced.
 *   4. Both fail — harness throws; no downstream test cases are produced.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FINOPS_ARTIFACT_DIRECTORY,
  FINOPS_BUDGET_REPORT_ARTIFACT_FILENAME,
  GENERATED_TESTCASES_ARTIFACT_FILENAME,
  LBOM_ARTIFACT_DIRECTORY,
  LBOM_ARTIFACT_FILENAME,
  TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME,
  VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME,
  VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME,
  WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  type FinOpsBudgetReport,
  type LlmGenerationRequest,
  type LlmGenerationResult,
  type VisualScreenDescription,
  type Wave1PocLbomDocument,
} from "../contracts/index.js";
import { validateLbomDocument } from "./lbom-emitter.js";
import {
  createMockLlmGatewayClientBundle,
  loadWave1PocCaptureFixture,
  runWave1Poc,
  synthesizeGeneratedTestCases,
  verifyWave1PocEvidenceFromDisk,
  Wave1PocVisualSidecarFailureError,
  type MockResponder,
} from "./index.js";

const GENERATED_AT = "2026-04-25T10:00:00.000Z";
const FIXTURE_ID = "poc-onboarding" as const;
const PRIMARY_DEPLOYMENT = "llama-4-maverick-vision" as const;
const FALLBACK_DEPLOYMENT = "phi-4-multimodal-poc" as const;

const TEST_GENERATION_CAPS = {
  structuredOutputs: true,
  seedSupport: true,
  reasoningEffortSupport: false,
  maxOutputTokensSupport: true,
  streamingSupport: false,
  imageInputSupport: false,
} as const;

const VISUAL_CAPS = {
  ...TEST_GENERATION_CAPS,
  imageInputSupport: true,
} as const;

const newRunDir = async (): Promise<string> => {
  return mkdtemp(join(tmpdir(), "ti-poc-visual-"));
};

const cleanupRunDir = async (runDir: string): Promise<void> => {
  await rm(runDir, { recursive: true }).catch(() => undefined);
};

const assertFailureManifestAttestsSidecar = async (
  runDir: string,
): Promise<void> => {
  const { manifest, result } = await verifyWave1PocEvidenceFromDisk(runDir);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(manifest.rawScreenshotsIncluded, false);
  assert.equal(manifest.imagePayloadSentToTestGeneration, false);
  assert.equal(manifest.modelDeployments.visualPrimary, PRIMARY_DEPLOYMENT);
  assert.equal(manifest.modelDeployments.visualFallback, FALLBACK_DEPLOYMENT);
  const sidecarEntry = manifest.artifacts.find(
    (artifact) => artifact.filename === VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME,
  );
  assert.ok(sidecarEntry, "failure manifest must attest visual sidecar result");
  assert.equal(sidecarEntry.category, "visual_sidecar");
  assert.ok(
    manifest.artifacts.some(
      (artifact) =>
        artifact.filename === WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
    ) === false,
    "manifest should attest emitted artifacts, not recursively attest itself",
  );
  // Issue #1378 — even on a refused run, the failure manifest must attest
  // the per-job LBOM so an operator can audit the model chain that was
  // attempted before the sidecar exhaustion.
  const lbomFilename = `${LBOM_ARTIFACT_DIRECTORY}/${LBOM_ARTIFACT_FILENAME}`;
  const lbomEntry = manifest.artifacts.find(
    (artifact) => artifact.filename === lbomFilename,
  );
  assert.ok(lbomEntry, "failure manifest must attest the per-job LBOM");
  assert.equal(lbomEntry.category, "lbom");
  const lbomRaw = await readFile(join(runDir, lbomFilename), "utf8");
  const parsedLbom = JSON.parse(lbomRaw) as Wave1PocLbomDocument;
  const lbomValidation = validateLbomDocument(parsedLbom);
  assert.equal(
    lbomValidation.valid,
    true,
    JSON.stringify(lbomValidation.issues, null, 2),
  );
  assert.equal(parsedLbom.secretsIncluded, false);
  assert.equal(parsedLbom.rawPromptsIncluded, false);
  assert.equal(parsedLbom.rawScreenshotsIncluded, false);
};

/**
 * Build a `VisualScreenDescription[]` whose screen IDs match those in the
 * poc-onboarding visual fixture. The mock sidecar must return the same
 * screen IDs as the captures so reconciliation finds no conflicts.
 */
const buildScreenDescriptions = (
  screenIds: ReadonlyArray<string>,
  deployment: VisualScreenDescription["sidecarDeployment"],
): VisualScreenDescription[] =>
  screenIds.map((screenId) => ({
    screenId,
    sidecarDeployment: deployment,
    regions: [
      {
        regionId: `${screenId}-r1`,
        confidence: 0.92,
        label: "form-field",
        controlType: "text_input",
      },
    ],
    confidenceSummary: { min: 0.9, max: 0.95, mean: 0.92 },
  }));

/**
 * Screen IDs for the poc-onboarding fixture, derived from poc-onboarding.visual.json.
 */
const POC_ONBOARDING_SCREEN_IDS: ReadonlyArray<string> = [
  "s-onboarding-account",
  "s-onboarding-verify",
];

const buildSuccessResult = (
  content: unknown,
  deployment: string,
  attempt: number,
): LlmGenerationResult => ({
  outcome: "success",
  content,
  finishReason: "stop",
  usage: { inputTokens: 0, outputTokens: 0 },
  modelDeployment: deployment,
  modelRevision: `${deployment}@test`,
  gatewayRelease: "mock",
  attempt,
});

// ---------------------------------------------------------------------------
// Test 1: End-to-end happy path with visualCaptures
// ---------------------------------------------------------------------------

test("poc-harness visualCaptures: happy path — primary succeeds, artifacts land on disk", async () => {
  const runDir = await newRunDir();
  try {
    const { captures } = await loadWave1PocCaptureFixture(FIXTURE_ID);

    const visualScreens = buildScreenDescriptions(
      POC_ONBOARDING_SCREEN_IDS,
      PRIMARY_DEPLOYMENT,
    );

    const primaryResponder: MockResponder = (
      _request: LlmGenerationRequest,
      attempt: number,
    ) =>
      buildSuccessResult(
        { screens: visualScreens },
        PRIMARY_DEPLOYMENT,
        attempt,
      );

    // testGeneration responder: returns synthesized cases built from intent.
    // The harness builds its own synthesized list internally; the mock must
    // return a GeneratedTestCaseList. We return an empty-shell success and
    // let the harness's own synthesize path drive the assertions — the mock
    // client is called with the pre-synthesized list as content.
    const tgResponder: MockResponder = (
      _request: LlmGenerationRequest,
      attempt: number,
    ) =>
      buildSuccessResult(
        // The harness synthesizes and passes the list to the mock as content
        // via its internal responder override; here we use a minimal valid shell
        // that the harness replaces internally. Since runWave1Poc builds its own
        // mockClient (not from the bundle), the bundle's testGeneration is only
        // used for the image-payload assertion path. Any success content works.
        {
          schemaVersion: "1.0.0",
          jobId: "job-visual-happy",
          testCases: [],
        },
        "gpt-oss-120b-mock",
        attempt,
      );

    const bundle = createMockLlmGatewayClientBundle({
      testGeneration: {
        role: "test_generation",
        deployment: "gpt-oss-120b-mock",
        modelRevision: "gpt-oss-120b-mock@test",
        gatewayRelease: "mock",
        declaredCapabilities: TEST_GENERATION_CAPS,
        responder: tgResponder,
      },
      visualPrimary: {
        role: "visual_primary",
        deployment: PRIMARY_DEPLOYMENT,
        modelRevision: `${PRIMARY_DEPLOYMENT}@test`,
        gatewayRelease: "mock",
        declaredCapabilities: VISUAL_CAPS,
        responder: primaryResponder,
      },
      visualFallback: {
        role: "visual_fallback",
        deployment: FALLBACK_DEPLOYMENT,
        modelRevision: `${FALLBACK_DEPLOYMENT}@test`,
        gatewayRelease: "mock",
        declaredCapabilities: VISUAL_CAPS,
        // fallback is wired but must never be called on the happy path
        responder: (_req: LlmGenerationRequest, attempt: number) => {
          throw new Error(
            `visualFallback must not be called on happy path (attempt ${attempt})`,
          );
        },
      },
    });

    const result = await runWave1Poc({
      fixtureId: FIXTURE_ID,
      jobId: "job-visual-happy",
      generatedAt: GENERATED_AT,
      runDir,
      visualCaptures: captures,
      bundle,
    });

    // --- visualSidecar outcome ---
    assert.ok(result.visualSidecar !== undefined);
    assert.equal(result.visualSidecar.outcome, "success");
    if (result.visualSidecar.outcome !== "success") return;
    assert.equal(result.visualSidecar.selectedDeployment, PRIMARY_DEPLOYMENT);
    assert.equal(result.visualSidecar.fallbackReason, "none");

    // --- manifest invariants ---
    assert.equal(result.manifest.rawScreenshotsIncluded, false);
    assert.equal(result.manifest.imagePayloadSentToTestGeneration, false);
    assert.equal(
      result.manifest.modelDeployments.visualPrimary,
      PRIMARY_DEPLOYMENT,
    );
    assert.equal(
      result.manifest.modelDeployments.visualFallback,
      FALLBACK_DEPLOYMENT,
    );

    // --- visual-sidecar-result.json artifact on disk ---
    const sidecarArtifactPath = join(
      runDir,
      VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME,
    );
    const sidecarStat = await stat(sidecarArtifactPath);
    assert.ok(sidecarStat.isFile());
    assert.ok(sidecarStat.size > 0);

    // --- manifest attests the visual-sidecar-result artifact ---
    const manifestEntry = result.manifest.artifacts.find(
      (a) => a.filename === VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME,
    );
    assert.ok(
      manifestEntry !== undefined,
      "manifest must contain visual-sidecar-result entry",
    );
    assert.match(
      manifestEntry.sha256,
      /^[0-9a-f]{64}$/,
      "sha256 must be a 64-char hex string",
    );
    assert.ok(manifestEntry.bytes > 0, "bytes must be non-zero");
    assert.equal(
      result.manifest.visualSidecar?.resultArtifactSha256,
      manifestEntry.sha256,
    );
    assert.deepEqual(result.manifest.visualSidecar, {
      selectedDeployment: PRIMARY_DEPLOYMENT,
      fallbackReason: "none",
      confidenceSummary: result.visualSidecar.confidenceSummary,
      resultArtifactSha256: manifestEntry.sha256,
    });

    // --- testGeneration recorded requests carry no image payloads ---
    // The harness's internal mockClient is what actually calls testGeneration.
    // The bundle's testGeneration client is used for the image-payload assertion
    // path; per harness source it calls assertNoImagePayloadToTestGeneration on
    // the bundle when bundle.testGeneration.recordedRequests is available.
    // We verify via the result that the manifest confirms no image was sent.
    assert.equal(result.manifest.imagePayloadSentToTestGeneration, false);

    // --- validation pipeline ran and produced standard artifacts ---
    const requiredArtifacts = [
      GENERATED_TESTCASES_ARTIFACT_FILENAME,
      TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME,
      TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME,
      TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME,
      VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME,
    ];
    for (const filename of requiredArtifacts) {
      const artifactStat = await stat(join(runDir, filename));
      assert.ok(
        artifactStat.isFile() && artifactStat.size > 0,
        `${filename} must exist and be non-empty`,
      );
    }

    // --- generated test cases were produced ---
    assert.ok(
      result.generatedList.testCases.length > 0,
      "generatedList must be non-empty",
    );

    // --- export pipeline ran ---
    assert.equal(result.exportArtifacts.refused, false);
  } finally {
    await cleanupRunDir(runDir);
  }
});

// ---------------------------------------------------------------------------
// Test 2: Visual sidecar fallback during runWave1Poc
// ---------------------------------------------------------------------------

test("poc-harness visualCaptures: fallback path — primary timeout, fallback succeeds", async () => {
  const runDir = await newRunDir();
  try {
    const { captures } = await loadWave1PocCaptureFixture(FIXTURE_ID);

    const visualScreensFallback = buildScreenDescriptions(
      POC_ONBOARDING_SCREEN_IDS,
      FALLBACK_DEPLOYMENT,
    );

    const primaryResponder: MockResponder = (
      _request: LlmGenerationRequest,
      attempt: number,
    ): LlmGenerationResult => ({
      outcome: "error",
      errorClass: "timeout",
      message: "primary timed out",
      retryable: true,
      attempt,
    });

    const fallbackResponder: MockResponder = (
      _request: LlmGenerationRequest,
      attempt: number,
    ) =>
      buildSuccessResult(
        { screens: visualScreensFallback },
        FALLBACK_DEPLOYMENT,
        attempt,
      );

    const bundle = createMockLlmGatewayClientBundle({
      testGeneration: {
        role: "test_generation",
        deployment: "gpt-oss-120b-mock",
        modelRevision: "gpt-oss-120b-mock@test",
        gatewayRelease: "mock",
        declaredCapabilities: TEST_GENERATION_CAPS,
      },
      visualPrimary: {
        role: "visual_primary",
        deployment: PRIMARY_DEPLOYMENT,
        modelRevision: `${PRIMARY_DEPLOYMENT}@test`,
        gatewayRelease: "mock",
        declaredCapabilities: VISUAL_CAPS,
        responder: primaryResponder,
      },
      visualFallback: {
        role: "visual_fallback",
        deployment: FALLBACK_DEPLOYMENT,
        modelRevision: `${FALLBACK_DEPLOYMENT}@test`,
        gatewayRelease: "mock",
        declaredCapabilities: VISUAL_CAPS,
        responder: fallbackResponder,
      },
    });

    const result = await runWave1Poc({
      fixtureId: FIXTURE_ID,
      jobId: "job-visual-fallback",
      generatedAt: GENERATED_AT,
      runDir,
      visualCaptures: captures,
      bundle,
    });

    // --- fallbackReason recorded ---
    assert.ok(result.visualSidecar !== undefined);
    assert.equal(result.visualSidecar.outcome, "success");
    if (result.visualSidecar.outcome !== "success") return;
    assert.equal(result.visualSidecar.fallbackReason, "primary_unavailable");
    assert.equal(result.visualSidecar.selectedDeployment, FALLBACK_DEPLOYMENT);
    assert.equal(
      result.manifest.modelDeployments.visualPrimary,
      PRIMARY_DEPLOYMENT,
    );
    assert.equal(
      result.manifest.modelDeployments.visualFallback,
      FALLBACK_DEPLOYMENT,
    );
    assert.equal(
      result.manifest.visualSidecar?.selectedDeployment,
      FALLBACK_DEPLOYMENT,
    );
    assert.equal(
      result.manifest.visualSidecar?.fallbackReason,
      "primary_unavailable",
    );

    // --- run still completed end-to-end ---
    assert.ok(result.generatedList.testCases.length > 0);
    assert.equal(result.exportArtifacts.refused, false);

    // --- validation pipeline ran ---
    const validationReportPath = join(
      runDir,
      TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME,
    );
    const validationStat = await stat(validationReportPath);
    assert.ok(validationStat.isFile() && validationStat.size > 0);
  } finally {
    await cleanupRunDir(runDir);
  }
});

test("poc-harness visualCaptures: FinOps image byte budget fails closed before sidecar calls", async () => {
  const runDir = await newRunDir();
  try {
    const { captures } = await loadWave1PocCaptureFixture(FIXTURE_ID);
    const decodedImageBytes = captures.reduce(
      (total, capture) =>
        total + Buffer.byteLength(capture.base64Data, "base64"),
      0,
    );
    const largestImageBytes = Math.max(
      ...captures.map((capture) =>
        Buffer.byteLength(capture.base64Data, "base64"),
      ),
    );
    const aggregateOnlyThreshold = largestImageBytes + 1;
    assert.ok(decodedImageBytes > aggregateOnlyThreshold);

    const bundle = createMockLlmGatewayClientBundle({
      testGeneration: {
        role: "test_generation",
        deployment: "gpt-oss-120b-mock",
        modelRevision: "gpt-oss-120b-mock@test",
        gatewayRelease: "mock",
        declaredCapabilities: TEST_GENERATION_CAPS,
      },
      visualPrimary: {
        role: "visual_primary",
        deployment: PRIMARY_DEPLOYMENT,
        modelRevision: `${PRIMARY_DEPLOYMENT}@test`,
        gatewayRelease: "mock",
        declaredCapabilities: VISUAL_CAPS,
        responder: () => {
          throw new Error(
            "primary must not be called after image budget breach",
          );
        },
      },
      visualFallback: {
        role: "visual_fallback",
        deployment: FALLBACK_DEPLOYMENT,
        modelRevision: `${FALLBACK_DEPLOYMENT}@test`,
        gatewayRelease: "mock",
        declaredCapabilities: VISUAL_CAPS,
        responder: () => {
          throw new Error(
            "fallback must not be called after image budget breach",
          );
        },
      },
    });

    await assert.rejects(
      runWave1Poc({
        fixtureId: FIXTURE_ID,
        jobId: "job-visual-finops-image-budget",
        generatedAt: GENERATED_AT,
        runDir,
        visualCaptures: captures,
        bundle,
        finopsBudget: {
          budgetId: "test-tight-image",
          budgetVersion: "1.0.0",
          roles: {
            visual_primary: {
              maxImageBytesPerRequest: aggregateOnlyThreshold,
            },
            visual_fallback: {
              maxImageBytesPerRequest: aggregateOnlyThreshold,
            },
          },
        },
      }),
      Wave1PocVisualSidecarFailureError,
    );

    assert.equal(
      (bundle.visualPrimary as { callCount: () => number }).callCount(),
      0,
    );
    assert.equal(
      (bundle.visualFallback as { callCount: () => number }).callCount(),
      0,
    );

    const rawReport = await readFile(
      join(
        runDir,
        FINOPS_ARTIFACT_DIRECTORY,
        FINOPS_BUDGET_REPORT_ARTIFACT_FILENAME,
      ),
      "utf8",
    );
    const report = JSON.parse(rawReport) as FinOpsBudgetReport;
    assert.equal(report.outcome, "budget_exceeded");
    assert.equal(report.rawScreenshotsIncluded, false);
    assert.equal(report.totals.attempts, 0);
    assert.deepEqual(report.breaches, [
      {
        rule: "max_image_bytes",
        role: "visual_primary",
        observed: decodedImageBytes,
        threshold: aggregateOnlyThreshold,
        message: `visual_primary decoded image bytes ${decodedImageBytes} exceeds maxImageBytesPerRequest ${aggregateOnlyThreshold}`,
      },
    ]);
  } finally {
    await cleanupRunDir(runDir);
  }
});

// ---------------------------------------------------------------------------
// Test 3: Invalid sidecar JSON — harness aborts cleanly (AC2 / AC5 invariant)
// ---------------------------------------------------------------------------

test("poc-harness visualCaptures: invalid sidecar JSON — harness throws, no test cases produced", async () => {
  const runDir = await newRunDir();
  try {
    const { captures } = await loadWave1PocCaptureFixture(FIXTURE_ID);

    const invalidResponder =
      (deployment: typeof PRIMARY_DEPLOYMENT | typeof FALLBACK_DEPLOYMENT) =>
      (_request: LlmGenerationRequest, attempt: number): LlmGenerationResult =>
        buildSuccessResult("{bad json", deployment, attempt);

    const bundle = createMockLlmGatewayClientBundle({
      testGeneration: {
        role: "test_generation",
        deployment: "gpt-oss-120b-mock",
        modelRevision: "gpt-oss-120b-mock@test",
        gatewayRelease: "mock",
        declaredCapabilities: TEST_GENERATION_CAPS,
      },
      visualPrimary: {
        role: "visual_primary",
        deployment: PRIMARY_DEPLOYMENT,
        modelRevision: `${PRIMARY_DEPLOYMENT}@test`,
        gatewayRelease: "mock",
        declaredCapabilities: VISUAL_CAPS,
        responder: invalidResponder(PRIMARY_DEPLOYMENT),
      },
      visualFallback: {
        role: "visual_fallback",
        deployment: FALLBACK_DEPLOYMENT,
        modelRevision: `${FALLBACK_DEPLOYMENT}@test`,
        gatewayRelease: "mock",
        declaredCapabilities: VISUAL_CAPS,
        responder: invalidResponder(FALLBACK_DEPLOYMENT),
      },
    });

    await assert.rejects(
      () =>
        runWave1Poc({
          fixtureId: FIXTURE_ID,
          jobId: "job-visual-invalid-json",
          generatedAt: GENERATED_AT,
          runDir,
          visualCaptures: captures,
          bundle,
        }),
      (err: unknown) => {
        assert.ok(
          err instanceof Wave1PocVisualSidecarFailureError,
          "must throw a structured visual-sidecar failure error",
        );
        assert.equal(err.visualSidecar.outcome, "failure");
        assert.equal(err.visualSidecar.failureClass, "schema_invalid_response");
        return true;
      },
    );

    const sidecarArtifactRaw = await readFile(
      join(runDir, VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME),
      "utf8",
    );
    const sidecarArtifact = JSON.parse(sidecarArtifactRaw) as {
      result: { outcome: string; failureClass?: string; attempts?: unknown[] };
      rawScreenshotsIncluded: boolean;
    };
    assert.equal(sidecarArtifact.result.outcome, "failure");
    assert.equal(
      sidecarArtifact.result.failureClass,
      "schema_invalid_response",
    );
    assert.equal(sidecarArtifact.result.attempts?.length, 2);
    assert.equal(sidecarArtifact.rawScreenshotsIncluded, false);
    await assertFailureManifestAttestsSidecar(runDir);

    await assert.rejects(
      () => readFile(join(runDir, GENERATED_TESTCASES_ARTIFACT_FILENAME)),
      (err: unknown) => {
        assert.ok(
          typeof err === "object" &&
            err !== null &&
            (err as { code?: string }).code === "ENOENT",
          "generated-testcases.json must not exist when sidecar JSON is invalid",
        );
        return true;
      },
    );
  } finally {
    await cleanupRunDir(runDir);
  }
});

// ---------------------------------------------------------------------------
// Test 4: Both visual sidecars fail — harness aborts cleanly (AC5 invariant)
// ---------------------------------------------------------------------------

test("poc-harness visualCaptures: both sidecars fail — harness throws, no test cases produced", async () => {
  const runDir = await newRunDir();
  try {
    const { captures } = await loadWave1PocCaptureFixture(FIXTURE_ID);

    const errorResponder =
      (errorClass: "timeout" | "transport"): MockResponder =>
      (
        _request: LlmGenerationRequest,
        attempt: number,
      ): LlmGenerationResult => ({
        outcome: "error",
        errorClass,
        message: `${errorClass} error`,
        retryable: true,
        attempt,
      });

    const bundle = createMockLlmGatewayClientBundle({
      testGeneration: {
        role: "test_generation",
        deployment: "gpt-oss-120b-mock",
        modelRevision: "gpt-oss-120b-mock@test",
        gatewayRelease: "mock",
        declaredCapabilities: TEST_GENERATION_CAPS,
      },
      visualPrimary: {
        role: "visual_primary",
        deployment: PRIMARY_DEPLOYMENT,
        modelRevision: `${PRIMARY_DEPLOYMENT}@test`,
        gatewayRelease: "mock",
        declaredCapabilities: VISUAL_CAPS,
        responder: errorResponder("timeout"),
      },
      visualFallback: {
        role: "visual_fallback",
        deployment: FALLBACK_DEPLOYMENT,
        modelRevision: `${FALLBACK_DEPLOYMENT}@test`,
        gatewayRelease: "mock",
        declaredCapabilities: VISUAL_CAPS,
        responder: errorResponder("transport"),
      },
    });

    // The harness throws when both sidecars are exhausted (see poc-harness.ts
    // lines ~684-689: sidecarResult.outcome === "failure" → throw Error).
    await assert.rejects(
      () =>
        runWave1Poc({
          fixtureId: FIXTURE_ID,
          jobId: "job-visual-both-fail",
          generatedAt: GENERATED_AT,
          runDir,
          visualCaptures: captures,
          bundle,
        }),
      (err: unknown) => {
        assert.ok(
          err instanceof Wave1PocVisualSidecarFailureError,
          "must throw a structured visual-sidecar failure error",
        );
        assert.equal(err.visualSidecar.outcome, "failure");
        assert.equal(err.visualSidecar.failureClass, "both_sidecars_failed");
        // The error message references the both-failed condition.
        assert.match(
          err.message,
          /multimodal visual sidecar failed/,
          "error message must reference the sidecar failure",
        );
        return true;
      },
    );

    const sidecarArtifactRaw = await readFile(
      join(runDir, VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME),
      "utf8",
    );
    const sidecarArtifact = JSON.parse(sidecarArtifactRaw) as {
      result: { outcome: string; failureClass?: string; attempts?: unknown[] };
      rawScreenshotsIncluded: boolean;
    };
    assert.equal(sidecarArtifact.result.outcome, "failure");
    assert.equal(sidecarArtifact.result.failureClass, "both_sidecars_failed");
    assert.equal(sidecarArtifact.result.attempts?.length, 2);
    assert.equal(sidecarArtifact.rawScreenshotsIncluded, false);
    await assertFailureManifestAttestsSidecar(runDir);

    const finopsReport = JSON.parse(
      await readFile(
        join(
          runDir,
          FINOPS_ARTIFACT_DIRECTORY,
          FINOPS_BUDGET_REPORT_ARTIFACT_FILENAME,
        ),
        "utf8",
      ),
    ) as FinOpsBudgetReport;
    assert.equal(finopsReport.outcome, "visual_sidecar_failed");
    assert.equal(finopsReport.budget.budgetId, "default-permissive");
    assert.equal(finopsReport.totals.attempts, 2);

    // AC5 invariant: NO downstream test cases may be silently generated when
    // both sidecars fail. The harness short-circuits before the LLM
    // test-generation call, so the generated-testcases artifact must not exist.
    const generatedTestCasesPath = join(
      runDir,
      GENERATED_TESTCASES_ARTIFACT_FILENAME,
    );
    await assert.rejects(
      () => readFile(generatedTestCasesPath),
      (err: unknown) => {
        assert.ok(
          typeof err === "object" &&
            err !== null &&
            (err as { code?: string }).code === "ENOENT",
          "generated-testcases.json must not exist when both sidecars fail",
        );
        return true;
      },
    );
  } finally {
    await cleanupRunDir(runDir);
  }
});
