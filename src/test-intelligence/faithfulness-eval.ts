/**
 * Faithfulness evaluation gate (Issue #1903).
 *
 * Measures how faithfully the generator output mirrors the Figma IR by
 * computing four coverage ratios, a trace-fidelity score, and a
 * hallucinated-id rate. The metrics are pure functions over an in-memory
 * `BusinessTestIntentIr` plus the `GeneratedTestCaseList` that the
 * generator (or its deterministic synthesiser) produced for the same job.
 *
 * The gate is exercised offline against the seven baseline archetype
 * fixtures shipped under `src/test-intelligence/fixtures/`. The
 * `production-baseline` profile (exported as
 * `FAITHFULNESS_PRODUCTION_BASELINE_THRESHOLDS`) is the pre-release hard
 * gate documented in `docs/test-intelligence-eval.md`.
 *
 * Single-pass / no-repair behaviour: the suite simulates a generator
 * invocation that skipped the repair loop (Issue #1900) by trimming the
 * synthesised list with `degradeListForNoRepair`. This produces a
 * coverage profile that fails the production-baseline thresholds and
 * therefore proves the gate's negative direction without depending on a
 * live LLM.
 */

import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseAuditMetadata,
  type GeneratedTestCaseList,
} from "../contracts/index.js";
import {
  BASELINE_ARCHETYPE_FIXTURE_IDS,
  type BaselineArchetypeFixtureId,
  loadBaselineArchetypeFixture,
  type LoadedBaselineArchetypeFixture,
} from "./baseline-fixtures.js";
import { canonicalJson } from "./content-hash.js";
import { deriveBusinessTestIntentIr } from "./intent-derivation.js";
import { synthesizeGeneratedTestCases } from "./validation-harness.js";

export const FAITHFULNESS_EVAL_SCHEMA_VERSION = "1.0.0" as const;

export const FAITHFULNESS_EVAL_PROFILE_ID = "production-baseline" as const;

export const FAITHFULNESS_EVAL_FIXTURE_GENERATED_AT =
  "2026-05-05T00:00:00.000Z" as const;

/**
 * Hard-gate thresholds for the `production-baseline` profile.
 *
 * Any candidate run with metrics that fall outside any of these bounds
 * fails the gate. The values are intentionally conservative so the
 * deterministic synthesiser passes every threshold, while a generator
 * forced into single-pass / no-repair mode trips at least the field and
 * action coverage gates.
 */
export const FAITHFULNESS_PRODUCTION_BASELINE_THRESHOLDS = Object.freeze({
  fieldCoverageRatio: 0.4,
  actionCoverageRatio: 0.5,
  traceFidelityScore: 0.95,
  hallucinatedIdRate: 0.0,
}) as Readonly<{
  fieldCoverageRatio: number;
  actionCoverageRatio: number;
  traceFidelityScore: number;
  hallucinatedIdRate: number;
}>;

export type FaithfulnessEvalThresholds =
  typeof FAITHFULNESS_PRODUCTION_BASELINE_THRESHOLDS;

export interface FaithfulnessMetrics {
  fieldCoverageRatio: number;
  actionCoverageRatio: number;
  validationCoverageRatio: number;
  navigationCoverageRatio: number;
  traceFidelityScore: number;
  hallucinatedIdRate: number;
  totals: {
    fieldsInIr: number;
    actionsInIr: number;
    validationsInIr: number;
    navigationsInIr: number;
    coveredFieldIds: number;
    coveredActionIds: number;
    coveredValidationIds: number;
    coveredNavigationIds: number;
    figmaTraceRefCount: number;
    figmaTraceRefsWithNodeId: number;
    citedIdCount: number;
    hallucinatedIdCount: number;
  };
}

export type FaithfulnessGateFailureReason =
  | "field_coverage_below_threshold"
  | "action_coverage_below_threshold"
  | "trace_fidelity_below_threshold"
  | "hallucinated_id_above_threshold";

export interface FaithfulnessGateFailure {
  reason: FaithfulnessGateFailureReason;
  threshold: number;
  observed: number;
}

