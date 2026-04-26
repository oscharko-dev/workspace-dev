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

- How to enable the subsurface and run the repository Wave 1 proof-of-concept
  (POC) against synthetic fixtures from a source checkout.
- Job type and mode namespace for test-intelligence submissions.
- Artifact tree, schema versions, and persistence guarantees.
- Reviewer-driven review-gate state machine and bearer-protected write routes.
- Export-only QC artifact emission.
- OpenText ALM dry-run adapter (Wave 2).
- Controlled OpenText ALM API transfer kernel (Wave 3), gated by export,
  dry-run, review, policy, admin, bearer-token, and visual-sidecar checks.
- Evidence manifest and operator-side verification.
- Multimodal visual sidecar role separation.
- Network boundary, secret handling, and zero-telemetry behavior.
- DORA, GDPR, and EU AI Act considerations relevant to regulated operators.
- Gateway operator responsibilities for the structured-test-case generator role
  (`gpt-oss-120b`).

Out of scope:

- Provider write adapters other than OpenText ALM, and client-supplied transfer
  state. The Wave 3 `api_transfer` kernel accepts only server-reviewed
  artifacts and an injected OpenText client; callers must still keep the admin
  gate disabled unless their controlled environment has approved credentials,
  dry-run evidence, and rollback procedures.
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
        // blank, write routes return 503 fail-closed. This legacy token maps
        // to one principal; configure reviewPrincipals for two-person review.
        reviewBearerToken: process.env.WORKSPACE_TI_REVIEW_BEARER_TOKEN,
        reviewPrincipals: [
            {
                principalId: "reviewer-a",
                bearerToken: process.env.WORKSPACE_TI_REVIEWER_A_TOKEN ?? "",
            },
            {
                principalId: "reviewer-b",
                bearerToken: process.env.WORKSPACE_TI_REVIEWER_B_TOKEN ?? "",
            },
        ],
        fourEyesRequiredRiskCategories: [
            "financial_transaction",
            "regulated_data",
            "high",
        ],
        fourEyesVisualSidecarTriggerOutcomes: [
            "low_confidence",
            "fallback_used",
            "possible_pii",
            "prompt_injection_like_text",
            "conflicts_with_figma_metadata",
        ],
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
| No `reviewBearerToken` or valid `reviewPrincipals`   | Review-gate `POST` routes return `503`. Reads still work. |
| Bearer token present in request, does not match      | Review-gate `POST` routes return `401`.                   |
| Review action attempted from a terminal review state | Review-gate `POST` routes return `409 CONFLICT`.          |
| Approve attempted while policy decision is `blocked` | Review-gate `POST` routes return `409 CONFLICT`.          |
| Four-eyes case approved by one principal only        | Export refuses with `review_state_inconsistent`.          |

Bearer tokens are compared with a SHA-256-based timing-safe comparison and are
never logged. For review writes, the persisted actor is derived from the
matched server-configured principal, not from the request body. The legacy
`reviewBearerToken` remains supported for compatibility, but it represents a
single principal and therefore cannot satisfy both sides of a four-eyes review
by changing `actor` in the request payload. Bearer tokens, API keys,
Authorization headers, and Figma access tokens are routed through the
package-wide secret-redaction helpers
(`redactHighRiskSecrets`, `sanitizeErrorMessage`) before reaching any error,
log line, or persisted artifact.

Four-eyes defaults are fail-closed for the existing risk taxonomy:
`financial_transaction`, `regulated_data`, and `high`. Operators may pass empty
arrays for `fourEyesRequiredRiskCategories` and
`fourEyesVisualSidecarTriggerOutcomes` to disable those dimensions explicitly.
The visual-sidecar defaults also enforce review for low confidence, fallback
execution, possible PII, prompt-injection-like text, and Figma metadata
conflicts without storing raw screenshots in the review state.

## 2. Run the Wave 1 POC from a repository checkout

The Wave 1 POC harness composes the full pipeline on synthetic fixtures and
emits a verifiable evidence manifest. It uses a deterministic mock LLM by
default and never performs network calls. The POC harness and its fixtures are
repository verification surfaces for maintainers and integrators auditing the
package from source. Installed-package consumers should use the exported
`createWorkspaceServer` runtime, the `workspace-dev/contracts` surface, and the
Inspector routes described in this guide.

Two repository fixtures are provided under `src/test-intelligence/fixtures/`:

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

