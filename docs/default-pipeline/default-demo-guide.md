# Default pipeline demo guide

This guide is the local evaluator runbook for the OSS `default` pipeline. It
covers local install, source modes, pipeline selection, running the financial
demo fixtures, reading the quality passport, and the first troubleshooting
checks.

The default demo is intentionally local and synthetic. It does not require a
Figma access token, a customer profile, proprietary assets, or
customer-specific component mappings when run from the checked-in fixture pack.

## What the demo proves

- `pipelineId: "default"` selects the OSS React + TypeScript + Tailwind
  pipeline.
- `figmaSourceMode: "local_json"` runs deterministic generation from local
  Figma JSON without Figma REST access.
- `figmaSourceMode: "figma_paste"` and `figmaSourceMode: "figma_plugin"` use
  the same offline Inspector handoff path for pasted JSON, uploaded JSON, or
  WorkspaceDev plugin envelopes.
- The generated output records evidence in `quality-passport.json`, including
  the selected pipeline, source mode, template bundle, generated files,
  validation stages, coverage, and warnings.
- The demo fixtures are synthetic financial-services examples covering board,
  view, component, modal, table, mobile navigation, and token-heavy surfaces.

## Local install

For an installed consumer project:

```bash
npm install --save-dev workspace-dev
npx workspace-dev start
```

For a source checkout of this repository:

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
node dist/cli.js start
```

The default runtime binds to `http://127.0.0.1:1983/workspace`. Keep that
loopback bind unless you are intentionally expanding the local trust boundary.
If port `1983` is already in use, choose another port and use that port in the
browser and API examples:

```bash
FIGMAPIPE_WORKSPACE_PORT=21983 npx workspace-dev start
```

Local JSON demos do not need `FIGMA_ACCESS_TOKEN` or `figmaAccessToken`.
Operators may still source their local environment before starting the runtime
when their workflow uses REST, Git PR creation, or other optional integrations;
do not print or persist secret values.

## Repository fixtures versus installed package

The checked-in demo fixtures under `src/parity/fixtures/golden/default` are
repository evaluation fixtures. They are used by maintainers, CI, and source
checkout demos.

The published package ships the runtime, templates, and public docs, but it
does not ship the full repository fixture tree. Installed-package evaluators
should run the same workflow with their own exported Figma JSON file, a pasted
JSON payload, or a WorkspaceDev plugin envelope. Source checkout evaluators can
use the fixture paths shown below directly.

## Choose a source mode

| Source mode     | Best for                                      | Required submit field              | Figma token |
| --------------- | --------------------------------------------- | ---------------------------------- | ----------- |
| `local_json`    | Repo fixtures, air-gap smoke tests, CI demos  | `figmaJsonPath`                   | No          |
| `figma_paste`   | Pasted, dropped, or uploaded Figma JSON       | `figmaJsonPayload`                | No          |
| `figma_plugin`  | WorkspaceDev plugin clipboard/direct handoff  | `figmaJsonPayload`                | No          |
| `rest`          | Live Figma REST fetch                         | `figmaFileKey`, `figmaAccessToken` | Yes         |
| `hybrid`        | REST plus MCP enrichment fallback             | `figmaFileKey`, `figmaAccessToken` | Yes         |

Use `local_json` for the checked-in default demo fixtures. Use
`figma_paste` or `figma_plugin` when an evaluator exports JSON from Figma and
hands it to the Inspector without giving WorkspaceDev a Figma token. Use `rest`
or `hybrid` only when the runtime should fetch from Figma directly.

## Select the pipeline

The current combined build exposes both `default` and `rocket`.

- Use `pipelineId: "default"` for the OSS React + TypeScript + Tailwind demo.
- Use `pipelineId: "rocket"` only for the compatibility pipeline that supports
  Rocket/customer-profile inputs.
- If `pipelineId` is omitted in the combined build, ordinary jobs resolve to
  `default`.
