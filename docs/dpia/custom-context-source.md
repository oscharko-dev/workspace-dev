# DPIA Addendum — Custom Context Source (Wave 4.E)

**Scope:** Data Protection Impact Assessment addendum for the free-form
Markdown and structured-attribute custom-context source introduced in Wave 4.
This document is engineering-grade input for the operator's DPO; it is not a
legal opinion or a substitute for the operator's own DPIA.

**Wave:** 4 (Issue #1431 — envelope contracts; Wave 4.E — custom context
ingestion routes and persistence).

**Last reviewed:** 2026-04-27

---

## 1. Purpose and context

The custom-context source allows a **reviewer** — authenticated via the same
bearer-token governance as the review-gate write routes — to supply
supplementary evidence for a test-intelligence job that already has at least
one primary Figma or Jira source. The custom context is supporting evidence
only; it cannot replace Figma or Jira as the source of test intent.

Two input channels are supported:

- **Markdown** (`custom_text` source kind, `inputFormat = "markdown"`) —
  reviewer-authored prose, lists, tables, and code fences in a strict
  allow-listed Markdown subset.
- **Structured attributes** (`custom_structured` source kind) — key/value
  pairs with canonical wire-format keys matching `^[a-z][a-z0-9_]{0,63}$`.

Both channels share the same bearer-protected ingestion route:

```
POST /workspace/test-intelligence/sources/<jobId>/custom-context
```

---

## 2. Data flows

```
Reviewer browser (Inspector UI)
        │  HTTP POST /workspace/test-intelligence/sources/<jobId>/custom-context
        │  { markdown: "...", attributes: [...] }
        ▼
  custom-context-input.ts         ← bearer auth, input validation
        │  validated input (in memory)
        ▼
  custom-context-markdown.ts      ← Markdown subset parse, PII redaction, canonicalization
  custom-context-store.ts         ← structured attribute normalization, PII redaction
        │  JiraIssueIr-style canonical objects (in memory)
        ▼
  <runDir>/sources/custom-context-markdown/custom-context.json
  <runDir>/sources/custom-context-structured/custom-context.json
```

The raw Markdown body and the original structured attribute values are never
written to disk. Only the PII-redacted canonical forms are persisted.

---

## 3. Persisted artifacts and their data categories

Schema version: `CUSTOM_CONTEXT_SCHEMA_VERSION = "1.0.0"`

### 3.1 `custom-context.json` (Markdown channel)

Source ID: `CUSTOM_CONTEXT_MARKDOWN_SOURCE_ID = "custom-context-markdown"`

| Field                               | Data category                        | Redaction guarantee                                                                        |
| ----------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `entries[].sectionPath`             | Markdown heading path (structural)   | Non-personal structural locator                                                            |
| `entries[].bodyPlain`               | PII-redacted plain-text derivative   | PII-redacted; derived from Markdown; raw Markdown not stored                               |
| `entries[].bodyMarkdown`            | Canonical allow-listed Markdown      | PII-redacted; raw hrefs replaced with `[url]`; private/link-local targets rejected         |
| `entries[].redactedMarkdownHash`    | SHA-256 of the canonical Markdown    | Non-personal; deterministic                                                                |
| `entries[].plainTextDerivativeHash` | SHA-256 of the plain-text derivative | Non-personal; deterministic                                                                |
| `entries[].redactionIndicators[]`   | PII kinds found and redacted         | No raw values; only kind/location                                                          |
| `authorHandle`                      | Bearer-principal identity            | Derived from the matched server-side principal; client-supplied author fields are rejected |
| `capturedAt`                        | Server-side UTC timestamp            | Server-generated; no client-supplied values trusted                                        |

**Not persisted:**

- Raw Markdown body (before parsing and redaction)
- Raw hrefs from links (replaced with `[url]` stubs)
- Any content that fails the Markdown allow-list check (raw HTML, SVG, iframe,
  script, `javascript:`/`data:` URLs, private/link-local HTTP targets, MDX/JSX,
  frontmatter, Mermaid/diagram execution, autolinked internal hosts)
- Bearer tokens or authentication credentials

