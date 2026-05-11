/**
 * Faithfulness-tier report (Issue #2066, Issue #2170).
 *
 * Tiers each generated test-case step into `concrete_data` (the step
 * carries observable input or expected data), `state_transition` (the
 * step belongs to a `technique === "state_transition"` test case AND
 * has no concrete-data assertions — Issue #2170), or `label_only` (the
 * step asserts label-only or layout-only intent), then resolves the
 * per-step verdict from {@link FaithfulnessVerdict.stepVerdicts} into a
 * tier-aware pass/fail.
 *
 * The per-step thresholds match the Issue #2170 acceptance criteria:
 *
 *   tier=`concrete_data`     → match >= 0.95, evidence_partial >= 0.80,
 *                              mismatch < 0.80.
 *   tier=`label_only`        → match >= 0.95, evidence_partial >= 0.85,
 *                              mismatch < 0.85.
 *   tier=`state_transition`  → match >= 0.95, evidence_partial >= 0.65,
 *                              mismatch < 0.65.
 *
 * The aggregate `aggregateScore` averages the per-step scores across
 * every case. The default aggregate threshold mirrors the existing
 * cross-modal-faithfulness gate (0.80). Threshold overrides flow in
 * from the policy gate's `policyOverrides` payload — tier ratings stay
 * constant, only the aggregate floor moves.
 *
 * Pure: no IO except the optional {@link writeFaithfulnessTierReport}
 * helper which writes a byte-deterministic JSON artifact.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  FAITHFULNESS_PARTIAL_MAJORITY_FRACTION,
  FAITHFULNESS_TIER_REPORT_ARTIFACT_FILENAME,
  FAITHFULNESS_TIER_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type FaithfulnessStepVerdictLabel,
  type FaithfulnessTierLabel,
  type FaithfulnessTierReport,
  type FaithfulnessTierReportEntry,
  type FaithfulnessVerdict,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type GeneratedTestCaseStep,
  type TestCaseTechnique29119,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import { scoreFaithfulnessStepVerdict } from "./faithfulness-judge.js";

/** Default aggregate cross-modal faithfulness threshold (`0.80`).
 *
 * Mirrors `DEFAULT_CROSS_MODAL_FAITHFULNESS_THRESHOLD` in
 * `policy-gate.ts`; surfaced here so tier-report consumers do not have
 * to import the gate module just to know the default. */
export const DEFAULT_FAITHFULNESS_TIER_AGGREGATE_THRESHOLD = 0.8;

/** Tier-aware step thresholds (Issue #2066 + Issue #2170 acceptance
 * criteria).
 *
 * Encoded as `<tier>_<verdict>` pairs so each (tier, verdict) cell is
 * independently auditable. The values are pinned by the issue's
 * acceptance criteria; profile-scoped overrides can move the aggregate
 * floor (`DEFAULT_FAITHFULNESS_TIER_AGGREGATE_THRESHOLD`) but NOT the
 * per-cell thresholds — the cells encode the *meaning* of the
 * verdicts, not policy strictness. */
export const FAITHFULNESS_TIER_STEP_THRESHOLDS = Object.freeze({
  concrete_data_match: 0.95,
  concrete_data_evidence_partial: 0.8,
  concrete_data_mismatch: 0.8,
  label_only_match: 0.95,
  label_only_evidence_partial: 0.85,
  label_only_mismatch: 0.85,
  state_transition_match: 0.95,
  state_transition_evidence_partial: 0.65,
  state_transition_mismatch: 0.65,
}) as Readonly<{
  concrete_data_match: number;
  concrete_data_evidence_partial: number;
  concrete_data_mismatch: number;
  label_only_match: number;
  label_only_evidence_partial: number;
  label_only_mismatch: number;
  state_transition_match: number;
  state_transition_evidence_partial: number;
  state_transition_mismatch: number;
}>;

const round6 = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;