For an interactive source checkout walk-through, call the harness directly from
a Node.js script. These helpers are intentionally not exported from the npm
package today; the stable installed-package surface remains the root runtime
entry point plus `workspace-dev/contracts`. See the contract API reference for
`Wave1PocFixtureId`, `Wave1PocEvidenceManifest`, `Wave1PocEvalReport`, and the
supporting exported types.

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

| Filename                                | Schema / contract constant                                     | Phase             |
| --------------------------------------- | -------------------------------------------------------------- | ----------------- |
| `generated-testcases.json`              | `GENERATED_TEST_CASE_SCHEMA_VERSION`                           | Validation        |
| `validation-report.json`                | `TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION`                   | Validation        |
| `policy-report.json`                    | `TEST_CASE_POLICY_REPORT_SCHEMA_VERSION`                       | Validation        |
| `coverage-report.json`                  | `TEST_CASE_COVERAGE_REPORT_SCHEMA_VERSION`                     | Validation        |
| `visual-sidecar-validation-report.json` | `VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION`              | Validation        |
| `visual-sidecar-result.json`            | `VISUAL_SIDECAR_RESULT_SCHEMA_VERSION`                         | Visual sidecar    |
| `review-state.json`                     | `REVIEW_GATE_SCHEMA_VERSION`                                   | Review            |
| `review-events.json`                    | `REVIEW_GATE_SCHEMA_VERSION`                                   | Review            |
| `qc-mapping-preview.json`               | `QC_MAPPING_PREVIEW_SCHEMA_VERSION`                            | Export            |
| `testcases.json`                        | (canonical JSON of approved cases)                             | Export            |
| `testcases.csv`                         | (QC CSV column contract)                                       | Export            |
| `testcases.xlsx`                        | (hand-rolled OOXML, optional)                                  | Export            |
| `testcases.alm.xml`                     | `ALM_EXPORT_SCHEMA_VERSION` + `ALM_EXPORT_XML_NAMESPACE`       | Export            |
| `export-report.json`                    | `EXPORT_REPORT_SCHEMA_VERSION`                                 | Export            |
| `dry-run-report.json`                   | `DRY_RUN_REPORT_SCHEMA_VERSION`                                | QC dry-run        |
| `wave1-poc-evidence-manifest.json`      | `WAVE1_POC_EVIDENCE_MANIFEST_SCHEMA_VERSION`                   | POC               |
| `wave1-poc-evidence-manifest.sha256`    | `WAVE1_POC_EVIDENCE_MANIFEST_DIGEST_FILENAME`                  | POC               |
| `wave1-poc-eval-report.json`            | `WAVE1_POC_EVAL_REPORT_SCHEMA_VERSION`                         | POC               |
| `llm-capabilities.json`                 | `LLM_CAPABILITIES_SCHEMA_VERSION`                              | LLM gateway probe |
| `finops/budget-report.json`             | `FINOPS_BUDGET_REPORT_SCHEMA_VERSION`                          | FinOps            |
| `lbom/ai-bom.cdx.json`                  | `LBOM_ARTIFACT_SCHEMA_VERSION` + `LBOM_CYCLONEDX_SPEC_VERSION` | LBOM              |

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

The `api_transfer` mode is implemented by
`runOpenTextAlmApiTransfer`, not by the dry-run adapter facade. Calling
`openTextAlmDryRunAdapter.dryRun({ mode: "api_transfer", ... })` still throws
`QcAdapterModeNotImplementedError`; controlled transfer callers use the Wave 3
orchestrator with an explicit `QcApiTransferClient` so no network write can
happen implicitly.

The transfer report records hash-only audit references for the QC mapping
preview, dry-run report, visual-sidecar validation report, optional generated
test-case artifact, and optional reconciled intent IR. It never embeds raw
sidecar prompts, screenshots, bearer tokens, or transfer URLs.

### Registering a custom QC/ALM adapter (Issue #1374)

Wave 3 stabilizes the provider-neutral adapter surface so a downstream
consumer can register a custom adapter without modifying the core package.
Eight provider ids are wired up by default — `opentext_alm` ships the full
matrix, six others (`opentext_octane`, `opentext_valueedge`, `xray`,
`testrail`, `azure_devops_test_plans`, `qtest`) advertise validate + dry-run
only and refuse writes through the `provider_not_implemented` refusal code,
and the reserved `custom` slot publishes every capability flag `false` until
a caller registers a concrete adapter:

```ts
import {
    createQcProviderRegistry,
    registerQcProviderAdapter,
    resolveQcProviderAdapter,
    type QcAdapter,
    type QcAdapterDryRunInput,
    type DryRunReportArtifact,
    type QcMappingProfile,
    type QcMappingProfileValidationResult,
} from "workspace-dev/test-intelligence";

const customAdapter: QcAdapter = {
    provider: "custom",
    version: "1.0.0",
    validateProfile(
        profile: QcMappingProfile,
    ): QcMappingProfileValidationResult {
        return { ok: true, errorCount: 0, warningCount: 0, issues: [] };
    },
    async dryRun(input: QcAdapterDryRunInput): Promise<DryRunReportArtifact> {
        // build a deterministic, fail-closed report shape — see qc-provider-stub.ts
        // for a reference template that satisfies the type-level invariants
        // (`rawScreenshotsIncluded: false`, `credentialsIncluded: false`).
        throw new Error("not implemented");
    },
};

const registry = createQcProviderRegistry();
const registration = registerQcProviderAdapter({
    registry,
    adapter: customAdapter,
});
if (!registration.ok) throw new Error(registration.refusalCode);
const adapter = resolveQcProviderAdapter(registration.registry, "custom");
```

Registration is fail-closed: `unknown_provider_id` (provider not in
`ALLOWED_QC_ADAPTER_PROVIDERS`), `provider_mismatch_on_adapter` (descriptor
provider does not equal adapter provider), `register_custom_not_supported`
(slot's descriptor declares `capabilities.registerCustom === false` — only
the reserved `custom` slot is registerable), and `duplicate_provider_id`
(slot already carries a non-null adapter) each surface as structured
refusal codes the caller can branch on without parsing strings. Registry
state is value-typed: `registerQcProviderAdapter` returns a fresh registry
view rather than mutating the input.

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
- `manifestIntegrity: { algorithm: "sha256", hash }`, where `hash` is the
  SHA-256 of canonical manifest JSON with the `manifestIntegrity` field omitted
- the type-level negative invariants `rawScreenshotsIncluded: false` and
  `imagePayloadSentToTestGeneration: false`

From a repository checkout, operators and maintainers verify a manifest with
the bundled helper functions:

- `verifyWave1PocEvidenceManifest(manifest, recomputedArtifacts)` — re-hashes
  artifacts already in memory and validates the manifest self-attestation when
  present.
- `verifyWave1PocEvidenceFromDisk(runDirectory)` — re-reads each artifact and
  recomputes the SHA-256, returning `Wave1PocEvidenceVerificationResult` with
  pass/fail per artifact, manifest self-attestation details, and an overall
  verdict. It also checks the sibling digest witness.
- `computeWave1PocEvidenceManifestDigest(manifest)` — returns a single
  manifest-level digest suitable for inclusion in a downstream attestation.
- `verifyWave1PocAttestationFromDisk(runDirectory, manifest, manifestDigest)` —
  verifies the sibling in-toto DSSE envelope under `evidence/attestations/` and,
  when signing mode is `sigstore`, the local Sigstore-shaped bundle under
  `evidence/signatures/`.

These helpers fail closed: any manifest self-attestation mismatch, digest
witness mismatch, missing artifact, additive append, truncation, or filename
injection is reported as a verification failure.

The default attestation mode is `unsigned`, which writes a deterministic DSSE
envelope with an empty `signatures` array and makes no network calls. Operators
who explicitly set `attestationSigningMode: "sigstore"` must supply a signer;
the built-in key-bound signer uses local ECDSA P-256 material, while the
keyless scaffold delegates Fulcio/Rekor/OIDC work to operator code. The POC
harness returns a compact audit summary with signing mode, optional signer
reference, and SHA-256 identifiers; it never records keys, bearer tokens, or
gateway credentials.

### Operator-facing HTTP route (Issue #1380)

When the test-intelligence subsurface is enabled, the workspace-dev server
exposes a read-only audit route that wraps the verifiers above so operators and
auditors can verify a completed job's evidence integrity without touching
artifacts directly on disk:

```
GET /workspace/jobs/<jobId>/evidence/verify
Authorization: Bearer <testIntelligence.reviewBearerToken>
```

Response (`200 OK`, `application/json`, `EvidenceVerifyResponse` shape):

