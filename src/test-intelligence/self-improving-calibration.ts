/**
 * Self-improving judge-calibration loop with hard rollback safety
 * (Issue #2182).
 *
 * Quarterly or drift-triggered Platt-sigmoid refits per `(locale,
 * regulated risk class)` cell. Each refit produces a deterministic
 * proposal. Promotion to production is gated on quantitative
 * regression checks (held-out ECE / Cohen's κ versus the current
 * production curve) AND an Ed25519 operator signature reusing the
 * audit-dossier signing key. Rejected refits stay on disk as audit
 * evidence.
 *
 * Design invariants:
 *
 * - **Deterministic**: identical inputs produce byte-identical
 *   proposal artifacts. Proposal IDs are derived from a SHA-256 of
 *   the canonical-JSON proposal body so a replayed refit lands on the
 *   same filename.
 * - **Read-only inputs**: the module never mutates `goldEntries`. All
 *   I/O is confined to `proposeCalibrationRefit` (writes the proposal
 *   JSON), `ratifyOrRollback` (writes the production curve OR a
 *   rejection sidecar), and `loadCalibrationRefitHistory` (read).
 * - **Hard rollback safety**: ratification requires the held-out gold
 *   set to satisfy three regression gates simultaneously
 *   (`heldOutEce <= currentEce + 0.005`,
 *   `heldOutKappa >= currentKappa - 0.02`, no per-class ECE regression
 *   greater than 0.02) AND a held-out absolute-floor check
 *   (`heldOutEce <= 0.02`, `heldOutKappa >= 0.7`). Any breach forces a
 *   rollback record; the existing production curve is left untouched.
 * - **Operator approval**: `ratifyOrRollback({ outcome: "ratify" })`
 *   refuses to promote without an `Ed25519` signature whose key
 *   fingerprint matches an entry in the configured operator-key
 *   allowlist. There is **no autopilot ratification**.
 */

