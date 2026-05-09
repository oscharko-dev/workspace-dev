/**
 * Validation pipeline orchestrator (Issue #1364).
 *
 * Glues together:
 *   - generated-test-case schema validator (#1362)
 *   - semantic test-case validation
 *   - visual-sidecar gate (#1364 / #1386 update)
 *   - duplicate / coverage / quality-signals computation
 *   - policy gate (eu-banking-default by default)
 *   - atomic, deterministic JSON persistence of:
 *       - generated-testcases.json
 *       - validation-report.json
 *       - policy-report.json
 *       - coverage-report.json
 *       - visual-sidecar-validation-report.json (when sidecar input present)
 *
 * The pipeline is a pure data transform when `destinationDir` is omitted;
 * it becomes filesystem-touching when a directory is supplied. Both forms
 * resolve to the same in-memory artifact bundle so callers may persist
 * later or replay from cache.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  GENERATED_TESTCASES_ARTIFACT_FILENAME,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_DATA_ORACLE_REPORT_ARTIFACT_FILENAME,
  TECHNIQUE_QUOTA_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME,
  type ActiveModelBinding,
  type A11yVerdict,
  type BusinessTestIntentIr,
  type CoveragePlan,
  type FaithfulnessVerdict,
  type GeneratedTestCaseList,
  type SelfVerifyRubricReport,
  type TechniqueQuotaReport,
  type TestCaseCoverageReport,
  type TestCasePolicyProfile,
  type TestCasePolicyReport,
  type TestCasePolicyViolation,
  type TestCaseValidationReport,
  type VisualScreenDescription,
  type VisualSidecarFailureClass,
  type VisualSidecarValidationReport,
  type WorkflowTopology,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import type { CoverageBaselineDriftEvaluation } from "./coverage-baseline-drift.js";
import {
  buildActiveDatasetInvariantRegistry,
  type DomainInvariantRegistry,
} from "./domain-invariant-registry.js";
import {
  evaluatePolicyGate,
  type ComplianceRiskOverride,
} from "./policy-gate.js";
import { cloneEuBankingDefaultProfile } from "./policy-profile.js";
import {
  effectiveSemanticContentBlock,
  filterSemanticContentOverridesForValidation,
  type SemanticContentOverrideMap,
} from "./semantic-content-sanitization.js";
import type { UntrustedContentNormalizationReport } from "./untrusted-content-normalizer.js";
import {
  runSelfVerifyRubricPass,
  writeSelfVerifyRubricReportArtifact,
  type SelfVerifyRubricPipelineOptions,
} from "./self-verify-rubric.js";
import { computeCoverageReport } from "./test-case-coverage.js";
import { validateGeneratedTestCasesWithInvariants } from "./test-case-validation.js";
import { buildTechniqueQuotaReport } from "./technique-quota.js";
import {
  repairUnresolvedValidationDetails,
  type UnresolvedDetailRepairChange,
} from "./unresolved-detail-repair.js";
import {
  applyDeterministicTestDataOracle,
  type TestDataOracleReport,
} from "./test-data-oracle-governance.js";
import { validateVisualSidecar } from "./visual-sidecar-validation.js";

export interface RunValidationPipelineInput {
  jobId: string;
  generatedAt: string;
  list: GeneratedTestCaseList;
  intent: BusinessTestIntentIr;
  /** Optional visual sidecar payload; when absent the visual gate is skipped. */
  visual?: ReadonlyArray<VisualScreenDescription>;
  /** Optional coverage plan used for quota-aware hard-gates. */
  coveragePlan?: CoveragePlan;
  workflowTopology?: WorkflowTopology;
  /** Override the default `eu-banking-default` policy profile. */
  profile?: TestCasePolicyProfile;
  /** Optional rule-severity overrides keyed by policy rule id. */
  policyOverrides?: ReadonlyArray<{
    ruleId: string;
    severity: "error" | "warning";
    threshold?: number;
  }>;
  a11yVerdict?: A11yVerdict;
  faithfulnessVerdict?: FaithfulnessVerdict;
  /** Optional rubric score (0..1) from a downstream rater. */
  rubricScore?: number;
  /** Optional primary visual deployment, used for fallback detection. */
  primaryVisualDeployment?: string;
  /**
   * Optional reviewer overrides for `semantic_suspicious_content` findings
   * (Issue #1413). Forwarded into the policy gate; also applied when
   * computing the pipeline-level `blocked` flag so an overridden case no
   * longer blocks downstream gates. The `validation` artifact in the
   * returned bundle is preserved unchanged so the audit history retains
   * the original error finding.
   */
  semanticContentOverrides?: SemanticContentOverrideMap;
  /**
   * Documented visual-sidecar refusal forwarded to the policy gate
   * (Issues #1772, #2069). The policy gate records a blocking
   * `policy:visual-sidecar:both_failed` error when both sidecars are
   * exhausted, while successful fallback recovery remains informational.
   * Per-case decisions are only touched when
   * `visualVerificationRequired` is also set for the run.
   */
  visualSidecarRefusal?: {
    failureClass: VisualSidecarFailureClass;
    failureMessage: string;
  };
  /** When true, a visual-sidecar refusal is applied to each case decision. */
  visualVerificationRequired?: boolean;
  /** Optional pre-LLM untrusted-content routing summary. */
  untrustedContentReport?: UntrustedContentNormalizationReport;
  /** Optional summary of active model bindings used by the job. */
  activeModelBindings?: readonly ActiveModelBinding[];
  /**
   * Optional runtime coverage-baseline drift evaluation (Issue #1950).
   * Computed by the runner before the pipeline runs; passed through to
   * the policy gate so a `policy:coverage-drift-exceeded` job-level
   * violation can fire when drift exceeds 10 % on any tracked axis.
   */
  coverageBaselineDrift?: CoverageBaselineDriftEvaluation;
  /**
   * Optional domain-invariant registry override (Issue #2040). Defaults
   * to {@link buildActiveDatasetInvariantRegistry}. Set this to
   * `null` to disable invariant evaluation entirely (no
   * `domain_invariant_violation` issues, no `invariantCoverage` field).
   */
  invariantRegistry?: DomainInvariantRegistry | null;
  /**
   * Optional fixture- or screen-scoped compliance overrides
   * (Issue #2030 follow-up, K0-measurement-driven).
   *
   * Forwarded verbatim into the policy gate's
   * {@link EvaluatePolicyGateInput#complianceOverrides} entry. When the
   * intent IR carries no PII / risk indicators for a regulated mask
   * (MiFID II, GwG, FATCA, EAA, DORA, …), the policy gate falls back
   * to the override declared by the per-fixture compliance sidecar so
   * `policy:regulated-risk-requires-review` and
   * `policy:risk-tag-downgrade-detected` still fire. Overrides NEVER
   * weaken an already-derived classification; they are a fallback floor.
   *
   * Documentation lives next to the type in `policy-gate.ts`.
   */
  complianceOverrides?: ReadonlyArray<ComplianceRiskOverride>;
}

