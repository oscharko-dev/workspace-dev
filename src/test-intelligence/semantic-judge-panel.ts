/**
 * Agent_02 Judge Panel - Panel-of-LLM-Judges (PoLL) with cross-family
 * judges and CalibraEval-style post-hoc calibration (Issue #1782,
 * Story MA-3 #1758).
 *
 * The panel is a deterministic pure-function pipeline over already-
 * gathered per-judge raw scores. It does NOT call the gateway; the
 * harness collects raw `(judgeId, modelBinding, score, reason)`
 * tuples for the configured cross-family judges (`judgePrimary =
 * gpt-oss-120b`, `judgeSecondary = phi-4-multimodal-poc`) and feeds
 * them in. This module:
 *
 *   1. Calibrates each raw score against the run's empirical fixture
 *      distribution (CalibraEval-style monotonic mapping, no naive
 *      shuffling and no length normalisation - verbosity-bias
 *      inversion 2025).
 *   2. Maps each calibrated score to a per-judge verdict via fixed
 *      decision thresholds derived from the calibrated distribution.
 *   3. Computes the panel agreement label and Trust-or-Escalate
 *      routing: disagreement always downgrades severity to
 *      `downgraded_disagreement` or routes the case to `needs_review`
 *      (per AT-022); both-pass and both-fail are deterministic.
 *   4. Builds canonical-JSON-stable {@link JudgePanelVerdict} records
 *      and atomically persists them to
 *      `<runDir>/judge-panel-verdicts.json`.
 *
 * Hard invariants:
 *
 *   - Reasons are length-capped to {@link JUDGE_PANEL_REASON_MAX_CHARS}
 *     and refused if any of LF, CR, U+2028, or U+2029 appears (kept
 *     as a defence-in-depth refusal - the panel is the wrong layer
 *     to do redaction; upstream callers must redact, but we refuse
 *     anything that would corrupt JSON or smuggle line endings into
 *     evidence).
 *   - The artifact carries no chain-of-thought, no raw prompts, no
 *     screenshots, no model logits.
 *   - Verdicts are sorted by `(testCaseId, criterion)` for
 *     canonical-JSON byte-stability across runs.
 */

import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  JUDGE_PANEL_AGREEMENT_LABELS,
  JUDGE_PANEL_ESCALATION_ROUTES,
  JUDGE_PANEL_JUDGE_IDS,
  JUDGE_PANEL_PER_JUDGE_VERDICTS,
  JUDGE_PANEL_REASON_MAX_CHARS,
  JUDGE_PANEL_RESOLVED_SEVERITIES,
  JUDGE_PANEL_VERDICT_SCHEMA_VERSION,
  JUDGE_PANEL_VERDICTS_ARTIFACT_FILENAME,
  type JudgePanelAgreement,
  type JudgePanelEscalationRoute,
  type JudgePanelJudgeId,
  type JudgePanelPerJudgeVerdict,
  type JudgePanelPerJudgeVerdictRecord,
  type JudgePanelResolvedSeverity,
  type JudgePanelVerdict,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

// ---------------------------------------------------------------------------
// Decision thresholds - fixed module-load constants. Tunable only via a
// contract bump.
// ---------------------------------------------------------------------------

/**
 * Minimum calibrated score for a per-judge `pass` verdict. Calibrated
 * scores live in `[0, 1]`; `>= PASS_THRESHOLD` => `pass`.
 */
export const JUDGE_PASS_THRESHOLD = 0.7 as const;

/**
 * Maximum calibrated score for a per-judge `fail` verdict.
 * `<= FAIL_THRESHOLD` => `fail`. The half-open interval
 * `(FAIL_THRESHOLD, PASS_THRESHOLD)` => `uncertain`.
 */
export const JUDGE_FAIL_THRESHOLD = 0.4 as const;

/**
 * Severity assigned to a `both_fail` verdict by the panel router.
 * `both_pass` is always `minor`; the disagreement path is
 * `downgraded_disagreement` (AT-022).
 */
