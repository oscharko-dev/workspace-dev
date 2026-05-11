# Cross-Border Transfer ADR — workspace-dev

**Status:** Accepted (2026-05-10).
**Closes audit finding:** GDPR Ch. V (Articles 44–49) — "cross-border transfer
story undocumented" (Issue #2113). Paired with the subprocessor register at
`docs/dora/subprocessor-register.md`.

**Register version:** `1.0.0` — mirrors the runtime constant
`SUBPROCESSOR_REGISTER_VERSION` exported from `src/contracts/index.ts`. The
CODEOWNERS rule keeps this ADR coupled with the register; both files MUST be
updated in the same change set when the transfer story changes.

**Audience:** financial entities and other regulated operators preparing
their own GDPR Art. 28 / Ch. V transfer assessment for the test-intelligence
deployments. The operator is the controller; this ADR documents the package's
defaults and constraints, and enumerates the transfer mechanisms operators
must apply per region pair.

---

## 1. Context

`workspace-dev` is operator-deployed. Its outbound traffic depends on which
LLM gateway, visual-sidecar deployment, document-AI deployment, and Jira
tenant the operator configures. The package therefore cannot fix a single
cross-border-transfer model — but it can:

- enumerate every transfer boundary that may exist for an operator-supplied
  configuration, and
- document the transfer mechanism, encryption-in-transit guarantee, and
  data-classification posture the operator MUST apply per region pair.

This ADR is the engineering-grade input to the operator's DPO assessment.
It is not a legal opinion.

## 2. Decision

The package commits to the following guarantees and defers the rest to
operator configuration recorded in the operator's own DPIA / register-of-
information:

1. **Egress is operator-explicit.** The package does not call any default
   cloud endpoint. Every outbound HTTP call is gated on operator-supplied
   configuration plus a feature flag plus the `llmCodegenMode` mode-lock
   invariant. There is no implicit "telemetry" or "analytics" endpoint.
2. **TLS is mandatory at the transfer boundary.** Every outbound call uses
   HTTPS with the platform-default trust store. The harness-hook validator
   refuses non-HTTPS hook URLs (`hook_http_domain_not_allowlisted` is
   returned for any `http://` host) — see §3.4 for the encryption-in-transit
   assertion.
3. **No raw image / paste / response bytes leave the run.** Hard manifest
   invariants (`rawScreenshotsIncluded: false`,
   `imagePayloadSentToTestGeneration: false`,
   `rawJiraResponsePersisted: false`, `rawPasteBytesPersisted: false`) are
   stamped into every Wave 1 Validation evidence manifest. This bounds what
   _can_ be transferred even if the operator's deployment is configured in a
   non-EEA region.
4. **Per-region-pair transfer mechanism is operator-defined.** The operator
   MUST select one of the GDPR Ch. V mechanisms enumerated in §3.1 per
   region pair and record the choice in their DPA file. The package has no
   default — it does not embed any region pair as "implicitly accepted".

## 3. Consequences

### 3.1 Per-region-pair transfer mechanism matrix

The matrix below names each region-pair shape that may apply when an
operator's controller-region differs from the deployed Azure / Mistral /
Atlassian region. The operator MUST select one of the enumerated GDPR
mechanisms for every active pair and record the choice in their own DPA
register. Concrete tenant ids and SCC version numbers are not embedded in
the package.

