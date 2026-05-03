# Public API Reference — Multi-Source Test Intelligence (Wave 4)

This document is the public API reference for the Wave 4 multi-source
test-intelligence contracts, HTTP routes, and operator configuration options
introduced in Issues #1431–#1439.

**Contract version:** `TEST_INTELLIGENCE_CONTRACT_VERSION = "1.6.0"`<br>
**Package contract version:** `CONTRACT_VERSION = "4.27.0"`<br>
**Authoritative surface:** `CONTRACT_CHANGELOG.md` §4.11.0–4.27.0

For the operator setup guide see `docs/test-intelligence.md`. For migration
from single-source jobs see `docs/migration/wave-4-additive.md`.

---

## 1. Feature-flag matrix

| Flag                                                   | Type           | Default | Description                                                                               |
| ------------------------------------------------------ | -------------- | ------- | ----------------------------------------------------------------------------------------- |
| `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE`                | env var        | off     | Parent gate; must be set to `1` for any test-intelligence functionality                   |
| `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE`    | env var        | off     | Multi-source gate; must be set to `1` in addition to the parent gate                      |
| `testIntelligence.enabled`                             | startup option | `false` | In-process parent gate                                                                    |
| `testIntelligence.multiSourceEnabled`                  | startup option | `false` | In-process multi-source gate                                                              |
| `testIntelligence.multiSourceEnabled + llmCodegenMode` | combined       | —       | Must both be true/deterministic; any mismatch fails closed with `llm_codegen_mode_locked` |

All four predicates must hold simultaneously. Any missing predicate fails
closed before any source artifact is persisted.

**Mode-gate refusal codes** (`ALLOWED_MULTI_SOURCE_MODE_GATE_REFUSAL_CODES`):

| Code                                   | Cause                                                       |
| -------------------------------------- | ----------------------------------------------------------- |
| `test_intelligence_disabled`           | Parent gate (env or startup option) is off                  |
| `multi_source_env_disabled`            | `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE` not set |
| `multi_source_startup_option_disabled` | `testIntelligence.multiSourceEnabled` is false              |
| `llm_codegen_mode_locked`              | `llmCodegenMode` is not `"deterministic"`                   |

---

## 2. Source kinds

### 2.1 Primary source kinds (`PRIMARY_TEST_INTENT_SOURCE_KINDS`)

At least one primary source is always required. A custom-only envelope is
refused with `primary_source_required` before any artifact is written.

| Kind               | Description                                     | Wave            |
| ------------------ | ----------------------------------------------- | --------------- |
| `figma_local_json` | Local Figma JSON file                           | Wave 1 baseline |
| `figma_plugin`     | Figma plugin clipboard export                   | Wave 1 baseline |
| `figma_rest`       | Figma REST API                                  | Wave 1 baseline |
| `jira_rest`        | Jira REST API (Cloud / Data Center / OAuth 2.0) | Wave 4.C        |
| `jira_paste`       | Paste-only Jira input (air-gap safe)            | Wave 4.D        |

### 2.2 Supporting source kinds (`SUPPORTING_TEST_INTENT_SOURCE_KINDS`)

Supporting sources provide enrichment evidence. They may only appear alongside
a primary source.

| Kind                | Description                     | `inputFormat` required |
| ------------------- | ------------------------------- | ---------------------- |
| `custom_text`       | Reviewer-authored Markdown      | `"markdown"`           |
| `custom_structured` | Key/value structured attributes | `"structured_json"`    |

### 2.3 Custom input formats (`ALLOWED_TEST_INTENT_CUSTOM_INPUT_FORMATS`)

`"plain_text"` | `"markdown"` | `"structured_json"`

---

## 3. Source-mix decision table

| Sources present                                 | Accepted? | Notes                                                             |
| ----------------------------------------------- | --------- | ----------------------------------------------------------------- |
| Figma-only                                      | Yes       | Wave 1 baseline; works when multi-source gate is off              |
| Jira REST only                                  | Yes       | No Figma, no screenshots, no visual sidecar                       |
| Jira paste only                                 | Yes       | Air-gap safe                                                      |
| Figma + Jira REST                               | Yes       | Reconciliation in Wave 4.F                                        |
| Figma + Jira paste                              | Yes       | Reconciliation in Wave 4.F                                        |
| Jira REST + Jira paste                          | Yes       | Refused with `duplicate_jira_paste_collision` only when `canonicalIssueKey` matches |
| Any above + `custom_text` / `custom_structured` | Yes       | Custom kinds are supporting evidence only                         |
| `custom_text` / `custom_structured` only        | Refused   | `primary_source_required`                                         |

