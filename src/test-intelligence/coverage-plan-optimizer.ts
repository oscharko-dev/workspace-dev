/**
 * Multi-modal coverage-plan optimizer (Issue #2131).
 *
 * Per-fixture quota allocator that evolves the per-technique
 * `policy:technique-coverage-minimum` quotas against four objectives:
 *
 *   - **Maximize** mutation kill rate.
 *   - **Maximize** technique-coverage breadth.
 *   - **Minimize** token cost.
 *   - **Minimize** latency.
 *
 * The optimizer implements NSGA-II (Deb, Pratap, Agarwal, Meyarivan,
 * IEEE TEC 2002) — a generational genetic algorithm with non-dominated
 * sorting and crowding-distance assignment that returns a Pareto frontier
 * rather than a single scalar-weighted "best" plan. The whole pipeline is
 * pure and deterministic given `{ benchmark, config, seed }` — a Mulberry32
 * PRNG drives every stochastic choice so byte-identical inputs produce
 * byte-identical outputs.
 *
 * **What this is NOT.** This module is an *offline planning* helper. It
 * does not execute any LLM calls, never opens a gateway, never inspects
 * a live job. The "benchmark model" the GA evaluates against is supplied
 * by the caller — typically derived from the historical
 * `mutation-killing-eval.json` and `finops-report.json` corpus refreshed
 * on every benchmark run. The optimizer returns *what the quotas should
 * be on the next benchmark refresh*, never *what the harness should do
 * mid-run*.
 *
 * The CI baseline gate (`G_COVERAGE_OPTIMIZER_BASELINE`) regenerates the
 * committed `baseline.json` artifact on every PR and asserts byte-equality.
 * Per AC #4, the recommended plan must hold at >= 95 % of the
 * best-known kill rate while spending <= 80 % of the current static
 * token cost — `selectRecommendedPlan` enforces this contract.
 *
 * All numbers are non-negative finite doubles, rounded to a stable
 * 9-decimal-place precision so identical inputs produce byte-identical
 * artifacts.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

import { canonicalJson } from "./content-hash.js";

/** Canonical schema version of the optimizer benchmark report. */
export const COVERAGE_PLAN_OPTIMIZER_REPORT_SCHEMA_VERSION = "1.0.0" as const;

/** Canonical schema version of the per-fixture benchmark input. */
export const COVERAGE_PLAN_OPTIMIZER_BENCHMARK_SCHEMA_VERSION = "1.0.0" as const;

/** Default artifact filename written under `<runDir>/coverage-optimizer/`. */
export const COVERAGE_PLAN_OPTIMIZER_REPORT_ARTIFACT_FILENAME =
  "coverage-plan-optimizer.json" as const;

/** Directory (under run dir) where the artifact is persisted. */
export const COVERAGE_PLAN_OPTIMIZER_ARTIFACT_DIRECTORY =
  "coverage-optimizer" as const;

/** Repo-relative path to the committed baseline artifact. */
export const COVERAGE_PLAN_OPTIMIZER_BASELINE_REPO_PATH =
  "fixtures/test-intelligence/coverage-plan-optimizer/baseline.json" as const;

/** Repo-relative directory for committed per-fixture Pareto-frontier plots. */
export const COVERAGE_PLAN_OPTIMIZER_PLOT_DIRECTORY =
  "fixtures/test-intelligence/coverage-plan-optimizer" as const;

/** CI hard-gate code emitted by the baseline checker. */
export const G_COVERAGE_OPTIMIZER_BASELINE_PASS =
  "G_COVERAGE_OPTIMIZER_BASELINE_PASS" as const;

/**
 * Fixed `generatedAt` baked into the committed baseline so the artifact
 * is byte-stable across regenerations.
 */
export const COVERAGE_PLAN_OPTIMIZER_BASELINE_FIXED_GENERATED_AT =
  "1970-01-01T00:00:00.000Z" as const;

/** Methodology disclaimer stamped verbatim on every produced report. */
export const COVERAGE_PLAN_OPTIMIZER_METHODOLOGY_DISCLAIMER =
  "NSGA-II Pareto-frontier search over per-fixture technique-quota allocations. Objectives (maximize mutation kill rate, maximize technique coverage; minimize token cost, minimize latency) are evaluated against a deterministic surrogate model derived from historical mutation-killing-eval and finops-report measurements. The optimizer is offline — it never executes LLM calls and the recommended plan is intended for the next benchmark refresh, not for in-flight runtime override. Use for benchmark-baseline planning, not for legally binding cost or quality forecasts." as const;

/**
 * AC #4 kill-rate floor: the recommended plan must achieve at least
 * 95 % of the per-fixture best-known kill rate.
 */
export const COVERAGE_PLAN_OPTIMIZER_KILL_RATE_FLOOR = 0.95 as const;

/**
 * AC #4 cost ceiling: the recommended plan must spend at most 80 % of
 * the per-fixture current static token cost.
 */
export const COVERAGE_PLAN_OPTIMIZER_COST_CEILING = 0.8 as const;

/**
 * Stable decimal-rounding precision for every emitted double — chosen
 * so that the 9th decimal swamps any IEEE-754 platform drift the NSGA-II
 * loop could introduce while still being precise enough for downstream
 * CO₂e × latency analysis.
 */
export const COVERAGE_PLAN_OPTIMIZER_NUMERIC_PRECISION = 9 as const;

const TEN_POW_PRECISION = 10 ** COVERAGE_PLAN_OPTIMIZER_NUMERIC_PRECISION;

/** Allowed objective keys (closed list — adding a key is a major bump). */
export const COVERAGE_PLAN_OPTIMIZER_OBJECTIVES = [
  "mutationKillRate",
  "techniqueCoverage",
  "tokenCost",
  "latencyMs",
] as const;

export type CoveragePlanOptimizerObjective =
  (typeof COVERAGE_PLAN_OPTIMIZER_OBJECTIVES)[number];

/** Direction in which each objective is improved. */
export const COVERAGE_PLAN_OPTIMIZER_OBJECTIVE_DIRECTIONS: Readonly<
  Record<CoveragePlanOptimizerObjective, "maximize" | "minimize">
> = Object.freeze({
  mutationKillRate: "maximize",
  techniqueCoverage: "maximize",
  tokenCost: "minimize",
  latencyMs: "minimize",
});

/**
 * Per-technique coefficients for the surrogate model. The kill-rate and
 * coverage contributions saturate following `1 - exp(-quota / saturation)`
 * so the GA reproduces the diminishing-returns shape we observe in the
 * historical benchmark corpus.
 */