import {
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { SupportedLocale } from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import {
  buildReliabilityDiagram,
  type CalibrationSample,
} from "./calibration-metrics.js";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Schema version stamped into every proposal, ratified curve, and rejection sidecar. */
export const SELF_IMPROVING_CALIBRATION_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Filename basename of the production curve for a `(locale, riskClass)`
 * cell. The runtime curve filename pattern is `<locale>__<riskClass>.json`
 * so the cell key is recoverable from the file name alone.
 */
export const SELF_IMPROVING_CALIBRATION_CURVES_DIRNAME =
  "calibration-curves" as const;

/** Sub-directory holding proposal records, both ratified and rolled back. */
export const SELF_IMPROVING_CALIBRATION_PROPOSALS_DIRNAME = "proposals" as const;

/** Suffix appended to a rolled-back proposal's sidecar file. */
export const SELF_IMPROVING_CALIBRATION_REJECTION_SUFFIX =
  "-rejected.json" as const;

/**
 * Hard-gate code emitted to fail CI when production-path curves are
 * mutated without a corresponding ratified, signed proposal in the
 * `proposals/` audit-trail (Issue #2182).
 */
export const G11_CALIBRATION_REFIT_SAFETY =
  "G11_CALIBRATION_REFIT_SAFETY" as const;

/**
 * Three regulated risk classes that participate in per-class refits.
 * Subset of `TestCaseRiskCategory` confined to the regulated cells the
 * calibration loop actually retunes. Lower-stakes classes (`low`,
 * `medium`) do not justify a per-class curve under the published
 * Wave-7 calibration scope.
 */
export const REGULATED_RISK_CLASSES = [
  "high",
  "regulated_data",
  "financial_transaction",
] as const;

/** Discriminated alias for {@link REGULATED_RISK_CLASSES}. */
export type RegulatedRiskClass = (typeof REGULATED_RISK_CLASSES)[number];

/**
 * Hard absolute regression gates applied to the held-out gold-set
 * evaluation. Independent of the relative regression gate: a refit
 * that beats the current curve by every relative metric still rolls
 * back if it lands above the absolute ECE floor or below the absolute
 * κ floor.
 */
export interface SelfImprovingCalibrationHardGates {
  readonly heldOutEceCeiling: number;
  readonly heldOutKappaFloor: number;
  readonly eceRegressionTolerance: number;
  readonly kappaRegressionTolerance: number;
  readonly perClassEceRegressionCeiling: number;
}

export const SELF_IMPROVING_CALIBRATION_HARD_GATES: SelfImprovingCalibrationHardGates =
  Object.freeze({
    /** Absolute ECE ceiling on the held-out gold set. */
    heldOutEceCeiling: 0.02,
    /** Absolute Cohen's κ floor on the held-out gold set. */
    heldOutKappaFloor: 0.7,
    /** Relative ECE delta vs. the current production curve. */
    eceRegressionTolerance: 0.005,
    /** Relative κ delta vs. the current production curve. */
    kappaRegressionTolerance: 0.02,
    /** Per-class ECE regression cap. */
    perClassEceRegressionCeiling: 0.02,
  });

/**
 * Default held-out fraction (20%) per the issue's acceptance criteria.
 * Pure constant — callers may override for tests but the production
 * driver pins this value.
 */
export const SELF_IMPROVING_CALIBRATION_HELD_OUT_FRACTION = 0.2 as const;

/**
 * Minimum total sample count required before a refit may be proposed.
 * Below this floor the refit driver returns `undefined` instead of
 * fitting an under-powered curve.
 */
export const SELF_IMPROVING_CALIBRATION_MIN_SAMPLES = 20 as const;

/**
 * Score floor (out of 100) above which an accepted-run case becomes a
 * silver-label sample for the refit corpus. Mirrors the issue's
 * acceptance criteria threshold.
 */
export const SELF_IMPROVING_CALIBRATION_ACCEPTED_RUN_SCORE_FLOOR = 90 as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Origin tag for a single refit-corpus sample. */
export type CalibrationGoldEntrySource = "human_review" | "accepted_run";

/**
 * One labelled sample contributed to a refit corpus.
 *
 * `humanVerdict` is the binary ground-truth label: `1` for accepted /
 * positive review, `0` for needs-review / negative. `rawScore` is the
 * uncalibrated judge confidence in `[0, 1]`.
 */
export interface CalibrationGoldEntry {
  readonly entryId: string;
  readonly locale: SupportedLocale;
  readonly riskClass: RegulatedRiskClass;
  readonly rawScore: number;
  readonly humanVerdict: 0 | 1;
  readonly source: CalibrationGoldEntrySource;
  readonly recordedAt: string;
}

/**
 * Platt-curve fit recorded inside a proposal or a ratified production
 * curve. The digest field is the sha256 of the canonical-json body
 * with `digest` set to the empty string — i.e. the digest is
 * self-referential and does not contaminate itself.
 */
export interface CalibrationCurveSnapshot {
  readonly schemaVersion: typeof SELF_IMPROVING_CALIBRATION_SCHEMA_VERSION;
  readonly locale: SupportedLocale;
  readonly riskClass: RegulatedRiskClass;
  readonly intercept: number;
  readonly slope: number;
  readonly trainSampleCount: number;
  readonly heldOutSampleCount: number;
  readonly heldOutEce: number;
  readonly heldOutKappa: number;
  readonly perClassHeldOutEce: Readonly<Record<RegulatedRiskClass, number>>;
  readonly fittedAt: string;
  readonly digest: string;
}

/**
 * Outcome of a `ratifyOrRollback` invocation. `ratified` writes a
 * production curve and stamps the proposal record. `rolled_back`
 * leaves production untouched and writes a rejection sidecar
 * carrying the rollback reason.
 */
export type CalibrationRefitOutcome = "ratified" | "rolled_back";

/**
 * One refit attempt — written to `proposals/<proposalId>.json` and
 * left on disk indefinitely as audit evidence. The same shape covers
 * a freshly-proposed refit (`ratifiedAt` undefined, `rolledBack`
 * false), a ratified refit (`ratifiedAt` set, `rolledBack` false), and
 * a rejected refit (`rolledBack` true, `rollbackReason` set).
 */
export interface CalibrationRefitProposal {
  readonly schemaVersion: typeof SELF_IMPROVING_CALIBRATION_SCHEMA_VERSION;
  readonly proposalId: string;
  readonly locale: SupportedLocale;
  readonly riskClass: RegulatedRiskClass;
  readonly previousCurveDigest: string;
  readonly proposedCurveDigest: string;
  readonly heldOutEce: number;
  readonly heldOutKappa: number;
  readonly perClassHeldOutEce: Readonly<Record<RegulatedRiskClass, number>>;
  readonly proposedAt: string;
  readonly ratifiedAt?: string;
  readonly rolledBack: boolean;
  readonly rollbackReason?: string;
  readonly trainSampleCount: number;
  readonly heldOutSampleCount: number;
  readonly proposedCurve: CalibrationCurveSnapshot;
  /**
   * Per-gate evaluation snapshot taken at proposal time so the
   * audit-dossier can render the exact reason a refit was held back.
   */
  readonly gateEvaluation: CalibrationRefitGateEvaluation;
  /**
   * Detached operator approval signature, present only on ratified
   * proposals. Format mirrors the audit-dossier signing envelope
   * (`ed25519` over the canonical-JSON proposal body with
   * `signatureBase64` set to the empty string and `ratifiedAt` set
   * to the operator-supplied timestamp). Reuses the same operator key
   * material as the audit-dossier signing flow.
   */
  readonly signature?: CalibrationOperatorSignature;
}

/**
 * Detached signature record stored inside a ratified
 * `CalibrationRefitProposal`. The signed payload is the canonical
 * JSON of the proposal with `signature` set to `undefined` and
 * `ratifiedAt` carrying the operator-supplied timestamp.
 */
export interface CalibrationOperatorSignature {
  readonly algorithm: "ed25519";
  readonly keyFingerprintSha256: string;
  readonly publicKeyPem: string;
  readonly signatureBase64: string;
}

/**
 * One row per gate evaluated when a proposal was created. The gate
 * with `passed === false` and the largest `delta` is the most
 * informative root cause when the proposal is rolled back.
 */
export interface CalibrationRefitGateEvaluation {
  readonly heldOutEcePassed: boolean;
  readonly heldOutKappaPassed: boolean;
  readonly relativeEceRegressionPassed: boolean;
  readonly relativeKappaRegressionPassed: boolean;
  readonly perClassEceRegressionPassed: boolean;
  readonly currentHeldOutEce: number;
  readonly currentHeldOutKappa: number;
  readonly currentPerClassHeldOutEce: Readonly<
    Record<RegulatedRiskClass, number>
  >;
  /** Individual hard-gate failure descriptors for renderer + CLI. */
  readonly failedGates: readonly string[];
}

/**
 * Result envelope returned by {@link loadCalibrationRefitHistory} —
 * the audit-dossier renderer + the G11 CI guard both consume this.
 */
export interface CalibrationRefitHistory {
  readonly schemaVersion: typeof SELF_IMPROVING_CALIBRATION_SCHEMA_VERSION;
  readonly productionCurves: ReadonlyArray<CalibrationCurveSnapshot>;
  readonly proposals: ReadonlyArray<CalibrationRefitProposal>;
  readonly rejections: ReadonlyArray<CalibrationRejectionSidecar>;
}

/**
 * Sidecar written next to a rolled-back proposal so reviewers + CI
 * can read the rollback reason without re-evaluating gates.
 */
export interface CalibrationRejectionSidecar {
  readonly schemaVersion: typeof SELF_IMPROVING_CALIBRATION_SCHEMA_VERSION;
  readonly proposalId: string;
  readonly locale: SupportedLocale;
  readonly riskClass: RegulatedRiskClass;
  readonly rolledBackAt: string;
  readonly reason: string;
  readonly failedGates: readonly string[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Operator-supplied input violated a domain constraint. */
export class CalibrationRefitOperatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalibrationRefitOperatorError";
  }
}

/**
 * G11 CI guard violation: a production curve exists without a backing
 * ratified proposal, or the proposal's digest disagrees with the
 * curve's digest. Always carries the offending file path so CI logs
 * point reviewers to the right place.
 */
export class CalibrationRefitSafetyHardGateError extends Error {
  readonly code: typeof G11_CALIBRATION_REFIT_SAFETY = G11_CALIBRATION_REFIT_SAFETY;
  readonly violations: readonly string[];
  constructor(violations: readonly string[]) {
    super(
      `${G11_CALIBRATION_REFIT_SAFETY} failed: ${violations.length} unbacked production calibration curve change(s):\n  - ${violations.join("\n  - ")}`,
    );
    this.violations = violations;
  }
}

// ---------------------------------------------------------------------------
// Pure numeric helpers
// ---------------------------------------------------------------------------

const round6 = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value));