---

## 4. Envelope contract

### 4.1 `MultiSourceTestIntentEnvelope`

Schema version: `MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION = "1.0.0"`

```ts
interface MultiSourceTestIntentEnvelope {
    version: "1.0.0";
    sources: TestIntentSourceRef[]; // length ≥ 1; at least one primary
    aggregateContentHash: string; // SHA-256; order-invariant (except priority policy)
    conflictResolutionPolicy: ConflictResolutionPolicy;
    priorityOrder?: TestIntentSourceKind[]; // required when policy = "priority"
}
```

**Conflict resolution policies** (`ALLOWED_CONFLICT_RESOLUTION_POLICIES`):

| Policy             | Behavior                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `priority`         | Source kinds in `priorityOrder` win when fields conflict; `priorityOrder` is required and complete |
| `reviewer_decides` | Conflicts are surfaced in `multi-source-conflicts.json`; four-eyes review triggered                |
| `keep_both`        | Both interpretations are emitted as alternative test cases                                         |

### 4.2 `TestIntentSourceRef`

```ts
interface TestIntentSourceRef {
    sourceId: string; // ^[A-Za-z0-9._-]{1,64}$
    kind: TestIntentSourceKind;
    contentHash: string; // lowercase 64-hex SHA-256
    capturedAt: string; // ISO-8601 UTC timestamp ending in Z
    authorHandle?: string; // ^[A-Za-z0-9._-]{1,64}$; required for paste/custom
    inputFormat?: TestIntentCustomInputFormat; // required for custom_text / custom_structured
    canonicalIssueKey?: string; // Jira issue key; required for jira_* kinds
    markdownSectionPath?: string; // markdown sources only
    noteEntryId?: string; // markdown sources only
    redactedMarkdownHash?: string; // markdown sources only; SHA-256 of canonical Markdown
    plainTextDerivativeHash?: string; // markdown sources only
}
```

### 4.3 Envelope validation

```ts
type MultiSourceEnvelopeValidationResult =
    | { ok: true; envelope: MultiSourceTestIntentEnvelope }
    | { ok: false; issues: MultiSourceEnvelopeIssue[] };
```

The validator never throws. All 26 refusal codes are in
`ALLOWED_MULTI_SOURCE_ENVELOPE_REFUSAL_CODES`.

Key refusal codes:

| Code                                | Cause                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `primary_source_required`           | No primary source present                                              |
| `duplicate_source_id`               | Two sources share the same `sourceId`                                  |
| `duplicate_jira_paste_collision`    | Two Jira sources share the same `canonicalIssueKey`                    |
| `aggregate_hash_mismatch`           | Caller-supplied `aggregateContentHash` does not match computed value   |
| `priority_order_required`           | `conflictResolutionPolicy = "priority"` but `priorityOrder` is missing |
| `priority_order_incomplete`         | `priorityOrder` does not cover all source kinds present                |
| `custom_input_format_required`      | Custom source missing `inputFormat`                                    |
| `markdown_metadata_only_for_custom` | `markdownSectionPath` or `noteEntryId` on a non-custom source          |

### 4.4 `computeAggregateContentHash`

```ts
function computeAggregateContentHash(
    sources: TestIntentSourceRef[],
    policy: ConflictResolutionPolicy,
    priorityOrder?: TestIntentSourceKind[],
): string;
```

Deterministic SHA-256 of sorted `(contentHash, kind)` pairs. When
`policy = "priority"`, the `priorityOrder` is mixed in so a different
priority order produces a different hash. Result is invariant under source
reordering for all other policies.

---

## 5. Jira IR contract

### 5.1 `JiraIssueIr`

Schema version: `JIRA_ISSUE_IR_SCHEMA_VERSION = "1.0.0"`  
Artifact path: `<artifactRoot>/<jobId>/sources/<sourceId>/jira-issue-ir.json`