/**
 * Classify a step into `concrete_data`, `state_transition`, or
 * `label_only`.
 *
 * Precedence — most specific tier wins:
 *   1. `concrete_data` — `data` carries a digit OR `expected` carries
 *      a digit OR `data` is non-empty and at least 4 characters long
 *      (typical payload text such as `"valid@example.com"` or
 *      `"Tony"`). Concrete data is asserted regardless of the parent
 *      test case's technique.
 *   2. `state_transition` (Issue #2170) — the parent test case has
 *      `technique === "state_transition"` AND the step has no concrete
 *      data. The cross-family judge cannot reliably verify the full
 *      intermediate frame of a workflow transition from a single
 *      capture, so the tier is the most permissive.
 *   3. `label_only` — neither of the above. Visible labels are
 *      asserted but no concrete data or workflow transition.
 *
 * The legacy single-argument form (no `technique`) is preserved for
 * backwards compatibility with callers that do not have access to the
 * parent test case; it never returns `state_transition`.
 *
 * Pure and deterministic. Returns a `tierReason` so the persisted
 * report explains the choice to reviewers.
 */
export const classifyFaithfulnessStepTier = (
  step: GeneratedTestCaseStep,
  technique?: TestCaseTechnique29119,
): { tier: FaithfulnessTierLabel; tierReason: string } => {
  const data = step.data?.trim() ?? "";
  const expected = step.expected?.trim() ?? "";
  if (data.length > 0 && /\d/.test(data)) {
    return {
      tier: "concrete_data",
      tierReason: "step.data carries a numeric value",
    };
  }
  if (expected.length > 0 && /\d/.test(expected)) {
    return {
      tier: "concrete_data",
      tierReason: "step.expected carries a numeric value",
    };
  }
  if (data.length >= 4) {
    return {
      tier: "concrete_data",
      tierReason: "step.data carries a non-trivial payload",
    };
  }
  if (technique === "state_transition") {
    return {
      tier: "state_transition",
      tierReason:
        "step belongs to a state_transition technique case and asserts no concrete data",
    };
  }
  return {
    tier: "label_only",
    tierReason: "step has no concrete input or expected data",
  };
};

/** Whether a per-step `(verdict, tier)` pair clears its tier-aware
 * threshold (Issue #2066, refined for Issue #2170). Pure.
 *
 * Each `(tier, verdict)` cell is looked up independently so the table
 * stays auditable. `mismatch` (score `0.0`) never clears any tier's
 * threshold (every cell threshold is `> 0`); the explicit lookup keeps
 * the table the single source of truth instead of relying on the
 * verdict's score alone. */
export const stepPassesTierThreshold = (
  tier: FaithfulnessTierLabel,
  verdict: FaithfulnessStepVerdictLabel,
): boolean => {
  const score = scoreFaithfulnessStepVerdict(verdict);
  const key = `${tier}_${verdict}` as keyof typeof FAITHFULNESS_TIER_STEP_THRESHOLDS;
  return score >= FAITHFULNESS_TIER_STEP_THRESHOLDS[key];
};

export interface BuildFaithfulnessTierReportInput {
  readonly generatedAt: string;
  readonly jobId: string;
  readonly verdict: FaithfulnessVerdict;
  readonly list: GeneratedTestCaseList;
  /** Aggregate-floor threshold the report compares against. Defaults to
   * {@link DEFAULT_FAITHFULNESS_TIER_AGGREGATE_THRESHOLD}. */
  readonly aggregateThreshold?: number;
}

/**
 * Build a deterministic {@link FaithfulnessTierReport} from a
 * non-refused {@link FaithfulnessVerdict} and the generated test-case
 * list it judged.
 *
 * Steps that the verdict's `stepVerdicts` array does not list are
 * defaulted to `match` — the legacy verdict (schema 1.0.0) implicitly
 * treats the absence of a hallucination/mismatch finding as a match,
 * and the report mirrors that behaviour so callers upgrading from
 * 1.0.0 see no decision drift.
 *
 * Throws when the verdict carries a refusal — refused verdicts have no
 * step-level evidence, so the report would be misleading.
 */
