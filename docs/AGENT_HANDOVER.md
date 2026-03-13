# Agent Handover — workspace-dev Hard Split

Date: 2026-03-13  
Scope: `workspace-dev` extracted from FigmaPipe monorepo and prepared as standalone OSS package.

## 1) Current state

- Hard-split implementation is done in working tree (not yet committed).
- `workspace-dev` package version is `1.0.0`.
- Legacy CLI alias `figmapipe-workspace-dev` was removed (breaking change).
- Template parity coupling to `services/api/template` was removed; replaced by internal hash snapshot integrity test.
- Monorepo release/deploy workflows were replaced with deprecation no-op workflows.
- Root deprecation docs for FullVersion were added.

## 2) Validated gates (already green locally)

Run in monorepo root with `-C packages/workspace-dev`:

- `pnpm run lint:boundaries`
- `pnpm run typecheck`
- `pnpm run test`
- `pnpm run build`
- `pnpm run verify:pack`
- `pnpm run prepublishOnly`

Result: all passed.

## 3) Key changes included

- Breaking CLI/bin cleanup:
  - `package.json` bin keeps only `workspace-dev`
  - CLI/help/tests/docs updated accordingly
- Standalone template integrity:
  - `src/parity-template.test.ts` now checks deterministic SHA-256 snapshots of bundled template files
- Governance/docs cleanup:
  - references moved from `oscharko-dev/FigmaPipe` to `oscharko-dev/workspace-dev`
  - mirror model references removed
- Supply-chain hardening:
  - added `.github/CODEOWNERS`
  - added lockfile host allowlist gate (`scripts/check-lockfile-host-allowlist.mjs`)
  - added OSSF Scorecard workflow
  - `prepublishOnly` now includes `verify:pack` and lockfile-host gate
- Packaging gate fix:
  - `scripts/validate-pack.sh` no longer false-fails on template `tsconfig.json`

## 4) Important files to review first

- `packages/workspace-dev/package.json`
- `packages/workspace-dev/src/parity-template.test.ts`
- `packages/workspace-dev/scripts/validate-pack.sh`
- `packages/workspace-dev/scripts/check-lockfile-host-allowlist.mjs`
- `packages/workspace-dev/.github/workflows/changesets-release.yml`
- `packages/workspace-dev/.github/workflows/release-gate.yml`
- `packages/workspace-dev/.github/workflows/ossf-scorecard.yml`
- `packages/workspace-dev/docs/hard-split-cutover.md`

## 5) Cutover checklist (next operator)

1. Commit current changes in monorepo.
2. Re-run subtree split from committed state:
   - `git subtree split --prefix=packages/workspace-dev -b codex/workspace-dev-standalone`
3. Push branch content to standalone repo `oscharko-dev/workspace-dev` as `main`.
4. Configure npm Trusted Publisher to the standalone repo/workflow.
5. Keep FullVersion repo in deprecated/frozen mode (already prepared in workflows/docs).

## 6) Notes / caveats

- Current `pnpm` warnings about `services/*` overrides are monorepo-context warnings and do not block `workspace-dev` gates.
- FIPS check may report skip when host OpenSSL FIPS module is unavailable (`verify:fips` is designed for this).
