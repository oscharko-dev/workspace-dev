/**
 * Tests for the Judge-Calibration-Eval (Issue #1906).
 *
 * Covers:
 *   - Pure metric math against synthetic samples (happy path + every
 *     gate-failure path).
 *   - Fixture-loader contract: every entry in
 *     {@link JUDGE_CALIBRATION_FIXTURE_INDEX} resolves on disk and the
 *     gold/input pair agrees on judge id and scenarioKind.
 *   - Production calibration set: with the recorded mock responses the
 *     suite passes the production hard-gate thresholds (accuracy ≥ 0.85,
 *     FPR ≤ 0.10, FNR ≤ 0.20) for both judges.
 *   - Drift-history file: append, trim, and re-load round-trip.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  JUDGE_CALIBRATION_EVAL_REPORT_DIRNAME,
  JUDGE_CALIBRATION_EVAL_SCHEMA_VERSION,
  JUDGE_CALIBRATION_FIXTURE_INDEX,
  JUDGE_CALIBRATION_HARD_THRESHOLDS,
  JUDGE_CALIBRATION_HISTORY_FILENAME,
  JUDGE_CALIBRATION_HISTORY_MAX_ENTRIES,
  appendJudgeCalibrationHistoryEntry,
  buildJudgeCalibrationEvalArtifact,
  buildSampleFromFixture,
  computeJudgeCalibrationMetrics,
  evaluateJudgeCalibrationVerdict,
  judgeCalibrationEvalReportFilename,
  loadAllJudgeCalibrationFixtures,
  loadJudgeCalibrationFixture,
  partitionSamplesByJudge,
  readJudgeCalibrationEvalArtifact,
  resolveJudgeCalibrationFixturePath,
  writeJudgeCalibrationEvalArtifact,
  type JudgeCalibrationJudgeId,
  type JudgeCalibrationSample,
  type JudgeCalibrationVerdictLabel,
} from "./judge-calibration-eval.js";

const sample = (
  fixtureId: string,
  options: {
    judge?: JudgeCalibrationJudgeId;
    scenarioKind?: "happy" | "adversarial" | "edge";
    humanVerdict: JudgeCalibrationVerdictLabel;
    predictedVerdict: JudgeCalibrationVerdictLabel;
    humanFindingCodes?: ReadonlyArray<string>;
    predictedFindingCodes?: ReadonlyArray<string>;
  },
): JudgeCalibrationSample => ({
  fixtureId,
  judge: options.judge ?? "logic",
  scenarioKind: options.scenarioKind ?? "happy",
  humanVerdict: options.humanVerdict,
  humanFindingCodes: options.humanFindingCodes ?? [],
  predictedVerdict: options.predictedVerdict,
  predictedFindingCodes: options.predictedFindingCodes ?? [],
});

test("computeJudgeCalibrationMetrics: perfect accept stream produces accuracy 1.0 and zero FP/FN", () => {
  const metrics = computeJudgeCalibrationMetrics([
    sample("a", { humanVerdict: "accept", predictedVerdict: "accept" }),
    sample("b", { humanVerdict: "accept", predictedVerdict: "accept" }),
    sample("c", { humanVerdict: "accept", predictedVerdict: "accept" }),
  ]);
  assert.equal(metrics.sampleCount, 3);
  assert.equal(metrics.accuracy, 1);
  assert.equal(metrics.falsePositiveRate, 0);
  assert.equal(metrics.falseNegativeRate, 0);
  assert.equal(metrics.findingPrecision, 1);
  assert.equal(metrics.findingRecall, 1);
  assert.equal(metrics.confusionMatrix.trueAccept, 3);
  assert.deepEqual(metrics.divergences, []);
});

test("computeJudgeCalibrationMetrics: false positive (judge accept while human reject) lifts FPR and is captured in divergences", () => {
  const metrics = computeJudgeCalibrationMetrics([
    sample("happy-1", { humanVerdict: "accept", predictedVerdict: "accept" }),
    sample("happy-2", { humanVerdict: "accept", predictedVerdict: "accept" }),
    sample("bad-1", {
      humanVerdict: "reject",
      predictedVerdict: "accept",
      humanFindingCodes: ["hallucinated_id"],
    }),
  ]);
  assert.equal(metrics.sampleCount, 3);
  assert.equal(metrics.accuracy, 0.666667);
  // 1 false positive over 1 human-non-accept case → FPR = 1.0
  assert.equal(metrics.falsePositiveRate, 1);
  assert.equal(metrics.falseNegativeRate, 0);
  assert.equal(metrics.confusionMatrix.falsePositive, 1);
  assert.deepEqual(metrics.divergences[0]?.fixtureId, "bad-1");
  assert.deepEqual(metrics.divergences[0]?.missingFindingCodes, [
    "hallucinated_id",
  ]);
});

test("computeJudgeCalibrationMetrics: false negative (judge reject while human accept) lifts FNR", () => {
  const metrics = computeJudgeCalibrationMetrics([
    sample("a", { humanVerdict: "accept", predictedVerdict: "accept" }),
    sample("b", { humanVerdict: "accept", predictedVerdict: "accept" }),
    sample("c", { humanVerdict: "accept", predictedVerdict: "reject" }),
    sample("d", { humanVerdict: "reject", predictedVerdict: "reject" }),
  ]);
  assert.equal(metrics.confusionMatrix.falseNegative, 1);
  assert.equal(metrics.falseNegativeRate, 0.333333);
  assert.equal(metrics.falsePositiveRate, 0);
});

test("computeJudgeCalibrationMetrics: over-repair (judge repair while human accept) is captured but does NOT count as FP/FN", () => {
  const metrics = computeJudgeCalibrationMetrics([
    sample("a", { humanVerdict: "accept", predictedVerdict: "accept" }),
    sample("b", { humanVerdict: "accept", predictedVerdict: "repair" }),
  ]);
  assert.equal(metrics.confusionMatrix.overRepair, 1);
  assert.equal(metrics.falsePositiveRate, 0);
  assert.equal(metrics.falseNegativeRate, 0);
  assert.equal(metrics.accuracy, 0.5);
});

test("computeJudgeCalibrationMetrics: finding precision and recall split TP/FP/FN cleanly", () => {
  const metrics = computeJudgeCalibrationMetrics([
    sample("a", {
      humanVerdict: "repair",
      predictedVerdict: "repair",
      humanFindingCodes: ["a", "b"],
      predictedFindingCodes: ["a", "c"],
    }),
  ]);
  // TP={a}, FP={c}, FN={b} → precision=1/2=0.5, recall=1/2=0.5
  assert.equal(metrics.findingCounts.truePositive, 1);
  assert.equal(metrics.findingCounts.falsePositive, 1);
  assert.equal(metrics.findingCounts.falseNegative, 1);
  assert.equal(metrics.findingPrecision, 0.5);
  assert.equal(metrics.findingRecall, 0.5);
  assert.deepEqual(metrics.divergences[0]?.missingFindingCodes, ["b"]);
  assert.deepEqual(metrics.divergences[0]?.extraFindingCodes, ["c"]);
});

test("computeJudgeCalibrationMetrics: empty sample list yields neutral metrics (accuracy 1, rates 0)", () => {
  const metrics = computeJudgeCalibrationMetrics([]);
  assert.equal(metrics.sampleCount, 0);
  assert.equal(metrics.accuracy, 1);
  assert.equal(metrics.falsePositiveRate, 0);
  assert.equal(metrics.falseNegativeRate, 0);
  assert.equal(metrics.findingPrecision, 1);
  assert.equal(metrics.findingRecall, 1);
  assert.deepEqual(metrics.divergences, []);
});

test("evaluateJudgeCalibrationVerdict: passes when all metrics are within thresholds", () => {
  const metrics = computeJudgeCalibrationMetrics([
    sample("a", { humanVerdict: "accept", predictedVerdict: "accept" }),
    sample("b", { humanVerdict: "accept", predictedVerdict: "accept" }),
    sample("c", { humanVerdict: "reject", predictedVerdict: "reject" }),
    sample("d", { humanVerdict: "reject", predictedVerdict: "reject" }),
  ]);
  const verdict = evaluateJudgeCalibrationVerdict(metrics);
  assert.equal(verdict.passed, true);
  assert.deepEqual(verdict.failures, []);
});

test("evaluateJudgeCalibrationVerdict: emits accuracy_below_threshold when accuracy < 0.85", () => {
  const metrics = computeJudgeCalibrationMetrics([
    sample("a", { humanVerdict: "accept", predictedVerdict: "accept" }),
    sample("b", { humanVerdict: "accept", predictedVerdict: "repair" }),
    sample("c", { humanVerdict: "accept", predictedVerdict: "repair" }),
  ]);
  const verdict = evaluateJudgeCalibrationVerdict(metrics);
  assert.equal(verdict.passed, false);
  assert.deepEqual(
    verdict.failures.map((failure) => failure.reason).sort(),
    ["accuracy_below_threshold"],
  );
});

test("evaluateJudgeCalibrationVerdict: emits false_positive_rate_above_threshold when FPR > 0.10", () => {
  // 8 happy-correct, 2 reject cases → 1 FP lifts FPR to 0.5 > 0.10
  const samples: JudgeCalibrationSample[] = [];
  for (let i = 0; i < 8; i += 1) {
    samples.push(
      sample(`accept-${i}`, {
        humanVerdict: "accept",
        predictedVerdict: "accept",
      }),
    );
  }
  samples.push(
    sample("reject-correct", {
      humanVerdict: "reject",
      predictedVerdict: "reject",
    }),
  );
  samples.push(
    sample("reject-fp", {
      humanVerdict: "reject",
      predictedVerdict: "accept",
    }),
  );
  const metrics = computeJudgeCalibrationMetrics(samples);
  const verdict = evaluateJudgeCalibrationVerdict(metrics);
  assert.equal(verdict.passed, false);
  const reasons = verdict.failures.map((failure) => failure.reason).sort();
  assert.ok(reasons.includes("false_positive_rate_above_threshold"));
});

test("evaluateJudgeCalibrationVerdict: emits false_negative_rate_above_threshold when FNR > 0.20", () => {
  const samples: JudgeCalibrationSample[] = [];
  for (let i = 0; i < 4; i += 1) {
    samples.push(
      sample(`accept-${i}`, {
        humanVerdict: "accept",
        predictedVerdict: "accept",
      }),
    );
  }
  samples.push(
    sample("accept-fn", {
      humanVerdict: "accept",
      predictedVerdict: "reject",
    }),
  );
  // 1 FN over 5 human-accept cases → FNR = 0.2 (boundary, must NOT trip)
  let metrics = computeJudgeCalibrationMetrics(samples);
  let verdict = evaluateJudgeCalibrationVerdict(metrics);
  assert.equal(
    verdict.failures.some(
      (failure) => failure.reason === "false_negative_rate_above_threshold",
    ),
    false,
    "boundary 0.2 must not trip the gate",
  );

  samples.push(
    sample("accept-fn-2", {
      humanVerdict: "accept",
      predictedVerdict: "reject",
    }),
  );
  // 2 FN over 6 human-accept cases → FNR = 0.333 > 0.2 → tripped
  metrics = computeJudgeCalibrationMetrics(samples);
  verdict = evaluateJudgeCalibrationVerdict(metrics);
  assert.ok(
    verdict.failures.some(
      (failure) => failure.reason === "false_negative_rate_above_threshold",
    ),
  );
});

test("partitionSamplesByJudge splits samples into logic and faithfulness buckets", () => {
  const split = partitionSamplesByJudge([
    sample("a", { judge: "logic", humanVerdict: "accept", predictedVerdict: "accept" }),
    sample("b", { judge: "faithfulness", humanVerdict: "accept", predictedVerdict: "accept" }),
    sample("c", { judge: "logic", humanVerdict: "reject", predictedVerdict: "reject" }),
  ]);
  assert.equal(split.logic.length, 2);
  assert.equal(split.faithfulness.length, 1);
});

test("loadJudgeCalibrationFixture round-trips a single fixture pair", async () => {
  const fixture = await loadJudgeCalibrationFixture(
    "logic-happy-loan-form-accept",
  );
  assert.equal(fixture.id, "logic-happy-loan-form-accept");
  assert.equal(fixture.judge, "logic");
  assert.equal(fixture.gold.scenarioKind, "happy");
  assert.equal(fixture.gold.humanVerdict, "accept");
  assert.equal(fixture.input.judge, "logic");
});

test("resolveJudgeCalibrationFixturePath produces stable paths for both kinds", () => {
  const inputPath = resolveJudgeCalibrationFixturePath("X", "input");
  const goldPath = resolveJudgeCalibrationFixturePath("X", "gold");
  assert.ok(inputPath.endsWith("/X.input.json"));
  assert.ok(goldPath.endsWith("/X.gold.json"));
});

test("JUDGE_CALIBRATION_FIXTURE_INDEX contains exactly 10 logic + 10 faithfulness cases with the prescribed scenario mix", () => {
  const logic = JUDGE_CALIBRATION_FIXTURE_INDEX.filter(
    (entry) => entry.judge === "logic",
  );
  const faithfulness = JUDGE_CALIBRATION_FIXTURE_INDEX.filter(
    (entry) => entry.judge === "faithfulness",
  );
  assert.equal(logic.length, 10, "10 logic-judge fixtures");
  assert.equal(faithfulness.length, 10, "10 faithfulness-judge fixtures");
  for (const bucket of [logic, faithfulness]) {
    const happy = bucket.filter((entry) => entry.scenarioKind === "happy");
    const adversarial = bucket.filter(
      (entry) => entry.scenarioKind === "adversarial",
    );
    const edge = bucket.filter((entry) => entry.scenarioKind === "edge");
    assert.equal(happy.length, 4);
    assert.equal(adversarial.length, 3);
    assert.equal(edge.length, 3);
  }
});

test("loadAllJudgeCalibrationFixtures returns 20 fixtures aligned with the index", async () => {
  const fixtures = await loadAllJudgeCalibrationFixtures();
  assert.equal(fixtures.length, JUDGE_CALIBRATION_FIXTURE_INDEX.length);
  for (const [index, fixture] of fixtures.entries()) {
    const expected = JUDGE_CALIBRATION_FIXTURE_INDEX[index];
    assert.equal(fixture.id, expected?.id);
    assert.equal(fixture.judge, expected?.judge);
    assert.equal(fixture.gold.scenarioKind, expected?.scenarioKind);
  }
});

test("calibration set passes the production hard-gate thresholds for both judges", async () => {
  const fixtures = await loadAllJudgeCalibrationFixtures();
  const samples = fixtures.map((fixture) => buildSampleFromFixture(fixture));
  const split = partitionSamplesByJudge(samples);

  for (const judge of ["logic", "faithfulness"] as const) {
    const judgeSamples = split[judge];
    const metrics = computeJudgeCalibrationMetrics(judgeSamples);
    const verdict = evaluateJudgeCalibrationVerdict(metrics);
    assert.equal(judgeSamples.length, 10, `${judge}: 10 samples`);
    // accuracy should be at least 0.85 (production threshold)
    assert.ok(
      metrics.accuracy >= JUDGE_CALIBRATION_HARD_THRESHOLDS.accuracy,
      `${judge}: accuracy ${metrics.accuracy} below threshold`,
    );
    assert.ok(
      metrics.falsePositiveRate <=
        JUDGE_CALIBRATION_HARD_THRESHOLDS.falsePositiveRate,
      `${judge}: FPR ${metrics.falsePositiveRate} above threshold`,
    );
    assert.ok(
      metrics.falseNegativeRate <=
        JUDGE_CALIBRATION_HARD_THRESHOLDS.falseNegativeRate,
      `${judge}: FNR ${metrics.falseNegativeRate} above threshold`,
    );
    assert.equal(verdict.passed, true, `${judge}: production gate must pass`);
  }
});

test("buildJudgeCalibrationEvalArtifact pins schema/contract versions and sorts samples", () => {
  const artifact = buildJudgeCalibrationEvalArtifact({
    judge: "logic",
    samples: [
      sample("logic-z", { judge: "logic", humanVerdict: "accept", predictedVerdict: "accept" }),
      sample("logic-a", { judge: "logic", humanVerdict: "accept", predictedVerdict: "accept" }),
    ],
  });
  assert.equal(artifact.schemaVersion, JUDGE_CALIBRATION_EVAL_SCHEMA_VERSION);
  assert.equal(artifact.judge, "logic");
  assert.equal(artifact.samples[0]?.fixtureId, "logic-a");
  assert.equal(artifact.samples[1]?.fixtureId, "logic-z");
  assert.equal(artifact.verdict.passed, true);
});

test("buildJudgeCalibrationEvalArtifact rejects samples whose judge mismatches the requested judge", () => {
  assert.throws(
    () =>
      buildJudgeCalibrationEvalArtifact({
        judge: "logic",
        samples: [
          sample("a", {
            judge: "faithfulness",
            humanVerdict: "accept",
            predictedVerdict: "accept",
          }),
        ],
      }),
    /judge mismatch/,
  );
});

test("writeJudgeCalibrationEvalArtifact + readJudgeCalibrationEvalArtifact round-trip canonical JSON", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "judge-calibration-eval-"));
  try {
    const artifact = buildJudgeCalibrationEvalArtifact({
      judge: "faithfulness",
      samples: [
        sample("x", {
          judge: "faithfulness",
          humanVerdict: "accept",
          predictedVerdict: "accept",
        }),
      ],
    });
    const outputPath = await writeJudgeCalibrationEvalArtifact({
      artifact,
      outputDir: tmpDir,
    });
    assert.equal(
      outputPath,
      join(tmpDir, judgeCalibrationEvalReportFilename("faithfulness")),
    );
    const reloaded = await readJudgeCalibrationEvalArtifact(outputPath);
    assert.deepEqual(reloaded, artifact);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("appendJudgeCalibrationHistoryEntry appends a row, persists canonical JSON, and trims to maxEntries", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "judge-calibration-history-"));
  try {
    const artifact = buildJudgeCalibrationEvalArtifact({
      judge: "logic",
      samples: [
        sample("a", {
          judge: "logic",
          humanVerdict: "accept",
          predictedVerdict: "accept",
        }),
      ],
    });
    const path1 = await appendJudgeCalibrationHistoryEntry({
      artifact,
      recordedAt: "2026-05-05T01:00:00.000Z",
      outputDir: tmpDir,
      maxEntries: 2,
    });
    assert.equal(
      path1,
      join(tmpDir, JUDGE_CALIBRATION_HISTORY_FILENAME),
    );
    await appendJudgeCalibrationHistoryEntry({
      artifact,
      recordedAt: "2026-05-05T02:00:00.000Z",
      outputDir: tmpDir,
      maxEntries: 2,
    });
    await appendJudgeCalibrationHistoryEntry({
      artifact,
      recordedAt: "2026-05-05T03:00:00.000Z",
      outputDir: tmpDir,
      maxEntries: 2,
    });
    const raw = await readFile(path1, "utf8");
    const parsed = JSON.parse(raw) as { entries: ReadonlyArray<{ recordedAt: string }> };
    // Trimmed to 2 most-recent entries
    assert.equal(parsed.entries.length, 2);
    assert.equal(parsed.entries[0]?.recordedAt, "2026-05-05T02:00:00.000Z");
    assert.equal(parsed.entries[1]?.recordedAt, "2026-05-05T03:00:00.000Z");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("appendJudgeCalibrationHistoryEntry default maxEntries is conservative enough for routine drift tracking", () => {
  // The default keeps the file small enough to commit safely while
  // covering several months of nightly runs at 2 judges per run.
  assert.ok(JUDGE_CALIBRATION_HISTORY_MAX_ENTRIES >= 50);
  assert.ok(JUDGE_CALIBRATION_HISTORY_MAX_ENTRIES <= 1000);
});

test("JUDGE_CALIBRATION_EVAL_REPORT_DIRNAME points at the deployed Storybook eval-reports bundle", () => {
  assert.equal(
    JUDGE_CALIBRATION_EVAL_REPORT_DIRNAME,
    "storybook-static/eval-reports",
  );
});
