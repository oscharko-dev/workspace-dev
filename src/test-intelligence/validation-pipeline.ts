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
  TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME,
  type BusinessTestIntentIr,
  type GeneratedTestCaseList,
  type SelfVerifyRubricReport,
  type TestCaseCoverageReport,
  type TestCasePolicyProfile,
  type TestCasePolicyReport,
  type TestCasePolicyViolation,
  type TestCaseValidationReport,
  type VisualScreenDescription,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import { evaluatePolicyGate } from "./policy-gate.js";
import { cloneEuBankingDefaultProfile } from "./policy-profile.js";
import {
  runSelfVerifyRubricPass,
  writeSelfVerifyRubricReportArtifact,
  type SelfVerifyRubricPipelineOptions,
} from "./self-verify-rubric.js";
import { computeCoverageReport } from "./test-case-coverage.js";
import { validateGeneratedTestCases } from "./test-case-validation.js";
import { validateVisualSidecar } from "./visual-sidecar-validation.js";

export interface RunValidationPipelineInput {
  jobId: string;
  generatedAt: string;
  list: GeneratedTestCaseList;
  intent: BusinessTestIntentIr;
  /** Optional visual sidecar payload; when absent the visual gate is skipped. */
  visual?: ReadonlyArray<VisualScreenDescription>;
  /** Override the default `eu-banking-default` policy profile. */
  profile?: TestCasePolicyProfile;
  /** Optional rubric score (0..1) from a downstream rater. */
  rubricScore?: number;
  /** Optional primary visual deployment, used for fallback detection. */
  primaryVisualDeployment?: "llama-4-maverick-vision" | "phi-4-multimodal-poc";
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

  const validation = validateGeneratedTestCases({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    list: input.list,
    intent: input.intent,
  });

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
      blocked: true,
    };
    return artifacts;
  }

  const coverage = computeCoverageReport({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    policyProfileId: profile.id,
    list: input.list,
    intent: input.intent,
    duplicateSimilarityThreshold: profile.rules.duplicateSimilarityThreshold,
    ...(input.rubricScore !== undefined
      ? { rubricScore: input.rubricScore }
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

  const policy = evaluatePolicyGate({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    list: input.list,
    intent: input.intent,
    profile,
    validation,
    coverage,
    ...(visualReport !== undefined ? { visual: visualReport } : {}),
  });

  const blocked =
    validation.blocked ||
    policy.blocked ||
    (visualReport !== undefined && visualReport.blocked);

  const artifacts: ValidationPipelineArtifacts = {
    generatedTestCases: input.list,
    validation,
    coverage,
    policy,
    blocked,
  };
  if (visualReport !== undefined) artifacts.visual = visualReport;
  return artifacts;
};

const hasStructuralErrors = (report: TestCaseValidationReport): boolean =>
  report.issues.some((issue) => issue.code === "schema_invalid");

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
 *   - per-case `qualitySignals.rubricScore` is stamped onto a freshly
 *     cloned `GeneratedTestCaseList`,
 *   - `coverage-report.json#rubricScore` carries the job-level score,
 *   - the policy gate sees the rubric-scored list (so any future
 *     policy rule that gates on rubric score has a stable input),
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
  const validation = validateGeneratedTestCases({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    list: input.list,
    intent: input.intent,
  });

  if (hasStructuralErrors(validation)) {
    return runValidationPipeline({ ...input, profile });
  }

  const rubricRun = await runSelfVerifyRubricPass({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    list: input.list,
    intent: input.intent,
    ...(input.visual !== undefined ? { visual: input.visual } : {}),
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
    list: input.list,
    intent: input.intent,
    duplicateSimilarityThreshold: profile.rules.duplicateSimilarityThreshold,
    ...(rubricScoreInput !== undefined
      ? { rubricScore: rubricScoreInput }
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

  const policy = evaluatePolicyGate({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    list: input.list,
    intent: input.intent,
    profile,
    validation,
    coverage,
    ...(visualReport !== undefined ? { visual: visualReport } : {}),
  });

  const blocked =
    validation.blocked ||
    policy.blocked ||
    (visualReport !== undefined && visualReport.blocked);

  const artifacts: ValidationPipelineArtifacts = {
    generatedTestCases: input.list,
    validation,
    coverage,
    policy,
    rubric: rubricReport,
    blocked,
  };
  if (visualReport !== undefined) artifacts.visual = visualReport;
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
