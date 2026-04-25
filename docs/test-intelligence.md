# Figma-to-QC Test Case Intelligence

`workspace-dev` includes an opt-in subsurface that derives candidate quality-control
(QC) test cases from a Figma design through a reviewer-driven, deterministic
pipeline. The subsurface is local-first, fail-closed, and emits machine-verifiable
evidence for every step.

This document is the public reference for developers integrating the feature and
for platform, security, and compliance reviewers evaluating it. It does not
introduce new public APIs beyond what is already documented in
[CONTRACT_CHANGELOG.md](../CONTRACT_CHANGELOG.md) and the auto-generated
[contract API reference](api/contracts/README.md).

## Scope

In scope:

- How to enable the subsurface and run the bundled Wave 1 proof-of-concept (POC)
  against shipped synthetic fixtures.
- Job type and mode namespace for test-intelligence submissions.
- Artifact tree, schema versions, and persistence guarantees.
- Reviewer-driven review-gate state machine and bearer-protected write routes.
- Export-only QC artifact emission.
- OpenText ALM dry-run adapter (Wave 2).
- Evidence manifest and operator-side verification.
- Multimodal visual sidecar role separation.
- Network boundary, secret handling, and zero-telemetry behavior.
- DORA, GDPR, and EU AI Act considerations relevant to regulated operators.
- Gateway operator responsibilities for the structured-test-case generator role
  (`gpt-oss-120b`).

Out of scope:

- Production write-back to QC, ALM, or test-management systems. Wave 2 ships an
  `export_only` pipeline plus a `dry_run` adapter only; `api_transfer` is a
  reserved mode that returns a deterministic refusal.
- Customer-specific compliance decisions (risk classification, retention
  policies, residency, four-eyes review, sign-off authority). The package emits
  evidence; the operator decides what is acceptable.
- Discovery or generation of new model deployments. The operator brings their
  own gateway and deployments.

## How the subsurface relates to the rest of `workspace-dev`

- The deterministic Figma-to-code pipeline (`llmCodegenMode=deterministic`) is
  unchanged and runs without the feature flag.
- Test-intelligence introduces a separate `WorkspaceTestIntelligenceMode`
  namespace (`deterministic_llm`, `offline_eval`, `dry_run`). Changes to that
  namespace never affect `ALLOWED_LLM_CODEGEN_MODES`. The two namespaces are
  isolated by design.
- A new optional job type `figma_to_qc_test_cases` is reserved on
  `WorkspaceJobType`. It currently returns `501 NOT_IMPLEMENTED` from
  `POST /workspace/submit`; the Wave 1 POC harness, review gate, and export
  pipeline are reachable in-process and via the Inspector test-intelligence
  routes only. A future wave will wire the runner.
- All persisted artifacts use deterministic canonical-JSON serialization plus
  atomic temp-file rename, so replay produces byte-identical files for the same
  inputs.

## 1. Enable the subsurface

Both gates must hold. Either gate alone leaves the subsurface inert.

1. Set the environment variable at startup:

```bash
export FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1
```

2. Pass `testIntelligence.enabled: true` when constructing the runtime:

```ts
import { createWorkspaceServer } from "workspace-dev";
import type { WorkspaceStartOptions } from "workspace-dev/contracts";

const options: WorkspaceStartOptions = {
    host: "127.0.0.1",
    port: 1983,
    outputRoot: ".workspace-dev",
    testIntelligence: {
        enabled: true,
        // Optional: bearer token for review-gate write routes. When omitted or
        // blank, write routes return 503 fail-closed.
        reviewBearerToken: process.env.WORKSPACE_TI_REVIEW_BEARER_TOKEN,
        // Optional: directory under which test-intelligence artifacts are
        // persisted. Defaults to `<outputRoot>/test-intelligence`.
        artifactRoot: undefined,
    },
};

const server = await createWorkspaceServer(options);
```

3. The runtime exposes the new state via `GET /workspace`:

```json
{
    "testIntelligenceEnabled": true
}
```