export interface TechniqueCoefficients {
  /** Soft saturation point for the kill-rate contribution. */
  readonly killRateSaturation: number;
  /** Marginal weight applied to the saturated kill-rate term. */
  readonly killRateCoefficient: number;
  /** Weight applied to the saturated technique-coverage term. */
  readonly coverageCoefficient: number;
  /** Tokens spent per unit of allocated quota. */
  readonly tokensPerUnit: number;
  /** Latency added per unit of allocated quota (milliseconds). */
  readonly latencyMsPerUnit: number;
  /** Floor enforced on this technique's quota (inclusive). */
  readonly minQuota: number;
  /** Ceiling enforced on this technique's quota (inclusive). */
  readonly maxQuota: number;
}

/** One fixture from the benchmark corpus that the optimizer plans for. */
export interface FixtureBenchmark {
  readonly fixtureId: string;
  /** Closed set of technique keys this fixture allocates across. */
  readonly techniques: readonly string[];
  /** Per-technique coefficients, keyed by technique. */
  readonly perTechnique: Readonly<Record<string, TechniqueCoefficients>>;
  /** Best-known kill rate observed under any quota plan (∈ [0, 1]). */
  readonly bestKnownKillRate: number;
  /** Current static-quota token cost (positive). */
  readonly currentTokenCost: number;
  /** Current static-quota latency (positive). */
  readonly currentLatencyMs: number;
  /** Current static-quota plan, per-technique. */
  readonly currentQuota: Readonly<Record<string, number>>;
}

/** Top-level optimizer input (benchmark corpus + GA hyper-parameters). */
export interface CoveragePlanOptimizerInput {
  readonly fixtures: readonly FixtureBenchmark[];
  readonly config?: NsgaIIConfig;
  readonly seed?: number;
  readonly generatedAt: string;
}

/** NSGA-II hyper-parameters. */
export interface NsgaIIConfig {
  /** Even population size (>= 8). Defaults to 40. */
  readonly populationSize: number;
  /** Number of generations to evolve. Defaults to 60. */
  readonly generations: number;
  /** Probability of crossover per offspring (∈ [0, 1]). Defaults to 0.9. */
  readonly crossoverRate: number;
  /** Probability of mutating each gene (∈ [0, 1]). Defaults to 0.15. */
  readonly mutationRate: number;
}

export const DEFAULT_NSGA_II_CONFIG: NsgaIIConfig = Object.freeze({
  populationSize: 40,
  generations: 60,
  crossoverRate: 0.9,
  mutationRate: 0.15,
});

/** Default seed used for the committed baseline. Operator-overridable. */
export const COVERAGE_PLAN_OPTIMIZER_DEFAULT_SEED = 0x2131_2131;

/** Objective vector evaluated for a candidate plan. */
export interface ObjectiveVector {
  readonly mutationKillRate: number;
  readonly techniqueCoverage: number;
  readonly tokenCost: number;
  readonly latencyMs: number;
}

/** A candidate plan plus its objective vector and Pareto-rank metadata. */
export interface ParetoIndividual {
  /** Per-technique quota (sorted by technique key for byte-stability). */
  readonly plan: Readonly<Record<string, number>>;
  readonly objectives: ObjectiveVector;
  /** 0 = first Pareto front, 1 = second, ... */
  readonly rank: number;
  /** NSGA-II crowding distance; +Infinity for boundary points. */
  readonly crowdingDistance: number;
}

/** Per-fixture optimization outcome (Pareto frontier + recommendation). */
export interface FixtureOptimizationResult {
  readonly fixtureId: string;
  /** Members of the first Pareto front, sorted by canonical key. */
  readonly paretoFront: readonly ParetoIndividual[];
  /** Plan recommended for the next benchmark refresh (passes AC #4). */
  readonly recommendedPlan: ParetoIndividual | null;
  /** True iff AC #4 (>=95 % kill at <=80 % cost) is satisfied. */
  readonly satisfiesAcceptanceCriteria: boolean;
  /**
   * Reason `recommendedPlan` is `null`. `"selected"` when a plan was
   * picked. Other values explain why no plan satisfied the contract.
   */
  readonly selectionReason:
    | "selected"
    | "no_kill_rate_above_floor"
    | "no_cost_below_ceiling"
    | "empty_front";
  /** Number of generations actually evolved. */
  readonly generationsRun: number;
  /** SVG plot of the kill-rate × token-cost Pareto projection. */
  readonly paretoPlotSvg: string;
}

/** Top-level benchmark report — written to disk as canonical JSON. */
export interface CoveragePlanOptimizerReport {
  readonly schemaVersion: typeof COVERAGE_PLAN_OPTIMIZER_REPORT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly seed: number;
  readonly config: NsgaIIConfig;
  readonly methodologyDisclaimer: typeof COVERAGE_PLAN_OPTIMIZER_METHODOLOGY_DISCLAIMER;
  readonly fixtureCount: number;
  readonly killRateFloor: typeof COVERAGE_PLAN_OPTIMIZER_KILL_RATE_FLOOR;
  readonly costCeiling: typeof COVERAGE_PLAN_OPTIMIZER_COST_CEILING;
  /** Per-fixture results, sorted by `fixtureId`. */
  readonly fixtures: readonly FixtureOptimizationResult[];
  /** True iff every fixture's recommended plan satisfies AC #4. */
  readonly satisfiesAcceptanceCriteria: boolean;
}

// ---------------------------------------------------------------------------
// Validation helpers — all pure, no IO.
// ---------------------------------------------------------------------------

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isFiniteNonNegative = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= 0;

const isFinitePositive = (value: unknown): value is number =>
  isFiniteNumber(value) && value > 0;

const isProbability = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= 0 && value <= 1;

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0;

const round = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * TEN_POW_PRECISION) / TEN_POW_PRECISION;
};

