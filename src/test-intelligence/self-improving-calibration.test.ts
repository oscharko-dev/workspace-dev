import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  G11_CALIBRATION_REFIT_SAFETY,
  REGULATED_RISK_CLASSES,
  SELF_IMPROVING_CALIBRATION_HARD_GATES,
  SELF_IMPROVING_CALIBRATION_HELD_OUT_FRACTION,
  SELF_IMPROVING_CALIBRATION_MIN_SAMPLES,
  SELF_IMPROVING_CALIBRATION_PROPOSALS_DIRNAME,
  SELF_IMPROVING_CALIBRATION_REJECTION_SUFFIX,
  SELF_IMPROVING_CALIBRATION_SCHEMA_VERSION,
  CalibrationRefitOperatorError,
  CalibrationRefitSafetyHardGateError,
  assertCalibrationRefitSafety,
  loadCalibrationRefitHistory,
  parseCurveFilename,
  proposeCalibrationRefit,
  ratifyOrRollback,
  resolveProductionCurvePath,
  summarizeCalibrationRefitHistory,
  verifyCalibrationOperatorSignature,
  type CalibrationGoldEntry,
  type CalibrationRefitProposal,
  type RegulatedRiskClass,
} from "./self-improving-calibration.js";
import type { SupportedLocale } from "../contracts/index.js";

const REPO_ROOT = join(import.meta.dirname ?? "", "..", "..");
const OPERATOR_KEY_PATH = join(
  REPO_ROOT,
  "fixtures/test-intelligence/audit-dossiers/operator-ed25519.private-key.json",
);

interface MakeEntriesOptions {
  readonly locale?: SupportedLocale;
  readonly riskClass?: RegulatedRiskClass;
  readonly count?: number;
}

/**
 * Build a deterministic, well-separated corpus. Half the entries land at
 * `rawScore = 0.95` with `humanVerdict = 1`, the other half at
 * `rawScore = 0.05` with `humanVerdict = 0`. The Platt fit converges
 * to a steep curve and held-out ECE is near zero.
 */
const makeSeparableEntries = ({
  locale = "DE-DE",
  riskClass = "regulated_data",
  count = 60,
}: MakeEntriesOptions = {}): readonly CalibrationGoldEntry[] => {
  const out: CalibrationGoldEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    const positive = i % 2 === 0;
    const rawScore = positive ? 0.95 : 0.05;
    const humanVerdict: 0 | 1 = positive ? 1 : 0;
    out.push({
      entryId: `entry-${locale}-${riskClass}-${String(i).padStart(4, "0")}`,
      locale,
      riskClass,
      rawScore,
      humanVerdict,
      source: i % 2 === 0 ? "human_review" : "accepted_run",
      recordedAt: "2026-05-10T00:00:00.000Z",
    });
  }
  return out;
};

/**
 * Build a corpus where rawScore and verdict are exactly uncorrelated:
 * verdict alternates every entry while rawScore alternates on a
 * different period. The Platt fit cannot discriminate, confidences
 * stay near 0.5, and Cohen's κ collapses below the absolute floor of
 * 0.7. Used to exercise the rollback path.
 */
const makeUncorrelatedEntries = ({
  locale = "DE-DE",
  riskClass = "regulated_data",
  count = 60,
}: MakeEntriesOptions = {}): readonly CalibrationGoldEntry[] => {
  const out: CalibrationGoldEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    const rawScore = i % 4 < 2 ? 0.95 : 0.05;
    const humanVerdict: 0 | 1 = i % 2 === 0 ? 0 : 1;
    out.push({
      entryId: `entry-${locale}-${riskClass}-${String(i).padStart(4, "0")}`,
      locale,
      riskClass,
      rawScore,
      humanVerdict,
      source: i % 2 === 0 ? "human_review" : "accepted_run",
      recordedAt: "2026-05-10T00:00:00.000Z",
    });
  }
  return out;
};