export interface ValidationPipelineArtifacts {
  /** Generated test cases accepted by the structural schema gate. */
  generatedTestCases: GeneratedTestCaseList;
  validation: TestCaseValidationReport;
  coverage: TestCaseCoverageReport;
  policy: TestCasePolicyReport;
  visual?: VisualSidecarValidationReport;
  /**
   * Self-verify rubric pass output (Issue #1379). Populated only by
   * `runValidationPipelineWithSelfVerify`. The synchronous
   * `runValidationPipeline` never sets this field so its disabled-path
   * artifacts remain byte-identical to the pre-#1379 baseline.
   */
  rubric?: SelfVerifyRubricReport;
  /**
   * Issue #2068 — per-run resolution path of the
   * `policy:technique-coverage-minimum` gate. Populated whenever a
   * `coveragePlan` is supplied. Persisted as
   * `technique-quota-report.json` by
   * {@link writeValidationPipelineArtifacts}. */
  techniqueQuota?: TechniqueQuotaReport;
  /**
   * Issue #2032 — ordered audit trail of deterministic repairs applied
   * before validation when generated cases would have triggered
   * `validation:unsupported_unresolved_validation_detail` errors. Empty
   * array when no test case touched an unresolved validation constraint
   * or when no concrete detail had to be stripped.
   */
  unresolvedDetailRepairChanges: UnresolvedDetailRepairChange[];
  /** Issue #2071 authoritative per-case oracle resolution report. */
  testDataOracleReport?: TestDataOracleReport;
  /**
   * Final blocking decision. True when ANY of:
   *   - validation reported errors
   *   - policy gate marked the job blocked
   *   - visual sidecar gate marked itself blocked
   */
  blocked: boolean;
}

