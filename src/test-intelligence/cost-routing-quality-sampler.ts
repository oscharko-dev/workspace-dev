/**
 * Cost-aware routing quality sampler (Issue #2043).
 *
 * Wave-2 cross-family judge sampling for `tier-low` decisions. The
 * routing layer can only claim "no quality regression" if it actively
 * inspects the cheap deployments — otherwise a silent quality drop
 * would hide behind the headline cost win.
 *
 * Pipeline:
 *
 *   1. Pick a deterministic sample of `tier-low` decisions (using a
 *      seeded shuffle so the sample is reproducible across CI runs).
 *   2. Re-judge the sampled outputs with a cross-family panel
 *      (typically the existing Wave-2 cross-family judge ensemble
 *      configured in `cross-family-judge-policy.ts`).
 *   3. Compute the regression rate — fraction of samples where the
 *      tier-low output disagrees with the higher-tier baseline above
 *      a configured tolerance.
 *   4. Compare the rate against a configurable threshold and emit a
 *      `RoutingQualityRegressionReport`. The CI gate consumes the
 *      report and fails the build when the rate is breached.
 *
 * The module ships the deterministic sampling + scoring; selecting
 * the actual judges is an integration concern handled by
 * `cross-family-judge-policy.ts`.
 */

import {
  TASK_COMPLEXITY_TIERS,
  type TaskClassificationDecision,
  type TaskComplexityTier,
} from "./task-classifier-agent.js";

/** Schema version literal stamped on every regression report. */
export const ROUTING_QUALITY_REGRESSION_REPORT_SCHEMA_VERSION = "1.0.0" as const;

/** Stable artifact filename for the regression report. */
export const ROUTING_QUALITY_REGRESSION_REPORT_ARTIFACT_FILENAME =
  "routing-quality-regression-report.json" as const;

/**
 * Verdict on a single sampled tier-low decision. The shape is
 * deliberately small — the sampler does not need the full judge
 * panel verdict, only "did the cheap deployment regress relative to
 * the baseline?".
 */
export interface RoutingQualityVerdict {
  readonly taskId: string;
  /** Score in `[0, 1]` from the higher-tier baseline judge. */
  readonly baselineScore: number;
  /** Score in `[0, 1]` from re-judging the tier-low output. */
  readonly routedScore: number;
}

/** Single regression observation derived from the verdict pair. */
export interface RoutingQualityRegressionEntry {
  readonly taskId: string;
  readonly baselineScore: number;
  readonly routedScore: number;
  /** `baselineScore - routedScore`, clamped to `[-1, 1]`. */
  readonly delta: number;
  /** True when `delta > tolerance`. */
  readonly regressed: boolean;
}

/** Run-level regression report. */
export interface RoutingQualityRegressionReport {
  readonly schemaVersion: typeof ROUTING_QUALITY_REGRESSION_REPORT_SCHEMA_VERSION;
  readonly jobId: string;
  readonly generatedAt: string;
  readonly tier: "tier-low";
  readonly tolerance: number;
  readonly sampleSize: number;
  readonly regressionCount: number;
  readonly regressionRate: number;
  readonly threshold: number;
  readonly passed: boolean;
  readonly entries: readonly RoutingQualityRegressionEntry[];
}

/** Input for {@link sampleTierLowDecisions}. */
export interface SampleTierLowDecisionsInput {
  readonly decisions: readonly TaskClassificationDecision[];
  /** Sampling rate in `[0, 1]`. Throws when out of range. */
  readonly sampleRate: number;
  /** Seed used by the deterministic shuffle. Defaults to `0`. */
  readonly seed?: number;
  /** Minimum sample size — applied as a floor when the rate would round to zero. */
  readonly minimumSampleSize?: number;
}

/**
 * Mulberry32 PRNG — small, deterministic, no external dependencies.
 * Produces a `() => number` generator in `[0, 1)`.
 */
const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Deterministic Fisher–Yates shuffle. Returns a fresh array; the
 * input is not mutated.
 */
const shuffleDeterministic = <T>(items: readonly T[], seed: number): T[] => {
  const out = [...items];
  const rng = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
};

/**
 * Pick a deterministic sample of `tier-low` decisions for cross-family
 * regression checking. Returns the chosen decisions in stable
 * `taskId`-sorted order so downstream replay caches stay byte-stable.
 */
