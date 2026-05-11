# Tenant Bundles (BYO-rubric / BYO-guidelines)

> **Issue #2184** — Customer banks and insurers register their own
> naming conventions, compliance house standards, design-system tokens,
> terminology glossaries, and customer-eval rubric references through a
> JSON **tenant bundle** that is loaded per run via the
> `--tenant-bundle <path>` CLI flag.

## Why

Tier-1 banks and insurers have internal standards that do not match the
harness defaults:

- Test-case-title naming conventions (`TC-<module>-<nnn>` for one
  Sparkasse vs `TST_<region>_<seq>` for another).
- Risk-class taxonomies (one bank's "regulated" ≠ another's
  "regulated").
- Compliance house standards with their own clause numbers and
  cross-references.
- Design-system tokens (Figma variable mappings — `color.brand.primary`
  vs `--ds-color-brand-primary`).
- Terminology glossaries — German banking terms vary by Sparkasse,
  Genossenschaft, and Großbank.

Without a tenant bundle the only customer-customizable inputs are
`--custom-context-markdown` (Jira / spec context per run),
`--customer-eval-markdown` (eval rubric per run), and the fixed
`eu-banking-default` policy profile. Customers that cannot bring their
own standards will not adopt the harness in production.

## What the bundle defines

A tenant bundle is a JSON file conforming to the `TenantBundleInput`
type. The **hard allow-list** below is the customer-facing contract
surface — any field outside the list is rejected with exit code 1
before the LLM is ever called.

```ts
export interface TenantBundleInput {
  readonly tenantId: string;                 // [a-z0-9][a-z0-9_-]{0,63}
  readonly bundleVersion: string;            // semver, e.g. "1.0.0"
  readonly inheritsFromPolicyProfile?: string; // defaults to "eu-banking-default"
  readonly testCaseNamingConvention?: NamingConvention;
  readonly riskClassTaxonomy?: readonly RiskClassOverride[];
  readonly complianceHouseStandards?: readonly HouseStandardEntry[];
  readonly designSystemTokens?: readonly DesignSystemBinding[];
  readonly terminologyGlossary?: readonly TerminologyEntry[];
  readonly customerEvalRubric?: CustomerEvalRubricRef;
}
```

## Override surfaces today (additive only)

The bundle's runtime effect is intentionally **additive**:

- `riskClassTaxonomy[].mode === "review_only"` extends the base
  profile's `reviewOnlyRiskCategories`. A customer **cannot** weaken
  the base policy's review surface — the merge never removes an
  existing review-only category.
- `terminologyGlossary` flows into the prompt compiler's
  `[5] CustomerDomainContext` section so generated test cases use the
  customer's preferred terms.
- `testCaseNamingConvention`, `complianceHouseStandards`,
  `designSystemTokens`, and `customerEvalRubric` are recorded on
  `tenant-bundle-resolved.json` for audit reconstruction and shown in
  the audit dossier's *Customer-Specific Configuration* section.

Future numeric or gate-mode overrides will route through the same
resolver and trip the hard **safety floors** below if they ever try to
weaken the base policy:

| Field                                     | Direction | Rationale                                                                |
| ----------------------------------------- | --------- | ------------------------------------------------------------------------ |
| `rules.minConfidence`                     | minimum   | needs-review escalation must not be weakened.                            |
| `rules.fieldCoverageRatioMin`             | minimum   | logic-judge coverage hard-gate floor.                                    |
| `rules.actionCoverageRatioMin`            | minimum   | logic-judge coverage hard-gate floor.                                    |
| `rules.negativeCaseLift.thresholdRatio`   | minimum   | adversarial-critic lift floor.                                           |
| `rules.duplicateSimilarityThreshold`      | maximum   | duplicate threshold is a ceiling — raising it lets near-duplicates pass. |

A safety-floor violation aborts the run with
`TENANT_BUNDLE_SAFETY_FLOOR_VIOLATION` before any LLM call is made.

## Multi-tenant isolation

