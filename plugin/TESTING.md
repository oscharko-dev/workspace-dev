# Plugin Smoke Test — Manual Steps

The Figma plugin runs inside Figma's sandboxed iframe and cannot be tested
in automated CI. Follow these steps to verify the export flow.

## Prerequisites

- Figma Desktop or `figma.com`
- A Figma file with at least one frame/component

## Steps

### 1. Load the plugin

1. Open a Figma file.
2. Go to **Plugins > Development > Import plugin from manifest**.
3. Select `plugin/manifest.json` from this repository.
4. Launch **WorkspaceDev Export** from the development plugins list.
5. Verify the export UI appears.

### 1a. Dev Mode availability

1. Switch the same file into **Dev Mode**.
2. Open the Dev Mode plugin list.
3. Verify **WorkspaceDev Export** is available there as well.

### 2. Single-selection export

1. Select **one** frame or component on the canvas.
2. Click **Copy to Clipboard** in the plugin UI.
3. Verify the status shows "Copied to clipboard. Paste into WorkspaceDev Inspector.".
4. Open a text editor and paste — confirm the JSON contains:
   - `"kind": "workspace-dev/figma-selection@1"`
   - `"pluginVersion": "0.2.0"`
   - `"copiedAt"` with an ISO timestamp
   - `"selections"` array with exactly one entry
   - The entry has `document`, `components`, `componentSets`, `styles`

### 3. Multi-selection export

1. Select **two or more** frames/components (Shift+click).
2. Click **Copy to Clipboard**.
3. Paste and verify `"selections"` contains one entry per selected node.

### 4. Download fallback

1. Select a frame.
2. Click **Copy to Clipboard** (to populate the payload).
3. Click **Download JSON**.
4. Verify a `workspace-dev-export.json` file is downloaded with the same
   envelope structure.

### 5. Empty selection guard

1. Deselect everything (click on empty canvas).
2. Click **Copy to Clipboard**.
3. Verify the plugin shows an error: "No nodes selected. Please select at least one layer."

### 6. Inspector acceptance

1. Export a selection via step 2.
2. Open the WorkspaceDev Inspector (`/workspace/ui/inspector`).
3. Paste the clipboard content into the paste area.
4. Verify the SmartBanner shows "Plugin Export" as detected intent.
5. Click "Import starten" and verify the job is submitted successfully.

### 7. Direct upload to WorkspaceDev

**Prerequisites**: WorkspaceDev running locally (`pnpm start` or
`npx workspace-dev start`).

1. Select one or more frames or components on the Figma canvas.
2. In the plugin UI, confirm the **WorkspaceDev URL** field shows
   `http://127.0.0.1:1983` (the default).
3. Click **Send to WorkspaceDev**.
4. Verify the status area shows "Uploading to WorkspaceDev..." briefly, then
   transitions to a success message like
   `"Sent! Job <jobId> is processing."` with a clickable job link.
5. Click the job link and verify it opens the job page in your browser.
6. Verify both the **Copy to Clipboard** and **Send to WorkspaceDev** buttons
   are re-enabled after the operation completes.

**Non-default ports**: if WorkspaceDev is running on a port other than 1983,
update the **WorkspaceDev URL** input in the plugin UI to match
(e.g. `http://127.0.0.1:8080`). Additionally, update
`networkAccess.allowedDomains` in `plugin/manifest.json` to include the
alternate port URL — Figma blocks `fetch()` calls to domains not listed there.