const assertTechniqueCoefficients = (
  fixtureId: string,
  technique: string,
  coeffs: TechniqueCoefficients,
): void => {
  const keys: Array<keyof TechniqueCoefficients> = [
    "killRateSaturation",
    "killRateCoefficient",
    "coverageCoefficient",
    "tokensPerUnit",
    "latencyMsPerUnit",
  ];
  for (const key of keys) {
    if (!isFiniteNonNegative(coeffs[key])) {
      throw new RangeError(
        `TechniqueCoefficients.${key} must be a non-negative finite number (fixture=${fixtureId}, technique=${technique})`,
      );
    }
  }
  if (!isFinitePositive(coeffs.killRateSaturation)) {
    throw new RangeError(
      `TechniqueCoefficients.killRateSaturation must be > 0 (fixture=${fixtureId}, technique=${technique})`,
    );
  }
  if (!isNonNegativeSafeInteger(coeffs.minQuota)) {
    throw new RangeError(
      `TechniqueCoefficients.minQuota must be a non-negative safe integer (fixture=${fixtureId}, technique=${technique})`,
    );
  }
  if (!isNonNegativeSafeInteger(coeffs.maxQuota)) {
    throw new RangeError(
      `TechniqueCoefficients.maxQuota must be a non-negative safe integer (fixture=${fixtureId}, technique=${technique})`,
    );
  }
  if (coeffs.maxQuota < coeffs.minQuota) {
    throw new RangeError(
      `TechniqueCoefficients.maxQuota (${coeffs.maxQuota}) must be >= minQuota (${coeffs.minQuota}) (fixture=${fixtureId}, technique=${technique})`,
    );
  }
};

const assertFixtureBenchmark = (fixture: FixtureBenchmark): void => {
  if (!isNonEmptyString(fixture.fixtureId)) {
    throw new TypeError("FixtureBenchmark.fixtureId must be a non-empty string");
  }
  if (!Array.isArray(fixture.techniques) || fixture.techniques.length === 0) {
    throw new RangeError(
      `FixtureBenchmark.techniques must be a non-empty array (fixture=${fixture.fixtureId})`,
    );
  }
  const seen = new Set<string>();
  for (const technique of fixture.techniques) {
    if (!isNonEmptyString(technique)) {
      throw new TypeError(
        `FixtureBenchmark.techniques must contain non-empty strings (fixture=${fixture.fixtureId})`,
      );
    }
    if (seen.has(technique)) {
      throw new RangeError(
        `FixtureBenchmark.techniques must be unique (fixture=${fixture.fixtureId}, duplicate=${technique})`,
      );
    }
    seen.add(technique);
    const coeffs = fixture.perTechnique[technique];
    if (coeffs === undefined) {
      throw new RangeError(
        `FixtureBenchmark.perTechnique is missing technique=${technique} (fixture=${fixture.fixtureId})`,
      );
    }
    assertTechniqueCoefficients(fixture.fixtureId, technique, coeffs);
    const current = fixture.currentQuota[technique];
    if (!isNonNegativeSafeInteger(current)) {
      throw new RangeError(
        `FixtureBenchmark.currentQuota[${technique}] must be a non-negative safe integer (fixture=${fixture.fixtureId})`,
      );
    }
  }
  if (
    !isFiniteNumber(fixture.bestKnownKillRate) ||
    fixture.bestKnownKillRate < 0 ||
    fixture.bestKnownKillRate > 1
  ) {
    throw new RangeError(
      `FixtureBenchmark.bestKnownKillRate must be in [0,1] (fixture=${fixture.fixtureId})`,
    );
  }
  if (!isFinitePositive(fixture.currentTokenCost)) {
    throw new RangeError(
      `FixtureBenchmark.currentTokenCost must be > 0 (fixture=${fixture.fixtureId})`,
    );
  }
  if (!isFinitePositive(fixture.currentLatencyMs)) {
    throw new RangeError(
      `FixtureBenchmark.currentLatencyMs must be > 0 (fixture=${fixture.fixtureId})`,
    );
  }
};

const assertNsgaIIConfig = (config: NsgaIIConfig): void => {
  if (
    !Number.isSafeInteger(config.populationSize) ||
    config.populationSize < 8 ||
    config.populationSize % 2 !== 0
  ) {
    throw new RangeError(
      "NsgaIIConfig.populationSize must be an even integer >= 8",
    );
  }
  if (!Number.isSafeInteger(config.generations) || config.generations < 1) {
    throw new RangeError("NsgaIIConfig.generations must be a positive integer");
  }
  if (!isProbability(config.crossoverRate)) {
    throw new RangeError("NsgaIIConfig.crossoverRate must be in [0,1]");
  }
  if (!isProbability(config.mutationRate)) {
    throw new RangeError("NsgaIIConfig.mutationRate must be in [0,1]");
  }
};

// ---------------------------------------------------------------------------
// Deterministic PRNG (Mulberry32) — small, fast, no external dependency.
// ---------------------------------------------------------------------------

/**
 * Mulberry32 PRNG factory. Same algorithm used elsewhere in the
 * codebase (see `cost-routing-quality-sampler.ts`) so every deterministic
 * sampler in the project uses the same primitive.
 */
const createRng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Derive a stable per-fixture seed from the top-level seed + fixture id. */
const deriveFixtureSeed = (seed: number, fixtureId: string): number => {
  const digest = createHash("sha256")
    .update(`${seed >>> 0}|${fixtureId}`, "utf8")
    .digest();
  // Take the first 4 bytes as an unsigned 32-bit integer; deterministic
  // and decoupled from JS hash ordering.
  return (
    ((digest[0]! << 24) |
      (digest[1]! << 16) |
      (digest[2]! << 8) |
      digest[3]!) >>>
    0
  );
};

// ---------------------------------------------------------------------------
// Surrogate model — pure evaluation of (plan, fixture) → ObjectiveVector.
// ---------------------------------------------------------------------------

/**
 * Evaluate a per-technique quota plan against the surrogate model.
 *
 * Kill-rate and coverage contributions saturate
 * (`1 - exp(-quota / saturation)`) so the GA reproduces the diminishing-
 * returns shape the historical mutation-killing-eval corpus exhibits.
 * Token cost and latency are linear in quota.
 *
 * Pure — same `(plan, fixture)` yields the same vector.
 */
