# Migration Note — Wave 4 Additive Multi-Source Contracts

**Scope:** This note describes how existing single-source (Figma-only) jobs
continue to work unchanged when Wave 4 multi-source ingestion is deployed,
and documents the additive-only contract diff between Wave 1–3 and Wave 4.

**Applies to:** `CONTRACT_VERSION` range `3.21.0` → `4.14.0` and
`TEST_INTELLIGENCE_CONTRACT_VERSION` `1.0.0` → `1.3.0`.

---

## 1. Single-source jobs require no changes

Wave 4 is a strictly additive extension. Single-source Figma-only jobs:

- Continue to work with no code or configuration changes.
- Produce byte-identical artifacts when the multi-source gate is disabled.
- Are not required to supply a `sourceEnvelope` field; the legacy `source`
  field on `BusinessTestIntentIr` is kept for one minor version cycle.
- Will not see new artifact files under `<artifactRoot>/<jobId>/` unless the
  multi-source gate is explicitly enabled.

The multi-source gate is a **dual opt-in**:

1. Set `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE=1`.
2. Pass `testIntelligence.multiSourceEnabled: true` in
   `WorkspaceStartOptions`.

Both must be set. If either is missing, the runtime behaves identically to
Wave 3.

---

## 2. Additive-only contract diff (Wave 1–3 → Wave 4)

All Wave 4 additions are additive. No existing contract types, constants,
or artifact schemas were changed in a breaking way.

### 2.1 New constants

| Constant                                            | Value                                                 | Wave |
| --------------------------------------------------- | ----------------------------------------------------- | ---- |
| `TEST_INTELLIGENCE_MULTISOURCE_ENV`                 | `"FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE"` | 4.A  |
| `MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION`  | `"1.0.0"`                                             | 4.A  |
| `CUSTOM_CONTEXT_SCHEMA_VERSION`                     | `"1.0.0"`                                             | 4.A  |
| `CUSTOM_CONTEXT_ARTIFACT_FILENAME`                  | `"custom-context.json"`                               | 4.A  |
| `CUSTOM_CONTEXT_MARKDOWN_SOURCE_ID`                 | `"custom-context-markdown"`                           | 4.A  |
| `CUSTOM_CONTEXT_STRUCTURED_SOURCE_ID`               | `"custom-context-structured"`                         | 4.A  |
| `JIRA_ISSUE_IR_SCHEMA_VERSION`                      | `"1.0.0"`                                             | 4.B  |
| `JIRA_ISSUE_IR_ARTIFACT_DIRECTORY`                  | `"sources"`                                           | 4.B  |
| `JIRA_ISSUE_IR_ARTIFACT_FILENAME`                   | `"jira-issue-ir.json"`                                | 4.B  |
| `MAX_JIRA_ADF_INPUT_BYTES`                          | `1_048_576` (1 MiB)                                   | 4.B  |
| `MAX_JIRA_DESCRIPTION_PLAIN_BYTES`                  | `32_768` (32 KiB)                                     | 4.B  |
| `MAX_JIRA_COMMENT_BODY_BYTES`                       | `4_096` (4 KiB)                                       | 4.B  |
| `MAX_JIRA_COMMENT_COUNT`                            | `50`                                                  | 4.B  |
| `MAX_JIRA_ATTACHMENT_COUNT`                         | `50`                                                  | 4.B  |
| `MAX_JIRA_LINK_COUNT`                               | `50`                                                  | 4.B  |
| `MAX_JIRA_CUSTOM_FIELD_COUNT`                       | `50`                                                  | 4.B  |
| `MAX_JIRA_CUSTOM_FIELD_VALUE_BYTES`                 | `2_048` (2 KiB)                                       | 4.B  |
| `MAX_JIRA_API_REQUESTS_PER_JOB`                     | `20`                                                  | 4.C  |
| `MAX_JIRA_PASTE_BYTES_PER_JOB`                      | `524_288` (512 KiB)                                   | 4.D  |
| `MAX_CUSTOM_CONTEXT_BYTES_PER_JOB`                  | `262_144` (256 KiB)                                   | 4.E  |
| `MULTI_SOURCE_RECONCILIATION_REPORT_SCHEMA_VERSION` | `"1.0.0"`                                             | 4.F  |
| `MULTI_SOURCE_CONFLICT_REPORT_ARTIFACT_FILENAME`    | `"multi-source-conflicts.json"`                       | 4.F  |

### 2.2 New types

All new types are exported from `workspace-dev/contracts` alongside
existing types. No existing type definitions were changed.

| Type                             | Description                                                             |
| -------------------------------- | ----------------------------------------------------------------------- |
| `MultiSourceTestIntentEnvelope`  | Envelope wrapping all sources for a multi-source job                    |
| `TestIntentSourceRef`            | Per-source reference with kind, ID, content hash, and capture timestamp |
| `TestIntentSourceKind`           | Union of all source kind literals                                       |
| `PrimaryTestIntentSourceKind`    | Figma + Jira source kinds                                               |
| `SupportingTestIntentSourceKind` | `custom_text` \| `custom_structured`                                    |
| `ConflictResolutionPolicy`       | `priority` \| `reviewer_decides` \| `keep_both`                         |
| `MultiSourceEnvelopeRefusalCode` | All 26 refusal codes for envelope validation                            |
| `MultiSourceModeGateRefusalCode` | All 4 mode-gate refusal codes                                           |
| `JiraIssueIr`                    | Canonical, PII-redacted Jira issue IR                                   |
| `JiraFieldSelectionProfile`      | Per-job Jira field inclusion configuration                              |
| `JiraIssueIrDataMinimization`    | Audit metadata for field opt-ins                                        |