The Inspector UI uses this flag to gate the **Test Intelligence** navigation
entry. When either gate is missing, every test-intelligence Inspector route
returns `503 FEATURE_DISABLED`.

### Failure-closed defaults

| Condition                                            | Behavior                                                  |
| ---------------------------------------------------- | --------------------------------------------------------- |
| `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE` unset        | All test-intelligence Inspector routes return `503`.      |
| `testIntelligence.enabled` unset or `false`          | All test-intelligence Inspector routes return `503`.      |
| `testIntelligence.reviewBearerToken` unset or blank  | Review-gate `POST` routes return `503`. Reads still work. |
| Bearer token present in request, does not match      | Review-gate `POST` routes return `401`.                   |
| Review action attempted from a terminal review state | Review-gate `POST` routes return `409 CONFLICT`.          |
| Approve attempted while policy decision is `blocked` | Review-gate `POST` routes return `409 CONFLICT`.          |

The bearer token is compared with a SHA-256-based timing-safe comparison and is
never logged. Bearer tokens, API keys, Authorization headers, and Figma access
tokens are routed through the package-wide secret-redaction helpers
(`redactHighRiskSecrets`, `sanitizeErrorMessage`) before reaching any error,
log line, or persisted artifact.

## 2. Run the Wave 1 POC against shipped fixtures

The Wave 1 POC harness composes the full pipeline on synthetic fixtures and
emits a verifiable evidence manifest. It uses a deterministic mock LLM by
default and never performs network calls.

Two public fixtures are shipped under `src/test-intelligence/fixtures/`:

- `poc-onboarding` — sign-up plus identity verification flow.
- `poc-payment-auth` — SEPA payment plus 3-D Secure authorization flow.

Both fixtures ship a companion `*.visual.json` sidecar so the visual sidecar
gate has a deterministic input.

Run the dedicated CI script from the repository root:

```bash
pnpm run test:ti-eval
```

This script runs the full POC harness, the validation pipeline, the export
pipeline, the visual sidecar client, the QC ALM dry-run adapter, plus the
golden-fixture and evidence verification suites. The script does not require
network access. Replay produces byte-identical artifact hashes for the same
fixture and configuration.

For an interactive walk-through, call the harness directly from a Node.js
script. The harness API is module-level and stable; see the contract API
reference for `Wave1PocFixtureId`, `Wave1PocEvidenceManifest`,
`Wave1PocEvalReport`, and the supporting types.

## 3. Job type and mode namespace

The opt-in job type and mode namespace appear on the public contract surface so
operators can plan integration without depending on the runner being wired:

| Symbol                                      | Value                                                                |
| ------------------------------------------- | -------------------------------------------------------------------- |
| `WorkspaceJobInput.jobType`                 | `"figma_to_code"` (default) \| `"figma_to_qc_test_cases"` (reserved) |
| `WorkspaceJobInput.testIntelligenceMode`    | `"deterministic_llm"` \| `"offline_eval"` \| `"dry_run"`             |
| `ALLOWED_TEST_INTELLIGENCE_MODES`           | `["deterministic_llm", "offline_eval", "dry_run"]`                   |
| `TEST_INTELLIGENCE_CONTRACT_VERSION`        | `"1.0.0"`                                                            |
| `TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION` | `"1.0.0"`                                                            |
| `TEST_INTELLIGENCE_ENV`                     | `"FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE"`                            |

The submit route accepts `jobType: "figma_to_qc_test_cases"` for forward
compatibility but currently returns `501 NOT_IMPLEMENTED`. Use the Wave 1 POC
harness or the Inspector test-intelligence routes for the in-process workflow.

## 4. Artifact tree

Artifacts are persisted under
`<artifactRoot>/<jobId>/` where `<artifactRoot>` defaults to
`<outputRoot>/test-intelligence`.

