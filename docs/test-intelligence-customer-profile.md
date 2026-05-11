# Customer Profile API — Test Intelligence

> Issue #1946. Part of the DORA Art. 9 compliance surface for the EU Banking
> policy profile (`eu-banking-default`).

Operators running the test-intelligence pipeline under the EU Banking default
policy can supply an optional **customer profile** that:

1. Provides the ICT-Register-Ref required by DORA Art. 9 so the
   `policy:ict-register-ref-required` gate no longer fires.
2. Injects customer-specific domain context (glossary, risk taxonomy,
   policy overrides, few-shot examples) into the `[5] CustomerDomainContext`
   section of the compiled prompt.

All free-text fields are run through the same PII-redaction +
prompt-injection-scrub pipeline as `--custom-context-markdown` before any
LLM call is dispatched.

---

## Schema reference

```ts
customerProfile?: {
  /** DORA Art. 9 ICT-Register reference (e.g. "ICT-REF-42"). */
  ictRegisterRef?: string;

  /** Customer-specific domain terms injected into the prompt glossary. */
  glossary?: { term: string; definition: string }[];

  /** Per-risk-class weight overrides for the risk ranker. */
  riskTaxonomyOverrides?: { class: string; weight: number }[];

  /** Policy rule severity overrides (must use existing ruleIds). */
  policyOverrides?: { ruleId: string; severity: "error" | "warning" | "info" }[];

  /** Labelled examples shown to the model as few-shot guidance. */
  fewShotExamples?: {
    caseTitle: string;
    description: string;
    technique: string;
  }[];
}
```

All fields are optional. An empty profile `{}` is valid; the policy gate
continues to fire as before (current behaviour is preserved).

---

## CLI usage

```bash
workspace-dev test-intelligence run \
  --figma-url "https://www.figma.com/design/<FILE_KEY>/<VIEW>?node-id=<NODE>" \
  --output ./ti-output \
  --mode deterministic_llm \
  --customer-profile ./profile.json
```

### Example profile.json

```json
{
  "ictRegisterRef": "ICT-REF-2026-BANKING-PROD",
  "glossary": [
    {
      "term": "IBAN",
      "definition": "International Bank Account Number (ISO 13616)"
    },
    {
      "term": "BIC",
      "definition": "Bank Identifier Code used for SEPA transfers"
    }
  ],
  "riskTaxonomyOverrides": [
    { "class": "credit_risk", "weight": 0.95 },
    { "class": "market_risk", "weight": 0.7 }
  ],
  "policyOverrides": [
    { "ruleId": "policy:open-questions-excessive", "severity": "warning" }
  ],
  "fewShotExamples": [
    {
      "caseTitle": "IBAN boundary — maximum length",
      "description": "Verify the system accepts a 34-character IBAN without truncation.",
      "technique": "boundary_value_analysis"
    }
  ]
}
```

The `--customer-profile` flag is rejected with exit code 1 if:

- The file is missing or not a regular file.
- The raw file exceeds 256 KiB.
- The JSON is malformed.
- Any field fails schema validation (e.g. `severity` not in
  `["error", "warning", "info"]`).
- Any free-text field contains content rejected by the PII-redaction or
  prompt-injection pipeline (e.g. raw HTML tags).

The dry_run summary line includes:

```
  customer prof : loaded (N bytes)
```

---

## Behaviour in the production runner

### ICT-Register-Ref inheritance (DORA Art. 9)

Each active model binding is checked for `ictRegisterRef` before the
policy gate runs. Any binding that lacks its own ref **inherits**
`customerProfile.ictRegisterRef` at this point. The input is never mutated
— new binding objects are derived.

This means:

- If ALL bindings carry their own `ictRegisterRef`, the profile ref is
  ignored (it is not overwritten).
- If ANY binding lacks a ref but the profile supplies one, that binding
  inherits it and the gate no longer fires for it.
- If ANY binding lacks a ref AND the profile is absent or has no ref, the
  existing `policy:ict-register-ref-required` violation is emitted as
  before.

### Prompt rendering

The customer profile is canonicalized and rendered as deterministic Markdown
before prompt compilation. The rendered block is appended to the
`[5] CustomerDomainContext` section (after any `--custom-context-markdown`
body). Subsections are always emitted in this stable order when content is
present:

1. `## Glossary` — alphabetically by term
2. `## Risk Taxonomy Overrides` — alphabetically by class
3. `## Policy Overrides` — alphabetically by ruleId
4. `## Few-Shot Examples` — alphabetically by caseTitle

This ordering is deterministic: identical profiles produce identical prompt
bytes and therefore identical replay-cache keys.

---

## Security model

### Size cap

The CLI enforces a **256 KiB hard cap** on the raw JSON file before it is
even read into memory. Files larger than `256 * 1024` bytes are rejected
with exit code 1 and the pipeline never reads the body.

The same cap is exported as `MAX_CUSTOMER_PROFILE_BYTES` from
`src/test-intelligence/customer-profile-input.ts`.

### PII redaction

