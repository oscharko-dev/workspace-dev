/**
 * Cost-aware task classifier (Issue #2043).
 *
 * Deterministic, zero-LLM service that inspects each task in the
 * multi-agent workflow and classifies it into a complexity tier
 * (`tier-low`, `tier-mid`, `tier-high`). The result is consumed by the
 * routing layer (`routing-table.ts`) which maps the tier to a concrete
 * model deployment per environment and policy profile.
 *
 * Design:
 *
 * - Heuristic-first. The issue out-of-scope explicitly excludes
 *   reinforcement-learning routers; the registered classifier is a
 *   small, hand-written ruleset whose decisions are reproducible from
 *   the input alone. A deterministic classifier is strictly cheaper
 *   than tier-low ("the classifier itself runs at tier-low (cheap),
 *   avoiding routing-to-decide-routing cost spirals" — zero LLM cost
 *   beats any LLM-based classifier).
 *
 * - Decisions are stable. Running the classifier twice on the same
 *   input always produces the same `(tier, rationale)` pair so the
 *   FinOps replay-cache and the routing decisions persisted in
 *   `agent-participation.json` stay byte-stable.
 *
 * - Decisions are explainable. Every output carries a one-line
 *   rationale built from the input signals so an auditor can reconcile
 *   "why was this task routed to a small model?" without re-running
 *   the classifier.
 *
 * - Decisions never escalate downward in safety. When a task has
 *   conflicting signals (e.g. "regulatory_inference" but small input
 *   token estimate), the classifier picks the *higher* tier so the
 *   regulatory check is never silently routed to a cheap model. The
 *   savings target (>= 50%) is hit by the bulk of `tier-low` traffic,
 *   not by trimming high-stakes calls.
 *
 * The classifier is implemented as a deterministic_service in the
 * style of the compliance annotator (Issue #2042), so the harness's
 * hard invariants on `AgentHarnessRole` profiles remain unchanged. The
 * registered identifier is `task_classifier`.
 */

/**
 * Closed runtime list of complexity tiers. Order is from cheapest to
 * most capable; consumers that need a max-tier comparison can rely on
 * `compareTaskComplexityTier`.
 */
export const TASK_COMPLEXITY_TIERS = [
  "tier-low",
  "tier-mid",
  "tier-high",
] as const;

/** Discriminant of {@link TASK_COMPLEXITY_TIERS}. */
export type TaskComplexityTier = (typeof TASK_COMPLEXITY_TIERS)[number];

/**
 * Closed runtime list of task kinds the classifier knows about. The
 * vocabulary is deliberately small and stable so the routing table
 * indexed by `(profile, tier)` does not need to evolve when new
 * task kinds are introduced — new kinds map onto an existing tier.
 */
export const TASK_CLASSIFIER_TASK_KINDS = [
  "simple_ui_validation",
  "standard_business_logic",
  "complex_calculation",
  "regulatory_inference",
  "vision",
  "adversarial_critique",
  "judge_panel",
  "repair_planning",
] as const;

/** Discriminant of {@link TASK_CLASSIFIER_TASK_KINDS}. */
export type TaskClassifierTaskKind =
  (typeof TASK_CLASSIFIER_TASK_KINDS)[number];

/** Stable role identifier for the deterministic classifier service. */
export const TASK_CLASSIFIER_ROLE_ID = "task_classifier" as const;

/** Stable classifier ruleset version. Bump on rule changes. */
export const TASK_CLASSIFIER_VERSION = "1.0.0" as const;

/**
 * Default sampling rate for the cross-family quality regression check
 * applied to `tier-low` decisions. The downstream
 * `cost-routing-quality-sampler` re-judges this fraction of tier-low
 * outputs with a higher-tier panel and flags regressions.
 */
export const DEFAULT_TIER_LOW_QUALITY_SAMPLE_RATE = 0.1 as const;

/**
 * Default acceptable regression rate among the tier-low quality
 * sample. Anything strictly above this is treated as a regression and
 * fails the CI gate.
 */
export const DEFAULT_TIER_LOW_QUALITY_REGRESSION_THRESHOLD = 0.05 as const;

/**
 * Input signals the classifier consumes. Every field is optional; the
 * classifier degrades to `tier-mid` (the safe default) when no signals
 * are supplied. Callers should populate as many fields as the run
 * context surfaces — more signals yield more accurate routing.
 */
