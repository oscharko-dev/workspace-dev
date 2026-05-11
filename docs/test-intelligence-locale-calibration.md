# Per-locale calibration (Issues #2117, #2188)

This document describes the per-locale Platt-curve calibration added in Issue #2117
and extended in Issue #2188, alongside the existing aggregate calibration described in
[test-intelligence-judge-calibration.md](./test-intelligence-judge-calibration.md).

## Supported locales

Eleven EU-banking locales are supported. The initial six were added by
Issue #2117; Issue #2188 (W8-6) extended the corpus with five additional
locales driven by concrete EU-banking customer pipeline demand:

| Code    | Country / variant            | Added by    |
|---------|------------------------------|-------------|
| `DE-DE` | Germany                      | Issue #2117 |
| `DE-AT` | Austria                      | Issue #2117 |
| `DE-CH` | Switzerland (German)         | Issue #2117 |
| `EN-IE` | Ireland (English)            | Issue #2117 |
| `FR-FR` | France                       | Issue #2117 |
| `IT-IT` | Italy                        | Issue #2117 |
| `PL-PL` | Poland (Polish)              | Issue #2188 |
| `ES-ES` | Spain (Spanish)              | Issue #2188 |
| `NL-NL` | Netherlands (Dutch)          | Issue #2188 |
| `CS-CZ` | Czechia (Czech)              | Issue #2188 |
| `HU-HU` | Hungary (Hungarian)          | Issue #2188 |

The set is declared as `SUPPORTED_LOCALES` in `src/test-intelligence/locale-calibration.ts`
and mirrored as the `SupportedLocale` union type in `src/contracts/index.ts`.

See [`test-intelligence/locales.md`](./test-intelligence/locales.md) for the
operator-facing onboarding checklist (native-speaker reviewer recruitment,
gold-set sizing, glossary curation, citation-map curation) for new locales.

## Per-locale Platt curves

`loadCaseConfidenceCalibration` now accepts an optional `screenLocaleMap` argument
(`ReadonlyMap<string, SupportedLocale>`) mapping Figma screen IDs to locales.  When
supplied:

1. Each historical calibration sample is tagged with the locale of its first
   `figmaTraceRefs` screen.
2. A separate Platt scaling gradient-descent fit is run per locale bucket, using
   the same hyperparameters as the aggregate fit (600 iterations, learning rate 0.35).
3. Locale buckets with fewer than `CALIBRATION_MIN_SAMPLE_FLOOR` (50) samples are
   not fitted independently — their `localeCurves` entry has `fallbackToDefault: true`
   and copies the aggregate curve's intercept and slope.
4. The aggregate (`"default"`) entry is always present in `localeCurves` and matches
   the top-level `intercept`/`slope` fields.

`applyCaseConfidenceCalibration` also accepts `screenLocaleMap`.  It selects the
per-locale curve for each test case based on its first figma-trace screen; any test
case whose screen is absent from the map, or whose locale has `fallbackToDefault: true`,
uses the aggregate curve.

## ECE threshold

The per-locale Expected Calibration Error (ECE) gate is fixed at **0.10** for all
locales (field: `perLocaleEceThreshold` on `CaseConfidenceCurveArtifact`).  This is
independent of the per-risk-category thresholds in `CALIBRATION_ECE_THRESHOLDS` (which
apply to the aggregate curve's reliability diagrams).  Source: Issue #2107 and
Issue #2117 acceptance criteria §5.

## Reliability diagram artifacts

A per-locale reliability diagram artifact is written for each locale that appears in the
sample set (including the `"default"` aggregate key).  Filenames follow the pattern:

```
case-confidence-reliability-locale-<locale>.json
```

(e.g. `case-confidence-reliability-locale-DE-DE.json`).  The artifact body is the
`CaseConfidenceLocaleReliabilityDiagramArtifact` interface; it mirrors the existing
per-risk-category artifact but adds a `locale: LocaleCalibrationKey` discriminator.
Paths are returned in `LoadedCaseConfidenceCalibration.localeReliabilityArtifactPaths`.

## Locale derivation

`deriveLocaleFromScreen` (in `locale-calibration.ts`) resolves a locale from a
combination of signals in the following priority order:

1. Exact `SupportedLocale` match in `screenLocale`.
2. 2-letter BCP 47 primary sub-tag promotion: `de`→`DE-DE`, `fr`→`FR-FR`,
   `it`→`IT-IT`, `en`→`EN-IE` (Irish bias, documented default for EU banking).
3. IBAN country-code prefix tokens: `AT`→`DE-AT`, `CH`→`DE-CH`, `DE`→`DE-DE`,
   `FR`→`FR-FR`, `IE`→`EN-IE`, `IT`→`IT-IT`.
4. Validation-string and field-label keyword matching (e.g. `AHV-Nummer`→`DE-CH`,
   `Champ obligatoire`→`FR-FR`, `Codice Fiscale`→`IT-IT`, `Eircode`→`EN-IE`).

Returns `undefined` when no rule matches; callers decide the fallback.

## Drift detection

`DriftMetricObservation` and `DriftFinding` carry an optional `locale` field
(`LocaleCalibrationKey`).  `computeDriftCanaryMetrics` emits additional per-locale
`brier_score` and `ece` observations grouped by `(riskCategory × locale)` when
`screenLocaleMap` is supplied.  The base observations (no `locale` field) are always
emitted so existing baselines remain green.  `evaluateDriftReport` propagates the
`locale` dimension into `ece_absolute_threshold` findings when it is present.

## Calibration fixtures

Six minimal fixtures under `fixtures/test-intelligence/per-locale-calibration/` pin
the locale-specific vocabulary for each supported locale.  See the README in that
directory for details.
