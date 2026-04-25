/**
 * Wave 1 POC harness (Issue #1366).
 *
 * Runs the full Figma-to-Test chain end-to-end against an air-gapped
 * mock LLM, persists every artifact in a deterministic `runDir`, builds
 * an evidence manifest, and returns the in-memory bundle so callers can
 * gate further work on the run result.
 *
 * The 10 chain steps exercised here mirror the issue spec one-for-one:
 *
 *   1. Load a local Figma fixture + companion visual sidecar.
 *   2. Derive Business Test Intent IR (deterministic, redacted).
 *   3. PII redaction is performed inside derivation; the harness asserts
 *      no original PII substrings survive into persisted artifacts.
 *   4. Compile a redacted prompt request.
 *   5. Issue the request through a deterministic mock LLM bundle —
 *      `gpt-oss-120b-mock` for test_generation,
 *      `llama-4-maverick-vision` (mocked) for visual_sidecar_primary.
 *      The structured output is byte-stable per fixture.
 *   6. Parse the structured output into a `GeneratedTestCaseList`.
 *   7. Run the validation pipeline (validation + duplicates + coverage +
 *      policy + visual sidecar gate). Persist all reports.
 *   8. Seed the file-system review store from the policy report and
 *      record an `approved` event for every case the policy auto-approved.
 *   9. Run the export pipeline against the resulting review snapshot.
 *      Refused runs still emit `export-report.json` documenting why.
 *  10. Build and persist the evidence manifest with sha256 hashes of
 *      every emitted artifact, plus the prompt/schema/model identities.
 *
 * The harness is the SOLE entry point used by the `test:ti-eval` gate
 * and by the integration tests; all determinism guarantees flow from it.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  EXPORT_REPORT_ARTIFACT_FILENAME,
  EXPORT_TESTCASES_ALM_XML_ARTIFACT_FILENAME,
  EXPORT_TESTCASES_CSV_ARTIFACT_FILENAME,
  EXPORT_TESTCASES_JSON_ARTIFACT_FILENAME,
  GENERATED_TESTCASES_ARTIFACT_FILENAME,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  QC_MAPPING_PREVIEW_ARTIFACT_FILENAME,
  REDACTION_POLICY_VERSION,
  REVIEW_EVENTS_ARTIFACT_FILENAME,
  REVIEW_GATE_SCHEMA_VERSION,
  REVIEW_STATE_ARTIFACT_FILENAME,
  TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME,
  type BusinessTestIntentIr,
  type CompiledPromptArtifacts,
  type CompiledPromptRequest,
  type GeneratedTestCase,
  type GeneratedTestCaseAuditMetadata,
  type GeneratedTestCaseList,
  type LlmGenerationRequest,
  type LlmGenerationResult,
  type ReviewEvent,
  type ReviewGateSnapshot,
  type ReviewSnapshot,
  type ReviewState,
  type TestCaseLevel,
  type TestCasePolicyDecision,
  type TestCasePolicyProfile,
  type TestCasePriority,
  type TestCaseRiskCategory,
  type TestCaseTechnique29119,
  type TestCaseType,
  type VisualScreenDescription,
  type Wave1PocEvidenceManifest,
  type Wave1PocFixtureId,
} from "../contracts/index.js";
import type { ExportPipelineArtifacts } from "./export-pipeline.js";
import type { ValidationPipelineArtifacts } from "./validation-pipeline.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import {
  buildWave1PocEvidenceManifest,
  writeWave1PocEvidenceManifest,
} from "./evidence-manifest.js";
import { runAndPersistExportPipeline } from "./export-pipeline.js";
import { deriveBusinessTestIntentIr } from "./intent-derivation.js";
import { createMockLlmGatewayClient } from "./llm-mock-gateway.js";
import { loadWave1PocFixture } from "./poc-fixtures.js";
import { cloneOpenTextAlmReferenceProfile } from "./qc-mapping.js";
import { compilePrompt } from "./prompt-compiler.js";
import { cloneEuBankingDefaultProfile } from "./policy-profile.js";
import {
  seedReviewStateFromPolicy,
  transitionReviewState,
} from "./review-state-machine.js";
import { runValidationPipeline } from "./validation-pipeline.js";

const TEST_GENERATION_DEPLOYMENT = "gpt-oss-120b-mock";
const TEST_GENERATION_MODEL_REVISION = "gpt-oss-120b-2026-04-25";
const TEST_GENERATION_GATEWAY_RELEASE = "wave1-poc-mock";
const VISUAL_PRIMARY_DEPLOYMENT = "llama-4-maverick-vision";
const POLICY_BUNDLE_VERSION = "wave1-poc";
export const BUSINESS_INTENT_IR_ARTIFACT_FILENAME =
  "business-intent-ir.json" as const;
export const COMPILED_PROMPT_ARTIFACT_FILENAME =
  "compiled-prompt.json" as const;
export const GATEWAY_REQUEST_AUDIT_ARTIFACT_FILENAME =
  "gateway-request-audit.json" as const;

interface GatewayRequestAuditArtifact {
  schemaVersion: "1.0.0";
  jobId: string;
  role: "test_generation";
  deployment: string;
  modelRevision: string;
  gatewayRelease: string;
  requestCount: number;
  imageInputCounts: number[];
  imagePayloadSent: false;
  promptHash: string;
  schemaHash: string;
  inputHash: string;
  cacheKeyDigest: string;
}

export interface RunWave1PocInput {
  fixtureId: Wave1PocFixtureId;
  jobId: string;
  /** ISO-8601 timestamp stamped onto every artifact. */
  generatedAt: string;
  /** Run directory (created recursively). */
  runDir: string;
  /** Optional override for the eu-banking-default profile. */
  policyProfile?: TestCasePolicyProfile;
}