export interface FaithfulnessVerdict {
  passed: boolean;
  failures: ReadonlyArray<FaithfulnessGateFailure>;
}

export interface FaithfulnessEvalArtifact {
  schemaVersion: typeof FAITHFULNESS_EVAL_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  profileId: typeof FAITHFULNESS_EVAL_PROFILE_ID;
  generatedAt: string;
  archetypeId: BaselineArchetypeFixtureId;
  archetype: string;
  intent: string;
  mode: FaithfulnessEvalMode;
  metrics: FaithfulnessMetrics;
  thresholds: FaithfulnessEvalThresholds;
  verdict: FaithfulnessVerdict;
  methodology: {
    deterministic: true;
    citationSources: ReadonlyArray<string>;
  };
}

export type FaithfulnessEvalMode = "with-repair" | "no-repair";

export interface ComputeFaithfulnessMetricsInput {
  intent: BusinessTestIntentIr;
  generatedList: GeneratedTestCaseList;
  knownFigmaNodeIds: ReadonlyArray<string>;
  knownScreenIds: ReadonlyArray<string>;
}

const CITATION_SOURCES: ReadonlyArray<string> = Object.freeze([
  "figmaTraceRefs.nodeId",
  "qualitySignals.coveredFieldIds",
  "qualitySignals.coveredActionIds",
  "qualitySignals.coveredValidationIds",
  "qualitySignals.coveredNavigationIds",
]);

/**
 * Compute faithfulness metrics for a single fixture run.
 *
 * The function is pure and deterministic; identical inputs produce
 * byte-identical outputs.
 */
export const computeFaithfulnessMetrics = (
  input: ComputeFaithfulnessMetricsInput,
): FaithfulnessMetrics => {
  const fieldsInIr = input.intent.detectedFields.length;
  const actionsInIr = input.intent.detectedActions.length;
  const validationsInIr = input.intent.detectedValidations.length;
  const navigationsInIr = input.intent.detectedNavigation.length;

  const validFieldIds = new Set(
    input.intent.detectedFields.map((field) => field.id),
  );
  const validActionIds = new Set(
    input.intent.detectedActions.map((action) => action.id),
  );
  const validValidationIds = new Set(
    input.intent.detectedValidations.map((validation) => validation.id),
  );
  const validNavigationIds = new Set(
    input.intent.detectedNavigation.map((navigation) => navigation.id),
  );
  const validScreenIds = new Set(input.knownScreenIds);
  // The deterministic synthesiser anchors accessibility cases to the
  // owning screen by stamping the screenId into `figmaTraceRefs[].nodeId`
  // (validation-harness.ts l.721). Screens are part of the IR, so a
  // trace anchored to a screenId is NOT a hallucination.
  const validNodeIds = new Set([
    ...input.knownFigmaNodeIds,
    ...input.knownScreenIds,
  ]);

  const coveredFieldIds = new Set<string>();
  const coveredActionIds = new Set<string>();
  const coveredValidationIds = new Set<string>();
  const coveredNavigationIds = new Set<string>();
  let figmaTraceRefCount = 0;
  let figmaTraceRefsWithNodeId = 0;
  let citedIdCount = 0;
  let hallucinatedIdCount = 0;

  for (const testCase of input.generatedList.testCases) {
    for (const fieldId of testCase.qualitySignals.coveredFieldIds) {
      coveredFieldIds.add(fieldId);
      citedIdCount += 1;
      if (!validFieldIds.has(fieldId)) hallucinatedIdCount += 1;
    }
    for (const actionId of testCase.qualitySignals.coveredActionIds) {
      coveredActionIds.add(actionId);
      citedIdCount += 1;
      if (!validActionIds.has(actionId)) hallucinatedIdCount += 1;
    }
    for (const validationId of testCase.qualitySignals.coveredValidationIds) {
      coveredValidationIds.add(validationId);
      citedIdCount += 1;
      if (!validValidationIds.has(validationId)) hallucinatedIdCount += 1;
    }
    for (const navigationId of testCase.qualitySignals.coveredNavigationIds) {
      coveredNavigationIds.add(navigationId);
      citedIdCount += 1;
      if (!validNavigationIds.has(navigationId)) hallucinatedIdCount += 1;
    }
    for (const traceRef of testCase.figmaTraceRefs) {
      figmaTraceRefCount += 1;
      if (traceRef.nodeId !== undefined) {
        figmaTraceRefsWithNodeId += 1;
        citedIdCount += 1;
        if (!validNodeIds.has(traceRef.nodeId)) {
          hallucinatedIdCount += 1;
        }
      }
      // Every screenId citation contributes to the denominator; only
      // invalid screenIds count as hallucinations. Counting only the
      // failing branch would inflate the rate by under-counting valid
      // citations.
      citedIdCount += 1;
      if (!validScreenIds.has(traceRef.screenId)) {
        hallucinatedIdCount += 1;
      }
    }
  }

  return {
    fieldCoverageRatio: ratio(coveredFieldIds.size, fieldsInIr),
    actionCoverageRatio: ratio(coveredActionIds.size, actionsInIr),
    validationCoverageRatio: ratio(coveredValidationIds.size, validationsInIr),
    navigationCoverageRatio: ratio(
      coveredNavigationIds.size,
      navigationsInIr,
    ),
    traceFidelityScore: ratio(figmaTraceRefsWithNodeId, figmaTraceRefCount),
    hallucinatedIdRate: rate(hallucinatedIdCount, citedIdCount),
    totals: {
      fieldsInIr,
      actionsInIr,
      validationsInIr,
      navigationsInIr,
      coveredFieldIds: coveredFieldIds.size,
      coveredActionIds: coveredActionIds.size,
      coveredValidationIds: coveredValidationIds.size,
      coveredNavigationIds: coveredNavigationIds.size,
      figmaTraceRefCount,
      figmaTraceRefsWithNodeId,
      citedIdCount,
      hallucinatedIdCount,
    },
  };
};

