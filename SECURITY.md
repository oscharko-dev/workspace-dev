# Security Policy

## Supported Versions

| Version | Support Status |
| --- | --- |
| `latest` | Supported |
| `next` | Best effort |
| Older than `latest` | Not supported |

## Reporting a Vulnerability

Do not open public issues for security vulnerabilities.

Report privately to: [security@oscharko.dev](mailto:security@oscharko.dev)

Please include:

- Impact summary
- Reproduction steps
- Affected versions
- Suggested remediation (optional)

## Response SLAs

| Severity | CVSS | Acknowledge | Mitigation/Fix Target |
| --- | --- | --- | --- |
| Critical | 9.0-10.0 | 4 hours | 24 hours |
| High | 7.0-8.9 | 8 hours | 72 hours |
| Medium | 4.0-6.9 | 24 hours | 7 calendar days |
| Low | 0.1-3.9 | 48 hours | Next scheduled release |

## Coordinated Disclosure Workflow

1. Intake and triage in private channel.
2. Risk analysis and severity classification.
3. Patch development with release-gate evidence.
4. Advisory publication with affected/fixed versions.
5. Deprecation of vulnerable versions and forward patch release.

## Security Controls in This Package

- Package-scoped threat model with implementation references: `THREAT_MODEL.md`.
- Zero runtime dependencies (supply-chain minimization).
- No install lifecycle scripts (`preinstall`, `install`, `postinstall`).
- Local-only default bind (`127.0.0.1`).
- Browser write routes enforce same-origin browser metadata; cross-origin embedded write access is unsupported.
- Protected write-route preflight (`OPTIONS`) requests return explicit `405 Method Not Allowed` with `Allow: POST` and no permissive CORS allow headers.
- `pnpm run test:dast-smoke` exercises the live HTTP runtime for header enforcement, same-origin behavior, and traversal rejection.
- `Strict-Transport-Security` is opt-in via `FIGMAPIPE_WORKSPACE_ENABLE_HSTS=true` and is intended only for HTTPS deployments behind a trusted TLS-terminating proxy; plain `http://127.0.0.1` and `http://localhost` should not emit HSTS.
- Runtime mode-lock enforcement (`figmaSourceMode=rest|hybrid|local_json|figma_paste|figma_plugin` plus `llmCodegenMode=deterministic`).
- Runtime request validation and deterministic error envelopes.
- Error-message sanitization for PII/secret leakage reduction.
- Zero telemetry/call-home policy with static guard (`lint:no-telemetry`).

## Supply Chain and Provenance Controls

- OIDC trusted publishing in GitHub Actions (`id-token: write`).
- npm provenance enabled (`publishConfig.provenance=true` + publish provenance path).
- Signature verification gate (`npm audit signatures`) in CI.
- SBOM generation:
  - CycloneDX: `pnpm run sbom:cyclonedx`
  - SPDX: `pnpm run sbom:spdx`
- OpenVEX artifact generation in release workflows.

## Rollback and Remediation Policy

- Do not unpublish released versions.
- Use `npm deprecate` for affected versions.
- Publish patched forward release and update advisories.
