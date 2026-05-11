---
"workspace-dev": minor
---

Extend per-locale Platt-curve calibration with five additional EU-banking locales (PL-PL, ES-ES, NL-NL, CS-CZ, HU-HU) for Issue #2188.

- `SupportedLocale` union widened from six locales to eleven; `SUPPORTED_LOCALES`, the IBAN-prefix table, primary-tag promotion, and the keyword heuristic in `src/test-intelligence/locale-calibration.ts` extended accordingly.
- New module `src/test-intelligence/locale-calibration-health.ts` exporting the `G13_LOCALE_CALIBRATION_HEALTHY` hard gate plus the per-locale invariants (κ ≥ 0.7, held-out ECE ≤ 0.10, sample count ≥ 30, no `fallbackToDefault`).
- `AuditDossierManifest` gains an optional `localeCalibrationHealth` block; audit-dossier renderer table-renders it when the per-locale fixtures are present. Legacy dossiers without per-locale fixtures keep the existing shape.
- Per-locale corpora added under `fixtures/test-intelligence/locale-calibration/<locale>/` (gold set of 30 cases + fitted Platt curve), `fixtures/test-intelligence/terminology/<locale>.json` (50 banking + 30 insurance terms), and `fixtures/compliance/<locale>.json` (local-regulator → EU regulation citation map).
- New operator-facing onboarding checklist at `docs/test-intelligence/locales.md`.

All changes are additive; the existing six locales (DE-DE/AT/CH, EN-IE, FR-FR, IT-IT) and the G1–G7 + G8 + G9 hard gates are byte-identical to the previous release. Contract version bumped 1.37.0 → 1.38.0.