```ts
interface JiraIssueIr {
    version: "1.0.0";
    issueKey: string; // e.g. "PAY-1234"
    issueType: JiraIssueType; // Story | Bug | Task | Sub-task | Epic | Improvement | other
    summary: string; // PII-redacted
    descriptionPlain: string; // PII-redacted; ≤ 32 KiB
    acceptanceCriteria: JiraAcceptanceCriterion[];
    labels: string[]; // sorted, deduplicated, PII-redacted
    components: string[]; // sorted, deduplicated, PII-redacted
    fixVersions: string[];
    status: string;
    priority?: string;
    customFields: JiraIssueIrCustomField[]; // opt-in; PII-redacted
    comments: JiraComment[]; // opt-in; PII-redacted; ≤ 50 entries
    attachments: JiraAttachmentRef[]; // opt-in; metadata only; ≤ 50 entries
    links: JiraLinkRef[]; // opt-in; ≤ 50 entries
    piiIndicators: PiiIndicator[];
    redactions: IntentRedaction[];
    dataMinimization: JiraIssueIrDataMinimization;
    capturedAt: string; // ISO-8601 UTC; server-generated
    contentHash: string; // SHA-256 of canonical JSON with contentHash stripped
}
```

### 5.2 Byte and count caps

| Limit                  | Value              | Constant                            |
| ---------------------- | ------------------ | ----------------------------------- |
| ADF input              | 1 MiB (1048576 B)  | `MAX_JIRA_ADF_INPUT_BYTES`          |
| Description plain text | 32 KiB (32768 B)   | `MAX_JIRA_DESCRIPTION_PLAIN_BYTES`  |
| Comment body           | 4 KiB (4096 B)     | `MAX_JIRA_COMMENT_BODY_BYTES`       |
| Comment count          | 50                 | `MAX_JIRA_COMMENT_COUNT`            |
| Attachment count       | 50                 | `MAX_JIRA_ATTACHMENT_COUNT`         |
| Link count             | 50                 | `MAX_JIRA_LINK_COUNT`               |
| Custom field count     | 50                 | `MAX_JIRA_CUSTOM_FIELD_COUNT`       |
| Custom field value     | 2 KiB (2048 B)     | `MAX_JIRA_CUSTOM_FIELD_VALUE_BYTES` |
| REST API calls per job | 20                 | `MAX_JIRA_API_REQUESTS_PER_JOB`     |
| Paste bytes per job    | 512 KiB (524288 B) | `MAX_JIRA_PASTE_BYTES_PER_JOB`      |

### 5.3 `JiraIssueIr.dataMinimization`

All fields are always present, not optional, so auditors can always verify
the minimization profile:

```ts
interface JiraIssueIrDataMinimization {
    descriptionIncluded: boolean;
    descriptionTruncated: boolean;
    commentsIncluded: boolean;
    commentsDropped: number;
    commentsCapped: number;
    attachmentsIncluded: boolean;
    attachmentsDropped: number;
    linksIncluded: boolean;
    linksDropped: number;
    customFieldsIncluded: number;
    unknownCustomFieldsExcluded: number;
    customFieldsCapped: number;
}
```

### 5.4 Jira refusal codes (`ALLOWED_JIRA_IR_REFUSAL_CODES`)

19 codes including: `invalid_issue_key`, `unsupported_issue_type`,
`adf_payload_too_large`, `adf_depth_exceeded`, `adf_node_count_exceeded`,
`jql_injection_detected`, `ssrf_disallowed_host`, `rate_limited`,
`api_auth_failed`, `connection_refused`, `xss_content_detected`.

---

## 6. Custom context contract

### 6.1 `custom-context.json` (Markdown)

Schema version: `CUSTOM_CONTEXT_SCHEMA_VERSION = "1.0.0"`  
Source ID: `CUSTOM_CONTEXT_MARKDOWN_SOURCE_ID = "custom-context-markdown"`  
Artifact: `<artifactRoot>/<jobId>/sources/custom-context-markdown/custom-context.json`

```json
{
    "version": "1.0.0",
    "entries": [
        {
            "sectionPath": "Regulatory context",
            "bodyPlain": "This payment flow falls under PSD2 SCA requirements.",
            "bodyMarkdown": "## Regulatory context\n\nThis payment flow falls under PSD2 SCA requirements.",
            "redactedMarkdownHash": "<sha256>",
            "plainTextDerivativeHash": "<sha256>",
            "redactionIndicators": []
        }
    ],
    "authorHandle": "reviewer-a",
    "capturedAt": "2026-04-27T10:00:00.000Z"
}
```

