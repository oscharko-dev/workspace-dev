# Contract Migration Guide

This guide is for consumers that compile against `workspace-dev/contracts` or
store contract-versioned payloads for later replay.

`workspace-dev` has two independent version tracks. See
[`VERSIONING.md`](../VERSIONING.md) for the full package-versus-contract policy.

- the npm package version, which consumers install and pin in `package.json`
- `CONTRACT_VERSION`, which identifies the public contract surface exported from
  `workspace-dev/contracts`

Use the package version for dependency installation and release rollout. Use
`CONTRACT_VERSION` for compatibility audits, contract-specific reviews, and
runtime guardrails in downstream tooling.

## Detect The Current Contract Version

Read `CONTRACT_VERSION` from the contracts subpath. This is the same runtime
constant used by the package and contract tests.

```bash
node -e 'import("workspace-dev/contracts").then(({ CONTRACT_VERSION }) => console.log(CONTRACT_VERSION))'
```

```ts
import { CONTRACT_VERSION } from "workspace-dev/contracts";

console.log(`workspace-dev contract: ${CONTRACT_VERSION}`);
```

Downstream tools that receive a generated artifact, import-session envelope, or
other versioned payload should compare the recorded contract version with the
range they support before attempting replay or mutation.

```ts
import { CONTRACT_VERSION } from "workspace-dev/contracts";

const SUPPORTED_CONTRACT_MAJOR = 3;

const [contractMajor] = CONTRACT_VERSION.split(".").map(Number);

if (contractMajor !== SUPPORTED_CONTRACT_MAJOR) {
  throw new Error(
    `Unsupported workspace-dev contract ${CONTRACT_VERSION}; expected major ${SUPPORTED_CONTRACT_MAJOR}.`,
  );
}
```

## Versioning Policy

Contract changes are documented in [`CONTRACT_CHANGELOG.md`](../CONTRACT_CHANGELOG.md).
The changelog entry for each bump is the source of truth for migration impact.

Use this policy when planning upgrades:

| Change type | Compatibility | Expected bump |
| --- | --- | --- |
| New optional field, exported type, endpoint, or response field | Additive | Minor |
| Narrowed enum or union, required field addition, field removal, field rename, type change, status-code change, or error-code rename | Breaking | Major |
| Documentation-only clarification | Behavior-preserving | No contract bump |
| Patch-level correction that preserves the accepted shape | Compatible fix | Patch |

If a changelog entry says a field was removed, renamed, made required, or
narrowed, treat the upgrade as breaking even when your compiler does not flag
every call site immediately.

## Pin Package Versions And Gate Contract Ranges

Consumers pin the npm package version, not `CONTRACT_VERSION`.

```json
{
  "devDependencies": {
    "workspace-dev": "1.0.0"
  }
}
```

For automated upgrade lanes, pin an npm range that matches your release policy
and add a runtime or CI check for the contract range you have certified.

```json
{
  "devDependencies": {
    "workspace-dev": "~1.0.0"
  },
  "scripts": {
    "check:workspace-contract": "tsx scripts/check-workspace-contract.ts"
  }
}
```

```ts
// scripts/check-workspace-contract.ts
import { CONTRACT_VERSION } from "workspace-dev/contracts";

const SUPPORTED_CONTRACTS = /^3\.(1[0-6])\.\d+$/;

if (!SUPPORTED_CONTRACTS.test(CONTRACT_VERSION)) {
  throw new Error(
    `workspace-dev contract ${CONTRACT_VERSION} has not been certified by this repository.`,
  );
}
```

For generated artifacts or persisted import-session data, record both the
installed package version and `CONTRACT_VERSION` in your own release evidence so
you can reproduce which package delivered which contract.

## Existing Customer Pipeline Requests

Existing clients that rely on the current React + MUI generator, customer
profiles, storybook-first component mappings, or customer-specific import
aliases should select the compatibility pipeline explicitly:

```json
{
  "pipelineId": "rocket",
  "figmaSourceMode": "local_json",
  "llmCodegenMode": "deterministic",
  "figmaJsonPath": "fixtures/customer-board/figma.json",
  "customerProfilePath": "profiles/customer-profile.json"
}
```

The current package build profile includes both `default` and `rocket`, so jobs
without a `pipelineId` resolve to `default`. Customer-profile jobs should keep
`pipelineId: "rocket"` to preserve existing React + MUI generation semantics.