export interface TaskClassificationInput {
  /** Stable identifier for the task, used to correlate decisions to runs. */
  readonly taskId: string;
  /**
   * Logical task kind. When supplied this is the primary signal —
   * other signals can only escalate the tier upward, never downward.
   */
  readonly taskKind?: TaskClassifierTaskKind;
  /**
   * Optional harness role label. Useful when `taskKind` is not yet
   * known; the classifier maps known role labels onto a kind.
   */
  readonly role?: string;
  /** True when the task has a screenshot or visual asset attached. */
  readonly hasVisualInput?: boolean;
  /** True when the task involves multi-step calculation logic. */
  readonly isCalculationLogic?: boolean;
  /**
   * True when the task carries regulatory / compliance reasoning.
   * Forces tier-high to keep audit-grade reasoning on flagship models.
   */
  readonly isRegulatoryInference?: boolean;
  /**
   * True when the task is a structural / surface-level UI check that
   * does not require reasoning over business rules.
   */
  readonly isSimpleUiValidation?: boolean;
  /** Estimated input tokens. Used as a tiebreaker between tier-low / tier-mid. */
  readonly estimatedInputTokens?: number;
  /** Estimated output tokens. Used as a tiebreaker. */
  readonly estimatedOutputTokens?: number;
  /**
   * Constrained-decoding compatibility flag. When `false` the
   * classifier never selects `tier-low`, because tier-low deployments
   * have weaker schema adherence and the issue mandates that
   * tier-low + constrained decoding compose. The default is `true`.
   */
  readonly constrainedDecodingAvailable?: boolean;
}

/**
 * The classifier's decision for one task. Carries enough context for
 * the routing layer plus the FinOps savings audit.
 */
export interface TaskClassificationDecision {
  readonly classifierVersion: typeof TASK_CLASSIFIER_VERSION;
  readonly classifierRoleId: typeof TASK_CLASSIFIER_ROLE_ID;
  readonly taskId: string;
  readonly resolvedTaskKind: TaskClassifierTaskKind;
  readonly tier: TaskComplexityTier;
  /** One-line, human-readable explanation. Stable for a given input. */
  readonly rationale: string;
  /**
   * The ordered list of signals that fired during classification.
   * Useful for downstream evaluation tooling that wants to compute
   * routing metrics per signal.
   */
  readonly signals: readonly string[];
  /** Optional originating role label echoed back from the input. */
  readonly role?: string;
}

const TIER_RANK: Readonly<Record<TaskComplexityTier, number>> = Object.freeze({
  "tier-low": 0,
  "tier-mid": 1,
  "tier-high": 2,
});

/** Compare two tiers by capability rank. Negative when `a` is cheaper. */
export const compareTaskComplexityTier = (
  a: TaskComplexityTier,
  b: TaskComplexityTier,
): number => TIER_RANK[a] - TIER_RANK[b];

/** Pick the higher (more capable) tier of `a` and `b`. */
export const maxTaskComplexityTier = (
  a: TaskComplexityTier,
  b: TaskComplexityTier,
): TaskComplexityTier => (compareTaskComplexityTier(a, b) >= 0 ? a : b);

/** Type guard for {@link TaskComplexityTier}. */
export const isTaskComplexityTier = (
  value: unknown,
): value is TaskComplexityTier =>
  typeof value === "string" &&
  (TASK_COMPLEXITY_TIERS as readonly string[]).includes(value);

/** Type guard for {@link TaskClassifierTaskKind}. */
export const isTaskClassifierTaskKind = (
  value: unknown,
): value is TaskClassifierTaskKind =>
  typeof value === "string" &&
  (TASK_CLASSIFIER_TASK_KINDS as readonly string[]).includes(value);

const ROLE_TO_TASK_KIND: Readonly<Record<string, TaskClassifierTaskKind>> =
  Object.freeze({
    generator: "standard_business_logic",
    logic_judge: "judge_panel",
    semantic_judge: "judge_panel",
    adversarial_critic: "adversarial_critique",
    adversarial_gap_finder: "adversarial_critique",
    repair_planner: "repair_planning",
    visual_sidecar: "vision",
    action_topology: "simple_ui_validation",
    final_verifier: "simple_ui_validation",
    human_review: "simple_ui_validation",
    coverage_planner: "standard_business_logic",
    risk_ranker: "standard_business_logic",
    a11y_judge: "simple_ui_validation",
    visual_primary: "vision",
    visual_fallback: "vision",
    test_generation_repair: "repair_planning",
  });

const TASK_KIND_BASE_TIER: Readonly<
  Record<TaskClassifierTaskKind, TaskComplexityTier>
> = Object.freeze({
  simple_ui_validation: "tier-low",
  standard_business_logic: "tier-mid",
  complex_calculation: "tier-high",
  regulatory_inference: "tier-high",
  vision: "tier-mid",
  adversarial_critique: "tier-mid",
  judge_panel: "tier-mid",
  repair_planning: "tier-mid",
});

const SMALL_INPUT_TOKEN_THRESHOLD = 1_000;
const LARGE_INPUT_TOKEN_THRESHOLD = 16_000;
const LARGE_OUTPUT_TOKEN_THRESHOLD = 4_000;

/**
 * Classify a single task. Pure: same input always produces the same
 * decision. Throws `TypeError` when `taskId` is empty.
 */
