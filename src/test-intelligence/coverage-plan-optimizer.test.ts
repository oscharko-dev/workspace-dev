import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  COVERAGE_PLAN_OPTIMIZER_ARTIFACT_DIRECTORY,
  COVERAGE_PLAN_OPTIMIZER_BENCHMARK_SCHEMA_VERSION,
  COVERAGE_PLAN_OPTIMIZER_COST_CEILING,
  COVERAGE_PLAN_OPTIMIZER_DEFAULT_SEED,
  COVERAGE_PLAN_OPTIMIZER_KILL_RATE_FLOOR,
  COVERAGE_PLAN_OPTIMIZER_METHODOLOGY_DISCLAIMER,
  COVERAGE_PLAN_OPTIMIZER_OBJECTIVES,
  COVERAGE_PLAN_OPTIMIZER_OBJECTIVE_DIRECTIONS,
  COVERAGE_PLAN_OPTIMIZER_PLOT_DIRECTORY,
  COVERAGE_PLAN_OPTIMIZER_REPORT_ARTIFACT_FILENAME,
  COVERAGE_PLAN_OPTIMIZER_REPORT_SCHEMA_VERSION,
  DEFAULT_NSGA_II_CONFIG,
  G_COVERAGE_OPTIMIZER_BASELINE_PASS,
  REFERENCE_BENCHMARK_FIXTURES,
  buildCoveragePlanOptimizerBaselineReport,
  buildCoveragePlanOptimizerReport,
  computeCoveragePlanOptimizerReportDigest,
  evaluatePlan,
  optimizeFixture,
  renderParetoFrontierSvg,
  selectRecommendedPlan,
  serializeCoveragePlanOptimizerReport,
  writeCoveragePlanOptimizerReport,
  type FixtureBenchmark,
  type NsgaIIConfig,
  type ParetoIndividual,
} from "./coverage-plan-optimizer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const SMALL_FIXTURE: FixtureBenchmark = Object.freeze({
  fixtureId: "small-login-form",
  techniques: ["equivalence_partitioning", "boundary_value_analysis"],
  perTechnique: {
    equivalence_partitioning: {
      killRateSaturation: 6,
      killRateCoefficient: 1,
      coverageCoefficient: 1,
      tokensPerUnit: 1200,
      latencyMsPerUnit: 80,
      minQuota: 1,
      maxQuota: 18,
    },
    boundary_value_analysis: {
      killRateSaturation: 4,
      killRateCoefficient: 0.8,
      coverageCoefficient: 1,
      tokensPerUnit: 900,
      latencyMsPerUnit: 70,
      minQuota: 1,
      maxQuota: 14,
    },
  },
  bestKnownKillRate: 0.8,
  currentTokenCost: 21_600,
  currentLatencyMs: 1520,
  currentQuota: { equivalence_partitioning: 12, boundary_value_analysis: 8 },
});