| Filename                                | Schema version constant                                  | Phase             |
| --------------------------------------- | -------------------------------------------------------- | ----------------- |
| `generated-testcases.json`              | `GENERATED_TEST_CASE_SCHEMA_VERSION`                     | Validation        |
| `validation-report.json`                | `TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION`             | Validation        |
| `policy-report.json`                    | `TEST_CASE_POLICY_REPORT_SCHEMA_VERSION`                 | Validation        |
| `coverage-report.json`                  | `TEST_CASE_COVERAGE_REPORT_SCHEMA_VERSION`               | Validation        |
| `visual-sidecar-validation-report.json` | `VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION`        | Validation        |
| `visual-sidecar-result.json`            | `VISUAL_SIDECAR_RESULT_SCHEMA_VERSION`                   | Visual sidecar    |
| `review-state.json`                     | `REVIEW_GATE_SCHEMA_VERSION`                             | Review            |
| `review-events.json`                    | `REVIEW_GATE_SCHEMA_VERSION`                             | Review            |
| `qc-mapping-preview.json`               | `QC_MAPPING_PREVIEW_SCHEMA_VERSION`                      | Export            |
| `testcases.json`                        | (canonical JSON of approved cases)                       | Export            |
| `testcases.csv`                         | (QC CSV column contract)                                 | Export            |
| `testcases.xlsx`                        | (hand-rolled OOXML, optional)                            | Export            |
| `testcases.alm.xml`                     | `ALM_EXPORT_SCHEMA_VERSION` + `ALM_EXPORT_XML_NAMESPACE` | Export            |
| `export-report.json`                    | `EXPORT_REPORT_SCHEMA_VERSION`                           | Export            |
| `dry-run-report.json`                   | `DRY_RUN_REPORT_SCHEMA_VERSION`                          | QC dry-run        |
| `wave1-poc-evidence-manifest.json`      | `WAVE1_POC_EVIDENCE_MANIFEST_SCHEMA_VERSION`             | POC               |
| `wave1-poc-eval-report.json`            | `WAVE1_POC_EVAL_REPORT_SCHEMA_VERSION`                   | POC               |
| `llm-capabilities.json`                 | `LLM_CAPABILITIES_SCHEMA_VERSION`                        | LLM gateway probe |

Persistence guarantees:

- Canonical JSON serialization (sorted keys, normalized escapes) is used for
  every JSON artifact except the OOXML XLSX export.
- All writes are atomic temp-file plus rename; concurrent runs use
  process-id and UUID-suffixed temp names.
- No artifact contains raw screenshot bytes. The visual sidecar result and the
  evidence manifest both stamp `rawScreenshotsIncluded: false` at the type
  level. Captures are referenced by SHA-256 identity only.
- No artifact contains API keys, bearer tokens, gateway endpoints, QC
  credentials, or local filesystem absolute paths. Filename-only references are
  used.
- The structured-test-case generator role (`gpt-oss-120b`) never receives image
  payloads. Both the visual sidecar client and the evidence manifest stamp
  `imagePayloadSentToTestGeneration: false` at the type level; the sidecar
  client also walks recorded gateway requests at runtime to enforce the
  invariant.

## 5. Review flow

The review gate is a deterministic state machine with a persistent event log.

States: `generated`, `needs_review`, `approved`, `rejected`, `edited`,
`exported`, `transferred`. Terminal states refuse further transitions. Allowed
event kinds: `generated`, `review_started`, `approved`, `rejected`, `edited`,
`exported`, `transferred`, `note`.

Inspector HTTP routes (mounted under `/workspace/test-intelligence`):

| Route                                                               | Method | Auth   | Purpose                                                 |
| ------------------------------------------------------------------- | ------ | ------ | ------------------------------------------------------- |
| `/workspace/test-intelligence/jobs`                                 | GET    | none   | List jobs that have on-disk test-intelligence artifacts |
| `/workspace/test-intelligence/jobs/<jobId>`                         | GET    | none   | Composite read of the per-job artifact bundle           |
| `/workspace/test-intelligence/review/<jobId>/state`                 | GET    | none   | Read review snapshot and event log                      |
| `/workspace/test-intelligence/review/<jobId>/<action>`              | POST   | bearer | Job-level review transition                             |
| `/workspace/test-intelligence/review/<jobId>/<action>/<testCaseId>` | POST   | bearer | Per-case review transition                              |