```jsonc
{
    "schemaVersion": "1.0.0",
    "verifiedAt": "2026-04-26T10:00:00.000Z",
    "jobId": "wave1-poc-onboarding",
    "ok": true,
    "manifestSha256": "<64-char hex>",
    "manifestSchemaVersion": "1.0.0",
    "testIntelligenceContractVersion": "1.0.0",
    "modelDeployments": { "testGeneration": "gpt-oss-120b-mock" },
    "visualSidecar": {
        /* optional, only when manifest carries it */
    },
    "attestation": {
        /* optional, only when on-disk envelope is present */
    },
    "checks": [
        /* sorted by (kind, reference) */
    ],
    "failures": [
        /* sorted by (reference, code); empty when ok=true */
    ],
}
```

Status codes:

- `200` — verification completed. The body's `ok` carries the verdict;
  `failures` is empty on success and populated on any digest mismatch, missing
  artifact, additive append, truncation, manifest-metadata invariant breach,
  attestation envelope failure, or visual-sidecar evidence inconsistency.
- `404 JOB_NOT_FOUND` — no job directory exists under the configured
  `testIntelligenceArtifactRoot`. The response carries no path information.
- `409 EVIDENCE_NOT_AVAILABLE` — the job directory exists but no
  `wave1-poc-evidence-manifest.json` has been written yet.
- `401 UNAUTHORIZED` — missing or invalid Bearer token; the response includes a
  `WWW-Authenticate: Bearer realm="workspace-dev"` header.
- `503 AUTHENTICATION_UNAVAILABLE` — `testIntelligence.reviewBearerToken` is
  unset or blank; the route fails closed.
- `503 FEATURE_DISABLED` — either feature gate (env or runtime option) is off.
- `405 METHOD_NOT_ALLOWED` — any method other than `GET`. The response includes
  an `Allow: GET` header.
- `429 RATE_LIMIT_EXCEEDED` — per-IP read rate limit exceeded. The response
  includes a `Retry-After` header. Per-`(client, jobId)` limiter state is
  persisted under `<outputRoot>/rate-limits/evidence-verify-reads.json`.

The route is read-only: no artifacts are mutated, no attestation is re-signed,
and no manifest is patched. The response body never contains tokens, prompt
bodies, reasoning traces, raw test-case payloads, environment values, signer
secret material, or absolute paths — only safe manifest-relative filenames,
SHA-256 digests, and identity stamps appear. Each invocation is audit-logged
with the `workspace.evidence.verify.completed` event carrying jobId, status
code, and the failure / check counts.

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

## 9a. FinOps budgets and operational controls (Issue #1371)

Wave 2 enterprise hardening. Operators may bound an LLM job's input/output
tokens, wall-clock duration, retry count, image payload size, replay-cache miss
rate, and (optionally) estimated cost — per role and per job. Every run emits a
deterministic budget report under `<runDir>/finops/budget-report.json`.

### Budget envelope

`FinOpsBudgetEnvelope` carries:

| Field                                    | Scope    | Effect                                                                                           |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `maxJobWallClockMs`                      | Job-wide | Total wall-clock cap across every role.                                                          |
| `maxReplayCacheMissRate`                 | Job-wide | Maximum permitted `misses / (hits + misses)` over the run; `[0, 1]`.                             |
| `maxEstimatedCost`                       | Job-wide | Operator-supplied per-job cost cap (currency-agnostic).                                          |
| `roles.<role>.maxInputTokensPerRequest`  | Role     | Maps to `LlmGenerationRequest.maxInputTokens` (gateway fail-closed).                             |
| `roles.<role>.maxOutputTokensPerRequest` | Role     | Maps to `LlmGenerationRequest.maxOutputTokens`; gateway fails closed if unsupported or exceeded. |
| `roles.<role>.maxTotalInputTokens`       | Role     | Aggregate input-token cap across every request the role makes.                                   |
| `roles.<role>.maxTotalOutputTokens`      | Role     | Aggregate output-token cap across every request the role makes.                                  |
| `roles.<role>.maxWallClockMsPerRequest`  | Role     | Per-request wall-clock cap (gateway fail-closed: `retryable: false` on breach).                  |
| `roles.<role>.maxTotalWallClockMs`       | Role     | Aggregate wall-clock cap across every request the role makes.                                    |
| `roles.<role>.maxRetriesPerRequest`      | Role     | Per-request retry cap; effective cap = `min(config.maxRetries, request.maxRetries)`.             |
| `roles.<role>.maxAttempts`               | Role     | Total gateway attempts allowed (success + failure).                                              |
| `roles.<role>.maxImageBytesPerRequest`   | Role     | Decoded image-input bytes per request (visual roles only).                                       |
| `roles.<role>.maxFallbackAttempts`       | Role     | Maximum fallback-deployment attempts (visual_fallback only).                                     |
| `roles.<role>.maxLiveSmokeCalls`         | Role     | Maximum live-smoke (non-mock) calls.                                                             |

