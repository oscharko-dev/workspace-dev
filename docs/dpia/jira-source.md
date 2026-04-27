# DPIA Addendum — Jira Source (Wave 4.B / 4.C / 4.D)

**Scope:** Data Protection Impact Assessment addendum for the Jira source
integration introduced in Wave 4. This document is engineering-grade input
for the operator's Data Protection Officer (DPO); it is not a legal opinion
or a substitute for the operator's own DPIA.

**Wave:** 4 (Issues #1431 — envelope, #1432 — Jira IR, Wave 4.C — REST
adapter, Wave 4.D — paste ingestion).

**Last reviewed:** 2026-04-27

---

## 1. Purpose and context

The Jira source integration allows a Jira issue — retrieved via the Jira REST
API, Jira Cloud/Data Center, or manually pasted by a reviewer — to serve as
a **primary** source of test intent in the multi-source test-intelligence
pipeline. The Jira IR (intermediate representation) is the only artifact
persisted from Jira input; raw API payloads, ADF documents, and paste bodies
are never written to disk.

This addendum supplements the baseline DPIA in `COMPLIANCE.md` and
`docs/test-intelligence.md`. It covers only the delta introduced by the
Jira source.

---

## 2. Data flows

```
Jira Cloud / Data Center REST API
            │  (HTTPS, bearer token)
            ▼
  jira-gateway-client.ts          ← Wave 4.C: REST adapter
            │  raw Jira API response (in memory only)
            ▼
  jira-adf-parser.ts              ← ADF → plain text (in memory only)
            │  structured fields, plain text
            ▼
  jira-issue-ir.ts                ← PII redaction, field selection
            │  JiraIssueIr
            ▼
  <runDir>/sources/<sourceId>/jira-issue-ir-list.json ← persisted REST replay artifact
  <runDir>/sources/<sourceId>/jira-issue-ir.json      ← persisted when exactly one issue
```

For paste-only mode (Wave 4.D):

```
Reviewer browser (Inspector UI)
            │  HTTP POST /workspace/test-intelligence/sources/<jobId>/jira-paste
            ▼
  jira-paste-ingest.ts            ← format detection, XSS strip, size cap
            │  structured paste (in memory only)
            ▼
  jira-issue-ir.ts                ← PII redaction, field selection
            │  JiraIssueIr
            ▼
  <runDir>/sources/<sourceId>/jira-issue-ir.json   ← persisted artifact
  <runDir>/sources/<sourceId>/paste-provenance.json ← provenance only
```

---

## 3. Persisted artifacts and their data categories

### 3.1 `jira-issue-ir.json`

Schema version: `JIRA_ISSUE_IR_SCHEMA_VERSION = "1.0.0"`

Artifact directory: `<artifactRoot>/<jobId>/sources/<sourceId>/`

| Field                  | Data category                                                          | Redaction guarantee                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `issueKey`             | Issue identifier (e.g. `PAY-1434`)                                     | Not redacted; issue keys are non-personal identifiers                                                                      |
| `issueType`            | Issue type (`Story`, `Bug`, `Task`, `Sub-task`, `Epic`, `Improvement`) | Not redacted                                                                                                               |
| `summary`              | Issue title text                                                       | PII-redacted before placement; capped at 1 KiB                                                                             |
| `description`          | Plain-text description (ADF-parsed)                                    | PII-redacted; capped at 32 KiB (`MAX_JIRA_DESCRIPTION_PLAIN_BYTES`)                                                        |
| `acceptanceCriteria[]` | AC text extracted from description ADF                                 | PII-redacted                                                                                                               |
| `status`               | Workflow status string                                                 | Not redacted; capped at 64 chars                                                                                           |
| `priority`             | Priority string                                                        | Not redacted; capped at 32 chars                                                                                           |
| `labels[]`             | Label strings                                                          | PII-redacted when label shape matches a customer-name-shaped field                                                         |
| `comments[]`           | Per-comment body text                                                  | PII-redacted; body capped at 4 KiB (`MAX_JIRA_COMMENT_BODY_BYTES`); **excluded by default** (opt-in via `includeComments`) |
| `attachments[]`        | Attachment filename and MIME type only                                 | No attachment content persisted; **excluded by default**                                                                   |
| `linkedIssues[]`       | Linked issue keys and relationship types                               | **excluded by default**                                                                                                    |
| `customFields[]`       | Key, label, and value                                                  | PII-redacted; value capped at 2 KiB (`MAX_JIRA_CUSTOM_FIELD_VALUE_BYTES`); **unknown custom fields excluded by default**   |
| `piiIndicators[]`      | Redaction audit trail — kind, location, snippet hash                   | No raw PII values; only kind/location/hash                                                                                 |
| `redactions[]`         | Per-field redaction records                                            | Structured redaction metadata only                                                                                         |
| `dataMinimization`     | Audit metadata for every opt-in                                        | Captures which fields were included and why                                                                                |
| `contentHash`          | SHA-256 of canonical IR JSON                                           | Non-personal; deterministic                                                                                                |
| `capturedAt`           | Server-side UTC timestamp                                              | Server-generated; no client-supplied values trusted                                                                        |