`<jobId>` and `<testCaseId>` are validated against `[A-Za-z0-9_.-]{1,128}` and
rejected for `.` or `..` segments. Invalid identifiers return `400`.

Read routes return pre-redacted artifacts; they are unauthenticated by design
to make audit replay simple. Write routes are bearer-protected and follow the
same fail-closed pattern as the Inspector import-session governance flow:

- `503` when the bearer token is unset (feature is configured but governance is
  not).
- `401` when the bearer token does not match.
- `409` when the requested transition is illegal (terminal state, blocked
  policy decision, spoofed `fromState`).

Reviewer identity is supplied by the client as a `reviewerHandle`; it is
redacted as needed by the secret-redaction helpers and persisted in the event
log so audit replay can reconstruct who did what.

## 6. Export-only flow

The Wave 2 export pipeline is `export_only`: it never writes to a remote QC,
ALM, or test-management system. It composes approved test cases into the
artifact set described in Section 4 plus the `qc-mapping-preview.json` and the
`export-report.json`.

The pipeline refuses with a deterministic refusal code when any of the
following preconditions hold:

- `no_approved_test_cases`
- `unapproved_test_cases_present`
- `policy_blocked_cases_present`
- `schema_invalid_cases_present`
- `visual_sidecar_blocked`
- `review_state_inconsistent`

These codes appear on the `export-report.json` envelope under
`refusalCodes: ExportRefusalCode[]`. The full list is exported as the
`ALLOWED_EXPORT_REFUSAL_CODES` runtime constant. Operators decide which refusal
codes block downstream automation.

The OpenText ALM reference profile id `opentext-alm-default` (version `1.0.0`)
is shipped as the default export profile. Operators may install additional
profiles by version stamp without modifying the package.

## 7. Dry-run flow

A provider-neutral `QcAdapter` interface is exposed. The Wave 2 release ships
exactly one adapter implementation:

- `openTextAlmDryRunAdapter` — provider `"opentext_alm"`, mode `"dry_run"`.

The adapter accepts an injected clock, ID source, and folder resolver so the
emitted `dry-run-report.json` is bit-identical across runs and never performs
I/O against the real QC API.

The dry-run pipeline:

1. Validates the supplied `QcMappingProfile` with `validateQcMappingProfile`.
   Credential-shaped fields, missing required fields, and malformed
   `/Subject/...` folder paths are rejected.
2. Resolves the target folder path through the injected resolver. The
   resolution outcome is one of `resolved`, `missing`, `simulated`, or
   `invalid_path`.
3. Renders a `DryRunPlannedEntityPayload` preview of what would be sent to the
   provider, with credential and screenshot fields redacted at the type level
   (`credentialsIncluded: false`, `rawScreenshotsIncluded: false`).
4. Persists `dry-run-report.json`. The report carries refusal codes from
   `ALLOWED_DRY_RUN_REFUSAL_CODES`.

Provider discriminators reserved on the contract for future adapters:

```text
opentext_alm, opentext_octane, opentext_valueedge, xray, testrail,
azure_devops_test_plans, qtest, custom
```

The `api_transfer` mode is a reserved identifier on `ALLOWED_QC_ADAPTER_MODES`
that throws `QcAdapterModeNotImplementedError` so callers can surface a
deterministic `mode_not_implemented` refusal until a future wave wires it.

## 8. Evidence verification

The Wave 1 POC harness emits `wave1-poc-evidence-manifest.json` next to the
artifact set. The manifest records, for every artifact:

- relative filename
- byte length
- SHA-256 digest
- artifact category (`generated_testcases`, `validation_report`,
  `policy_report`, `coverage_report`, `visual_sidecar_validation`,
  `visual_sidecar_result`, `qc_mapping_preview`, `export_report`,
  `review_state`, `review_events`, `alm_export`, `dry_run_report`, plus the
  POC fixture identity and CSV/XLSX/JSON export rows)

