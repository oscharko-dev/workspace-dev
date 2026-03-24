# Pipeline

`workspace-dev` executes a deterministic local Figma-to-code workflow with a fixed stage order and a bundled template stack.

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

- `figma.source` accepts either authenticated Figma REST input or local JSON input.
- `ir.derive` and `codegen.generate` stay deterministic by design; `workspace-dev` does not use hybrid or MCP generation modes.
- `template.prepare` always starts from the bundled React 19 + MUI v7 + Vite 8 seed in `template/react-mui-app`.
- `validate.project` is the release-quality gate for generated output and can optionally run generated-project unit tests, UI validation, and performance assertions.
- `git.pr` is opt-in and skipped for local-only runs and regeneration jobs.
