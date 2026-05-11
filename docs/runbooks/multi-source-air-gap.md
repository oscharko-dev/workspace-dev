# Runbook — Multi-Source Air-Gap Deployment (Paste-Only)

**Audience:** Platform operators deploying workspace-dev in zero-egress or
restricted-network environments where outbound Jira API calls are not
permitted.

**Prerequisite:** The parent test-intelligence gate must already be enabled.
See `docs/test-intelligence.md` §1 for the full enablement procedure.

---

## 1. Overview

In air-gapped or zero-egress environments, the Jira REST adapter
(`jira_rest`) cannot make outbound API calls to Jira Cloud or an internal
Jira Data Center. Paste-only mode (`jira_paste`) provides equivalent
functionality without any outbound network calls:

1. A reviewer copies relevant Jira issue text from the Jira UI (or an
   approved export) and pastes it into the workspace-dev Inspector UI.
2. The workspace-dev runtime parses the paste body locally and constructs a
   canonical Jira IR.
3. From this point forward the pipeline is identical to the REST-sourced path.

No outbound network calls are made after the reviewer submits the paste.
`pnpm run test:ti-eval` also performs no outbound calls; it uses deterministic
mock gateways throughout.

---

## 2. Install topology for zero-egress environments

```
[Air-gapped network]
        │
        ├── workspace-dev runtime (Node.js 22+)
        │     • FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1
        │     • FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE=1
        │     • WORKSPACE_TI_REVIEW_BEARER_TOKEN=<internal-token>
        │     • No JIRA_API_TOKEN needed
        │
        ├── Reviewer workstation (browser)
        │     • Inspector UI at http://127.0.0.1:1983/workspace/ui/inspector
        │     • Jira UI (read access, air-gapped Jira or approved export)
        │
        └── Artifact storage (local disk / internal NAS)
              • <outputRoot>/.workspace-dev/<jobId>/
```

No external DNS resolution, no outbound TLS, no Atlassian API calls.

---

## 3. Step-by-step: paste-only Jira workflow

### Step 1 — Start the runtime

```bash
export FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1
export FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE=1
export WORKSPACE_TI_REVIEW_BEARER_TOKEN="<your-internal-token>"

node -e "
  const { createWorkspaceServer } = require('workspace-dev');
  createWorkspaceServer({
    host: '127.0.0.1',
    port: 1983,
    outputRoot: '.workspace-dev',
    testIntelligence: {
      enabled: true,
      multiSourceEnabled: true,
      reviewBearerToken: process.env.WORKSPACE_TI_REVIEW_BEARER_TOKEN,
    },
  }).then(s => s.listen());
"
```

Verify the multi-source gate is active:

```bash
curl -s http://127.0.0.1:1983/readyz | python3 -m json.tool | grep testIntelligence
```

Expected:

```json
{ "testIntelligenceEnabled": true, "testIntelligenceMultiSourceEnabled": true }
```

### Step 2 — Copy Jira issue content

Open the Jira issue in your browser. Copy the relevant fields. A minimal
paste body that workspace-dev can parse looks like:

```
Key: PAY-1434
Summary: SEPA payment approval — sandbox test
Status: Open
Priority: High
Description:
  The user initiates a SEPA credit transfer of EUR 250.00.
  The system must validate the IBAN, confirm the payer's balance is
  sufficient, and display a confirmation screen within 5 seconds.

Acceptance Criteria:
  1. IBAN is validated per ISO 13616.
  2. Balance check is performed before submission.
  3. Confirmation screen appears within 5 seconds of submit.
  4. Confirmation email dispatched within 30 seconds.
```

`format` can be `plain_text` (as above), `markdown`, or `adf_json` (for a
raw Jira ADF JSON document copied from the Jira REST API response).

### Step 3 — Submit via Inspector UI

Open `http://127.0.0.1:1983/workspace/ui/inspector` in your browser.

Navigate to **Test Intelligence → Sources → Jira Paste**. Paste the copied
content into the text area and click **Submit**.

Or submit directly via the HTTP API:

```bash
curl -s -X POST \
  http://127.0.0.1:1983/workspace/test-intelligence/sources/<jobId>/jira-paste \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-internal-token>" \
  -d '{
    "format": "auto",
    "body": "Key: PAY-1434\nSummary: SEPA payment approval — sandbox test\n..."
  }'
```

`format: "auto"` detects plain text, ADF JSON, and Markdown automatically.

### Step 4 — Verify paste provenance

Check the paste-provenance artifact to confirm the paste was accepted and
associated with the correct reviewer:

```bash
SOURCE_ID="<sourceId-from-jira-paste-response>"
cat ".workspace-dev/<jobId>/sources/${SOURCE_ID}/paste-provenance.json"
```

Expected fields:

```json
{
    "pasteSessionId": "...",
    "authorHandle": "reviewer-a",
    "capturedAt": "2026-04-27T...",
    "detectedFormat": "plain_text",
    "contentHash": "<sha256-of-original-paste-bytes>"
}
```

The raw paste body is not present in this file. The `contentHash` is the
SHA-256 of the original paste bytes, allowing auditors to prove which paste
was submitted without storing its content.

### Step 5 — Add custom context (optional)

For Jira-paste-only jobs, reviewers can also supply supplementary Markdown
context. This is especially useful when the Jira issue description is sparse:

```bash
curl -s -X POST \
  http://127.0.0.1:1983/workspace/test-intelligence/sources/<jobId>/custom-context \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-internal-token>" \
  -d '{
    "markdown": "## Regulatory context\n\n- This payment flow falls under PSD2 SCA requirements.\n- Two-factor authentication is mandatory for amounts above EUR 30.",
    "attributes": [
      { "key": "regulatoryScope", "value": "PSD2" },
      { "key": "dataClass", "value": "PCI-DSS-3" }
    ]
  }'
```

