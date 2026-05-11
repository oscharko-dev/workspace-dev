import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  G13_LOCALE_CALIBRATION_HEALTHY,
  LOCALE_CALIBRATION_ECE_CEILING,
  LOCALE_CALIBRATION_KAPPA_FLOOR,
  LOCALE_CALIBRATION_MIN_SAMPLE_COUNT,
  LocaleCalibrationHealthError,
  assertLocaleCalibrationHealthy,
  buildLocaleCalibrationHealthReport,
  evaluateLocaleCalibrationHealth,
  loadLocaleCalibrationArtifacts,
  type LoadedPerLocaleArtifacts,
} from "./locale-calibration-health.js";
import type { SupportedLocale } from "./locale-calibration.js";

const ALL_NEW_LOCALES: ReadonlyArray<SupportedLocale> = [
  "PL-PL",
  "ES-ES",
  "NL-NL",
  "CS-CZ",
  "HU-HU",
];

const healthyArtifact = (locale: SupportedLocale): LoadedPerLocaleArtifacts => ({
  locale,
  heldOutEce: 0.05,
  heldOutKappa: 0.78,
  sampleCount: 30,
  fallbackToDefault: false,
});

// ---------------------------------------------------------------------------
// Pure invariant evaluation
// ---------------------------------------------------------------------------

test("G13: gate code is the stable string G13_LOCALE_CALIBRATION_HEALTHY", () => {
  assert.equal(G13_LOCALE_CALIBRATION_HEALTHY, "G13_LOCALE_CALIBRATION_HEALTHY");
});

test("G13: thresholds match the documented contract", () => {
  assert.equal(LOCALE_CALIBRATION_KAPPA_FLOOR, 0.7);
  assert.equal(LOCALE_CALIBRATION_ECE_CEILING, 0.1);
  assert.equal(LOCALE_CALIBRATION_MIN_SAMPLE_COUNT, 30);
});

test("G13: healthy artifact passes all four invariants", () => {
  const entry = evaluateLocaleCalibrationHealth(healthyArtifact("PL-PL"));
  assert.equal(entry.passed, true);
  assert.equal(entry.invariants.length, 4);
  for (const inv of entry.invariants) assert.equal(inv.passed, true);
});

test("G13: κ below floor fails the gate", () => {
  const entry = evaluateLocaleCalibrationHealth({
    ...healthyArtifact("ES-ES"),
    heldOutKappa: 0.65,
  });
  assert.equal(entry.passed, false);
  assert.equal(
    entry.invariants.find((i) => i.name === "kappa_floor")?.passed,
    false,
  );
});

test("G13: ECE above ceiling fails the gate", () => {
  const entry = evaluateLocaleCalibrationHealth({
    ...healthyArtifact("NL-NL"),
    heldOutEce: 0.15,
  });
  assert.equal(entry.passed, false);
  assert.equal(
    entry.invariants.find((i) => i.name === "ece_ceiling")?.passed,
    false,
  );
});

test("G13: sample count below 30 fails the gate", () => {
  const entry = evaluateLocaleCalibrationHealth({
    ...healthyArtifact("CS-CZ"),
    sampleCount: 12,
  });
  assert.equal(entry.passed, false);
  assert.equal(
    entry.invariants.find((i) => i.name === "minimum_sample_count")?.passed,
    false,
  );
});

test("G13: fallbackToDefault=true fails the gate", () => {
  const entry = evaluateLocaleCalibrationHealth({
    ...healthyArtifact("HU-HU"),
    fallbackToDefault: true,
  });
  assert.equal(entry.passed, false);
  assert.equal(
    entry.invariants.find((i) => i.name === "no_fallback_to_default")?.passed,
    false,
  );
});

// ---------------------------------------------------------------------------
// Aggregate report
// ---------------------------------------------------------------------------