const applyCurve = (
  rawScore: number,
  curve: { readonly intercept: number; readonly slope: number },
): number =>
  clamp01(round6(sigmoid(curve.intercept + curve.slope * rawScore)));

/**
 * Cohen's κ for binary 0/1 labels. Edge cases mirror the established
 * three-class implementation in `inter-rater-agreement.ts`: an empty
 * input returns κ = 1 with the `degenerate` flag, marginals fully
 * aligned return κ = 0 unless observed agreement is also 1.
 */
const computeBinaryCohensKappa = (
  pairs: ReadonlyArray<{ readonly raterA: 0 | 1; readonly raterB: 0 | 1 }>,
): number => {
  const N = pairs.length;
  if (N === 0) return 1;
  let agree = 0;
  let rowOne = 0;
  let colOne = 0;
  for (const { raterA, raterB } of pairs) {
    if (raterA === raterB) agree += 1;
    rowOne += raterA;
    colOne += raterB;
  }
  const observed = agree / N;
  const expected =
    (rowOne * colOne + (N - rowOne) * (N - colOne)) / (N * N);
  if (expected >= 1 - 1e-12) {
    return observed >= 1 - 1e-12 ? 1 : 0;
  }
  return round6((observed - expected) / (1 - expected));
};

const sortGoldEntries = (
  entries: readonly CalibrationGoldEntry[],
): readonly CalibrationGoldEntry[] =>
  [...entries].sort((left, right) => left.entryId.localeCompare(right.entryId));

/**
 * Deterministic 80/20 split. Sort entries by `entryId` so the same
 * corpus always produces the same train + held-out partition.
 */
const splitTrainHeldOut = (
  entries: readonly CalibrationGoldEntry[],
  heldOutFraction: number,
): {
  readonly train: readonly CalibrationGoldEntry[];
  readonly heldOut: readonly CalibrationGoldEntry[];
} => {
  const sorted = sortGoldEntries(entries);
  if (sorted.length === 0) {
    return { train: [], heldOut: [] };
  }
  const stride = Math.max(2, Math.round(1 / heldOutFraction));
  const heldOut = sorted.filter((_entry, index) => index % stride === 0);
  const train = sorted.filter((_entry, index) => index % stride !== 0);
  return { train, heldOut };
};

/**
 * Gradient-descent Platt scaling on a binary corpus. Uses a longer
 * iteration schedule and a higher learning rate than
 * `case-confidence-calibrator.ts` because the refit driver runs
 * offline (quarterly or drift-triggered) and the absolute ECE gate
 * (≤ 0.02 on the held-out gold set) demands tighter convergence than
 * the per-run aggregate fit.
 */
const fitPlatt = (
  entries: readonly CalibrationGoldEntry[],
): { intercept: number; slope: number } => {
  if (entries.length === 0) {
    return { intercept: 0, slope: 1 };
  }
  let intercept = -2;
  let slope = 4;
  const learningRate = 0.5;
  for (let iteration = 0; iteration < 2000; iteration += 1) {
    let interceptGradient = 0;
    let slopeGradient = 0;
    for (const entry of entries) {
      const probability = sigmoid(intercept + slope * entry.rawScore);
      const delta = probability - entry.humanVerdict;
      interceptGradient += delta;
      slopeGradient += delta * entry.rawScore;
    }
    intercept -= (learningRate * interceptGradient) / entries.length;
    slope -= (learningRate * slopeGradient) / entries.length;
  }
  return { intercept: round6(intercept), slope: round6(slope) };
};

const computeEce = (samples: ReadonlyArray<CalibrationSample>): number =>
  buildReliabilityDiagram(samples).debiasedEce;

const evaluateCurve = (
  curve: { readonly intercept: number; readonly slope: number },
  heldOut: readonly CalibrationGoldEntry[],
): {
  readonly heldOutEce: number;
  readonly heldOutKappa: number;
  readonly perClassHeldOutEce: Readonly<Record<RegulatedRiskClass, number>>;
} => {
  const calibrated: CalibrationSample[] = heldOut.map((entry) => ({
    confidence: applyCurve(entry.rawScore, curve),
    label: entry.humanVerdict,
  }));
  const heldOutEce = computeEce(calibrated);
  const heldOutKappa = computeBinaryCohensKappa(
    heldOut.map((entry) => ({
      raterA: entry.humanVerdict,
      raterB:
        applyCurve(entry.rawScore, curve) >= 0.5
          ? (1 as const)
          : (0 as const),
    })),
  );
  const perClassHeldOutEce = Object.fromEntries(
    REGULATED_RISK_CLASSES.map((riskClass) => {
      const slice = heldOut
        .filter((entry) => entry.riskClass === riskClass)
        .map((entry) => ({
          confidence: applyCurve(entry.rawScore, curve),
          label: entry.humanVerdict,
        }));
      return [riskClass, computeEce(slice)] as const;
    }),
  ) as Record<RegulatedRiskClass, number>;
  return { heldOutEce, heldOutKappa, perClassHeldOutEce };
};

const computeCurveDigest = (
  body: Omit<CalibrationCurveSnapshot, "digest">,
): string =>
  sha256Hex({
    ...body,
    digest: "",
  });