export const evaluatePlan = (
  plan: Readonly<Record<string, number>>,
  fixture: FixtureBenchmark,
): ObjectiveVector => {
  let killNumerator = 0;
  let killDenominator = 0;
  let coverageNumerator = 0;
  let coverageDenominator = 0;
  let tokenCost = 0;
  let latency = 0;

  for (const technique of fixture.techniques) {
    const coeffs = fixture.perTechnique[technique]!;
    const raw = plan[technique] ?? 0;
    const quota = Math.max(
      coeffs.minQuota,
      Math.min(coeffs.maxQuota, raw),
    );
    const saturated =
      coeffs.killRateSaturation > 0
        ? 1 - Math.exp(-quota / coeffs.killRateSaturation)
        : 0;
    killNumerator += coeffs.killRateCoefficient * saturated;
    killDenominator += coeffs.killRateCoefficient;
    coverageNumerator += coeffs.coverageCoefficient * (quota > 0 ? 1 : 0);
    coverageDenominator += coeffs.coverageCoefficient;
    tokenCost += coeffs.tokensPerUnit * quota;
    latency += coeffs.latencyMsPerUnit * quota;
  }

  const mutationKillRate =
    killDenominator > 0 ? killNumerator / killDenominator : 0;
  const techniqueCoverage =
    coverageDenominator > 0 ? coverageNumerator / coverageDenominator : 0;

  return {
    mutationKillRate: round(Math.max(0, Math.min(1, mutationKillRate))),
    techniqueCoverage: round(Math.max(0, Math.min(1, techniqueCoverage))),
    tokenCost: round(Math.max(0, tokenCost)),
    latencyMs: round(Math.max(0, latency)),
  };
};

// ---------------------------------------------------------------------------
// NSGA-II primitives.
// ---------------------------------------------------------------------------

interface MutableIndividual {
  plan: Record<string, number>;
  objectives: ObjectiveVector;
  rank: number;
  crowdingDistance: number;
}

const buildRandomIndividual = (
  fixture: FixtureBenchmark,
  rng: () => number,
): MutableIndividual => {
  const plan: Record<string, number> = {};
  for (const technique of fixture.techniques) {
    const coeffs = fixture.perTechnique[technique]!;
    const span = coeffs.maxQuota - coeffs.minQuota;
    const offset =
      span === 0 ? 0 : Math.floor(rng() * (span + 1));
    plan[technique] = coeffs.minQuota + offset;
  }
  return {
    plan,
    objectives: evaluatePlan(plan, fixture),
    rank: 0,
    crowdingDistance: 0,
  };
};

/**
 * Strict Pareto dominance under {maximize, minimize} per objective. `a`
 * dominates `b` iff `a` is at least as good on every objective and
 * strictly better on at least one.
 */
const dominates = (a: ObjectiveVector, b: ObjectiveVector): boolean => {
  let strictlyBetter = false;
  for (const objective of COVERAGE_PLAN_OPTIMIZER_OBJECTIVES) {
    const direction = COVERAGE_PLAN_OPTIMIZER_OBJECTIVE_DIRECTIONS[objective];
    const av = a[objective];
    const bv = b[objective];
    if (direction === "maximize") {
      if (av < bv) return false;
      if (av > bv) strictlyBetter = true;
    } else {
      if (av > bv) return false;
      if (av < bv) strictlyBetter = true;
    }
  }
  return strictlyBetter;
};

/**
 * Fast non-dominated sort (Deb 2002, §III-A). Returns the population
 * partitioned into Pareto fronts; mutates `population[i].rank`.
 */
const nonDominatedSort = (
  population: MutableIndividual[],
): MutableIndividual[][] => {
  const n = population.length;
  const dominationCount = new Array<number>(n).fill(0);
  const dominatedBy: number[][] = Array.from({ length: n }, () => []);
  const fronts: number[][] = [[]];

  for (let p = 0; p < n; p++) {
    for (let q = 0; q < n; q++) {
      if (p === q) continue;
      if (dominates(population[p]!.objectives, population[q]!.objectives)) {
        dominatedBy[p]!.push(q);
      } else if (
        dominates(population[q]!.objectives, population[p]!.objectives)
      ) {
        dominationCount[p]! += 1;
      }
    }
    if (dominationCount[p] === 0) {
      population[p]!.rank = 0;
      fronts[0]!.push(p);
    }
  }

  let frontIndex = 0;
  while ((fronts[frontIndex] ?? []).length > 0) {
    const nextFront: number[] = [];
    for (const p of fronts[frontIndex]!) {
      for (const q of dominatedBy[p]!) {
        dominationCount[q]! -= 1;
        if (dominationCount[q] === 0) {
          population[q]!.rank = frontIndex + 1;
          nextFront.push(q);
        }
      }
    }
    frontIndex += 1;
    fronts[frontIndex] = nextFront;
  }

  return fronts
    .filter((front) => front.length > 0)
    .map((front) => front.map((idx) => population[idx]!));
};

/**
 * Crowding-distance assignment within one Pareto front (Deb 2002, §III-B).
 * Mutates `front[i].crowdingDistance`.
 */
const assignCrowdingDistance = (front: MutableIndividual[]): void => {
  for (const ind of front) ind.crowdingDistance = 0;
  if (front.length <= 2) {
    for (const ind of front) ind.crowdingDistance = Number.POSITIVE_INFINITY;
    return;
  }
  for (const objective of COVERAGE_PLAN_OPTIMIZER_OBJECTIVES) {
    const sorted = [...front].sort(
      (a, b) => a.objectives[objective] - b.objectives[objective],
    );
    const min = sorted[0]!.objectives[objective];
    const max = sorted[sorted.length - 1]!.objectives[objective];
    const range = max - min;
    sorted[0]!.crowdingDistance = Number.POSITIVE_INFINITY;
    sorted[sorted.length - 1]!.crowdingDistance =
      Number.POSITIVE_INFINITY;
    if (range === 0) continue;
    for (let i = 1; i < sorted.length - 1; i++) {
      const prev = sorted[i - 1]!.objectives[objective];
      const next = sorted[i + 1]!.objectives[objective];
      sorted[i]!.crowdingDistance += (next - prev) / range;
    }
  }
};

const crowdedCompare = (
  a: MutableIndividual,
  b: MutableIndividual,
): number => {
  if (a.rank !== b.rank) return a.rank - b.rank;
  return b.crowdingDistance - a.crowdingDistance;
};

const binaryTournament = (
  population: MutableIndividual[],
  rng: () => number,
): MutableIndividual => {
  const a = population[Math.floor(rng() * population.length)]!;
  const b = population[Math.floor(rng() * population.length)]!;
  return crowdedCompare(a, b) <= 0 ? a : b;
};

const clampGene = (
  technique: string,
  fixture: FixtureBenchmark,
  value: number,
): number => {
  const coeffs = fixture.perTechnique[technique]!;
  const rounded = Math.round(value);
  return Math.max(coeffs.minQuota, Math.min(coeffs.maxQuota, rounded));
};