export const JUDGE_BOTH_FAIL_SEVERITY: JudgePanelResolvedSeverity =
  "critical";

/** Severity assigned to a `both_pass` verdict by the panel router. */
export const JUDGE_BOTH_PASS_SEVERITY: JudgePanelResolvedSeverity = "minor";

/** Routing severity for a `disagree` verdict (AT-022). */
export const JUDGE_DISAGREE_SEVERITY: JudgePanelResolvedSeverity =
  "downgraded_disagreement";

// ---------------------------------------------------------------------------
// Public input shapes.
// ---------------------------------------------------------------------------

/**
 * Raw, pre-calibration per-judge sample produced by the harness. The
 * harness collects exactly two samples per `(testCaseId, criterion)`
 * - one per judge - and feeds them to {@link buildJudgePanelVerdicts}.
 */
export interface JudgePanelRawSample {
  /** Test-case identifier the sample applies to. */
  readonly testCaseId: string;
  /** Stable rubric criterion identifier the sample scores. */
  readonly criterion: string;
  /** Judge identifier within the panel. */
  readonly judgeId: JudgePanelJudgeId;
  /**
   * Stable model identifier this judge was bound to at the time of
   * scoring. Echoed verbatim into the persisted artifact.
   */
  readonly modelBinding: string;
  /** Raw 0..1 pointwise score before post-hoc calibration. */
  readonly score: number;
  /**
   * Free-form, length-capped justification (<=
   * {@link JUDGE_PANEL_REASON_MAX_CHARS} chars). The panel refuses
   * any value containing LF, CR, U+2028, or U+2029.
   */
  readonly reason: string;
}

/**
 * Optional configuration consumed by {@link buildJudgePanelVerdicts}.
 * The default policy is exactly the one the issue spec mandates;
 * callers should rarely override it.
 */
export interface JudgePanelPolicy {
  /**
   * Trust-or-Escalate routing for a `disagree` panel agreement.
   *
   * `"downgrade"` (default) maps the case to
   * `escalationRoute = "downgrade"` and severity
   * `downgraded_disagreement`. `"needs_review"` maps the case to
   * `escalationRoute = "needs_review"` (still with severity
   * `downgraded_disagreement`).
   */
  readonly disagreementRoute?: "downgrade" | "needs_review";
}

/** Input to {@link buildJudgePanelVerdicts}. */
export interface BuildJudgePanelVerdictsInput {
  readonly samples: readonly JudgePanelRawSample[];
  readonly policy?: JudgePanelPolicy;
}

// ---------------------------------------------------------------------------
// Validation helpers.
// ---------------------------------------------------------------------------

const FORBIDDEN_REASON_CHARS: readonly string[] = Object.freeze([
  "\n",
  "\r",
  "\u2028",
  "\u2029",
]);

const isJudgePanelJudgeId = (value: unknown): value is JudgePanelJudgeId =>
  typeof value === "string" &&
  (JUDGE_PANEL_JUDGE_IDS as readonly string[]).includes(value);

const assertReasonAcceptable = (reason: string, where: string): void => {
  if (typeof reason !== "string") {
    throw new TypeError(`${where}: reason must be a string`);
  }
  if (reason.length > JUDGE_PANEL_REASON_MAX_CHARS) {
    throw new RangeError(
      `${where}: reason exceeds JUDGE_PANEL_REASON_MAX_CHARS (${JUDGE_PANEL_REASON_MAX_CHARS}), got ${reason.length}`,
    );
  }
  for (const ch of FORBIDDEN_REASON_CHARS) {
    if (reason.includes(ch)) {
      const codepoint = ch
        .charCodeAt(0)
        .toString(16)
        .toUpperCase()
        .padStart(4, "0");
      throw new RangeError(
        `${where}: reason contains a forbidden control / line-separator codepoint (U+${codepoint})`,
      );
    }
  }
};

