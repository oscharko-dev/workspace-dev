# Subprocessor Register — workspace-dev

<!--
  AUTO-GENERATED FROM `src/test-intelligence/subprocessor-register.ts`.
  DO NOT EDIT BY HAND. Regenerate with:
      pnpm run docs:render-subprocessor-register
  CI fails on any drift between this file and the canonical TS source.
  Issue #2174 — DORA Art. 28 machine-verifiable subprocessor register.
-->

**Register schema version:** `1.0.0` (`SUBPROCESSOR_REGISTER_SCHEMA_VERSION`).

**Register content version:** `1.0.0` (`SUBPROCESSOR_REGISTER_VERSION`).

**Merkle root (SHA-256 over sorted entries):** `89d2d1d63d1a3e7b086d3d2d4ae00cb0f7c73b4c74ab4e3749da872fe9734d28`.

**Last reviewed:** 2026-05-10 (Issue #2174).

**Scope.** ICT third-party / subprocessor register for `workspace-dev`
test-intelligence deployments. Closes the M0 audit finding LOW-1 against
Issue #2113 by replacing the Markdown-only register with a typed,
machine-verifiable JSON artifact (`subprocessor-register.json`) shipped
per run alongside `compliance-annotations.json` and
`compliance-coverage-report.json` (DORA Art. 28 + GDPR Ch. V).

**Audience.** Financial entities and other regulated operators preparing
their own DORA register-of-information and GDPR Ch. V transfer
assessment. The operator remains the controller; this document
enumerates the dependencies the package itself depends on or invokes,
plus the dependencies it allows the operator to introduce through the
configurable hook surface.

---

## 1. Operator-versus-package boundary

`workspace-dev` is an operator-deployed package. The operator selects,
hosts, and contracts every external service the test-intelligence
pipeline relies on at runtime. The package does not call any default
cloud endpoint — every outbound call is gated by:

- a feature flag (`FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE` and, where
  applicable, `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE`),
- an operator-supplied configuration (gateway URL, deployment names,
  host allow-list), and
- the deterministic `llmCodegenMode` mode-lock invariant.

Operators must transcribe the relevant rows into their own DORA Art.
28(3) register-of-information with their concrete vendor identity,
agreement reference, and criticality classification.

---

## 2. Subprocessor entries

Every entry below corresponds to one record in the typed
`SubprocessorRegister.subprocessors` array. The `subprocessorId`
column is the stable cross-reference key cited from
`compliance-annotations.json`.

### document-ai-mistral

**Legal name.** Operator-selected Mistral-document-AI deployment (e.g. mistral-document-ai-2512)

**Purpose.** OCR + structured extraction over operator-supplied PDF / image attachments referenced in custom-context sources.

**Hosting region.** `eu-west-1`

**Data categories.** `personal-data-pseudonymised`

**Contractual safeguards.** `DPA-operator`, `SCC-2021-Module-2`

**Retention policy.** Stateless from the package's perspective. Operator must configure the deployment with retention floor of 0 days for prompt/response bodies.

**Added at.** `2026-05-10T00:00:00Z`

### jira-ingestion-rest

**Legal name.** Operator-selected Atlassian Cloud tenant (*.atlassian.net) or self-hosted Jira Data Center

**Purpose.** Issue read access (Jira REST API v3) for multi-source test-intent ingestion. Paste-only fallback (jira_paste) is available when the REST path is unavailable or air-gapped.

**Hosting region.** `operator-defined`

**Data categories.** `personal-data-pseudonymised`

**Contractual safeguards.** `Atlassian-DPA`, `SCC-2021-Module-2`

**Retention policy.** Package persists only redacted Jira IR; raw API responses are not written. Operator-controlled retention on the upstream tenant.

**Added at.** `2026-05-10T00:00:00Z`

### llm-gateway-text-generation

**Legal name.** Operator-selected LLM gateway (Azure OpenAI / Azure ML inference / equivalent)

**Purpose.** Structured test-case generation against a hand-rolled JSON-Schema; consumes Business Test Intent IR + Visual Sidecar IR and emits GeneratedTestCase[]. Never receives image payloads.

**Hosting region.** `westeurope`

**Data categories.** `personal-data-pseudonymised`

**Contractual safeguards.** `DPA-operator`, `SCC-2021-Module-2`

**Retention policy.** Package retention is zero — no prompt, completion, or response body persisted outside the per-run evidence directory; persisted artifacts are PII-redacted IR.

**Added at.** `2026-05-10T00:00:00Z`

### object-storage-operator

**Legal name.** Operator-deployed object-storage backend (S3 / Azure Blob / GCS through operator filesystem layer)

**Purpose.** Operator-mounted backing store for the run-directory output. The package never calls any object-storage API directly.

**Hosting region.** `operator-defined`

**Data categories.** `evidence-artifacts`, `personal-data-pseudonymised`

**Contractual safeguards.** `DPA-operator`

**Retention policy.** Operator-controlled. Atomic-rename on artifact write ensures a partial write is never observed.

**Added at.** `2026-05-10T00:00:00Z`

### operator-hook-egress

**Legal name.** Operator-supplied HookRuntimePolicy.allowedHttpHosts entries (per host pattern)

**Purpose.** Operator-configured outbound webhooks (incident-management, reviewer notifications, audit-log shipping). The package ships with no default allow-listed hosts.

**Hosting region.** `operator-defined`

**Data categories.** `evidence-metadata-only`

**Contractual safeguards.** `DPA-operator`

**Retention policy.** Hook bodies use bodyTemplate with environment-variable placeholders; no raw screenshots, raw Jira responses, or raw paste bytes leave the host.

**Added at.** `2026-05-10T00:00:00Z`

### visual-sidecar-vision

**Legal name.** Operator-selected multimodal vision deployment (e.g. llama-4-maverick-vision primary, phi-4-multimodal-poc fallback)

**Purpose.** Computes the Visual Sidecar IR from per-screen captures. Never sees raw test-intent text; the role-separation invariant keeps the structured-test-case generator deployment image-free.

**Hosting region.** `westeurope`

**Data categories.** `personal-data-pseudonymised`

**Contractual safeguards.** `DPA-operator`, `SCC-2021-Module-2`

**Retention policy.** The package never persists raw screenshot bytes (rawScreenshotsIncluded: false). Captures live in the gateway only for the duration of the inference call.

**Added at.** `2026-05-10T00:00:00Z`

---

## 3. Cross-border transfer records

Every entry below corresponds to one record in the typed
`SubprocessorRegister.crossBorderTransfers` array. Even intra-EEA
flows are recorded for replay verifiability so an auditor can
reconstruct which transfer mechanism was active at a given run
timestamp.

### intra-eea-document-ai-northeurope

**Source region → destination region.** `westeurope` → `eu-west-1`

**Transfer mechanism.** `adequacy-decision`

**Mechanism citation.** docs/dpia/cross-border-transfer.md §2.3

**Purpose.** Document AI extraction within Mistral's EU region family from EEA-hosted runners.

**Approved at.** `2026-05-10T00:00:00Z`

### intra-eea-llm-gateway-westeurope

**Source region → destination region.** `westeurope` → `westeurope`

**Transfer mechanism.** `adequacy-decision`

**Mechanism citation.** docs/dpia/cross-border-transfer.md §2.1

**Purpose.** Structured test-case generation inside the operator's EEA Azure region; intra-EEA flow recorded for replay verifiability.

**Approved at.** `2026-05-10T00:00:00Z`

### intra-eea-visual-sidecar-westeurope

**Source region → destination region.** `westeurope` → `westeurope`

**Transfer mechanism.** `adequacy-decision`

**Mechanism citation.** docs/dpia/cross-border-transfer.md §2.2

**Purpose.** Visual sidecar inference inside the operator's EEA Azure region; intra-EEA flow recorded for replay verifiability.

**Approved at.** `2026-05-10T00:00:00Z`

### operator-defined-jira-paste-fallback

**Source region → destination region.** `operator-defined` → `westeurope`

**Transfer mechanism.** `scc-2021`

**Mechanism citation.** docs/dpia/cross-border-transfer.md §3.1

**Purpose.** Jira REST or paste-only fallback from operator-controlled Atlassian tenant or air-gapped paste source into the EEA-hosted runner.

**Approved at.** `2026-05-10T00:00:00Z`

---

## 4. Replay verifiability

Every Wave 1 Validation evidence manifest carries
`subprocessorRegisterVersion`; every run-bundle ships the typed
`subprocessor-register.json` artifact next to
`compliance-annotations.json`. A replay can verify which register was
active for the run by:

1. Reading `wave1-validation-evidence-manifest.json` →
   `subprocessorRegisterVersion`.
2. Reading `subprocessor-register.json` → `merkleRoot`
   and matching it against the Merkle root carried in
   `provenance.jsonld` (`ti:subprocessorRegisterMerkleRoot`).
3. Looking up the matching tag of
   `docs/dora/subprocessor-register.md` and
   `docs/dpia/cross-border-transfer.md` in the repository at that
   version.

---

## 5. CI / governance gates

- **Schema-version export gate.** `SUBPROCESSOR_REGISTER_SCHEMA_VERSION`
  and `SUBPROCESSOR_REGISTER_ARTIFACT_FILENAME` are asserted in
  `src/contract-version.test.ts` as part of the contract runtime
  export snapshot.
- **Drift gate.** `pnpm run verify:subprocessor-register` fails CI if
  the on-disk Markdown drifts from the canonical TS source.
- **Manifest gate.** `validateWave1ValidationEvidenceManifestMetadata`
  rejects manifests whose `subprocessorRegisterVersion` does not equal
  the current constant.

---

## 6. See also

- `docs/dora/subprocessor-register-schema.md` — schema reference for
  the typed `SubprocessorRegister` artifact.
- `docs/dpia/cross-border-transfer.md` — paired ADR for the cross-
  border transfer story per Azure deployment region pair.
- `docs/dora/multi-source.md` — DORA mapping for the multi-source
  test-intelligence surface (Wave 4 extension).
- `COMPLIANCE.md` — top-level DORA / GDPR / EU AI Act control mapping.
- `src/contracts/index.ts` — `SubprocessorRegister` interface,
  `SUBPROCESSOR_REGISTER_VERSION`, `SUBPROCESSOR_REGISTER_SCHEMA_VERSION`,
  `SUBPROCESSOR_REGISTER_ARTIFACT_FILENAME`.
- `src/test-intelligence/subprocessor-register.ts` — canonical TS
  source-of-truth and Markdown renderer.

