/**
 * Cross-family judge ensemble policy (Issue #2038).
 *
 * The cross-family policy is a deterministic, pure-function gate over
 * the judge panel about to score a run. It enforces the Issue #2038
 * acceptance criteria without taking a runtime dependency on the
 * gateway, the FinOps recorder, or the production runner state
 * machine.
 *
 * Hard invariants the policy guarantees:
 *
 *   - Every binding declares a known {@link JudgeModelFamily}.
 *   - No two judge roles in the same run share a family unless the
 *     caller passes an explicit `allowSharedFamily` override.
 *   - Under `requireEuRegion`, every binding's `region` must be `"eu"`.
 *   - The policy classifies the panel's verdicts into a deterministic
 *     {@link JudgeDisagreementDecisionLabel} and emits an
 *     {@link JudgeDisagreementEscalationAction} matching AT-2038.
 *
 * The module is import-only: it has no I/O, no clocks, and no
 * persistence. Callers that need to persist results feed the result
 * through `judge-disagreement-report.ts`.
 */

import {
  HUMAN_REVIEW_REVIEWER_KINDS,
  JUDGE_MODEL_FAMILIES,
  JUDGE_MODEL_REGIONS,
  type JudgeDisagreementDecisionLabel,
  type JudgeDisagreementEscalationAction,
  type JudgeModelFamily,
  type JudgeModelRegion,
  type LogicJudgeVerdictLabel,
} from "../contracts/index.js";

// ---------------------------------------------------------------------------
// Public input shapes.
// ---------------------------------------------------------------------------

/** One judge binding under evaluation by the cross-family policy. */
export interface JudgeFamilyBinding {
  /** Stable judge identifier (e.g., `"logic_judge"`). */
  readonly judgeId: string;
  /** Model-family marker. Must be one of {@link JUDGE_MODEL_FAMILIES}. */
  readonly family: JudgeModelFamily;
  /** Stable model identifier (e.g., `"claude-3.5-sonnet"`). */
  readonly modelId: string;
  /** Pinned prompt-template version. */
  readonly promptVersion: string;
  /** Deployment region marker. */
  readonly region: JudgeModelRegion;
  /** Verdict cast by this judge in the run. */
  readonly verdict: LogicJudgeVerdictLabel;
}

/** Optional configuration consumed by the policy. */
export interface CrossFamilyJudgePolicyOptions {
  /**
   * If true, the same family may back two roles in the same run.
   * Default: `false` (Issue #2038 spec).
   */
  readonly allowSharedFamily?: boolean;
  /**
   * If true, every binding's `region` must equal `"eu"`. Default
   * `false`. The `eu-banking-default` policy profile sets this to
   * `true` via {@link assertEuResidency}.
   */
  readonly requireEuRegion?: boolean;
  /**
   * Family that should win a 2:1 split if the lone dissenter belongs
   * to it (Issue #2038 spec: "the most-trusted family for that
   * case-class"). When unset the lone-dissenter rule is not applied.
   */
  readonly mostTrustedFamily?: JudgeModelFamily;
}

/** Result returned by {@link assessCrossFamilyPanel}. */
export interface CrossFamilyJudgePolicyResult {
  readonly decision: JudgeDisagreementDecisionLabel;
  readonly escalation: JudgeDisagreementEscalationAction;
  readonly disagreementRate: number;
  readonly escalationRate: number;
  /**
   * Verdict the panel resolved to (majority, unanimous, or `"repair"`
   * for splits). Mirrors `judge-consensus.ts` semantics.
   */
  readonly resolvedVerdict: LogicJudgeVerdictLabel;
  /** Distinct families used in the run, sorted alphabetically. */
  readonly families: readonly JudgeModelFamily[];
}

// ---------------------------------------------------------------------------
// Validation helpers.
// ---------------------------------------------------------------------------

const HEX_64 = /^[0-9a-f]{64}$/u;

/** Type guard for {@link JudgeModelFamily}. */
export const isJudgeModelFamily = (value: unknown): value is JudgeModelFamily =>
  typeof value === "string" &&
  (JUDGE_MODEL_FAMILIES as readonly string[]).includes(value);

/** Type guard for {@link JudgeModelRegion}. */
export const isJudgeModelRegion = (value: unknown): value is JudgeModelRegion =>
  typeof value === "string" &&
  (JUDGE_MODEL_REGIONS as readonly string[]).includes(value);

/** Type guard for {@link HUMAN_REVIEW_REVIEWER_KINDS}. */
export const isHumanReviewReviewerKind = (
  value: unknown,
): value is (typeof HUMAN_REVIEW_REVIEWER_KINDS)[number] =>
  typeof value === "string" &&
  (HUMAN_REVIEW_REVIEWER_KINDS as readonly string[]).includes(value);

/** Type guard for a 64-char lowercase hex string (sha256 anchor). */
export const isHex64 = (value: unknown): value is string =>
  typeof value === "string" && HEX_64.test(value);