Customer-profile template dependencies and import aliases are applied by the
`rocket` `template.prepare` delegate. Downstream smoke tests for existing
customer integrations should submit at least one fixture with both
`pipelineId: "rocket"` and `customerProfilePath`, then assert that generated
`package.json`, `tsconfig.json`, and `vite.config.ts` contain the expected
customer dependency and alias entries.

During rollout, read `GET /workspace` and confirm `availablePipelines` includes
`rocket`. If both `default` and `rocket` are listed, also confirm
`defaultPipelineId` before deciding whether an omitted `pipelineId` is safe for a
given client. Roll back a customer integration by pinning the previous certified
`workspace-dev` package version; for packages that predate `WorkspaceJobInput`
pipeline selection, remove `pipelineId` from the submit payload while pinned.

## Breaking-Change Migration Checklist

Copy this checklist into the pull request that upgrades `workspace-dev` across a
breaking contract bump.

```md
## workspace-dev contract migration

- From contract version:
- To contract version:
- Package version or range being installed:
- Changelog entries reviewed:
- Affected downstream packages, jobs, fixtures, or persisted payloads:
- Compile-time changes made:
- Runtime compatibility checks updated:
- Fixtures regenerated or intentionally left unchanged:
- Rollback package version:
- Verification commands:
```

Recommended verification:

1. Run the downstream TypeScript compile or typecheck command.
2. Run the smallest integration test that submits a workspace job.
3. Run any replay/import-session tests that read persisted contract-versioned
   data.
4. Run the downstream contract-range check before merging.

## Example: Migrating To Contract 3.16.0

Contract `3.16.0` tightened the submit surface:

- `WorkspaceJobInput.figmaSourceMode` is typed as `WorkspaceFigmaSourceMode`
  instead of a loose `string`.
- `WorkspaceJobInput.llmCodegenMode` is typed as `WorkspaceLlmCodegenMode`
  instead of a loose `string`.
- `WorkspaceJobInput.requestSourceMode` was removed from the public submit
  input. Submit-origin metadata is now set server-side; persisted
  `WorkspaceJobRequestMetadata.requestSourceMode` remains available for replay
  and audit reads.

### Before

This pattern compiled against the older loose submit input, but it should fail
after the 3.16.0 contract is installed.

```ts
import type { WorkspaceJobInput } from "workspace-dev/contracts";

const modeFromConfig: string = process.env.WORKSPACE_FIGMA_MODE ?? "local_json";

const job: WorkspaceJobInput = {
  figmaSourceMode: modeFromConfig,
  llmCodegenMode: "deterministic",
  requestSourceMode: "figma_paste",
  figmaJsonPath: "fixtures/example/figma.json",
};

console.log(job);
```

Expected TypeScript failures:

- `string` is not assignable to `WorkspaceFigmaSourceMode`
- `requestSourceMode` does not exist on `WorkspaceJobInput`

### After

Validate or narrow untrusted mode strings before constructing
`WorkspaceJobInput`, and stop sending `requestSourceMode` as submit input.

```ts
import {
  ALLOWED_FIGMA_SOURCE_MODES,
  type WorkspaceFigmaSourceMode,
  type WorkspaceJobInput,
} from "workspace-dev/contracts";

function toWorkspaceFigmaSourceMode(value: string): WorkspaceFigmaSourceMode {
  if (
    ALLOWED_FIGMA_SOURCE_MODES.includes(value as WorkspaceFigmaSourceMode)
  ) {
    return value as WorkspaceFigmaSourceMode;
  }

  throw new Error(`Unsupported figmaSourceMode: ${value}`);
}

const modeFromConfig = process.env.WORKSPACE_FIGMA_MODE ?? "local_json";

const job: WorkspaceJobInput = {
  figmaSourceMode: toWorkspaceFigmaSourceMode(modeFromConfig),
  llmCodegenMode: "deterministic",
  figmaJsonPath: "fixtures/example/figma.json",
};

console.log(job);
```

Runnable verification in a downstream repository:

```bash
node -e 'import("workspace-dev/contracts").then(({ CONTRACT_VERSION }) => console.log(CONTRACT_VERSION))'
pnpm exec tsc --noEmit
pnpm run check:workspace-contract
```

If your downstream code used `requestSourceMode` only to preserve the original
paste/import source, read it from `WorkspaceJobRequestMetadata` or persisted
import-session records after submission instead of providing it in the submit
request.

## Rollback

Rollback by reverting the downstream npm package pin or range to the last
certified `workspace-dev` package version. Do not edit `CONTRACT_VERSION` in a
consumer repository; it is owned by the installed package.