/**
 * Run the validation pipeline as a pure transform. No filesystem IO.
 *
 * Returns the in-memory artifact bundle. Use `writeValidationPipelineArtifacts`
 * to persist deterministically.
 */
export const runValidationPipeline = (
  input: RunValidationPipelineInput,
): ValidationPipelineArtifacts => {
  const profile = input.profile ?? cloneEuBankingDefaultProfile();
  const invariantRegistry = resolveInvariantRegistry(input.invariantRegistry);
  const oracle = applyDeterministicTestDataOracle({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    list: input.list,
    intent: input.intent,
  });

  // Issue #2032 — apply the deterministic unresolved-detail guard before
  // validation so concrete numeric thresholds, exact validation messages,
  // and confirm/submit acceptance assertions on cases touching unresolved
  // source rules can never reach `validation-report.json` as errors. The
  // repair is a pure transform; when no case touches an unresolved
  // constraint the input list is returned unchanged.
  const repair = repairUnresolvedValidationDetails({
    jobId: input.jobId,
    list: oracle.list,
    intent: input.intent,
    ...(input.workflowTopology !== undefined
      ? { workflowTopology: input.workflowTopology }
      : {}),
    ...(input.visual !== undefined ? { visual: input.visual } : {}),
  });
  const repairedList = repair.list;
  const repairChanges = repair.changes;

  const validationOutcome = validateGeneratedTestCasesWithInvariants({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    list: repairedList,
    intent: input.intent,
    ...(input.workflowTopology !== undefined
      ? { workflowTopology: input.workflowTopology }
      : {}),
    ...(invariantRegistry !== undefined ? { invariantRegistry } : {}),
  });
  const validation = validationOutcome.report;

  if (hasStructuralErrors(validation)) {
    const emptyList: GeneratedTestCaseList = {
      schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
      jobId: input.jobId,
      testCases: [],
    };
    const coverage = computeCoverageReport({
      jobId: input.jobId,
      generatedAt: input.generatedAt,
      policyProfileId: profile.id,
      list: emptyList,
      intent: input.intent,
      ...(input.workflowTopology !== undefined
        ? { workflowTopology: input.workflowTopology }
        : {}),
      duplicateSimilarityThreshold: profile.rules.duplicateSimilarityThreshold,
      ...(input.rubricScore !== undefined
        ? { rubricScore: input.rubricScore }
        : {}),
    });
    const policy = buildSchemaInvalidPolicyReport({
      jobId: input.jobId,
      generatedAt: input.generatedAt,
      profile,
      validation,
    });
    const artifacts: ValidationPipelineArtifacts = {
      generatedTestCases: emptyList,
      validation,
      coverage,
      policy,
      unresolvedDetailRepairChanges: repairChanges,
      testDataOracleReport: oracle.report,
      blocked: true,
    };
    return artifacts;
  }

  const coverage = computeCoverageReport({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    policyProfileId: profile.id,
    list: repairedList,
    intent: input.intent,
    ...(input.workflowTopology !== undefined
      ? { workflowTopology: input.workflowTopology }
      : {}),
    duplicateSimilarityThreshold: profile.rules.duplicateSimilarityThreshold,
    ...(input.rubricScore !== undefined
      ? { rubricScore: input.rubricScore }
      : {}),
    ...(validationOutcome.invariantEvaluation !== undefined
      ? { invariantEvaluation: validationOutcome.invariantEvaluation }
      : {}),
  });

  let visualReport: VisualSidecarValidationReport | undefined;
  if (input.visual !== undefined) {
    visualReport = validateVisualSidecar({
      jobId: input.jobId,
      generatedAt: input.generatedAt,
      visual: input.visual,
      intent: input.intent,
      ...(input.primaryVisualDeployment !== undefined
        ? { primaryDeployment: input.primaryVisualDeployment }
        : {}),
    });
  }

  const semanticContentOverrides =
    input.semanticContentOverrides === undefined
      ? undefined
      : filterSemanticContentOverridesForValidation(
          validation,
          input.semanticContentOverrides,
        );

  const policy = evaluatePolicyGate({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    list: repairedList,
    intent: input.intent,
    profile,
    validation,
    coverage,
    ...(input.coveragePlan !== undefined
      ? { coveragePlan: input.coveragePlan }
      : {}),
    ...(visualReport !== undefined ? { visual: visualReport } : {}),
    ...(input.policyOverrides !== undefined
      ? { policyOverrides: input.policyOverrides }
      : {}),
    ...(input.a11yVerdict !== undefined
      ? { a11yVerdict: input.a11yVerdict }
      : {}),
    ...(input.faithfulnessVerdict !== undefined
      ? { faithfulnessVerdict: input.faithfulnessVerdict }
      : {}),
    ...(semanticContentOverrides !== undefined
      ? { semanticContentOverrides }
      : {}),
    ...(input.visualSidecarRefusal !== undefined
      ? { visualSidecarRefusal: input.visualSidecarRefusal }
      : {}),
    ...(input.visualVerificationRequired !== undefined
      ? { visualVerificationRequired: input.visualVerificationRequired }
      : {}),
    ...(input.untrustedContentReport !== undefined
      ? { untrustedContentReport: input.untrustedContentReport }
      : {}),
    ...(input.activeModelBindings !== undefined
      ? { activeModelBindings: input.activeModelBindings }
      : {}),
    ...(input.coverageBaselineDrift !== undefined
      ? { coverageBaselineDrift: input.coverageBaselineDrift }
      : {}),
    ...(input.complianceOverrides !== undefined
      ? { complianceOverrides: input.complianceOverrides }
      : {}),
  });

  const validationBlockedAfterOverrides =
    semanticContentOverrides === undefined
      ? validation.blocked
      : effectiveSemanticContentBlock(validation, semanticContentOverrides);

  const blocked =
    validationBlockedAfterOverrides ||
    policy.blocked ||
    (visualReport !== undefined && visualReport.blocked);

  const artifacts: ValidationPipelineArtifacts = {
    generatedTestCases: repairedList,
    validation,
    coverage,
    policy,
    unresolvedDetailRepairChanges: repairChanges,
    testDataOracleReport: oracle.report,
    blocked,
  };
  if (visualReport !== undefined) artifacts.visual = visualReport;
  if (input.coveragePlan !== undefined) {
    artifacts.techniqueQuota = buildTechniqueQuotaReport({
      generatedAt: input.generatedAt,
      jobId: input.jobId,
      policyProfileId: profile.id,
      cases: repairedList.testCases,
      coveragePlan: input.coveragePlan,
      ...(profile.rules.techniqueCoverageMinimum !== undefined
        ? { policy: profile.rules.techniqueCoverageMinimum }
        : {}),
    });
  }
  return artifacts;
};