export interface Wave1PocRunResult {
  fixtureId: Wave1PocFixtureId;
  jobId: string;
  generatedAt: string;
  runDir: string;
  intent: BusinessTestIntentIr;
  visual: VisualScreenDescription[];
  compiledPrompt: {
    request: CompiledPromptRequest;
    artifacts: CompiledPromptArtifacts;
  };
  generatedList: GeneratedTestCaseList;
  validation: ValidationPipelineArtifacts;
  reviewSnapshot: ReviewGateSnapshot;
  exportArtifacts: ExportPipelineArtifacts;
  manifest: Wave1PocEvidenceManifest;
  /**
   * Sorted list of artifact filenames the manifest attests, for callers
   * that want to assert on artifact identity without re-reading the
   * manifest.
   */
  artifactFilenames: string[];
}

/**
 * Build a deterministic `GeneratedTestCaseList` from a Business Test
 * Intent IR. The function is the source of truth for what a "good"
 * Wave 1 mock-LLM response looks like for a given intent: it covers
 * each detected field, action, validation, and navigation edge with at
 * least one targeted case, plus one accessibility case per screen with
 * form fields. The output is fully redacted (the IR already carries
 * `[REDACTED:*]` placeholders) and trace-stamped.
 *
 * Exported so the eval-gate tests can compute "expected" coverage
 * without re-running the harness end-to-end.
 */