const buildMixedClassEntries = (locale: SupportedLocale): readonly CalibrationGoldEntry[] => [
  ...makeSeparableEntries({ locale, riskClass: "high", count: 24 }),
  ...makeSeparableEntries({ locale, riskClass: "regulated_data", count: 24 }),
  ...makeSeparableEntries({ locale, riskClass: "financial_transaction", count: 24 }),
];

const makeTmpCurvesDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "ti-self-improving-calibration-"));

// ---------------------------------------------------------------------------
// Constants and parsing
// ---------------------------------------------------------------------------

test("self-improving-calibration: REGULATED_RISK_CLASSES is the exact regulated subset", () => {
  assert.deepEqual([...REGULATED_RISK_CLASSES], [
    "high",
    "regulated_data",
    "financial_transaction",
  ]);
});

test("self-improving-calibration: hard gates carry the issue's published thresholds", () => {
  assert.equal(SELF_IMPROVING_CALIBRATION_HARD_GATES.heldOutEceCeiling, 0.02);
  assert.equal(SELF_IMPROVING_CALIBRATION_HARD_GATES.heldOutKappaFloor, 0.7);
  assert.equal(
    SELF_IMPROVING_CALIBRATION_HARD_GATES.eceRegressionTolerance,
    0.005,
  );
  assert.equal(
    SELF_IMPROVING_CALIBRATION_HARD_GATES.kappaRegressionTolerance,
    0.02,
  );
  assert.equal(
    SELF_IMPROVING_CALIBRATION_HARD_GATES.perClassEceRegressionCeiling,
    0.02,
  );
});

test("self-improving-calibration: parseCurveFilename round-trips production paths", () => {
  const tmp = "/tmp/curves";
  const path = resolveProductionCurvePath({
    curvesDir: tmp,
    locale: "DE-DE",
    riskClass: "regulated_data",
  });
  assert.equal(path.endsWith("/DE-DE__regulated_data.json"), true);
  const parsed = parseCurveFilename("DE-DE__regulated_data.json");
  assert.deepEqual(parsed, { locale: "DE-DE", riskClass: "regulated_data" });
});

test("self-improving-calibration: parseCurveFilename rejects malformed names", () => {
  assert.equal(parseCurveFilename("DE-DE-regulated_data.json"), undefined);
  assert.equal(parseCurveFilename("DE-DE__not_a_class.json"), undefined);
  assert.equal(parseCurveFilename("DE-DE__regulated_data.txt"), undefined);
});

// ---------------------------------------------------------------------------
// proposeCalibrationRefit — happy path
// ---------------------------------------------------------------------------