/**
 * Apply the production-baseline (or caller-supplied) thresholds and
 * return a structured verdict listing every threshold violation.
 */
export const evaluateFaithfulnessVerdict = (
  metrics: FaithfulnessMetrics,
  thresholds: FaithfulnessEvalThresholds = FAITHFULNESS_PRODUCTION_BASELINE_THRESHOLDS,
): FaithfulnessVerdict => {
  const failures: FaithfulnessGateFailure[] = [];
  if (metrics.fieldCoverageRatio < thresholds.fieldCoverageRatio) {
    failures.push({
      reason: "field_coverage_below_threshold",
      threshold: thresholds.fieldCoverageRatio,
      observed: metrics.fieldCoverageRatio,
    });
  }
  if (metrics.actionCoverageRatio < thresholds.actionCoverageRatio) {
    failures.push({
      reason: "action_coverage_below_threshold",
      threshold: thresholds.actionCoverageRatio,
      observed: metrics.actionCoverageRatio,
    });
  }
  if (metrics.traceFidelityScore < thresholds.traceFidelityScore) {
    failures.push({
      reason: "trace_fidelity_below_threshold",
      threshold: thresholds.traceFidelityScore,
      observed: metrics.traceFidelityScore,
    });
  }
  if (metrics.hallucinatedIdRate > thresholds.hallucinatedIdRate) {
    failures.push({
      reason: "hallucinated_id_above_threshold",
      threshold: thresholds.hallucinatedIdRate,
      observed: metrics.hallucinatedIdRate,
    });
  }
  return { passed: failures.length === 0, failures };
};

export interface BuildFaithfulnessEvalArtifactInput {
  archetypeId: BaselineArchetypeFixtureId;
  mode?: FaithfulnessEvalMode;
  generatedAt?: string;
  thresholds?: FaithfulnessEvalThresholds;
}