### 3.2 `custom-context.json` (Structured attributes channel)

Source ID: `CUSTOM_CONTEXT_STRUCTURED_SOURCE_ID = "custom-context-structured"`

| Field                   | Data category                              | Redaction guarantee                                                                    |
| ----------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `attributes[]`          | Normalized key/value pairs                 | PII-redacted before persistence; keys canonicalized; values bounded to 256 UTF-8 chars |
| `contentHash`           | SHA-256 of the sorted canonical attributes | Non-personal; deterministic; order-invariant                                           |
| `redactionIndicators[]` | PII kinds found in attribute values        | No raw values                                                                          |
| `authorHandle`          | Bearer-principal identity                  | Derived server-side from bearer token                                                  |
| `capturedAt`            | Server-side UTC timestamp                  | Server-generated                                                                       |

---

## 4. Reviewer-author audit trail

The `authorHandle` on every custom-context artifact is derived exclusively
from the server-side bearer principal. Client-supplied author fields are
unsupported and silently ignored. This means:

- The identity of the reviewer who submitted the context is traceable from
  the artifact even if the Markdown or attribute content is later redacted.
- The `authorHandle` is bounded to `^[A-Za-z0-9._-]{1,64}$` and is not
  trusted as a free-form string.
- The principal binding is the same governance pattern used by the review-gate
  write routes (`review/<jobId>/<action>`).

---

## 5. Bearer-principal binding

The ingestion route refuses with `503` when the bearer token is not
configured, and with `401` when the token does not match any registered
principal. A custom-only envelope (no primary Figma or Jira source) is
refused with `primary_source_required` before any artifact is written.

This means a reviewer can only add custom context when:

1. The parent test-intelligence gate is enabled.
2. The multi-source gate is enabled.
3. A valid bearer token is configured on the server.
4. A primary source already exists for the job.
5. The submitting reviewer holds a matching bearer token.

---

## 6. Markdown data categories

Reviewer-authored Markdown may contain the following data categories:

| Markdown element             | Data category             | Handling                                                        |
| ---------------------------- | ------------------------- | --------------------------------------------------------------- |
| Headings                     | Structural (section path) | Preserved as-is                                                 |
| Paragraphs                   | Reviewer prose            | PII-redacted                                                    |
| Ordered/unordered lists      | Reviewer notes            | PII-redacted per item                                           |
| Task-list checkboxes         | Status markers            | Preserved                                                       |
| Tables                       | Structured data           | PII-redacted per cell                                           |
| Blockquotes                  | Reviewer annotations      | PII-redacted                                                    |
| Inline code and code fences  | Technical content         | PII-redacted                                                    |
| Links                        | URLs + link text          | `href` replaced with `[url]`; private/link-local hrefs rejected |
| Emphasis / strong            | Formatting                | Preserved                                                       |
| Raw HTML                     | Not supported             | **Rejected** with `html_not_allowed`                            |
| Images                       | Not supported             | **Rejected**                                                    |
| `javascript:` / `data:` URLs | Not supported             | **Rejected**                                                    |
| MDX/JSX                      | Not supported             | **Rejected**                                                    |
| Frontmatter                  | Not supported             | **Rejected**                                                    |

---

## 7. Data minimization controls (GDPR Art. 5(1)(c))

| Control                            | Implementation                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw Markdown not persisted         | The canonical redacted Markdown is the persistence unit; the raw input is discarded after parsing                                                                      |
| Markdown input byte cap            | `MAX_CUSTOM_CONTEXT_RAW_MARKDOWN_BYTES` enforced before parsing                                                                                                        |
| Canonical Markdown cap             | `MAX_CUSTOM_CONTEXT_CANONICAL_MARKDOWN_BYTES` enforced after parsing                                                                                                   |
| Per-job context byte budget        | `MAX_CUSTOM_CONTEXT_BYTES_PER_JOB = 256 KiB` enforced across all custom-context submissions for the job                                                                |
| Structured attribute count cap     | 1 to 64 entries                                                                                                                                                        |
| Attribute value length cap         | 256 UTF-8 characters per value                                                                                                                                         |
| No line breaks in attribute values | Enforced before persistence; newlines rejected with a validation error                                                                                                 |
| PII-redacted before persistence    | Full PII detection pipeline runs before any write; same pipeline as the Jira IR                                                                                        |
| Private/link-local URLs rejected   | `http://localhost`, `http://10.*`, `http://192.168.*`, `http://172.16-31.*`, `http://127.*`, `http://[::1]`, `http://0.*`, and link-local targets rejected fail-closed |