A tenant bundle is **tenant-scoped** (Issue #2176, W6-2). When the run
operates inside `withTenantScope(...)`, the resolver asserts
`bundle.tenantId === activeScope.tenantId` and throws
`TenantIsolationViolation` on mismatch — the run aborts, the operator
is paged, and the misconfigured tenant must be isolated before the
next run. Single-tenant CLI use (no active ALS scope) does not engage
this check.

## CLI

```bash
workspace-dev test-intelligence run \
  --figma-url https://www.figma.com/file/... \
  --tenant-bundle ./acme-bank.bundle.json \
  --customer-eval-markdown ./acme-bank.rubric.md
```

Constraints:

- **256 KiB** hard cap on the JSON file (stat'd before reading).
- The bundle is JSON-parsed, allow-list-validated, and canonicalized
  before any LLM call.
- Omitting `--tenant-bundle` runs with the default
  `eu-banking-default` profile and emits no
  `tenant-bundle-resolved.json` — the dossier shape stays
  backwards-compatible.

## Artifacts

On every run that loads a bundle the runner emits:

- `tenant-bundle-resolved.json` (canonical-JSON, content-hashed) under
  the per-run artifact directory. Contains the canonical bundle, the
  resolved override list, and the certification line.
- The audit dossier picks the artifact up automatically (kind:
  `tenant_bundle_resolved`) and renders a *Customer-Specific
  Configuration* section in the PDF.

## Example — Banking bundle (`acme-bank.bundle.json`)

```json
{
  "tenantId": "acme-bank",
  "bundleVersion": "1.0.0",
  "inheritsFromPolicyProfile": "eu-banking-default",
  "testCaseNamingConvention": {
    "id": "TC-{module}-{nnn}",
    "template": "TC-{module}-{nnn}: {summary}",
    "description": "Module-coded test-case ids per Anti-Fraud Working Group Note 2024-03."
  },
  "riskClassTaxonomy": [
    {
      "riskCategory": "regulated_data",
      "customerLabel": "BAIT-Sensitive",
      "mode": "review_only"
    },
    {
      "riskCategory": "financial_transaction",
      "customerLabel": "PSD2-Strong-Customer-Auth",
      "mode": "review_only"
    }
  ],
  "complianceHouseStandards": [
    {
      "clauseId": "HS-AB-007",
      "description": "All booking flows must trace to anti-fraud register entry §4.2.",
      "externalRef": "https://wiki.acme-bank.example/standards/HS-AB-007"
    }
  ],
  "designSystemTokens": [
    {
      "tokenId": "color.brand.primary",
      "customerBinding": "--acme-color-brand-primary",
      "family": "acme-ds"
    }
  ],
  "terminologyGlossary": [
    {
      "term": "Buchung",
      "definition": "Booking record posted to the customer's account ledger.",
      "locale": "de"
    },
    {
      "term": "Mandate",
      "definition": "SEPA direct-debit authorisation between debtor and creditor.",
      "locale": "de"
    }
  ],
  "customerEvalRubric": {
    "path": "fixtures/acme-bank/eval-rubric.md"
  }
}
```

## Example — Insurance bundle (`mutual-insurance.bundle.json`)

```json
{
  "tenantId": "mutual-insurance",
  "bundleVersion": "0.3.1",
  "inheritsFromPolicyProfile": "eu-banking-default",
  "testCaseNamingConvention": {
    "id": "MI-CLAIM-{nnn}",
    "description": "Claims flows use the MI-CLAIM prefix; non-claims flows use MI-OPS."
  },
  "riskClassTaxonomy": [
    {
      "riskCategory": "regulated_data",
      "customerLabel": "Solvency-II-Sensitive",
      "mode": "review_only"
    },
    {
      "riskCategory": "high",
      "customerLabel": "Claims-High-Exposure",
      "mode": "review_only"
    }
  ],
  "complianceHouseStandards": [
    {
      "clauseId": "EIOPA-GL-7",
      "description": "IDD claims-handling guideline 7 — fair-treatment evidence."
    },
    {
      "clauseId": "MI-INT-CLM-003",
      "description": "Internal claims SOP: 24h SLA evidence required on every claim path."
    }
  ],
  "designSystemTokens": [
    {
      "tokenId": "icon.claim-status",
      "customerBinding": "claim-status-icon",
      "family": "mutual-ds"
    }
  ],
  "terminologyGlossary": [
    {
      "term": "Anspruch",
      "definition": "Insurance claim filed by a policyholder under a covered peril.",
      "locale": "de"
    },
    {
      "term": "Police",
      "definition": "Policy document binding insurer to risk coverage.",
      "locale": "de"
    },
    {
      "term": "Schaden",
      "definition": "Loss event reported under a policy.",
      "locale": "de"
    }
  ]
}
```

## Authoring checklist

- [ ] `tenantId` is non-PII and stable (e.g. customer org id).
- [ ] `bundleVersion` follows semver — bump for every audited change.
- [ ] `inheritsFromPolicyProfile` matches the policy profile loaded by
      the run (default: `eu-banking-default`).
- [ ] No top-level fields outside the hard allow-list.
- [ ] Glossary terms are deduped (same `term` + `locale` is rejected).
- [ ] House standards have unique `clauseId`s.
- [ ] Bundle file is **≤ 256 KiB**.
- [ ] Store the bundle in version control next to the rubric — the
      dossier records its content hash for audit replay.