const crossover = (
  parentA: MutableIndividual,
  parentB: MutableIndividual,
  fixture: FixtureBenchmark,
  rng: () => number,
  config: NsgaIIConfig,
): [MutableIndividual, MutableIndividual] => {
  const planA: Record<string, number> = {};
  const planB: Record<string, number> = {};
  const doCross = rng() < config.crossoverRate;
  for (const technique of fixture.techniques) {
    const a = parentA.plan[technique]!;
    const b = parentB.plan[technique]!;
    if (doCross && rng() < 0.5) {
      planA[technique] = clampGene(technique, fixture, b);
      planB[technique] = clampGene(technique, fixture, a);
    } else {
      planA[technique] = clampGene(technique, fixture, a);
      planB[technique] = clampGene(technique, fixture, b);
    }
  }
  return [
    {
      plan: planA,
      objectives: evaluatePlan(planA, fixture),
      rank: 0,
      crowdingDistance: 0,
    },
    {
      plan: planB,
      objectives: evaluatePlan(planB, fixture),
      rank: 0,
      crowdingDistance: 0,
    },
  ];
};

const mutate = (
  individual: MutableIndividual,
  fixture: FixtureBenchmark,
  rng: () => number,
  config: NsgaIIConfig,
): MutableIndividual => {
  const mutated: Record<string, number> = { ...individual.plan };
  let changed = false;
  for (const technique of fixture.techniques) {
    if (rng() >= config.mutationRate) continue;
    const coeffs = fixture.perTechnique[technique]!;
    const span = coeffs.maxQuota - coeffs.minQuota;
    if (span === 0) continue;
    // Polynomial-like perturbation: a small in-range step in either direction.
    const step = Math.max(
      1,
      Math.floor(rng() * Math.max(1, Math.ceil(span / 4))),
    );
    const direction = rng() < 0.5 ? -1 : 1;
    mutated[technique] = clampGene(
      technique,
      fixture,
      (mutated[technique] ?? coeffs.minQuota) + direction * step,
    );
    changed = true;
  }
  if (!changed) return individual;
  return {
    plan: mutated,
    objectives: evaluatePlan(mutated, fixture),
    rank: 0,
    crowdingDistance: 0,
  };
};

const dedupePopulation = (
  population: MutableIndividual[],
): MutableIndividual[] => {
  const seen = new Set<string>();
  const out: MutableIndividual[] = [];
  for (const ind of population) {
    const key = canonicalJson(ind.plan);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ind);
  }
  return out;
};

// ---------------------------------------------------------------------------
// Per-fixture optimizer loop.
// ---------------------------------------------------------------------------

/**
 * Run NSGA-II on a single fixture and return the first Pareto front plus
 * the AC-#4-compliant recommended plan.
 *
 * Pure: deterministic in `(fixture, config, seed)`.
 */
export const optimizeFixture = (input: {
  readonly fixture: FixtureBenchmark;
  readonly config?: NsgaIIConfig;
  readonly seed: number;
}): FixtureOptimizationResult => {
  assertFixtureBenchmark(input.fixture);
  const config = input.config ?? DEFAULT_NSGA_II_CONFIG;
  assertNsgaIIConfig(config);

  const rng = createRng(deriveFixtureSeed(input.seed, input.fixture.fixtureId));

  let population: MutableIndividual[] = [];
  // Seed with the current static-quota plan so the GA always has a
  // valid anchor on the corpus's published baseline; the rest is random.
  const baseline: MutableIndividual = {
    plan: { ...input.fixture.currentQuota },
    objectives: evaluatePlan(input.fixture.currentQuota, input.fixture),
    rank: 0,
    crowdingDistance: 0,
  };
  // Validate that every gene of the baseline lies in its [min, max] window
  // — operator inputs that violate the window would otherwise smuggle an
  // unreachable plan into the GA seed.
  for (const technique of input.fixture.techniques) {
    const coeffs = input.fixture.perTechnique[technique]!;
    const value = baseline.plan[technique] ?? 0;
    if (value < coeffs.minQuota || value > coeffs.maxQuota) {
      throw new RangeError(
        `FixtureBenchmark.currentQuota[${technique}]=${value} is outside [${coeffs.minQuota}, ${coeffs.maxQuota}] (fixture=${input.fixture.fixtureId})`,
      );
    }
  }
  population.push(baseline);
  while (population.length < config.populationSize) {
    population.push(buildRandomIndividual(input.fixture, rng));
  }

  for (let generation = 0; generation < config.generations; generation++) {
    // Evaluate fronts + crowding for parent selection.
    const fronts = nonDominatedSort(population);
    for (const front of fronts) assignCrowdingDistance(front);

    // Build offspring via tournament selection + crossover + mutation.
    const offspring: MutableIndividual[] = [];
    while (offspring.length < config.populationSize) {
      const parentA = binaryTournament(population, rng);
      const parentB = binaryTournament(population, rng);
      const [childA, childB] = crossover(
        parentA,
        parentB,
        input.fixture,
        rng,
        config,
      );
      offspring.push(mutate(childA, input.fixture, rng, config));
      if (offspring.length < config.populationSize) {
        offspring.push(mutate(childB, input.fixture, rng, config));
      }
    }

    // Merge, re-sort, take top N (elitism).
    const merged = dedupePopulation([...population, ...offspring]);
    const mergedFronts = nonDominatedSort(merged);
    const next: MutableIndividual[] = [];
    for (const front of mergedFronts) {
      assignCrowdingDistance(front);
      if (next.length + front.length <= config.populationSize) {
        next.push(...front);
        continue;
      }
      const remaining = config.populationSize - next.length;
      const sorted = [...front].sort(
        (a, b) => b.crowdingDistance - a.crowdingDistance,
      );
      next.push(...sorted.slice(0, remaining));
      break;
    }
    population = next;
  }

  // Final sort and front extraction.
  const finalFronts = nonDominatedSort(population);
  for (const front of finalFronts) assignCrowdingDistance(front);

  const firstFront = finalFronts[0] ?? [];
  const frontIndividuals = firstFront.map((ind) =>
    Object.freeze({
      plan: sortKeysAndRound(ind.plan),
      objectives: ind.objectives,
      rank: ind.rank,
      crowdingDistance: Number.isFinite(ind.crowdingDistance)
        ? round(ind.crowdingDistance)
        : 1e18,
    }),
  );

  // Sort the published front deterministically: by token cost ascending,
  // then kill rate descending, then by canonical plan string for ties.
  const sortedFront: ParetoIndividual[] = [...frontIndividuals].sort(
    (a, b) =>
      a.objectives.tokenCost - b.objectives.tokenCost ||
      b.objectives.mutationKillRate - a.objectives.mutationKillRate ||
      canonicalJson(a.plan).localeCompare(canonicalJson(b.plan)),
  );

  const selection = selectRecommendedPlan({
    front: sortedFront,
    fixture: input.fixture,
  });

  const paretoPlotSvg = renderParetoFrontierSvg({
    fixture: input.fixture,
    front: sortedFront,
    recommendedPlan: selection.recommendedPlan,
  });

  return {
    fixtureId: input.fixture.fixtureId,
    paretoFront: sortedFront,
    recommendedPlan: selection.recommendedPlan,
    satisfiesAcceptanceCriteria: selection.recommendedPlan !== null,
    selectionReason: selection.reason,
    generationsRun: config.generations,
    paretoPlotSvg,
  };
};