const assertSample = (sample: JudgePanelRawSample, index: number): void => {
  const where = `buildJudgePanelVerdicts: samples[${index}]`;
  if (typeof sample.testCaseId !== "string" || sample.testCaseId.length === 0) {
    throw new TypeError(`${where}: testCaseId must be a non-empty string`);
  }
  if (typeof sample.criterion !== "string" || sample.criterion.length === 0) {
    throw new TypeError(`${where}: criterion must be a non-empty string`);
  }
  if (!isJudgePanelJudgeId(sample.judgeId)) {
    throw new RangeError(
      `${where}: unknown judgeId "${String(sample.judgeId)}"`,
    );
  }
  if (
    typeof sample.modelBinding !== "string" ||
    sample.modelBinding.length === 0
  ) {
    throw new TypeError(`${where}: modelBinding must be a non-empty string`);
  }
  if (
    typeof sample.score !== "number" ||
    !Number.isFinite(sample.score) ||
    sample.score < 0 ||
    sample.score > 1
  ) {
    throw new RangeError(
      `${where}: score must be a finite number in [0, 1], got ${String(
        sample.score,
      )}`,
    );
  }
  assertReasonAcceptable(sample.reason, where);
};

// ---------------------------------------------------------------------------
// CalibraEval-style post-hoc calibration.
// ---------------------------------------------------------------------------

/**
 * Build per-judge sorted score lists from the input samples. The
 * calibration mapping is the empirical CDF of these per-judge raw
 * scores - distribution-aware, monotonic, and bias-resistant.
 */
const buildCalibrationTable = (
  samples: readonly JudgePanelRawSample[],
): ReadonlyMap<JudgePanelJudgeId, readonly number[]> => {
  const byJudge = new Map<JudgePanelJudgeId, number[]>();
  for (const judgeId of JUDGE_PANEL_JUDGE_IDS) {
    byJudge.set(judgeId, []);
  }
  for (const sample of samples) {
    const bucket = byJudge.get(sample.judgeId);
    if (bucket !== undefined) {
      bucket.push(sample.score);
    }
  }
  for (const list of byJudge.values()) {
    list.sort((a, b) => a - b);
  }
  return byJudge;
};

/**
 * Calibrate a single raw score against the empirical distribution of
 * raw scores observed in the same run, restricted to the same
 * `judgeId`. Empirical-CDF mapping:
 * `calibrated(s) = | { x in S_judge : x <= s } | / |S_judge|`.
 *
 * Properties:
 *
 *   - Monotonic non-decreasing in the raw score.
 *   - Distribution-aware: a judge that systematically scores high
 *     gets pulled down, breaking the self-preference / verbosity
 *     bias inversion documented in the 2025 PoLL literature.
 *   - No length normalisation, no naive shuffling.
 *   - Stable for byte-identical inputs.
 *
 * Edge cases:
 *
 *   - When a judge has fewer than 2 observations the empirical CDF
 *     is degenerate (a single observation always maps to 1.0,
 *     erasing any signal from the raw threshold). The function
 *     falls back to the raw score in that case so single-fixture
 *     and small-batch runs still respect the JUDGE_PASS_THRESHOLD /
 *     JUDGE_FAIL_THRESHOLD decision boundaries.
 */
const CALIBRATION_MIN_SAMPLE = 2 as const;

const calibrate = (
  rawScore: number,
  sortedJudgeScores: readonly number[],
): number => {
  if (sortedJudgeScores.length < CALIBRATION_MIN_SAMPLE) {
    return rawScore;
  }
  let lessOrEqual = 0;
  for (const x of sortedJudgeScores) {
    if (x <= rawScore) {
      lessOrEqual++;
    } else {
      break;
    }
  }
  return lessOrEqual / sortedJudgeScores.length;
};

// ---------------------------------------------------------------------------
// Per-judge verdict + panel routing.
// ---------------------------------------------------------------------------