export const synthesizeGeneratedTestCases = (input: {
  jobId: string;
  generatedAt: string;
  intent: BusinessTestIntentIr;
  audit: GeneratedTestCaseAuditMetadata;
}): GeneratedTestCaseList => {
  const cases: GeneratedTestCase[] = [];

  const screenIdsWithFields = new Set(
    input.intent.detectedFields.map((f) => f.screenId),
  );
  const validationsByField = new Map<string, string[]>();
  for (const v of input.intent.detectedValidations) {
    if (v.targetFieldId === undefined) continue;
    const existing = validationsByField.get(v.targetFieldId) ?? [];
    existing.push(v.id);
    validationsByField.set(v.targetFieldId, existing);
  }

  for (const field of input.intent.detectedFields) {
    cases.push(
      buildSyntheticCase({
        idSuffix: `field-functional-${stableSlug(field.id)}`,
        title: `Submit valid ${field.label} on ${field.screenId}`,
        objective: `Confirm the ${field.label} field accepts a valid value.`,
        type: "functional",
        priority: "p1",
        riskCategory: deriveRiskCategoryForLabel(field.label),
        technique: "use_case",
        coveredFieldIds: [field.id],
        coveredActionIds: actionIdsForScreen(input.intent, field.screenId),
        coveredValidationIds: [],
        coveredNavigationIds: [],
        screenId: field.screenId,
        ...(field.trace.nodeId !== undefined
          ? { traceNodeId: field.trace.nodeId }
          : {}),
        ...(field.trace.nodeName !== undefined
          ? { traceNodeName: field.trace.nodeName }
          : {}),
        steps: [
          {
            index: 1,
            action: `Open the ${input.intent.screens.find((s) => s.screenId === field.screenId)?.screenName ?? field.screenId} screen`,
          },
          {
            index: 2,
            action: `Provide a valid ${field.label} value`,
          },
          {
            index: 3,
            action: "Submit the form",
            expected: "The next screen is reachable",
          },
        ],
        expectedResults: [
          `${field.label} is accepted`,
          "The next screen is reachable",
        ],
        ...stampAudit(input),
      }),
    );

    const validationIds = validationsByField.get(field.id) ?? [];
    if (validationIds.length > 0) {
      cases.push(
        buildSyntheticCase({
          idSuffix: `field-negative-${stableSlug(field.id)}`,
          title: `Reject empty ${field.label} on ${field.screenId}`,
          objective: `Confirm the form rejects an empty ${field.label}.`,
          type: "negative",
          priority: "p1",
          riskCategory: deriveRiskCategoryForLabel(field.label),
          technique: "equivalence_partitioning",
          coveredFieldIds: [field.id],
          coveredActionIds: actionIdsForScreen(input.intent, field.screenId),
          coveredValidationIds: validationIds,
          coveredNavigationIds: [],
          screenId: field.screenId,
          ...(field.trace.nodeId !== undefined
            ? { traceNodeId: field.trace.nodeId }
            : {}),
          ...(field.trace.nodeName !== undefined
            ? { traceNodeName: field.trace.nodeName }
            : {}),
          steps: [
            { index: 1, action: `Open the ${field.screenId} screen` },
            { index: 2, action: `Leave ${field.label} empty` },
            {
              index: 3,
              action: "Submit the form",
              expected: "An inline validation error is shown",
            },
          ],
          expectedResults: [
            `${field.label} is required`,
            "Submit is blocked until the rule is satisfied",
          ],
          ...stampAudit(input),
        }),
      );
      cases.push(
        buildSyntheticCase({
          idSuffix: `field-validation-${stableSlug(field.id)}`,
          title: `Validate ${field.label} rules on ${field.screenId}`,
          objective: `Confirm validation messages for ${field.label}.`,
          type: "validation",
          priority: "p1",
          riskCategory: deriveRiskCategoryForLabel(field.label),
          technique: "decision_table",
          coveredFieldIds: [field.id],
          coveredActionIds: [],
          coveredValidationIds: validationIds,
          coveredNavigationIds: [],
          screenId: field.screenId,
          ...(field.trace.nodeId !== undefined
            ? { traceNodeId: field.trace.nodeId }
            : {}),
          ...(field.trace.nodeName !== undefined
            ? { traceNodeName: field.trace.nodeName }
            : {}),
          steps: [
            { index: 1, action: `Open the ${field.screenId} screen` },
            {
              index: 2,
              action: `Provide an invalid ${field.label} value`,
              expected: "Inline validation error displayed",
            },
          ],
          expectedResults: [
            "Each validation rule is mapped to a clear message",
          ],
          ...stampAudit(input),
        }),
      );
      cases.push(
        buildSyntheticCase({
          idSuffix: `field-boundary-${stableSlug(field.id)}`,
          title: `Boundary lengths for ${field.label} on ${field.screenId}`,
          objective: `Probe the boundary lengths of the ${field.label} field.`,
          type: "boundary",
          priority: "p2",
          riskCategory: deriveRiskCategoryForLabel(field.label),
          technique: "boundary_value_analysis",
          coveredFieldIds: [field.id],
          coveredActionIds: [],
          coveredValidationIds: [],
          coveredNavigationIds: [],
          screenId: field.screenId,
          ...(field.trace.nodeId !== undefined
            ? { traceNodeId: field.trace.nodeId }
            : {}),
          ...(field.trace.nodeName !== undefined
            ? { traceNodeName: field.trace.nodeName }
            : {}),
          steps: [
            { index: 1, action: `Open the ${field.screenId} screen` },
            {
              index: 2,
              action: `Enter the minimum boundary value into ${field.label}`,
              expected: "Field accepts the minimum boundary value",
            },
            {
              index: 3,
              action: `Enter the maximum boundary value into ${field.label}`,
              expected: "Field accepts the maximum boundary value",
            },
          ],
          expectedResults: [
            "Min/max boundaries behave consistently with the validation rules",
          ],
          ...stampAudit(input),
        }),
      );
    }
  }

  for (const action of input.intent.detectedActions) {
    cases.push(
      buildSyntheticCase({
        idSuffix: `action-${stableSlug(action.id)}`,
        title: `Trigger ${action.label} on ${action.screenId}`,
        objective: `Confirm the ${action.label} control performs its action.`,
        type: "functional",
        priority: "p1",
        riskCategory: "low",
        technique: "use_case",
        coveredFieldIds: [],
        coveredActionIds: [action.id],
        coveredValidationIds: [],
        coveredNavigationIds: [],
        screenId: action.screenId,
        ...(action.trace.nodeId !== undefined
          ? { traceNodeId: action.trace.nodeId }
          : {}),
        ...(action.trace.nodeName !== undefined
          ? { traceNodeName: action.trace.nodeName }
          : {}),
        steps: [
          { index: 1, action: `Open the ${action.screenId} screen` },
          {
            index: 2,
            action: `Activate the ${action.label} control`,
            expected: "The control performs its action",
          },
        ],
        expectedResults: [`${action.label} performs its declared action`],
        ...stampAudit(input),
      }),
    );
  }

  for (const nav of input.intent.detectedNavigation) {
    cases.push(
      buildSyntheticCase({
        idSuffix: `navigation-${stableSlug(nav.id)}`,
        title: `Navigate from ${nav.screenId} to ${nav.targetScreenId}`,
        objective: `Confirm the navigation edge from ${nav.screenId} to ${nav.targetScreenId}.`,
        type: "navigation",
        priority: "p2",
        riskCategory: "low",
        technique: "state_transition",
        coveredFieldIds: [],
        coveredActionIds: [],
        coveredValidationIds: [],
        coveredNavigationIds: [nav.id],
        screenId: nav.screenId,
        ...(nav.trace.nodeId !== undefined
          ? { traceNodeId: nav.trace.nodeId }
          : {}),
        ...(nav.trace.nodeName !== undefined
          ? { traceNodeName: nav.trace.nodeName }
          : {}),
        steps: [
          { index: 1, action: `Open the ${nav.screenId} screen` },
          {
            index: 2,
            action: `Trigger the navigation to ${nav.targetScreenId}`,
            expected: `The ${nav.targetScreenId} screen is shown`,
          },
        ],
        expectedResults: [`${nav.targetScreenId} is reachable`],
        ...stampAudit(input),
      }),
    );
  }

  const a11yScreens = Array.from(screenIdsWithFields).sort();
  for (const screenId of a11yScreens) {
    const fieldIds = input.intent.detectedFields
      .filter((f) => f.screenId === screenId)
      .map((f) => f.id);
    cases.push(
      buildSyntheticCase({
        idSuffix: `a11y-${stableSlug(screenId)}`,
        title: `Accessibility check for ${screenId}`,
        objective: `Confirm keyboard and screen-reader accessibility on ${screenId}.`,
        type: "accessibility",
        priority: "p2",
        riskCategory: "low",
        technique: "exploratory",
        coveredFieldIds: fieldIds,
        coveredActionIds: actionIdsForScreen(input.intent, screenId),
        coveredValidationIds: [],
        coveredNavigationIds: [],
        screenId,
        traceNodeId: screenId,
        steps: [
          { index: 1, action: `Open the ${screenId} screen` },
          {
            index: 2,
            action: "Tab through every focusable control",
            expected: "Every control is reachable via keyboard",
          },
          {
            index: 3,
            action: "Inspect labels and ARIA attributes with a screen reader",
            expected: "Each control announces a meaningful label",
          },
        ],
        expectedResults: [
          "All controls reachable via keyboard",
          "Each control announces a meaningful label",
        ],
        ...stampAudit(input),
      }),
    );
  }

  cases.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    jobId: input.jobId,
    testCases: cases,
  };
};