const hasStructuralErrors = (report: TestCaseValidationReport): boolean =>
  report.issues.some((issue) => issue.code === "schema_invalid");

/**
 * Resolve the active domain-invariant registry for a pipeline run
 * (Issue #2040). The default is the active-dataset registry; passing
 * `null` disables invariant evaluation entirely.
 */
const resolveInvariantRegistry = (
  override: DomainInvariantRegistry | null | undefined,
): DomainInvariantRegistry | undefined => {
  if (override === null) return undefined;
  if (override !== undefined) return override;
  return buildActiveDatasetInvariantRegistry();
};

const buildSchemaInvalidPolicyReport = (input: {
  jobId: string;
  generatedAt: string;
  profile: TestCasePolicyProfile;
  validation: TestCaseValidationReport;
}): TestCasePolicyReport => {
  const jobLevelViolations: TestCasePolicyViolation[] = input.validation.issues
    .filter((issue) => issue.code === "schema_invalid")
    .map((issue) => ({
      rule: "validation:schema_invalid",
      outcome: "schema_invalid",
      severity: "error",
      reason: issue.message,
      path: issue.path,
    }));

  return {
    schemaVersion: TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt: input.generatedAt,
    jobId: input.jobId,
    policyProfileId: input.profile.id,
    policyProfileVersion: input.profile.version,
    totalTestCases: 0,
    approvedCount: 0,
    blockedCount: 0,
    needsReviewCount: 0,
    blocked: true,
    decisions: [],
    jobLevelViolations,
  };
};

export interface WriteValidationPipelineArtifactsInput {
  artifacts: ValidationPipelineArtifacts;
  /** Destination directory (created recursively if missing). */
  destinationDir: string;
}