const verdictForCalibratedScore = (
  calibratedScore: number,
): JudgePanelPerJudgeVerdict => {
  if (calibratedScore >= JUDGE_PASS_THRESHOLD) {
    return "pass";
  }
  if (calibratedScore <= JUDGE_FAIL_THRESHOLD) {
    return "fail";
  }
  return "uncertain";
};

const computeAgreement = (
  primary: JudgePanelPerJudgeVerdict,
  secondary: JudgePanelPerJudgeVerdict,
): JudgePanelAgreement => {
  if (primary === "pass" && secondary === "pass") {
    return "both_pass";
  }
  if (primary === "fail" && secondary === "fail") {
    return "both_fail";
  }
  return "disagree";
};

const computeRoutingForAgreement = (
  agreement: JudgePanelAgreement,
  policy: Required<JudgePanelPolicy>,
): {
  readonly resolvedSeverity: JudgePanelResolvedSeverity;
  readonly escalationRoute: JudgePanelEscalationRoute;
} => {
  if (agreement === "both_pass") {
    return Object.freeze({
      resolvedSeverity: JUDGE_BOTH_PASS_SEVERITY,
      escalationRoute: "accept" as JudgePanelEscalationRoute,
    });
  }
  if (agreement === "both_fail") {
    return Object.freeze({
      resolvedSeverity: JUDGE_BOTH_FAIL_SEVERITY,
      escalationRoute: "needs_review" as JudgePanelEscalationRoute,
    });
  }
  return Object.freeze({
    resolvedSeverity: JUDGE_DISAGREE_SEVERITY,
    escalationRoute: policy.disagreementRoute,
  });
};

// ---------------------------------------------------------------------------
// buildJudgePanelVerdicts
// ---------------------------------------------------------------------------

const groupKey = (testCaseId: string, criterion: string): string =>
  `${testCaseId} ${criterion}`;

const compareByTestCaseAndCriterion = (
  a: JudgePanelVerdict,
  b: JudgePanelVerdict,
): number => {
  if (a.testCaseId < b.testCaseId) return -1;
  if (a.testCaseId > b.testCaseId) return 1;
  if (a.criterion < b.criterion) return -1;
  if (a.criterion > b.criterion) return 1;
  return 0;
};

/**
 * Pure-function panel builder. Validates every sample, calibrates raw
 * scores per-judge against the run's empirical distribution, derives
 * per-judge verdicts, computes the panel-level agreement label, and
 * applies Trust-or-Escalate routing. Returns a frozen, alphabetically
 * sorted array of {@link JudgePanelVerdict} records.
 *
 * Throws on:
 *
 *   - Empty `samples` array.
 *   - Missing or duplicated judge per `(testCaseId, criterion)` pair
 *     (the panel always requires exactly two judges per case).
 *   - Any per-sample validation failure (see {@link assertSample}).
 *   - Unknown `policy.disagreementRoute`.
 */
