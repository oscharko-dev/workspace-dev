# ESCROW

Escrow requirements for `workspace-dev` release continuity and recoverability.

## Escrow Triggers

- Primary maintainers are unavailable for more than 5 business days during an active incident.
- A critical supply-chain event requires third-party reproducibility verification.
- Regulatory or contractual audit requires evidence preservation.

## Escrow Artifact Set

- Source code at release tag.
- `pnpm-lock.yaml` and release workflow definitions.
- Release evidence artifacts (SBOM artifacts, deterministic hash output).
- Governance and security manifests (`COMPLIANCE.md`, `SLA.md`, `ZERO_TELEMETRY.md`, `SECURITY.md`).

## Restore Procedure

1. Checkout the escrowed release tag and verify commit signature policy.
2. Rebuild package with frozen lockfile and deterministic hash checks.
3. Re-run tests and release gates.
4. Publish forward-fix version if remediation is needed.

## Responsibilities

- Release Engineering: escrow package and workflow artifacts.
- Security Engineering: validate integrity and incident alignment.
- Platform Engineering: execute restoration and reproducibility verification.