Jira REST ingestion also writes `jira-issue-ir-list.json`, a minimized replay
artifact containing only redacted `JiraIssueIr[]`, capability metadata,
`responseHash`, and `responseBytes`. It intentionally does not contain raw Jira
REST response bodies.

**Not persisted:**

- Raw Jira REST API response bodies
- Jira ADF documents (parsed and discarded in memory)
- Raw Jira paste body (`paste-provenance.json` records only the SHA-256
  of the original paste bytes — auditors can prove which paste was
  captured without storing it)
- `self`, `avatarUrls`, `attachment.content`, `thumbnail`, `names`, `schema`
  fields from the Jira API
- Bearer tokens, API tokens, OAuth access tokens, or refresh tokens
- Account IDs, mention handles (`@accountid:...`) — these are PII-redacted
  to `@user` stubs before IR placement
- Internal hostnames (e.g. `*.intranet.*`, `*.atlassian.net`) — redacted to
  `[hostname]` stubs

### 3.2 `paste-provenance.json`

| Field            | Data category                                                    | Notes                                                                                             |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pasteSessionId` | UUID v4                                                          | Randomly generated per request; no personal data                                                  |
| `authorHandle`   | Reviewer identity                                                | Derived from the matched server-side bearer principal; client-supplied author fields are rejected |
| `capturedAt`     | Server-side UTC timestamp                                        | Server-generated                                                                                  |
| `detectedFormat` | Format classifier (`auto`, `adf_json`, `plain_text`, `markdown`) | Non-personal                                                                                      |
| `contentHash`    | SHA-256 of the original paste bytes                              | No raw paste bytes                                                                                |

---

## 4. Legal basis

The operator is responsible for establishing an appropriate legal basis for
processing personal data that may be present in Jira issue text. This package:

- Applies PII redaction before any field is placed on the IR (Article 5(1)(c)
  data minimization principle).
- Excludes comments, attachments, linked issues, and unknown custom fields by
  default; each opt-in is recorded in `dataMinimization` for audit.
- Never persists raw Jira API responses, ADF documents, or paste bodies.
- Enforces byte caps on every field so large free-form text cannot circumvent
  redaction by volume.

---

## 5. Data minimization controls (GDPR Art. 5(1)(c))

| Control                    | Implementation                                                                                      | Constant                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| ADF input byte cap         | Pre-parse size check; rejected with `adf_payload_too_large` before parsing                          | `MAX_JIRA_ADF_INPUT_BYTES = 1048576`        |
| Description plain-text cap | Truncated after ADF parsing                                                                         | `MAX_JIRA_DESCRIPTION_PLAIN_BYTES = 32 KiB` |
| Comment count cap          | `comments` truncated to first N                                                                     | `MAX_JIRA_COMMENT_COUNT = 50`               |
| Comment body cap           | Per-comment truncation                                                                              | `MAX_JIRA_COMMENT_BODY_BYTES = 4 KiB`       |
| Attachment count cap       | Metadata only, count capped                                                                         | `MAX_JIRA_ATTACHMENT_COUNT = 50`            |
| Link count cap             | Link metadata only, count capped                                                                    | `MAX_JIRA_LINK_COUNT = 50`                  |
| Custom field count cap     | Count capped                                                                                        | `MAX_JIRA_CUSTOM_FIELD_COUNT = 50`          |
| Custom field value cap     | Per-value truncation                                                                                | `MAX_JIRA_CUSTOM_FIELD_VALUE_BYTES = 2 KiB` |
| REST API call cap          | Budget enforced per job                                                                             | `MAX_JIRA_API_REQUESTS_PER_JOB = 20`        |
| Paste byte cap per job     | Budget enforced across all paste submissions for the job                                            | `MAX_JIRA_PASTE_BYTES_PER_JOB = 512 KiB`    |
| Default field exclusion    | Comments, attachments, linked issues, and unknown custom fields excluded unless explicitly opted in | `DEFAULT_JIRA_FIELD_SELECTION_PROFILE`      |

---

## 6. PII detection and redaction (GDPR Art. 5(1)(c), Art. 32)

The PII detection pipeline runs on every textual field before IR placement.
Detection runs include:

| PII kind                                                                                                           | Detection | Redaction                  |
| ------------------------------------------------------------------------------------------------------------------ | --------- | -------------------------- |
| Email addresses                                                                                                    | Regex     | Replaced with `[email]`    |
| Phone numbers                                                                                                      | Regex     | Replaced with `[phone]`    |
| IP addresses                                                                                                       | Regex     | Replaced with `[ip]`       |
| URLs                                                                                                               | Regex     | Replaced with `[url]`      |
| Internal hostnames (`*.intranet.*`, `*.corp.*`, `*.internal`, `*.local`, `*.lan`, `*.atlassian.net`, `*.jira.com`) | Regex     | Replaced with `[hostname]` |
| Jira mentions (`[~accountid:...]`, `@accountid:...`)                                                               | Regex     | Replaced with `@user`      |
| Customer name placeholders (name-shaped values in name-shaped custom fields)                                       | Heuristic | Replaced with `[name]`     |

Redaction details (kind, location, snippet hash — never raw value) are written
to `JiraIssueIr.piiIndicators[]` and `JiraIssueIr.redactions[]` for audit.

`REDACTION_POLICY_VERSION` is replay-stable and stamped on the evidence
manifest so auditors can verify which redaction policy was active during a
run.

---

## 7. Security of processing (GDPR Art. 32)

| Concern                      | Implementation                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport                    | All Jira REST calls use HTTPS; the gateway client enforces TLS                                                                                              |
| Credential handling          | API token / OAuth access token never persisted; never logged; passed only in HTTP headers; redacted by `redactHighRiskSecrets` before any log/error surface |
| Bearer token for paste route | Timing-safe SHA-256 comparison; `503` when unconfigured; `401` on mismatch                                                                                  |
| JQL fragment sanitization    | `sanitizeJqlFragment` rejects semicolons, backticks, double-dashes, control characters, and `OR 1=1`/`AND 1=1` hijack patterns before any Jira REST query   |
| SSRF guard                   | Host allow-list enforced on all Jira REST calls; private/link-local targets rejected                                                                        |
| Paste XSS guard              | `<script`, `javascript:`, and inline `on*=` attributes rejected with `xss_content_detected` before parsing                                                  |
| Atomic persistence           | Artifacts written via `${pid}.${randomUUID()}.tmp` rename so partial writes never produce corrupt artifacts                                                 |

---

## 8. Retention

The package does not delete artifacts. Retention is operator-controlled via
the `<artifactRoot>` path. Operators are responsible for defining and
enforcing a retention policy that satisfies their GDPR obligations.

Artifacts under `<artifactRoot>/<jobId>/sources/<sourceId>/` contain
PII-redacted IR only. The operator should review `piiIndicators[]` and
`redactions[]` entries when assessing residual re-identification risk.

---

## 9. DPIA obligation assessment (GDPR Art. 35)

| Factor                                  | Assessment                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Systematic processing of personal data  | Jira issues may contain employee names, email addresses, internal account IDs; these are redacted before IR placement |
| Large-scale processing                  | Capped at `MAX_JIRA_API_REQUESTS_PER_JOB = 20` REST calls per job; not a large-scale processor by design              |
| Profiling or automated decision-making  | Not applicable; the IR is input to a human-reviewed test-case generation pipeline                                     |
| Processing sensitive special categories | Not applicable by default; operator must assess if their Jira project contains sensitive data                         |
| New technologies                        | LLM-assisted test-case generation; human review gate required before any case reaches export                          |

The package does not assert that a full DPIA is required; that determination
depends on the operator's deployment context. The redaction-audit trail,
evidence manifest, and per-job artifact tree are designed to provide the
evidence inputs an operator typically needs to complete their own DPIA.

---

## 10. DPO escalation path

If the operator's DPO has questions about the technical controls described in
this document:

1. Review the Jira IR artifact at
   `<artifactRoot>/<jobId>/sources/<sourceId>/jira-issue-ir.json`. The
   `piiIndicators[]`, `redactions[]`, and `dataMinimization` fields document
   exactly what was processed and what was redacted.
2. Review `wave1-poc-evidence-manifest.json` (or the Wave 4 equivalent) for
   the full run evidence including `REDACTION_POLICY_VERSION`.
3. The full contract surface is documented in `CONTRACT_CHANGELOG.md` versions
   `4.11.0` through `4.14.0` (Wave 4 range).
4. For questions about the ADF allow-list or PII detection categories, see
   `src/test-intelligence/jira-adf-parser.ts` and
   `src/test-intelligence/pii-detection.ts`.

---

## 11. Cross-references

- `COMPLIANCE.md` — top-level DORA/GDPR/EU AI Act control mapping
- `docs/test-intelligence.md` §14 — Wave 4 multi-source gate
- `docs/runbooks/jira-source-setup.md` — operator setup guide
- `docs/dora/multi-source.md` — DORA Art. 28 ICT third-party risk (Jira as ICT provider)
- `CONTRACT_CHANGELOG.md` §4.12.0 — Jira IR contract additions
- `CONTRACT_CHANGELOG.md` §4.13.0 — Jira ADF parser additions
- `src/test-intelligence/jira-issue-ir.ts` — authoritative implementation
- `src/test-intelligence/jira-adf-parser.ts` — ADF parsing allow-list
- `src/test-intelligence/pii-detection.ts` — PII detection categories
