# Audit 2026-05: Plugin Handoff And Clipboard Envelope Ingress

Issue: #1718

Dedicated defect issue filed during this audit: #1887

## Scope

This walkthrough audits the plugin handoff and clipboard-envelope ingress path
end-to-end:

- Figma plugin clipboard export and direct upload
- Inspector paste / drop / upload classification
- `/workspace/submit` schema validation
- request-handler normalization before temp-file writes

The goal is to confirm how each ingress boundary validates payload shape,
payload size, and envelope complexity, and whether malformed or unsupported
clipboard content fails safely.

## Outcome

- Confirmed: partial, corrupted, and unsupported clipboard-envelope content
  falls back to non-crashing validation or unsupported-format handling.
- Confirmed: both `figma_paste` and `figma_plugin` call the envelope and raw
  Figma complexity validators at schema-validation time and again in the
  request handler before temp-file writes.
- Fixed in this branch: the Figma plugin now enforces the same 6 MiB public
  payload cap used by the Inspector before copying or uploading an envelope.
- Fixed in this branch: the plugin direct-upload UI now accepts loopback
  WorkspaceDev endpoints only, closing the remote-upload trust-boundary gap.
- Confirmed: the plugin upload error path surfaces only the backend error
  message plus optional request ID; this flow does not expose upload tokens.

## Ingress Boundaries

| Boundary | Entry point | Current validation | Tests / evidence | Result |
| --- | --- | --- | --- | --- |
| Plugin export | `plugin/code.ts` | Validates non-empty selection and allowed node types before export. This branch now serializes the envelope and rejects payloads larger than 6 MiB before clipboard copy or direct upload. | `plugin/code.test.ts`, `plugin/TESTING.md` | Safe for empty selection, unsupported nodes, network failure, and oversize payloads. |
| Plugin UI status surface | `plugin/ui.html` | Renders generic status, error, upload success, and upload failure states. Upload failures append only `requestId` when present. Direct upload targets are restricted to loopback hosts (`localhost`, `127.0.0.1`, `::1`). | `plugin/ui.test.ts`, `plugin/plugin-helpers.test.ts` | No token-bearing status path found; remote exfiltration path closed. |
| Inspector text paste | `ui-src/src/features/workspace/inspector/paste-input-classifier.ts` and `useInspectorBootstrap.ts` | Trims input, distinguishes non-JSON, malformed JSON, raw Figma JSON, and WorkspaceDev clipboard envelopes. Unsupported / malformed content is classified into non-import states instead of being treated as an envelope. | `paste-input-classifier.test.ts`, `useInspectorBootstrap.test.tsx`, `InspectorBootstrap.test.tsx` | Partial / corrupted / mixed clipboard text fails closed without crashing. |
| Inspector HTML clipboard probe | `ui-src/src/features/workspace/inspector/figma-clipboard-parser.ts` | Detects Figma HTML clipboard markers and rejects malformed wrappers, invalid metadata, or non-Figma HTML. | `figma-clipboard-parser.test.ts` | Figma HTML detection is defensive and null-safe. |
| Inspector drop / upload | `PasteCapture.tsx`, `PasteDropZone.tsx`, `submit-schema.ts` | Rejects non-JSON files and files larger than 6 MiB before submit. Schema-level client validation also rejects inline payloads larger than 6 MiB. | `submit-schema.test.ts`, `PasteCapture.test.tsx`, `PasteDropZone.test.tsx`, `ui-src/e2e/inspector-bootstrap-drop.spec.ts` | Client guard is consistent for paste-adjacent browser flows. |
| Submit schema ingress | `src/schemas.ts` | For `figma_paste` and `figma_plugin`, enforces presence, byte-size cap, transport-budget cap, JSON parseability, envelope validation, raw Figma schema validation, `validateClipboardEnvelopeComplexity`, and `validateFigmaPayloadComplexity`. | `src/schemas.test.ts`, `src/server.test.ts` | No uncovered bypass found for inline Figma payload modes. |
| Request-handler pre-write ingress | `src/server/request-handler.ts` | Re-parses payload, re-validates clipboard envelopes, re-runs both complexity validators, normalizes valid envelopes to DOCUMENT-root JSON, and rejects before temp-file writes on invalid or oversized payloads. | `src/server/request-handler.test.ts` | Defense-in-depth is in place before disk writes or job submission. |