const buildCurveSnapshot = (input: {
  readonly locale: SupportedLocale;
  readonly riskClass: RegulatedRiskClass;
  readonly intercept: number;
  readonly slope: number;
  readonly trainSampleCount: number;
  readonly heldOutSampleCount: number;
  readonly heldOutEce: number;
  readonly heldOutKappa: number;
  readonly perClassHeldOutEce: Readonly<Record<RegulatedRiskClass, number>>;
  readonly fittedAt: string;
}): CalibrationCurveSnapshot => {
  const body: Omit<CalibrationCurveSnapshot, "digest"> = {
    schemaVersion: SELF_IMPROVING_CALIBRATION_SCHEMA_VERSION,
    locale: input.locale,
    riskClass: input.riskClass,
    intercept: input.intercept,
    slope: input.slope,
    trainSampleCount: input.trainSampleCount,
    heldOutSampleCount: input.heldOutSampleCount,
    heldOutEce: input.heldOutEce,
    heldOutKappa: input.heldOutKappa,
    perClassHeldOutEce: input.perClassHeldOutEce,
    fittedAt: input.fittedAt,
  };
  return { ...body, digest: computeCurveDigest(body) };
};

// ---------------------------------------------------------------------------
// Atomic write helpers
// ---------------------------------------------------------------------------