export const buildFaithfulnessTierReport = (
  input: BuildFaithfulnessTierReportInput,
): FaithfulnessTierReport => {
  if (input.verdict.refusal !== undefined) {
    throw new RangeError(
      `buildFaithfulnessTierReport: cannot build a tier report from a refused verdict (code=${input.verdict.refusal.code})`,
    );
  }

  const stepVerdictByKey = new Map<
    string,
    { verdict: FaithfulnessStepVerdictLabel; message?: string }
  >();
  for (const stepVerdict of input.verdict.stepVerdicts ?? []) {
    stepVerdictByKey.set(
      stepVerdictKey(stepVerdict.testCaseId, stepVerdict.stepIndex),
      { verdict: stepVerdict.verdict, message: stepVerdict.message },
    );
  }

  const entries: FaithfulnessTierReportEntry[] = [];
  const partialMajorityCaseIds: string[] = [];
  for (const testCase of orderCases(input.list.testCases)) {
    let caseStepCount = 0;
    let caseEvidencePartialCount = 0;
    for (const step of testCase.steps) {
      const tierInfo = classifyFaithfulnessStepTier(step, testCase.technique);
      const found = stepVerdictByKey.get(
        stepVerdictKey(testCase.id, step.index),
      );
      const verdict: FaithfulnessStepVerdictLabel =
        found?.verdict ?? "match";
      const score = scoreFaithfulnessStepVerdict(verdict);
      const passesThreshold = stepPassesTierThreshold(tierInfo.tier, verdict);
      const entry: FaithfulnessTierReportEntry = {
        testCaseId: testCase.id,
        stepIndex: step.index,
        tier: tierInfo.tier,
        tierReason: tierInfo.tierReason,
        verdict,
        score: round6(score),
        passesThreshold,
        ...(found?.message !== undefined ? { message: found.message } : {}),
      };
      entries.push(entry);
      caseStepCount += 1;
      if (verdict === "evidence_partial") caseEvidencePartialCount += 1;
    }
    if (
      caseStepCount > 0 &&
      caseEvidencePartialCount / caseStepCount >=
        FAITHFULNESS_PARTIAL_MAJORITY_FRACTION
    ) {
      partialMajorityCaseIds.push(testCase.id);
    }
  }

  const aggregateThreshold =
    input.aggregateThreshold ??
    DEFAULT_FAITHFULNESS_TIER_AGGREGATE_THRESHOLD;
  const stepCount = entries.length;
  let scoreSum = 0;
  let matchCount = 0;
  let evidencePartialCount = 0;
  let mismatchCount = 0;
  for (const entry of entries) {
    scoreSum += entry.score;
    if (entry.verdict === "match") matchCount += 1;
    else if (entry.verdict === "evidence_partial") evidencePartialCount += 1;
    else mismatchCount += 1;
  }
  const aggregateScore =
    stepCount === 0 ? 0 : round6(scoreSum / stepCount);
  const aggregatePasses =
    stepCount > 0 && aggregateScore >= aggregateThreshold;

  return {
    schemaVersion: FAITHFULNESS_TIER_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt: input.generatedAt,
    jobId: input.jobId,
    aggregateScore,
    aggregateThreshold: round6(aggregateThreshold),
    aggregatePasses,
    stepCount,
    matchCount,
    evidencePartialCount,
    mismatchCount,
    evaluationMode: "per_step",
    entries,
    partialMajorityCaseIds: [...partialMajorityCaseIds].sort((a, b) =>
      a.localeCompare(b, "en"),
    ),
  };
};

const stepVerdictKey = (testCaseId: string, stepIndex: number): string =>
  `${testCaseId} ${stepIndex}`;

const orderCases = (
  cases: readonly GeneratedTestCase[],
): readonly GeneratedTestCase[] =>
  [...cases].sort((a, b) => a.id.localeCompare(b.id, "en"));

export interface WriteFaithfulnessTierReportInput {
  readonly runDir: string;
  readonly artifact: FaithfulnessTierReport;
}

/**
 * Persist the tier report under
 * `${runDir}/${FAITHFULNESS_TIER_REPORT_ARTIFACT_FILENAME}`.
 *
 * Atomic via tmp-then-rename. Returns the resolved path and emitted
 * byte buffer so callers can hash or upload the artifact.
 */
export const writeFaithfulnessTierReport = async (
  input: WriteFaithfulnessTierReportInput,
): Promise<{ readonly path: string; readonly bytes: Buffer }> => {
  const filePath = join(
    input.runDir,
    FAITHFULNESS_TIER_REPORT_ARTIFACT_FILENAME,
  );
  await mkdir(dirname(filePath), { recursive: true });
  const bytes = Buffer.from(canonicalJson(input.artifact), "utf8");
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, filePath);
  return { path: filePath, bytes };
};