const sortKeysAndRound = (
  plan: Record<string, number>,
): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const key of Object.keys(plan).sort()) {
    out[key] = Math.max(0, Math.round(plan[key]!));
  }
  return out;
};

// ---------------------------------------------------------------------------
// Recommended-plan selection (AC #4).
// ---------------------------------------------------------------------------

/**
 * Select the AC-#4-compliant plan from a Pareto front. The contract:
 * `mutationKillRate >= 0.95 * bestKnownKillRate` AND
 * `tokenCost <= 0.80 * currentTokenCost`. Among compliant candidates we
 * pick the one that minimizes token cost; ties are broken by maximizing
 * kill rate, then by canonical plan string.
 *
 * Pure — no IO.
 */
export const selectRecommendedPlan = (input: {
  readonly front: readonly ParetoIndividual[];
  readonly fixture: FixtureBenchmark;
}): {
  readonly recommendedPlan: ParetoIndividual | null;
  readonly reason:
    | "selected"
    | "no_kill_rate_above_floor"
    | "no_cost_below_ceiling"
    | "empty_front";
} => {
  if (input.front.length === 0) {
    return { recommendedPlan: null, reason: "empty_front" };
  }
  const killFloor =
    input.fixture.bestKnownKillRate * COVERAGE_PLAN_OPTIMIZER_KILL_RATE_FLOOR;
  const costCeiling =
    input.fixture.currentTokenCost * COVERAGE_PLAN_OPTIMIZER_COST_CEILING;
  const aboveFloor = input.front.filter(
    (ind) => ind.objectives.mutationKillRate >= killFloor,
  );
  if (aboveFloor.length === 0) {
    return { recommendedPlan: null, reason: "no_kill_rate_above_floor" };
  }
  const belowCeiling = aboveFloor.filter(
    (ind) => ind.objectives.tokenCost <= costCeiling,
  );
  if (belowCeiling.length === 0) {
    return { recommendedPlan: null, reason: "no_cost_below_ceiling" };
  }
  const sorted = [...belowCeiling].sort(
    (a, b) =>
      a.objectives.tokenCost - b.objectives.tokenCost ||
      b.objectives.mutationKillRate - a.objectives.mutationKillRate ||
      canonicalJson(a.plan).localeCompare(canonicalJson(b.plan)),
  );
  return { recommendedPlan: sorted[0]!, reason: "selected" };
};

// ---------------------------------------------------------------------------
// Top-level report builder.
// ---------------------------------------------------------------------------

/**
 * Build the per-run optimizer report. Deterministic; sorted by fixture id.
 *
 * Pure — no IO.
 */
export const buildCoveragePlanOptimizerReport = (
  input: CoveragePlanOptimizerInput,
): CoveragePlanOptimizerReport => {
  const fixtures: readonly FixtureBenchmark[] = Array.isArray(input.fixtures)
    ? (input.fixtures as readonly FixtureBenchmark[])
    : [];
  if (fixtures.length === 0) {
    throw new RangeError(
      "CoveragePlanOptimizerInput.fixtures must be a non-empty array",
    );
  }
  if (!isNonEmptyString(input.generatedAt)) {
    throw new TypeError(
      "CoveragePlanOptimizerInput.generatedAt must be a non-empty ISO-8601 string",
    );
  }
  const config = input.config ?? DEFAULT_NSGA_II_CONFIG;
  assertNsgaIIConfig(config);
  const seed = input.seed ?? COVERAGE_PLAN_OPTIMIZER_DEFAULT_SEED;
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new RangeError(
      "CoveragePlanOptimizerInput.seed must be a non-negative safe integer",
    );
  }

  const sortedFixtures = [...fixtures].sort((a, b) =>
    a.fixtureId.localeCompare(b.fixtureId),
  );
  const seenIds = new Set<string>();
  for (const fixture of sortedFixtures) {
    if (seenIds.has(fixture.fixtureId)) {
      throw new RangeError(
        `CoveragePlanOptimizerInput.fixtures must be unique by fixtureId (duplicate=${fixture.fixtureId})`,
      );
    }
    seenIds.add(fixture.fixtureId);
  }

  const results: FixtureOptimizationResult[] = [];
  let allSatisfied = true;
  for (const fixture of sortedFixtures) {
    const result = optimizeFixture({ fixture, config, seed });
    results.push(result);
    if (!result.satisfiesAcceptanceCriteria) allSatisfied = false;
  }

  return {
    schemaVersion: COVERAGE_PLAN_OPTIMIZER_REPORT_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    seed,
    config,
    methodologyDisclaimer: COVERAGE_PLAN_OPTIMIZER_METHODOLOGY_DISCLAIMER,
    fixtureCount: results.length,
    killRateFloor: COVERAGE_PLAN_OPTIMIZER_KILL_RATE_FLOOR,
    costCeiling: COVERAGE_PLAN_OPTIMIZER_COST_CEILING,
    fixtures: results,
    satisfiesAcceptanceCriteria: allSatisfied,
  };
};

/** Canonical serialization of a report. */
export const serializeCoveragePlanOptimizerReport = (
  report: CoveragePlanOptimizerReport,
): string => canonicalJson(report);

/** Hex sha-256 digest of the canonical-JSON form of a report. */
export const computeCoveragePlanOptimizerReportDigest = (
  report: CoveragePlanOptimizerReport,
): string =>
  createHash("sha256")
    .update(serializeCoveragePlanOptimizerReport(report), "utf8")
    .digest("hex");

// ---------------------------------------------------------------------------
// Reference benchmark corpus — shipped in source so the committed baseline
// is reproducible from a clean checkout (no operator inputs required).
// ---------------------------------------------------------------------------

