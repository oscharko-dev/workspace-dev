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
  TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME,
  VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME,
  type BusinessTestIntentIr,
  type GeneratedTestCaseList,
  type TestCaseCoverageReport,
  type TestCasePolicyProfile,
  type TestCasePolicyReport,
  type TestCaseValidationReport,
  type VisualScreenDescription,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import { evaluatePolicyGate } from "./policy-gate.js";
import { cloneEuBankingDefaultProfile } from "./policy-profile.js";
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
  /** The generated test case list itself (unchanged from input). */
  generatedTestCases: GeneratedTestCaseList;
  validation: TestCaseValidationReport;
  coverage: TestCaseCoverageReport;
  policy: TestCasePolicyReport;
  visual?: VisualSidecarValidationReport;
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