const assertBinding = (
  binding: JudgeFamilyBinding,
  index: number,
): void => {
  const where = `assessCrossFamilyPanel: bindings[${index}]`;
  if (typeof binding.judgeId !== "string" || binding.judgeId.length === 0) {
    throw new TypeError(`${where}: judgeId must be a non-empty string`);
  }
  if (!isJudgeModelFamily(binding.family)) {
    throw new RangeError(
      `${where}: family "${String(binding.family)}" is not a known JudgeModelFamily`,
    );
  }
  if (!isJudgeModelRegion(binding.region)) {
    throw new RangeError(
      `${where}: region "${String(binding.region)}" is not a known JudgeModelRegion`,
    );
  }
  if (typeof binding.modelId !== "string" || binding.modelId.length === 0) {
    throw new TypeError(`${where}: modelId must be a non-empty string`);
  }
  if (
    typeof binding.promptVersion !== "string" ||
    binding.promptVersion.length === 0
  ) {
    throw new TypeError(`${where}: promptVersion must be a non-empty string`);
  }
  const verdict: string = binding.verdict;
  if (verdict !== "accept" && verdict !== "repair" && verdict !== "reject") {
    throw new RangeError(
      `${where}: verdict "${verdict}" is not a known LogicJudgeVerdictLabel`,
    );
  }
};

// ---------------------------------------------------------------------------
// Cross-family invariant.
// ---------------------------------------------------------------------------

/**
 * Throw when two bindings declare the same family. Default behavior;
 * callers can override by passing `allowSharedFamily: true`.
 */
export const assertCrossFamilyInvariant = (
  bindings: readonly JudgeFamilyBinding[],
  options: { readonly allowSharedFamily?: boolean } = {},
): void => {
  if (options.allowSharedFamily === true) {
    return;
  }
  const seen = new Map<JudgeModelFamily, string>();
  for (const binding of bindings) {
    const owner = seen.get(binding.family);
    if (owner !== undefined && owner !== binding.judgeId) {
      throw new RangeError(
        `assertCrossFamilyInvariant: family "${binding.family}" is bound by both "${owner}" and "${binding.judgeId}". ` +
          `Cross-family ensembles must source each judge role from a distinct model family. ` +
          `Set { allowSharedFamily: true } to override (audit-only).`,
      );
    }
    seen.set(binding.family, binding.judgeId);
  }
};

/**
 * Throw when any binding's region is not `"eu"`. The
 * `eu-banking-default` policy profile uses this guard before running
 * the judge panel; non-EU endpoints are refused (DORA Article 28,
 * BaFin VAIT residency expectations).
 */
export const assertEuResidency = (
  bindings: readonly JudgeFamilyBinding[],
): void => {
  for (const binding of bindings) {
    if (binding.region !== "eu") {
      throw new RangeError(
        `assertEuResidency: judge "${binding.judgeId}" binds family "${binding.family}" ` +
          `to region "${binding.region}". The eu-banking-default profile only accepts EU-region endpoints.`,
      );
    }
  }
};

// ---------------------------------------------------------------------------
// Quorum + disagreement classification.
// ---------------------------------------------------------------------------

const VERDICT_RANK: Record<LogicJudgeVerdictLabel, number> = {
  reject: 2,
  repair: 1,
  accept: 0,
};

const tallyVerdicts = (
  bindings: readonly JudgeFamilyBinding[],
): Record<LogicJudgeVerdictLabel, number> => {
  const totals: Record<LogicJudgeVerdictLabel, number> = {
    accept: 0,
    repair: 0,
    reject: 0,
  };
  for (const binding of bindings) {
    totals[binding.verdict]++;
  }
  return totals;
};

const distinctVerdicts = (
  totals: Record<LogicJudgeVerdictLabel, number>,
): readonly LogicJudgeVerdictLabel[] =>
  (Object.entries(totals) as Array<[LogicJudgeVerdictLabel, number]>)
    .filter(([, count]) => count > 0)
    .map(([label]) => label);

const pickHigherSeverity = (
  candidates: readonly LogicJudgeVerdictLabel[],
): LogicJudgeVerdictLabel => {
  if (candidates.length === 0) {
    throw new RangeError("pickHigherSeverity: candidates must be non-empty");
  }
  const sorted = [...candidates].sort(
    (a, b) => VERDICT_RANK[b] - VERDICT_RANK[a],
  );
  return sorted[0]!;
};

/**
 * Classify a set of judge verdicts into a
 * {@link JudgeDisagreementDecisionLabel}. The rule:
 *
 *   - All three judges agree, verdict in `{accept, repair, reject}`
 *     -> `unanimous_accept` / `unanimous_repair` / `unanimous_reject`.
 *   - Two-out-of-three same verdict -> `majority_decision`.
 *   - Three distinct verdicts (1:1:1) -> `split_decision`.
 *   - Panel size != 3 falls back to `majority_decision` if a strict
 *     majority exists, otherwise `split_decision`. Issue #2038's spec
 *     targets a 3-judge panel; we keep larger panels working too.
 */