export const buildFaithfulnessEvalArtifact = async (
  input: BuildFaithfulnessEvalArtifactInput,
): Promise<FaithfulnessEvalArtifact> => {
  const mode = input.mode ?? "with-repair";
  const generatedAt =
    input.generatedAt ?? FAITHFULNESS_EVAL_FIXTURE_GENERATED_AT;
  const thresholds =
    input.thresholds ?? FAITHFULNESS_PRODUCTION_BASELINE_THRESHOLDS;
  const fixture = await loadBaselineArchetypeFixture(input.archetypeId);
  const intent = deriveBusinessTestIntentIr({ figma: fixture.figma });
  const jobId = `faithfulness-eval-${stripBaselinePrefix(input.archetypeId)}-${mode}`;
  const audit = buildAuditMetadata({ jobId, generatedAt });
  const synthesised = synthesizeGeneratedTestCases({
    jobId,
    generatedAt,
    intent,
    audit,
  });
  const generatedList =
    mode === "no-repair" ? degradeListForNoRepair(synthesised) : synthesised;
  const metrics = computeFaithfulnessMetrics({
    intent,
    generatedList,
    knownFigmaNodeIds: collectKnownFigmaNodeIds(fixture),
    knownScreenIds: collectKnownScreenIds(fixture),
  });
  const verdict = evaluateFaithfulnessVerdict(metrics, thresholds);
  return {
    schemaVersion: FAITHFULNESS_EVAL_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    profileId: FAITHFULNESS_EVAL_PROFILE_ID,
    generatedAt,
    archetypeId: input.archetypeId,
    archetype: fixture.summary.archetype,
    intent: fixture.summary.intent,
    mode,
    metrics,
    thresholds,
    verdict,
    methodology: {
      deterministic: true,
      citationSources: CITATION_SOURCES,
    },
  };
};

export const buildAllFaithfulnessEvalArtifacts = async (input?: {
  mode?: FaithfulnessEvalMode;
  generatedAt?: string;
  thresholds?: FaithfulnessEvalThresholds;
}): Promise<ReadonlyArray<FaithfulnessEvalArtifact>> => {
  return Promise.all(
    BASELINE_ARCHETYPE_FIXTURE_IDS.map((archetypeId) =>
      buildFaithfulnessEvalArtifact({
        archetypeId,
        ...(input?.mode !== undefined ? { mode: input.mode } : {}),
        ...(input?.generatedAt !== undefined
          ? { generatedAt: input.generatedAt }
          : {}),
        ...(input?.thresholds !== undefined
          ? { thresholds: input.thresholds }
          : {}),
      }),
    ),
  );
};

export const FAITHFULNESS_EVAL_REPORT_DIRNAME =
  "storybook-static/eval-reports" as const;

export const faithfulnessEvalReportFilename = (
  archetypeId: BaselineArchetypeFixtureId,
): string => `faithfulness-${stripBaselinePrefix(archetypeId)}.json`;

export interface WriteFaithfulnessEvalArtifactInput {
  artifact: FaithfulnessEvalArtifact;
  /** Destination directory; defaults to {@link FAITHFULNESS_EVAL_REPORT_DIRNAME}. */
  outputDir?: string;
}

export const writeFaithfulnessEvalArtifact = async (
  input: WriteFaithfulnessEvalArtifactInput,
): Promise<string> => {
  const dir = input.outputDir ?? FAITHFULNESS_EVAL_REPORT_DIRNAME;
  const outputPath = join(
    dir,
    faithfulnessEvalReportFilename(input.artifact.archetypeId),
  );
  await mkdir(dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, canonicalJson(input.artifact), "utf8");
  await rename(tempPath, outputPath);
  return outputPath;
};

/**
 * Inject a test case that cites IDs not present in the IR. Used by the
 * eval suite to prove the hallucination gate fires.
 */