- Rocket-specific inputs such as `customerProfilePath` must be submitted with
  `pipelineId: "rocket"`. Explicit `pipelineId: "default"` rejects those
  inputs with `PIPELINE_INPUT_UNSUPPORTED`.

The Workspace UI reads `availablePipelines` and `defaultPipelineId` from
`GET /workspace`. The pipeline dropdown is shown only when more than one
pipeline is available; single-pipeline bundles submit the only available
pipeline without adding an extra selector.

## Run the local JSON demo

The canonical fixture inventory is documented in
[default-demo-fixtures.md](default-demo-fixtures.md). Start with
`fintech-dashboard` because it exercises a full board and includes a committed
quality-passport fixture.

Start the runtime from the repository root:

```bash
pnpm run build
FIGMAPIPE_WORKSPACE_OUTPUT_ROOT=.workspace-dev/default-demo \
  node dist/cli.js start --export-images false
```

Submit the fixture in another shell:

```bash
curl -sS -X POST http://127.0.0.1:1983/workspace/submit \
  -H 'content-type: application/json' \
  -d '{
    "pipelineId": "default",
    "figmaSourceMode": "local_json",
    "figmaJsonPath": "src/parity/fixtures/golden/default/fintech-dashboard/figma.json",
    "enableGitPr": false,
    "llmCodegenMode": "deterministic"
  }'
```

The response is `202 Accepted` and includes a `jobId`. Poll until the job is
completed:

```bash
curl -sS http://127.0.0.1:1983/workspace/jobs/<jobId> | jq
```

Open the local preview when `preview.url` is present, or when
`artifacts.reproDir` confirms the repro export exists:

```text
http://127.0.0.1:1983/workspace/repros/<jobId>/
```

Generated output is written under the configured output root:

```text
.workspace-dev/default-demo/jobs/<jobId>/generated-app/
.workspace-dev/default-demo/jobs/<jobId>/generated-app/quality-passport.json
.workspace-dev/default-demo/jobs/<jobId>/figma.json
.workspace-dev/default-demo/jobs/<jobId>/design-ir.json
.workspace-dev/default-demo/repros/<jobId>/
```

To run the full deterministic fixture suite instead of one runtime job:

```bash
pnpm run test:golden
```

Intentional fixture updates must use the explicit approval flow:

```bash
FIGMAPIPE_GOLDEN_APPROVE=true pnpm run test:golden
```

## Run the Inspector demo

Use the Inspector when the evaluator wants to paste, upload, drop, or send a
plugin export instead of posting JSON directly.

1. Start the runtime.
2. Open `http://127.0.0.1:1983/workspace/ui/inspector`.
3. Use **Upload JSON file**, drag a fixture JSON file into the import column,
   paste JSON, or send an export from the WorkspaceDev Figma plugin.
4. Confirm the SmartBanner detection.
5. Submit the import.

The Inspector submits pasted or uploaded raw JSON as `figma_paste` and plugin
envelopes as `figma_plugin`. Those modes avoid Figma REST and do not need a
Figma token. The detailed plugin and paste-zone workflow is in
[../figma-import.md](../figma-import.md).

## Read the quality passport

Each completed default-pipeline job should emit `quality-passport.json` when
the job reaches validation evidence generation. The persisted passport is
machine-readable and secret-free.

Inspect the compact result projection:

```bash
curl -sS http://127.0.0.1:1983/workspace/jobs/<jobId>/result \
  | jq '.inspector.qualityPassport'
```

Inspect the full persisted file:

```bash
jq '{
  pipelineId,
  templateBundleId,
  buildProfile,
  scope,
  validation,
  coverage,
  warnings
}' .workspace-dev/default-demo/jobs/<jobId>/generated-app/quality-passport.json
```

Read these fields first:

| Field              | Meaning                                                        |
| ------------------ | -------------------------------------------------------------- |
| `pipelineId`       | The selected pipeline. For this demo it should be `default`.   |
| `templateBundleId` | The generated app template, normally `react-tailwind-app`.     |
| `scope.sourceMode` | The source mode used for the job, such as `local_json`.        |
| `validation.status`| Overall validation result from the persisted stage evidence.   |
| `coverage.token`   | Token coverage from the default token compiler.                |
| `coverage.semantic`| Semantic component reuse coverage from synthesis evidence.     |
| `generatedFiles`   | Relative generated files with SHA-256 hashes and byte sizes.   |
| `warnings`         | Non-blocking evidence rows that need operator interpretation.  |

## Interpret warnings

Warnings are evidence, not automatic failure. Treat them as review prompts and
look at `severity`, `code`, `message`, and `source`.

Common default demo warnings:

| Warning code                         | Meaning                                                       | Normal next step |
| ------------------------------------ | ------------------------------------------------------------- | ---------------- |
| `W_SEMANTIC_COMPONENT_NOT_REUSABLE`  | A node stayed inline because no reusable semantic structure matched. | Inspect the referenced semantic component report; accept when inline output is intentional for the fixture. |
| Layout report warnings               | Generated layout needed a conservative fallback or flagged a geometry risk. | Inspect `src/generated/layout-report.json` and the preview for overlap, truncation, or spacing issues. |
| Unsupported-node report entries      | Input contained a Figma pattern the deterministic generator does not render directly. | Inspect `unsupported-nodes.json`; simplify the source fixture or document the unsupported pattern if it is intentional. |
| Token coverage below expectation     | Some colors, spacing, or typography values were emitted as literals or fallback tokens. | Inspect `src/theme/token-report.json`; improve source naming or token extraction only when the demo requires it. |

A `warning` status in the quality passport can still be acceptable for a demo
fixture when validation passed and the warning explains a deterministic,
reviewable fallback.

## Troubleshooting

| Symptom | Likely cause | Resolution |
| ------- | ------------ | ---------- |
| `MODE_LOCK_VIOLATION` | Unsupported or misspelled `figmaSourceMode` / `llmCodegenMode`. | Use one of `rest`, `hybrid`, `local_json`, `figma_paste`, or `figma_plugin` with `llmCodegenMode: "deterministic"`. |
| `figmaJsonPath is required when figmaSourceMode=local_json` | The request selected `local_json` but did not provide a path. | Add `figmaJsonPath` or submit through paste/plugin mode with `figmaJsonPayload`. |
| File-not-found error for `figmaJsonPath` | The runtime cannot resolve the local fixture path from its working directory. | Run the runtime from the repository root or use an absolute path. |
| `PIPELINE_INPUT_UNSUPPORTED` | The request mixed `default` with Rocket-specific inputs, or changed pipeline during regeneration. | Remove Rocket-only fields for the default demo or submit with `pipelineId: "rocket"` when using customer-profile inputs. |
| Pipeline dropdown is missing | The package profile exposes only one pipeline, or runtime status did not include multiple `availablePipelines`. | Confirm `GET /workspace` and the active build profile; single-pipeline bundles intentionally hide the selector. |
| Inspector paste is rejected for clipboard security | Browser context is not secure. | Use `http://127.0.0.1` locally, or HTTPS for remote/reverse-proxied hosts. |
| Job reaches `validate.project` and fails | Generated project install, lint, typecheck, build, UI validation, or perf validation failed. | Inspect job logs and `quality-passport.json`; rerun template checks such as `pnpm run template:tailwind:typecheck` and `pnpm run template:tailwind:build` when the Tailwind template is implicated. |
| No `quality-passport.json` is present | The job failed before evidence export, or the output root/job ID is different from the one being inspected. | Poll `GET /workspace/jobs/<jobId>` for the final stage and check `<outputRoot>/jobs/<jobId>/generated-app/quality-passport.json`. |

For broader operational failures, see [../../TROUBLESHOOTING.md](../../TROUBLESHOOTING.md).