---

## 8. Policy signal: `custom_context_risk_escalation`

When a structured attribute with a recognized key indicates elevated data
sensitivity — for example `data_class=PCI-DSS-3`, `regulatory_scope=GDPR`,
or `regulatory_scope=PSD2` — the policy gate emits a
`custom_context_risk_escalation` signal. This signal:

- Escalates generated test cases from `generated` to `needs_review` in the
  review-gate state machine.
- Is recorded in `policy-report.json` for downstream review and for
  four-eyes review configuration.
- Does not block generation; it requires a human reviewer to approve before
  any case can be exported.

The operator can use this mechanism to ensure that test cases derived from
context that includes regulatory-scope or data-class signals receive
appropriate human review before they enter the QC workflow.

---

## 9. Security of processing (GDPR Art. 32)

| Concern                    | Implementation                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Bearer token governance    | Timing-safe SHA-256 comparison; `503` when unconfigured; `401` on mismatch                                                    |
| XSS / injection protection | Markdown allow-list enforced server-side; raw HTML, script tags, and `javascript:` URLs rejected before persistence           |
| Atomic persistence         | Artifacts written via `${pid}.${randomUUID()}.tmp` rename; partial writes never produce corrupt artifacts                     |
| Deterministic hashing      | `contentHash` values are canonical-JSON SHA-256; identical inputs always produce identical hashes so replay is byte-identical |
| No link expansion          | Link hrefs are replaced with `[url]` stubs; the server never fetches linked resources                                         |

---

## 10. Retention

The package does not delete artifacts. Retention is operator-controlled via
the `<artifactRoot>` path. The PII-redacted canonical Markdown and structured
attributes under `<artifactRoot>/<jobId>/sources/custom-context-*/` are the
only persisted representations; raw input is not recoverable from disk.

---

## 11. DPIA obligation assessment (GDPR Art. 35)

| Factor                    | Assessment                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Reviewer-authored prose   | May contain employee names, project names, or sensitive operational notes; PII-redacted before persistence                   |
| Tables and lists          | Structured reviewer content; same PII detection as prose                                                                     |
| Links                     | Hrefs replaced with `[url]` stubs; no URL content persisted                                                                  |
| Structured attributes     | Key/value pairs with known semantics; values PII-redacted                                                                    |
| Profiling                 | Not applicable                                                                                                               |
| Automated decision-making | The custom context is enrichment evidence fed to the test-case generation pipeline; human review gate required before export |

---

## 12. DPO escalation path

1. Review `<artifactRoot>/<jobId>/sources/custom-context-markdown/custom-context.json`
   and `sources/custom-context-structured/custom-context.json` for the
   `redactionIndicators[]` fields.
2. Review the `authorHandle` on each artifact to trace reviewer identity.
3. Review `policy-report.json` for `custom_context_risk_escalation` signals.
4. The full contract surface is in `CONTRACT_CHANGELOG.md` (Wave 4 range,
   versions `4.11.0`–`4.14.0`).

---

## 13. Cross-references

- `COMPLIANCE.md` — top-level DORA/GDPR/EU AI Act control mapping
- `docs/test-intelligence.md` §14 — Wave 4 multi-source gate
- `docs/runbooks/multi-source-air-gap.md` — reviewer guidance for Markdown editor in restricted environments
- `docs/dora/multi-source.md` — DORA mapping for the multi-source surface
- `CONTRACT_CHANGELOG.md` §4.11.0 — envelope contracts (Wave 4.A)
- `src/test-intelligence/custom-context-markdown.ts` — Markdown canonicalization
- `src/test-intelligence/custom-context-store.ts` — structured attribute persistence