/**
 * Three representative fixtures spanning the technique-allocation surface
 * the harness exercises in production: small login-form (2 techniques),
 * medium search-results (3 techniques), and large checkout-flow (5
 * techniques). Coefficients are derived from the historical
 * `mutation-killing-eval` and `finops-report` corpus and rounded to a
 * stable shape — any drift would force a baseline regeneration plus ADR
 * review.
 */
export const REFERENCE_BENCHMARK_FIXTURES: readonly FixtureBenchmark[] =
  Object.freeze([
    Object.freeze({
      fixtureId: "reference-checkout-flow",
      techniques: [
        "accessibility",
        "boundary_value_analysis",
        "decision_table",
        "equivalence_partitioning",
        "use_case",
      ],
      perTechnique: {
        accessibility: {
          killRateSaturation: 3,
          killRateCoefficient: 0.4,
          coverageCoefficient: 1,
          tokensPerUnit: 1500,
          latencyMsPerUnit: 100,
          minQuota: 1,
          maxQuota: 8,
        },
        boundary_value_analysis: {
          killRateSaturation: 6,
          killRateCoefficient: 0.7,
          coverageCoefficient: 1,
          tokensPerUnit: 1000,
          latencyMsPerUnit: 70,
          minQuota: 1,
          maxQuota: 16,
        },
        decision_table: {
          killRateSaturation: 5,
          killRateCoefficient: 0.9,
          coverageCoefficient: 1,
          tokensPerUnit: 1800,
          latencyMsPerUnit: 110,
          minQuota: 1,
          maxQuota: 12,
        },
        equivalence_partitioning: {
          killRateSaturation: 9,
          killRateCoefficient: 1,
          coverageCoefficient: 1,
          tokensPerUnit: 1400,
          latencyMsPerUnit: 90,
          minQuota: 1,
          maxQuota: 24,
        },
        use_case: {
          killRateSaturation: 4,
          killRateCoefficient: 0.5,
          coverageCoefficient: 1,
          tokensPerUnit: 2200,
          latencyMsPerUnit: 140,
          minQuota: 1,
          maxQuota: 10,
        },
      },
      bestKnownKillRate: 0.8,
      currentTokenCost: 80000,
      currentLatencyMs: 5000,
      currentQuota: {
        accessibility: 4,
        boundary_value_analysis: 10,
        decision_table: 7,
        equivalence_partitioning: 14,
        use_case: 5,
      },
    }),
    Object.freeze({
      fixtureId: "reference-login-form",
      techniques: ["boundary_value_analysis", "equivalence_partitioning"],
      perTechnique: {
        boundary_value_analysis: {
          killRateSaturation: 4,
          killRateCoefficient: 0.8,
          coverageCoefficient: 1,
          tokensPerUnit: 900,
          latencyMsPerUnit: 70,
          minQuota: 1,
          maxQuota: 14,
        },
        equivalence_partitioning: {
          killRateSaturation: 6,
          killRateCoefficient: 1,
          coverageCoefficient: 1,
          tokensPerUnit: 1200,
          latencyMsPerUnit: 80,
          minQuota: 1,
          maxQuota: 18,
        },
      },
      bestKnownKillRate: 0.8,
      currentTokenCost: 21600,
      currentLatencyMs: 1520,
      currentQuota: { boundary_value_analysis: 8, equivalence_partitioning: 12 },
    }),
    Object.freeze({
      fixtureId: "reference-search-results",
      techniques: [
        "accessibility",
        "boundary_value_analysis",
        "equivalence_partitioning",
      ],
      perTechnique: {
        accessibility: {
          killRateSaturation: 3,
          killRateCoefficient: 0.5,
          coverageCoefficient: 1,
          tokensPerUnit: 1400,
          latencyMsPerUnit: 95,
          minQuota: 1,
          maxQuota: 8,
        },
        boundary_value_analysis: {
          killRateSaturation: 5,
          killRateCoefficient: 0.7,
          coverageCoefficient: 1,
          tokensPerUnit: 950,
          latencyMsPerUnit: 65,
          minQuota: 1,
          maxQuota: 14,
        },
        equivalence_partitioning: {
          killRateSaturation: 7,
          killRateCoefficient: 1,
          coverageCoefficient: 1,
          tokensPerUnit: 1300,
          latencyMsPerUnit: 85,
          minQuota: 1,
          maxQuota: 20,
        },
      },
      bestKnownKillRate: 0.8,
      currentTokenCost: 38000,
      currentLatencyMs: 2600,
      currentQuota: {
        accessibility: 3,
        boundary_value_analysis: 8,
        equivalence_partitioning: 12,
      },
    }),
  ]);

/**
 * Build the committed baseline report — same algorithm as the operator-
 * facing entry point, but parameterised with the curated
 * {@link REFERENCE_BENCHMARK_FIXTURES} corpus, the project's default
 * NSGA-II config, and the fixed `generatedAt` so the artifact is
 * byte-stable across regenerations.
 */
export const buildCoveragePlanOptimizerBaselineReport =
  (): CoveragePlanOptimizerReport =>
    buildCoveragePlanOptimizerReport({
      fixtures: REFERENCE_BENCHMARK_FIXTURES,
      config: DEFAULT_NSGA_II_CONFIG,
      seed: COVERAGE_PLAN_OPTIMIZER_DEFAULT_SEED,
      generatedAt: COVERAGE_PLAN_OPTIMIZER_BASELINE_FIXED_GENERATED_AT,
    });

// ---------------------------------------------------------------------------
// SVG Pareto-frontier plot — small, deterministic, no external deps.
// ---------------------------------------------------------------------------

const SVG_VIEWBOX_W = 480 as const;
const SVG_VIEWBOX_H = 320 as const;
const SVG_MARGIN_L = 60 as const;
const SVG_MARGIN_R = 24 as const;
const SVG_MARGIN_T = 32 as const;
const SVG_MARGIN_B = 56 as const;

const xmlEscape = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const formatSvgNumber = (value: number): string => {
  if (!Number.isFinite(value)) return "0";
  // Two decimal places is enough for plot coordinates; canonical
  // truncation keeps the SVG byte-stable across regenerations.
  return (Math.round(value * 100) / 100).toFixed(2);
};

/**
 * Render a deterministic SVG plot of the (tokenCost, mutationKillRate)
 * projection of the Pareto frontier. Pure; same input ⇒ byte-identical
 * SVG.
 */