A built-in `EU_BANKING_DEFAULT_FINOPS_BUDGET` profile is provided alongside a
permissive `DEFAULT_FINOPS_BUDGET_ENVELOPE` baseline. Both are exported through
`src/test-intelligence/index.ts` and through the public root for callers that
embed the harness in their own pipelines.

### Fail-closed semantics

Configured budgets fail closed before downstream validation/export can proceed:

1. `LlmGenerationRequest.maxWallClockMs` — when the wall-clock budget is
   smaller than the static client `timeoutMs`, the gateway times the request
   out at the per-request budget AND marks the failure non-retryable. Retrying
   would by definition violate the same budget.
2. `LlmGenerationRequest.maxRetries` — when the per-request cap is `0`, the
   gateway attempts the call exactly once. When non-zero, the effective retry
   cap is `min(config.maxRetries, request.maxRetries)`. The request value is
   validated as a non-negative safe integer.
3. `LlmGenerationRequest.maxOutputTokens` — the gateway requires a deployment
   that supports output-token caps and verifies reported completion-token
   usage after the response. Missing usage or an overrun is non-retryable.
4. Visual `maxImageBytesPerRequest` — the sidecar preflight rejects oversized
   decoded image payloads before primary or fallback gateway calls run.

Aggregate role/job caps (`maxAttempts`, total token caps, total wall-clock,
replay-cache miss rate, live-smoke calls, and estimated cost) are evaluated
immediately after each recorded LLM/sidecar attempt. On breach,
`runWave1Poc` writes the current FinOps report with structured breach records,
throws `Wave1PocFinOpsBudgetExceededError`, and does not continue into
validation or export.

### Cache hits and the budget report

A cache hit signals "no LLM call, no token usage" verbatim:

- `recordCacheHit({ role })` increments only `cacheHits`. Every other counter
  stays at 0 — including `attempts`, `inputTokens`, `outputTokens`,
  `durationMs`, and `imageBytes`.
- When `runWave1Poc` receives a `replayCache`, it wraps test generation with
  the existing replay-cache helper. Hits skip the test-generation gateway call,
  mark generated-case audit metadata as `cacheHit: true`, and produce a
  `completed_cache_hit` FinOps report.
- When the only recorded events are cache hits, `outcome` is
  `completed_cache_hit`. Otherwise the outcome is `completed`,
  `budget_exceeded`, `policy_blocked`, `validation_blocked`,
  `visual_sidecar_failed`, `export_refused`, or `gateway_failed` depending on
  the run's terminal state.

### Per-role usage snapshot

Each `FinOpsRoleUsage` row carries `attempts`, `successes`, `failures`,
`inputTokens`, `outputTokens`, `imageBytes`, `cacheHits`, `cacheMisses`,
`fallbackAttempts`, `liveSmokeCalls`, `durationMs`, `lastFinishReason`,
`lastErrorClass`, `estimatedCost`, plus the observed `deployment` label. The
`roles` array is sorted alphabetically so the persisted artifact is byte-stable
for identical input.

### Hard invariants on the artifact

`FinOpsBudgetReport` stamps three `false` literals at the type level:

- `secretsIncluded: false`
- `rawPromptsIncluded: false`
- `rawScreenshotsIncluded: false`

The recorder never sees prompt text, response content, or raw image bytes — it
ingests `LlmGenerationResult.usage`, `VisualSidecarAttempt.durationMs`, decoded
image byte counts, role labels, and counter increments. Persisted report labels
(`budgetId`, `budgetVersion`, `currencyLabel`, deployment labels, and breach
messages) are bounded and passed through the shared high-risk-secret redactor
before serialization.

### Wiring it into a run

`runWave1Poc` accepts optional `finopsBudget` and `finopsCostRates` inputs:

```ts
import {
    cloneEuBankingDefaultFinOpsBudget,
    runWave1Poc,
} from "@oscharko-dev/workspace-dev/test-intelligence";

const result = await runWave1Poc({
    fixtureId: "poc-onboarding",
    jobId: "job-42",
    generatedAt: "2026-04-25T10:00:00.000Z",
    runDir: "/tmp/job-42",
    finopsBudget: cloneEuBankingDefaultFinOpsBudget(),
    finopsCostRates: {
        currencyLabel: "USD",
        rates: {
            test_generation: {
                inputTokenCostPer1k: 0.5,
                outputTokenCostPer1k: 1.5,
            },
            visual_primary: { fixedCostPerAttempt: 0.0008 },
            visual_fallback: { fixedCostPerAttempt: 0.0004 },
        },
    },
});
console.log(result.finopsReport.outcome); // "completed" | "budget_exceeded" | …
console.log(result.finopsArtifactPath); // "/tmp/job-42/finops/budget-report.json"
```

The artifact is attested by the Wave 1 evidence manifest and the sibling
in-toto DSSE attestation: the manifest accepts safe relative artifact paths and
includes `finops/budget-report.json` with category `finops`, while rejecting
absolute paths, `..`, empty path segments, backslashes, and control characters.

## 9b. Per-job LBOM (Issue #1378)

Every completed Wave 1 POC run emits a per-job LLM Bill of Materials in
CycloneDX 1.6 ML-BOM format under `<runDir>/lbom/ai-bom.cdx.json`. The
artifact inventories the model chain (`gpt-oss-120b` test generator,
`llama-4-maverick-vision` visual primary, `phi-4-multimodal-poc` visual
fallback), the curated few-shot prompt bundle, and the active policy
profile. The repository ships a reference template at
[`docs/figma-to-test/lbom-template.cdx.json`](./figma-to-test/lbom-template.cdx.json)
that documents the exact field shape an operator should expect to find
under each run directory.

Composition:

- One `machine-learning-model` component per role (`test_generation`,
  `visual_primary`, `visual_fallback`). The `name` is the canonical model
  id; the active deployment label, gateway release, and image-input
  capability are stamped as `workspace-dev:*` properties so the LBOM
  remains stable across mock and live runs. When a gateway bundle supplies
  model revision, compatibility format, or optional weights SHA-256 for a
  visual sidecar, those known values are carried into the corresponding
  model component; provider and license are marked `unknown` unless a
  concrete operator-supplied value is available.
- One `data` component for the curated few-shot bundle, hashed via the
  prompt-compiler `promptHash` plus the bound generated-test-case
  `schemaHash`.
- One `data` component for the active policy profile, hashed via the
  canonical SHA-256 of the profile object.
- A `dependencies` graph rooting the run subject (`job:<jobId>`) at the
  three model components and the two data bundles.

Hard invariants stamped on the document as CycloneDX metadata
properties: `workspace-dev:secretsIncluded`,
`workspace-dev:rawPromptsIncluded`, and
`workspace-dev:rawScreenshotsIncluded`, each with value `"false"`. The
LBOM never carries API keys, bearer tokens, signer material, prompt
text, response text, or decoded image bytes. Capture identity is
recorded only as SHA-256 inside the visual sidecar result, not in the
LBOM.

Schema validation:

- The hand-rolled `validateLbomDocument` runs structural and
  domain-aware checks anchored on the CycloneDX 1.6 spec — bomFormat /
  specVersion / version / serialNumber pinning, RFC-4122 UUID format,
  ISO-8601 timestamp format, single-algorithm hash entries (`SHA-256`),
  unique `bom-ref` set, dependency-graph closure, and a property-value
  scan that refuses values matching the `redactHighRiskSecrets`
  high-risk patterns. The validator runs before the artifact is
  persisted; any failure aborts the harness fail-closed.
- The CycloneDX 1.6 + JSF + SPDX schema family is pinned under
  `scripts/schemas/cyclonedx-1.6/` and exercised by
  `src/test-intelligence/lbom-cyclonedx-schema.test.ts` for both emitted
  artifacts and the checked-in template.

Manifest + attestation coverage:

- The Wave 1 evidence manifest attests `lbom/ai-bom.cdx.json` with
  SHA-256 + byte length under category `lbom`.
- The sibling in-toto DSSE attestation transitively covers the LBOM
  because it covers the manifest digest.

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
reaches the export pipeline. For cases covered by the resolved four-eyes
policy, the server requires two distinct authenticated review principals and
persists primary/secondary reviewer identities plus timestamps. Export refuses
`pending_secondary_approval` cases and forged `approved` snapshots that do not
contain a complete two-reviewer audit trail. Broader sign-off authority and
named-role matrices remain operator decisions; related policy expansion is
tracked separately in the Wave 2 roadmap (Issue #1379).

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