const stableSlug = (input: string): string => {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
};

const deriveRiskCategoryForLabel = (label: string): TestCaseRiskCategory => {
  const normalised = label.toLowerCase();
  if (
    normalised.includes("iban") ||
    normalised.includes("bic") ||
    normalised.includes("amount") ||
    normalised.includes("authoriz") ||
    normalised.includes("authoris") ||
    normalised.includes("authentication code")
  ) {
    return "financial_transaction";
  }
  if (
    normalised.includes("tax id") ||
    normalised.includes("email") ||
    normalised.includes("phone") ||
    normalised.includes("name") ||
    normalised.includes("postcode") ||
    normalised.includes("[redacted")
  ) {
    return "regulated_data";
  }
  return "low";
};

const actionIdsForScreen = (
  intent: BusinessTestIntentIr,
  screenId: string,
): string[] => {
  return intent.detectedActions
    .filter((a) => a.screenId === screenId)
    .map((a) => a.id);
};

const stampAudit = (input: {
  audit: GeneratedTestCaseAuditMetadata;
}): { audit: GeneratedTestCaseAuditMetadata } => {
  return { audit: { ...input.audit } };
};

interface BuildSyntheticCaseInput {
  idSuffix: string;
  title: string;
  objective: string;
  type: TestCaseType;
  priority: TestCasePriority;
  riskCategory: TestCaseRiskCategory;
  technique: TestCaseTechnique29119;
  coveredFieldIds: string[];
  coveredActionIds: string[];
  coveredValidationIds: string[];
  coveredNavigationIds: string[];
  screenId: string;
  traceNodeId?: string;
  traceNodeName?: string;
  steps: GeneratedTestCase["steps"];
  expectedResults: string[];
  audit: GeneratedTestCaseAuditMetadata;
}

const buildSyntheticCase = (
  input: BuildSyntheticCaseInput,
): GeneratedTestCase => {
  const id = `tc-${input.idSuffix}`;
  const level: TestCaseLevel = "system";
  const figmaTraceRefs: GeneratedTestCase["figmaTraceRefs"] = [
    {
      screenId: input.screenId,
      ...(input.traceNodeId !== undefined ? { nodeId: input.traceNodeId } : {}),
      ...(input.traceNodeName !== undefined
        ? { nodeName: input.traceNodeName }
        : {}),
    },
  ];
  return {
    id,
    sourceJobId: input.audit.jobId,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    title: input.title,
    objective: input.objective,
    level,
    type: input.type,
    priority: input.priority,
    riskCategory: input.riskCategory,
    technique: input.technique,
    preconditions: [],
    testData: [],
    steps: input.steps,
    expectedResults: input.expectedResults,
    figmaTraceRefs,
    assumptions: [],
    openQuestions: [],
    qcMappingPreview: { exportable: true },
    qualitySignals: {
      coveredFieldIds: input.coveredFieldIds.slice().sort(),
      coveredActionIds: input.coveredActionIds.slice().sort(),
      coveredValidationIds: input.coveredValidationIds.slice().sort(),
      coveredNavigationIds: input.coveredNavigationIds.slice().sort(),
      confidence: 0.9,
    },
    reviewState: "auto_approved",
    audit: input.audit,
  };
};

