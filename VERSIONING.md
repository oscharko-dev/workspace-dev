# Versioning Policy

`workspace-dev` intentionally uses two independent version tracks.

## Package Version

- The package version is the version that consumers install and pin in their own `package.json`.
- It is published to npm as `workspace-dev` and is reflected in GitHub Releases.
- Use the package version for dependency management, release notes, and rollout coordination.

## Contract Version

- `CONTRACT_VERSION` is the public API and schema compatibility version exported from `src/contracts/index.ts`.
- It is tracked in `CONTRACT_CHANGELOG.md`.
- Use the contract version for compatibility audits, integration reviews, and contract-specific change tracking.

## Runtime Export Surface

- The root `workspace-dev` entrypoint is also a semver-governed public API surface.
- Root barrel exports in `src/index.ts` are intentional public package exports, not private implementation details.
- Removing or relocating an existing root export is a public package API change and requires explicit compatibility treatment before merge.
- Breaking changes to existing root exports are governed by package semver and release through Changesets and package release notes.
- `CONTRACT_VERSION` and `CONTRACT_CHANGELOG.md` govern versioned contract changes in `src/contracts/`; they do not automatically apply to every root-export change.
- Additive documentation that clarifies the intended audience or stability of an existing root export does not, by itself, require a `CONTRACT_VERSION` bump.

## How The Two Tracks Relate

- Package version and contract version do not need to match numerically.
- Every public contract change must bump `CONTRACT_VERSION` and add a `CONTRACT_CHANGELOG.md` entry before merge.
- Package version bumps are handled by Changesets and the release workflow at publish time.
- A non-contract change can still produce a package version bump.
- Multiple contract version bumps can accumulate before the next published package release.

## Release Source Of Truth

- npm and GitHub Releases are the authoritative sources for published package versions.
- The checked-in `package.json` version in `dev`, `dev-gate`, or `main` can lag the latest published package version because `.github/workflows/changesets-release.yml` may apply a workflow-local version bump for publishing without committing that bump back to protected branches.

## Related Documents

- `README.md` explains which version consumers should pin.
- `CHANGELOG.md` tracks package release history.
- `CONTRACT_CHANGELOG.md` tracks public contract history and contract bump rules.