### 6.2 `custom-context.json` (Structured)

Source ID: `CUSTOM_CONTEXT_STRUCTURED_SOURCE_ID = "custom-context-structured"`  
Artifact: `<artifactRoot>/<jobId>/sources/custom-context-structured/custom-context.json`

```json
{
    "version": "1.0.0",
    "attributes": [
        { "key": "data_class", "value": "PCI-DSS-3" },
        { "key": "regulatory_scope", "value": "PSD2" }
    ],
    "contentHash": "<sha256>",
    "redactionIndicators": [],
    "authorHandle": "reviewer-a",
    "capturedAt": "2026-04-27T10:00:00.000Z"
}
```

Public camelCase aliases (`dataClass`, `regulatoryScope`, `featureFlag`) are
normalized to snake_case canonical wire keys at validation time.

Per-job budget: `MAX_CUSTOM_CONTEXT_BYTES_PER_JOB = 256 KiB (262144 B)`.

---

## 7. Reconciliation contract

### 7.1 `MultiSourceReconciliationReport`

Schema version: `MULTI_SOURCE_RECONCILIATION_REPORT_SCHEMA_VERSION = "1.0.0"`  
Artifact: `<artifactRoot>/<jobId>/multi-source-conflicts.json`

```ts
interface MultiSourceReconciliationReport {
    version: "1.0.0";
    envelopeHash: string;
    conflicts: MultiSourceConflict[];
    unmatchedSources: string[];
    contributingSourcesPerCase: Array<{
        testCaseId: string;
        sourceIds: string[];
    }>;
    policyApplied: ConflictResolutionPolicy;
    transcript: MultiSourceReconciliationTranscriptEntry[];
}
```

### 7.2 `MultiSourceConflict`

```ts
interface MultiSourceConflict {
    conflictId: string; // SHA-256 of { kind, sourceRefs, normalizedValues }
    kind: MultiSourceConflictKind;
    participatingSourceIds: string[];
    normalizedValues: string[]; // sorted, redacted
    resolution:
        | "auto_priority"
        | "deferred_to_reviewer"
        | "kept_both"
        | "unresolved";
    affectedElementIds?: string[];
    affectedScreenIds?: string[];
    detail?: string;
    resolvedBy?: string;
    resolvedAt?: string;
}
```

Conflict kinds: `field_label_mismatch`, `validation_rule_mismatch`,
`risk_category_mismatch`, `test_data_example_mismatch`,
`duplicate_acceptance_criterion`, `paste_collision`.

Conflict artifact filename: `MULTI_SOURCE_CONFLICT_REPORT_ARTIFACT_FILENAME = "multi-source-conflicts.json"`

---

## 8. HTTP routes

All routes are mounted under `/workspace/test-intelligence`. The parent
test-intelligence and multi-source gates must both be enabled for Wave 4 write
routes to be reachable.

### 8.1 Existing routes (unchanged)

| Route                                                               | Method | Auth   | Purpose                          |
| ------------------------------------------------------------------- | ------ | ------ | -------------------------------- |
| `/workspace/test-intelligence/jobs`                                 | GET    | none   | List jobs with on-disk artifacts |
| `/workspace/test-intelligence/jobs/<jobId>`                         | GET    | none   | Composite artifact bundle read   |
| `/workspace/test-intelligence/jobs/<jobId>/sources`                 | GET    | none   | List source refs for a job       |
| `/workspace/test-intelligence/review/<jobId>/state`                 | GET    | none   | Review snapshot and event log    |
| `/workspace/test-intelligence/review/<jobId>/<action>`              | POST   | bearer | Job-level review transition      |
| `/workspace/test-intelligence/review/<jobId>/<action>/<testCaseId>` | POST   | bearer | Per-case review transition       |

### 8.2 New Wave 4 routes

| Route                                                                          | Method | Auth   | Purpose                                      |
| ------------------------------------------------------------------------------ | ------ | ------ | -------------------------------------------- |
| `/workspace/test-intelligence/jobs/<jobId>/sources/jira-fetch`                 | POST   | bearer | Ingest Jira REST issues via configured gateway |
| `/workspace/test-intelligence/jobs/<jobId>/sources/<sourceId>`                 | DELETE | bearer | Remove a source from a job                   |
| `/workspace/test-intelligence/jobs/<jobId>/conflicts/<conflictId>/resolve`     | POST   | bearer | Record reviewer conflict resolution          |
| `/workspace/test-intelligence/sources/<jobId>/jira-paste`                      | POST   | bearer | Ingest paste-only Jira source                |
| `/workspace/test-intelligence/sources/<jobId>/custom-context`                  | POST   | bearer | Ingest reviewer custom-context source        |