| Controller region (operator) | Processor / sub-processor region                                                                       | Mechanism (GDPR Ch. V)                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EEA / Switzerland            | EEA Azure region (`westeurope`, `northeurope`, `francecentral`, `germanywestcentral`, `swedencentral`) | **Intra-EEA — no Ch. V transfer.** Operator records the EEA-residency configuration in their DPA. No SCC needed.                                                                                                  |
| EEA / Switzerland            | UK Azure region (`uksouth`, `ukwest`)                                                                  | **Adequacy decision** (UK adequacy decision dated 2021-06-28, valid through the EU Commission's review cycle). Operator records the adequacy reference in their DPA.                                              |
| EEA / Switzerland            | US Azure region (`eastus`, `westus2`, etc.)                                                            | **Standard Contractual Clauses (SCC, 2021/914 Module 2 controller-to-processor)** + provider's EU Data Boundary commitment + transfer impact assessment (Schrems II). Operator records SCC version + TIA outcome. |
| EEA / Switzerland            | Asia-Pacific Azure region                                                                              | **SCC (2021/914 Module 2)** + transfer impact assessment. No general adequacy decision available.                                                                                                                 |
| EEA / Switzerland            | Mistral EU region (`eu-west-1` family)                                                                 | **Intra-EEA — no Ch. V transfer.** Operator records the EU-region pinning in their DPA.                                                                                                                           |
| EEA / Switzerland            | Atlassian Cloud — EU residency                                                                         | **Intra-EEA — no Ch. V transfer.** Operator pins residency to EU under Atlassian's data-residency control plane.                                                                                                  |
| EEA / Switzerland            | Atlassian Cloud — non-EU residency                                                                     | **SCC (2021/914 Module 2)** + Atlassian's published SCC + TIA outcome. Operator records the residency configuration explicitly.                                                                                   |
| EEA / Switzerland            | Self-hosted Jira Data Center (operator-managed)                                                        | **No Ch. V transfer** (typically intra-controller). Operator must still apply the network-egress allow-list and credential rotation policy.                                                                       |
| Non-EEA controller           | Any                                                                                                    | **Operator-defined.** The package places no further constraint; the operator's own jurisdiction controls.                                                                                                         |

For every active row in the operator's own deployment, the operator MUST:

1. Identify the row pair from §3.1.
2. Apply the selected mechanism (SCC, BCR, adequacy reference, etc.) and
   record the choice in their DPA register with the contractual reference
   number.
3. Where SCC are used, complete a Transfer Impact Assessment and store its
   outcome in the operator's audit file.
4. Reflect the resulting register entry in
   `docs/dora/subprocessor-register.md` §2 in the same change set, and bump
   `SUBPROCESSOR_REGISTER_VERSION`.

### 3.2 Data-classification at the transfer boundary

Every transfer boundary the package crosses carries one of these
classifications. The operator MUST refuse a deployment configured at a
higher classification than the row says.

| Transfer boundary                   | Classification                                                                                             | Justification                                                                                                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LLM gateway (test generation)       | Personal data — pseudonymised                                                                              | Business Test Intent IR is PII-redacted before prompt compilation. Hard manifest invariant: structured-test-case generator deployment never receives image payloads.                 |
| Visual sidecar (vision deployment)  | Personal data — pseudonymised                                                                              | Captures of operator-supplied screens may incidentally show personal data. The visual-policy gate blocks downstream emission when the sidecar reports `visual_sidecar_possible_pii`. |
| Document AI (Mistral)               | Personal data — pseudonymised                                                                              | The package never sends raw documents containing Art. 9 special-category data. Operator owns the upstream input gate.                                                                |
| Jira REST gateway                   | Personal data — pseudonymised                                                                              | Issue summaries, descriptions, AC, comments, attachments metadata are PII-redacted in `jira-issue-ir.ts` before persistence; opt-in fields are excluded by default.                  |
| Hook HTTP egress (operator-defined) | Operator-defined; the package recommends "no personal data" — only job ids, refusal codes, evidence hashes | The hook executor refuses non-HTTPS URLs and refuses telemetry-shaped URLs (`TELEMETRY_URL_RE`). Bodies use `bodyTemplate` placeholders gated by `allowedEnvVars`.                   |

### 3.3 Encryption-in-transit guarantees

| Channel                                    | Guarantee                                                                                                                                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LLM gateway / visual sidecar / document AI | HTTPS to the operator-configured endpoint. The platform default Node.js TLS stack is used (TLS 1.2+ with system trust store). The package does not pin a custom CA; operators that require pinning install the certificate at the OS / container layer. |
| Jira REST                                  | HTTPS to the operator-configured Jira host. The Jira REST adapter refuses non-HTTPS hosts (TLS-only egress). Bearer tokens are read from environment variables and never written to disk or evidence artifacts.                                         |
| Hook HTTP                                  | The validator at `harness-hooks.ts:542` refuses any non-`https:` URL (`hook_http_domain_not_allowlisted`). Bodies are constructed from `bodyTemplate` placeholders gated by the `allowedEnvVars` allow-list.                                            |
| Object-storage egress                      | Operator-deployed; the package writes to a local filesystem path with atomic rename and defers TLS to the operator's storage layer.                                                                                                                     |

### 3.4 DPA references the operator must maintain

The operator MUST maintain executed Data Processing Agreements with each
provider category and reference them in the operator's own DPIA register:

- **LLM gateway provider** (e.g., Microsoft for Azure OpenAI). DPA must
  cover the gateway and the Azure infrastructure beneath it. Reference in
  the operator's register: `dpa://<provider>/<contract-id>/<version>`.
- **Visual sidecar provider** (typically the same as LLM gateway, or a
  separate provider when deployed independently).
- **Document AI provider** (Mistral). DPA must cover Mistral's published
  sub-processor list at the time of execution.
- **Atlassian** (when `jira_rest` is used against Atlassian Cloud). DPA is
  Atlassian's published Cloud Data Processing Addendum.
- **Hook HTTP egress** (per host-pattern). DPA per operator-selected
  provider.

### 3.5 Egress that does NOT cross a transfer boundary

The package's air-gap and paste-only paths do not cross a transfer boundary:

- `jira_paste` — reviewer manually pastes Jira content via the Inspector UI;
  no outbound API call. See `docs/dpia/jira-source.md` §2.
- `custom_text` / `custom_structured` — reviewer-supplied content; no
  outbound API call. See `docs/dpia/custom-context-source.md`.
- `pnpm run test:ti-eval` — deterministic CI gate runs against mock
  gateways; performs no outbound network calls. See
  `docs/runbooks/multi-source-air-gap.md`.

### 3.6 Replay verifiability

Every Wave 1 Validation evidence manifest carries
`subprocessorRegisterVersion: "1.0.0"`. A replay can resolve the active
transfer ADR by reading the field and checking out this document at the
corresponding repository tag.

`activeModelBindings[].ictRegisterRef` (when stamped under banking profiles)
carries the operator's register-of-information row identifier so the
manifest links directly to the operator's own register entry.

## 4. Alternatives considered

- **Embed a fixed transfer-mechanism choice in the package.** Rejected —
  operators choose the transfer mechanism per their own jurisdiction and
  vendor contracts. A package-level default would mislead operators and
  could over-promise on Schrems II compliance.
- **Block all non-EEA deployment configurations at runtime.** Rejected —
  operators outside the EEA are legitimate users; the package cannot reason
  about their legal regime. The decision is delegated to the operator's
  DPO, with the matrix in §3.1 as the engineering input.
- **Embed SCC text in the repository.** Rejected — SCC are bilateral
  agreements between controller and processor and version with the EU
  Commission's published instrument. Operators must reference their own
  executed SCC, not a checked-in copy.

## 5. Governance

- **CODEOWNERS coupling.** This ADR and the paired register at
  `docs/dora/subprocessor-register.md` share a CODEOWNERS rule. A PR that
  mutates one without the other is reviewed by the same governance owner;
  reviewers MUST refuse an unbalanced change.
- **`SUBPROCESSOR_REGISTER_VERSION` bump.** The constant in
  `src/contracts/index.ts` MUST be bumped in the same PR as any
  substantive change to this ADR or to the register. The runtime gate in
  `validateWave1ValidationEvidenceManifestMetadata` rejects manifests
  whose stamped version does not match the constant — this couples replay
  evidence to the version of this document that produced it.
- **Reviewed by:** Governance / Compliance owner per CODEOWNERS.
- **Review cadence:** Quarterly, aligned with the DORA control review in
  `COMPLIANCE.md` §"Quarterly: DORA control and evidence review".

## 6. See also

- `docs/dora/subprocessor-register.md` — paired register (CODEOWNERS-coupled).
- `docs/dora/multi-source.md` — DORA mapping for the multi-source surface.
- `docs/dpia/jira-source.md` — DPIA addendum for the Jira source.
- `docs/dpia/custom-context-source.md` — DPIA addendum for the custom-context
  source.
- `COMPLIANCE.md` — top-level DORA / GDPR / EU AI Act control mapping.
- `src/contracts/index.ts` — `SUBPROCESSOR_REGISTER_VERSION` constant +
  `Wave1ValidationEvidenceManifest.subprocessorRegisterVersion` field.
- `src/test-intelligence/harness-hooks.ts` — hook HTTP TLS-only gate +
  host allow-list enforcement.
