# Per-locale calibration — onboarding checklist (Issue #2188)

This document is the operator-facing companion to
[`test-intelligence-locale-calibration.md`](../test-intelligence-locale-calibration.md).
The original Issue #2117 covers the six initial EU-banking locales
(DE-DE, DE-AT, DE-CH, EN-IE, FR-FR, IT-IT). Issue #2188 extends the
calibration corpus to five additional locales driven by the EU-banking
customer pipeline:

| Locale  | Country     | Regulator | Customer-pipeline driver                                           |
|---------|-------------|-----------|---------------------------------------------------------------------|
| `PL-PL` | Poland      | KNF       | Tier-1 Polish bank (KNF adopts EBA + EU AI Act)                     |
| `ES-ES` | Spain       | BdE       | Spanish savings banks (Cajas), supervised by Banco de España        |
| `NL-NL` | Netherlands | DNB       | Dutch insurer (DNB-supervised, Solvency II)                         |
| `CS-CZ` | Czechia     | ČNB       | Czech Sparkasse-equivalent                                          |
| `HU-HU` | Hungary     | MNB       | Hungarian commercial bank                                           |

Each locale is **independently shippable**: PL can land before NL if
the gold set is ready first.

## Per-locale onboarding checklist

For each new locale the operator (not the harness) must produce four
artifacts. The harness only consumes them.

### 1. Native-speaker reviewer recruitment

Recruit at least three reviewers per locale:

- **Reviewer A** — primary calibration labeller.
- **Reviewer B** — independent secondary labeller for the inter-rater
  κ ≥ 0.7 gate (Issue #2109).
- **Arbiter** — resolves cases where reviewer A and reviewer B disagree.

Reviewer identifiers are recorded under `reviewerPool` in the
locale's `platt-curve.json` and `gold-set.json` fixtures.

Reviewer recruitment criteria:

- Native speaker (or near-native, e.g. C2 CEFR proficiency).
- Domain expertise in EU banking and/or insurance, with familiarity
  with the local regulator's vocabulary (KNF / BdE / DNB / ČNB / MNB).
- No undisclosed conflict of interest with covered customers.

### 2. Gold-set sizing

Produce at least **30 native-speaker-labeled gold cases** per locale
in `fixtures/test-intelligence/locale-calibration/<locale>/gold-set.json`.

Composition guidance (used for the Issue #2188 baseline corpus):

| Bucket          | Count | Description                                                          |
|-----------------|-------|----------------------------------------------------------------------|
| Accept (clear)  | 18    | High raw score, both reviewers vote accept, no adjudication.         |
| Reject (clear)  | 8     | Low raw score, both reviewers vote reject, no adjudication.          |
| Adjudicated     | 4     | Mid-range raw score; reviewers disagreed; arbiter resolved.          |

The composition gives an observed agreement of 26/30 ≈ 0.867 and a
Cohen's κ comfortably above the 0.7 gate.

Case schema (one entry of `cases[]`):

```jsonc
{
  "caseId": "pl-pl-gold-001",
  "locale": "PL-PL",
  "riskCategory": "high",            // one of CALIBRATION_RISK_CATEGORIES
  "rawScore": 0.82,                  // pre-calibration score
  "label": 1,                        // 1 = accept, 0 = reject
  "goldVerdicts": [
    { "reviewer": "pl-reviewer-1", "verdict": "accept", "timestamp": "…" },
    { "reviewer": "pl-reviewer-2", "verdict": "accept", "timestamp": "…" }
  ],
  "adjudicated": false               // true when an arbiter resolved a tie
}
```

### 3. Terminology glossary curation

Drop a `fixtures/test-intelligence/terminology/<locale>.json` file with
**at least 50 banking + 30 insurance terms**. The shape is:

```jsonc
{
  "locale": "PL-PL",
  "language": "Polish (Polski)",
  "banking":   { "account": "rachunek", "iban": "IBAN", … },
  "insurance": { "policy":  "polisa",  "premium": "składka", … }
}
```

Coverage expectations:

- **Banking**: account types, transfer operations, card primitives,
  loan vocabulary, fees / commissions, FX, KYC / AML, PSD2 / SCA
  artefacts, local tax / national-ID identifiers, statements.
- **Insurance**: policy / policyholder / insured / beneficiary,
  premium / deductible / sum-insured, claim / damage / loss, motor
  third-party + comprehensive, life / health / property / liability,
  reinsurance / underwriting / actuary, Solvency II / IDD.

### 4. Regulatory citation map

Drop a `fixtures/compliance/<locale>.json` file mapping local
regulator clauses to the EU regulation they implement (PSD2, AMLD5,
DORA, Solvency II, IDD, the EU AI Act, the Consumer Credit
Directive):

```jsonc
{
  "locale": "PL-PL",
  "nationalRegulator": {
    "code": "KNF",
    "name": "Komisja Nadzoru Finansowego",
    "country": "Poland"
  },
  "citations": [
    {
      "local":      "Ustawa o usługach płatniczych art. 32a",
      "localTopic": "Strong customer authentication",
      "euTarget":   "PSD2 (Directive (EU) 2015/2366) art. 97"
    }
    // …
  ]
}
```

### 5. Hard gates and CI

The Issue #2188 G13 gate — `G13_LOCALE_CALIBRATION_HEALTHY` — runs
once per locale and verifies four invariants:

1. **κ ≥ 0.7** (Issue #2109 inter-rater agreement)
2. **held-out ECE ≤ 0.10** (Issue #2107 per-class ECE thresholds)
3. **sample count ≥ 30** (Issue #2188 minimum gold-set size)
4. **no `fallbackToDefault`** (a per-locale entry that copied the
   aggregate curve is not a healthy locale-specific fit)

Any locale failing one of these invariants fails the gate
independently of the others. The audit-dossier renders a per-locale
health table populated from the same data so auditors can see the
status of every locale at a glance.

## Out-of-scope

- Translating the harness UI / CLI strings to the new locales.
- Adding new regulators outside the EU.
- Auto-translation of test cases between locales (machine translation
  is unsafe for regulated content).

## Code surface map

- `src/contracts/index.ts` — `SupportedLocale` union (eleven locales).
- `src/test-intelligence/locale-calibration.ts` — `SUPPORTED_LOCALES`,
  `isSupportedLocale`, `deriveLocaleFromScreen`, IBAN-prefix +
  primary-tag + keyword heuristics.
- `src/test-intelligence/locale-calibration-health.ts` — G13 gate.
- `src/test-intelligence/audit-dossier.ts` — emits the
  `localeCalibrationHealth` manifest section.
- `fixtures/test-intelligence/per-locale-calibration/<locale>.figma.json`
  — minimal Figma JSON fixture per locale (smoke-tested by
  `locale-calibration.test.ts`).
- `fixtures/test-intelligence/locale-calibration/<locale>/` — per-locale
  gold set and Platt-curve artifact.
- `fixtures/test-intelligence/terminology/<locale>.json` — terminology
  glossary.
- `fixtures/compliance/<locale>.json` — regulator citation map.