The manifest also stamps:

- prompt template version
- generated-test-case JSON-schema digest
- model deployment names per role
- policy profile id and version
- export profile id and version
- the type-level negative invariants `rawScreenshotsIncluded: false` and
  `imagePayloadSentToTestGeneration: false`

Operators verify a manifest with the bundled helpers:

- `verifyWave1PocEvidenceManifest(manifest, recomputedArtifacts)` — re-hashes
  artifacts already in memory.
- `verifyWave1PocEvidenceFromDisk(runDirectory)` — re-reads each artifact and
  recomputes the SHA-256, returning `Wave1PocEvidenceVerificationResult` with
  pass/fail per artifact and an overall verdict.
- `computeWave1PocEvidenceManifestDigest(manifest)` — returns a single
  manifest-level digest suitable for inclusion in a downstream attestation.

These helpers fail closed: any digest mismatch, missing artifact, additive
append, truncation, or filename injection is reported as a verification
failure.

## 9. Multimodal visual sidecar

The visual sidecar workflow exists only because design screenshots add evidence
that pure structural Figma data cannot provide. It is opt-in. The default
fixture-driven path uses deterministic mock captures.

Three deployments participate, in customer-safe terms:

| Role                              | Deployment name           | Image input |
| --------------------------------- | ------------------------- | ----------- |
| Structured test-case generation   | `gpt-oss-120b`            | Never       |
| Primary multimodal sidecar        | `llama-4-maverick-vision` | Required    |
| Fallback multimodal sidecar (POC) | `phi-4-multimodal-poc`    | Required    |

Hard invariants on the role-separated client bundle:

- The `test_generation` client must declare `imageInputSupport=false`. The
  visual sidecar client throws on construction if this assertion fails.
- The visual sidecar client walks the recorded request log on every call and
  fails closed if any request to the `test_generation` role carried image
  bytes.
- Captures must be in the MIME allowlist
  (`image/png`, `image/jpeg`, `image/webp`, `image/gif`). SVG is excluded
  because of the XML and injection surface.
- A single decoded capture must not exceed
  `MAX_VISUAL_SIDECAR_INPUT_BYTES` (`5 MiB`).
- Duplicate `screenId`s are rejected pre-flight.

Failure attribution classes (`ALLOWED_VISUAL_SIDECAR_FAILURE_CLASSES`):

```text
primary_unavailable, primary_quota_exceeded, both_sidecars_failed,
schema_invalid_response, image_payload_too_large, image_mime_unsupported,
duplicate_screen_id, empty_screen_capture_set
```

When both the primary and the fallback sidecar fail, the harness throws
`Wave1PocVisualSidecarFailureError` and writes no downstream artifacts. The
visual sidecar result envelope is still persisted with the failure attribution
so audit replay can see why generation refused to proceed.

## 10. Network boundary

The local runtime binds to loopback (`127.0.0.1:1983`) by default. The
test-intelligence subsurface adds the following potential outbound paths and
nothing else:

| Outbound                                                           | Trigger                                      |
| ------------------------------------------------------------------ | -------------------------------------------- |
| Operator-controlled gateway endpoint for `gpt-oss-120b`            | Live runs that bypass the deterministic mock |
| Operator-controlled gateway endpoint for `llama-4-maverick-vision` | Visual sidecar live runs                     |
| Operator-controlled gateway endpoint for `phi-4-multimodal-poc`    | Visual sidecar fallback live runs            |

Endpoints, deployment names, and API keys are read from the role-specific
environment variables documented in [docs/local-runtime.md](local-runtime.md):

- `WORKSPACE_TEST_SPACE_MODEL_ENDPOINT`
- `WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT`
- `WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT`
- `WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT`
- `WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT`
- `WORKSPACE_TEST_SPACE_API_KEY`