export interface WriteValidationPipelineArtifactsResult {
  generatedTestCasesPath: string;
  validationReportPath: string;
  policyReportPath: string;
  coverageReportPath: string;
  visualSidecarValidationReportPath?: string;
  /** Path of the persisted self-verify rubric report when present (Issue #1379). */
  selfVerifyRubricReportPath?: string;
  /** Path of the persisted technique-quota report (Issue #2068). */
  techniqueQuotaReportPath?: string;
  /** Path of the persisted deterministic test-data oracle report (Issue #2071). */
  testDataOracleReportPath?: string;
}

/**
 * Persist all in-memory artifacts to `destinationDir` deterministically.
 *
 * Each file is written atomically: serialize to canonical JSON, write to
 * `${path}.${pid}.tmp`, then rename into place. The result includes the
 * absolute paths for upstream artifact bookkeeping.
 */
export const writeValidationPipelineArtifacts = async (
  input: WriteValidationPipelineArtifactsInput,
): Promise<WriteValidationPipelineArtifactsResult> => {
  await mkdir(input.destinationDir, { recursive: true });

  const generatedTestCasesPath = join(
    input.destinationDir,
    GENERATED_TESTCASES_ARTIFACT_FILENAME,
  );
  const validationReportPath = join(
    input.destinationDir,
    TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME,
  );
  const policyReportPath = join(
    input.destinationDir,
    TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME,
  );
  const coverageReportPath = join(
    input.destinationDir,
    TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME,
  );

  await Promise.all([
    writeAtomicJson(generatedTestCasesPath, input.artifacts.generatedTestCases),
    writeAtomicJson(validationReportPath, input.artifacts.validation),
    writeAtomicJson(policyReportPath, input.artifacts.policy),
    writeAtomicJson(coverageReportPath, input.artifacts.coverage),
  ]);

  const result: WriteValidationPipelineArtifactsResult = {
    generatedTestCasesPath,
    validationReportPath,
    policyReportPath,
    coverageReportPath,
  };

  if (input.artifacts.visual !== undefined) {
    const visualPath = join(
      input.destinationDir,
      VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME,
    );
    await writeAtomicJson(visualPath, input.artifacts.visual);
    result.visualSidecarValidationReportPath = visualPath;
  }

  if (input.artifacts.rubric !== undefined) {
    const rubricPaths = await writeSelfVerifyRubricReportArtifact({
      report: input.artifacts.rubric,
      runDir: input.destinationDir,
    });
    result.selfVerifyRubricReportPath = rubricPaths.artifactPath;
  }

  if (input.artifacts.techniqueQuota !== undefined) {
    const techniqueQuotaPath = join(
      input.destinationDir,
      TECHNIQUE_QUOTA_REPORT_ARTIFACT_FILENAME,
    );
    await writeAtomicJson(techniqueQuotaPath, input.artifacts.techniqueQuota);
    result.techniqueQuotaReportPath = techniqueQuotaPath;
  }

  if (input.artifacts.testDataOracleReport !== undefined) {
    const testDataOracleReportPath = join(
      input.destinationDir,
      TEST_DATA_ORACLE_REPORT_ARTIFACT_FILENAME,
    );
    await writeAtomicJson(
      testDataOracleReportPath,
      input.artifacts.testDataOracleReport,
    );
    result.testDataOracleReportPath = testDataOracleReportPath;
  }

  return result;
};

const writeAtomicJson = async (
  destinationPath: string,
  payload: unknown,
): Promise<void> => {
  const serialized = canonicalJson(payload);
  const tmpPath = `${destinationPath}.${process.pid}.tmp`;
  await writeFile(tmpPath, serialized, "utf8");
  await rename(tmpPath, destinationPath);
};

/**
 * Convenience: run the pipeline and persist in one call. Returns both the
 * in-memory artifacts and the persisted paths so the orchestrator does
 * not need to call the two helpers in sequence.
 */
export const runAndPersistValidationPipeline = async (
  input: RunValidationPipelineInput & { destinationDir: string },
): Promise<{
  artifacts: ValidationPipelineArtifacts;
  paths: WriteValidationPipelineArtifactsResult;
}> => {
  const artifacts = runValidationPipeline(input);
  const paths = await writeValidationPipelineArtifacts({
    artifacts,
    destinationDir: input.destinationDir,
  });
  return { artifacts, paths };
};

