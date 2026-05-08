# Compliance-as-code rule packs

Status: shipped (Issue #2042, Wave 3 innovation roadmap).

The compliance-as-code rule packs encode European banking and insurance
regulatory obligations as machine-readable YAML/TypeScript files.
Generated test cases are scanned by the deterministic
`compliance_annotator` service which attaches an `appliesTo` list of
matched rule IDs and emits a per-framework / per-article coverage
report alongside the run's other artifacts.

## Why

Auditors (BaFin, EIOPA, internal compliance) ask “show me coverage per
regulation”. Without a structured rule set, that mapping is a manual
exercise. Rule packs make the mapping reproducible, testable, and
auditable; they also unlock automated regression detection when a
regulation changes.

## Shipped frameworks

| Framework id | Title | Domain |
| --- | --- | --- |
| `PSD2` | Payment Services Directive 2 | banking |
| `MIFID_II` | Markets in Financial Instruments Directive II | banking |
| `IDD` | Insurance Distribution Directive | insurance |
| `SOLVENCY_II` | Solvency II | insurance |
| `DORA` | Digital Operational Resilience Act | banking + insurance |
| `EU_AI_ACT` | EU AI Act (high-risk obligations) | banking + insurance |
| `GDPR` | General Data Protection Regulation | banking + insurance |

Each rule has:

- **`id`** — stable identifier (e.g. `PSD2-SCA-Art-97`).
- **`citation`** — human-readable regulation reference.
- **`description`** — what the rule asks of the test suite.
- **`domain`** — `banking`, `insurance`, or `both`.
- **`mandatoryTestClasses`** — the `GeneratedTestCase.type` values that
  satisfy the rule. A case applies to the rule iff one of its keywords
  matches the case content; the case _satisfies_ the rule iff its
  type is in this list.
- **`severity`** — `error` (uncovered → audit-grade run flagged) or
  `warning` (recorded in the report but not blocking).
- **`keywords`** — case-insensitive substrings the annotator uses to
  decide whether a generated test case applies to the rule.

## Schema validation

Rule packs are validated at module load with Zod. Adding a malformed
file raises a `TypeError` at import time so the harness cannot ship
with an invalid rule pack. The schema lives in
`src/test-intelligence/compliance-rules.ts` and is the single source
of truth for the on-disk shape.

## CLI usage

```sh
# Default: derived from the policy profile (eu-banking-default activates all 7)
workspace-dev test-intelligence run --figma-url https://...

# Explicit subset
workspace-dev test-intelligence run \
  --figma-url https://... \
  --compliance-frameworks PSD2,GDPR,DORA
```

Unknown framework tokens are rejected before any LLM call. Tokens are
case-insensitive and accept either `MIFID_II` or `MIFID-II` style.

## Artifacts

Two run artifacts are added to the run output directory:

- `compliance-annotations.json` — flat per-test-case `appliesTo` list
  plus per-rule match metadata (`framework`,
  `satisfiesMandatoryTestClass`).
- `compliance-coverage-report.json` — coverage ratio per framework,
  per-rule covered/uncovered status, and an aggregate
  `overallCoverageRatio`.

Both are byte-stable across reruns: identical inputs produce identical
canonical JSON.

## Customer Markdown

When the `complianceCoverage` field is supplied to
`renderCustomerMarkdown`, the combined Markdown gains a
"Compliance coverage" section listing the active frameworks, the
per-framework coverage ratio, and a per-rule covered/uncovered table.

## Worked examples

### PSD2 — Strong Customer Authentication (Article 97)

Rule: `PSD2-SCA-Art-97` requires the suite to cover successful
2-factor authentication and to refuse single-factor attempts on
regulated screens.

A generated test case titled
`Login mit OTP — erfolgreiche starke Kundenauthentifizierung` matches
the keywords `otp` / `starke kundenauthentifizierung` and satisfies the
rule because its type is `functional`. The negative-path case
`Login ohne OTP wird abgelehnt` matches the same keywords and is type
`negative`, also satisfying the rule.

### MiFID II — Suitability (Article 25(2))

Rule: `MIFID_II-Suitability-Art-25-2` requires `functional`,
`negative`, and `validation` coverage of the suitability
questionnaire. A case titled
`Geeignetheitsprüfung mit fehlenden Pflichtfeldern lehnt Empfehlung ab`
applies (keyword: `geeignetheit`) and satisfies because its type is
`validation`.

### IDD — Demands and Needs (Article 20)

Rule: `IDD-Demands-Needs-Art-20`. Case
`Bedarfsanalyse erfasst Wünsche und Bedürfnisse vollständig`
applies via keywords `bedarfsanalyse` / `wünsche und bedürfnisse` and
satisfies because its type is `functional`.

### Solvency II — SCR templates

Rule: `SOLVENCY_II-SCR-Templates-QRT`. Case
`SCR-QRT S.25 lehnt negative Eigenmittel-Eingaben ab` applies via
`scr` / `qrt` / `s.25` and is type `negative` — satisfies.

### DORA — Third-party ICT risk (Article 28)

Rule: `DORA-Third-Party-Art-28`. Case
`Auslagerungsvertrag ohne Ausstiegsklausel wird zurückgewiesen`
applies (keywords `auslagerung` / `ausstiegsklausel`) and is type
`boundary` — satisfies.

### EU AI Act — Human oversight (Article 14)

Rule: `EU_AI_ACT-Human-Oversight-Art-14`. Case
`Kreditentscheidung lässt sich übersteuern und wird protokolliert`
applies (keywords `übersteuerung`) and is type `functional` — satisfies.

### GDPR — Security of processing (Article 32)

Rule: `GDPR-Security-Art-32`. Case
`PII-Eingabe verhindert unredigierte Speicherung` applies (keywords
`pii` / `personenbezogene daten`) and is type `validation` — satisfies.

## Adding a new framework

1. Add a new file under `src/compliance-rules/<framework>.ts` exporting
   a `<NAME>_RULE_PACK` literal.
2. Append the framework id to `COMPLIANCE_FRAMEWORK_IDS` in
   `src/test-intelligence/compliance-rules.ts`.
3. Register the imported pack in `RULE_PACK_REGISTRY_OBJECT`.
4. Add a worked example below and update
   `DEFAULT_FRAMEWORKS_FOR_POLICY_PROFILE` if the framework should be
   active by default for the `eu-banking-default` policy profile.

The Zod schema rejects rule files that:

- duplicate a rule id within a pack,
- declare a rule id that does not begin with the framework prefix,
- declare an empty `mandatoryTestClasses` or `keywords` array,
- declare a rule id outside the `UPPER_KEBAB_CASE` constraint.

These checks fire at module load — no run-time degradation is
possible.

## Out of scope

- Real-time regulatory crawlers (manual rule curation initially; an
  active-listening service is a Wave 4 candidate).
- Country-specific extensions beyond the EU baseline (DACH first;
  FR/IT/ES follow).
- Automatic legal interpretation (rules are operational checks, not
  legal advice).