test("proposeCalibrationRefit: writes a proposal and computes a Platt fit", async () => {
  const dir = await makeTmpCurvesDir();
  try {
    const proposal = await proposeCalibrationRefit({
      locale: "DE-DE",
      riskClass: "regulated_data",
      goldEntries: buildMixedClassEntries("DE-DE"),
      curvesDir: dir,
      proposedAt: "2026-05-11T00:00:00.000Z",
    });
    assert.equal(proposal.schemaVersion, SELF_IMPROVING_CALIBRATION_SCHEMA_VERSION);
    assert.equal(proposal.locale, "DE-DE");
    assert.equal(proposal.riskClass, "regulated_data");
    assert.equal(proposal.rolledBack, false);
    assert.equal(proposal.proposedCurve.intercept !== 0, true);
    assert.equal(proposal.proposedCurve.slope !== 0, true);
    assert.equal(proposal.proposedCurve.digest.length, 64);
    assert.equal(proposal.previousCurveDigest, "");
    // The proposal lands in proposals/ on disk.
    const onDisk = await readFile(
      join(
        dir,
        SELF_IMPROVING_CALIBRATION_PROPOSALS_DIRNAME,
        `${proposal.proposalId}.json`,
      ),
      "utf8",
    );
    const reloaded = JSON.parse(onDisk) as CalibrationRefitProposal;
    assert.equal(reloaded.proposalId, proposal.proposalId);
    assert.equal(reloaded.proposedCurveDigest, proposal.proposedCurveDigest);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("proposeCalibrationRefit: identical inputs produce identical proposalId and digest", async () => {
  const dirA = await makeTmpCurvesDir();
  const dirB = await makeTmpCurvesDir();
  try {
    const entries = buildMixedClassEntries("DE-DE");
    const a = await proposeCalibrationRefit({
      locale: "DE-DE",
      riskClass: "high",
      goldEntries: entries,
      curvesDir: dirA,
      proposedAt: "2026-05-11T00:00:00.000Z",
    });
    const b = await proposeCalibrationRefit({
      locale: "DE-DE",
      riskClass: "high",
      goldEntries: entries,
      curvesDir: dirB,
      proposedAt: "2026-05-11T00:00:00.000Z",
    });
    assert.equal(a.proposalId, b.proposalId);
    assert.equal(a.proposedCurveDigest, b.proposedCurveDigest);
    assert.equal(a.heldOutEce, b.heldOutEce);
    assert.equal(a.heldOutKappa, b.heldOutKappa);
  } finally {
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// proposeCalibrationRefit — operator validation
// ---------------------------------------------------------------------------

test("proposeCalibrationRefit: rejects a riskClass outside the regulated subset", async () => {
  const dir = await makeTmpCurvesDir();
  try {
    await assert.rejects(
      proposeCalibrationRefit({
        locale: "DE-DE",
        // @ts-expect-error — exercising runtime validation path
        riskClass: "low",
        goldEntries: buildMixedClassEntries("DE-DE"),
        curvesDir: dir,
        proposedAt: "2026-05-11T00:00:00.000Z",
      }),
      CalibrationRefitOperatorError,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("proposeCalibrationRefit: rejects malformed proposedAt", async () => {
  const dir = await makeTmpCurvesDir();
  try {
    await assert.rejects(
      proposeCalibrationRefit({
        locale: "DE-DE",
        riskClass: "regulated_data",
        goldEntries: buildMixedClassEntries("DE-DE"),
        curvesDir: dir,
        proposedAt: "not-a-timestamp",
      }),
      CalibrationRefitOperatorError,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("proposeCalibrationRefit: rejects under-powered cells below the minimum sample floor", async () => {
  const dir = await makeTmpCurvesDir();
  try {
    await assert.rejects(
      proposeCalibrationRefit({
        locale: "DE-DE",
        riskClass: "regulated_data",
        goldEntries: makeSeparableEntries({
          locale: "DE-DE",
          riskClass: "regulated_data",
          count: SELF_IMPROVING_CALIBRATION_MIN_SAMPLES - 1,
        }),
        curvesDir: dir,
        proposedAt: "2026-05-11T00:00:00.000Z",
      }),
      CalibrationRefitOperatorError,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("proposeCalibrationRefit: held-out fraction validation rejects 0 and 1", async () => {
  const dir = await makeTmpCurvesDir();
  try {
    for (const heldOutFraction of [0, 1, -0.1, 1.5]) {
      await assert.rejects(
        proposeCalibrationRefit({
          locale: "DE-DE",
          riskClass: "regulated_data",
          goldEntries: buildMixedClassEntries("DE-DE"),
          curvesDir: dir,
          proposedAt: "2026-05-11T00:00:00.000Z",
          heldOutFraction,
        }),
        CalibrationRefitOperatorError,
        `heldOutFraction=${heldOutFraction} should be rejected`,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ratifyOrRollback — rollback path
// ---------------------------------------------------------------------------

test("ratifyOrRollback: rolls back when held-out κ floor fails (no signing key required)", async () => {
  const dir = await makeTmpCurvesDir();
  try {
    // Noisy corpus drops κ below the absolute floor so gates fail.
    const proposal = await proposeCalibrationRefit({
      locale: "DE-DE",
      riskClass: "regulated_data",
      goldEntries: makeUncorrelatedEntries({
        locale: "DE-DE",
        riskClass: "regulated_data",
        count: 60,
      }),
      curvesDir: dir,
      proposedAt: "2026-05-11T00:00:00.000Z",
    });
    assert.equal(proposal.gateEvaluation.failedGates.length > 0, true);
    const finalised = await ratifyOrRollback(proposal, {
      curvesDir: dir,
      decidedAt: "2026-05-11T01:00:00.000Z",
    });
    assert.equal(finalised.rolledBack, true);
    assert.equal(typeof finalised.rollbackReason, "string");
    // Production curve must NOT exist.
    await assert.rejects(
      readFile(
        resolveProductionCurvePath({
          curvesDir: dir,
          locale: "DE-DE",
          riskClass: "regulated_data",
        }),
        "utf8",
      ),
    );
    // Rejection sidecar exists.
    const sidecar = await readFile(
      join(
        dir,
        SELF_IMPROVING_CALIBRATION_PROPOSALS_DIRNAME,
        `${proposal.proposalId}${SELF_IMPROVING_CALIBRATION_REJECTION_SUFFIX}`,
      ),
      "utf8",
    );
    const sidecarJson = JSON.parse(sidecar) as { reason: string };
    assert.equal(typeof sidecarJson.reason, "string");
    assert.equal(sidecarJson.reason.length > 0, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ratifyOrRollback: forceRollback path skips signing and writes a sidecar with operator reason", async () => {
  const dir = await makeTmpCurvesDir();
  try {
    const proposal = await proposeCalibrationRefit({
      locale: "DE-DE",
      riskClass: "high",
      goldEntries: buildMixedClassEntries("DE-DE"),
      curvesDir: dir,
      proposedAt: "2026-05-11T00:00:00.000Z",
    });
    const finalised = await ratifyOrRollback(proposal, {
      curvesDir: dir,
      decidedAt: "2026-05-11T01:00:00.000Z",
      forceRollback: true,
      rollbackReason: "operator override per CHG-9876",
    });
    assert.equal(finalised.rolledBack, true);
    assert.equal(finalised.rollbackReason, "operator override per CHG-9876");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ratifyOrRollback — ratify path with operator approval (Ed25519)
// ---------------------------------------------------------------------------

test("ratifyOrRollback: refuses to ratify without a signing key", async () => {
  const dir = await makeTmpCurvesDir();
  try {
    const proposal = await proposeCalibrationRefit({
      locale: "DE-DE",
      riskClass: "regulated_data",
      goldEntries: buildMixedClassEntries("DE-DE"),
      curvesDir: dir,
      proposedAt: "2026-05-11T00:00:00.000Z",
    });
    // Sanity: the corpus is separable so all gates must pass.
    assert.deepEqual(proposal.gateEvaluation.failedGates, []);
    await assert.rejects(
      ratifyOrRollback(proposal, {
        curvesDir: dir,
        decidedAt: "2026-05-11T01:00:00.000Z",
      }),
      (error: unknown) =>
        error instanceof CalibrationRefitOperatorError &&
        error.message.includes("Operator approval required"),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ratifyOrRollback: ratifies a passing proposal, signs it, promotes to production", async () => {
  const dir = await makeTmpCurvesDir();
  try {
    const proposal = await proposeCalibrationRefit({
      locale: "DE-DE",
      riskClass: "regulated_data",
      goldEntries: buildMixedClassEntries("DE-DE"),
      curvesDir: dir,
      proposedAt: "2026-05-11T00:00:00.000Z",
    });
    const ratified = await ratifyOrRollback(proposal, {
      curvesDir: dir,
      decidedAt: "2026-05-11T01:00:00.000Z",
      signKeyPath: OPERATOR_KEY_PATH,
    });
    assert.equal(ratified.rolledBack, false);
    assert.equal(ratified.ratifiedAt, "2026-05-11T01:00:00.000Z");
    assert.notEqual(ratified.signature, undefined);
    assert.equal(ratified.signature?.algorithm, "ed25519");
    assert.equal(ratified.signature?.signatureBase64.length > 0, true);
    // Signature verifies independently.
    assert.equal(verifyCalibrationOperatorSignature(ratified), true);
    // Production curve exists and matches the proposed curve.
    const production = JSON.parse(
      await readFile(
        resolveProductionCurvePath({
          curvesDir: dir,
          locale: "DE-DE",
          riskClass: "regulated_data",
        }),
        "utf8",
      ),
    );
    assert.equal(production.digest, ratified.proposedCurveDigest);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ratifyOrRollback: enforces operator key allowlist", async () => {
  const dir = await makeTmpCurvesDir();
  try {
    const proposal = await proposeCalibrationRefit({
      locale: "DE-DE",
      riskClass: "regulated_data",
      goldEntries: buildMixedClassEntries("DE-DE"),
      curvesDir: dir,
      proposedAt: "2026-05-11T00:00:00.000Z",
    });
    await assert.rejects(
      ratifyOrRollback(proposal, {
        curvesDir: dir,
        decidedAt: "2026-05-11T01:00:00.000Z",
        signKeyPath: OPERATOR_KEY_PATH,
        allowedKeyFingerprints: ["0".repeat(64)],
      }),
      (error: unknown) =>
        error instanceof CalibrationRefitOperatorError &&
        error.message.includes("not on the allowlist"),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("verifyCalibrationOperatorSignature: returns false when proposal body has been tampered", async () => {
  const dir = await makeTmpCurvesDir();
  try {
    const proposal = await proposeCalibrationRefit({
      locale: "DE-DE",
      riskClass: "regulated_data",
      goldEntries: buildMixedClassEntries("DE-DE"),
      curvesDir: dir,
      proposedAt: "2026-05-11T00:00:00.000Z",
    });
    const ratified = await ratifyOrRollback(proposal, {
      curvesDir: dir,
      decidedAt: "2026-05-11T01:00:00.000Z",
      signKeyPath: OPERATOR_KEY_PATH,
    });
    const tampered: CalibrationRefitProposal = {
      ...ratified,
      heldOutEce: ratified.heldOutEce + 0.0001,
    };
    assert.equal(verifyCalibrationOperatorSignature(tampered), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// G11 CI guard
// ---------------------------------------------------------------------------

test("assertCalibrationRefitSafety: passes on an empty calibration-curves dir", async () => {
  const dir = await makeTmpCurvesDir();
  try {
    await assertCalibrationRefitSafety({ curvesDir: dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("assertCalibrationRefitSafety: passes after a legitimate ratification", async () => {
  const dir = await makeTmpCurvesDir();
  try {
    const proposal = await proposeCalibrationRefit({
      locale: "DE-DE",
      riskClass: "regulated_data",
      goldEntries: buildMixedClassEntries("DE-DE"),
      curvesDir: dir,
      proposedAt: "2026-05-11T00:00:00.000Z",
    });
    await ratifyOrRollback(proposal, {
      curvesDir: dir,
      decidedAt: "2026-05-11T01:00:00.000Z",
      signKeyPath: OPERATOR_KEY_PATH,
    });
    await assertCalibrationRefitSafety({ curvesDir: dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("assertCalibrationRefitSafety: rejects a hand-edited production curve with no backing proposal", async () => {
  const dir = await makeTmpCurvesDir();
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(
      resolveProductionCurvePath({
        curvesDir: dir,
        locale: "DE-DE",
        riskClass: "regulated_data",
      }),
      JSON.stringify({
        schemaVersion: SELF_IMPROVING_CALIBRATION_SCHEMA_VERSION,
        locale: "DE-DE",
        riskClass: "regulated_data",
        intercept: -1,
        slope: 4,
        trainSampleCount: 0,
        heldOutSampleCount: 0,
        heldOutEce: 0,
        heldOutKappa: 1,
        perClassHeldOutEce: { high: 0, regulated_data: 0, financial_transaction: 0 },
        fittedAt: "2026-05-11T00:00:00.000Z",
        digest: "deadbeef".repeat(8),
      }),
      "utf8",
    );
    await assert.rejects(
      assertCalibrationRefitSafety({ curvesDir: dir }),
      (error: unknown) => {
        if (!(error instanceof CalibrationRefitSafetyHardGateError)) return false;
        assert.equal(error.code, G11_CALIBRATION_REFIT_SAFETY);
        assert.equal(error.violations.length, 1);
        // Hand-edited curves are caught by either the digest-recompute check
        // (when the stored digest is preserved) or the missing-proposal check
        // (when the digest itself was rotated). Either path is acceptable
        // here — both surface G11 violations with a curve identifier.
        assert.match(
          error.violations[0]!,
          /no ratified proposal|digest mismatch/,
        );
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("assertCalibrationRefitSafety: rejects production curve when its digest disagrees with the ratified proposal", async () => {
  const dir = await makeTmpCurvesDir();
  try {
    const proposal = await proposeCalibrationRefit({
      locale: "DE-DE",
      riskClass: "regulated_data",
      goldEntries: buildMixedClassEntries("DE-DE"),
      curvesDir: dir,
      proposedAt: "2026-05-11T00:00:00.000Z",
    });
    await ratifyOrRollback(proposal, {
      curvesDir: dir,
      decidedAt: "2026-05-11T01:00:00.000Z",
      signKeyPath: OPERATOR_KEY_PATH,
    });
    // Hand-edit the production curve to introduce a digest mismatch.
    const productionPath = resolveProductionCurvePath({
      curvesDir: dir,
      locale: "DE-DE",
      riskClass: "regulated_data",
    });
    const original = JSON.parse(await readFile(productionPath, "utf8")) as Record<string, unknown>;
    await writeFile(
      productionPath,
      JSON.stringify({ ...original, intercept: 99 }),
      "utf8",
    );
    await assert.rejects(
      assertCalibrationRefitSafety({ curvesDir: dir }),
      CalibrationRefitSafetyHardGateError,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// loadCalibrationRefitHistory + summarizeCalibrationRefitHistory
// ---------------------------------------------------------------------------

test("loadCalibrationRefitHistory: enumerates production curves, proposals, and rejections", async () => {
  const dir = await makeTmpCurvesDir();
  try {
    const okProposal = await proposeCalibrationRefit({
      locale: "DE-DE",
      riskClass: "regulated_data",
      goldEntries: buildMixedClassEntries("DE-DE"),
      curvesDir: dir,
      proposedAt: "2026-05-11T00:00:00.000Z",
    });
    await ratifyOrRollback(okProposal, {
      curvesDir: dir,
      decidedAt: "2026-05-11T01:00:00.000Z",
      signKeyPath: OPERATOR_KEY_PATH,
    });
    const failProposal = await proposeCalibrationRefit({
      locale: "FR-FR",
      riskClass: "high",
      goldEntries: makeUncorrelatedEntries({
        locale: "FR-FR",
        riskClass: "high",
        count: 60,
      }),
      curvesDir: dir,
      proposedAt: "2026-05-11T02:00:00.000Z",
    });
    await ratifyOrRollback(failProposal, {
      curvesDir: dir,
      decidedAt: "2026-05-11T03:00:00.000Z",
    });
    const history = await loadCalibrationRefitHistory(dir);
    assert.equal(history.productionCurves.length, 1);
    assert.equal(history.proposals.length, 2);
    assert.equal(history.rejections.length, 1);
    const summary = summarizeCalibrationRefitHistory(history);
    assert.equal(summary.productionCurveCount, 1);
    assert.equal(summary.proposalCount, 2);
    assert.equal(summary.ratifiedCount, 1);
    assert.equal(summary.rolledBackCount, 1);
    // Sorting is deterministic by locale, then risk class, then proposedAt.
    assert.equal(summary.rows[0]!.locale, "DE-DE");
    assert.equal(summary.rows[1]!.locale, "FR-FR");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Default held-out fraction surfaces in proposals
// ---------------------------------------------------------------------------

test("self-improving-calibration: default held-out fraction is the published 20%", () => {
  assert.equal(SELF_IMPROVING_CALIBRATION_HELD_OUT_FRACTION, 0.2);
});