export const classifyDecision = (
  bindings: readonly JudgeFamilyBinding[],
): JudgeDisagreementDecisionLabel => {
  const totals = tallyVerdicts(bindings);
  const distinct = distinctVerdicts(totals);
  if (distinct.length === 1) {
    const [only] = distinct;
    if (only === "accept") return "unanimous_accept";
    if (only === "repair") return "unanimous_repair";
    return "unanimous_reject";
  }
  if (distinct.length === 3) {
    return "split_decision";
  }
  const max = Math.max(totals.accept, totals.repair, totals.reject);
  const tied = distinct.filter((label) => totals[label] === max);
  if (tied.length === 1) {
    return "majority_decision";
  }
  return "split_decision";
};

/**
 * Compute the verdict the panel resolves to using deterministic
 * quorum voting. The rule mirrors `judge-consensus.ts`:
 *
 *   - Strict majority -> majority verdict wins.
 *   - Tie containing `repair` -> `repair`.
 *   - Tie of `accept` and `reject` only -> `repair` (defensive
 *     downgrade — never silently accept a rejected case).
 *   - Otherwise pick the highest-severity tied verdict.
 */
export const resolveQuorumVerdict = (
  bindings: readonly JudgeFamilyBinding[],
): LogicJudgeVerdictLabel => {
  if (bindings.length === 0) {
    throw new RangeError(
      "resolveQuorumVerdict: bindings must be a non-empty array",
    );
  }
  const totals = tallyVerdicts(bindings);
  const max = Math.max(totals.accept, totals.repair, totals.reject);
  const tied = distinctVerdicts(totals).filter((label) => totals[label] === max);
  if (tied.length === 1) {
    return tied[0]!;
  }
  if (tied.includes("repair")) {
    return "repair";
  }
  if (tied.includes("accept") && tied.includes("reject")) {
    return "repair";
  }
  return pickHigherSeverity(tied);
};

/**
 * Compute the count of dissenting judges (judges whose verdict !=
 * resolvedVerdict). When all agree this is 0.
 */
const countDissenters = (
  bindings: readonly JudgeFamilyBinding[],
  resolvedVerdict: LogicJudgeVerdictLabel,
): number =>
  bindings.reduce(
    (sum, binding) => (binding.verdict === resolvedVerdict ? sum : sum + 1),
    0,
  );

/**
 * Apply the Issue #2038 escalation rule. `human_review_required` is
 * emitted when:
 *
 *   - The decision is `split_decision` (1:1:1), OR
 *   - The decision is `majority_decision` AND the lone dissenter
 *     belongs to `mostTrustedFamily` for the case-class.
 *
 * Unanimous decisions never escalate.
 */
const computeEscalation = (
  decision: JudgeDisagreementDecisionLabel,
  bindings: readonly JudgeFamilyBinding[],
  resolvedVerdict: LogicJudgeVerdictLabel,
  mostTrustedFamily: JudgeModelFamily | undefined,
): JudgeDisagreementEscalationAction => {
  if (decision === "split_decision") {
    return "human_review_required";
  }
  if (decision === "majority_decision" && mostTrustedFamily !== undefined) {
    const dissenters = bindings.filter(
      (binding) => binding.verdict !== resolvedVerdict,
    );
    if (
      dissenters.length === 1 &&
      dissenters[0]!.family === mostTrustedFamily
    ) {
      return "human_review_required";
    }
  }
  return "none";
};

/**
 * Run the full cross-family policy: validation, quorum vote,
 * disagreement classification, escalation, and metadata roll-up.
 */
export const assessCrossFamilyPanel = (
  bindings: readonly JudgeFamilyBinding[],
  options: CrossFamilyJudgePolicyOptions = {},
): CrossFamilyJudgePolicyResult => {
  if (bindings.length === 0) {
    throw new RangeError(
      "assessCrossFamilyPanel: bindings must be a non-empty array",
    );
  }
  if (
    options.mostTrustedFamily !== undefined &&
    !isJudgeModelFamily(options.mostTrustedFamily)
  ) {
    throw new RangeError(
      `assessCrossFamilyPanel: options.mostTrustedFamily "${String(options.mostTrustedFamily)}" is not a known JudgeModelFamily`,
    );
  }
  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i];
    if (binding === undefined) {
      throw new TypeError(
        `assessCrossFamilyPanel: bindings[${i}] is undefined`,
      );
    }
    assertBinding(binding, i);
  }
  assertCrossFamilyInvariant(bindings, {
    allowSharedFamily: options.allowSharedFamily === true,
  });
  if (options.requireEuRegion === true) {
    assertEuResidency(bindings);
  }
  const decision = classifyDecision(bindings);
  const resolvedVerdict = resolveQuorumVerdict(bindings);
  const escalation = computeEscalation(
    decision,
    bindings,
    resolvedVerdict,
    options.mostTrustedFamily,
  );
  const families = Array.from(
    new Set(bindings.map((binding) => binding.family)),
  ).sort();
  const disagreementRate =
    countDissenters(bindings, resolvedVerdict) / bindings.length;
  const escalationRate = escalation === "none" ? 0 : 1;
  return Object.freeze({
    decision,
    escalation,
    disagreementRate,
    escalationRate,
    resolvedVerdict,
    families: Object.freeze(families),
  });
};