const writeAtomicJson = async (
  outputPath: string,
  body: unknown,
): Promise<void> => {
  await mkdir(dirname(outputPath), { recursive: true });
  const tmpPath = `${outputPath}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, `${canonicalJson(body)}\n`, "utf8");
  await rename(tmpPath, outputPath);
};

const tryReadJson = async <T>(filePath: string): Promise<T | undefined> => {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Path helpers (public so the CLI + CI guard agree on layout)
// ---------------------------------------------------------------------------

/**
 * Resolve the on-disk path for a production curve. The `__` separator
 * keeps the cell key reversible from the file name even when locale
 * codes contain a single hyphen (e.g. `DE-DE`).
 */
export const resolveProductionCurvePath = (input: {
  readonly curvesDir: string;
  readonly locale: SupportedLocale;
  readonly riskClass: RegulatedRiskClass;
}): string =>
  join(
    resolve(input.curvesDir),
    `${input.locale}__${input.riskClass}.json`,
  );

/**
 * Recover `(locale, riskClass)` from a curve file basename. Returns
 * `undefined` for non-conforming names so the G11 guard can flag
 * stray files.
 */
export const parseCurveFilename = (
  filename: string,
): { locale: SupportedLocale; riskClass: RegulatedRiskClass } | undefined => {
  if (!filename.endsWith(".json")) return undefined;
  const stem = filename.slice(0, -".json".length);
  const separatorIndex = stem.indexOf("__");
  if (separatorIndex < 0) return undefined;
  const locale = stem.slice(0, separatorIndex) as SupportedLocale;
  const riskClass = stem.slice(separatorIndex + 2) as RegulatedRiskClass;
  if (!REGULATED_RISK_CLASSES.includes(riskClass)) return undefined;
  return { locale, riskClass };
};

const resolveProposalPath = (input: {
  readonly curvesDir: string;
  readonly proposalId: string;
}): string =>
  join(
    resolve(input.curvesDir),
    SELF_IMPROVING_CALIBRATION_PROPOSALS_DIRNAME,
    `${input.proposalId}.json`,
  );

const resolveRejectionSidecarPath = (input: {
  readonly curvesDir: string;
  readonly proposalId: string;
}): string =>
  join(
    resolve(input.curvesDir),
    SELF_IMPROVING_CALIBRATION_PROPOSALS_DIRNAME,
    `${input.proposalId}${SELF_IMPROVING_CALIBRATION_REJECTION_SUFFIX}`,
  );

// ---------------------------------------------------------------------------
// proposeCalibrationRefit
// ---------------------------------------------------------------------------

export interface ProposeCalibrationRefitInput {
  readonly locale: SupportedLocale;
  readonly riskClass: RegulatedRiskClass;
  readonly goldEntries: readonly CalibrationGoldEntry[];
  /**
   * Directory holding production curves. Proposals land in
   * `<curvesDir>/proposals/`. Required so the module never reaches
   * outside the operator-supplied root.
   */
  readonly curvesDir: string;
  /** ISO-8601 timestamp; pinned by the caller so the artifact is reproducible. */
  readonly proposedAt: string;
  /** Optional fraction override for tests. Defaults to 20%. */
  readonly heldOutFraction?: number;
  /** Optional explicit current production curve snapshot (audit / replay path). */
  readonly currentCurveOverride?: CalibrationCurveSnapshot;
}

const filterRelevantEntries = (
  entries: readonly CalibrationGoldEntry[],
  locale: SupportedLocale,
  riskClass: RegulatedRiskClass,
): readonly CalibrationGoldEntry[] =>
  entries.filter(
    (entry) => entry.locale === locale && entry.riskClass === riskClass,
  );

const evaluateGates = (
  proposed: {
    readonly heldOutEce: number;
    readonly heldOutKappa: number;
    readonly perClassHeldOutEce: Readonly<Record<RegulatedRiskClass, number>>;
  },
  current: CalibrationCurveSnapshot | undefined,
): CalibrationRefitGateEvaluation => {
  const gates = SELF_IMPROVING_CALIBRATION_HARD_GATES;
  const failed: string[] = [];

  const heldOutEcePassed = proposed.heldOutEce <= gates.heldOutEceCeiling;
  if (!heldOutEcePassed) {
    failed.push(
      `heldOutEce=${proposed.heldOutEce} exceeds absolute ceiling ${gates.heldOutEceCeiling}`,
    );
  }
  const heldOutKappaPassed = proposed.heldOutKappa >= gates.heldOutKappaFloor;
  if (!heldOutKappaPassed) {
    failed.push(
      `heldOutKappa=${proposed.heldOutKappa} below absolute floor ${gates.heldOutKappaFloor}`,
    );
  }

  const currentEce = current?.heldOutEce ?? proposed.heldOutEce;
  const currentKappa = current?.heldOutKappa ?? proposed.heldOutKappa;
  const currentPerClass =
    current?.perClassHeldOutEce ?? proposed.perClassHeldOutEce;

  const relativeEceRegressionPassed =
    proposed.heldOutEce <= currentEce + gates.eceRegressionTolerance;
  if (!relativeEceRegressionPassed) {
    failed.push(
      `heldOutEce=${proposed.heldOutEce} regressed beyond +${gates.eceRegressionTolerance} vs. current ${currentEce}`,
    );
  }
  const relativeKappaRegressionPassed =
    proposed.heldOutKappa >= currentKappa - gates.kappaRegressionTolerance;
  if (!relativeKappaRegressionPassed) {
    failed.push(
      `heldOutKappa=${proposed.heldOutKappa} regressed beyond -${gates.kappaRegressionTolerance} vs. current ${currentKappa}`,
    );
  }

  let perClassEceRegressionPassed = true;
  for (const riskClass of REGULATED_RISK_CLASSES) {
    const proposedClass = proposed.perClassHeldOutEce[riskClass];
    const currentClass = currentPerClass[riskClass];
    if (
      proposedClass - currentClass >
      gates.perClassEceRegressionCeiling
    ) {
      perClassEceRegressionPassed = false;
      failed.push(
        `perClassHeldOutEce[${riskClass}]=${proposedClass} regressed beyond +${gates.perClassEceRegressionCeiling} vs. current ${currentClass}`,
      );
    }
  }

  return {
    heldOutEcePassed,
    heldOutKappaPassed,
    relativeEceRegressionPassed,
    relativeKappaRegressionPassed,
    perClassEceRegressionPassed,
    currentHeldOutEce: currentEce,
    currentHeldOutKappa: currentKappa,
    currentPerClassHeldOutEce: currentPerClass,
    failedGates: failed,
  };
};

const computeProposalId = (input: {
  readonly locale: SupportedLocale;
  readonly riskClass: RegulatedRiskClass;
  readonly proposedAt: string;
  readonly proposedCurveDigest: string;
}): string => {
  const fingerprint = sha256Hex({
    locale: input.locale,
    riskClass: input.riskClass,
    proposedAt: input.proposedAt,
    proposedCurveDigest: input.proposedCurveDigest,
  });
  return `proposal-${input.locale}-${input.riskClass}-${fingerprint.slice(0, 16)}`;
};

const loadCurrentCurve = async (
  curvesDir: string,
  locale: SupportedLocale,
  riskClass: RegulatedRiskClass,
): Promise<CalibrationCurveSnapshot | undefined> =>
  tryReadJson<CalibrationCurveSnapshot>(
    resolveProductionCurvePath({ curvesDir, locale, riskClass }),
  );

/**
 * Fit a Platt-sigmoid refit, evaluate the held-out gates, and persist
 * the proposal. Always writes the proposal — even when gates fail —
 * so reviewers see every attempt. Promotion to production happens in
 * {@link ratifyOrRollback}.
 *
 * Returns the persisted `CalibrationRefitProposal` shape; callers
 * inspect `gateEvaluation.failedGates` to decide whether to attempt
 * ratification.
 */
export const proposeCalibrationRefit = async (
  input: ProposeCalibrationRefitInput,
): Promise<CalibrationRefitProposal> => {
  if (!REGULATED_RISK_CLASSES.includes(input.riskClass)) {
    throw new CalibrationRefitOperatorError(
      `riskClass must be one of ${REGULATED_RISK_CLASSES.join(", ")}; got "${input.riskClass}".`,
    );
  }
  if (!input.proposedAt || Number.isNaN(Date.parse(input.proposedAt))) {
    throw new CalibrationRefitOperatorError(
      "proposedAt must be a valid ISO-8601 timestamp.",
    );
  }
  const heldOutFraction =
    input.heldOutFraction ?? SELF_IMPROVING_CALIBRATION_HELD_OUT_FRACTION;
  if (!(heldOutFraction > 0 && heldOutFraction < 1)) {
    throw new CalibrationRefitOperatorError(
      "heldOutFraction must be in the open interval (0, 1).",
    );
  }
  const cellEntries = filterRelevantEntries(
    input.goldEntries,
    input.locale,
    input.riskClass,
  );
  if (cellEntries.length < SELF_IMPROVING_CALIBRATION_MIN_SAMPLES) {
    throw new CalibrationRefitOperatorError(
      `Not enough gold entries for ${input.locale}/${input.riskClass}: have ${cellEntries.length}, need at least ${SELF_IMPROVING_CALIBRATION_MIN_SAMPLES}.`,
    );
  }
  // Cell-specific entries fit + evaluate the curve. The per-class
  // regression check below uses entries from ALL risk classes so a
  // refit that boosts one class but craters another is caught.
  const { train, heldOut } = splitTrainHeldOut(cellEntries, heldOutFraction);
  if (train.length === 0 || heldOut.length === 0) {
    throw new CalibrationRefitOperatorError(
      "Train/held-out split produced an empty partition.",
    );
  }
  const trainPositives = train.filter((entry) => entry.humanVerdict === 1).length;
  const trainNegatives = train.length - trainPositives;
  if (trainPositives === 0 || trainNegatives === 0) {
    throw new CalibrationRefitOperatorError(
      "Train partition lacks both positive and negative samples; refit aborted.",
    );
  }

  const fit = fitPlatt(train);
  // Cell-specific held-out for `heldOutEce` + `heldOutKappa` — the
  // primary regression metrics. A parallel cross-class held-out is
  // used only for the per-class ECE breakdown so a refit that boosts
  // the cell's class but craters another is still caught.
  const cellEvaluation = evaluateCurve(fit, heldOut);
  const crossClassHeldOut = sortGoldEntries(input.goldEntries).filter(
    (_entry, index) =>
      index % Math.max(2, Math.round(1 / heldOutFraction)) === 0,
  );
  const crossClassEvaluation = evaluateCurve(fit, crossClassHeldOut);
  const evaluation = {
    heldOutEce: cellEvaluation.heldOutEce,
    heldOutKappa: cellEvaluation.heldOutKappa,
    perClassHeldOutEce: crossClassEvaluation.perClassHeldOutEce,
  };

  const current = input.currentCurveOverride ?? (await loadCurrentCurve(
    input.curvesDir,
    input.locale,
    input.riskClass,
  ));

  const proposedCurve = buildCurveSnapshot({
    locale: input.locale,
    riskClass: input.riskClass,
    intercept: fit.intercept,
    slope: fit.slope,
    trainSampleCount: train.length,
    heldOutSampleCount: heldOut.length,
    heldOutEce: evaluation.heldOutEce,
    heldOutKappa: evaluation.heldOutKappa,
    perClassHeldOutEce: evaluation.perClassHeldOutEce,
    fittedAt: input.proposedAt,
  });

  const gateEvaluation = evaluateGates(
    {
      heldOutEce: evaluation.heldOutEce,
      heldOutKappa: evaluation.heldOutKappa,
      perClassHeldOutEce: evaluation.perClassHeldOutEce,
    },
    current,
  );

  const proposalId = computeProposalId({
    locale: input.locale,
    riskClass: input.riskClass,
    proposedAt: input.proposedAt,
    proposedCurveDigest: proposedCurve.digest,
  });

  const proposal: CalibrationRefitProposal = {
    schemaVersion: SELF_IMPROVING_CALIBRATION_SCHEMA_VERSION,
    proposalId,
    locale: input.locale,
    riskClass: input.riskClass,
    previousCurveDigest: current?.digest ?? "",
    proposedCurveDigest: proposedCurve.digest,
    heldOutEce: evaluation.heldOutEce,
    heldOutKappa: evaluation.heldOutKappa,
    perClassHeldOutEce: evaluation.perClassHeldOutEce,
    proposedAt: input.proposedAt,
    rolledBack: false,
    trainSampleCount: train.length,
    heldOutSampleCount: heldOut.length,
    proposedCurve,
    gateEvaluation,
  };

  await writeAtomicJson(
    resolveProposalPath({ curvesDir: input.curvesDir, proposalId }),
    proposal,
  );
  return proposal;
};

// ---------------------------------------------------------------------------
// ratifyOrRollback
// ---------------------------------------------------------------------------

export interface RatifyOrRollbackInput {
  readonly curvesDir: string;
  /** ISO-8601 timestamp the operator stamps on the ratification record. */
  readonly decidedAt: string;
  /** Path to an Ed25519 PEM/JWK private key. Required when ratifying. */
  readonly signKeyPath?: string;
  /**
   * Operator-key allowlist by SPKI-DER SHA-256 fingerprint. When
   * present, ratification refuses keys outside the allowlist. Empty
   * array = no allowlist enforced (test-only path).
   */
  readonly allowedKeyFingerprints?: readonly string[];
  /**
   * Optional explicit rollback reason. When omitted, the function
   * falls back to "<n> hard-gate(s) failed: <list>".
   */
  readonly rollbackReason?: string;
  /**
   * Operator override forcing a rollback even when gates pass — used
   * by reviewers who spot a qualitative issue not covered by gates.
   */
  readonly forceRollback?: boolean;
}

interface ParsedSigningKey {
  readonly publicKeyPem: string;
  readonly keyFingerprintSha256: string;
  readonly sign: (payload: Uint8Array) => Uint8Array;
}

const parseEd25519PrivateKey = async (
  signKeyPath: string,
): Promise<ParsedSigningKey> => {
  let raw: string;
  try {
    raw = await readFile(signKeyPath, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      throw new CalibrationRefitOperatorError(
        `--sign-key file not found: ${signKeyPath}`,
      );
    }
    throw error;
  }
  const trimmed = raw.trim();
  let privateKey;
  try {
    privateKey = trimmed.startsWith("{")
      ? createPrivateKey({
          key: JSON.parse(trimmed) as Record<string, string>,
          format: "jwk",
        })
      : createPrivateKey({ key: raw, format: "pem" });
  } catch (error) {
    throw new CalibrationRefitOperatorError(
      `--sign-key is not a valid PEM/JWK ed25519 private key: ${(error as Error).message}`,
    );
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new CalibrationRefitOperatorError(
      `--sign-key must be an ed25519 private key; got ${privateKey.asymmetricKeyType ?? "unknown"}.`,
    );
  }
  const publicKey = createPublicKey(privateKey);
  const publicKeyPem = (
    publicKey.export({ format: "pem", type: "spki" }) as string
  ).trim();
  const spkiDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const keyFingerprintSha256 = sha256Hex(
    new Uint8Array(spkiDer.buffer, spkiDer.byteOffset, spkiDer.byteLength),
  );
  return {
    publicKeyPem,
    keyFingerprintSha256,
    sign: (payload) =>
      new Uint8Array(cryptoSign(null, Buffer.from(payload), privateKey)),
  };
};

/**
 * Verify a `CalibrationOperatorSignature` against the canonical-JSON
 * proposal body. Pure function — re-reads the public key from the PEM
 * embedded in the signature and re-runs Ed25519 verification.
 */
export const verifyCalibrationOperatorSignature = (
  proposal: CalibrationRefitProposal,
): boolean => {
  if (proposal.signature === undefined) return false;
  // Runtime guard via a widened type — defends against a tampered
  // proposal JSON that disagrees with the compile-time literal.
  if ((proposal.signature.algorithm as string) !== "ed25519") return false;
  const publicKey = createPublicKey({
    key: proposal.signature.publicKeyPem,
    format: "pem",
  });
  const spkiDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const fingerprint = sha256Hex(
    new Uint8Array(spkiDer.buffer, spkiDer.byteOffset, spkiDer.byteLength),
  );
  if (fingerprint !== proposal.signature.keyFingerprintSha256) return false;
  const payload = canonicalJson(buildSigningPayload(proposal));
  return cryptoVerify(
    null,
    Buffer.from(payload, "utf8"),
    publicKey,
    Buffer.from(proposal.signature.signatureBase64, "base64"),
  );
};

/**
 * Construct the canonical-JSON payload that operator signatures cover.
 * Excludes the signature itself; covers the ratification timestamp so
 * a replay of the proposal pre-ratification cannot be promoted by
 * presenting an unrelated signature.
 */
const buildSigningPayload = (
  proposal: CalibrationRefitProposal,
): Omit<CalibrationRefitProposal, "signature"> => {
  const { signature: _signature, ...rest } = proposal;
  void _signature;
  return rest;
};

/**
 * Promote a proposal to production OR record the rollback decision.
 * Refuses to promote when:
 *  - any hard gate is failing (`forceRollback` ignored — gates always rule),
 *  - or no `signKeyPath` is supplied,
 *  - or the operator key fingerprint is not on the allowlist (when one is set).
 *
 * Always returns the persisted proposal record (with signature when
 * ratified). On rollback, a `*-rejected.json` sidecar is written and
 * the proposal record is updated with `rolledBack: true` +
 * `rollbackReason`.
 */
export const ratifyOrRollback = async (
  proposal: CalibrationRefitProposal,
  options: RatifyOrRollbackInput,
): Promise<CalibrationRefitProposal> => {
  if (!options.decidedAt || Number.isNaN(Date.parse(options.decidedAt))) {
    throw new CalibrationRefitOperatorError(
      "decidedAt must be a valid ISO-8601 timestamp.",
    );
  }
  const gateFailures = proposal.gateEvaluation.failedGates;
  const shouldRollback = options.forceRollback === true || gateFailures.length > 0;
  if (shouldRollback) {
    const reason =
      options.rollbackReason ??
      (gateFailures.length > 0
        ? `${gateFailures.length} hard-gate(s) failed: ${gateFailures.join("; ")}`
        : "operator forced rollback");
    const rolled: CalibrationRefitProposal = {
      ...proposal,
      rolledBack: true,
      rollbackReason: reason,
    };
    await writeAtomicJson(
      resolveProposalPath({
        curvesDir: options.curvesDir,
        proposalId: proposal.proposalId,
      }),
      rolled,
    );
    const sidecar: CalibrationRejectionSidecar = {
      schemaVersion: SELF_IMPROVING_CALIBRATION_SCHEMA_VERSION,
      proposalId: proposal.proposalId,
      locale: proposal.locale,
      riskClass: proposal.riskClass,
      rolledBackAt: options.decidedAt,
      reason,
      failedGates: gateFailures,
    };
    await writeAtomicJson(
      resolveRejectionSidecarPath({
        curvesDir: options.curvesDir,
        proposalId: proposal.proposalId,
      }),
      sidecar,
    );
    return rolled;
  }

  if (!options.signKeyPath || options.signKeyPath.length === 0) {
    throw new CalibrationRefitOperatorError(
      "Operator approval required: --sign-key <pem> is mandatory for ratification.",
    );
  }
  const key = await parseEd25519PrivateKey(options.signKeyPath);
  if (
    options.allowedKeyFingerprints !== undefined &&
    options.allowedKeyFingerprints.length > 0 &&
    !options.allowedKeyFingerprints.includes(key.keyFingerprintSha256)
  ) {
    throw new CalibrationRefitOperatorError(
      `Operator key fingerprint ${key.keyFingerprintSha256} is not on the allowlist.`,
    );
  }

  const ratifyBody: Omit<CalibrationRefitProposal, "signature"> = {
    ...proposal,
    ratifiedAt: options.decidedAt,
    rolledBack: false,
  };
  const payloadBytes = Buffer.from(canonicalJson(ratifyBody), "utf8");
  const signatureBytes = key.sign(payloadBytes);
  const signature: CalibrationOperatorSignature = {
    algorithm: "ed25519",
    keyFingerprintSha256: key.keyFingerprintSha256,
    publicKeyPem: key.publicKeyPem,
    signatureBase64: Buffer.from(signatureBytes).toString("base64"),
  };
  const ratified: CalibrationRefitProposal = {
    ...ratifyBody,
    signature,
  };

  // Write the ratified proposal record FIRST so the production curve
  // promotion is provably backed by an audit-trail entry.
  await writeAtomicJson(
    resolveProposalPath({
      curvesDir: options.curvesDir,
      proposalId: proposal.proposalId,
    }),
    ratified,
  );
  // Promote the curve to the production path.
  await writeAtomicJson(
    resolveProductionCurvePath({
      curvesDir: options.curvesDir,
      locale: proposal.locale,
      riskClass: proposal.riskClass,
    }),
    proposal.proposedCurve,
  );
  return ratified;
};

// ---------------------------------------------------------------------------
// Refit-history loader (audit-dossier renderer + G11 guard)
// ---------------------------------------------------------------------------

const safeReaddir = async (dirPath: string): Promise<readonly string[]> => {
  try {
    return await readdir(dirPath);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
};

/**
 * Walk a `calibration-curves/` directory and return every production
 * curve, every proposal (ratified or open), and every rejection
 * sidecar. Inputs are sorted deterministically so the audit-dossier
 * renderer produces byte-identical output across replays.
 */
export const loadCalibrationRefitHistory = async (
  curvesDir: string,
): Promise<CalibrationRefitHistory> => {
  const root = resolve(curvesDir);
  const productionEntries = await safeReaddir(root);
  const productionCurves: CalibrationCurveSnapshot[] = [];
  for (const filename of [...productionEntries].sort((a, b) =>
    a.localeCompare(b),
  )) {
    if (parseCurveFilename(filename) === undefined) continue;
    const curve = await tryReadJson<CalibrationCurveSnapshot>(
      join(root, filename),
    );
    if (curve === undefined) continue;
    productionCurves.push(curve);
  }
  const proposalsDir = join(root, SELF_IMPROVING_CALIBRATION_PROPOSALS_DIRNAME);
  const proposalEntries = await safeReaddir(proposalsDir);
  const proposals: CalibrationRefitProposal[] = [];
  const rejections: CalibrationRejectionSidecar[] = [];
  for (const filename of [...proposalEntries].sort((a, b) =>
    a.localeCompare(b),
  )) {
    if (filename.endsWith(SELF_IMPROVING_CALIBRATION_REJECTION_SUFFIX)) {
      const sidecar = await tryReadJson<CalibrationRejectionSidecar>(
        join(proposalsDir, filename),
      );
      if (sidecar !== undefined) rejections.push(sidecar);
      continue;
    }
    if (!filename.endsWith(".json")) continue;
    const proposal = await tryReadJson<CalibrationRefitProposal>(
      join(proposalsDir, filename),
    );
    if (proposal !== undefined) proposals.push(proposal);
  }
  return {
    schemaVersion: SELF_IMPROVING_CALIBRATION_SCHEMA_VERSION,
    productionCurves,
    proposals,
    rejections,
  };
};

// ---------------------------------------------------------------------------
// G11 CI guard
// ---------------------------------------------------------------------------

/**
 * Walk every production curve and verify that each has at least one
 * ratified, signature-verified proposal whose `proposedCurveDigest`
 * matches the curve's digest. Throws
 * {@link CalibrationRefitSafetyHardGateError} on any violation.
 */
export const assertCalibrationRefitSafety = async (input: {
  readonly curvesDir: string;
  /** Optional operator-key allowlist; signatures from other keys are rejected. */
  readonly allowedKeyFingerprints?: readonly string[];
}): Promise<void> => {
  const history = await loadCalibrationRefitHistory(input.curvesDir);
  const violations: string[] = [];
  const ratifiedByDigest = new Map<string, CalibrationRefitProposal>();
  for (const proposal of history.proposals) {
    if (proposal.signature === undefined) continue;
    if (!verifyCalibrationOperatorSignature(proposal)) {
      violations.push(
        `proposal ${proposal.proposalId} carries an invalid Ed25519 signature`,
      );
      continue;
    }
    if (
      input.allowedKeyFingerprints !== undefined &&
      input.allowedKeyFingerprints.length > 0 &&
      !input.allowedKeyFingerprints.includes(
        proposal.signature.keyFingerprintSha256,
      )
    ) {
      violations.push(
        `proposal ${proposal.proposalId} signed by key ${proposal.signature.keyFingerprintSha256} (not on operator allowlist)`,
      );
      continue;
    }
    if (proposal.rolledBack) {
      violations.push(
        `proposal ${proposal.proposalId} carries a signature but is marked rolledBack`,
      );
      continue;
    }
    ratifiedByDigest.set(proposal.proposedCurveDigest, proposal);
  }
  for (const curve of history.productionCurves) {
    if (curve.digest.length === 0) {
      violations.push(
        `production curve ${curve.locale}/${curve.riskClass} has empty digest`,
      );
      continue;
    }
    // The stored `digest` field is self-referential: recompute it from
    // the curve body so a hand-edit of any other field (e.g. intercept,
    // slope, ECE) is caught even if the digest itself was preserved.
    const { digest: storedDigest, ...curveBody } = curve;
    const recomputedDigest = computeCurveDigest(curveBody);
    if (recomputedDigest !== storedDigest) {
      violations.push(
        `production curve ${curve.locale}/${curve.riskClass} digest mismatch: stored ${storedDigest.slice(0, 12)}…, recomputed ${recomputedDigest.slice(0, 12)}…`,
      );
      continue;
    }
    const backing = ratifiedByDigest.get(curve.digest);
    if (backing === undefined) {
      violations.push(
        `production curve ${curve.locale}/${curve.riskClass} (digest ${curve.digest.slice(0, 12)}…) has no ratified proposal`,
      );
      continue;
    }
    if (backing.locale !== curve.locale || backing.riskClass !== curve.riskClass) {
      violations.push(
        `production curve ${curve.locale}/${curve.riskClass} backed by proposal for ${backing.locale}/${backing.riskClass}`,
      );
    }
  }
  if (violations.length > 0) {
    throw new CalibrationRefitSafetyHardGateError(violations);
  }
};

// ---------------------------------------------------------------------------
// Rendering helper for the audit-dossier
// ---------------------------------------------------------------------------

/**
 * Compact, renderer-friendly summary of the refit history. Computed
 * from {@link CalibrationRefitHistory}. Pure transformation; the
 * audit-dossier renderer can call this directly without re-reading
 * disk.
 */
export const summarizeCalibrationRefitHistory = (
  history: CalibrationRefitHistory,
): {
  readonly productionCurveCount: number;
  readonly proposalCount: number;
  readonly ratifiedCount: number;
  readonly rolledBackCount: number;
  readonly rows: ReadonlyArray<{
    readonly locale: SupportedLocale;
    readonly riskClass: RegulatedRiskClass;
    readonly proposalId: string;
    readonly status: "ratified" | "open" | "rolled_back";
    readonly proposedAt: string;
    readonly ratifiedAt?: string;
    readonly heldOutEce: number;
    readonly heldOutKappa: number;
  }>;
} => {
  const rejectionsById = new Map<string, CalibrationRejectionSidecar>();
  for (const sidecar of history.rejections) {
    rejectionsById.set(sidecar.proposalId, sidecar);
  }
  const rows = [...history.proposals]
    .sort((left, right) => {
      const localeCompare = left.locale.localeCompare(right.locale);
      if (localeCompare !== 0) return localeCompare;
      const riskCompare = left.riskClass.localeCompare(right.riskClass);
      if (riskCompare !== 0) return riskCompare;
      return left.proposedAt.localeCompare(right.proposedAt);
    })
    .map((proposal) => {
      const status: "ratified" | "open" | "rolled_back" = proposal.rolledBack
        ? "rolled_back"
        : proposal.ratifiedAt !== undefined
          ? "ratified"
          : "open";
      return {
        locale: proposal.locale,
        riskClass: proposal.riskClass,
        proposalId: proposal.proposalId,
        status,
        proposedAt: proposal.proposedAt,
        ...(proposal.ratifiedAt !== undefined
          ? { ratifiedAt: proposal.ratifiedAt }
          : {}),
        heldOutEce: proposal.heldOutEce,
        heldOutKappa: proposal.heldOutKappa,
      };
    });
  return {
    productionCurveCount: history.productionCurves.length,
    proposalCount: history.proposals.length,
    ratifiedCount: history.proposals.filter(
      (proposal) => !proposal.rolledBack && proposal.ratifiedAt !== undefined,
    ).length,
    rolledBackCount: history.proposals.filter(
      (proposal) => proposal.rolledBack,
    ).length,
    rows,
  };
};
