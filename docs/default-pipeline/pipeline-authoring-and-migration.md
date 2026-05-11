# Pipeline Authoring And Migration Guide

This guide documents the current pipeline platform contract for maintainers and
customer migration owners. It is intentionally about the behavior that exists
today: fixed public stages, registered pipeline definitions, profile-aware
packaging, explicit Rocket selection for existing customer integrations, and the
deprecated compatibility fallback.

Use this guide together with:

- [`PIPELINE.md`](../../PIPELINE.md) for the canonical stage graph and runtime
  kernel contract.
- [`docs/migration-guide.md`](../migration-guide.md) for broader contract
  migration policy.
- [`default-demo-guide.md`](default-demo-guide.md) for running the OSS default
  demo pipeline.

## Author Future Pipelines

Future pipelines are authored as registered `PipelineDefinition` entries, not as
new public DAGs. Each definition provides descriptor metadata and returns
submission, regeneration, and retry plans:

- `id`, `displayName`, `description`, `visibility`, `deterministic`, template
  metadata, supported source modes, and supported scopes.
- `buildSubmissionPlan(context)`.
- `buildRegenerationPlan(context)`.
- `buildRetryPlan(context)`.

Every plan must preserve the canonical public stage order:

1. `figma.source`
2. `ir.derive`
3. `template.prepare`
4. `codegen.generate`
5. `validate.project`
6. `repro.export`
7. `git.pr`

Those names are public contract values. They appear in job status, logs,
diagnostics, retry targets, Inspector metadata, and artifact-backed job
projection. `PipelineOrchestrator` validates plans before execution and rejects
missing stages, duplicate stages, invalid names, out-of-order stages, and extra
stages after `git.pr`.

The supported extension model is deliberately narrow:

- Select different delegates behind an existing stage name.
- Select a pipeline-specific template bundle in `template.prepare`.
- Select a pipeline-specific generator in `codegen.generate`.
- Add pipeline-specific validation behavior inside `validate.project`.
- Declare required, optional, skipped, and dynamic artifact contracts.
- Add stage input resolvers that adapt request input or persisted artifacts to
  the owning stage service.
- Use plan-level skip rules while keeping the skipped stage in its canonical
  position.

Do not add arbitrary stage names, inserted stages, conditional DAG nodes,
parallel branches, fan-out/fan-in execution, or new public retry boundaries for
a new pipeline. Those changes require a public contract and runtime redesign
across `WorkspaceJobStageName`, retry targets, job projection, cancellation,
Inspector assumptions, tests, and migration policy.

## Register And Select Pipelines

The current registry knows two stable pipeline IDs:

| Pipeline | Template bundle | Stack | Visibility | Purpose |
| --- | --- | --- | --- | --- |
| `default` | `react-tailwind-app` | React, TypeScript, Tailwind, Vite | `oss` | OSS deterministic generated app pipeline. |
| `rocket` | `react-mui-app` | React, TypeScript, MUI, Vite | `customer` | Compatibility pipeline for the existing WorkspaceDev generator and customer-profile inputs. |

Runtime selection is request-driven:

- Explicit `pipelineId` selects that pipeline when it is available in the
  current runtime build profile.
- Unknown pipeline IDs fail with `INVALID_PIPELINE`.
- Known but unavailable pipeline IDs fail with `PIPELINE_UNAVAILABLE`.
- If exactly one pipeline is available and `pipelineId` is omitted, that single
  pipeline is selected.
- If both `default` and `rocket` are available and ordinary input omits
  `pipelineId`, `default` is selected.
- If both are available and omitted-`pipelineId` input contains Rocket-specific
  signals, the deprecated compatibility fallback selects `rocket` and emits
  `LEGACY_ROCKET_AUTO_SELECTED`.

Rocket-specific signals are:

- `customerProfilePath`
- `customerBrandId`
- `componentMappings`
- customer-profile component mappings
- customer-profile import aliases
- direct MUI/Emotion mappings

Explicit `pipelineId: "default"` with any Rocket-specific signal fails closed
with `PIPELINE_INPUT_UNSUPPORTED`; the runtime does not silently switch an
explicit default request to Rocket.

Regeneration inherits the completed source job pipeline. A regeneration request
may repeat the same `pipelineId` as an assertion, but it cannot migrate a source
job from one pipeline to another.

## Package Default And Rocket

Runtime build-profile selection and npm tarball packaging are related but
separate:

- Runtime availability is controlled by `WORKSPACE_DEV_PIPELINES`.
- Published tarball contents are controlled by `scripts/build-profile.mjs` and
  `scripts/pack-profile-contract.mjs`.

Supported runtime values:

| Value | Runtime pipeline IDs |
| --- | --- |
| `default` | `default` |
| `rocket` | `rocket` |
| `default,rocket` | `default`, `rocket` |
| `default-rocket` | `default`, `rocket` |

