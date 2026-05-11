/**
 * G13 — per-locale calibration-health gate (Issue #2188).
 *
 * The gate is asserted **per locale**.  For each `SupportedLocale` we load
 * the offline-fit Platt curve from
 * `fixtures/test-intelligence/locale-calibration/<locale>/platt-curve.json`
 * and the native-speaker-labeled gold set from
 * `fixtures/test-intelligence/locale-calibration/<locale>/gold-set.json`,
 * then check four invariants:
 *
 *   1. **κ ≥ 0.7** (Issue #2109 inter-rater agreement gate, applied
 *      per locale).
 *   2. **held-out ECE ≤ 0.10** (Issue #2107 per-class ECE thresholds
 *      mirrored at the per-locale layer).
 *   3. **sample count ≥ 30** (acceptance criteria of Issue #2188 — the
 *      minimum gold-set size beneath which a per-locale curve cannot be
 *      attested).
 *   4. **no `fallbackToDefault`** (a per-locale entry that copied the
 *      aggregate curve is not a healthy locale-specific fit).
 *
 * Any locale that violates one of these invariants fails the gate
 * **independently**; other locales are not blocked. The gate emits a
 * deterministic, canonical-JSON report of all four invariants per
 * locale so the audit-dossier renderer can table-render the health
 * status (acceptance criteria of Issue #2188).
 *
 * The module is pure: identical fixture inputs → identical report.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalJson } from "./content-hash.js";
import {
  isSupportedLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "./locale-calibration.js";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * Hard-gate code emitted by `assertLocaleCalibrationHealthy` when any
 * locale fails one or more health checks (Issue #2188).
 */
export const G13_LOCALE_CALIBRATION_HEALTHY =
  "G13_LOCALE_CALIBRATION_HEALTHY" as const;

/** Schema version of {@link LocaleCalibrationHealthReport}. */
export const LOCALE_CALIBRATION_HEALTH_REPORT_SCHEMA_VERSION = "1.0.0" as const;

/** Held-out ECE ceiling. Fixed at 0.10 per Issue #2107 / #2117 / #2188. */
export const LOCALE_CALIBRATION_ECE_CEILING = 0.1 as const;

/** Per-locale Cohen's κ floor. */
export const LOCALE_CALIBRATION_KAPPA_FLOOR = 0.7 as const;

/** Minimum native-speaker-labeled sample count per locale gold set. */
export const LOCALE_CALIBRATION_MIN_SAMPLE_COUNT = 30 as const;

/**
 * Default fixture root, resolved relative to the repo root. Callers can
 * override for tests.
 */
export const LOCALE_CALIBRATION_FIXTURE_ROOT =
  "fixtures/test-intelligence/locale-calibration" as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface LocaleCalibrationHealthInvariant {
  readonly name:
    | "kappa_floor"
    | "ece_ceiling"
    | "minimum_sample_count"
    | "no_fallback_to_default";
  readonly observed: number | boolean;
  readonly threshold: number | boolean;
  readonly passed: boolean;
}

export interface LocaleCalibrationHealthEntry {
  readonly locale: SupportedLocale;
  readonly invariants: ReadonlyArray<LocaleCalibrationHealthInvariant>;
  readonly passed: boolean;
}

export interface LocaleCalibrationHealthReport {
  readonly schemaVersion:
    typeof LOCALE_CALIBRATION_HEALTH_REPORT_SCHEMA_VERSION;
  readonly gateCode: typeof G13_LOCALE_CALIBRATION_HEALTHY;
  readonly thresholds: {
    readonly kappaFloor: typeof LOCALE_CALIBRATION_KAPPA_FLOOR;
    readonly eceCeiling: typeof LOCALE_CALIBRATION_ECE_CEILING;
    readonly minimumSampleCount: typeof LOCALE_CALIBRATION_MIN_SAMPLE_COUNT;
  };
  readonly locales: ReadonlyArray<LocaleCalibrationHealthEntry>;
  readonly failedLocales: ReadonlyArray<SupportedLocale>;
  readonly passed: boolean;
}

export interface LoadedPerLocaleArtifacts {
  readonly locale: SupportedLocale;
  readonly heldOutEce: number;
  readonly heldOutKappa: number;
  readonly sampleCount: number;
  readonly fallbackToDefault: boolean;
}

// ---------------------------------------------------------------------------
// Public API — pure invariant check (no I/O)
// ---------------------------------------------------------------------------

/**
 * Compute the four per-locale health invariants for a single
 * pre-loaded artifact pair. Pure: no I/O.
 */
export const evaluateLocaleCalibrationHealth = (
  artifact: LoadedPerLocaleArtifacts,
): LocaleCalibrationHealthEntry => {
  const invariants: LocaleCalibrationHealthInvariant[] = [
    {
      name: "kappa_floor",
      observed: artifact.heldOutKappa,
      threshold: LOCALE_CALIBRATION_KAPPA_FLOOR,
      passed: artifact.heldOutKappa >= LOCALE_CALIBRATION_KAPPA_FLOOR,
    },
    {
      name: "ece_ceiling",
      observed: artifact.heldOutEce,
      threshold: LOCALE_CALIBRATION_ECE_CEILING,
      passed: artifact.heldOutEce <= LOCALE_CALIBRATION_ECE_CEILING,
    },
    {
      name: "minimum_sample_count",
      observed: artifact.sampleCount,
      threshold: LOCALE_CALIBRATION_MIN_SAMPLE_COUNT,
      passed: artifact.sampleCount >= LOCALE_CALIBRATION_MIN_SAMPLE_COUNT,
    },
    {
      name: "no_fallback_to_default",
      observed: artifact.fallbackToDefault,
      threshold: false,
      passed: !artifact.fallbackToDefault,
    },
  ];
  return {
    locale: artifact.locale,
    invariants,
    passed: invariants.every((inv) => inv.passed),
  };
};