Custom context requires a primary source (Jira paste) to already exist for
the job. A custom-only submission is refused with `primary_source_required`.

See `docs/dpia/custom-context-source.md` for the Markdown subset allowed
in air-gapped environments.

---

## 4. Paste-collision resolution

When a reviewer accidentally submits the same Jira issue key twice (via two
separate paste submissions), the envelope validator detects the duplicate
`canonicalIssueKey` and returns `duplicate_jira_paste_collision`.

**To resolve:**

1. Identify the duplicate by inspecting the existing sources:

```bash
ls .workspace-dev/<jobId>/sources/
```

2. The first paste was already accepted. Inspect the existing
   `jira-issue-ir.json` to verify it is correct.
3. If the second paste is the correct one (e.g., the first was an error):
    - Remove the incorrect source with
      `DELETE /workspace/test-intelligence/jobs/<jobId>/sources/<sourceId>`.
    - Resubmit the correct paste.
    - Use the new server-returned `sourceId` and artifact paths from the
      response. Paste requests do not accept client-supplied `sourceId`
      values.
4. Do not modify `jira-issue-ir.json` files directly; the `contentHash` would
   become invalid and verification would fail.

---

## 5. Evidence-export-only workflow

After test-case generation and review approval, run the deployment's configured
export pipeline. The Inspector review HTTP route records review transitions;
it does not perform evidence export itself.

The export pipeline produces:

- `testcases.json`, `testcases.csv`, `testcases.alm.xml` — QC artifacts
- `export-report.json` — export evidence with `rawScreenshotsIncluded: false`
- `qc-mapping-preview.json` — QC mapping preview

All artifacts are written locally under `.workspace-dev/<jobId>/`. Keep
`allowApiTransfer` disabled for air-gapped paste-only deployments. No outbound
API transfer is performed unless the admin gate is explicitly enabled and the
deployment has a configured Jira/ALM connection.

---

## 6. Reviewer onboarding in air-gapped environments

Provide new reviewers with:

1. The Inspector URL: `http://127.0.0.1:1983/workspace/ui/inspector`.
2. Their reviewer handle and bearer token. Handles must match
   `^[A-Za-z0-9._-]{1,64}$`.
3. Instructions for:
    - Locating the Jira issue to paste (Jira is accessible read-only).
    - Navigating to **Test Intelligence → Sources → Jira Paste** in the
      Inspector.
    - Submitting the paste.
    - Reviewing generated test cases: approving, rejecting, or requesting
      clarification.
    - For four-eyes: a second reviewer with a different handle and token must
      independently approve high-risk cases.

Reviewer handles and tokens are configured in `WorkspaceStartOptions.testIntelligence.reviewPrincipals`.

---

## 7. Markdown editor guidance for restricted environments

When using the custom-context Markdown editor in air-gapped environments:

- The **UI preview is sanitized client-side** but the **server-side
  canonicalizer is authoritative**. A paste that renders correctly in the
  preview may still be rejected at submission if it contains disallowed
  elements.
- **Allowed Markdown subset:** headings, paragraphs, ordered/unordered lists,
  task-list checkboxes, tables, blockquotes, inline code, fenced code blocks,
  emphasis, strong, and links with redacted hrefs.
- **Not supported:** raw HTML, SVG, iframe, script, `javascript:` or `data:`
  URLs, MDX/JSX, frontmatter, Mermaid/diagram execution.
- Links with hrefs pointing to private or link-local addresses are rejected
  at submission. Do not include internal server addresses in Markdown context.
- Keep Markdown entries under 32 KiB raw input. The canonicalizer enforces
  this limit and returns an error if exceeded.

**Troubleshooting rejected Markdown:**

| Error                          | Cause                                            | Resolution                                      |
| ------------------------------ | ------------------------------------------------ | ----------------------------------------------- |
| `markdown_html_refused`        | Raw HTML (`<div>`, `<b>`, etc.) in the body      | Use Markdown equivalents (`**bold**`, headings) |
| `markdown_unsafe_url_refused`  | `javascript:` or `data:` in a link href          | Remove the link or use a plain-text reference   |
| `markdown_unsafe_url_refused`  | Link href points to a private/link-local address | Remove the link                                 |
| `markdown_raw_too_large`       | Raw Markdown exceeds 32 KiB                      | Split into multiple custom-context submissions  |
| `markdown_canonical_too_large` | Canonical form exceeds 16 KiB                    | Shorten the content; remove redundant sections  |

---

## 8. Air-gap fixture verification

Run the Wave 4 air-gap fixture end-to-end while following this runbook:

```bash
pnpm run test:ti-eval
```

The `test:ti-eval` script runs `runWave4ProductionReadiness` with the
full paste-only fixture set. All 121+ tests should pass without any
outbound network calls. The fixture catalog is in
`src/test-intelligence/multi-source-fixtures.ts`.

To run only the paste-only subset:

```bash
pnpm exec tsx --test "src/test-intelligence/jira-paste-ingest.test.ts" \
              "src/test-intelligence/multi-source-production-readiness.test.ts"
```

---

## 9. See also

- `docs/test-intelligence.md` §14 — Wave 4 multi-source gate
- `docs/runbooks/jira-source-setup.md` — full Jira REST API setup (non-air-gap)
- `docs/dpia/jira-source.md` — DPIA addendum
- `docs/dpia/custom-context-source.md` — custom context DPIA
- `docs/migration/wave-4-additive.md` — migration from single-source
- `COMPATIBILITY.md` — multi-source source-mix matrix