### 2.3 Additive fields on existing types

| Type                                     | New field                             | Notes                                  |
| ---------------------------------------- | ------------------------------------- | -------------------------------------- |
| `BusinessTestIntentIr`                   | `sourceEnvelope?`                     | Optional; absent on single-source jobs |
| `IntentTraceRef`                         | `sourceRefs[]?`                       | Optional; absent on single-source jobs |
| `WorkspaceStartOptions.testIntelligence` | `multiSourceEnabled?`                 | Optional; defaults to `false`          |
| `WorkspaceStatus`                        | `testIntelligenceMultiSourceEnabled?` | Optional; absent when gate is off      |

All new fields on existing types are optional (`?`). Existing consumers that
do not read these fields will continue to work without modification.

### 2.4 `BusinessTestIntentIr.source` backward compatibility

The legacy `source` field on `BusinessTestIntentIr` is preserved in Wave 4.
Single-source Figma-only jobs continue to populate it as before. Multi-source
jobs populate `sourceEnvelope` instead; `legacySourceFromMultiSourceEnvelope`
projects the primary Figma source back to the legacy field for consumers that
haven't yet migrated.

When `TEST_INTELLIGENCE_CONTRACT_VERSION` reaches `2.0.0`, the legacy `source`
field will be removed. No such bump is planned in Wave 4.

---

## 3. Artifact tree additions

Wave 4 adds new artifact directories under `<artifactRoot>/<jobId>/` when
the multi-source gate is enabled. All new artifacts are in new subdirectories;
no existing artifact paths change.

```
<jobId>/
├── [existing Wave 1-3 artifacts unchanged]
│   ├── generated-testcases.json
│   ├── validation-report.json
│   ├── policy-report.json
│   ├── coverage-report.json
│   ├── review-events.json
│   ├── export-report.json
│   └── wave1-validation-evidence-manifest.json
│
└── sources/                         ← NEW (Wave 4)
    ├── <sourceId-jira>/
    │   ├── jira-issue-ir.json        ← Canonical Jira IR
    │   └── paste-provenance.json     ← Paste provenance (paste-only path)
    ├── custom-context-markdown/
    │   └── custom-context.json       ← PII-redacted canonical Markdown
    └── custom-context-structured/
        └── custom-context.json       ← Validated structured attributes

multi-source-conflicts.json          ← NEW (Wave 4.F, multi-source jobs; includes conflicts when present)
```

---

## 4. New HTTP routes

Wave 4 adds two new HTTP routes under the existing test-intelligence namespace.
No existing routes were changed.

| Route                                                         | Method | Auth   | Purpose                            |
| ------------------------------------------------------------- | ------ | ------ | ---------------------------------- |
| `/workspace/test-intelligence/sources/<jobId>/jira-paste`     | POST   | bearer | Paste-only Jira ingestion          |
| `/workspace/test-intelligence/sources/<jobId>/custom-context` | POST   | bearer | Markdown/structured custom context |

Both routes are guarded by the dual feature gate and require bearer
authentication. See `docs/test-intelligence.md` §14 for full details.

---

## 5. Migration checklist

For consumers upgrading from Wave 3 to Wave 4:

- [ ] No action required if multi-source is not being enabled.
- [ ] If enabling multi-source: set both `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE=1`
      and `testIntelligence.multiSourceEnabled: true`.
- [ ] If using the Jira REST adapter: configure `createJiraGatewayClient` with
      the appropriate auth type (see `docs/runbooks/jira-source-setup.md`).
- [ ] If deploying in an air-gapped environment: use the paste-only path
      (see `docs/runbooks/multi-source-air-gap.md`).
- [ ] If using four-eyes review with multi-source: add
      `"multi_source_conflict_present"` to `fourEyesVisualSidecarTriggerOutcomes`
      (see `docs/eu-ai-act/human-oversight.md`).
- [ ] Review `COMPATIBILITY.md` multi-source matrix for the source-mix rules.
- [ ] Update `src/contract-version.test.ts` `EXPECTED_*_RUNTIME_EXPORTS` arrays
      when importing new exported constants (see `docs/test-intelligence.md`
      §15 for the contract surface).

---

## 6. Fallback rules

| Scenario                                        | Fallback behavior                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| Multi-source gate disabled                      | Runtime behaves identically to Wave 3; no `sources/` directory created  |
| Jira REST API unavailable                       | Use `jira_paste` source kind as fallback (paste-only path)              |
| Only custom sources present                     | Refused with `primary_source_required` before any artifact written      |
| `conflictResolutionPolicy` not set              | Defaults to `reviewer_decides` for multi-primary-source envelopes       |
| Reconciliation conflict with `reviewer_decides` | Four-eyes review triggered; case blocked until second reviewer approves |

---

## 7. See also

- `COMPATIBILITY.md` — multi-source source-mix matrix
- `CONTRACT_CHANGELOG.md` §4.11.0–4.16.0 — detailed contract changelog
- `docs/test-intelligence.md` §14 — Wave 4 multi-source gate
- `docs/api/test-intelligence-multi-source.md` — public API reference
- `docs/runbooks/jira-source-setup.md` — Jira setup guide
- `docs/runbooks/multi-source-air-gap.md` — air-gap deployment
