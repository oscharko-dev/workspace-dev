# Hard Split Cutover Runbook

This runbook describes the immediate cutover from monorepo package path to a standalone `workspace-dev` repository.

## 1) Extract standalone repository with history

Run from the monorepo root:

```bash
git subtree split --prefix=<workspace-dev-package-path> -b codex/workspace-dev-standalone
git clone . ../workspace-dev-standalone
cd ../workspace-dev-standalone
git checkout codex/workspace-dev-standalone
```

Then point `origin` to the dedicated repository:

```bash
git remote remove origin
git remote add origin git@github.com:oscharko-dev/workspace-dev.git
git push -u origin HEAD:main
```

## 2) Configure npm Trusted Publisher for standalone repo

1. Open npm package settings for `workspace-dev`.
2. Bind Trusted Publishing to repository `oscharko-dev/workspace-dev`.
3. Bind workflow `.github/workflows/changesets-release.yml`.
4. Remove legacy token-based publish credentials.

## 3) Freeze legacy FullVersion repository delivery

Apply in the old monorepo repository:

1. Mark repository status as deprecated/read-only for FullVersion.
2. Disable deploy/release workflows (`release`, deploy lanes, customer registry release, mirror, old npm publish).
3. Keep only archival/security visibility workflows as required by policy.

## 4) Validate standalone release line

Run in standalone repo root:

```bash
pnpm install --frozen-lockfile
pnpm run release:changesets:publish
```

Required evidence:

- `artifacts/sbom/*`
- `artifacts/reproducibility/*`
- generated `openvex.json`
