# Plugin Smoke Test — Manual Steps

The Figma plugin runs inside Figma's sandboxed iframe and cannot be tested
in automated CI. Follow these steps to verify the export flow.

## Prerequisites

- Figma Desktop (or `figma.com` with developer mode)
- A Figma file with at least one frame/component

## Steps

### 1. Load the plugin

1. Open a Figma file.
2. Go to **Plugins > Development > Import plugin from manifest**.
3. Select `plugin/manifest.json` from this repository.
4. The plugin UI should appear (320x200 window).

### 2. Single-selection export

1. Select **one** frame or component on the canvas.
2. Click **Copy to Clipboard** in the plugin UI.
3. Verify the status shows "Copied to clipboard!".
4. Open a text editor and paste — confirm the JSON contains:
   - `"kind": "workspace-dev/figma-selection@1"`
   - `"pluginVersion": "0.1.0"`
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
3. Verify the plugin shows an error: "No nodes selected."

### 6. Inspector acceptance

1. Export a selection via step 2.
2. Open the WorkspaceDev Inspector (`/workspace/ui/inspector`).
3. Paste the clipboard content into the paste area.
4. Verify the SmartBanner shows "Plugin Export" as detected intent.
5. Click "Import starten" and verify the job is submitted successfully.