export const buildJudgePanelVerdicts = (
  input: BuildJudgePanelVerdictsInput,
): readonly JudgePanelVerdict[] => {
  const samples: readonly JudgePanelRawSample[] = input.samples;
  if (samples.length === 0) {
    throw new TypeError(
      "buildJudgePanelVerdicts: samples must be a non-empty array",
    );
  }
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    if (sample === undefined) {
      throw new TypeError(
        `buildJudgePanelVerdicts: samples[${i}] is undefined`,
      );
    }
    assertSample(sample, i);
  }

  const requestedRoute: string =
    input.policy?.disagreementRoute ?? "downgrade";
  if (requestedRoute !== "downgrade" && requestedRoute !== "needs_review") {
    throw new RangeError(
      `buildJudgePanelVerdicts: unknown policy.disagreementRoute "${requestedRoute}"`,
    );
  }
  const policy: Required<JudgePanelPolicy> = {
    disagreementRoute: requestedRoute,
  };

  const calibrationTable = buildCalibrationTable(samples);

  const groups = new Map<
    string,
    {
      readonly testCaseId: string;
      readonly criterion: string;
      readonly byJudge: Map<JudgePanelJudgeId, JudgePanelRawSample>;
    }
  >();
  for (const sample of samples) {
    const key = groupKey(sample.testCaseId, sample.criterion);
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        testCaseId: sample.testCaseId,
        criterion: sample.criterion,
        byJudge: new Map(),
      };
      groups.set(key, group);
    }
    if (group.byJudge.has(sample.judgeId)) {
      throw new RangeError(
        `buildJudgePanelVerdicts: duplicate samples for (testCaseId="${sample.testCaseId}", criterion="${sample.criterion}", judgeId="${sample.judgeId}")`,
      );
    }
    group.byJudge.set(sample.judgeId, sample);
  }

  const verdicts: JudgePanelVerdict[] = [];
  for (const group of groups.values()) {
    if (group.byJudge.size !== JUDGE_PANEL_JUDGE_IDS.length) {
      const missing = JUDGE_PANEL_JUDGE_IDS.filter(
        (id) => !group.byJudge.has(id),
      ).join(", ");
      throw new RangeError(
        `buildJudgePanelVerdicts: incomplete panel for (testCaseId="${group.testCaseId}", criterion="${group.criterion}") - missing judges: [${missing}]`,
      );
    }

    const perJudgeRaw: JudgePanelPerJudgeVerdictRecord[] = [];
    for (const judgeId of JUDGE_PANEL_JUDGE_IDS) {
      const sample = group.byJudge.get(judgeId);
      if (sample === undefined) {
        throw new RangeError(
          `buildJudgePanelVerdicts: missing sample for judgeId "${judgeId}" in (testCaseId="${group.testCaseId}", criterion="${group.criterion}")`,
        );
      }
      const sortedScores = calibrationTable.get(judgeId) ?? [];
      const calibratedScore = calibrate(sample.score, sortedScores);
      perJudgeRaw.push(
        Object.freeze({
          judgeId: sample.judgeId,
          modelBinding: sample.modelBinding,
          score: sample.score,
          calibratedScore,
          verdict: verdictForCalibratedScore(calibratedScore),
          reason: sample.reason,
        }),
      );
    }
    perJudgeRaw.sort((a, b) =>
      a.judgeId < b.judgeId ? -1 : a.judgeId > b.judgeId ? 1 : 0,
    );

    const primary = perJudgeRaw.find((r) => r.judgeId === "judge_primary");
    const secondary = perJudgeRaw.find((r) => r.judgeId === "judge_secondary");
    if (primary === undefined || secondary === undefined) {
      throw new RangeError(
        `buildJudgePanelVerdicts: panel must contain both judge_primary and judge_secondary entries`,
      );
    }
    const agreement = computeAgreement(primary.verdict, secondary.verdict);
    const routing = computeRoutingForAgreement(agreement, policy);

    verdicts.push(
      Object.freeze({
        schemaVersion: JUDGE_PANEL_VERDICT_SCHEMA_VERSION,
        testCaseId: group.testCaseId,
        criterion: group.criterion,
        perJudge: Object.freeze(perJudgeRaw),
        agreement,
        resolvedSeverity: routing.resolvedSeverity,
        escalationRoute: routing.escalationRoute,
      }),
    );
  }

  verdicts.sort(compareByTestCaseAndCriterion);
  return Object.freeze(verdicts);
};

// ---------------------------------------------------------------------------
// assertJudgePanelVerdictInvariants - boundary check for reloaded data.
// ---------------------------------------------------------------------------

const isAgreement = (value: unknown): value is JudgePanelAgreement =>
  typeof value === "string" &&
  (JUDGE_PANEL_AGREEMENT_LABELS as readonly string[]).includes(value);