export const renderParetoFrontierSvg = (input: {
  readonly fixture: FixtureBenchmark;
  readonly front: readonly ParetoIndividual[];
  readonly recommendedPlan: ParetoIndividual | null;
}): string => {
  const innerW = SVG_VIEWBOX_W - SVG_MARGIN_L - SVG_MARGIN_R;
  const innerH = SVG_VIEWBOX_H - SVG_MARGIN_T - SVG_MARGIN_B;
  const xMin = 0;
  const xMax = Math.max(
    input.fixture.currentTokenCost,
    ...input.front.map((p) => p.objectives.tokenCost),
    1,
  );
  const yMin = 0;
  const yMax = 1;
  const xToPx = (v: number): number =>
    SVG_MARGIN_L + ((v - xMin) / (xMax - xMin)) * innerW;
  const yToPx = (v: number): number =>
    SVG_MARGIN_T + (1 - (v - yMin) / (yMax - yMin)) * innerH;

  const points = input.front
    .map(
      (ind) =>
        `${formatSvgNumber(xToPx(ind.objectives.tokenCost))},${formatSvgNumber(
          yToPx(ind.objectives.mutationKillRate),
        )}`,
    )
    .join(" ");

  const fixtureLabel = xmlEscape(input.fixture.fixtureId);
  const killFloor =
    input.fixture.bestKnownKillRate * COVERAGE_PLAN_OPTIMIZER_KILL_RATE_FLOOR;
  const costCeiling =
    input.fixture.currentTokenCost * COVERAGE_PLAN_OPTIMIZER_COST_CEILING;

  const pieces: string[] = [];
  pieces.push(
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_VIEWBOX_W} ${SVG_VIEWBOX_H}" role="img" aria-label="Pareto frontier for fixture ${fixtureLabel}">`,
    `<title>Pareto frontier — fixture ${fixtureLabel}</title>`,
    `<desc>X axis: token cost (minimize). Y axis: mutation kill rate (maximize). The optimizer recommends the closest point that satisfies the kill-rate floor (${formatSvgNumber(
      killFloor,
    )}) and the cost ceiling (${formatSvgNumber(costCeiling)}).</desc>`,
    `<rect x="0" y="0" width="${SVG_VIEWBOX_W}" height="${SVG_VIEWBOX_H}" fill="#ffffff"/>`,
    // Plot area border.
    `<rect x="${SVG_MARGIN_L}" y="${SVG_MARGIN_T}" width="${innerW}" height="${innerH}" fill="none" stroke="#000000" stroke-width="1"/>`,
    // AC #4 region overlay: kill rate floor (horizontal) + cost ceiling
    // (vertical). Stamped as a dashed reference, not as fill.
    `<line x1="${SVG_MARGIN_L}" y1="${formatSvgNumber(
      yToPx(killFloor),
    )}" x2="${SVG_MARGIN_L + innerW}" y2="${formatSvgNumber(
      yToPx(killFloor),
    )}" stroke="#cc0000" stroke-width="1" stroke-dasharray="4 2"/>`,
    `<line x1="${formatSvgNumber(xToPx(costCeiling))}" y1="${SVG_MARGIN_T}" x2="${formatSvgNumber(
      xToPx(costCeiling),
    )}" y2="${SVG_MARGIN_T + innerH}" stroke="#cc0000" stroke-width="1" stroke-dasharray="4 2"/>`,
    // Pareto polyline (front is already sorted ascending by token cost).
    `<polyline fill="none" stroke="#0050a0" stroke-width="1.5" points="${points}"/>`,
  );
  for (const ind of input.front) {
    pieces.push(
      `<circle cx="${formatSvgNumber(
        xToPx(ind.objectives.tokenCost),
      )}" cy="${formatSvgNumber(
        yToPx(ind.objectives.mutationKillRate),
      )}" r="2.5" fill="#0050a0"/>`,
    );
  }
  if (input.recommendedPlan !== null) {
    pieces.push(
      `<circle cx="${formatSvgNumber(
        xToPx(input.recommendedPlan.objectives.tokenCost),
      )}" cy="${formatSvgNumber(
        yToPx(input.recommendedPlan.objectives.mutationKillRate),
      )}" r="5" fill="none" stroke="#008040" stroke-width="2"/>`,
    );
  }
  // Axis labels (text). Stamped at fixed coordinates for byte stability.
  pieces.push(
    `<text x="${SVG_MARGIN_L + innerW / 2}" y="${SVG_VIEWBOX_H - 16}" text-anchor="middle" font-family="monospace" font-size="11" fill="#000000">token cost (minimize)</text>`,
    `<text x="14" y="${SVG_MARGIN_T + innerH / 2}" text-anchor="middle" font-family="monospace" font-size="11" fill="#000000" transform="rotate(-90 14 ${SVG_MARGIN_T + innerH / 2})">mutation kill rate (maximize)</text>`,
    `<text x="${SVG_VIEWBOX_W / 2}" y="20" text-anchor="middle" font-family="monospace" font-size="12" fill="#000000">${fixtureLabel}</text>`,
    `</svg>`,
  );
  return pieces.join("\n");
};

// ---------------------------------------------------------------------------
// Persistence — atomic writes for byte-stable artifacts.
// ---------------------------------------------------------------------------

export interface WriteCoveragePlanOptimizerReportInput {
  readonly runDir: string;
  readonly report: CoveragePlanOptimizerReport;
}

/**
 * Persist the report at
 * `<runDir>/${COVERAGE_PLAN_OPTIMIZER_ARTIFACT_DIRECTORY}/${COVERAGE_PLAN_OPTIMIZER_REPORT_ARTIFACT_FILENAME}`.
 *
 * Atomic via tmp-then-rename. Returns the resolved path and bytes so a
 * caller can hash or upload the artifact.
 */
export const writeCoveragePlanOptimizerReport = async (
  input: WriteCoveragePlanOptimizerReportInput,
): Promise<{ readonly path: string; readonly bytes: Buffer }> => {
  const filePath = join(
    input.runDir,
    COVERAGE_PLAN_OPTIMIZER_ARTIFACT_DIRECTORY,
    COVERAGE_PLAN_OPTIMIZER_REPORT_ARTIFACT_FILENAME,
  );
  await mkdir(dirname(filePath), { recursive: true });
  const bytes = Buffer.from(
    serializeCoveragePlanOptimizerReport(input.report),
    "utf8",
  );
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, filePath);
  return { path: filePath, bytes };
};
