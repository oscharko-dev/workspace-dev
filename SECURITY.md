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

If GitHub private vulnerability reporting is enabled in repository settings, prefer that private reporting flow. Otherwise use the email address above. Do not disclose unpublished vulnerabilities in public issues, PRs, or commit messages.

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

1. Intake and triage in a private channel.
2. Risk analysis and severity classification.
3. Confirm the affected package, impacted surfaces, affected version ranges, and any available workaround or mitigation.
4. Prepare and validate the patch release before public disclosure.
5. Publish or update the advisory with affected and fixed versions.
6. Deprecate vulnerable versions and ship the patched forward release.

## GHSA Maintainer Checklist

1. Triage privately and keep unpublished details out of public issues, PRs, and release notes.
2. Open or update a draft GitHub Security Advisory (GHSA) once the report is confirmed.
3. Record the affected package name, affected version ranges, fixed version, severity, references, and any documented workaround.
4. Request or attach a CVE when advisory publication or downstream ecosystem tracking requires one.
5. Publish the patched release before disclosure whenever possible, then publish the GHSA with the fixed version and disclosure notes.
6. If a patch is not yet available, publish only when a documented mitigation or operational workaround is ready for affected users.
7. Update follow-up PRs and public release notes with the GHSA only after the advisory is public.

## Security Controls in This Package

- Package-scoped threat model with implementation references: `THREAT_MODEL.md`.
- Zero runtime dependencies (supply-chain minimization).
- No install lifecycle scripts (`preinstall`, `install`, `postinstall`).
- The default bind is `127.0.0.1`, but operators can change the host binding; doing so expands the exposure model.
- Browser write routes enforce same-origin browser metadata; cross-origin embedded write access is unsupported.
- Protected write-route preflight (`OPTIONS`) requests return explicit `405 Method Not Allowed` with `Allow: POST` and no permissive CORS allow headers.
- `pnpm run test:dast-smoke` exercises the live HTTP runtime for header enforcement, same-origin behavior, and traversal rejection.
- `Strict-Transport-Security` is opt-in via `FIGMAPIPE_WORKSPACE_ENABLE_HSTS=true` and is intended only for HTTPS deployments behind a trusted TLS-terminating proxy; plain `http://127.0.0.1` and `http://localhost` should not emit HSTS.
- Preview export and local-sync path handling use path-segment symlink checks plus stale-preview detection before apply; exploitation requires local filesystem write access to race those checks.
- Best-effort `O_NOFOLLOW` hardening is applied where Node exposes it, but it only protects the final path component and is not portable to Windows.
- Residual risk remains for ancestor-component TOCTOU races after validation and before the final open/write operation.
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