const isResolvedSeverity = (
  value: unknown,
): value is JudgePanelResolvedSeverity =>
  typeof value === "string" &&
  (JUDGE_PANEL_RESOLVED_SEVERITIES as readonly string[]).includes(value);

const isEscalationRoute = (
  value: unknown,
): value is JudgePanelEscalationRoute =>
  typeof value === "string" &&
  (JUDGE_PANEL_ESCALATION_ROUTES as readonly string[]).includes(value);

const isPerJudgeVerdict = (
  value: unknown,
): value is JudgePanelPerJudgeVerdict =>
  typeof value === "string" &&
  (JUDGE_PANEL_PER_JUDGE_VERDICTS as readonly string[]).includes(value);

const assertCalibratedZeroToOne = (value: number, where: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(
      `${where}: must be a finite number in [0, 1], got ${String(value)}`,
    );
  }
};

/**
 * Validate an already-materialised {@link JudgePanelVerdict} (e.g.,
 * reloaded from disk). Throws on any structural violation; does not
 * mutate input. The Production Runner's resume path runs this check
 * before consuming the artifact.
 */
export const assertJudgePanelVerdictInvariants = (
  verdict: JudgePanelVerdict,
): void => {
  const where = `JudgePanelVerdict[${verdict.testCaseId}/${verdict.criterion}]`;
  const schemaVersion: string = verdict.schemaVersion;
  if (schemaVersion !== JUDGE_PANEL_VERDICT_SCHEMA_VERSION) {
    throw new TypeError(
      `${where}: schemaVersion must be "${JUDGE_PANEL_VERDICT_SCHEMA_VERSION}", got "${schemaVersion}"`,
    );
  }
  if (
    typeof verdict.testCaseId !== "string" ||
    verdict.testCaseId.length === 0
  ) {
    throw new TypeError(`${where}: testCaseId must be a non-empty string`);
  }
  if (typeof verdict.criterion !== "string" || verdict.criterion.length === 0) {
    throw new TypeError(`${where}: criterion must be a non-empty string`);
  }
  const perJudge: readonly JudgePanelPerJudgeVerdictRecord[] = verdict.perJudge;
  if (perJudge.length !== 2) {
    throw new TypeError(
      `${where}: perJudge must contain exactly 2 entries, got ${perJudge.length}`,
    );
  }
  for (let i = 1; i < perJudge.length; i++) {
    const prev = perJudge[i - 1];
    const cur = perJudge[i];
    if (prev === undefined || cur === undefined) {
      throw new TypeError(
        `${where}: perJudge[${i - 1}] or perJudge[${i}] is undefined`,
      );
    }
    if (prev.judgeId >= cur.judgeId) {
      throw new RangeError(
        `${where}: perJudge entries must be sorted alphabetically by judgeId; "${prev.judgeId}" before "${cur.judgeId}"`,
      );
    }
  }
  const seenJudges = new Set<string>();
  for (let i = 0; i < perJudge.length; i++) {
    const record = perJudge[i];
    if (record === undefined) {
      throw new TypeError(`${where}: perJudge[${i}] is undefined`);
    }
    if (!isJudgePanelJudgeId(record.judgeId)) {
      throw new RangeError(
        `${where}: perJudge[${i}].judgeId is not a known JudgePanelJudgeId`,
      );
    }
    if (seenJudges.has(record.judgeId)) {
      throw new RangeError(
        `${where}: duplicate judgeId "${record.judgeId}"`,
      );
    }
    seenJudges.add(record.judgeId);
    if (
      typeof record.modelBinding !== "string" ||
      record.modelBinding.length === 0
    ) {
      throw new TypeError(
        `${where}: perJudge[${i}].modelBinding must be a non-empty string`,
      );
    }
    assertCalibratedZeroToOne(
      record.score,
      `${where}: perJudge[${i}].score`,
    );
    assertCalibratedZeroToOne(
      record.calibratedScore,
      `${where}: perJudge[${i}].calibratedScore`,
    );
    if (!isPerJudgeVerdict(record.verdict)) {
      throw new RangeError(
        `${where}: perJudge[${i}].verdict is not a known JudgePanelPerJudgeVerdict`,
      );
    }
    assertReasonAcceptable(record.reason, `${where}: perJudge[${i}]`);
  }
  if (!isAgreement(verdict.agreement)) {
    throw new RangeError(
      `${where}: agreement is not a known JudgePanelAgreement`,
    );
  }
  if (!isResolvedSeverity(verdict.resolvedSeverity)) {
    throw new RangeError(
      `${where}: resolvedSeverity is not a known JudgePanelResolvedSeverity`,
    );
  }
  if (!isEscalationRoute(verdict.escalationRoute)) {
    throw new RangeError(
      `${where}: escalationRoute is not a known JudgePanelEscalationRoute`,
    );
  }

  const primary = perJudge[0];
  const secondary = perJudge[1];
  if (primary === undefined || secondary === undefined) {
    throw new TypeError(
      `${where}: perJudge must have two non-undefined entries`,
    );
  }
  if (
    primary.judgeId !== "judge_primary" ||
    secondary.judgeId !== "judge_secondary"
  ) {
    throw new RangeError(
      `${where}: perJudge must contain both "judge_primary" and "judge_secondary"`,
    );
  }
  const expectedAgreement = computeAgreement(
    primary.verdict,
    secondary.verdict,
  );
  if (expectedAgreement !== verdict.agreement) {
    throw new RangeError(
      `${where}: agreement "${verdict.agreement}" inconsistent with perJudge verdicts (expected "${expectedAgreement}")`,
    );
  }
  if (verdict.agreement === "disagree") {
    if (verdict.resolvedSeverity !== JUDGE_DISAGREE_SEVERITY) {
      throw new RangeError(
        `${where}: disagree must map to resolvedSeverity "${JUDGE_DISAGREE_SEVERITY}", got "${verdict.resolvedSeverity}"`,
      );
    }
    if (
      verdict.escalationRoute !== "downgrade" &&
      verdict.escalationRoute !== "needs_review"
    ) {
      throw new RangeError(
        `${where}: disagree must route to "downgrade" or "needs_review", got "${verdict.escalationRoute}"`,
      );
    }
  } else if (verdict.agreement === "both_pass") {
    if (verdict.resolvedSeverity !== JUDGE_BOTH_PASS_SEVERITY) {
      throw new RangeError(
        `${where}: both_pass must map to resolvedSeverity "${JUDGE_BOTH_PASS_SEVERITY}", got "${verdict.resolvedSeverity}"`,
      );
    }
    if (verdict.escalationRoute !== "accept") {
      throw new RangeError(
        `${where}: both_pass must route to "accept", got "${verdict.escalationRoute}"`,
      );
    }
  } else {
    if (verdict.resolvedSeverity !== JUDGE_BOTH_FAIL_SEVERITY) {
      throw new RangeError(
        `${where}: both_fail must map to resolvedSeverity "${JUDGE_BOTH_FAIL_SEVERITY}", got "${verdict.resolvedSeverity}"`,
      );
    }
    if (verdict.escalationRoute !== "needs_review") {
      throw new RangeError(
        `${where}: both_fail must route to "needs_review", got "${verdict.escalationRoute}"`,
      );
    }
  }
};

