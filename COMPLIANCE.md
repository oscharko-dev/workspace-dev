# COMPLIANCE Manifest

`workspace-dev` compliance evidence map for enterprise OSS consumers (banks and insurers).

## DORA Control Mapping

| Control | DORA Reference | Implementation | Evidence |
| --- | --- | --- | --- |
| ICT risk management and resilient engineering practices | Article 6 | Zero-runtime-dependency architecture, local-only runtime boundary, deterministic quality gates | `ARCHITECTURE.md`, CI quality workflows |
| Change governance and traceability | Article 9 | Changesets release flow, contract changelog discipline, reproducibility gates | `CHANGELOG.md`, `CONTRACT_CHANGELOG.md`, release workflows |
| Incident handling and disclosure process | Article 10 | Security intake + CVSS SLA timelines + coordinated disclosure process | `SECURITY.md`, `SLA.md` |
| Third-party ICT supply-chain risk | Article 28 | OIDC trusted publishing, provenance, SBOM, signature verification, runtime dependency minimization | `.github/workflows/npm-publish.yml`, `sbom:*` scripts, `npm audit signatures` gates |

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
  - Reproducible build verification report
  - Offline installation verification
  - License allowlist verification

## Manual Attestations

These controls are repository/organization scoped and therefore attested by maintainers:

- npm org 2FA enforcement for publish-capable identities.
- Branch protections and required reviews on protected branches.
- Trusted Publisher binding to approved repository/workflow identity.

## Review Cadence

- Quarterly: DORA control and evidence review.
- Release-time: full gate and artifact verification.
- Incident-time: immediate evidence refresh for affected versions.