const LARGE_FIXTURE: FixtureBenchmark = Object.freeze({
  fixtureId: "large-checkout-flow",
  techniques: [
    "equivalence_partitioning",
    "boundary_value_analysis",
    "decision_table",
    "use_case",
    "accessibility",
  ],
  perTechnique: {
    equivalence_partitioning: {
      killRateSaturation: 9,
      killRateCoefficient: 1,
      coverageCoefficient: 1,
      tokensPerUnit: 1400,
      latencyMsPerUnit: 90,
      minQuota: 1,
      maxQuota: 24,
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
    use_case: {
      killRateSaturation: 4,
      killRateCoefficient: 0.5,
      coverageCoefficient: 1,
      tokensPerUnit: 2200,
      latencyMsPerUnit: 140,
      minQuota: 1,
      maxQuota: 10,
    },
    accessibility: {
      killRateSaturation: 3,
      killRateCoefficient: 0.4,
      coverageCoefficient: 1,
      tokensPerUnit: 1500,
      latencyMsPerUnit: 100,
      minQuota: 1,
      maxQuota: 8,
    },
  },
  bestKnownKillRate: 0.8,
  currentTokenCost: 80_000,
  currentLatencyMs: 5000,
  currentQuota: {
    equivalence_partitioning: 14,
    boundary_value_analysis: 10,
    decision_table: 7,
    use_case: 5,
    accessibility: 4,
  },
});

const SMALL_CONFIG: NsgaIIConfig = Object.freeze({
  populationSize: 16,
  generations: 25,
  crossoverRate: 0.9,
  mutationRate: 0.2,
});

// ---------------------------------------------------------------------------
// Constants & methodology
// ---------------------------------------------------------------------------

test("constants: schema versions and gate code are well-formed", () => {
  assert.equal(COVERAGE_PLAN_OPTIMIZER_REPORT_SCHEMA_VERSION, "1.0.0");
  assert.equal(COVERAGE_PLAN_OPTIMIZER_BENCHMARK_SCHEMA_VERSION, "1.0.0");
  assert.equal(
    COVERAGE_PLAN_OPTIMIZER_REPORT_ARTIFACT_FILENAME,
    "coverage-plan-optimizer.json",
  );
  assert.equal(
    COVERAGE_PLAN_OPTIMIZER_ARTIFACT_DIRECTORY,
    "coverage-optimizer",
  );
  assert.equal(
    G_COVERAGE_OPTIMIZER_BASELINE_PASS,
    "G_COVERAGE_OPTIMIZER_BASELINE_PASS",
  );
});

test("constants: AC#4 thresholds match the issue specification", () => {
  assert.equal(COVERAGE_PLAN_OPTIMIZER_KILL_RATE_FLOOR, 0.95);
  assert.equal(COVERAGE_PLAN_OPTIMIZER_COST_CEILING, 0.8);
});

test("constants: objective list & directions are closed and well-formed", () => {
  assert.deepEqual([...COVERAGE_PLAN_OPTIMIZER_OBJECTIVES], [
    "mutationKillRate",
    "techniqueCoverage",
    "tokenCost",
    "latencyMs",
  ]);
  assert.equal(
    COVERAGE_PLAN_OPTIMIZER_OBJECTIVE_DIRECTIONS.mutationKillRate,
    "maximize",
  );
  assert.equal(
    COVERAGE_PLAN_OPTIMIZER_OBJECTIVE_DIRECTIONS.techniqueCoverage,
    "maximize",
  );
  assert.equal(
    COVERAGE_PLAN_OPTIMIZER_OBJECTIVE_DIRECTIONS.tokenCost,
    "minimize",
  );
  assert.equal(
    COVERAGE_PLAN_OPTIMIZER_OBJECTIVE_DIRECTIONS.latencyMs,
    "minimize",
  );
});

test("constants: methodology disclaimer is verbatim and non-empty", () => {
  assert.match(
    COVERAGE_PLAN_OPTIMIZER_METHODOLOGY_DISCLAIMER,
    /NSGA-II Pareto-frontier search/,
  );
  assert.match(
    COVERAGE_PLAN_OPTIMIZER_METHODOLOGY_DISCLAIMER,
    /not for legally binding/,
  );
});

test("DEFAULT_NSGA_II_CONFIG passes its own validator", () => {
  assert.equal(DEFAULT_NSGA_II_CONFIG.populationSize % 2, 0);
  assert.ok(DEFAULT_NSGA_II_CONFIG.populationSize >= 8);
  assert.ok(DEFAULT_NSGA_II_CONFIG.generations >= 1);
  assert.ok(
    DEFAULT_NSGA_II_CONFIG.crossoverRate >= 0 &&
      DEFAULT_NSGA_II_CONFIG.crossoverRate <= 1,
  );
  assert.ok(
    DEFAULT_NSGA_II_CONFIG.mutationRate >= 0 &&
      DEFAULT_NSGA_II_CONFIG.mutationRate <= 1,
  );
});

// ---------------------------------------------------------------------------
// evaluatePlan — surrogate model
// ---------------------------------------------------------------------------

test("evaluatePlan: zero-min fixture with zero quota yields zero objectives", () => {
  const zeroFixture: FixtureBenchmark = {
    fixtureId: "zero-min",
    techniques: ["t"],
    perTechnique: {
      t: {
        killRateSaturation: 1,
        killRateCoefficient: 1,
        coverageCoefficient: 1,
        tokensPerUnit: 100,
        latencyMsPerUnit: 10,
        minQuota: 0,
        maxQuota: 5,
      },
    },
    bestKnownKillRate: 0.5,
    currentTokenCost: 500,
    currentLatencyMs: 50,
    currentQuota: { t: 5 },
  };
  const v = evaluatePlan({ t: 0 }, zeroFixture);
  assert.equal(v.mutationKillRate, 0);
  assert.equal(v.techniqueCoverage, 0);
  assert.equal(v.tokenCost, 0);
  assert.equal(v.latencyMs, 0);
});

test("evaluatePlan: more quota never decreases kill rate (monotonic)", () => {
  const low = { equivalence_partitioning: 2, boundary_value_analysis: 2 };
  const high = { equivalence_partitioning: 18, boundary_value_analysis: 14 };
  const lowV = evaluatePlan(low, SMALL_FIXTURE);
  const highV = evaluatePlan(high, SMALL_FIXTURE);
  assert.ok(highV.mutationKillRate >= lowV.mutationKillRate);
  assert.ok(highV.tokenCost >= lowV.tokenCost);
  assert.ok(highV.latencyMs >= lowV.latencyMs);
});

test("evaluatePlan: kill rate stays in [0,1] and coverage in [0,1]", () => {
  const plan = {
    equivalence_partitioning: 18,
    boundary_value_analysis: 14,
  };
  const v = evaluatePlan(plan, SMALL_FIXTURE);
  assert.ok(v.mutationKillRate >= 0 && v.mutationKillRate <= 1);
  assert.ok(v.techniqueCoverage >= 0 && v.techniqueCoverage <= 1);
});

test("evaluatePlan: clamps quotas outside [minQuota, maxQuota]", () => {
  const inside = evaluatePlan(
    { equivalence_partitioning: 18, boundary_value_analysis: 14 },
    SMALL_FIXTURE,
  );
  const above = evaluatePlan(
    { equivalence_partitioning: 999, boundary_value_analysis: 999 },
    SMALL_FIXTURE,
  );
  assert.deepEqual(inside, above);
});

test("evaluatePlan: pure — same input ⇒ byte-identical output", () => {
  const plan = { equivalence_partitioning: 7, boundary_value_analysis: 5 };
  const a = evaluatePlan(plan, SMALL_FIXTURE);
  const b = evaluatePlan(plan, SMALL_FIXTURE);
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// optimizeFixture — NSGA-II loop
// ---------------------------------------------------------------------------

test("optimizeFixture: deterministic — same seed ⇒ byte-identical result", () => {
  const a = optimizeFixture({
    fixture: SMALL_FIXTURE,
    config: SMALL_CONFIG,
    seed: 42,
  });
  const b = optimizeFixture({
    fixture: SMALL_FIXTURE,
    config: SMALL_CONFIG,
    seed: 42,
  });
  assert.deepEqual(a, b);
});

test("optimizeFixture: returns a non-empty Pareto front", () => {
  const result = optimizeFixture({
    fixture: SMALL_FIXTURE,
    config: SMALL_CONFIG,
    seed: 13,
  });
  assert.ok(result.paretoFront.length > 0);
});

test("optimizeFixture: Pareto front is internally non-dominated", () => {
  const result = optimizeFixture({
    fixture: LARGE_FIXTURE,
    config: SMALL_CONFIG,
    seed: 99,
  });
  for (let i = 0; i < result.paretoFront.length; i++) {
    for (let j = 0; j < result.paretoFront.length; j++) {
      if (i === j) continue;
      const a = result.paretoFront[i]!.objectives;
      const b = result.paretoFront[j]!.objectives;
      const aDominatesB =
        a.mutationKillRate >= b.mutationKillRate &&
        a.techniqueCoverage >= b.techniqueCoverage &&
        a.tokenCost <= b.tokenCost &&
        a.latencyMs <= b.latencyMs &&
        (a.mutationKillRate > b.mutationKillRate ||
          a.techniqueCoverage > b.techniqueCoverage ||
          a.tokenCost < b.tokenCost ||
          a.latencyMs < b.latencyMs);
      assert.equal(aDominatesB, false);
    }
  }
});

test("optimizeFixture: front is sorted by ascending token cost", () => {
  const result = optimizeFixture({
    fixture: LARGE_FIXTURE,
    config: SMALL_CONFIG,
    seed: 7,
  });
  for (let i = 1; i < result.paretoFront.length; i++) {
    assert.ok(
      result.paretoFront[i]!.objectives.tokenCost >=
        result.paretoFront[i - 1]!.objectives.tokenCost,
    );
  }
});

test("optimizeFixture: every plan obeys per-technique [minQuota, maxQuota]", () => {
  const result = optimizeFixture({
    fixture: LARGE_FIXTURE,
    config: SMALL_CONFIG,
    seed: 7,
  });
  for (const ind of result.paretoFront) {
    for (const technique of LARGE_FIXTURE.techniques) {
      const coeffs = LARGE_FIXTURE.perTechnique[technique]!;
      const q = ind.plan[technique]!;
      assert.ok(q >= coeffs.minQuota);
      assert.ok(q <= coeffs.maxQuota);
    }
  }
});

test("optimizeFixture: recommended plan satisfies AC #4 for representative fixtures", () => {
  const result = optimizeFixture({
    fixture: LARGE_FIXTURE,
    config: SMALL_CONFIG,
    seed: 7,
  });
  assert.equal(result.satisfiesAcceptanceCriteria, true);
  assert.equal(result.selectionReason, "selected");
  const rec = result.recommendedPlan!;
  assert.ok(
    rec.objectives.mutationKillRate >=
      LARGE_FIXTURE.bestKnownKillRate * COVERAGE_PLAN_OPTIMIZER_KILL_RATE_FLOOR,
    `kill rate ${rec.objectives.mutationKillRate} below floor`,
  );
  assert.ok(
    rec.objectives.tokenCost <=
      LARGE_FIXTURE.currentTokenCost * COVERAGE_PLAN_OPTIMIZER_COST_CEILING,
    `cost ${rec.objectives.tokenCost} above ceiling`,
  );
});

test("optimizeFixture: rejects fixture with currentQuota outside [min, max]", () => {
  const broken: FixtureBenchmark = {
    ...SMALL_FIXTURE,
    currentQuota: { equivalence_partitioning: 999, boundary_value_analysis: 2 },
  };
  assert.throws(
    () => optimizeFixture({ fixture: broken, config: SMALL_CONFIG, seed: 1 }),
    /outside/,
  );
});

// ---------------------------------------------------------------------------
// selectRecommendedPlan — AC #4 contract
// ---------------------------------------------------------------------------

// Floor for LARGE_FIXTURE: 0.95 * 0.80 = 0.76; ceiling: 0.80 * 80_000 = 64_000.
const FAKE_FRONT: ParetoIndividual[] = [
  {
    plan: { a: 1 },
    objectives: {
      mutationKillRate: 0.5, // below floor
      techniqueCoverage: 0.6,
      tokenCost: 8_000,
      latencyMs: 400,
    },
    rank: 0,
    crowdingDistance: 1,
  },
  {
    plan: { a: 2 },
    objectives: {
      mutationKillRate: 0.8, // above floor
      techniqueCoverage: 0.9,
      tokenCost: 50_000, // below ceiling
      latencyMs: 3_000,
    },
    rank: 0,
    crowdingDistance: 0.5,
  },
  {
    plan: { a: 3 },
    objectives: {
      mutationKillRate: 0.85, // above floor
      techniqueCoverage: 1.0,
      tokenCost: 70_000, // above ceiling
      latencyMs: 4_000,
    },
    rank: 0,
    crowdingDistance: 0.25,
  },
];

test("selectRecommendedPlan: picks the lowest-cost compliant member", () => {
  const result = selectRecommendedPlan({
    front: FAKE_FRONT,
    fixture: LARGE_FIXTURE,
  });
  assert.equal(result.reason, "selected");
  assert.equal(result.recommendedPlan!.objectives.tokenCost, 50_000);
});

test("selectRecommendedPlan: empty front ⇒ empty_front reason", () => {
  const result = selectRecommendedPlan({ front: [], fixture: LARGE_FIXTURE });
  assert.equal(result.recommendedPlan, null);
  assert.equal(result.reason, "empty_front");
});

test("selectRecommendedPlan: all below kill floor ⇒ no_kill_rate_above_floor", () => {
  const result = selectRecommendedPlan({
    front: [FAKE_FRONT[0]!],
    fixture: LARGE_FIXTURE,
  });
  assert.equal(result.recommendedPlan, null);
  assert.equal(result.reason, "no_kill_rate_above_floor");
});

test("selectRecommendedPlan: all above cost ceiling ⇒ no_cost_below_ceiling", () => {
  const result = selectRecommendedPlan({
    front: [FAKE_FRONT[2]!],
    fixture: LARGE_FIXTURE,
  });
  assert.equal(result.recommendedPlan, null);
  assert.equal(result.reason, "no_cost_below_ceiling");
});

// ---------------------------------------------------------------------------
// buildCoveragePlanOptimizerReport — top-level orchestration
// ---------------------------------------------------------------------------

test("buildCoveragePlanOptimizerReport: empty fixtures rejected", () => {
  assert.throws(
    () =>
      buildCoveragePlanOptimizerReport({
        fixtures: [],
        generatedAt: "1970-01-01T00:00:00.000Z",
      }),
    /non-empty/,
  );
});

test("buildCoveragePlanOptimizerReport: duplicate fixtureId rejected", () => {
  assert.throws(
    () =>
      buildCoveragePlanOptimizerReport({
        fixtures: [SMALL_FIXTURE, SMALL_FIXTURE],
        generatedAt: "1970-01-01T00:00:00.000Z",
      }),
    /unique/,
  );
});

test("buildCoveragePlanOptimizerReport: invalid seed rejected", () => {
  assert.throws(
    () =>
      buildCoveragePlanOptimizerReport({
        fixtures: [SMALL_FIXTURE],
        generatedAt: "1970-01-01T00:00:00.000Z",
        seed: -1,
      }),
    /seed/,
  );
});

test("buildCoveragePlanOptimizerReport: invalid generatedAt rejected", () => {
  assert.throws(
    () =>
      buildCoveragePlanOptimizerReport({
        fixtures: [SMALL_FIXTURE],
        generatedAt: "",
      }),
    /generatedAt/,
  );
});

test("buildCoveragePlanOptimizerReport: fixtures sorted by id", () => {
  const report = buildCoveragePlanOptimizerReport({
    fixtures: [LARGE_FIXTURE, SMALL_FIXTURE],
    config: SMALL_CONFIG,
    generatedAt: "1970-01-01T00:00:00.000Z",
  });
  const ids = report.fixtures.map((f) => f.fixtureId);
  assert.deepEqual([...ids].sort(), ids);
  assert.equal(report.fixtureCount, 2);
  assert.equal(
    report.satisfiesAcceptanceCriteria,
    report.fixtures.every((f) => f.satisfiesAcceptanceCriteria),
  );
});

test("buildCoveragePlanOptimizerReport: deterministic across two calls", () => {
  const a = buildCoveragePlanOptimizerReport({
    fixtures: [LARGE_FIXTURE, SMALL_FIXTURE],
    config: SMALL_CONFIG,
    seed: COVERAGE_PLAN_OPTIMIZER_DEFAULT_SEED,
    generatedAt: "1970-01-01T00:00:00.000Z",
  });
  const b = buildCoveragePlanOptimizerReport({
    fixtures: [LARGE_FIXTURE, SMALL_FIXTURE],
    config: SMALL_CONFIG,
    seed: COVERAGE_PLAN_OPTIMIZER_DEFAULT_SEED,
    generatedAt: "1970-01-01T00:00:00.000Z",
  });
  assert.equal(
    serializeCoveragePlanOptimizerReport(a),
    serializeCoveragePlanOptimizerReport(b),
  );
});

// ---------------------------------------------------------------------------
// SVG plot
// ---------------------------------------------------------------------------

test("renderParetoFrontierSvg: deterministic, well-formed SVG", () => {
  const result = optimizeFixture({
    fixture: SMALL_FIXTURE,
    config: SMALL_CONFIG,
    seed: 11,
  });
  const a = renderParetoFrontierSvg({
    fixture: SMALL_FIXTURE,
    front: result.paretoFront,
    recommendedPlan: result.recommendedPlan,
  });
  const b = renderParetoFrontierSvg({
    fixture: SMALL_FIXTURE,
    front: result.paretoFront,
    recommendedPlan: result.recommendedPlan,
  });
  assert.equal(a, b);
  assert.match(a, /^<\?xml version="1\.0"/);
  assert.match(a, /<svg /);
  assert.match(a, /<\/svg>$/);
  assert.match(a, /small-login-form/);
});

test("renderParetoFrontierSvg: handles null recommended plan without throwing", () => {
  const svg = renderParetoFrontierSvg({
    fixture: SMALL_FIXTURE,
    front: [],
    recommendedPlan: null,
  });
  assert.match(svg, /<svg /);
  assert.match(svg, /<\/svg>$/);
});

test("renderParetoFrontierSvg: escapes XML metacharacters in fixture id", () => {
  const fixture: FixtureBenchmark = {
    ...SMALL_FIXTURE,
    fixtureId: "fixture-<&>\"-id",
  };
  const svg = renderParetoFrontierSvg({
    fixture,
    front: [],
    recommendedPlan: null,
  });
  assert.match(svg, /fixture-&lt;&amp;&gt;&quot;-id/);
  assert.doesNotMatch(svg, /<\/svg>[\s\S]*<\/svg>/); // not double-closed
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

test("writeCoveragePlanOptimizerReport: writes byte-stable canonical JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cov-opt-"));
  try {
    const report = buildCoveragePlanOptimizerReport({
      fixtures: [SMALL_FIXTURE],
      config: SMALL_CONFIG,
      generatedAt: "1970-01-01T00:00:00.000Z",
    });
    const { path, bytes } = await writeCoveragePlanOptimizerReport({
      runDir: dir,
      report,
    });
    const onDisk = await readFile(path);
    assert.equal(bytes.equals(onDisk), true);
    const second = await writeCoveragePlanOptimizerReport({
      runDir: dir,
      report,
    });
    const reread = await readFile(second.path);
    assert.equal(reread.equals(onDisk), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AC #5 — Pareto-frontier plot ships in the benchmark report
// ---------------------------------------------------------------------------

test("FixtureOptimizationResult.paretoPlotSvg is present and well-formed for every fixture", () => {
  const report = buildCoveragePlanOptimizerReport({
    fixtures: [SMALL_FIXTURE, LARGE_FIXTURE],
    config: SMALL_CONFIG,
    generatedAt: "1970-01-01T00:00:00.000Z",
  });
  for (const fixture of report.fixtures) {
    assert.match(fixture.paretoPlotSvg, /<svg /);
    assert.match(fixture.paretoPlotSvg, /<\/svg>$/);
  }
});

// ---------------------------------------------------------------------------
// AC #3 — recompute on benchmark refresh: results vary across seeds
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Reference benchmark corpus + committed baseline byte-equality
// ---------------------------------------------------------------------------

test("REFERENCE_BENCHMARK_FIXTURES: every fixture passes its own validator", () => {
  for (const fixture of REFERENCE_BENCHMARK_FIXTURES) {
    // Building a report exercises assertFixtureBenchmark per fixture.
    const report = buildCoveragePlanOptimizerReport({
      fixtures: [fixture],
      config: SMALL_CONFIG,
      generatedAt: "1970-01-01T00:00:00.000Z",
    });
    assert.equal(report.fixtureCount, 1);
  }
});

test("buildCoveragePlanOptimizerBaselineReport: AC #4 holds for every reference fixture", () => {
  const report = buildCoveragePlanOptimizerBaselineReport();
  assert.equal(report.satisfiesAcceptanceCriteria, true);
  for (const fixture of report.fixtures) {
    assert.equal(fixture.selectionReason, "selected", fixture.fixtureId);
    assert.notEqual(fixture.recommendedPlan, null);
  }
});

test("committed baseline.json bytes match the freshly built report (G_COVERAGE_OPTIMIZER_BASELINE_PASS)", async () => {
  const baselinePath = path.join(
    REPO_ROOT,
    COVERAGE_PLAN_OPTIMIZER_PLOT_DIRECTORY,
    "baseline.json",
  );
  const committed = await readFile(baselinePath, "utf8");
  const regenerated = serializeCoveragePlanOptimizerReport(
    buildCoveragePlanOptimizerBaselineReport(),
  );
  assert.equal(
    regenerated,
    committed,
    "committed baseline.json drifted from source — run pnpm run generate:coverage-plan-optimizer-baseline",
  );
});

test("committed pareto-*.svg bytes match the freshly built plots", async () => {
  const report = buildCoveragePlanOptimizerBaselineReport();
  for (const fixture of report.fixtures) {
    const svgPath = path.join(
      REPO_ROOT,
      COVERAGE_PLAN_OPTIMIZER_PLOT_DIRECTORY,
      `pareto-${fixture.fixtureId}.svg`,
    );
    const committed = await readFile(svgPath, "utf8");
    assert.equal(
      fixture.paretoPlotSvg,
      committed,
      `committed pareto plot for ${fixture.fixtureId} drifted`,
    );
  }
});

test("computeCoveragePlanOptimizerReportDigest is byte-stable", () => {
  const a = computeCoveragePlanOptimizerReportDigest(
    buildCoveragePlanOptimizerBaselineReport(),
  );
  const b = computeCoveragePlanOptimizerReportDigest(
    buildCoveragePlanOptimizerBaselineReport(),
  );
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("optimizeFixture: different seeds explore different Pareto fronts", () => {
  const a = optimizeFixture({
    fixture: LARGE_FIXTURE,
    config: SMALL_CONFIG,
    seed: 1,
  });
  const b = optimizeFixture({
    fixture: LARGE_FIXTURE,
    config: SMALL_CONFIG,
    seed: 2,
  });
  // Two seeds should diverge in at least one solution; equality would
  // indicate the RNG is being ignored or the GA collapsed to a constant.
  const ja = a.paretoFront.map((ind) => JSON.stringify(ind.plan)).sort();
  const jb = b.paretoFront.map((ind) => JSON.stringify(ind.plan)).sort();
  assert.notDeepEqual(ja, jb);
});