// ---------------------------------------------------------------------------
// Serialisation + atomic persistence.
// ---------------------------------------------------------------------------

/**
 * Serialise an array of {@link JudgePanelVerdict} records to canonical
 * JSON with a trailing newline. Round-tripping through `JSON.parse`
 * yields a structurally-equal array; the byte sequence is stable for
 * byte-identical inputs.
 */
export const serializeJudgePanelVerdicts = (
  verdicts: readonly JudgePanelVerdict[],
): string => `${canonicalJson(verdicts)}\n`;

export interface WriteJudgePanelVerdictsInput {
  readonly runDir: string;
  readonly verdicts: readonly JudgePanelVerdict[];
}

export interface WriteJudgePanelVerdictsResult {
  readonly artifactPath: string;
  readonly serialised: string;
  readonly verdicts: readonly JudgePanelVerdict[];
}

/**
 * Atomically write the per-run verdict artifact to
 * `<runDir>/judge-panel-verdicts.json`. Uses the temp-file + rename
 * pattern in use by the per-step rollup writer so a crash never
 * leaves a half-written file behind.
 *
 * The function refuses an empty `verdicts` array - the harness must
 * either skip the artifact entirely (no `semantic_judge` step ran)
 * or feed at least one verdict. It also revalidates every record via
 * {@link assertJudgePanelVerdictInvariants} before serialisation, so
 * a bad-shape verdict never reaches disk.
 */
