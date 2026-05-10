---
"workspace-dev": minor
---

Add per-locale Platt-curve calibration stratified by DE-DE, DE-AT, DE-CH, EN-IE, FR-FR, IT-IT for Issue #2117.

- New `locale` optional field on `BusinessTestIntentScreen` (typed as `SupportedLocale`); wired through `deriveScreens` in `intent-derivation.ts`. Additive: existing callers unaffected.
- New module `src/test-intelligence/locale-calibration.ts` exporting `SupportedLocale`, `SUPPORTED_LOCALES`, `LOCALE_CALIBRATION_FALLBACK_KEY`, `LocaleCalibrationKey`, `isSupportedLocale`, `deriveLocaleFromScreen`, `deriveLocaleFromBusinessTestIntentScreen`. All functions are pure and deterministic.
- `CaseConfidenceCurveArtifact` extended with three additive fields: `localeCurves` (per-locale Platt fits; `"default"` key is always the aggregate), `perLocaleEceThreshold` (fixed 0.10, sourced from Issue #2107 criteria), `localeSampleCount`. New exported type `LocaleCurveEntry` with `fallbackToDefault` flag.
- `LoadCaseConfidenceCalibrationInput` extended with optional `screenLocaleMap`; `LoadedCaseConfidenceCalibration` extended with optional `localeReliabilityArtifactPaths`.
- Per-locale reliability diagram artifacts written as `case-confidence-reliability-locale-<locale>.json` using the canonical-JSON atomic-write pattern. New exported interface `CaseConfidenceLocaleReliabilityDiagramArtifact`.
- `applyCaseConfidenceCalibration` accepts optional `screenLocaleMap` and selects the per-locale curve per test case (falls back to default for unseen locales).
- `DriftMetricObservation` and `DriftFinding` extended with optional `locale?: LocaleCalibrationKey`. `metricKey` updated to include locale dimension (empty string for base observations, keeping existing baselines green). `computeDriftCanaryMetrics` accepts optional `screenLocaleMap` and emits per-locale `brier_score` / `ece` observations. `evaluateDriftReport` propagates locale into `ece_absolute_threshold` findings.
- Six new calibration fixtures under `fixtures/test-intelligence/per-locale-calibration/` (`DE-AT.figma.json`, `DE-CH.figma.json`, `DE-DE.figma.json`, `EN-IE.figma.json`, `FR-FR.figma.json`, `IT-IT.figma.json`) plus a README.
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumped 1.22.0 → 1.23.0. `SupportedLocale` type exported from `src/contracts/index.ts`.