/* -------------------------------------------------------------------- */
/*  Self-verify rubric variant (Issue #1379)                             */
/* -------------------------------------------------------------------- */

/**
 * Inputs for the self-verify-aware pipeline. The required `selfVerify`
 * options carry the gateway client, model identity, and (optional)
 * rubric replay cache. Apart from this opt-in, the rest of the pipeline
 * inputs match `RunValidationPipelineInput` exactly.
 */
export interface RunValidationPipelineWithSelfVerifyInput extends RunValidationPipelineInput {
  selfVerify: SelfVerifyRubricPipelineOptions;
}

/**
 * Run the validation pipeline with the optional self-verify rubric pass
 * inserted between `testcase.validate` and `testcase.policy`
 * (Issue #1379). On a structurally-invalid validation report the rubric
 * pass is skipped and the result mirrors `runValidationPipeline`'s
 * disabled path. On a successful rubric pass:
 *
 *   - per-case `rubricScore` rows are published in the rubric report
 *     and flat `TestCaseQualitySignalRubric[]` projection,
 *   - `coverage-report.json#rubricScore` carries the job-level score,
 *   - the resulting artifact bundle gains a `rubric` field which is
 *     persisted by `writeValidationPipelineArtifacts`.
 *
 * Refusals (gateway errors, schema-invalid responses, missing scores)
 * are captured on `rubric.refusal` rather than thrown — the upstream
 * pipeline still publishes a complete artifact set so an operator can
 * audit the failed run.
 */
