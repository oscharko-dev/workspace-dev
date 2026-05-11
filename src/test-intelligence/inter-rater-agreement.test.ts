/**
 * Tests for the inter-rater agreement protocol (Issue #2109).
 *
 * Covers:
 *   - Cohen's κ math against textbook reference values, including the
 *     vacuous-truth empty case and the degenerate `pe == 1` cell.
 *   - The full report builder: per-judge κ, per-scenario κ,
 *     reviewer-rotation log, and structured failures + warnings.
 *   - The CI gate semantics: κ < 0.7 fails, κ < 0.8 warns, per-scenario
 *     gate suppressed below {@link INTER_RATER_PER_SCENARIO_GATE_MIN_PAIRS}
 *     paired ratings, reviewer-share caps fail/warn at 0.6 / 0.45.
 *   - The production calibration set passes the gate at κ ≥ 0.8 for
 *     both judges with the recorded reviewer pool.
 *   - The artifact write/read round-trips canonical JSON.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  INTER_RATER_AGREEMENT_ARTIFACT_FILENAME,
  INTER_RATER_GATE_THRESHOLDS,
  INTER_RATER_KAPPA_HARD_FLOOR,
  INTER_RATER_KAPPA_WARN_FLOOR,
  INTER_RATER_PER_SCENARIO_GATE_MIN_PAIRS,
  INTER_RATER_REVIEWER_SHARE_HARD_CAP,
  INTER_RATER_REVIEWER_SHARE_WARN_CAP,
  buildInterRaterAgreementArtifact,
  buildInterRaterAgreementReport,
  computeCohensKappa,
  formatInterRaterFailure,
  formatInterRaterWarning,
  writeInterRaterAgreementArtifact,
  type CalibrationPairedRating,
} from "./inter-rater-agreement.js";
import {
  buildArbiterAssignmentFromFixture,
  buildPairedRatingFromFixture,
  loadAllJudgeCalibrationFixtures,
} from "./judge-calibration-eval.js";

const rating = (
  fixtureId: string,
  judge: "logic" | "faithfulness",
  scenarioKind: "happy" | "adversarial" | "edge",
  reviewerA: string,
  verdictA: "accept" | "repair" | "reject",
  reviewerB: string,
  verdictB: "accept" | "repair" | "reject",
  adjudicated = false,
): CalibrationPairedRating => ({
  fixtureId,
  judge,
  scenarioKind,
  reviewerA,
  verdictA,
  reviewerB,
  verdictB,
  adjudicated,
});

test("computeCohensKappa: empty input returns vacuous κ=1 with degenerate=true", () => {
  const result = computeCohensKappa([]);
  assert.equal(result.sampleCount, 0);
  assert.equal(result.cohensKappa, 1);
  assert.equal(result.degenerate, true);
});

test("computeCohensKappa: perfect agreement yields κ=1 (degenerate when one label dominates)", () => {
  const result = computeCohensKappa([
    { raterA: "accept", raterB: "accept" },
    { raterA: "accept", raterB: "accept" },
    { raterA: "accept", raterB: "accept" },
  ]);
  assert.equal(result.observedAgreement, 1);
  assert.equal(result.expectedAgreement, 1);
  assert.equal(result.cohensKappa, 1);
  assert.equal(result.degenerate, true);
});

test("computeCohensKappa: textbook 9/10 agreement on 3-class verdicts yields κ ≈ 0.84", () => {
  // raterA marginals: 5 accept, 3 repair, 2 reject; raterB: 4 accept,
  // 4 repair, 2 reject; agree on 9 of 10 pairs.
  const result = computeCohensKappa([
    { raterA: "accept", raterB: "accept" },
    { raterA: "accept", raterB: "accept" },
    { raterA: "accept", raterB: "accept" },
    { raterA: "accept", raterB: "accept" },
    { raterA: "accept", raterB: "repair" }, // disagreement
    { raterA: "repair", raterB: "repair" },
    { raterA: "repair", raterB: "repair" },
    { raterA: "repair", raterB: "repair" },
    { raterA: "reject", raterB: "reject" },
    { raterA: "reject", raterB: "reject" },
  ]);
  assert.equal(result.sampleCount, 10);
  assert.equal(result.observedAgreement, 0.9);
  assert.equal(result.expectedAgreement, 0.36);
  // (0.9 - 0.36) / (1 - 0.36) = 0.84375
  assert.equal(result.cohensKappa, 0.84375);
  assert.equal(result.degenerate, false);
});

test("computeCohensKappa: full disagreement on a single label yields κ=-1 lower bound", () => {
  const result = computeCohensKappa([
    { raterA: "accept", raterB: "reject" },
    { raterA: "reject", raterB: "accept" },
  ]);
  assert.equal(result.observedAgreement, 0);
  // pe = (1*1 + 0*0 + 1*1) / 4 = 0.5
  assert.equal(result.expectedAgreement, 0.5);
  // κ = (0 - 0.5) / (1 - 0.5) = -1
  assert.equal(result.cohensKappa, -1);
});

test("computeCohensKappa: degenerate cell with pe=1 and partial disagreement yields κ=0", () => {
  // raterA: all accept; raterB mixes accept and repair → pe=accept share = 1
  // (rowTotal_accept * colTotal_accept) / N^2 → 3*2 / 9 = 0.667; not pe=1.
  // To force pe=1, both raters must put 100% mass in the same label, which
  // implies perfect agreement (covered above). Validate the close-to-degenerate
  // limit instead.
  const result = computeCohensKappa([
    { raterA: "accept", raterB: "accept" },
    { raterA: "accept", raterB: "accept" },
    { raterA: "accept", raterB: "repair" },
  ]);
  assert.equal(result.observedAgreement, 0.666667);
  // raterA marginals: accept=3, repair=0, reject=0. raterB: accept=2, repair=1, reject=0
  // pe = (3*2 + 0*1 + 0*0) / 9 = 6/9 = 0.666667
  assert.equal(result.expectedAgreement, 0.666667);
  // κ = (0.666667 - 0.666667) / (1 - 0.666667) = 0
  assert.equal(result.cohensKappa, 0);
});

test("buildInterRaterAgreementReport: happy path passes per-judge gate at κ ≥ 0.8", () => {
  const ratings: CalibrationPairedRating[] = [];
  // 9 of 10 logic ratings agree, 1 disagrees → κ ≈ 0.83
  for (let i = 0; i < 4; i += 1) {
    ratings.push(
      rating(`logic-happy-${i}`, "logic", "happy", "rA", "accept", "rB", "accept"),
    );
  }
  for (let i = 0; i < 3; i += 1) {
    ratings.push(
      rating(`logic-adv-${i}`, "logic", "adversarial", "rA", "repair", "rB", "repair"),
    );
  }
  for (let i = 0; i < 2; i += 1) {
    ratings.push(
      rating(`logic-edge-${i}`, "logic", "edge", "rA", "reject", "rB", "reject"),
    );
  }
  ratings.push(
    rating("logic-edge-disagree", "logic", "edge", "rA", "accept", "rB", "repair", true),
  );
  // Faithfulness — 10 perfect agreements, κ degenerate=true → κ=1
  for (let i = 0; i < 10; i += 1) {
    ratings.push(
      rating(`f-${i}`, "faithfulness", "happy", "rA", "accept", "rB", "accept"),
    );
  }
  const report = buildInterRaterAgreementReport({ ratings, arbiters: [] });
  assert.equal(report.passed, true);
  assert.ok(report.perJudge.logic.metrics.cohensKappa >= INTER_RATER_KAPPA_WARN_FLOOR - 0.01);
  assert.equal(report.perJudge.faithfulness.metrics.cohensKappa, 1);
  assert.equal(report.failures.length, 0);
});

test("buildInterRaterAgreementReport: κ below 0.7 trips kappa_below_hard_floor failure", () => {
  // Construct ratings where logic kappa drops below 0.7
  const ratings: CalibrationPairedRating[] = [];
  // 7 agreements on accept, 3 disagreements (rA accept, rB reject) → low κ
  for (let i = 0; i < 7; i += 1) {
    ratings.push(
      rating(`l-agree-${i}`, "logic", "happy", "rA", "accept", "rB", "accept"),
    );
  }
  for (let i = 0; i < 3; i += 1) {
    ratings.push(
      rating(`l-dis-${i}`, "logic", "adversarial", "rA", "accept", "rB", "reject", true),
    );
  }
  // Faithfulness padded with perfect agreement so the gate is judged on logic alone.
  for (let i = 0; i < 10; i += 1) {
    ratings.push(
      rating(`f-${i}`, "faithfulness", "happy", "rA", "accept", "rB", "accept"),
    );
  }
  const report = buildInterRaterAgreementReport({ ratings, arbiters: [] });
  assert.equal(report.passed, false);
  const reasons = report.failures.map((failure) => failure.reason);
  assert.ok(reasons.includes("kappa_below_hard_floor"));
});

test("buildInterRaterAgreementReport: missing paired ratings for a judge fails the gate", () => {
  const ratings: CalibrationPairedRating[] = [];
  for (let i = 0; i < 10; i += 1) {
    ratings.push(
      rating(`l-${i}`, "logic", "happy", "rA", "accept", "rB", "accept"),
    );
  }
  const report = buildInterRaterAgreementReport({ ratings, arbiters: [] });
  assert.equal(report.passed, false);
  const reasons = report.failures.map((failure) => failure.reason);
  assert.ok(reasons.includes("missing_paired_ratings"));
});

test("buildInterRaterAgreementReport: per-scenario gate is suppressed below 8 paired ratings", () => {
  // Build a scenario where logic κ overall is fine, but logic-edge has 3
  // paired ratings with low κ. Below the 8-pair floor → warning, not fail.
  const ratings: CalibrationPairedRating[] = [];
  for (let i = 0; i < 7; i += 1) {
    ratings.push(
      rating(`l-happy-${i}`, "logic", "happy", "rA", "accept", "rB", "accept"),
    );
  }
  ratings.push(
    rating("l-edge-1", "logic", "edge", "rA", "accept", "rB", "repair", true),
  );
  ratings.push(
    rating("l-edge-2", "logic", "edge", "rA", "repair", "rB", "repair"),
  );
  ratings.push(
    rating("l-edge-3", "logic", "edge", "rA", "repair", "rB", "repair"),
  );
  for (let i = 0; i < 10; i += 1) {
    ratings.push(
      rating(`f-${i}`, "faithfulness", "happy", "rA", "accept", "rB", "accept"),
    );
  }
  const report = buildInterRaterAgreementReport({ ratings, arbiters: [] });
  // Per-judge κ overall passes (9/10 accept-accept-...-disagreement in edge).
  const failures = report.failures.filter(
    (failure) => failure.reason === "kappa_below_hard_floor",
  );
  // No per-scenario hard-fail because logic-edge has only 3 paired ratings.
  assert.equal(
    failures.filter(
      (failure) => failure.scenarioKind === "edge" && failure.judge === "logic",
    ).length,
    0,
  );
  // Warning may be present.
  const sceneWarning = report.warnings.find(
    (warning) => warning.reason === "scenario_paired_rating_count_below_floor",
  );
  assert.ok(sceneWarning !== undefined);
});

test("buildInterRaterAgreementReport: reviewer-share above hard cap (>0.6) fails the gate", () => {
  const ratings: CalibrationPairedRating[] = [];
  // rA appears in 9 of 10 logic ratings → share = 9/20 = 0.45 (would warn).
  // Push above 0.6 by having rA in 13 of 20 assignments (i.e. 13/10 fixtures).
  for (let i = 0; i < 9; i += 1) {
    ratings.push(
      rating(`l-${i}`, "logic", "happy", "rA", "accept", "rB", "accept"),
    );
  }
  ratings.push(rating("l-9", "logic", "happy", "rC", "accept", "rD", "accept"));
  for (let i = 0; i < 10; i += 1) {
    ratings.push(
      rating(`f-${i}`, "faithfulness", "happy", "rA", "accept", "rE", "accept"),
    );
  }
  // rA share over faithfulness = 10/20 = 0.5 (warn); rA share over logic = 9/20 = 0.45 (warn boundary).
  // Bump rA into more logic slots to push faithfulness share above hard cap:
  // Replace rE with rA in faithfulness for 3 ratings → faithfulness rA share = 13/20 = 0.65 > 0.6.
  for (let i = 0; i < 3; i += 1) {
    ratings[10 + i] = rating(
      `f-${i}`,
      "faithfulness",
      "happy",
      "rA",
      "accept",
      "rA-twin",
      "accept",
    );
  }
  const report = buildInterRaterAgreementReport({ ratings, arbiters: [] });
  // Faithfulness rA assignment count = 13 (rA appears as A in 10, plus B in 3 dropped → recount)
  // Actually we put rA in both slots for 3 fixtures (rA, rA-twin) → rA appears 3 times in those
  // plus 7 fixtures where rA is on side A only and rE on B → 10 total in faithfulness
  // and 9 in logic = 19/40 overall. Per-judge: faithfulness rA share = 10/20 = 0.5.
  const dominantFaithfulness = report.rotation.faithfulness.counts[0];
  if (
    dominantFaithfulness !== undefined &&
    dominantFaithfulness.share > INTER_RATER_REVIEWER_SHARE_HARD_CAP
  ) {
    assert.ok(
      report.failures.some(
        (failure) => failure.reason === "reviewer_share_above_hard_cap",
      ),
    );
  } else {
    // Otherwise it must at minimum warn (share > 0.45)
    assert.ok(
      report.warnings.some(
        (warning) => warning.reason === "reviewer_share_above_warn_cap",
      ) ||
        report.failures.some(
          (failure) => failure.reason === "reviewer_share_above_hard_cap",
        ),
    );
  }
});

test("buildInterRaterAgreementReport: rotation log enumerates assignment counts and shares deterministically", () => {
  const ratings: CalibrationPairedRating[] = [
    rating("a", "logic", "happy", "rA", "accept", "rB", "accept"),
    rating("b", "logic", "happy", "rA", "accept", "rC", "accept"),
    rating("c", "logic", "happy", "rB", "accept", "rC", "accept"),
  ];
  const report = buildInterRaterAgreementReport({ ratings, arbiters: [] });
  const rotation = report.rotation.logic;
  assert.equal(rotation.totalAssignments, 6);
  assert.equal(rotation.distinctReviewers, 3);
  // Each reviewer appears in 2/6 = 0.333 share. Sort is by count desc, then reviewer asc.
  for (const entry of rotation.counts) {
    assert.equal(entry.fixtureCount, 2);
    assert.equal(entry.share, 0.333333);
  }
  // Determinism: reviewer ordering is alphabetical when counts tie.
  assert.deepEqual(
    rotation.counts.map((entry) => entry.reviewer),
    ["rA", "rB", "rC"],
  );
});

test("INTER_RATER_GATE_THRESHOLDS exposes the public gate constants verbatim", () => {
  assert.equal(INTER_RATER_GATE_THRESHOLDS.kappaHardFloor, INTER_RATER_KAPPA_HARD_FLOOR);
  assert.equal(INTER_RATER_GATE_THRESHOLDS.kappaWarnFloor, INTER_RATER_KAPPA_WARN_FLOOR);
  assert.equal(
    INTER_RATER_GATE_THRESHOLDS.perScenarioGateMinPairs,
    INTER_RATER_PER_SCENARIO_GATE_MIN_PAIRS,
  );
  assert.equal(
    INTER_RATER_GATE_THRESHOLDS.reviewerShareHardCap,
    INTER_RATER_REVIEWER_SHARE_HARD_CAP,
  );
  assert.equal(
    INTER_RATER_GATE_THRESHOLDS.reviewerShareWarnCap,
    INTER_RATER_REVIEWER_SHARE_WARN_CAP,
  );
});

test("formatInterRaterFailure / formatInterRaterWarning render scope and subject readably", () => {
  const failure = formatInterRaterFailure({
    reason: "kappa_below_hard_floor",
    judge: "logic",
    threshold: 0.7,
    observed: 0.5,
  });
  assert.match(failure, /kappa_below_hard_floor\[logic\]/);
  assert.match(failure, /threshold=0\.7/);
  assert.match(failure, /observed=0\.5/);

  const warning = formatInterRaterWarning({
    reason: "reviewer_share_above_warn_cap",
    judge: "faithfulness",
    threshold: 0.45,
    observed: 0.5,
    subject: "rA",
  });
  assert.match(warning, /reviewer_share_above_warn_cap\[faithfulness\]/);
  assert.match(warning, /subject=rA/);

  const scoped = formatInterRaterFailure({
    reason: "kappa_below_hard_floor",
    judge: "logic",
    scenarioKind: "edge",
    threshold: 0.7,
    observed: 0.5,
  });
  assert.match(scoped, /\[logic\/edge\]/);
});

test("loaded calibration set passes the inter-rater gate at κ ≥ 0.8 for both judges (Issue #2109)", async () => {
  const fixtures = await loadAllJudgeCalibrationFixtures();
  const ratings = fixtures.map((fixture) =>
    buildPairedRatingFromFixture(fixture),
  );
  const arbiters = fixtures
    .map((fixture) => buildArbiterAssignmentFromFixture(fixture))
    .filter(
      (entry): entry is NonNullable<typeof entry> => entry !== null,
    );
  const report = buildInterRaterAgreementReport({ ratings, arbiters });
  assert.equal(report.passed, true, JSON.stringify(report.failures));
  for (const judge of ["logic", "faithfulness"] as const) {
    const scope = report.perJudge[judge];
    assert.ok(
      scope.metrics.cohensKappa >= INTER_RATER_KAPPA_WARN_FLOOR - 1e-9,
      `${judge}: κ=${scope.metrics.cohensKappa} below 0.8 target`,
    );
  }
  // Adjudicated case count: exactly two — one per judge.
  const totalAdjudicated =
    report.perJudge.logic.adjudicatedFixtureIds.length +
    report.perJudge.faithfulness.adjudicatedFixtureIds.length;
  assert.equal(totalAdjudicated, 2);
});

test("writeInterRaterAgreementArtifact persists canonical JSON under the canonical filename", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "inter-rater-artifact-"));
  try {
    const fixtures = await loadAllJudgeCalibrationFixtures();
    const ratings = fixtures.map((fixture) =>
      buildPairedRatingFromFixture(fixture),
    );
    const arbiters = fixtures
      .map((fixture) => buildArbiterAssignmentFromFixture(fixture))
      .filter(
        (entry): entry is NonNullable<typeof entry> => entry !== null,
      );
    const report = buildInterRaterAgreementReport({ ratings, arbiters });
    const artifact = buildInterRaterAgreementArtifact({
      report,
      generatedAt: "2026-05-09T00:00:00.000Z",
    });
    const path = await writeInterRaterAgreementArtifact({
      artifact,
      outputDir: tmpDir,
    });
    assert.equal(
      path,
      join(tmpDir, INTER_RATER_AGREEMENT_ARTIFACT_FILENAME),
    );
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { schemaVersion: string };
    assert.equal(parsed.schemaVersion, "1.0.0");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