test("G13: aggregate report passes when all five Issue #2188 locales are healthy", () => {
  const report = buildLocaleCalibrationHealthReport(
    ALL_NEW_LOCALES.map(healthyArtifact),
  );
  assert.equal(report.passed, true);
  assert.equal(report.failedLocales.length, 0);
  assert.equal(report.locales.length, 5);
  assert.equal(report.gateCode, G13_LOCALE_CALIBRATION_HEALTHY);
  // Locales are sorted alphabetically for deterministic byte-equality.
  assert.deepEqual(
    report.locales.map((entry) => entry.locale),
    ["CS-CZ", "ES-ES", "HU-HU", "NL-NL", "PL-PL"],
  );
});

test("G13: aggregate report reports the failing locale set", () => {
  const report = buildLocaleCalibrationHealthReport([
    healthyArtifact("PL-PL"),
    { ...healthyArtifact("ES-ES"), heldOutKappa: 0.5 },
    healthyArtifact("NL-NL"),
    { ...healthyArtifact("CS-CZ"), heldOutEce: 0.4 },
    healthyArtifact("HU-HU"),
  ]);
  assert.equal(report.passed, false);
  assert.deepEqual([...report.failedLocales].sort(), ["CS-CZ", "ES-ES"]);
});

test("G13: passes when artifact list is empty (no locales to gate)", () => {
  const report = buildLocaleCalibrationHealthReport([]);
  assert.equal(report.passed, true);
  assert.equal(report.failedLocales.length, 0);
});

// ---------------------------------------------------------------------------
// Driver — reads the actual fixture tree shipped with this repo
// ---------------------------------------------------------------------------

test("G13: shipped Issue #2188 fixtures pass the gate", async () => {
  const json = await assertLocaleCalibrationHealthy();
  const report = JSON.parse(json) as { passed: boolean; locales: Array<{ locale: SupportedLocale }> };
  assert.equal(report.passed, true);
  // Every Issue #2188 locale must be present.
  const localesPresent = report.locales.map((entry) => entry.locale).sort();
  assert.deepEqual(localesPresent, ["CS-CZ", "ES-ES", "HU-HU", "NL-NL", "PL-PL"]);
});

test("G13: malformed fixture raises a typed error", async () => {
  const root = await mkdtemp(join(tmpdir(), "loc-cal-health-"));
  await mkdir(join(root, "PL-PL"), { recursive: true });
  await writeFile(
    join(root, "PL-PL", "platt-curve.json"),
    '{"locale":"PL-PL","heldOutEce":"oops"}',
  );
  await assert.rejects(
    () => loadLocaleCalibrationArtifacts(root),
    /malformed Platt-curve fixture/,
  );
});

test("G13: assert throws LocaleCalibrationHealthError on unhealthy fixtures", async () => {
  const root = await mkdtemp(join(tmpdir(), "loc-cal-health-"));
  await mkdir(join(root, "PL-PL"), { recursive: true });
  await writeFile(
    join(root, "PL-PL", "platt-curve.json"),
    JSON.stringify({
      locale: "PL-PL",
      heldOutEce: 0.05,
      heldOutKappa: 0.4, // below floor → trips the gate
      sampleCount: 30,
      fallbackToDefault: false,
    }),
  );
  await assert.rejects(
    () => assertLocaleCalibrationHealthy(root),
    (error) =>
      error instanceof LocaleCalibrationHealthError &&
      error.code === G13_LOCALE_CALIBRATION_HEALTHY,
  );
});

test("G13: locale mismatch between filename and payload is rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "loc-cal-health-"));
  await mkdir(join(root, "PL-PL"), { recursive: true });
  await writeFile(
    join(root, "PL-PL", "platt-curve.json"),
    JSON.stringify({
      locale: "ES-ES",
      heldOutEce: 0.05,
      heldOutKappa: 0.78,
      sampleCount: 30,
      fallbackToDefault: false,
    }),
  );
  await assert.rejects(
    () => loadLocaleCalibrationArtifacts(root),
    /declares locale ES-ES ≠ PL-PL/,
  );
});