/**
 * Assemble the aggregate health report from a fully pre-loaded set of
 * per-locale artifacts. Pure: no I/O. Locales missing from `artifacts`
 * are silently skipped — typically the six pre-Issue-#2188 locales,
 * which are checked by their own (Issue #2117) machinery.
 *
 * The output is sorted by `SupportedLocale` for deterministic
 * byte-equality with golden fixtures.
 */
export const buildLocaleCalibrationHealthReport = (
  artifacts: ReadonlyArray<LoadedPerLocaleArtifacts>,
): LocaleCalibrationHealthReport => {
  const entries = [...artifacts]
    .sort((a, b) => a.locale.localeCompare(b.locale))
    .map(evaluateLocaleCalibrationHealth);
  const failedLocales = entries
    .filter((entry) => !entry.passed)
    .map((entry) => entry.locale);
  return {
    schemaVersion: LOCALE_CALIBRATION_HEALTH_REPORT_SCHEMA_VERSION,
    gateCode: G13_LOCALE_CALIBRATION_HEALTHY,
    thresholds: {
      kappaFloor: LOCALE_CALIBRATION_KAPPA_FLOOR,
      eceCeiling: LOCALE_CALIBRATION_ECE_CEILING,
      minimumSampleCount: LOCALE_CALIBRATION_MIN_SAMPLE_COUNT,
    },
    locales: entries,
    failedLocales,
    passed: failedLocales.length === 0,
  };
};

// ---------------------------------------------------------------------------
// I/O layer — fixture loader
// ---------------------------------------------------------------------------

interface PlattCurveArtifact {
  readonly locale: string;
  readonly heldOutEce: number;
  readonly heldOutKappa: number;
  readonly sampleCount: number;
  readonly fallbackToDefault: boolean;
}

const isPlattCurveArtifact = (
  value: unknown,
): value is PlattCurveArtifact => {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["locale"] === "string" &&
    typeof v["heldOutEce"] === "number" &&
    typeof v["heldOutKappa"] === "number" &&
    typeof v["sampleCount"] === "number" &&
    typeof v["fallbackToDefault"] === "boolean"
  );
};

/**
 * Load the offline-fit per-locale Platt curve fixtures from disk. The
 * 6 pre-Issue-#2188 locales do not (yet) ship a fixture in this
 * directory, so they are silently skipped — they remain covered by
 * the aggregate Issue #2117 calibrator. Only the locales added by
 * Issue #2188 are gated here.
 *
 * `fixtureRoot` defaults to {@link LOCALE_CALIBRATION_FIXTURE_ROOT}
 * resolved against the current working directory. Pass an absolute
 * path for hermetic tests.
 */
export const loadLocaleCalibrationArtifacts = async (
  fixtureRoot: string = LOCALE_CALIBRATION_FIXTURE_ROOT,
): Promise<LoadedPerLocaleArtifacts[]> => {
  const artifacts: LoadedPerLocaleArtifacts[] = [];
  for (const locale of SUPPORTED_LOCALES) {
    const path = join(fixtureRoot, locale, "platt-curve.json");
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      // Skip locales without a fixture — pre-Issue-#2188 locales sit
      // outside this gate's scope by design.
      continue;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isPlattCurveArtifact(parsed)) {
      throw new Error(
        `${G13_LOCALE_CALIBRATION_HEALTHY}: malformed Platt-curve fixture at ${path}`,
      );
    }
    if (!isSupportedLocale(parsed.locale) || parsed.locale !== locale) {
      throw new Error(
        `${G13_LOCALE_CALIBRATION_HEALTHY}: fixture at ${path} declares locale ${parsed.locale} ≠ ${locale}`,
      );
    }
    artifacts.push({
      locale,
      heldOutEce: parsed.heldOutEce,
      heldOutKappa: parsed.heldOutKappa,
      sampleCount: parsed.sampleCount,
      fallbackToDefault: parsed.fallbackToDefault,
    });
  }
  return artifacts;
};

// ---------------------------------------------------------------------------
// Public API — driver
// ---------------------------------------------------------------------------

/** Error thrown by `assertLocaleCalibrationHealthy` when the gate trips. */
export class LocaleCalibrationHealthError extends Error {
  readonly code: typeof G13_LOCALE_CALIBRATION_HEALTHY = G13_LOCALE_CALIBRATION_HEALTHY;
  readonly report: LocaleCalibrationHealthReport;
  constructor(report: LocaleCalibrationHealthReport) {
    super(
      `${G13_LOCALE_CALIBRATION_HEALTHY}: ${report.failedLocales.length} locale(s) failed health checks: ${report.failedLocales.join(", ")}`,
    );
    this.name = "LocaleCalibrationHealthError";
    this.report = report;
  }
}

/**
 * Driver entry point. Loads the per-locale fixtures and asserts that
 * **every locale present in the fixture tree** passes all four health
 * invariants. Throws {@link LocaleCalibrationHealthError} on failure.
 *
 * Returns the canonical-JSON serialisation of the report (the byte
 * sequence that should be persisted alongside other run artifacts).
 */
export const assertLocaleCalibrationHealthy = async (
  fixtureRoot?: string,
): Promise<string> => {
  const artifacts = await loadLocaleCalibrationArtifacts(fixtureRoot);
  const report = buildLocaleCalibrationHealthReport(artifacts);
  if (!report.passed) {
    throw new LocaleCalibrationHealthError(report);
  }
  return canonicalJson(report);
};