Supported package profiles:

| Profile | Packaged templates | Packaged metadata |
| --- | --- | --- |
| `default` | `template/react-tailwind-app` | `workspaceDev.buildProfile: "default"`, `pipelineIds: ["default"]` |
| `rocket` | `template/react-mui-app` | `workspaceDev.buildProfile: "rocket"`, `pipelineIds: ["rocket"]` |
| `default-rocket` | both templates | `workspaceDev.buildProfile: "default-rocket"`, `pipelineIds: ["default", "rocket"]` |

The profile packer copies the compiled runtime from `dist/`, an explicit root
file allowlist, an explicit docs allowlist, and only the templates owned by the
selected profile. Repository fixtures, source tests, template `node_modules`,
template build output, and unrelated internal files do not ship.

Maintainers can inspect the profile plan without building:

```bash
node scripts/build-profile.mjs --dry-run --profile default
node scripts/build-profile.mjs --dry-run --profile rocket
node scripts/build-profile.mjs --dry-run --profile default,rocket
```

Package verification should cover the profile that changed. For package-boundary
or docs-allowlist changes, run the full profile validation:

```bash
pnpm run verify:pack
```

## Migrate Existing Customers To Rocket

Existing customer integrations that depend on the current React + MUI generator,
customer profiles, customer brand inputs, customer component mappings, customer
import aliases, or direct MUI/Emotion mappings should submit with
`pipelineId: "rocket"` explicitly.

Before:

```json
{
  "figmaSourceMode": "local_json",
  "llmCodegenMode": "deterministic",
  "figmaJsonPath": "fixtures/customer-board/figma.json",
  "customerProfilePath": "profiles/customer-profile.json"
}
```

After:

```json
{
  "pipelineId": "rocket",
  "figmaSourceMode": "local_json",
  "llmCodegenMode": "deterministic",
  "figmaJsonPath": "fixtures/customer-board/figma.json",
  "customerProfilePath": "profiles/customer-profile.json"
}
```

For shared submit helpers, decide the pipeline before constructing
`WorkspaceJobInput`. If a helper receives any Rocket-specific signal, set
`pipelineId: "rocket"` in the same branch that adds the Rocket-specific fields.
If no Rocket-specific signals are present, omit `pipelineId` only when the
client intentionally wants the runtime default pipeline.

During rollout:

1. Read `GET /workspace`.
2. Confirm `availablePipelines` includes `rocket`.
3. Confirm `defaultPipelineId` before relying on an omitted `pipelineId`.
4. Submit at least one customer-profile fixture with explicit
   `pipelineId: "rocket"`.
5. Assert generated `package.json`, `tsconfig.json`, and `vite.config.ts`
   contain the expected customer dependency and alias entries.

Rollback is package-version based: pin the previous certified `workspace-dev`
package version. Do not use `CONTRACT_VERSION` as a dependency pin; it is for
contract audits and compatibility checks.

## Compatibility Fallback Policy

The omitted-`pipelineId` Rocket auto-selection path is a temporary compatibility
bridge for existing customers. It is not the preferred integration contract for
new or migrated clients.

The fallback currently applies only when all of these are true:

- The current runtime build exposes both `default` and `rocket`.
- The request omits `pipelineId`.
- The request includes at least one Rocket-specific signal.

When the fallback applies, the runtime selects `rocket` and records the
`LEGACY_ROCKET_AUTO_SELECTED` warning. Clients should treat that warning as a
migration signal and update submit payloads to explicit `pipelineId: "rocket"`.

The fallback may be removed only in a future package-major release. The removal
change set must include:

1. `CHANGELOG.md` and Changeset release notes that call out the package-major
   breaking change and the explicit `pipelineId: "rocket"` migration.
2. Updated migration docs that describe the post-removal failure mode for
   omitted-`pipelineId` Rocket-specific inputs.
3. Contract evidence updates if request semantics, response shape, status codes,
   or error codes change.
4. Regression tests proving explicit `pipelineId: "rocket"` still works and
   omitted-`pipelineId` Rocket-specific requests follow the documented
   post-removal behavior.

## Verification Checklist

For documentation-only changes to this contract, use the smallest meaningful
checks:

```bash
pnpm run docs:check
pnpm exec tsx --test src/job-engine/pipeline/pipeline-selection.test.ts
pnpm exec tsx --test --test-name-pattern "submitRegeneration rejects cross-pipeline pipelineId overrides|submitRegeneration rejects Rocket-specific inputs on default-pipeline sources" src/job-engine/regeneration.test.ts
node --test scripts/build-profile.test.mjs
```

For docs allowlist, packaging, or package-boundary changes, add:

```bash
pnpm run verify:pack
```

For source contract comment or exported type changes, regenerate and check API
docs:

```bash
pnpm run docs:api
pnpm run docs:api:check
```
