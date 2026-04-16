# COMPLIANCE Manifest

`workspace-dev` compliance evidence map for enterprise OSS consumers (banks and insurers).

## DORA Control Mapping

| Control | DORA Reference | Implementation | Evidence |
| --- | --- | --- | --- |
| ICT risk management and resilient engineering practices | Article 6 | Zero-runtime-dependency architecture, local-only default runtime boundary, package-scoped threat model, deterministic quality gates | `ARCHITECTURE.md`, `THREAT_MODEL.md`, CI quality workflows |
| Change governance and traceability | Article 9 | Changesets release flow, contract changelog discipline, reproducibility gates | `CHANGELOG.md`, `CONTRACT_CHANGELOG.md`, release workflows |
| Incident handling and disclosure process | Article 10 | Security intake + CVSS SLA timelines + coordinated disclosure process | `SECURITY.md`, `SLA.md` |
| Third-party ICT supply-chain risk | Article 28 | OIDC trusted publishing, provenance, SBOM, signature verification, runtime dependency minimization | `.github/workflows/changesets-release.yml`, `sbom:*` scripts, `npm audit signatures` gates |

## Release Evidence Requirements

Each release candidate must provide:

- Quality gate pass evidence:
  - `typecheck`
  - `test`, `test:flaky-retry`, `test:bdd`, `test:property-based`
  - `lint:boundaries`
  - `build`
  - `lint:publint`
  - `lint:types-publish`
- Supply-chain evidence:
  - CycloneDX SBOM (`artifacts/sbom/workspace-dev.cdx.json`)
  - SPDX SBOM (`artifacts/sbom/workspace-dev.spdx.json`)
  - OpenVEX artifact (`openvex.json`)
  - Signature verification (`npm audit signatures`)
  - Provenance-enabled publish path
- Operational evidence:
  - Package threat model and security boundary references (`THREAT_MODEL.md`, `SECURITY.md`, `ARCHITECTURE.md`)
  - Reproducible build verification report
  - Offline installation verification
  - License allowlist verification

## License Allowlist Policy

`pnpm run verify:licenses` enforces the manifest license for `workspace-dev` and `template/react-mui-app`, then scans the installed `template/react-mui-app` dependency tree transitively from `node_modules`.

Approved license expressions for the shipped template graph:

- `(MIT OR CC0-1.0)`
- `0BSD`
- `Apache-2.0`
- `BSD-2-Clause`
- `BSD-3-Clause`
- `BlueOak-1.0.0`
- `CC-BY-4.0`
- `CC0-1.0`
- `ISC`
- `MIT`
- `MIT-0`
- `MPL-2.0`
- `Python-2.0`

Active exceptions: none.

If a maintainer needs to approve a new license temporarily, record it in the relevant PR and release notes with this exception shape:

- `package`: resolved package name
- `version`: resolved package version
- `license`: exact SPDX identifier or SPDX expression from `package.json`
- `reason`: why the dependency is required and why replacement is not yet viable
- `owner`: maintainer approving the exception
- `expires`: date the exception must be removed or re-reviewed
- `tracking`: issue or PR reference for the cleanup

## Manual Attestations

These controls are repository/organization scoped and therefore attested by maintainers:

- npm org 2FA enforcement for publish-capable identities.
- Branch protections and required reviews on protected branches.
- Trusted Publisher binding to approved repository/workflow identity.

## Review Cadence

- Quarterly: DORA control and evidence review.
- Release-time: full gate and artifact verification.
- Incident-time: immediate evidence refresh for affected versions.