All free-text fields (`glossary.definition`, `fewShotExamples.caseTitle`,
`fewShotExamples.description`) are passed through the same PII-detection
pipeline used for `customContextMarkdown`. The following patterns are
redacted before the value is stored in the canonical form or sent to the LLM:

| Pattern | Redaction token |
|---------|----------------|
| IBAN | `[REDACTED:IBAN]` |
| BIC / SWIFT | `[REDACTED:BIC]` |
| Payment card (PAN) | `[REDACTED:PAN]` |
| Email address | `[REDACTED:EMAIL]` |
| Phone number | `[REDACTED:PHONE]` |
| German tax ID | `[REDACTED:TAX_ID]` |
| Full name (heuristic) | `[REDACTED:FULL_NAME]` |
| Internal hostname | `[REDACTED:INTERNAL_HOSTNAME]` |
| Postal address | `[REDACTED:POSTAL_ADDRESS]` |
| Date of birth | `[REDACTED:DOB]` |
| Account number | `[REDACTED:ACCOUNT_NUMBER]` |
| National ID | `[REDACTED:NATIONAL_ID]` |
| Special-category data | `[REDACTED:SPECIAL_CATEGORY]` |

The **raw input is never written to any log, artifact, or LLM prompt**.
Only the redacted canonical form is used downstream.

### Prompt-injection defenses

Free-text fields are canonicalized via `canonicalizeCustomContextMarkdown`,
which rejects:

- Raw HTML tags (e.g. `<script>`, `<b>`, `<style>`)
- MDX imports / exports
- Mermaid / diagram code fences
- Unsafe URLs (javascript:, data:, internal hostnames, RFC-1918 IPs)
- Frontmatter blocks

A field that triggers any of these checks causes the whole profile to be
rejected with `CUSTOMER_PROFILE_INVALID` and the job fails fast with exit
code 1 (CLI) or `ProductionRunnerError` (programmatic callers), before any
LLM call is dispatched.

The rendered Markdown block is surfaced in the prompt inside the
`<UNTRUSTED_CUSTOM>` tag inherited from the `[5] CustomerDomainContext`
section so the model is instructed to treat it as data, never as
instructions.

### No mutation of LLM gateway client config

ICT-Register-Ref inheritance creates **new** binding objects via object
spread. The original `LlmGatewayClient` structs passed by the caller are
never mutated.

### Deterministic ordering & content hashing

Arrays are sorted before the canonical form is hashed:

- `glossary` → by `term` (locale-aware ascending)
- `riskTaxonomyOverrides` → by `class`
- `policyOverrides` → by `ruleId`
- `fewShotExamples` → by `caseTitle`

The `contentHash` field on `CanonicalCustomerProfile` is a SHA-256 hex
digest of the sorted, canonicalized profile. It is used as part of the
replay-cache key so two profiles that differ only in array order still
produce identical cache keys.

---

## Compliance note — DORA Art. 9

DORA Article 9 requires financial entities to maintain an ICT-Register
mapping every active model binding to a register reference. The
`policy:ict-register-ref-required` rule (EU Banking default policy profile)
enforces this by blocking any run where a binding is missing the ref.

The `customerProfile.ictRegisterRef` field provides a **profile-level
fallback** so operators can declare a single register reference that applies
to all bindings for a given run, without having to modify each
`LlmGatewayClient` configuration individually.

To confirm the inheritance is working, look for the absence of a
`ict_register_ref_required` entry in the policy report
(`<output>/policy-report.json` → `jobLevelViolations`).

---

## Programmatic usage

```ts
import { runFigmaToQcTestCases } from "workspace-dev/test-intelligence";

const result = await runFigmaToQcTestCases({
  jobId: "my-job",
  generatedAt: new Date().toISOString(),
  source: { kind: "figma_url", figmaUrl: "...", accessToken: "..." },
  outputRoot: "./output",
  llm: { client: myGatewayClient },
  customerProfile: {
    ictRegisterRef: "ICT-REF-2026-BANKING-PROD",
    glossary: [
      { term: "IBAN", definition: "International Bank Account Number" },
    ],
    fewShotExamples: [
      {
        caseTitle: "IBAN boundary — max length",
        description: "Verify the system accepts a 34-character IBAN.",
        technique: "boundary_value_analysis",
      },
    ],
  },
});
```

The `customerProfile` field accepts the raw `CustomerProfileInput` shape.
The runner canonicalizes it internally and throws `ProductionRunnerError`
with `failureClass: "CUSTOMER_PROFILE_INVALID"` if validation fails.

---

## Module reference

| Symbol | Location | Description |
|--------|----------|-------------|
| `CustomerProfileInput` | `src/test-intelligence/customer-profile-input.ts` | Raw input type (matches schema above) |
| `CanonicalCustomerProfile` | same | Post-canonicalization shape with `contentHash` |
| `CustomerProfileIssue` | same | Structured validation error (`path` + `message`) |
| `MAX_CUSTOMER_PROFILE_BYTES` | same | `256 * 1024` |
| `parseAndCanonicalizeCustomerProfile` | same | Parse + validate + canonicalize a raw JSON string |

All symbols are also re-exported from `src/test-intelligence/index.ts`.