export const runValidationPipelineWithSelfVerify = async (
  input: RunValidationPipelineWithSelfVerifyInput,
): Promise<ValidationPipelineArtifacts> => {
  const profile = input.profile ?? cloneEuBankingDefaultProfile();
  const invariantRegistry = resolveInvariantRegistry(input.invariantRegistry);
  const oracle = applyDeterministicTestDataOracle({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    list: input.list,
    intent: input.intent,
  });

  // Issue #2032 — apply the deterministic unresolved-detail guard before
  // both validation and the self-verify rubric pass so the rubric judge
  // and policy gate never see concrete details that would have triggered
  // `validation:unsupported_unresolved_validation_detail` errors.
  const repair = repairUnresolvedValidationDetails({
    jobId: input.jobId,
    list: oracle.list,
    intent: input.intent,
    ...(input.workflowTopology !== undefined
      ? { workflowTopology: input.workflowTopology }
      : {}),
    ...(input.visual !== undefined ? { visual: input.visual } : {}),
  });
  const repairedList = repair.list;
  const repairChanges = repair.changes;

  const validationOutcome = validateGeneratedTestCasesWithInvariants({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    list: repairedList,
    intent: input.intent,
    ...(invariantRegistry !== undefined ? { invariantRegistry } : {}),
  });
  const validation = validationOutcome.report;

  if (hasStructuralErrors(validation)) {
    return runValidationPipeline({ ...input, profile });
  }

  let visualReport: VisualSidecarValidationReport | undefined;
  if (input.visual !== undefined) {
    visualReport = validateVisualSidecar({
      jobId: input.jobId,
      generatedAt: input.generatedAt,
      visual: input.visual,
      intent: input.intent,
      ...(input.primaryVisualDeployment !== undefined
        ? { primaryDeployment: input.primaryVisualDeployment }
        : {}),
    });
  }

  const rubricVisual: ReadonlyArray<VisualScreenDescription> =
    visualReport !== undefined && !visualReport.blocked
      ? (input.visual ?? [])
      : [];

  const rubricRun = await runSelfVerifyRubricPass({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    list: repairedList,
    intent: input.intent,
    ...(rubricVisual.length > 0 ? { visual: rubricVisual } : {}),
    policyProfileId: profile.id,
    policyBundleVersion: input.selfVerify.policyBundleVersion,
    client: input.selfVerify.client,
    modelBinding: input.selfVerify.modelBinding,
    ...(input.selfVerify.cache !== undefined
      ? { cache: input.selfVerify.cache }
      : {}),
    ...(input.selfVerify.maxOutputTokens !== undefined
      ? { maxOutputTokens: input.selfVerify.maxOutputTokens }
      : {}),
    ...(input.selfVerify.maxWallClockMs !== undefined
      ? { maxWallClockMs: input.selfVerify.maxWallClockMs }
      : {}),
    ...(input.selfVerify.maxRetries !== undefined
      ? { maxRetries: input.selfVerify.maxRetries }
      : {}),
    ...(input.selfVerify.maxInputTokens !== undefined
      ? { maxInputTokens: input.selfVerify.maxInputTokens }
      : {}),
  });

  const rubricReport = rubricRun.report;
  const aggregateScore = rubricReport.aggregate.jobLevelRubricScore;
  const rubricScoreInput =
    rubricReport.refusal === undefined ? aggregateScore : input.rubricScore;

  const coverage = computeCoverageReport({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    policyProfileId: profile.id,
    list: repairedList,
    intent: input.intent,
    duplicateSimilarityThreshold: profile.rules.duplicateSimilarityThreshold,
    ...(rubricScoreInput !== undefined
      ? { rubricScore: rubricScoreInput }
      : {}),
    ...(validationOutcome.invariantEvaluation !== undefined
      ? { invariantEvaluation: validationOutcome.invariantEvaluation }
      : {}),
  });

  const semanticContentOverrides =
    input.semanticContentOverrides === undefined
      ? undefined
      : filterSemanticContentOverridesForValidation(
          validation,
          input.semanticContentOverrides,
        );

  const policy = evaluatePolicyGate({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    list: repairedList,
    intent: input.intent,
    profile,
    validation,
    coverage,
    ...(input.a11yVerdict !== undefined
      ? { a11yVerdict: input.a11yVerdict }
      : {}),
    ...(input.policyOverrides !== undefined
      ? { policyOverrides: input.policyOverrides }
      : {}),
    ...(visualReport !== undefined ? { visual: visualReport } : {}),
    ...(semanticContentOverrides !== undefined
      ? { semanticContentOverrides }
      : {}),
    ...(input.visualSidecarRefusal !== undefined
      ? { visualSidecarRefusal: input.visualSidecarRefusal }
      : {}),
    ...(input.visualVerificationRequired !== undefined
      ? { visualVerificationRequired: input.visualVerificationRequired }
      : {}),
    ...(input.activeModelBindings !== undefined
      ? { activeModelBindings: input.activeModelBindings }
      : {}),
    ...(input.coverageBaselineDrift !== undefined
      ? { coverageBaselineDrift: input.coverageBaselineDrift }
      : {}),
    ...(input.complianceOverrides !== undefined
      ? { complianceOverrides: input.complianceOverrides }
      : {}),
  });

  const validationBlockedAfterOverrides =
    semanticContentOverrides === undefined
      ? validation.blocked
      : effectiveSemanticContentBlock(validation, semanticContentOverrides);

  const blocked =
    validationBlockedAfterOverrides ||
    policy.blocked ||
    (visualReport !== undefined && visualReport.blocked);

  const artifacts: ValidationPipelineArtifacts = {
    generatedTestCases: repairedList,
    validation,
    coverage,
    policy,
    rubric: rubricReport,
    unresolvedDetailRepairChanges: repairChanges,
    testDataOracleReport: oracle.report,
    blocked,
  };
  if (visualReport !== undefined) artifacts.visual = visualReport;
  if (input.coveragePlan !== undefined) {
    artifacts.techniqueQuota = buildTechniqueQuotaReport({
      generatedAt: input.generatedAt,
      jobId: input.jobId,
      policyProfileId: profile.id,
      cases: repairedList.testCases,
      coveragePlan: input.coveragePlan,
      ...(profile.rules.techniqueCoverageMinimum !== undefined
        ? { policy: profile.rules.techniqueCoverageMinimum }
        : {}),
    });
  }
  return artifacts;
};

/**
 * Convenience: run the self-verify-aware pipeline AND persist the
 * artifacts (including `self-verify-rubric.json`) under
 * `destinationDir`. The result mirrors
 * `runAndPersistValidationPipeline`.
 */
export const runAndPersistValidationPipelineWithSelfVerify = async (
  input: RunValidationPipelineWithSelfVerifyInput & { destinationDir: string },
): Promise<{
  artifacts: ValidationPipelineArtifacts;
  paths: WriteValidationPipelineArtifactsResult;
}> => {
  const artifacts = await runValidationPipelineWithSelfVerify(input);
  const paths = await writeValidationPipelineArtifacts({
    artifacts,
    destinationDir: input.destinationDir,
  });
  return { artifacts, paths };
};