const buildAuditMetadata = (input: {
  jobId: string;
  generatedAt: string;
  cacheKeyDigest: string;
  inputHash: string;
  promptHash: string;
  schemaHash: string;
}): GeneratedTestCaseAuditMetadata => ({
  jobId: input.jobId,
  generatedAt: input.generatedAt,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  redactionPolicyVersion: REDACTION_POLICY_VERSION,
  visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
  cacheHit: false,
  cacheKey: input.cacheKeyDigest,
  inputHash: input.inputHash,
  promptHash: input.promptHash,
  schemaHash: input.schemaHash,
});

/** Run a single Wave 1 POC fixture end-to-end. */
export const runWave1Poc = async (
  input: RunWave1PocInput,
): Promise<Wave1PocRunResult> => {
  await mkdir(input.runDir, { recursive: true });

  // 1. Load fixture.
  const fixture = await loadWave1PocFixture(input.fixtureId);

  // 2. Derive Business Test Intent IR. (Step 3 — PII redaction — happens
  //    inside derivation; the harness later asserts the absence of raw
  //    PII substrings in persisted artifacts via tests.)
  const intent = deriveBusinessTestIntentIr({
    figma: fixture.figma,
    visual: fixture.visual,
  });

  // 4. Compile prompt.
  const compiled = compilePrompt({
    jobId: input.jobId,
    intent,
    visual: fixture.visual,
    modelBinding: {
      modelRevision: TEST_GENERATION_MODEL_REVISION,
      gatewayRelease: TEST_GENERATION_GATEWAY_RELEASE,
    },
    policyBundleVersion: POLICY_BUNDLE_VERSION,
    visualBinding: {
      schemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
      selectedDeployment: VISUAL_PRIMARY_DEPLOYMENT,
      fallbackReason: "none",
      screenCount: fixture.visual.length,
      ...(fixture.visualImageSha256 !== undefined
        ? { fixtureImageHash: fixture.visualImageSha256 }
        : {}),
    },
  });

  // Build the audit stamp the synthesised list will carry on every case.
  const audit = buildAuditMetadata({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    cacheKeyDigest: compiled.request.hashes.cacheKey,
    inputHash: compiled.request.hashes.inputHash,
    promptHash: compiled.request.hashes.promptHash,
    schemaHash: compiled.request.hashes.schemaHash,
  });

  const expectedList = synthesizeGeneratedTestCases({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    intent,
    audit,
  });

  // 5. Issue the request through a deterministic mock LLM. The
  //    responder hands back the already-synthesised list as the
  //    structured-output `content`. The mock client rejects image
  //    payloads at runtime via its image-payload guard; the harness
  //    additionally asserts after the call that NO image inputs were
  //    seen (the structured generator must never receive images).
  const mockClient = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: TEST_GENERATION_DEPLOYMENT,
    modelRevision: TEST_GENERATION_MODEL_REVISION,
    gatewayRelease: TEST_GENERATION_GATEWAY_RELEASE,
    responder: (
      _request: LlmGenerationRequest,
      attempt: number,
    ): LlmGenerationResult => ({
      outcome: "success",
      content: expectedList,
      finishReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0 },
      modelDeployment: TEST_GENERATION_DEPLOYMENT,
      modelRevision: TEST_GENERATION_MODEL_REVISION,
      gatewayRelease: TEST_GENERATION_GATEWAY_RELEASE,
      attempt,
    }),
  });

  const result = await mockClient.generate({
    jobId: compiled.request.jobId,
    systemPrompt: compiled.request.systemPrompt,
    userPrompt: compiled.request.userPrompt,
    responseSchema: compiled.request.responseSchema,
    responseSchemaName: compiled.request.responseSchemaName,
  });
  if (result.outcome !== "success") {
    throw new Error(
      `runWave1Poc: mock LLM returned a failure (${result.errorClass}: ${result.message})`,
    );
  }

  // 6. Parse / accept the structured output. The mock returns the
  //    already-typed list; in a live setting the gateway wire format
  //    would be JSON we would re-parse here.
  const generatedList = result.content as GeneratedTestCaseList;

  // Defence-in-depth: confirm the recorded request the mock saw did
  // not carry image inputs. The mock strips bytes during recording, but
  // it preserves shape — `recordedRequests()[0].imageInputs` would be a
  // non-empty array if the caller had attached images.
  const recordedRequests = mockClient.recordedRequests();
  for (const request of recordedRequests) {
    if (request.imageInputs !== undefined && request.imageInputs.length > 0) {
      throw new Error(
        "runWave1Poc: the test_generation gateway must never receive image payloads",
      );
    }
  }

  const gatewayRequestAudit: GatewayRequestAuditArtifact = {
    schemaVersion: "1.0.0",
    jobId: input.jobId,
    role: "test_generation",
    deployment: TEST_GENERATION_DEPLOYMENT,
    modelRevision: TEST_GENERATION_MODEL_REVISION,
    gatewayRelease: TEST_GENERATION_GATEWAY_RELEASE,
    requestCount: recordedRequests.length,
    imageInputCounts: recordedRequests.map((request) =>
      request.imageInputs?.length ?? 0,
    ),
    imagePayloadSent: false,
    promptHash: compiled.request.hashes.promptHash,
    schemaHash: compiled.request.hashes.schemaHash,
    inputHash: compiled.request.hashes.inputHash,
    cacheKeyDigest: compiled.request.hashes.cacheKey,
  };

  const intentBytes = utf8(canonicalJson(intent));
  const compiledPromptBytes = utf8(canonicalJson(compiled.artifacts));
  const gatewayRequestAuditBytes = utf8(canonicalJson(gatewayRequestAudit));
  await Promise.all([
    writeAtomic(
      join(input.runDir, BUSINESS_INTENT_IR_ARTIFACT_FILENAME),
      intentBytes,
    ),
    writeAtomic(
      join(input.runDir, COMPILED_PROMPT_ARTIFACT_FILENAME),
      compiledPromptBytes,
    ),
    writeAtomic(
      join(input.runDir, GATEWAY_REQUEST_AUDIT_ARTIFACT_FILENAME),
      gatewayRequestAuditBytes,
    ),
  ]);

  // 7. Validation pipeline + persist its artifacts.
  const profile = input.policyProfile ?? cloneEuBankingDefaultProfile();
  const validation = runValidationPipeline({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    list: generatedList,
    intent,
    visual: fixture.visual,
    profile,
    primaryVisualDeployment: VISUAL_PRIMARY_DEPLOYMENT,
  });
  const validationDir = input.runDir;
  // Serialize/persist directly so the harness controls the on-disk
  // byte stream that the manifest will later attest. We mirror what
  // `writeValidationPipelineArtifacts` does internally but keep the
  // bytes in memory so the manifest can hash them without re-reading.
  const generatedTestCasesBytes = utf8(
    canonicalJson(validation.generatedTestCases),
  );
  const validationReportBytes = utf8(canonicalJson(validation.validation));
  const policyReportBytes = utf8(canonicalJson(validation.policy));
  const coverageReportBytes = utf8(canonicalJson(validation.coverage));
  const visualReportBytes =
    validation.visual !== undefined
      ? utf8(canonicalJson(validation.visual))
      : undefined;
  await Promise.all([
    writeAtomic(
      join(validationDir, GENERATED_TESTCASES_ARTIFACT_FILENAME),
      generatedTestCasesBytes,
    ),
    writeAtomic(
      join(validationDir, TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME),
      validationReportBytes,
    ),
    writeAtomic(
      join(validationDir, TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME),
      policyReportBytes,
    ),
    writeAtomic(
      join(validationDir, TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME),
      coverageReportBytes,
    ),
    ...(visualReportBytes !== undefined
      ? [
          writeAtomic(
            join(
              validationDir,
              VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME,
            ),
            visualReportBytes,
          ),
        ]
      : []),
  ]);

  // 8. Seed review state and approve every case the policy did not
  //    BLOCK. Wave 1 POC determinism requires byte-identical events,
  //    so the harness deliberately bypasses the file-system review
  //    store (whose `randomUUID()` event ids would defeat replay) and
  //    seeds + transitions in-memory using `transitionReviewState`.
  //    Event ids are derived from a stable hash of `(jobId, sequence)`
  //    so two runs of the same fixture produce identical event logs.
  const decisionsById = new Map<string, TestCasePolicyDecision>();
  for (const record of validation.policy.decisions) {
    decisionsById.set(record.testCaseId, record.decision);
  }
  const review = buildDeterministicReviewBundle({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    list: validation.generatedTestCases,
    decisionsById,
  });
  const snapshot = review.snapshot;
  const reviewEventsBytes = utf8(canonicalJson(review.envelope));
  const reviewStateBytes = utf8(canonicalJson(snapshot));
  await writeAtomic(
    join(input.runDir, REVIEW_EVENTS_ARTIFACT_FILENAME),
    reviewEventsBytes,
  );
  await writeAtomic(
    join(input.runDir, REVIEW_STATE_ARTIFACT_FILENAME),
    reviewStateBytes,
  );

  // 9. Export pipeline. Persist directly into the run dir so every
  //    export artifact lands at the basename level the manifest attests.
  const exportProfile = cloneOpenTextAlmReferenceProfile();
  const exportRun = await runAndPersistExportPipeline({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    intent,
    list: validation.generatedTestCases,
    validation: validation.validation,
    policy: validation.policy,
    ...(validation.visual !== undefined ? { visual: validation.visual } : {}),
    reviewSnapshot: snapshot,
    profile: exportProfile,
    testGenerationDeployment: TEST_GENERATION_DEPLOYMENT,
    destinationDir: input.runDir,
  });
  // The export pipeline's `writeExportPipelineArtifacts` already wrote
  // every artifact byte stream atomically; collect their on-disk bytes
  // for the manifest below.
  const exportArtifactBytes = await collectExportBytes(
    input.runDir,
    exportRun.artifacts,
  );

  // 10. Build evidence manifest. The manifest records the on-disk
  //     bytes for every artifact emitted above.
  const manifest = buildWave1PocEvidenceManifest({
    fixtureId: input.fixtureId,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    modelDeployments: {
      testGeneration: TEST_GENERATION_DEPLOYMENT,
      visualPrimary: VISUAL_PRIMARY_DEPLOYMENT,
    },
    policyProfileId: profile.id,
    policyProfileVersion: profile.version,
    exportProfileId: exportProfile.id,
    exportProfileVersion: exportProfile.version,
    promptHash: compiled.request.hashes.promptHash,
    schemaHash: compiled.request.hashes.schemaHash,
    inputHash: compiled.request.hashes.inputHash,
    cacheKeyDigest: compiled.request.hashes.cacheKey,
    artifacts: [
      {
        filename: BUSINESS_INTENT_IR_ARTIFACT_FILENAME,
        bytes: intentBytes,
        category: "intent",
      },
      {
        filename: COMPILED_PROMPT_ARTIFACT_FILENAME,
        bytes: compiledPromptBytes,
        category: "intent",
      },
      {
        filename: GATEWAY_REQUEST_AUDIT_ARTIFACT_FILENAME,
        bytes: gatewayRequestAuditBytes,
        category: "manifest",
      },
      {
        filename: GENERATED_TESTCASES_ARTIFACT_FILENAME,
        bytes: generatedTestCasesBytes,
        category: "validation",
      },
      {
        filename: TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME,
        bytes: validationReportBytes,
        category: "validation",
      },
      {
        filename: TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME,
        bytes: policyReportBytes,
        category: "validation",
      },
      {
        filename: TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME,
        bytes: coverageReportBytes,
        category: "validation",
      },
      ...(visualReportBytes !== undefined
        ? [
            {
              filename: VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME,
              bytes: visualReportBytes,
              category: "validation" as const,
            },
          ]
        : []),
      {
        filename: REVIEW_EVENTS_ARTIFACT_FILENAME,
        bytes: reviewEventsBytes,
        category: "review",
      },
      {
        filename: REVIEW_STATE_ARTIFACT_FILENAME,
        bytes: reviewStateBytes,
        category: "review",
      },
      ...exportArtifactBytes,
    ],
  });
  await writeWave1PocEvidenceManifest({
    manifest,
    destinationDir: input.runDir,
  });

  return {
    fixtureId: input.fixtureId,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    runDir: input.runDir,
    intent,
    visual: fixture.visual,
    compiledPrompt: {
      request: compiled.request,
      artifacts: compiled.artifacts,
    },
    generatedList: validation.generatedTestCases,
    validation,
    reviewSnapshot: snapshot,
    exportArtifacts: exportRun.artifacts,
    manifest,
    artifactFilenames: manifest.artifacts.map((a) => a.filename),
  };
};

