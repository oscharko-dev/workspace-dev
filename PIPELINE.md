# Pipeline

`workspace-dev` executes a deterministic local Figma-to-code workflow with a fixed stage order and a bundled template stack.
Internally, the pipeline is split into seven in-process stage services coordinated by a shared orchestrator.

## Stage flow

```mermaid
flowchart TB
  S1["Stage 1: figma.source"] --> S2["Stage 2: ir.derive"]
  S2 --> S3["Stage 3: template.prepare"]
  S3 --> S4["Stage 4: codegen.generate"]
  S4 --> S5["Stage 5: validate.project"]
  S5 --> S6["Stage 6: repro.export"]
  S6 --> S7{"Stage 7: git.pr?"}

  Ingest["Fetch Figma REST data or load local JSON"] --> S1
  Derive["Normalize deterministic design IR"] --> S2
  Copy["Copy template/react-mui-app\nReact 19 + MUI v7 + Vite 8"] --> S3
  Generate["Emit application code, routes, assets, and mappings"] --> S4
  Validate["Run install when needed, lint, typecheck, build,\noptional generated-project tests, validate:ui, and perf:assert"] --> S5
  Export["Write repro app and job artifacts under .workspace-dev"] --> S6
  GitPr["Open optional git.pr automation only when explicitly enabled"] --> S7
```

## Operational notes

- Pipeline kernel lives under `src/job-engine/pipeline/`:
  - `PipelineOrchestrator` handles stage order, skip behavior, status transitions, cancellation, and error mapping.
  - `StageArtifactStore` persists stage output references under `<jobDir>/.stage-store`.
- Stage services live under `src/job-engine/services/*-service.ts` and exchange data through artifact keys instead of direct service calls.
- Two plans are supported:
  - `submission`: all seven stages run in order.
  - `regeneration`: `figma.source` and `git.pr` are skipped by plan-level rules; remaining stages keep canonical order.
- `POST /workspace/submit` accepts authenticated Figma REST input, `local_json`, `figma_paste`, `figma_plugin`, and `hybrid` mode. Inline paste/plugin payloads are normalized into temp `local_json` artifacts before the canonical pipeline starts.
- `figma.source` consumes authenticated Figma REST input, `local_json`, and `hybrid` mode after submit-time normalization. In `hybrid`, REST fetch remains authoritative and optional MCP enrichment is merged in as artifact-backed hints for downstream derivation.
- `ir.derive` and `codegen.generate` stay deterministic by design; hybrid mode enriches deterministic derivation with MCP metadata but does not switch the runtime into LLM generation.
- `template.prepare` always starts from the bundled React 19 + MUI v7 + Vite 8 seed in `template/react-mui-app`.
- `validate.project` is the release-quality gate for generated output and can optionally run generated-project unit tests, UI validation, and performance assertions.
- `git.pr` is opt-in and skipped for local-only runs and regeneration jobs.
- Standard stage artifact keys include: `figma.cleaned`, `design.ir`, `figma.analysis`, `storybook.catalog`, `storybook.evidence`, `storybook.tokens`, `storybook.themes`, `storybook.components`, `figma.library_resolution`, `component.match_report`, `generated.project`, `generation.metrics`, `validation.summary`, `repro.path`, `git.pr.status`.
- Required stage `reads` are enforced before execution. Optional reads declare conditionally consumed artifacts such as the storybook-first surface without breaking non-storybook runs.
- Public job fields such as `artifacts.*`, `generationDiff`, and `gitPr` are projected from the stage store by the pipeline kernel rather than being mutated directly inside stage services. That projection includes the curated storybook-first artifact paths when they are available.

## Backend coverage gate

- `pnpm run test:coverage` is the authoritative backend coverage gate. It runs `c8 --all` across `src/**/*.ts`, then enforces the fixed threshold policy from [`scripts/check-coverage-thresholds.mjs`](scripts/check-coverage-thresholds.mjs).
- The current backend minimums are `lines >= 90%`, `statements >= 90%`, `functions >= 90%`, and `branches >= 85%`.
- [`src/job-engine.ts`](src/job-engine.ts) and [`src/job-engine/figma-source.ts`](src/job-engine/figma-source.ts) stay inside that global backend gate because they own queue orchestration, import governance, re-import handling, delta fetch reuse, and Figma transport retry behavior.
- Dev-gate and release-quality CI execute `pnpm run test:coverage` directly, so backend coverage-denominator changes are CI-visible on both promotion paths without a second policy layer.
- Any future backend coverage exclusion for a high-risk runtime boundary must be documented here with an explicit rationale, owner, and retirement condition before it is allowed to land.

## UI hotspot coverage

- `pnpm run ui:test:coverage` now runs two coverage passes:
  - the global UI gate for the broad UI surface
  - a hotspot-only pass for the high-complexity Issue `#586` modules
- The hotspot pass explicitly measures:
  - [`ui-src/src/features/workspace/workspace-page.tsx`](ui-src/src/features/workspace/workspace-page.tsx)
  - [`ui-src/src/features/workspace/inspector-page.tsx`](ui-src/src/features/workspace/inspector-page.tsx)
  - [`ui-src/src/features/workspace/inspector/InspectorScopeContext.tsx`](ui-src/src/features/workspace/inspector/InspectorScopeContext.tsx)
  - [`ui-src/src/features/visual-quality/visual-quality-page.tsx`](ui-src/src/features/visual-quality/visual-quality-page.tsx)
- The enforceable hotspot branch thresholds are `>=75%` for:
  - [`workspace-page.tsx`](ui-src/src/features/workspace/workspace-page.tsx)
  - [`inspector-page.tsx`](ui-src/src/features/workspace/inspector-page.tsx)
  - [`InspectorScopeContext.tsx`](ui-src/src/features/workspace/inspector/InspectorScopeContext.tsx)
  - [`visual-quality-page.tsx`](ui-src/src/features/visual-quality/visual-quality-page.tsx)
  - A global `branches: 75` fallback also applies to any file added to the hotspot pass that does not yet have a per-file entry.
- The only justified UI hotspot exceptions are:
  - [`ui-src/src/features/workspace/inspector/InspectorPanel.tsx`](ui-src/src/features/workspace/inspector/InspectorPanel.tsx)
    - Rationale: the panel still concentrates the broadest remaining branch fan-out in the UI surface, and the new interaction tests now cover its critical edit, sync, navigation, and diagnostics paths without yet making a `>=75%` threshold credible for the whole monolith.
    - Owner: `@oscharko-dev`.
    - Retirement condition: remove the exception after the panel is split into smaller audited submodules or its hotspot branch coverage reaches `>=75%` under the dedicated UI hotspot pass.
  - [`ui-src/src/lib/shiki-highlight.worker.ts`](ui-src/src/lib/shiki-highlight.worker.ts)
    - Rationale: the worker entrypoint is exercised through the worker client, but Vitest does not yet provide a deterministic harness for the worker message boundary without duplicating browser-worker setup inside the unit suite.
    - Owner: `@oscharko-dev`.
    - Retirement condition: remove the exception once the UI test suite includes a stable worker-harness test that executes the worker entrypoint through its real message protocol.
