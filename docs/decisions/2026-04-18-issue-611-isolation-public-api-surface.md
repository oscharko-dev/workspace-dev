# ADR: Issue #611 Isolation Public API Surface

- Status: Accepted
- Date: 2026-04-18
- Issue: #611

## Context

`workspace-dev` currently re-exports the isolation lifecycle helpers from the root
package entrypoint in `src/index.ts`. The package export map only exposes `.`
and `./contracts`, so consumers that use these helpers do so through the root
`workspace-dev` import path.

The audit for Issue #611 found:

- the root barrel explicitly labels itself as the public API surface,
- `src/contract-version.test.ts` snapshots the isolation helpers as part of the
  public runtime export set,
- `README.md` did not previously describe these helpers as an intended advanced
  public API,
- public GitHub code search did not show clear external usage, but also did not
  prove that no consumers rely on the root exports.

Because the helpers are already exported from the root entrypoint and guarded by
public-surface tests, removing or relocating them now would be a semver-governed
breaking API change.

## Decision

Keep the isolation helpers on the root `workspace-dev` entrypoint and document
them as a stable advanced public API.

Do not reduce the root export surface in Issue #611.

## Isolation API Classification

Core stable surface for typical consumers:

- `createWorkspaceServer`
- contract types exported from `workspace-dev`
- runtime contract constants and mode-lock helpers exported from `workspace-dev`

Advanced stable surface for embedders and orchestration hosts:

- `createProjectInstance`
- `getProjectInstance`
- `removeProjectInstance`
- `removeAllInstances`
- `listProjectInstances`
- `registerIsolationProcessCleanup`
- `unregisterIsolationProcessCleanup`
- `ProjectInstance`

Moved in this decision:

- None

Not currently public via a dedicated subpath:

- `workspace-dev/isolation` does not exist today

## Stability Annotations

- Core stable: intended for normal package consumption and day-to-day
  integrations.
- Advanced stable: supported and semver-governed, but intended for consumers
  that need to orchestrate multiple isolated child processes in one host.
- Not experimental: the isolation helpers are not treated as temporary or
  internal-only while they remain root exports.

## Consequences

- Documentation must describe the advanced isolation surface and its intended
  audience.
- Future relocation behind a dedicated subpath requires an explicit
  compatibility plan, additive rollout first, and only a later breaking removal
  from the root entrypoint.
- No `CONTRACT_VERSION` bump is required for this ADR because the public API
  surface did not change in Issue #611.