#### `POST /workspace/test-intelligence/sources/<jobId>/jira-paste`

Ingest a Jira issue as a paste-only primary multi-source artifact.

**Auth:** Bearer token (same governance as review write routes)

**Request body:**

```json
{
    "format": "auto",
    "body": "Key: PAY-1434\nSummary: SEPA payment approval\n..."
}
```

`format`: `"auto"` | `"adf_json"` | `"plain_text"` | `"markdown"`.  
`"auto"` detects format from content.

**Paste caps:**

- Raw paste body: 256 KiB per submission
- Per-job total paste budget: `MAX_JIRA_PASTE_BYTES_PER_JOB = 512 KiB`

**XSS guard:** `<script`, `javascript:`, and inline `on*=` attributes are
rejected with `xss_content_detected` before parsing.

**Response (200):**

```json
{
    "ok": true,
    "jobId": "job-001",
    "sourceId": "jira-paste-1f3870be-a7d3c7f4d9e2",
    "sourceRef": {
        "sourceId": "jira-paste-1f3870be-a7d3c7f4d9e2",
        "kind": "jira_paste",
        "canonicalIssueKey": "PAY-1434",
        "contentHash": "<sha256>"
    },
    "sourceEnvelope": {
        "version": "1.0.0",
        "sources": [{ "sourceId": "jira-paste-1f3870be-a7d3c7f4d9e2", "kind": "jira_paste" }],
        "aggregateContentHash": "<sha256>",
        "conflictResolutionPolicy": "reviewer_decides"
    },
    "sourceMixHint": {
        "primarySourceKinds": ["jira_paste"],
        "supportingSourceKinds": []
    },
    "artifacts": {
        "jiraIssueIr": "sources/jira-paste-1f3870be-a7d3c7f4d9e2/jira-issue-ir.json",
        "pasteProvenance": "sources/jira-paste-1f3870be-a7d3c7f4d9e2/paste-provenance.json",
        "rawPastePersisted": false
    }
}
```

Clients should use `sourceId`, `sourceRef`, and `artifacts.*` from the response
instead of deriving source directories from the Jira issue key.

**Error responses:** `400` (invalid body/format), `401` (token mismatch),
`503` (token not configured).

#### `POST /workspace/test-intelligence/sources/<jobId>/custom-context`

Ingest reviewer-supplied Markdown or structured attributes as supporting
custom-context evidence.

**Auth:** Bearer token

**Requires:** A primary source (Figma or Jira) must already exist for
`<jobId>`. A custom-only submission returns `400` with
`primary_source_required`.

**Request body (Markdown + structured):**

```json
{
    "markdown": "## Regulatory context\n\n- PSD2 SCA applies for amounts above EUR 30.",
    "attributes": [
        { "key": "dataClass", "value": "PCI-DSS-3" },
        { "key": "regulatoryScope", "value": "PSD2" }
    ]
}
```

**Response (200):**

```json
{
    "ok": true,
    "jobId": "job-001",
    "sourceRefs": [
        {
            "sourceId": "custom-context-markdown",
            "kind": "custom_text",
            "inputFormat": "markdown",
            "redactedMarkdownHash": "<sha256>",
            "plainTextDerivativeHash": "<sha256>"
        },
        {
            "sourceId": "custom-context-structured",
            "kind": "custom_structured",
            "inputFormat": "structured_json",
            "contentHash": "<sha256>"
        }
    ],
    "sourceEnvelope": {
        "version": "1.0.0",
        "sources": [
            { "sourceId": "jira-paste-1f3870be-a7d3c7f4d9e2", "kind": "jira_paste" },
            { "sourceId": "custom-context-markdown", "kind": "custom_text" },
            { "sourceId": "custom-context-structured", "kind": "custom_structured" }
        ],
        "aggregateContentHash": "<sha256>",
        "conflictResolutionPolicy": "reviewer_decides"
    },
    "customContext": {
        "markdown": { "sourceId": "custom-context-markdown" },
        "structured": { "sourceId": "custom-context-structured" }
    },
    "policySignals": ["custom_context_risk_escalation"],
    "artifacts": {
        "customContext": [
            "sources/custom-context-markdown/custom-context.json",
            "sources/custom-context-structured/custom-context.json"
        ],
        "rawMarkdownPersisted": false,
        "unsanitizedInputPersisted": false
    }
}
```

