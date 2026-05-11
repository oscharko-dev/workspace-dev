# Per-locale calibration gold sets (Issue #2188)

Each `<locale>/` sub-directory holds two artifacts:

- `gold-set.json` — at least 30 native-speaker-labeled gold cases, with
  two reviewer verdicts per case (and an arbiter resolution where the
  reviewers disagreed) so the inter-rater Cohen's κ for the gold set
  exceeds the 0.7 gate (Issue #2109).
- `platt-curve.json` — the fitted Platt-scaling curve (intercept,
  slope, sample count, held-out ECE, held-out κ) for the locale. The
  per-locale ECE threshold is fixed at 0.10 (Issue #2107 acceptance
  criteria §5; mirrored in `case-confidence-calibrator.ts`).

The reviewer pool for each locale is operator-curated. The harness only
consumes the fitted curve and the gold-set; reviewer recruitment is
tracked in `docs/test-intelligence/locales.md`.

The five locales added in Issue #2188 are: PL-PL, ES-ES, NL-NL, CS-CZ,
HU-HU. The original six locales from Issue #2117 remain the entry
point; their data lives alongside the aggregate calibration artifacts.
