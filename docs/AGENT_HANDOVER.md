# Agent Handover — workspace-dev Standalone Repository

Date: 2026-03-13  
Scope: `workspace-dev` standalone OSS repository (`oscharko-dev/workspace-dev`).

## 1) Current state

- Standalone hard split is complete and available on `main`.
- Package version is `1.0.0`.
- Legacy CLI alias has been removed (breaking change already shipped).
- Template parity coupling to monorepo internals has been removed; integrity is validated via internal deterministic hash snapshots.
- Standalone release and quality workflows are active in this repository.

## 2) Validated gates (expected green before release)

Run in this repository root:

- `pnpm run lint:boundaries`
- `pnpm run typecheck`
- `pnpm run test`
- `pnpm run build`
- `pnpm run verify:pack`
- `pnpm run prepublishOnly`

## 3) Key changes included in standalone baseline

- Breaking CLI/bin cleanup:
  - `package.json` bin keeps only `workspace-dev`
  - CLI/help/tests/docs aligned with the single command
- Standalone template integrity:
  - `src/parity-template.test.ts` validates deterministic SHA-256 snapshots of bundled template files
- Governance/docs cleanup:
  - repository references target `oscharko-dev/workspace-dev`
  - deprecated monorepo/mirror references removed from active docs
- Supply-chain hardening:
  - `.github/CODEOWNERS`
  - lockfile host allowlist gate (`scripts/check-lockfile-host-allowlist.mjs`)
  - OSSF Scorecard workflow
  - hardened `prepublishOnly` gate chain
- Packaging gate stability:
  - `scripts/validate-pack.sh` includes template-aware checks and tarball integrity assertions

## 4) Important files to review first

- `package.json`
- `src/parity-template.test.ts`
- `scripts/validate-pack.sh`
- `scripts/check-lockfile-host-allowlist.mjs`
- `.github/workflows/changesets-release.yml`
- `.github/workflows/release-gate.yml`
- `.github/workflows/ossf-scorecard.yml`
- `docs/hard-split-cutover.md`

## 5) Release operator checklist

1. Ensure working tree is clean.
2. Run full release gates (`pnpm run prepublishOnly`).
3. Confirm npm Trusted Publisher is configured for this repository/workflow.
4. Trigger `changesets-release` workflow when release criteria are met.
5. Keep legacy FullVersion repository in deprecated/frozen mode.

## 6) Notes / caveats

- FIPS smoke can report `skip` when host OpenSSL FIPS module is unavailable (`verify:fips` is designed for this).
- `workspace-dev` runtime is intentionally local-only and deterministic-mode locked (`rest` + `deterministic`).