export const classifyTask = (
  input: TaskClassificationInput,
): TaskClassificationDecision => {
  if (typeof input.taskId !== "string" || input.taskId.length === 0) {
    throw new TypeError("classifyTask: taskId must be a non-empty string");
  }
  const signals: string[] = [];

  const resolvedTaskKind = resolveTaskKind(input);
  signals.push(`taskKind=${resolvedTaskKind}`);

  let tier: TaskComplexityTier = TASK_KIND_BASE_TIER[resolvedTaskKind];
  signals.push(`baseTier=${tier}`);

  // Hard escalations — never go below `tier-high` for these.
  if (input.isRegulatoryInference === true) {
    tier = maxTaskComplexityTier(tier, "tier-high");
    signals.push("regulatoryInference→tier-high");
  }
  if (input.isCalculationLogic === true) {
    tier = maxTaskComplexityTier(tier, "tier-high");
    signals.push("calculationLogic→tier-high");
  }
  if (
    typeof input.estimatedInputTokens === "number" &&
    input.estimatedInputTokens > LARGE_INPUT_TOKEN_THRESHOLD
  ) {
    tier = maxTaskComplexityTier(tier, "tier-mid");
    signals.push(
      `largeInput(${input.estimatedInputTokens}>${LARGE_INPUT_TOKEN_THRESHOLD})→≥tier-mid`,
    );
  }
  if (
    typeof input.estimatedOutputTokens === "number" &&
    input.estimatedOutputTokens > LARGE_OUTPUT_TOKEN_THRESHOLD
  ) {
    tier = maxTaskComplexityTier(tier, "tier-mid");
    signals.push(
      `largeOutput(${input.estimatedOutputTokens}>${LARGE_OUTPUT_TOKEN_THRESHOLD})→≥tier-mid`,
    );
  }
  if (input.hasVisualInput === true) {
    tier = maxTaskComplexityTier(tier, "tier-mid");
    signals.push("visualInput→≥tier-mid");
  }

  // Soft de-escalation toward `tier-low`. Only fires when no
  // escalation has bumped the tier above `tier-mid` and the task is
  // explicitly a small UI check or has a small token footprint.
  const constrainedAvailable = input.constrainedDecodingAvailable !== false;
  if (
    tier === "tier-mid" &&
    constrainedAvailable &&
    (input.isSimpleUiValidation === true ||
      (resolvedTaskKind === "simple_ui_validation" &&
        (typeof input.estimatedInputTokens !== "number" ||
          input.estimatedInputTokens <= SMALL_INPUT_TOKEN_THRESHOLD)))
  ) {
    tier = "tier-low";
    signals.push("simpleUiValidation+smallTokens→tier-low");
  } else if (tier === "tier-low" && !constrainedAvailable) {
    tier = "tier-mid";
    signals.push("constrainedDecodingUnavailable→escalate-to-tier-mid");
  }

  const rationale = buildRationale(resolvedTaskKind, tier, signals);
  const decision: TaskClassificationDecision = {
    classifierVersion: TASK_CLASSIFIER_VERSION,
    classifierRoleId: TASK_CLASSIFIER_ROLE_ID,
    taskId: input.taskId,
    resolvedTaskKind,
    tier,
    rationale,
    signals: Object.freeze([...signals]),
    ...(typeof input.role === "string" && input.role.length > 0
      ? { role: input.role }
      : {}),
  };
  return Object.freeze(decision);
};

const resolveTaskKind = (
  input: TaskClassificationInput,
): TaskClassifierTaskKind => {
  if (input.taskKind !== undefined) return input.taskKind;
  if (input.isRegulatoryInference === true) return "regulatory_inference";
  if (input.isCalculationLogic === true) return "complex_calculation";
  if (input.hasVisualInput === true) return "vision";
  if (typeof input.role === "string" && ROLE_TO_TASK_KIND[input.role] !== undefined) {
    return ROLE_TO_TASK_KIND[input.role]!;
  }
  if (input.isSimpleUiValidation === true) return "simple_ui_validation";
  return "standard_business_logic";
};

const buildRationale = (
  taskKind: TaskClassifierTaskKind,
  tier: TaskComplexityTier,
  signals: readonly string[],
): string => {
  const decisive = signals.find((s) => s.includes("→")) ?? `baseTier=${tier}`;
  return `task_kind=${taskKind} tier=${tier} via=${decisive}`;
};

/**
 * Classify a batch of tasks. Order of input is preserved in the output;
 * each decision is independent (no batch-level coupling).
 */
export const classifyTaskBatch = (
  inputs: readonly TaskClassificationInput[],
): readonly TaskClassificationDecision[] => {
  const decisions = inputs.map((input) => classifyTask(input));
  return Object.freeze(decisions);
};

/**
 * Stable string key derived from the resolved task kind + tier. Useful
 * for downstream cost-savings rollups that want to group decisions by
 * (kind, tier).
 */
export const taskClassificationGroupKey = (
  decision: TaskClassificationDecision,
): string => `${decision.resolvedTaskKind}::${decision.tier}`;