export const injectHallucinatedTestCase = (input: {
  list: GeneratedTestCaseList;
  hallucinatedNodeId?: string;
  hallucinatedScreenId?: string;
}): GeneratedTestCaseList => {
  const hallucinatedScreenId = input.hallucinatedScreenId ?? "s-hallucinated";
  const hallucinatedNodeId = input.hallucinatedNodeId ?? "n-hallucinated";
  const hallucinatedCase: GeneratedTestCase = {
    id: "tc-hallucinated",
    sourceJobId: input.list.jobId,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    title: "Hallucinated coverage citation",
    objective: "Prove the hallucination gate fires.",
    level: "system",
    type: "functional",
    priority: "p3",
    riskCategory: "low",
    technique: "use_case",
    preconditions: [],
    testData: [],
    steps: [{ index: 1, action: "noop" }],
    expectedResults: ["noop"],
    figmaTraceRefs: [
      { screenId: hallucinatedScreenId, nodeId: hallucinatedNodeId },
    ],
    assumptions: [],
    openQuestions: [],
    qcMappingPreview: { exportable: false, blockingReasons: ["hallucinated"] },
    qualitySignals: {
      coveredFieldIds: [
        `${hallucinatedScreenId}::field::${hallucinatedNodeId}`,
      ],
      coveredActionIds: [],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: 0,
    },
    reviewState: "draft",
    audit:
      input.list.testCases[0]?.audit ??
      buildAuditMetadata({
        jobId: input.list.jobId,
        generatedAt: FAITHFULNESS_EVAL_FIXTURE_GENERATED_AT,
      }),
  };
  return {
    schemaVersion: input.list.schemaVersion,
    jobId: input.list.jobId,
    testCases: [...input.list.testCases, hallucinatedCase],
  };
};

/**
 * Simulate a generator invocation that skipped the repair loop.
 *
 * The repair loop's job (Issue #1900) is to iterate when the initial
 * pass leaves coverage gaps. We model the absence of repair by
 * keeping only the first test case and stripping its nodeId trace —
 * this is sufficient to break the field, action, and trace-fidelity
 * gates on every baseline archetype fixture.
 */
export const degradeListForNoRepair = (
  list: GeneratedTestCaseList,
): GeneratedTestCaseList => {
  const survivor = list.testCases[0];
  if (survivor === undefined) return list;
  const degraded: GeneratedTestCase = {
    ...survivor,
    figmaTraceRefs: survivor.figmaTraceRefs.map((traceRef) => ({
      screenId: traceRef.screenId,
    })),
    qualitySignals: {
      ...survivor.qualitySignals,
      coveredFieldIds: survivor.qualitySignals.coveredFieldIds.slice(0, 1),
      coveredActionIds: [],
      coveredValidationIds: [],
      coveredNavigationIds: [],
    },
  };
  return {
    schemaVersion: list.schemaVersion,
    jobId: list.jobId,
    testCases: [degraded],
  };
};

const collectKnownFigmaNodeIds = (
  fixture: LoadedBaselineArchetypeFixture,
): ReadonlyArray<string> => {
  const ids = new Set<string>();
  for (const screen of fixture.figma.screens) {
    for (const node of screen.nodes) ids.add(node.nodeId);
  }
  return [...ids].sort();
};

const collectKnownScreenIds = (
  fixture: LoadedBaselineArchetypeFixture,
): ReadonlyArray<string> => {
  return fixture.figma.screens
    .map((screen) => screen.screenId)
    .slice()
    .sort();
};

const buildAuditMetadata = (input: {
  jobId: string;
  generatedAt: string;
}): GeneratedTestCaseAuditMetadata => ({
  jobId: input.jobId,
  generatedAt: input.generatedAt,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  redactionPolicyVersion: REDACTION_POLICY_VERSION,
  visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
  cacheHit: false,
  cacheKey: "faithfulness-eval-cache-key",
  inputHash: "faithfulness-eval-input-hash",
  promptHash: "faithfulness-eval-prompt-hash",
  schemaHash: "faithfulness-eval-schema-hash",
});

const stripBaselinePrefix = (archetypeId: BaselineArchetypeFixtureId): string =>
  archetypeId.replace(/^baseline-/u, "");

/**
 * Coverage-style ratio (covered/total). Returns 1 for the degenerate
 * 0/0 case so an IR that legitimately contains no fields/actions does
 * not trip the gate.
 */
const ratio = (numerator: number, denominator: number): number => {
  if (denominator === 0) return 1;
  return roundTo(numerator / denominator);
};

/**
 * Failure-style rate (errors/total). Returns 0 for the degenerate 0/0
 * case so an artefact with no citations is reported as having no
 * hallucinations rather than 100% of them.
 */
const rate = (numerator: number, denominator: number): number => {
  if (denominator === 0) return 0;
  return roundTo(numerator / denominator);
};

const roundTo = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;