const collectExportBytes = async (
  exportDir: string,
  artifacts: ExportPipelineArtifacts,
): Promise<
  Array<{
    filename: string;
    bytes: Uint8Array;
    category: "export";
  }>
> => {
  const out: Array<{
    filename: string;
    bytes: Uint8Array;
    category: "export";
  }> = [];
  const reportPath = join(exportDir, EXPORT_REPORT_ARTIFACT_FILENAME);
  out.push({
    filename: EXPORT_REPORT_ARTIFACT_FILENAME,
    bytes: await readFile(reportPath),
    category: "export",
  });
  if (!artifacts.refused) {
    const candidates = [
      EXPORT_TESTCASES_JSON_ARTIFACT_FILENAME,
      EXPORT_TESTCASES_CSV_ARTIFACT_FILENAME,
      EXPORT_TESTCASES_ALM_XML_ARTIFACT_FILENAME,
      QC_MAPPING_PREVIEW_ARTIFACT_FILENAME,
    ];
    for (const filename of candidates) {
      const path = join(exportDir, filename);
      out.push({
        filename,
        bytes: await readFile(path),
        category: "export",
      });
    }
  }
  return out;
};

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

const writeAtomic = async (
  destinationPath: string,
  bytes: Uint8Array,
): Promise<void> => {
  const tmp = `${destinationPath}.${process.pid}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, destinationPath);
};

/**
 * Persisted shape of `review-events.json` produced by the file-system
 * review store. Mirrored here so the harness can write a deterministic
 * envelope without depending on the store's `randomUUID()` source.
 */
interface PersistedReviewEventsEnvelope {
  schemaVersion: typeof REVIEW_GATE_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  jobId: string;
  events: ReviewEvent[];
  nextSequence: number;
}

interface DeterministicReviewBundle {
  envelope: PersistedReviewEventsEnvelope;
  snapshot: ReviewGateSnapshot;
}

const deterministicEventId = (
  jobId: string,
  testCaseId: string,
  sequence: number,
  kind: ReviewEvent["kind"],
): string => {
  return sha256Hex({ jobId, testCaseId, sequence, kind });
};

const computeReviewCounts = (
  perTestCase: ReadonlyArray<ReviewSnapshot>,
): {
  approvedCount: number;
  needsReviewCount: number;
  rejectedCount: number;
} => {
  let approvedCount = 0;
  let needsReviewCount = 0;
  let rejectedCount = 0;
  for (const entry of perTestCase) {
    if (
      entry.state === "approved" ||
      entry.state === "exported" ||
      entry.state === "transferred"
    ) {
      approvedCount += 1;
    } else if (entry.state === "needs_review" || entry.state === "edited") {
      needsReviewCount += 1;
    } else if (entry.state === "rejected") {
      rejectedCount += 1;
    }
  }
  return { approvedCount, needsReviewCount, rejectedCount };
};

/**
 * Wave 1 POC convention: seed every test case from the policy decision,
 * then approve every case the policy did not BLOCK. Cases the policy
 * marked `blocked` remain in `needs_review` so a future deliberate-fail
 * fixture can demonstrate the export-refusal path.
 *
 * The function is pure and deterministic — event ids are derived from
 * `sha256({jobId, testCaseId, sequence, kind})` so two runs of the same
 * fixture produce byte-identical event logs.
 */
const buildDeterministicReviewBundle = (input: {
  jobId: string;
  generatedAt: string;
  list: GeneratedTestCaseList;
  decisionsById: ReadonlyMap<string, TestCasePolicyDecision>;
}): DeterministicReviewBundle => {
  const events: ReviewEvent[] = [];
  const perTestCase: ReviewSnapshot[] = [];
  let sequence = 1;

  for (const tc of input.list.testCases) {
    const decision: TestCasePolicyDecision =
      input.decisionsById.get(tc.id) ?? "needs_review";
    const seedState: ReviewState = seedReviewStateFromPolicy(decision);
    const seedEventId = deterministicEventId(
      input.jobId,
      tc.id,
      sequence,
      "generated",
    );
    events.push({
      schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      id: seedEventId,
      jobId: input.jobId,
      testCaseId: tc.id,
      kind: "generated",
      at: input.generatedAt,
      sequence,
      fromState: "generated",
      toState: seedState,
      metadata: { policyDecision: decision },
    });
    sequence += 1;

    let currentState: ReviewState = seedState;
    let lastEventId = seedEventId;
    let approvers: string[] = [];
    if (seedState !== "approved" && decision !== "blocked") {
      const transition = transitionReviewState({
        from: currentState,
        kind: "approved",
        policyDecision: decision,
      });
      if (transition.ok) {
        const approveEventId = deterministicEventId(
          input.jobId,
          tc.id,
          sequence,
          "approved",
        );
        approvers = ["wave1-poc-harness"];
        events.push({
          schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
          contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
          id: approveEventId,
          jobId: input.jobId,
          testCaseId: tc.id,
          kind: "approved",
          at: input.generatedAt,
          sequence,
          fromState: currentState,
          toState: transition.to,
          actor: "wave1-poc-harness",
        });
        currentState = transition.to;
        lastEventId = approveEventId;
        sequence += 1;
      }
    }

    perTestCase.push({
      testCaseId: tc.id,
      state: currentState,
      policyDecision: decision,
      lastEventId,
      lastEventAt: input.generatedAt,
      fourEyesEnforced: false,
      approvers,
    });
  }

  perTestCase.sort((a, b) => a.testCaseId.localeCompare(b.testCaseId));
  const counts = computeReviewCounts(perTestCase);
  const snapshot: ReviewGateSnapshot = {
    schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    perTestCase,
    ...counts,
  };
  const envelope: PersistedReviewEventsEnvelope = {
    schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: input.jobId,
    events,
    nextSequence: sequence,
  };
  return { envelope, snapshot };
};
