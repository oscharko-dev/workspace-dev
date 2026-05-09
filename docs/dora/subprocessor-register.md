# Subprocessor Register — workspace-dev

**Scope:** ICT third-party / subprocessor register for `workspace-dev` test-
intelligence deployments. Closes the audit finding "subprocessor register
absent for LLM providers; cross-border transfer story undocumented" against
DORA Art. 28 + GDPR Ch. V.

**Register version:** `1.0.0` — mirrors the runtime constant
`SUBPROCESSOR_REGISTER_VERSION` exported from `src/contracts/index.ts` and
stamped into every Wave 1 Validation evidence manifest as
`subprocessorRegisterVersion`. The CODEOWNERS rule
`docs/dora/subprocessor-register.md` + `docs/dpia/cross-border-transfer.md`
keeps the human-review gate coupled with the paired ADR.

**Last reviewed:** 2026-05-10 (Issue #2113).

**Audience:** financial entities and other regulated operators preparing their
own DORA register-of-information and GDPR Ch. V transfer assessment. The
operator remains the controller; this document enumerates the dependencies
the package itself depends on or invokes, plus the dependencies it allows the
operator to introduce through the configurable hook surface.

---

## 1. Operator-versus-package boundary

`workspace-dev` is an operator-deployed package. The operator selects, hosts,
and contracts every external service the test-intelligence pipeline relies on
at runtime. The package does not call any default cloud endpoint — every
outbound call is gated by:

- a feature flag (`FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE` and, where
  applicable, `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE`),
- an operator-supplied configuration (gateway URL, deployment names, host
  allow-list), and
- the deterministic `llmCodegenMode` mode-lock invariant.

The register below names every dependency category and the responsible
contractual party. Operators must transcribe the relevant rows into their own
DORA Art. 28(3) register-of-information with their concrete vendor identity,
agreement reference, and criticality classification.

---

## 2. ICT third-party register entries

Every entry includes contractual-SLA, breach-notification SLO, data-
classification scope, and retention policy fields per DORA Art. 28(3). Where
the value is operator-defined, the package documents the contractual _floor_
the operator must meet, not the value itself.

### 2.1 LLM gateway (structured-test-case generator)

| Field                       | Value                                                                                                                                                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider                    | Operator-selected LLM gateway (Azure OpenAI / Azure ML inference / equivalent). Concrete tenant and deployment id is recorded per run in `evidence-manifest.modelDeployments.testGeneration` and `activeModelBindings[].ictRegisterRef`.                                                              |
| Function                    | Structured test-case generation against a hand-rolled JSON-Schema; consumes Business Test Intent IR + Visual Sidecar IR and emits `GeneratedTestCase[]`. Never receives image payloads (`imagePayloadSentToTestGeneration: false` is a hard manifest invariant).                                      |
| Sub-region / data residency | Operator-selected. Recommended: EEA Azure region for EU-based operators (`westeurope`, `northeurope`, `francecentral`, `germanywestcentral`, `swedencentral`). Recorded in the operator's tenant configuration; no cross-border transfer happens unless the operator configures a non-EEA deployment. |
| Retention policy            | Operator must configure the strictest acceptable retention. The package's own retention is zero — no prompt, completion, or response body is persisted outside the per-run evidence directory, and persisted artifacts are PII-redacted IR (no raw prompts, no raw responses).                        |
| Contractual SLA floor       | 99.9% monthly availability, p95 latency ≤ 5 s for completion calls, support response ≤ 1 business day for severity-2 incidents. Concrete SLA is the operator's contract.                                                                                                                              |
| Breach-notification SLO     | ≤ 24 h for confirmed personal-data breaches (GDPR Art. 33 default for processors). Operator must verify their gateway contract meets this floor; the package emits no telemetry to vendor channels.                                                                                                   |
| Data-classification scope   | Up to "personal data — pseudonymised" (Business Test Intent IR is PII-redacted before prompt compilation). Operator must not configure a higher-classification gateway profile without a paired DPIA addendum.                                                                                        |
| Sub-processors              | Inherited from the operator's gateway provider (typically Microsoft Azure infrastructure for Azure OpenAI). Operator records these in their own register per DORA Art. 28(3)(c).                                                                                                                      |
| Exit plan                   | Switch to a different deployment id and re-run the validation harness; the cache key is keyed on `modelDeployments.testGeneration` so cached artifacts do not silently apply across deployments.                                                                                                      |
| Replay evidence             | `<runDir>/wave1-validation-evidence-manifest.json` → `modelDeployments.testGeneration`, `activeModelBindings[].providerId/modelId/inferenceProfileId/ictRegisterRef`, `subprocessorRegisterVersion`.                                                                                                  |

### 2.2 Visual sidecar (multimodal vision deployment)

| Field                       | Value                                                                                                                                                                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider                    | Operator-selected multimodal deployment. Recommended deployment names: `llama-4-maverick-vision` (primary), `phi-4-multimodal-poc` (fallback). Concrete deployment id is recorded in `evidence-manifest.modelDeployments.visualPrimary` / `visualFallback`.                                  |
| Function                    | Computes the Visual Sidecar IR from per-screen captures. Never sees raw test-intent text; the role-separation invariant keeps the structured-test-case generator deployment image-free.                                                                                                      |
| Sub-region / data residency | Operator-selected. Same EEA-residency recommendation as §2.1; visual captures may be more sensitive than redacted IR text and SHOULD be co-located with the operator's primary processing region.                                                                                            |
| Retention policy            | The package never persists raw screenshot bytes (`rawScreenshotsIncluded: false` is a hard manifest invariant). Captures are kept in the gateway only for the duration of the inference call. Operator must configure the gateway with retention floor of 0 days for prompt/response bodies. |
| Contractual SLA floor       | 99.5% monthly availability (lower than §2.1 because the circuit-breaker + fallback path tolerates degradations). The persisted visual-sidecar primary circuit breaker (Issue #2069) opens after two consecutive protocol-class primary failures.                                             |
| Breach-notification SLO     | ≤ 24 h for confirmed personal-data breaches (GDPR Art. 33 default). Stricter contracts recommended where captures may show real-end-user personal data.                                                                                                                                      |
| Data-classification scope   | Up to "personal data — pseudonymised". Captures of production screens may incidentally show personal data; the visual policy gate (`semantic_suspicious_content`, `visual_sidecar_possible_pii`) blocks downstream emission when this is detected.                                           |
| Sub-processors              | Inherited from the operator's gateway provider. Vision deployments may carry distinct sub-processor lineage from the text deployment in §2.1; the operator's register must capture both.                                                                                                     |
| Exit plan                   | Set `modelDeployments.visualPrimary = "none"` to disable visual augmentation entirely; the test-intelligence pipeline degrades to text-only with deterministic refusals on visual-required cases rather than failing closed at job level.                                                    |
| Replay evidence             | `<runDir>/wave1-validation-evidence-manifest.json` → `modelDeployments.visualPrimary`, `modelDeployments.visualFallback`, `visualSidecar.selectedDeployment`, `visualSidecarCaptureIdentities[]`.                                                                                            |

### 2.3 Document AI (Mistral-document-AI deployment)

| Field                       | Value                                                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Provider                    | Operator-selected Mistral-document-AI deployment (e.g. `mistral-document-ai-2512`). Optional opt-in path used by the document-ingestion add-on; not invoked by the default Wave 1 Validation harness.                                                              |
| Function                    | OCR + structured extraction over operator-supplied PDF / image attachments referenced in custom-context sources. Output is normalised into the same redacted IR pathway as Jira and custom text.                                                                   |
| Sub-region / data residency | Operator-selected. Mistral's published EU regions (`eu-west-1` family) are recommended for EEA operators. Concrete deployment region is the operator's contractual decision.                                                                                       |
| Retention policy            | Document AI invocations are stateless from the package's perspective. The package never persists the raw PDF / image bytes; only the redacted extracted IR is written to the run directory. Operator must configure the deployment with retention floor of 0 days. |
| Contractual SLA floor       | 99.5% monthly availability, p95 ≤ 8 s for documents under 5 MB. Operator records concrete SLA per their commercial agreement.                                                                                                                                      |
| Breach-notification SLO     | ≤ 24 h for confirmed personal-data breaches (GDPR Art. 33 default).                                                                                                                                                                                                |
| Data-classification scope   | Up to "personal data — pseudonymised". PDFs / images carrying special-category data (Art. 9) MUST NOT be sent through this path; the operator is responsible for the upstream input gate.                                                                          |
| Sub-processors              | Inherited from Mistral's published sub-processor list. Operator records these in their own DORA Art. 28(3)(c) entry.                                                                                                                                               |
| Exit plan                   | Disable the document-ingestion add-on; the test-intelligence pipeline operates without document attachments. No artifact format changes required.                                                                                                                  |
| Replay evidence             | `<runDir>/sources/<sourceId>/document-ai-extraction-ir.json` (when the document-ingestion add-on is enabled). Provider identity is recorded in `activeModelBindings[]` with `ictRegisterRef`.                                                                      |

### 2.4 Jira ingestion gateway (`jira_rest`)

Documented in detail in `docs/dora/multi-source.md` §5.1–5.3 (ICT third-party
mapping for the Jira REST source). The summary record is reproduced here for
single-pane register consumption:

| Field                       | Value                                                                                                                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider                    | Operator-selected Atlassian Cloud tenant (`*.atlassian.net`) or self-hosted Jira Data Center. Concrete host is captured under `multi-source-envelope.json` per run.                                               |
| Function                    | Issue read access (Jira REST API v3) for multi-source test-intent ingestion. Paste-only fallback (`jira_paste`) is available when the REST path is unavailable or air-gapped.                                     |
| Sub-region / data residency | Operator-controlled (Atlassian Cloud residency setting or self-hosted topology).                                                                                                                                  |
| Retention policy            | The package persists only the redacted Jira IR; raw API responses are not written (`rawJiraResponsePersisted: false` and `rawPasteBytesPersisted: false` are hard manifest invariants on multi-source manifests). |
| Contractual SLA floor       | 99.9% monthly availability (Atlassian Cloud Enterprise default).                                                                                                                                                  |
| Breach-notification SLO     | ≤ 24 h (GDPR Art. 33 default).                                                                                                                                                                                    |
| Data-classification scope   | Pseudonymised issue content, post-redaction. Raw Jira fields with PII are redacted in `jira-issue-ir.ts` before persistence.                                                                                      |
| Sub-processors              | Atlassian sub-processor list at `trust.atlassian.com`.                                                                                                                                                            |
| Exit plan                   | Switch to `jira_paste` paste-only mode; no API dependency.                                                                                                                                                        |
| Replay evidence             | `<runDir>/sources/<sourceId>/jira-issue-ir.json` and `jira-issue-ir-list.json`.                                                                                                                                   |

### 2.5 Operator-defined hook HTTP egress (`harness-hooks.ts` allow-list)

The harness hook surface accepts an operator-supplied
`HookRuntimePolicy.allowedHttpHosts` list. Every host an operator adds is, by
construction, an additional ICT third-party that MUST be reflected in the
operator's own register-of-information. The package itself ships with no
default allow-listed hosts.

| Field                       | Value                                                                                                                                                                                                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider                    | One register entry per host pattern in `HookRuntimePolicy.allowedHttpHosts` (or per `*.example.com` wildcard scope). Concrete hosts are not embedded in the package; only the validation policy lives in `src/test-intelligence/harness-hooks.ts`.                                                             |
| Function                    | Operator-defined. Typical categories the policy permits: incident-management webhooks (PagerDuty / Opsgenie style), reviewer notifications (chat ingest endpoints), audit-log shipping (SIEM ingest endpoints). The policy refuses any host that matches the telemetry-URL pattern (`TELEMETRY_URL_RE`).       |
| Sub-region / data residency | Operator-defined. Operators MUST verify that egress hosts are not implicit cross-border transfers — a `*.io` or `*.com` host is region-ambiguous and SHOULD be replaced with a region-pinned alias before being added.                                                                                         |
| Retention policy            | The package guarantees that the _body_ never contains raw screenshots (`rawScreenshotsIncluded: false`), raw Jira responses, or raw paste bytes. Hook bodies use `bodyTemplate` with environment-variable placeholders gated by `allowedEnvVars`; secret values never appear in body bodies the package emits. |
| Contractual SLA floor       | Operator-defined. The hook executor times out per `HookCommandShell.timeoutMs` (or the operator's HTTP executor default) and refuses-on-timeout rather than retrying.                                                                                                                                          |
| Breach-notification SLO     | Operator-defined.                                                                                                                                                                                                                                                                                              |
| Data-classification scope   | Operator-defined. Operators SHOULD restrict hook payloads to non-personal events (job ids, refusal codes, evidence hashes) and refuse to ship personal data through the hook surface.                                                                                                                          |
| Sub-processors              | Operator-defined.                                                                                                                                                                                                                                                                                              |
| Exit plan                   | Remove the host from `HookRuntimePolicy.allowedHttpHosts`. The hook validator returns `hook_http_domain_not_allowlisted` and refuses the call deterministically.                                                                                                                                               |
| Replay evidence             | `<runDir>/hook-execution-trace.json` (where present). The host pattern is captured in the hook matcher digest.                                                                                                                                                                                                 |

### 2.6 Object-storage backends (operator-deployed)

`workspace-dev` does not call any object-storage API directly. When the
operator points the run-directory output at S3 / Azure Blob / GCS through the
operator's filesystem layer, the storage backend becomes a register entry
under the operator's own DORA mapping. The package's only invariant is that
artifact-write paths use atomic rename, so a partial write is never observed.

---

## 3. Operator obligations

For every entry above, the operator MUST:

1. Maintain a written contractual arrangement with the provider (DORA Art. 28).
2. Verify the data-residency configuration of the provider matches the
   `cross-border-transfer.md` ADR for the provider's tenant region pair.
3. Rotate API tokens, OAuth credentials, and service-principal secrets on the
   operator's defined cadence (see `docs/runbooks/jira-source-setup.md` for
   the Jira-source rotation pattern).
4. Add the provider to the operator's own register of information at the
   classification level chosen above.
5. Update this register and the paired
   `docs/dpia/cross-border-transfer.md` ADR in the same change set whenever
   adding or removing a provider, and bump
   `SUBPROCESSOR_REGISTER_VERSION` accordingly. The CODEOWNERS rule for the
   two paths makes the human-review gate coupled.

---

## 4. Replay verifiability

Every Wave 1 Validation evidence manifest carries
`subprocessorRegisterVersion: "1.0.0"`. A future replay can verify which
register and ADR were active for the run by:

1. Reading `wave1-validation-evidence-manifest.json` →
   `subprocessorRegisterVersion`.
2. Looking up the matching tag of `docs/dora/subprocessor-register.md` and
   `docs/dpia/cross-border-transfer.md` in the repository at that version.

The constant is a `typeof` literal on the manifest interface; an attempt to
forge a different version causes both the type-checker and the
`validateWave1ValidationEvidenceManifestMetadata` runtime gate to refuse the
manifest.

---

## 5. CI / governance gates

- **CODEOWNERS coupling.** `docs/dora/subprocessor-register.md` and
  `docs/dpia/cross-border-transfer.md` are listed under the same CODEOWNERS
  rule so any change touches the same reviewer set. A PR that mutates the
  register without touching the ADR (or vice versa) is reviewed by the same
  governance owner; reviewers MUST refuse a register change that is not paired
  with the corresponding ADR update.
- **Contract-export gate.** `SUBPROCESSOR_REGISTER_VERSION` is asserted in
  `src/contract-version.test.ts` as part of the contract runtime export
  snapshot. Removing or renaming the constant fails the contract gate.
- **Manifest gate.** `validateWave1ValidationEvidenceManifestMetadata`
  rejects manifests whose `subprocessorRegisterVersion` does not equal the
  current constant. A replay against an old register version fails closed.

---

## 6. See also

- `docs/dpia/cross-border-transfer.md` — ADR for the cross-border transfer
  story per Azure deployment region pair (paired document; see CODEOWNERS).
- `docs/dora/multi-source.md` — DORA mapping for the multi-source test-
  intelligence surface (Wave 4 extension).
- `docs/dpia/jira-source.md` — DPIA addendum for the Jira source.
- `docs/dpia/custom-context-source.md` — DPIA addendum for the custom-context
  source.
- `COMPLIANCE.md` — top-level DORA / GDPR / EU AI Act control mapping.
- `THREAT_MODEL.md` — package-scoped threat model.
- `src/contracts/index.ts` — `SUBPROCESSOR_REGISTER_VERSION` constant +
  `Wave1ValidationEvidenceManifest.subprocessorRegisterVersion` field.
- `src/test-intelligence/harness-hooks.ts` — hook HTTP allow-list policy
  enforcement.
