# COMPLIANCE Manifest

`workspace-dev` compliance evidence map for enterprise OSS consumers (banks and insurers).

## DORA Control Mapping

| Control                                                 | DORA Reference    | Implementation                                                                                                                                                                                                    | Evidence                                                                                                                                                                           |
| ------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ICT risk management and resilient engineering practices | Article 6         | Zero-runtime-dependency architecture, local-only default runtime boundary, package-scoped threat model, deterministic quality gates                                                                               | `ARCHITECTURE.md`, `THREAT_MODEL.md`, CI quality workflows                                                                                                                         |
| Change governance and traceability                      | Article 9         | Changesets release flow, contract changelog discipline, reproducibility gates                                                                                                                                     | `CHANGELOG.md`, `CONTRACT_CHANGELOG.md`, release workflows                                                                                                                         |
| Incident handling and disclosure process                | Article 10        | Security intake + CVSS SLA timelines + coordinated disclosure process                                                                                                                                             | `SECURITY.md`, `SLA.md`                                                                                                                                                            |
| Third-party ICT supply-chain risk                       | Article 28        | OIDC trusted publishing, provenance, SBOM, signature verification, runtime dependency minimization                                                                                                                | `.github/workflows/changesets-release.yml`, `sbom:*` scripts, `npm audit signatures` gates                                                                                         |
| Figma-to-QC test-intelligence subsurface                | Articles 6, 9     | Opt-in dual-gate (env + start option), deterministic mock-LLM CI gate, fail-closed bearer governance, schema-versioned artifacts, evidence manifest with SHA-256 verification                                     | `docs/test-intelligence.md`, `wave1-poc-evidence-manifest.json`, `validation-report.json`, `policy-report.json`, `review-events.json`, `export-report.json`, `dry-run-report.json` |
| Wave 4 multi-source ingestion (Jira + custom context)   | Articles 6, 9, 28 | Nested dual-gate (parent + multi-source env + startup option), paste-only air-gap path, JQL-injection and SSRF guards, ADF allow-list parser, PII redaction before IR placement, data-minimization audit metadata | `docs/dora/multi-source.md`, `docs/dpia/jira-source.md`, `jira-issue-ir.json`, `multi-source-conflicts.json`                                                                     |

## Figma-to-QC Test Intelligence Subsurface

The opt-in test-intelligence subsurface emits compliance evidence per job. It does not assert customer-specific risk classification; the operator decides how the evidence maps onto their own DORA, GDPR, and EU AI Act obligations. The full operator guide is in [docs/test-intelligence.md](docs/test-intelligence.md).

### GDPR controls

| Concern                 | Implementation                                                                                                                                                                                                                                   | Evidence                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Data minimization       | Business-test-intent IR derivation strips structural-only data; `redactPii` runs before prompt compilation; `REDACTION_POLICY_VERSION` is replay-stable                                                                                          | `validation-report.json`, `policy-report.json`, redaction policy version stamped on every manifest                               |
| PII detection           | Hand-rolled detector emits `test_data_pii_detected`, `preconditions_pii_detected`, `expected_results_pii_detected`, `test_data_unredacted_value`; visual sidecar gate emits `visual_sidecar_possible_pii`; policy gate consumes both             | `validation-report.json`, `visual-sidecar-validation-report.json`                                                                |
| Screenshot handling     | No raw screenshot bytes are persisted; only SHA-256 capture identities are recorded; `rawScreenshotsIncluded: false` is stamped at the type level on the visual sidecar result, the export report, the dry-run report, and the evidence manifest | `visual-sidecar-result.json`, `wave1-poc-evidence-manifest.json`, `export-report.json`, `dry-run-report.json`                    |
| Retention               | Operator-controlled artifact root; package never deletes artifacts; canonical-JSON plus atomic temp-file rename so replay is byte-identical                                                                                                      | `<artifactRoot>/<jobId>/`                                                                                                        |
| DPIA-ready evidence     | Per-job validation, policy, coverage, review event log, and evidence manifest                                                                                                                                                                    | `validation-report.json`, `policy-report.json`, `coverage-report.json`, `review-events.json`, `wave1-poc-evidence-manifest.json` |
| Jira source (Wave 4)    | Jira ADF allow-list parser; PII redacted before IR placement; comments/attachments/links/custom fields excluded by default; every opt-in recorded in `dataMinimization`; raw paste bytes never persisted; SSRF guard; JQL-injection guard        | `jira-issue-ir.json` (`piiIndicators`, `redactions`, `dataMinimization`); `docs/dpia/jira-source.md`                             |
| Custom context (Wave 4) | Markdown allow-list parser; PII-redacted canonical form only; raw Markdown not persisted; bearer-principal-derived author handle; per-job byte budget; structured attributes PII-redacted and normalized before persistence                      | `custom-context.json` (`redactionIndicators`, `authorHandle`); `docs/dpia/custom-context-source.md`                              |

### EU AI Act considerations

Classification under the EU AI Act is context-dependent. The package does not assert that the test-intelligence subsurface is a high-risk AI system; that determination depends on the operator's deployment context, business process, and risk register. The package emits the evidence an operator typically needs to perform that classification themselves:

- Model deployment names and roles per job, captured in `wave1-poc-evidence-manifest.json`.
- Prompt template version (`TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION`) and JSON-schema digest used to constrain output.
- Per-case validation, policy, coverage, and visual-sidecar outcomes.
- Review-state event log with reviewer handles and timestamps (`review-events.json`).
- Pass/fail evaluation report with thresholds (`wave1-poc-eval-report.json`).
- Reviewer-driven gate enforces a human-in-the-loop step before any case reaches the export pipeline.
- Wave 4 conflict-resolution gate and four-eyes trigger on `multi_source_conflict_present` provide additional Art. 14 human oversight controls for multi-source jobs; see [docs/eu-ai-act/human-oversight.md](docs/eu-ai-act/human-oversight.md).

Customer-specific HSM/KMS integrations and enforced signing requirements are out of scope for Wave 2 and remain operator responsibilities. The Wave 2 test-intelligence POC does emit sibling in-toto DSSE attestations for evidence manifests by default in unsigned mode, with opt-in local Sigstore-shaped signing for operators that explicitly supply signing material (Issue #1377).

### Gateway operator responsibilities

The operator runs the LLM gateway. For the structured-test-case generator role (`gpt-oss-120b` deployment) the operator is responsible for: pinning the model revision, applying change-controlled gateway releases (DORA Article 28), running `probeLlmCapabilities` and persisting `llm-capabilities.json` evidence, choosing a gateway/model combination that honors the hand-rolled JSON-Schema for structured outputs, configuring the gateway with the strictest acceptable retention, and recording auth-mode and compatibility-mode discriminants for audit. The visual sidecar deployments (`llama-4-maverick-vision`, `phi-4-multimodal-poc`) are subject to the same responsibilities, plus the role-separation invariant that `gpt-oss-120b` never receives image payloads.

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