## Walkthrough Notes

### Paste-format detection

`looksLikeClipboardEnvelope()` in [`src/clipboard-envelope.ts`](../src/clipboard-envelope.ts)
is intentionally broad: any object with the WorkspaceDev kind prefix is treated
as an envelope candidate, including unknown future versions.

That broad probe is paired with stricter validation later:

- `validateClipboardEnvelope()` rejects unsupported versions, missing required
  fields, empty selections, and malformed selection objects.
- The Inspector classifier treats malformed JSON, empty input, and plain text
  as non-envelope input instead of forcing the envelope path.
- Unknown envelope versions are surfaced as `UNSUPPORTED_FORMAT` or
  `UNSUPPORTED_CLIPBOARD_KIND`, not as crashes.

The current behavior is fail-closed and preserves the legacy/raw JSON path for
non-envelope content.

### Payload-size enforcement

The public user-facing cap is 6 MiB across the plugin and Inspector paths:

- Plugin export / upload: `plugin/code.ts`
- Inspector inline payload validation: `ui-src/src/features/workspace/submit-schema.ts`
- Inspector file drop / upload: `PasteCapture.tsx`, `PasteDropZone.tsx`
- Server default cap: `DEFAULT_FIGMA_PASTE_MAX_BYTES` in
  `src/server/constants.ts`

The runtime still supports a larger server-side override via
`WORKSPACE_FIGMA_PASTE_MAX_BYTES`, bounded by the 8 MiB submit transport cap.
That means non-UI callers can be configured above 6 MiB, while the public UI
and plugin remain intentionally capped at 6 MiB.

### Ingress validation coverage

The two relevant complexity validators are:

- `validateClipboardEnvelopeComplexity()`
- `validateFigmaPayloadComplexity()`

Both are invoked in the two authoritative ingress layers:

- `src/schemas.ts`
- `src/server/request-handler.ts`

No additional `figma_paste` / `figma_plugin` ingress boundary was found that
accepts inline Figma payloads without eventually passing through those checks.

### Plugin error handling

The direct-upload plugin path posts to `/workspace/submit` and surfaces:

- success: job ID and tracking link
- failure: server message or `HTTP <status>`
- optional `x-request-id`

This path does not create or expose upload tokens. The status handling in
`plugin/ui.html` does not interpolate any token-like value beyond the request
ID and job ID.

The upload target is now limited to loopback hosts, so users cannot redirect
the plugin handoff to an arbitrary remote HTTPS endpoint via the UI field.

## Findings

1. The main acceptance-criteria gap in the repository state before this branch
   was the missing walkthrough document requested by Issue #1718.
2. A user-facing consistency gap existed in the plugin path: payload size was
   enforced in the Inspector and server, but not preflighted in the Figma
   plugin before copy/upload. This branch closes that gap by rejecting
   oversize envelopes in `plugin/code.ts` and covering it in
   `plugin/code.test.ts`.
3. A trust-boundary gap existed in the direct-upload path: the plugin UI
   accepted arbitrary remote HTTP(S) endpoints for WorkspaceDev upload. This
   branch closes that gap by normalizing only loopback URLs in `plugin/ui.html`
   and covering the restriction in `plugin/ui.test.ts` and
   `plugin/plugin-helpers.test.ts`. Dedicated tracking issue: #1887.
4. No additional ingress boundary was found that bypasses the existing
   complexity validators for `figma_paste` or `figma_plugin`.
5. No upload-token leakage path was found in the plugin status UI.

## Residual Risk

- There is still no automated test that drives a real Figma-hosted plugin
  session into the Inspector end-to-end; this remains covered by unit tests
  plus the manual smoke flow in `plugin/TESTING.md`.