The bundled CI gate (`pnpm run test:ti-eval`) uses the deterministic mock and
the fixture captures. It performs no outbound network calls. The optional live
smoke (`pnpm run test:ti-live-smoke`) is gated by
`WORKSPACE_TEST_SPACE_LIVE_SMOKE=1` plus the role-specific endpoint, deployment,
and API key environment variables. It is intended for operator-controlled
integration verification, never for default CI.

The package keeps its zero-telemetry posture: no test-intelligence code path
emits analytics, usage metrics, behavioral telemetry, or unsolicited diagnostic
beacons. See [ZERO_TELEMETRY.md](../ZERO_TELEMETRY.md).

## 11. Secret handling

Test-intelligence inherits the package-wide secret discipline:

- Bearer tokens, Authorization headers, API keys, Figma access tokens, and
  generic high-entropy credential strings are routed through
  `redactHighRiskSecrets` before reaching any error, log line, or persisted
  artifact.
- Bearer comparison is SHA-256-based and timing-safe.
- The export-report and the dry-run-report stamp `credentialsIncluded: false`
  at the type level.
- The visual sidecar result and the evidence manifest stamp
  `rawScreenshotsIncluded: false` at the type level.
- The `lint:secrets` gate scans the working tree for AWS, GCP, GitHub, Slack,
  Figma, OpenAI, Anthropic, Stripe, and npm token shapes plus JWTs and PEM
  keys. Add the `// pragma: allowlist secret` comment only when a literal is
  audited and intentionally checked in.

## 12. DORA, GDPR, and EU AI Act considerations

This section is descriptive. Final classification, retention windows, and
sign-off authority are operator decisions.

### DORA (Regulation (EU) 2022/2554)

The subsurface contributes to DORA Article 6 (ICT risk management) and Article 9
(change governance) through the following package-level controls:

- Deterministic, replay-friendly artifact emission with SHA-256 evidence.
- Local-only default runtime boundary; no telemetry; opt-in network surfaces.
- `eu-banking-default` policy profile shipped with the package and stamped on
  every `policy-report.json`.
- Schema-versioned contracts plus `CONTRACT_CHANGELOG.md` for traceability.

The package does not attest the operator's third-party ICT supply chain
controls. Operators map their own evidence onto the rest of the DORA control
mapping in [COMPLIANCE.md](../COMPLIANCE.md).

### GDPR (Regulation (EU) 2016/679)

The subsurface implements data-minimization and PII-redaction controls:

- The `intent-derivation` step runs `detectPii` and `redactPii` over the
  candidate test data before prompt compilation; redaction is replay-stable
  via `REDACTION_POLICY_VERSION`.
- The validation pipeline emits issue codes (`test_data_pii_detected`,
  `preconditions_pii_detected`, `expected_results_pii_detected`,
  `test_data_unredacted_value`) so any residual PII surfaces in
  `validation-report.json` and blocks the policy gate.
- The visual sidecar gate emits `visual_sidecar_possible_pii` when the
  multimodal description contains likely PII; the policy gate consumes that
  outcome.
- No raw screenshots are persisted. Only SHA-256 hashes of capture bytes are
  stored in evidence.
- Bearer tokens, API keys, and reviewer-supplied content pass through the
  package-wide secret-redaction helpers.

DPIA-ready evidence emitted per job:

- `validation-report.json`, `policy-report.json`, `coverage-report.json`,
  `review-events.json`, `wave1-poc-evidence-manifest.json`.

Retention is operator-controlled. The package writes artifacts under the
operator-supplied `artifactRoot` and never deletes them.

### EU AI Act (Regulation (EU) 2024/1689)

Classification under the EU AI Act is **context-dependent**. The package does
not assert that test-intelligence is a high-risk AI system, because that
classification depends on the deployment context, the underlying business
process, and the operator's own risk register.

The package emits the evidence an operator typically needs to perform that
classification themselves:

- Model deployment names and roles per job (`evidence-manifest.json`).
- Prompt template version and JSON-schema digest used to constrain output.
- Per-case validation, policy, coverage, and visual-sidecar outcomes.
- Review-state event log with reviewer handles and timestamps.
- Pass/fail evaluation report with thresholds (`wave1-poc-eval-report.json`).

