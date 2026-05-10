# Per-locale calibration fixtures

This directory contains one minimal Figma JSON fixture per supported locale for Issue #2117 (per-locale Platt-curve calibration).

Each fixture file (`<LOCALE>.figma.json`) pins a single screen with the locale code in the `locale` field, a BUTTON node, and two to three TEXT_INPUT nodes carrying the locale-specific validation keywords (e.g. `Pflichtfeld` for German variants, `Champ obligatoire` for French, `Campo obbligatorio` for Italian, `Required field` for Irish-English). These keyword sets are the same ones that `deriveLocaleFromScreen` in `locale-calibration.ts` uses to identify locales when no explicit locale tag is present.

The fixtures serve two purposes: they are loaded by `locale-calibration.test.ts` to assert that the keyword heuristic resolves the correct `SupportedLocale`, and they document the minimum field vocabulary expected from each locale's Figma designs in the EU banking / insurance domain.