**Error responses:** `400` (validation failure, primary source missing),
`401` (token mismatch), `503` (token not configured).

---

## 9. Worked request/response examples

### 9.1 Jira REST-only job

```bash
curl -X POST http://127.0.0.1:1983/workspace/test-intelligence/jobs/job-001/sources/jira-fetch \
  -H "Authorization: Bearer $WORKSPACE_TI_REVIEW_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"issueKeys": ["PAY-1434"]}'
```

The route requires a Jira gateway client to be configured by the hosting
integration. It persists minimized Jira IR artifacts under
`<artifactRoot>/<jobId>/sources/<sourceId>/jira-issue-ir-list.json` and, when
the response contains exactly one issue, `jira-issue-ir.json`. Raw Jira REST
API response bodies are never persisted.

### 9.2 Jira paste-only (air-gap)

```bash
curl -X POST http://127.0.0.1:1983/workspace/test-intelligence/sources/job-001/jira-paste \
  -H "Authorization: Bearer $WORKSPACE_TI_REVIEW_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "auto",
    "body": "Key: PAY-42\nSummary: Payment threshold validation\nStatus: Open\nAcceptance Criteria:\n1. Amounts below EUR 30 skip SCA.\n2. Amounts above EUR 30 require 2FA."
  }'
```

### 9.3 Figma + Jira job with custom context

```bash
# Step 1: ingest Figma source (existing flow)
# Step 2: ingest Jira paste as second primary source
curl -X POST http://127.0.0.1:1983/workspace/test-intelligence/sources/job-002/jira-paste \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"format": "auto", "body": "Key: PAY-55\nSummary: 3DS challenge flow..."}'

# Step 3: add custom context (supporting evidence)
curl -X POST http://127.0.0.1:1983/workspace/test-intelligence/sources/job-002/custom-context \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "markdown": "## Compliance context\n\n- PSD2 SCA required for all card transactions.",
    "attributes": [{"key": "regulatoryScope", "value": "PSD2"}]
  }'
```

### 9.4 Primary source + custom context only

```bash
# Figma-only job (no Jira) + Markdown context
curl -X POST http://127.0.0.1:1983/workspace/test-intelligence/sources/job-003/custom-context \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "markdown": "## Test data constraints\n\n- Use ISO 4217 currency codes only.\n- Never use real customer IBAN numbers.",
    "attributes": [{"key": "dataClass", "value": "internal"}]
  }'
```

### 9.5 Markdown custom context with Jira-only job

```bash
# Jira paste primary + Markdown custom context
curl -X POST http://127.0.0.1:1983/workspace/test-intelligence/sources/job-004/jira-paste \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"format": "plain_text", "body": "Key: ONBOARD-7\nSummary: KYC onboarding identity check\nStatus: In Progress"}'

curl -X POST http://127.0.0.1:1983/workspace/test-intelligence/sources/job-004/custom-context \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "markdown": "## Regulatory notes\n\n- AMLD5 requires ID verification for new accounts.\n- Accepted ID types: passport, national ID card, driving licence.",
    "attributes": [{"key": "regulatoryScope", "value": "AMLD5"}]
  }'
```

---

## 10. Startup options — multi-source additions

New fields on `WorkspaceStartOptions.testIntelligence` (all optional,
backward-compatible):

```ts
testIntelligence: {
  // ... existing fields ...

  /** Enable the multi-source gate (requires env var too). */
  multiSourceEnabled?: boolean;

  /** Maximum Jira REST API calls per job. Default: MAX_JIRA_API_REQUESTS_PER_JOB (20). */
  maxJiraApiRequestsPerJob?: number;

  /** Maximum raw paste bytes per job. Default: MAX_JIRA_PASTE_BYTES_PER_JOB (512 KiB). */
  maxJiraPasteBytesPerJob?: number;

  /** Maximum custom-context input bytes per job. Default: MAX_CUSTOM_CONTEXT_BYTES_PER_JOB (256 KiB). */
  maxCustomContextBytesPerJob?: number;
}
```

