# Import from Figma directly

This guide explains how to move a Figma selection into the WorkspaceDev Inspector
without going through the Figma REST API. Two direct paths are supported:

- **Figma plugin** — copies a structured, versioned JSON envelope to the
  clipboard (`figmaSourceMode=figma_plugin`). Recommended WorkspaceDev path
  for structured cross-tool transfer.
- **Raw JSON paste / drop / upload** — paste or drop a REST-shaped Figma JSON
  document (`figmaSourceMode=figma_paste`). Useful offline, behind a firewall,
  or when you cannot run the plugin.

A third path, **Enter Figma URL**, is available in the same Inspector zone.
The Inspector submits `figmaSourceMode=figma_url`, and the server normalizes
that inspector-only alias to `hybrid` before fetching from Figma. It is not
part of the public mode-lock surface and is not covered here in detail.

For backend mode lock and submit-field requirements, see
[README — Scope and mode lock](../README.md#scope-and-mode-lock) and
[README — Required submit input](../README.md#required-submit-input).

## Prerequisites

- WorkspaceDev runtime started locally (`npx workspace-dev start`).
- A modern Chromium-based browser, Firefox, or WebKit for the Inspector UI.
- For the **plugin** path: Figma Desktop or `figma.com`, and a Figma file you
  can open (Design Mode or Dev Mode).
- Clipboard access requires a **secure context**. `http://127.0.0.1:1983` is
  treated as secure by browsers; remote or reverse-proxied hosts must use
  HTTPS, otherwise paste is rejected with
  `"Clipboard access requires a secure (https) context."`.

No additional feature flag is required. The plugin path is selected
automatically when the Inspector detects the WorkspaceDev clipboard envelope.

## Path A — Figma plugin (recommended)

The plugin source lives in [`plugin/`](../plugin/) and writes a small JSON
envelope to the clipboard. The manifest declares
`editorType: ["figma", "dev"]`, so the plugin is available in both Design Mode
and Dev Mode.

### 1. Install the plugin (development load)

1. Open any Figma file.
2. Go to **Plugins → Development → Import plugin from manifest…**.
3. Select `plugin/manifest.json` from this repository.
4. Launch **WorkspaceDev Export** from the development plugins list.

To verify Dev Mode availability, switch the same file into **Dev Mode** and
confirm **WorkspaceDev Export** appears in the Dev Mode plugin list.

### 2. Prepare the selection

1. Click a single frame or component on the canvas, or Shift+click several.
2. Leave the selection in place while the plugin window is open.

### 3. Copy to clipboard (or download JSON)

In the plugin UI:

- **Copy to Clipboard** — writes the envelope to the system clipboard. On
  success the status area shows
  `"Copied to clipboard. Paste into WorkspaceDev Inspector."`.
- **Download JSON** — saves `workspace-dev-export.json` locally. Use this
  when the host blocks clipboard access, or when you need to transfer the
  payload out of band (email, secure file drop).

If nothing is selected, the plugin shows
`"No nodes selected. Please select at least one layer."` and no clipboard
write happens.

### 4. Paste into the Inspector

1. Open `http://127.0.0.1:1983/workspace/ui/inspector`.
2. Click anywhere in the middle column (labelled **Import**, aria-labelled
   **Paste area**).
3. Press **⌘V** (Mac) or **Ctrl+V** (Windows).
4. The SmartBanner above the paste area shows the detected type:
   **Plugin Export** with a confidence percentage.
5. Click **Import starten** to confirm and submit.

After import, the standard workspace views remain available at
`/workspace/ui` and `/workspace/<figmaFileKey>`.

The Inspector submits the payload with `figmaSourceMode=figma_plugin`.

## Path B — Raw JSON paste, drop, or upload

If you already have a Figma REST JSON document on disk (for example a
`figma.json` from a previous export or a CI artifact), you do not need the
plugin.

From the **Import** column in the Inspector:

- **Paste** — click into the area and paste JSON text with ⌘V / Ctrl+V.
- **Drop** — drag a `.json` file onto the area. Only the first dropped file
  is read. Non-JSON files are rejected with
  `"Unsupported file. Please drop or upload a .json file with the Figma export."`.
- **Upload JSON file** — button opens a file picker (`accept=".json,application/json"`).

The SmartBanner detects and labels the payload as **Figma-Dokument JSON** (full
document) or **Figma-Node JSON** (a single node subtree or a node array). Both
submit with `figmaSourceMode=figma_paste`.

You can override the detected type from the SmartBanner `<select>` before
clicking **Import starten** (aria-label: **Erkannten Typ korrigieren**).

## Path C — Direct plugin handoff ("Send to WorkspaceDev")

The plugin's **Send to WorkspaceDev** button posts the export payload directly
to the local backend over HTTP, without requiring any clipboard interaction or
manual paste step.

### How it works

The fetch call is made from `code.js` (the plugin main thread), not from the
UI iframe. This sidesteps browser CORS restrictions: the server at
`http://127.0.0.1:1983` rejects cross-origin preflight requests with 405 by
design, but `code.js` runs in a non-browser sandbox where CORS does not apply.

### Usage

1. Select one or more frames or components on the Figma canvas.
2. In the plugin UI, confirm the **WorkspaceDev URL** field shows
   `http://127.0.0.1:1983` (or enter a different URL if using a non-default
   port).
3. Click **Send to WorkspaceDev**.
4. On success, the status area shows
   `"Sent! Job <jobId> is processing."` with a clickable link to the job page.
5. On failure, the status area shows the server's error message and, when
   available, a request ID for support.

The payload is submitted with `figmaSourceMode=figma_plugin`, identical to the
clipboard paste path. No clipboard access or paste step is required.

### Manifest port note

The plugin manifest declares `networkAccess.allowedDomains` to control which
domains `code.js` may fetch. The default is `["http://127.0.0.1:1983"]`. If
WorkspaceDev is running on a different port, update this list in
`plugin/manifest.json` and reload the plugin in Figma.

## Inspector paste-zone reference

| Input mode        | Trigger                                      | Notes                                                                                                                         |
| ----------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Paste (clipboard) | ⌘V / Ctrl+V with focus inside **Paste area** | Reads both `text/plain` and `text/html` from the clipboard.                                                                   |
| Drag & drop       | Drop a `.json` file onto the column          | First file only; must be `.json` or `application/json`.                                                                       |
| Upload JSON file  | **Upload JSON file** button                  | Same validation as drop.                                                                                                      |
| Enter Figma URL   | **Enter Figma URL** form                     | Inspector-only submit alias (`figmaSourceMode=figma_url`); the server normalizes it to `hybrid` before the REST-backed fetch. |

### SmartBanner intents

`SmartBanner` labels are shown after classification completes:

| Intent                  | Label (UI)            | Submitted as       |
| ----------------------- | --------------------- | ------------------ |
| `FIGMA_PLUGIN_ENVELOPE` | `Plugin Export`       | `figma_plugin`     |
| `FIGMA_JSON_DOC`        | `Figma-Dokument JSON` | `figma_paste`      |
| `FIGMA_JSON_NODE_BATCH` | `Figma-Node JSON`     | `figma_paste`      |
| `RAW_CODE_OR_TEXT`      | `Code / Text`         | rejected on submit |
| `UNKNOWN`               | `Unbekannt`           | rejected on submit |

`figma_url` exists only as the Inspector's URL-submit alias. The public
mode-lock surface remains the runtime-backed modes documented in the README.

### Programmatic vs paste submission

Two hook methods handle submission, and they serve different callers:

- **`submit({ figmaJsonPayload, sourceMode? })`** — programmatic / test /
  non-UI handoff inside the Inspector hook. The caller already knows the
  runtime `figmaSourceMode` and provides pre-validated Figma JSON. It defaults
  to `figma_paste` and can opt into `figma_plugin` explicitly. No intent
  classification, no SmartBanner.
- **`submitPaste(text, { source?, clipboardHtml? })`** — interactive paste
  path. Runs `classifyPasteIntent` on the raw input and shows the SmartBanner
  for the user to confirm or correct the detected intent before submitting.

`classifyPasteIntent` is designed for free-form strings, and the SmartBanner
is an interactive modal that requires user input; both are unsuitable for
headless or server-to-server callers. For actual offline / CLI / firewall
integrations outside the UI, call `POST /workspace/submit` directly and set the
request `figmaSourceMode` explicitly. The Inspector upload / paste / drop flow
remains interactive and uses `submitPaste()`. See Issue #1022 for the
decision.

### Size limits

- Client guard (Zod): **6 MiB** per `figmaJsonPayload`. Exceeding this raises
  `"Figma JSON payload must be 6 MiB or less."` before submit.
- Server default: **6 MiB** (`DEFAULT_FIGMA_PASTE_MAX_BYTES`). Override with
  the `WORKSPACE_FIGMA_PASTE_MAX_BYTES` env var on the runtime process (value
  is a positive integer in bytes).
- Submit transport cap: **8 MiB** on `POST /workspace/submit`. The paste cap
  override cannot exceed this transport budget.
- Dropped or uploaded files larger than the cap show
  `"Payload is too large. The limit is 6 MiB."`.

## Example payloads

### Plugin envelope — `workspace-dev/figma-selection@1`

The plugin writes an object of this shape to the clipboard:

```json
{
  "kind": "workspace-dev/figma-selection@1",
  "pluginVersion": "0.2.0",
  "copiedAt": "2026-04-15T09:30:00.000Z",
  "selections": [
    {
      "document": {
        "id": "123:456",
        "type": "FRAME",
        "name": "Home / Hero"
      },
      "components": {},
      "componentSets": {},
      "styles": {}
    }
  ]
}
```

Required fields: `kind`, `pluginVersion` (non-empty), `copiedAt` (non-empty),
`selections` (≥ 1 entry). Each selection requires `document.id`,
`document.type`, `document.name`, and object-typed `components`,
`componentSets`, `styles`. See
[`src/clipboard-envelope.ts`](../src/clipboard-envelope.ts) for the full
validator.

### REST JSON — `JSON_REST_V1`

The Inspector shows an example skeleton for REST-shaped JSON:

```json
{
  "document": {
    "id": "0:0",
    "name": "Document",
    "type": "DOCUMENT",
    "children": []
  },
  "schemaVersion": "JSON_REST_V1"
}
```

### HTTP submit (plugin envelope from a file)

```bash
curl -sS -X POST http://127.0.0.1:1983/workspace/submit \
  -H 'content-type: application/json' \
  -d "$(jq -n --rawfile figma ./workspace-dev-export.json '{
    figmaSourceMode: \"figma_plugin\",
    figmaJsonPayload: $figma,
    enableGitPr: false,
    llmCodegenMode: \"deterministic\"
  }')"
```

## Path D - Figma URL (hybrid MCP + REST fallback)

The Inspector's **Enter Figma URL** form is the WorkspaceDev path that exercises
the MCP-backed resolver from Issue #1000. The browser submits the Inspector-only
alias `figmaSourceMode=figma_url`, and the server normalizes that alias to
`figmaSourceMode=hybrid` before the job starts.

This is intentionally **not** a public `figmaSourceMode=mcp` surface. In this
repository, MCP is an implementation detail of `hybrid`, not a standalone
mode-lock option.

### 1. What the resolver does

For `hybrid`, WorkspaceDev combines direct Figma REST access with MCP
enrichment:

1. Resolve the file and candidate screen subtree from the Figma REST payload.
2. Call `get_design_context` for the primary node.
3. Call `get_metadata` when the resolver needs the XML node tree to recover a
   stable root node, node count, or root-layer metadata.
4. Call `get_screenshot` for a preview when screenshot capture is enabled.
5. Call `get_variable_defs` and `search_design_system` to enrich tokens,
   variables, and component/library matches.

The default MCP endpoint is `https://mcp.figma.com/mcp`. The current runtime
export is `DEFAULT_MCP_SERVER_URL` in
[`src/job-engine/figma-mcp-resolver.ts`](../src/job-engine/figma-mcp-resolver.ts).

### 2. Credentials and environment

`hybrid` requires a Figma file key plus a token that can read the target file.
WorkspaceDev uses the same token for both the Figma REST API fallback and the
hosted MCP endpoint.

| Variable | Required | Purpose |
| --- | --- | --- |
| `FIGMA_ACCESS_TOKEN` | Yes for `figma_url` / `hybrid` flows | Used for direct REST reads and for MCP bearer auth in the local runtime. |
| `WORKSPACE_DEV_MCP_SERVER_URL` | Optional | Overrides the default hosted MCP URL for enterprise, test, or mock deployments. |
| `WORKSPACE_ALLOW_INSECURE_MCP=true` | Optional, dev-only | Allows a loopback `http://127.0.0.1` / `localhost` MCP override. Production rejects plain HTTP without this opt-in. |

For the token itself:

- Figma's REST docs use **personal access tokens (PATs)** for direct API
  access.
- Figma's Help Center says PATs are created from **Settings -> Security -> Personal access tokens**.
- The token value is shown only once at creation time.
- PATs are broad-scope account credentials. Treat them like a secret and revoke
  them when no longer needed.

For general MCP onboarding, Figma's official docs recommend the **remote MCP
server** and supported clients, and they use a Figma sign-in / **Allow access**
flow. WorkspaceDev keeps its own runtime path in `hybrid` mode and does not ask
you to switch the submit mode to `mcp`.

### 3. Tool order, retries, and fallback signals

When the MCP leg succeeds, the job records successful MCP read-tool usage and
the Inspector can surface the local budget banner. When MCP fails or exhausts
its retries, WorkspaceDev continues in REST mode when possible and surfaces the
fallback in diagnostics and UI state.

- MCP `429` responses record `W_MCP_RATE_LIMITED`. When `Retry-After` is
  present, WorkspaceDev waits for that value before retrying; otherwise it uses
  bounded exponential backoff starting at 500 ms.
- If MCP still fails, the resolver emits `W_MCP_FALLBACK_REST` and continues
  with the REST API when a valid `FIGMA_ACCESS_TOKEN` is available.
- If only the screenshot call fails, the resolver keeps the MCP design context
  and emits `W_MCP_SCREENSHOT_FALLBACK_REST` when the REST screenshot fallback
  succeeds.
- In the Inspector, hybrid fallback shows a `Figma REST fallback active` badge
  in the status bar.
- Rate-limited pipeline errors surface a retry countdown (`Retry available in
  Ns`) in the error banner and status bar.

Figma also documents plan- and seat-based limits for the hosted MCP server and
for the REST API. See Figma's
[MCP plans/access guide](https://developers.figma.com/docs/figma-mcp-server/plans-access-and-permissions/)
and [REST rate-limit reference](https://developers.figma.com/docs/rest-api/rate-limits/).

### 4. Live Inspector and hybrid test runs

To exercise the hosted Figma path in live runs, make sure the job is actually
submitted in `hybrid` mode (or via the Inspector URL path, which normalizes to
`hybrid`). Supplying `FIGMA_FILE_KEY` and `FIGMA_ACCESS_TOKEN` alone is not
enough if the submit stays on plain `rest`.

Common live-run env vars in this repository:

- `FIGMA_FILE_KEY` - live board/file under test.
- `FIGMA_ACCESS_TOKEN` - required for the live Figma calls.
- `INSPECTOR_LIVE_E2E=1` - enables live Inspector Playwright suites under
  `ui-src/e2e/*.live.spec.ts`.
- `WORKSPACE_DEV_VISUAL_BASELINE_PATH` - optional screenshot baseline override
  for `ui-src/e2e/visual-parity.live.spec.ts`.
- `WORKSPACE_DEV_VISUAL_AUDIT_MODE=strict` - turns visual parity warnings into
  hard failures.

The main live test surfaces are:

- `src/parity/*.live.e2e.test.ts` for Node-side parity and analysis checks.
- `ui-src/e2e/*.live.spec.ts` for Inspector and visual regression flows.

The operator-facing benchmark maintenance commands under `integration/`
(`pnpm benchmark:visual:live`, `pnpm benchmark:visual:update-fixtures`,
`pnpm visual:audit live`) are separate REST-token workflows. They do not
require MCP server setup; see [`CONTRIBUTING.md`](../CONTRIBUTING.md#choosing-the-correct-live-audit).

## Scope, re-import, and delta mode

This section covers the Inspector controls that appear after an import reaches
`ready` or `partial`.

### Multi-select scope and `Generate Selected`

When the Inspector has a design tree, the left-hand tree adds a checkbox column
with subtree-aware tri-state semantics:

- `aria-checked="true"`: the node and its visible descendants are selected.
- `aria-checked="mixed"`: only part of the subtree is selected.
- `aria-checked="false"`: the node is excluded from the next scoped rerun.

The checkbox toggles scope only; clicking the row still changes the active node
selection for preview/diff/editing. Parent toggles apply to the whole subtree,
and the tree toolbar exposes `Select All` / `Deselect All` for the current
visible tree.

The Inspector toolbar exposes four scope presets:

- `Just this` - rerun only the currently selected node.
- `+ Children` - rerun the selected node plus its descendants.
- `All screens` - reset the scope to a full rerun.
- `Changed` - after a re-import diff exists, scope to the nodes marked as added
  or modified.

`Generate Selected` submits the current scope:

- When everything is selected, it re-runs the full import and sends `[]` as the
  scoped node list.
- When part of the tree is deselected, it re-runs only the selected nodes.
- When nothing is selected, the button is disabled.

### Re-import prompt and update diff

The re-import banner appears when the current import matches a previous import
session. Matching prefers the server-supplied `pasteIdentityKey`; when that is
not available, WorkspaceDev can fall back to the same Figma `fileKey` +
`nodeId` locator.

The banner offers three actions:

- `Regenerate changed` - rerun the import in delta mode for all changed nodes.
- `Regenerate selected` - rerun only the currently selected changed nodes.
- `Create new` - force a fresh full import instead of updating the existing one.

When the current run includes a delta summary, the banner also shows an inline
hint such as `2 of 10 nodes changed since last import`.

Below the toolbar, the Inspector renders an `Update diff` panel with
`Added` / `Modified` / `Removed` / `Unchanged` counts. The tree mirrors this
with colored node markers:

- green dot - added since the last import
- amber dot - modified since the last import
- rose dot - removed since the last import

Use the existing code pane and diff controls to review the generated file
changes after a rerun.

### Import history and replay

The `History` button opens the Import History panel. WorkspaceDev keeps the
latest 20 import sessions, sorted newest-first. The backing store is persisted
under `<outputRoot>/import-sessions/import-sessions.json`; with the default
local runtime layout, that path is `.workspace-dev/import-sessions/import-sessions.json`.

Each row can expose up to three actions:

- `Re-import` - start a new job from the saved locator.
- `Delete` - remove the session from history.
- `Log` - expand the persisted audit trail for that session.

Replay is only enabled when the session is still replayable. In practice that
usually means the stored session still has a usable Figma file key (and, when
needed, node id). History re-imports submit through the URL-backed hybrid path,
so `FIGMA_ACCESS_TOKEN` must still be configured in the local runtime.

To clear history from the UI, delete the rows you no longer need. Removing the
last row removes the backing store file as part of best-effort cleanup.

### URL entry and frame targeting

The Inspector accepts direct Figma file URLs from the paste zone's
`Enter Figma URL` form.

- Accepted parser shapes include `https://figma.com/design/...`,
  legacy `https://figma.com/file/...`, and branch URLs.
- Paste a frame URL when you already know the target node.
- If you paste a file-level URL without `node-id`, the Inspector asks for a
  frame URL or a raw node id before enabling `Open design`.
- Branch URLs are accepted; WorkspaceDev resolves the branch key as the
  effective file key for MCP/REST access.
- FigJam, Figma Make, and community URLs are rejected by this path.

### Delta mode, fallback, and cache invalidation

Delta mode is backed by on-disk fingerprint manifests in
`<outputRoot>/paste-fingerprints/`. In the default local runtime layout this is
`.workspace-dev/paste-fingerprints/`.

- First import of a diffable source creates a baseline and reports
  `strategy: baseline_created`.
- Re-import of the same Figma file/root set can resolve to delta reuse
  (`strategy: no_changes` or `strategy: delta`) when WorkspaceDev can load the
  prior manifest and match it to the source job/file key.
- If the structure changed too much, the prior source job no longer matches,
  the file key is missing, or changed roots cannot be resolved, delta falls
  back to a full rebuild. One explicit fallback reason is
  `strategy: structural_break`.

Two practical rules matter:

1. Delta reuse requires a usable Figma file key. Imports without one still get a
   summary, but they recreate the baseline instead of reusing prior output.
2. The `Changed` preset is driven by the IR diff from the previous import, not
   by a heuristic text search over generated files.

Fingerprint manifests are retained for 30 days and the store trims itself to a
64-entry least-recently-used window based on access time.

When you need to invalidate the delta cache manually, delete the relevant
manifest file or remove `<outputRoot>/paste-fingerprints/` entirely while the
runtime is stopped. The next import recreates a fresh baseline automatically.

## FAQ

**Can I paste any Figma copy directly?**
No. WorkspaceDev understands the plugin envelope (`workspace-dev/figma-selection@1`)
and REST-shaped JSON (`JSON_REST_V1`). Direct HTML from Figma's native copy is
explicitly rejected with
`"Direct Figma clipboard HTML is not importable here yet. …"`.

**Do I need a Figma access token for the paste or plugin path?**
No. Only `figmaSourceMode=rest` and `hybrid` require `figmaAccessToken`. The
paste and plugin paths carry the full payload inline, so no REST call is made.

**What's the payload size limit?**
6 MiB per `figmaJsonPayload`. Override the server cap with
`WORKSPACE_FIGMA_PASTE_MAX_BYTES` (bounded by the 8 MiB submit transport cap).

**How do I pick a single frame instead of a whole page?**
Select it on the Figma canvas before running the plugin. Multi-selection also
works (Shift+click). Each selected node becomes one entry in `selections[]`.

**What's the minimum plugin version?**
The Inspector does not enforce a minimum. `pluginVersion` is validated only
for non-emptiness and echoed back in telemetry. Update the plugin when a new
envelope schema is released (e.g. `@2`).

**Can I debug the detected intent?**
Yes. The SmartBanner shows the intent label and a confidence percentage (e.g.
`Plugin Export  95%`). Use the `<select>` to override before clicking
**Import starten**.

## Troubleshooting

### Inspector error-code reference

The Inspector normalizes runtime failures to the following `PasteErrorCode`
values. Use this table as the canonical code-to-recovery index when a banner,
status row, or support bundle includes one of these identifiers.

| Code | User-facing summary | Probable cause | Recovery action |
| --- | --- | --- | --- |
| <a id="error-code-clipboard-not-figma"></a>`CLIPBOARD_NOT_FIGMA` | The pasted content is not recognized as a supported Figma export. | The clipboard contains plain text, source code, unsupported HTML, or an unsupported clipboard envelope. | Copy a fresh Figma plugin export or a valid JSON export, then retry. |
| <a id="error-code-mcp-unavailable"></a>`MCP_UNAVAILABLE` | WorkspaceDev could not reach the Figma MCP path. | The MCP endpoint timed out, returned `503`, or failed before a successful REST fallback. | Retry later, verify `WORKSPACE_DEV_MCP_SERVER_URL` if overridden, and keep REST fallback credentials configured. |
| <a id="error-code-mcp-rate-limited"></a>`MCP_RATE_LIMITED` | The Figma MCP path rate-limited the request. | The hosted MCP endpoint or downstream Figma read path returned `429`. | Wait for the countdown or `Retry-After` window to finish, then retry. |
| <a id="error-code-file-not-found"></a>`FILE_NOT_FOUND` | WorkspaceDev could not resolve the copied Figma file. | The file key is wrong, the file was deleted, or the current token cannot view it. | Open the file in Figma, confirm the file key, and retry with an account that has access. |
| <a id="error-code-node-not-found"></a>`NODE_NOT_FOUND` | The referenced frame, layer, or component no longer exists. | The copied node ID drifted after the URL or payload was captured. | Copy a fresh Figma URL or selection and retry. |
| <a id="error-code-auth-required"></a>`AUTH_REQUIRED` | Figma authentication is required before the import can proceed. | `FIGMA_ACCESS_TOKEN` is missing, expired, revoked, or does not have access to the file. | Generate or refresh the token, update the runtime secret, and retry. |
| <a id="error-code-transform-partial"></a>`TRANSFORM_PARTIAL` | The import finished with skipped or unsupported elements. | Some nodes could not be transformed into the internal design representation. | Review the partial-result details, fix or remove unsupported nodes, and retry if needed. |
| <a id="error-code-codegen-partial"></a>`CODEGEN_PARTIAL` | The import succeeded, but some generated files failed. | Code generation completed only for part of the output set. | Inspect the failed file list, keep the successful output, and retry the failed generation step. |
| <a id="error-code-payload-too-large"></a>`PAYLOAD_TOO_LARGE` | The pasted design exceeds the configured import size limit. | The clipboard payload or uploaded JSON file is larger than the allowed cap. | Import a smaller selection or raise `WORKSPACE_FIGMA_PASTE_MAX_BYTES` within the transport limit. |
| <a id="error-code-schema-mismatch"></a>`SCHEMA_MISMATCH` | The pasted content is not valid for the expected Figma JSON schema. | The JSON is malformed, incomplete, or not a supported Figma export shape. | Re-export the JSON from Figma or use the WorkspaceDev plugin, then retry. |
| <a id="error-code-stage-failed"></a>`STAGE_FAILED` | A pipeline stage failed before the import could complete cleanly. | An intermediate pipeline step returned an unmapped or generic processing error. | Check the stage details, correct the underlying input or dependency problem, and retry. |
| <a id="error-code-job-failed"></a>`JOB_FAILED` | The overall import job did not complete successfully. | One or more pipeline stages failed and the job entered a terminal error state. | Review the job details, correct the underlying failure, and rerun the import. |
| <a id="error-code-poll-failed"></a>`POLL_FAILED` | The UI lost the job-status stream while waiting for results. | The browser lost network connectivity or the status poll endpoint could not be reached. | Refresh or retry after connectivity recovers. |
| <a id="error-code-submit-failed"></a>`SUBMIT_FAILED` | The browser could not start the import request. | The submit request failed before the job was accepted by the backend. | Check the runtime URL and network connection, then retry the submit action. |
| <a id="error-code-cancel-failed"></a>`CANCEL_FAILED` | The UI could not send the cancellation request. | The cancel request failed before the backend acknowledged it. | Refresh the job state and retry cancellation only if the import is still running. |
| <a id="error-code-missing-preview-url"></a>`MISSING_PREVIEW_URL` | The import completed, but the generated preview URL is missing. | The backend finished the job without attaching the preview link expected by the Inspector. | Retry to regenerate the preview and inspect the job details if the problem persists. |

Bootstrap and submit validation can still surface raw pre-normalization aliases.
Use the canonical row above as the landing page when you encounter one of these
identifiers in logs, copied reports, or Inspector state:

| Alias code | Maps to | Notes |
| --- | --- | --- |
| `INVALID_PAYLOAD` | [`SCHEMA_MISMATCH`](#error-code-schema-mismatch) | Pre-submit validation rejected a payload that is not a supported Figma JSON shape. |
| `TOO_LARGE` | [`PAYLOAD_TOO_LARGE`](#error-code-payload-too-large) | The raw bootstrap/server alias for the configured payload cap. |
| `UNSUPPORTED_FORMAT` | [`CLIPBOARD_NOT_FIGMA`](#error-code-clipboard-not-figma) | The clipboard envelope format or version is unsupported. |
| `UNSUPPORTED_CLIPBOARD_KIND` | [`CLIPBOARD_NOT_FIGMA`](#error-code-clipboard-not-figma) | The clipboard kind is not a supported WorkspaceDev/Figma import payload. |
| `UNSUPPORTED_FIGMA_CLIPBOARD_HTML` | [`CLIPBOARD_NOT_FIGMA`](#error-code-clipboard-not-figma) | Native Figma clipboard HTML is not importable through the Inspector yet. |
| `UNSUPPORTED_TEXT_PASTE` | [`CLIPBOARD_NOT_FIGMA`](#error-code-clipboard-not-figma) | Plain text, source code, or prose was pasted instead of a Figma export. |
| `UNSUPPORTED_UNKNOWN_PASTE` | [`CLIPBOARD_NOT_FIGMA`](#error-code-clipboard-not-figma) | The pasted content could not be matched to a supported import path. |
| `EMPTY_INPUT` | [`CLIPBOARD_NOT_FIGMA`](#error-code-clipboard-not-figma) | The paste/drop/upload action produced no importable payload. |
| `UNSUPPORTED_FILE` | See [Non-JSON file dropped or uploaded](#non-json-file-dropped-or-uploaded) | File validation failed before the canonical paste-error mapping applies. |
| `SECURE_CONTEXT_MISSING` | See [Nothing happens on Cmd/Ctrl+V](#nothing-happens-on-cmdctrlv) | Clipboard access was blocked because the browser context is not secure. |

### Nothing happens on Cmd/Ctrl+V

1. Click once inside the middle **Import** column to focus the paste target.
2. Confirm you are on `http://127.0.0.1:1983` or an HTTPS host — the Clipboard
   API requires a secure context. The Inspector surfaces
   `"Clipboard access requires a secure (https) context."` when this guard
   trips.
3. If the copy originated from Figma's native canvas (without the plugin),
   the paste is rejected as
   `"Direct Figma clipboard HTML is not importable here yet. Paste a JSON export or a supported WorkspaceDev plugin envelope instead."`
   Use the plugin or the **Upload JSON file** button instead. See
   [`CLIPBOARD_NOT_FIGMA`](#error-code-clipboard-not-figma).
4. Empty clipboard input surfaces
   `"Please paste, drop, or upload a Figma JSON export."`.

### "Invalid JSON" / payload not accepted

- `"That does not look like a Figma JSON export. Please paste a JSON_REST_V1 payload."` — the text parses as JSON but does not contain a Figma document (`document`, `type+children`, or an array of nodes). Re-export from Figma (File → Export) or use the plugin. See [`SCHEMA_MISMATCH`](#error-code-schema-mismatch).
- `"The payload does not match the expected Figma JSON_REST_V1 schema."` — the server rejected the payload shape. Compare your JSON against the [REST JSON example](#rest-json--json_rest_v1). See [`SCHEMA_MISMATCH`](#error-code-schema-mismatch).
- `"This paste looks like code or plain text, not a Figma JSON export. …"` — you pasted source code, HTML, or prose. Copy from Figma (plugin or File → Export) instead. See [`CLIPBOARD_NOT_FIGMA`](#error-code-clipboard-not-figma).
- `"This WorkspaceDev clipboard envelope version is not supported yet. Update the plugin or paste a supported envelope export."` — the envelope `kind` is newer or unknown. Reinstall the plugin from this repository's `plugin/manifest.json`. See [`CLIPBOARD_NOT_FIGMA`](#error-code-clipboard-not-figma) and the alias rows for `UNSUPPORTED_FORMAT` / `UNSUPPORTED_CLIPBOARD_KIND` above.

### Component is not recognized

- The envelope requires `selections[i].document.{id, type, name}` and object-typed
  `components`, `componentSets`, `styles`. Empty objects are valid; missing
  keys are not. If validation fails, the summarized message names the first
  missing or invalid field (e.g.
  `"document.id must be a non-empty string."`).
- If you confirmed **Plugin Export** but the detected payload is actually a
  raw node batch, the Inspector shows
  `"Plugin export JSON cannot be imported here yet. Paste a Figma JSON export or correct the detected type before starting the import."`
  Use the SmartBanner override to change the type to **Figma-Node JSON**.

### Payload too large

- Client message: `"Figma JSON payload must be 6 MiB or less."`.
- File drop / upload message:
  `"Payload is too large. The limit is 6 MiB."`.
- Copy a smaller section (single frame or component) instead of the full page,
  or raise the server cap via `WORKSPACE_FIGMA_PASTE_MAX_BYTES` (bounded by
  the 8 MiB submit transport cap). See
  [`PAYLOAD_TOO_LARGE`](#error-code-payload-too-large).

### Non-JSON file dropped or uploaded

`"Unsupported file. Please drop or upload a .json file with the Figma export."`
— only `.json` / `application/json` is accepted. Use the plugin's
**Download JSON** button to produce a valid file.

### Bypassing the detection

The confirm flow trusts the user's final SmartBanner selection. Setting the
type to `Code / Text` or `Unbekannt` always rejects on submit with
`"This paste looks like code or plain text, …"` or
`"This paste could not be matched to a supported Figma import path. …"`. See
[`CLIPBOARD_NOT_FIGMA`](#error-code-clipboard-not-figma).

### Partial or failed processing after submit

- `TRANSFORM_PARTIAL` indicates the import completed with skipped or unsupported
  nodes. Review the details panel, correct the unsupported nodes if needed, and
  retry only the affected selection. See
  [`TRANSFORM_PARTIAL`](#error-code-transform-partial).
- `CODEGEN_PARTIAL` means the design import succeeded but one or more generated
  files failed. Keep the successful output, inspect the failed file list, and
  rerun only the failed generation step. See
  [`CODEGEN_PARTIAL`](#error-code-codegen-partial).
- `STAGE_FAILED` is the generic pipeline-stage fallback when WorkspaceDev
  cannot map the failure to a narrower category. Use the stage details to find
  the underlying dependency or input issue before retrying. See
  [`STAGE_FAILED`](#error-code-stage-failed).
- `JOB_FAILED` means the overall import reached a terminal failure state.
  Review the job-level error details, correct the underlying issue, and rerun
  the import. See [`JOB_FAILED`](#error-code-job-failed).
- `MISSING_PREVIEW_URL` means the backend finished processing without attaching
  the preview link expected by the Inspector. Retry to regenerate the preview
  and inspect the job details if it happens again. See
  [`MISSING_PREVIEW_URL`](#error-code-missing-preview-url).

### Submit, polling, or cancel request failures

- `SUBMIT_FAILED` means the browser could not hand the import request to the
  backend. Verify the runtime URL and network path, then retry the submit
  action. See [`SUBMIT_FAILED`](#error-code-submit-failed).
- `POLL_FAILED` means the UI lost the job-status stream while waiting for
  results. Refresh or retry after network connectivity recovers. See
  [`POLL_FAILED`](#error-code-poll-failed).
- `CANCEL_FAILED` means the cancel request could not be delivered. Refresh the
  page to confirm whether the job is still running before retrying cancel. See
  [`CANCEL_FAILED`](#error-code-cancel-failed).

### Hybrid MCP / REST resolver

The URL-based `hybrid` path is the one that can surface MCP and REST resolver
errors in the Inspector.

| Error code / surface | What it means | Recovery |
| --- | --- | --- |
| `AUTH_REQUIRED` / 401 or invalid token | The runtime could not authenticate the Figma request. This is usually a missing, expired, or revoked `FIGMA_ACCESS_TOKEN`. | Generate a new PAT in Figma, update the runtime secret, and retry the same file. |
| `MCP_RATE_LIMITED` / 429 | The hosted MCP endpoint or downstream Figma read path rate-limited the request. WorkspaceDev preserves `Retry-After` when provided and shows a retry countdown. | Wait for the countdown to finish, then retry. If this happens repeatedly, check your Figma plan/seat limits and consider using a smaller file or lower-frequency live suite. |
| `MCP_UNAVAILABLE` / 503, timeout, or connection error | The MCP endpoint could not be reached or returned a transient server failure. If the job continues, the status bar shows `Figma REST fallback active`. | Retry later, verify `WORKSPACE_DEV_MCP_SERVER_URL` if you overrode it, and keep `FIGMA_ACCESS_TOKEN` configured so REST fallback can proceed. |
| `FILE_NOT_FOUND` / 404 | The file key is wrong, the file was deleted, or the token does not have access to the file. | Open the file in Figma, confirm the file key from the URL, and retry with a token from an account that can view the file. |
| `NODE_NOT_FOUND` / `E_FIGMA_NODE_NOT_FOUND` | The layer or frame in the copied URL no longer exists in the file version you are resolving. | Copy a fresh Figma URL or select a stable frame before retrying. |

For debugging, copied reports and raw job payloads may still include the lower-level
backend codes (`E_MCP_*`, `E_FIGMA_REST_*`, `E_FIGMA_NODE_NOT_FOUND`) alongside
the Inspector's generic banner/status mapping.

## Quality and governance

After an import reaches `ready` or `partial`, the Inspector adds a dedicated
review surface for import quality, token decisions, accessibility follow-up,
and governance. This is the same surface covered by the shipped `#993` and
`#994` behavior. For the backend event model and route semantics, see
[ARCHITECTURE.md - Import session governance (#994)](../ARCHITECTURE.md#import-session-governance-994).

### Pre-flight quality score

The **Pre-flight quality score** panel is derived locally in the Inspector from
artifacts that are already present in the browser session:

- Design IR shape and node counts
- Figma analyzer diagnostics
- component-manifest coverage
- pipeline errors already attached to the job

The score is deterministic and local-only. It does not upload the design or
generated code to an LLM, and it does not require an extra network round trip.

The panel shows:

- a numeric score from `0` to `100`
- a band label (`Excellent`, `Good`, `Fair`, `Poor`)
- Structure / Semantic / Codegen breakdown bars
- the highest-priority risk tags to review before applying the import

Workspace-level tuning comes from the repo-root policy file:
`/.workspace-inspector-policy.json`.

### Token matching intelligence

The **Token mapping intelligence** section summarizes token conflicts and
unmapped Figma variables detected during import. Reviewers can:

- toggle each row individually with its checkbox
- use `Accept all`
- use `Reject all`
- click `Apply decisions` to persist the current accepted/rejected token list

The default recommendations are influenced by the workspace policy:

- `tokens.autoAcceptConfidence` raises or lowers the threshold for
  auto-accepting a conflict
- `tokens.maxConflictDelta` sets how far a Figma value may drift from the
  existing workspace value before the row is forced into manual review
- `tokens.disabled` clears token suggestions so the review surface has no
  conflict or unmapped rows to apply

### Post-gen review nudges

**Post-gen review nudges** are follow-up hints for generated output. The
Inspector scans generated `.tsx`, `.jsx`, `.html`, and `.mdx` files for
accessibility and semantic HTML issues, then shows a severity-ranked list of
items to inspect.

These nudges are advisory only:

- they do not edit generated files automatically
- they do not block the import on their own
- they are meant to guide manual review after generation

Policy controls:

- `a11y.wcagLevel` chooses `AA` or `AAA` severity handling
- `a11y.disabledRules` turns off specific rule ids when your workspace has an
  intentional exception

### Review stepper and audit trail

When a governed import session is active, the Inspector renders the review
stepper:

`Import → Review → Approve → Apply`

The gate before `Apply` uses the resolved governance policy:

- `governance.minQualityScoreToApply` blocks apply until the score meets the
  minimum, or a reviewer override is allowed
- `governance.requireNoteOnOverride` requires a reviewer note before low-score
  or security-sensitive imports can be applied
- `governance.securitySensitivePatterns` marks imports as security-sensitive
  when a configured literal pattern matches a generated file path, manifest
  entry, or IR node name

The same session also has an ordered audit trail. In the Inspector, expand
**Import History** and use **Log** on a session row to inspect persisted events
such as `imported`, `review_started`, `approved`, `applied`, `rejected`, and
`note`.

Automation and backend callers can read the same trail from
`GET /workspace/import-sessions/:id/events`. Approval persists through
`POST /workspace/import-sessions/:id/approve`.

### Workspace inspector policy (`.workspace-inspector-policy.json`)

WorkspaceDev loads `/.workspace-inspector-policy.json` from the repo root and
exposes the loader payload at `GET /workspace/inspector-policy` as
`{ policy, validation, warning? }`. The route returns the repo-backed policy
document as loaded, plus validation diagnostics. When the route returns
`policy: null` because the file is absent or rejected, the Inspector resolves
defaults client-side and surfaces any warning text to the reviewer.

Example:

```json
{
  "quality": {
    "bandThresholds": {
      "excellent": 90,
      "good": 75,
      "fair": 55
    },
    "weights": {
      "structure": 0.3,
      "semantic": 0.45,
      "codegen": 0.25
    },
    "maxAcceptableDepth": 5,
    "maxAcceptableNodes": 80,
    "riskSeverityOverrides": {
      "deep-nesting": "high",
      "interaction-no-semantics": "high"
    }
  },
  "tokens": {
    "autoAcceptConfidence": 95,
    "maxConflictDelta": 10,
    "disabled": false
  },
  "a11y": {
    "wcagLevel": "AAA",
    "disabledRules": ["missing-h1"]
  },
  "governance": {
    "minQualityScoreToApply": 85,
    "securitySensitivePatterns": ["auth", "payments/", "AdminPanel"],
    "requireNoteOnOverride": true
  }
}
```

Field reference:

| Key | Meaning |
| --- | --- |
| `quality.bandThresholds.excellent` | Score threshold for the `Excellent` band. |
| `quality.bandThresholds.good` | Score threshold for the `Good` band. |
| `quality.bandThresholds.fair` | Score threshold for the `Fair` band. |
| `quality.weights.structure` | Weight applied to the structural sub-score. |
| `quality.weights.semantic` | Weight applied to the semantic sub-score. |
| `quality.weights.codegen` | Weight applied to the codegen-risk sub-score. |
| `quality.maxAcceptableDepth` | Nesting-depth budget before the structure score is penalized. |
| `quality.maxAcceptableNodes` | Node-count budget before the structure score is penalized. |
| `quality.riskSeverityOverrides` | Per-risk override map for `high`, `medium`, or `low` severity labels. |
| `tokens.autoAcceptConfidence` | Confidence threshold used when deciding whether a token conflict can be auto-accepted. |
| `tokens.maxConflictDelta` | Maximum allowed token-value drift before a conflict is forced into manual review. |
| `tokens.disabled` | Disables token suggestions for the Inspector review flow. |
| `a11y.wcagLevel` | Accessibility review strictness: `AA` or `AAA`. |
| `a11y.disabledRules` | Rule ids to suppress in post-generation nudges. |
| `governance.minQualityScoreToApply` | Minimum score required before apply can proceed. Use `null` to disable the score gate. |
| `governance.securitySensitivePatterns` | Case-insensitive literal substring matches used to flag security-sensitive imports. Regex-like entries are dropped with a warning. |
| `governance.requireNoteOnOverride` | Requires a reviewer note when overriding a low-score or security-sensitive gate. |

## Plan quota

When the Inspector resolves Figma content through the Model Context Protocol
(MCP) transport, each successful read-tool call increments WorkspaceDev's
local-only MCP counter in the browser.

WorkspaceDev tracks these calls locally (in your browser's `localStorage`) from
the backend's reported successful MCP tool usage and shows a non-blocking
warning banner at the top of the Inspector once usage reaches **80%** of the
current local threshold. Today that threshold is keyed to the published Figma
Starter-tier limit of **6 MCP read-tool calls per month**, so the warning
appears at **5 of 6** calls. The banner links to the
[Figma pricing page](https://www.figma.com/pricing/) and can be dismissed for
the rest of the session with the **✕** button. Dismissal is scoped to the
current month — a new month re-enables the banner.

The counter is:

- **Local-only**: the call count never leaves your browser. No network
  request, no external telemetry.
- **Per-month**: counters reset at the start of each UTC month.
- **Scoped to MCP**: runs that fell back to the Figma REST API are not
  counted (REST has a different quota regime; see
  [Hybrid MCP / REST resolver](#hybrid-mcp--rest-resolver)).

To silence the banner permanently, upgrade the Figma plan or switch to the
REST fallback path (set `figmaSourceMode=rest` in submits).

## Security notes

- Paste and plugin payloads are processed locally only. Tokens are never
  required.
- Generic fields are redacted in job logs, but the paste payload itself is
  written to `${outputRoot}/jobs/<jobId>/figma.json`. Treat `.workspace-dev/`
  as sensitive local state.
- WorkspaceDev prefers the Figma **plugin workflow** because it uses a
  structured payload. Figma's docs recommend explicit export formats for
  design-tool transfer, and browser clipboard behavior varies by format,
  browser, and destination app.

## See also

- [`plugin/TESTING.md`](../plugin/TESTING.md) — manual smoke test for the
  plugin UI and envelope contents.
- [`src/clipboard-envelope.ts`](../src/clipboard-envelope.ts) — envelope
  validator and error strings.
- [`src/server/constants.ts`](../src/server/constants.ts) — byte caps and the
  `WORKSPACE_FIGMA_PASTE_MAX_BYTES` override.
- [`src/job-engine/figma-mcp-resolver.ts`](../src/job-engine/figma-mcp-resolver.ts) — default MCP URL, retry logic, and REST fallback diagnostics.
- [`ui-src/src/features/workspace/inspector/paste-error-catalog.ts`](../ui-src/src/features/workspace/inspector/paste-error-catalog.ts) — Inspector error-code catalog used in the troubleshooting table above.
- Figma plugin developer reference: <https://developers.figma.com/docs/plugins/>
- Figma MCP introduction: <https://developers.figma.com/docs/figma-mcp-server/>
- Figma remote MCP setup: <https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/>
- Figma MCP plans and permissions: <https://developers.figma.com/docs/figma-mcp-server/plans-access-and-permissions/>
- Figma REST authentication: <https://developers.figma.com/docs/rest-api/authentication/>
- Figma PAT management: <https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens>
- Figma REST rate limits: <https://developers.figma.com/docs/rest-api/rate-limits/>
- Figma copy/paste behaviour in external apps:
  <https://help.figma.com/hc/en-us/articles/4409078832791-Copy-and-paste-objects>