The reviewer-driven gate enforces a human-in-the-loop step before any case
reaches the export pipeline. Customer-specific four-eyes review and high-risk
category sign-off are operator decisions; relevant follow-ups are tracked
upstream in the Wave 2 roadmap (Issues #1376, #1379).

## 13. Gateway operator responsibilities

The package treats the LLM gateway as an operator-controlled component. For the
structured-test-case generator role (`gpt-oss-120b` deployment) the operator is
responsible for:

- **Model revision pinning.** The harness records the deployment name and the
  declared model revision in the evidence manifest. The operator pins the
  revision at the gateway and rotates it through their change-management
  process.
- **Gateway release governance.** Treat the gateway like any third-party ICT
  service under DORA Article 28: change-controlled releases, signed artifacts,
  rollback path.
- **Capability probing.** The gateway client supports `probeLlmCapabilities`
  and persists `llm-capabilities.json` so reviewers can see declared versus
  observed support for structured outputs, image input, streaming, and the
  mandatory text-chat baseline. Run a probe at startup or before a release
  cuts over.
- **Structured outputs.** The harness compiles a hand-rolled JSON-Schema for
  every prompt and binds it to the gateway request. The operator selects a
  gateway/model combination that honors the schema or accepts the
  `schema_invalid` failure class with no downstream emission.
- **Zero or limited retention.** The package never persists prompt content
  beyond what the artifact set requires for evidence. The operator should
  configure the gateway with the strictest retention setting acceptable to
  their compliance regime; policy-readable failure classes
  (`schema_invalid`, `incomplete`, `refusal`, `transport`, `timeout`,
  `rate_limited`, `image_payload_rejected`) make gateway-side incidents
  attributable.
- **Audit metadata.** The gateway client carries auth-mode and compatibility-
  mode discriminants on the public contract
  (`ALLOWED_LLM_GATEWAY_AUTH_MODES`, `ALLOWED_LLM_GATEWAY_COMPATIBILITY_MODES`)
  so operators record which auth and protocol shape was used per request.

The visual sidecar deployments (`llama-4-maverick-vision`,
`phi-4-multimodal-poc`) are subject to the same operator responsibilities; the
package additionally enforces the role-separation invariants described in
Section 9.

## 14. Public API references

- [CONTRACT_CHANGELOG.md](../CONTRACT_CHANGELOG.md) — authoritative public
  contract surface, including every test-intelligence schema-version constant,
  artifact filename constant, and exported type. Versions `3.21.0` through
  `3.28.0` cover the test-intelligence subsurface end-to-end.
- [docs/api/contracts/README.md](api/contracts/README.md) — auto-generated
  contract API reference, regenerated from `src/contracts/index.ts` via
  `pnpm run docs:api`. The freshness gate is `pnpm run docs:api:check`.
- [VERSIONING.md](../VERSIONING.md) — package-versus-contract versioning
  policy.
- [docs/migration-guide.md](migration-guide.md) — contract migration checklist.

Issue #1370 does not introduce new public surface. The subsurface is fully
described by the existing contract entries above.

## See also

- [README.md](../README.md) — package overview and primary public API.
- [COMPLIANCE.md](../COMPLIANCE.md) — DORA control mapping and release
  evidence.
- [SECURITY.md](../SECURITY.md) — vulnerability reporting and security
  controls.
- [THREAT_MODEL.md](../THREAT_MODEL.md) — package-scoped threat model and
  trust boundaries.
- [ZERO_TELEMETRY.md](../ZERO_TELEMETRY.md) — zero-telemetry policy.
- [docs/local-runtime.md](local-runtime.md) — opt-in environment variables and
  visual sidecar smoke test.
- [docs/enterprise-quickstart.md](enterprise-quickstart.md) — air-gap
  install, signature verification, smoke run.
- [docs/figma-import.md](figma-import.md) — Figma import paths used to feed
  the test-intelligence subsurface.
