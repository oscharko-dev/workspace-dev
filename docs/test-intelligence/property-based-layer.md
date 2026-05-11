# Property-based test layer with a domain-invariant registry

> Issue [#2040](https://github.com/oscharko/workspace-dev/issues/2040) —
> contract bump 4.54.0 (`TEST_INTELLIGENCE_CONTRACT_VERSION` 1.15.0).

The property-based test layer enforces domain rules — "VAT is never applied
to a Netto base", "principal − down payment = financing need (VAT excluded)",
etc. — as **typed predicates** that the validation pipeline evaluates
against generated test cases. Until the registry shipped, these rules were
encoded only as prose in the customer eval rubric, which means the LLM was
*asked* to honour them. With the registry in place, the rules are
*enforced*: a generated case that violates an invariant is rejected before
it reaches the policy gate.

## Design contract

The registry exposes a small, deterministic DSL:

```ts
import {
  buildActiveDatasetInvariantRegistry,
  evaluateInvariants,
  type DomainInvariant,
} from "workspace-dev";

const registry = buildActiveDatasetInvariantRegistry();
registry.register({
  id: "INV-EXAMPLE-01",
  scope: "active-dataset.example",
  description: "Total cost must equal principal + interest, rounded to 2 decimals.",
  source: "Issue #2040 (registered)",
  severity: "error",
  forall: (testCase, ctx) => mentionsTotalCost(testCase),
  holds: (testCase, ctx) => totalCostEqualsPrincipalPlusInterest(testCase, ctx),
});

const evaluation = evaluateInvariants({
  registry,
  testCases: list.testCases,
  context: { intent, model },
});
```

Every invariant carries six fields — `{ id, scope, forall, holds, severity,
source }` — plus an optional `description` and an optional
`violationMessage` factory. The `forall` predicate is the **scope filter**:
it answers "does this invariant apply to this case?". The `holds`
predicate is the **safety check**: it answers "is the invariant satisfied?"
A `forall === true` match with `holds === false` raises a violation.

The validation pipeline picks up the registry by default; pass
`{ invariantRegistry: null }` to disable, or override with a custom registry
to extend the active-dataset set.

### How violations surface

| Artifact | Field | Behaviour |
| --- | --- | --- |
| `validation-report.json` | `issues[*].code` | `domain_invariant_violation` with the per-case JSONPath |
| `validation-report.json` | `blocked` | flips to `true` when at least one violation is `severity: "error"` |
| `coverage-report.json` | `invariantCoverage` | `{ total, exercised, ratio, registeredIds, exercisedIds }` |
| `coverage-report.json` | `invariantAnnotations` | per-case `exercises: ["INV-VAT-01", ...]` mapping |
| `policy-report.json` | `blocked` | inherits the validation block; the policy gate sees the issues with their original codes |

The validation report is the source of truth for individual violations; the
coverage report aggregates across the run for dashboards and CI gates.

## Active-dataset invariants

The Wave-2 active dataset ships four invariants — all loaded automatically
by `buildActiveDatasetInvariantRegistry()`:

### `INV-VAT-01` — VAT exclusion on the financing-need calculation

When the test-design model excludes VAT from the financing-need
calculation (detected by the existing
[`calculation-constraints`](../../src/test-intelligence/calculation-constraints.ts)
module), no generated case may include VAT in the financing-need result.
The invariant supplements the documented G5 hard gate: prose still steers
the prompt, the typed predicate fails closed.

### `INV-NETTO-BRUTTO-01` — brutto/netto exclusivity

A single expected-result string must not present a result simultaneously
as Netto and Brutto. The two bases are mutually exclusive for the same
value; presenting both in one line typically signals an LLM hallucination
where the model conflated the inputs.

### `INV-OPTIONAL-COST-01` — optional-cost-field semantics

Optional cost fields (e.g. *Versandgebühr*) are absent unless explicitly
selected. A case that mentions an optional cost in an expected-result
must declare that the cost was selected in `preconditions` or in a step
action/data — otherwise the case is rejected.

### `INV-FINANCING-NEED-01` — financing-need formula bounds

The expected financing-need total must equal the VAT-excluded sum of the
bounded inputs declared on the active screen, rounded to two decimals.
The invariant defers numeric verification to
`detectCalculationConstraintViolation`, which computes the VAT-excluded
amount from the screen elements and rejects any expected total that
strays by more than half a cent.

## EU banking + insurance compliance invariants (Issue [#2108])

[#2108]: https://github.com/oscharko/workspace-dev/issues/2108

Issue [#2108] grew the catalog from the four Issue #2040 active-dataset
invariants to **20 default-on invariants** covering the EU banking and
insurance frameworks the `eu-banking-default` profile targets. Each new
invariant carries a mandatory `legalSource` citation
(`{ framework, citation, url? }`) so auditors can trace every predicate
back to the article that justifies it. Registration is automatic —
`buildActiveDatasetInvariantRegistry()` returns a registry pre-populated
with both Wave-2 and Issue #2108 invariants, and the validation
pipeline uses it by default for the `eu-banking-default` profile.

Each Issue #2108 invariant ships at least one positive and one negative
fixture in [`domain-invariant-registry.test.ts`](../../src/test-intelligence/domain-invariant-registry.test.ts);
the [`eingabemasken-fixtures`](../../src/test-intelligence/eingabemasken-fixtures.ts)
benchmark also pins the per-fixture invariant set so a regression that
hides an invariant from a regulatory mask is caught before it ships.

Severity is `error` for hard regulatory rules (PSD2 SCA, MiFID II
suitability, GwG PEP screening, GDPR Art. 9 explicit consent, IDD
demands-and-needs, EAA keyboard-only) and `warning` for soft / disclosure
rules (AML cumulative aggregation, DORA register flag, GDPR Art. 15-22
right-of-access surface, Solvency II cooling-off, FX-margin disclosure,
KYC age-gate, VAG Beratungsprotokoll).

To prevent false-positive firing on synthesized field-level stubs, the
Issue #2108 invariants gate `forall` on the case's `riskCategory`: only
cases the policy gate considers regulated (`regulated_data`,
`financial_transaction`, `high`) reach the compliance predicate. The
EAA accessibility invariant additionally accepts `low` so a11y cases on
payment screens still surface keyboard-only gaps.

| ID | Severity | Framework | Citation |
| --- | --- | --- | --- |
| `INV-PSD2-SCA-01` | error | PSD2 | Directive (EU) 2015/2366 Art. 97 + RTS 2018/389 Art. 1, 4 |
| `INV-PSD2-DYNLINK-01` | error | PSD2 | Commission Delegated Regulation 2018/389 (RTS on SCA) Art. 5 |
| `INV-MIFID-SUITAB-01` | error | MiFID II | Directive 2014/65/EU Art. 25(2) + Delegated Reg. 2017/565 Art. 54 |
| `INV-MIFID-APPROP-01` | error | MiFID II | Directive 2014/65/EU Art. 25(3) |
| `INV-MIFID-COSTS-01` | error | MiFID II | Directive 2014/65/EU Art. 24(4) + Delegated Reg. 2017/565 Art. 50 |
| `INV-GWG-PEP-01` | error | GwG / 5AMLD | GwG §§ 10, 15 + Directive (EU) 2018/843 |
| `INV-AML-CUMUL-01` | warning | AMLD | Directive (EU) 2015/849 Art. 11(c) |
| `INV-DORA-ICT-01` | warning | DORA | Regulation (EU) 2022/2554 Art. 28, 29 |
| `INV-GDPR-ART9-01` | error | GDPR | Regulation (EU) 2016/679 Art. 9(2)(a) |
| `INV-GDPR-ART15-01` | warning | GDPR | Regulation (EU) 2016/679 Art. 12-22 |
| `INV-IDD-DEMANDS-01` | error | IDD | Directive (EU) 2016/97 Art. 20(1) |
| `INV-SOLV2-COOLOFF-01` | warning | Solvency II / DMD | Directive 2002/65/EC Art. 6 + 2009/138/EC Art. 185 |
| `INV-FX-MARGIN-01` | warning | Cross-Border Payments Reg. | Regulation (EU) 2019/518 Art. 3a + PSD2 Art. 45 |
| `INV-KYC-AGE-01` | warning | BGB / MiFID II | BGB §§ 104-113 + MiFID II Art. 25 |
| `INV-EAA-KBD-01` | error | European Accessibility Act | Directive (EU) 2019/882 Annex I §III + EN 301 549 §9.2.1.1 |
| `INV-VAG-BERATUNG-01` | warning | VVG / WpHG | VVG § 6, § 6a + WpHG § 64 |

## Property-based sampler

The registry pairs with a deterministic sampler in
[`property-sampler.ts`](../../src/test-intelligence/property-sampler.ts):

```ts
import {
  buildActiveDatasetInvariantRegistry,
  sampleInvariantSeeds,
} from "workspace-dev";

const registry = buildActiveDatasetInvariantRegistry();
const seeds = sampleInvariantSeeds({ registry });

for (const seed of seeds.seeds) {
  console.log(seed.invariantId, seed.precondition, "→", seed.expected);
}
```

Each invariant with a registered sampler factory yields up to `runs`
`(precondition, expected)` pairs that the LLM can be required to
*reproduce or extend*. The sampler is byte-deterministic (default
`seed = 0x2040_a07a`, `runs = 8`), so the seed list never destabilises a
replay-cache key.

Invariants without a registered factory are skipped — the registry-driven
validation still applies; only the sampler-side enrichment is optional.
The Issue #2108 EU banking + insurance compliance invariants are
text- and citation-driven (rather than numeric) and intentionally skip
the sampler: the predicate fires on case content, not on numeric
boundary samples.

## Worked invariants — banking + insurance

The active-dataset registry lives in the financing space; the same DSL
applies to other regulated domains. Two worked examples:

### Banking — IBAN-checksum validation (single screen)

```ts
registry.register({
  id: "INV-IBAN-01",
  scope: "banking.iban",
  description:
    "An IBAN field that fails ISO 13616 checksum validation must surface a structured rejection, not silently accept the value.",
  source: "Issue #2040 (registered, banking example)",
  severity: "error",
  forall: (testCase) =>
    /\bIBAN\b/i.test(JSON.stringify(testCase)),
  holds: (testCase) =>
    testCase.expectedResults.some((line) =>
      /reject(s|ed)?|invalid|wrong checksum|fehlerhaft/i.test(line),
    ),
});
```

### Insurance — policy-effective-date precedes claim date

```ts
registry.register({
  id: "INV-POLICY-DATE-01",
  scope: "insurance.policy-effective-date",
  description:
    "A claim against a policy must reference an effective date that precedes the claim date by at least one day.",
  source: "Issue #2040 (registered, insurance example)",
  severity: "error",
  forall: (testCase) =>
    /\bclaim\b/i.test(testCase.title) || /\bclaim\b/i.test(testCase.objective),
  holds: (testCase) =>
    !testCase.expectedResults.some((line) =>
      /effective(?: date)?\s*(?:>=|>|≥)\s*claim/i.test(line),
    ),
});
```

Both invariants compose with the active-dataset set — register them on
the registry returned by `buildActiveDatasetInvariantRegistry()` and the
validation pipeline will pick them up on the next run.

## Out-of-scope (Wave-2)

- Auto-discovery of invariants from source documents (manual registration
  initially; ML-based extraction is a Wave-4 candidate).
- SMT-solver-based exhaustive proof of invariants (sample-based first).
- Cross-tenant invariant repositories (single repo for now).

## Pairing with B.4 — mutation testing

A property-based layer feeds directly into mutation testing: the sampler
output (concrete `(precondition, expected)` pairs anchored to invariant
ids) doubles as the **specification a mutated SUT must violate**.
A mutation that passes a property-anchored seed is a real false-negative
in the test suite; a mutation that fails it is a real kill.

## Pairing with B.6 — compliance-as-code

Regulatory rules can lower into invariants where they are formalisable.
The DSL deliberately mirrors the structure of regulatory specifications —
*for all subjects in scope, the property must hold* — so a future
compliance-as-code pipeline can register invariants directly from a
machine-readable rule library.