New read-only fields on `WorkspaceStatus` (additive, optional):

```ts
testIntelligenceMultiSourceEnabled?: boolean;
```

---

## 11. Implementation helper entrypoints

The following helpers are exported from `src/test-intelligence/index.ts` for
in-repo harnesses and internal integrations. The published package exposes the
stable public contract types via `workspace-dev/contracts`; external ingestion
integrations should use the HTTP routes above unless a future package subpath
is explicitly published.

| Function                                | Description                                                        |
| --------------------------------------- | ------------------------------------------------------------------ |
| `validateMultiSourceTestIntentEnvelope` | Validate a caller-supplied envelope; returns discriminated union   |
| `buildMultiSourceTestIntentEnvelope`    | Build a validated envelope from source refs                        |
| `computeAggregateContentHash`           | Compute the deterministic aggregate hash                           |
| `enforceMultiSourceModeGate`            | Throws `MultiSourceModeGateError` if any gate predicate fails      |
| `evaluateMultiSourceModeGate`           | Returns a `MultiSourceModeGateDecision` (non-throwing)             |
| `legacySourceFromMultiSourceEnvelope`   | Project the primary Figma source back to the legacy `source` field |
| `isPrimaryTestIntentSourceKind`         | Type predicate for primary source kinds                            |
| `isSupportingTestIntentSourceKind`      | Type predicate for supporting source kinds                         |
| `buildJiraIssueIr`                      | Build a `JiraIssueIr` from a Jira input before persistence         |
| `writeJiraIssueIr`                      | Persist a `JiraIssueIr` to disk (atomic rename)                    |
| `isValidJiraIssueKey`                   | Validate a Jira issue key string                                   |
| `sanitizeJqlFragment`                   | Sanitize a JQL fragment; rejects injection patterns                |
| `createJiraGatewayClient`               | Create an authenticated Jira REST gateway client                   |
| `createMockJiraGatewayClient`           | Create a deterministic mock Jira client for testing                |
| `probeJiraCapability`                   | Probe Jira API availability and write `jira-capabilities.json`     |
| `buildJiraAuthHeaders`                  | Build HTTP auth headers for a Jira auth config                     |
| `buildJiraPasteOnlyEnvelope`            | Build an envelope from a paste-only Jira input                     |
| `detectJiraPasteFormat`                 | Classify a paste body as ADF JSON, Markdown, or plain text         |
| `ingestJiraPaste`                       | Parse and validate a paste body; return structured IR input        |
| `ingestAndPersistJiraPaste`             | Full paste ingestion + artifact write                              |
| `validateCustomContextInput`            | Validate custom context request body                               |
| `validateCustomContextAttributes`       | Validate structured attributes                                     |
| `canonicalizeCustomContextMarkdown`     | Parse and canonicalize Markdown input                              |
| `persistCustomContext`                  | Persist custom context artifacts to disk                           |
| `reconcileSources`                      | Basic multi-source reconciliation                                  |
| `reconcileMultiSourceIntent`            | Full reconciliation with conflict resolution policy                |
| `writeMultiSourceReconciliationReport`  | Persist the reconciliation report                                  |
| `runWave4ProductionReadiness`           | End-to-end Wave 4 production-readiness harness                     |
| `evaluateWave4ProductionReadiness`      | Threshold-gated pass/fail evaluation                               |

---

## 12. See also

- `CONTRACT_CHANGELOG.md` §4.11.0–4.23.0 — authoritative contract surface
- `docs/test-intelligence.md` §14 — Wave 4 multi-source gate (operator guide)
- `docs/migration/wave-4-additive.md` — migration from single-source
- `docs/runbooks/jira-source-setup.md` — Jira setup guide
- `docs/runbooks/multi-source-air-gap.md` — air-gap deployment
- `docs/dpia/jira-source.md` — DPIA addendum (Jira)
- `docs/dpia/custom-context-source.md` — DPIA addendum (custom context)
- `docs/dora/multi-source.md` — DORA Art. 6/8/9/28 mapping
- `docs/eu-ai-act/human-oversight.md` — EU AI Act Art. 14 human oversight
- `COMPATIBILITY.md` — multi-source source-mix matrix