export const writeJudgePanelVerdicts = async (
  input: WriteJudgePanelVerdictsInput,
): Promise<WriteJudgePanelVerdictsResult> => {
  if (typeof input.runDir !== "string" || input.runDir.trim().length === 0) {
    throw new TypeError(
      "writeJudgePanelVerdicts: runDir must be a non-empty string",
    );
  }
  if (input.verdicts.length === 0) {
    throw new TypeError(
      "writeJudgePanelVerdicts: verdicts must be a non-empty array",
    );
  }
  for (let i = 0; i < input.verdicts.length; i++) {
    const verdict = input.verdicts[i];
    if (verdict === undefined) {
      throw new TypeError(
        `writeJudgePanelVerdicts: verdicts[${i}] is undefined`,
      );
    }
    assertJudgePanelVerdictInvariants(verdict);
  }
  for (let i = 1; i < input.verdicts.length; i++) {
    const prev = input.verdicts[i - 1];
    const cur = input.verdicts[i];
    if (prev === undefined || cur === undefined) {
      throw new TypeError(
        `writeJudgePanelVerdicts: verdicts[${i - 1}] or verdicts[${i}] is undefined`,
      );
    }
    if (compareByTestCaseAndCriterion(prev, cur) >= 0) {
      throw new RangeError(
        `writeJudgePanelVerdicts: verdicts must be sorted by (testCaseId, criterion) ascending`,
      );
    }
  }

  const serialised = serializeJudgePanelVerdicts(input.verdicts);
  const finalPath = join(input.runDir, JUDGE_PANEL_VERDICTS_ARTIFACT_FILENAME);
  const tmpPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(input.runDir, { recursive: true });
  await writeFile(tmpPath, serialised, "utf8");
  await rename(tmpPath, finalPath);

  return Object.freeze({
    artifactPath: finalPath,
    serialised,
    verdicts: input.verdicts,
  });
};

// ---------------------------------------------------------------------------
// Type guards re-exposed for caller use.
// ---------------------------------------------------------------------------

/** Type guard for {@link JudgePanelJudgeId}. */
export const isJudgeId = (value: unknown): value is JudgePanelJudgeId =>
  isJudgePanelJudgeId(value);

/** Type guard for {@link JudgePanelAgreement}. */
export const isJudgePanelAgreement = (
  value: unknown,
): value is JudgePanelAgreement => isAgreement(value);

/** Type guard for {@link JudgePanelEscalationRoute}. */
export const isJudgePanelEscalationRoute = (
  value: unknown,
): value is JudgePanelEscalationRoute => isEscalationRoute(value);

/** Type guard for {@link JudgePanelResolvedSeverity}. */
export const isJudgePanelResolvedSeverity = (
  value: unknown,
): value is JudgePanelResolvedSeverity => isResolvedSeverity(value);

/** Type guard for {@link JudgePanelPerJudgeVerdict}. */
export const isJudgePanelPerJudgeVerdict = (
  value: unknown,
): value is JudgePanelPerJudgeVerdict => isPerJudgeVerdict(value);