export const sampleTierLowDecisions = (
  input: SampleTierLowDecisionsInput,
): readonly TaskClassificationDecision[] => {
  if (
    !Number.isFinite(input.sampleRate) ||
    input.sampleRate < 0 ||
    input.sampleRate > 1
  ) {
    throw new RangeError(
      "sampleTierLowDecisions: sampleRate must be in [0, 1]",
    );
  }

  const tierLow = input.decisions.filter((d) => d.tier === "tier-low");
  if (tierLow.length === 0) return [];

  const minSize = Math.max(0, Math.floor(input.minimumSampleSize ?? 0));
  const target = Math.max(
    Math.min(tierLow.length, minSize),
    Math.ceil(tierLow.length * input.sampleRate),
  );
  if (target === 0) return [];

  const shuffled = shuffleDeterministic(tierLow, input.seed ?? 0);
  const picked = shuffled.slice(0, target);
  picked.sort((a, b) => a.taskId.localeCompare(b.taskId));
  return Object.freeze(picked);
};

const clampScore = (value: number, fallback = 0): number => {
  if (!Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const clampDelta = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value < -1) return -1;
  if (value > 1) return 1;
  return value;
};

/** Input for {@link evaluateTierLowRegression}. */
export interface EvaluateTierLowRegressionInput {
  readonly jobId: string;
  readonly generatedAt: string;
  readonly verdicts: readonly RoutingQualityVerdict[];
  /**
   * Quality drop above which a sample is counted as regressed.
   * Defaults to `0.05` — five percentage points.
   */
  readonly tolerance?: number;
  /**
   * Maximum acceptable regression rate among the sample. Defaults
   * to `0.05`. CI fails when the observed rate strictly exceeds the
   * threshold.
   */
  readonly threshold?: number;
}

/** Default tolerance — 5 quality points. */
export const ROUTING_QUALITY_DEFAULT_TOLERANCE = 0.05 as const;

/** Default threshold — 5% regression rate. */
export const ROUTING_QUALITY_DEFAULT_THRESHOLD = 0.05 as const;

const round6 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
};

/**
 * Evaluate a tier-low quality sample and produce a regression
 * report. Pure: same verdicts → same report. The output is byte-stable
 * (entries sorted by `taskId`).
 */
export const evaluateTierLowRegression = (
  input: EvaluateTierLowRegressionInput,
): RoutingQualityRegressionReport => {
  if (typeof input.jobId !== "string" || input.jobId.length === 0) {
    throw new TypeError(
      "evaluateTierLowRegression: jobId must be non-empty",
    );
  }
  if (
    typeof input.generatedAt !== "string" ||
    input.generatedAt.length === 0
  ) {
    throw new TypeError(
      "evaluateTierLowRegression: generatedAt must be non-empty",
    );
  }
  const tolerance = clampScore(
    input.tolerance ?? ROUTING_QUALITY_DEFAULT_TOLERANCE,
  );
  const threshold = clampScore(
    input.threshold ?? ROUTING_QUALITY_DEFAULT_THRESHOLD,
  );

  const entries: RoutingQualityRegressionEntry[] = [];
  for (const verdict of input.verdicts) {
    const baseline = clampScore(verdict.baselineScore);
    const routed = clampScore(verdict.routedScore);
    const delta = clampDelta(baseline - routed);
    entries.push({
      taskId: verdict.taskId,
      baselineScore: round6(baseline),
      routedScore: round6(routed),
      delta: round6(delta),
      regressed: delta > tolerance,
    });
  }
  entries.sort((a, b) => a.taskId.localeCompare(b.taskId));

  const sampleSize = entries.length;
  const regressionCount = entries.filter((e) => e.regressed).length;
  const regressionRate =
    sampleSize === 0 ? 0 : regressionCount / sampleSize;
  const passed = regressionRate <= threshold;

  return {
    schemaVersion: ROUTING_QUALITY_REGRESSION_REPORT_SCHEMA_VERSION,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    tier: "tier-low",
    tolerance: round6(tolerance),
    sampleSize,
    regressionCount,
    regressionRate: round6(regressionRate),
    threshold: round6(threshold),
    passed,
    entries: Object.freeze(entries),
  };
};

/**
 * CI-gate convenience. Throws when the report's regression rate is
 * above the configured threshold. The thrown message embeds the
 * realised rate so the failure is self-explanatory in CI logs.
 */
export const assertRoutingQualityNotRegressed = (
  report: RoutingQualityRegressionReport,
): void => {
  if (!report.passed) {
    throw new Error(
      `routing quality regression rate ${report.regressionRate.toFixed(
        4,
      )} exceeds threshold ${report.threshold.toFixed(4)} (regressed ${report.regressionCount}/${report.sampleSize})`,
    );
  }
};

/**
 * Sanity export: the closed list of tiers, re-exported so the
 * sampler and the reports can share a single source of truth without
 * importing the classifier module twice.
 */
export const SAMPLER_TIER_VOCABULARY: readonly TaskComplexityTier[] =
  TASK_COMPLEXITY_TIERS;
