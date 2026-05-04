# DPIA — Test Intelligence production runner (URL ingestion + multi-agent harness)

This document records the Data Protection Impact Assessment for the
`figma_to_qc_test_cases` production runner exposed at
`/workspace/test-intelligence/...`. It complements the broader
`docs/dpia/` directory (which covers the workspace-dev application as a
whole) by zooming in on the production-runner flow and the multi-agent
harness layered on top of it.

Scope:

- the **production runner** (`src/test-intelligence/production-runner.ts`)
  invoked from the inspector and the CLI;
- all **supported ingestion paths**: Figma URL, Figma paste / REST file,
  Jira (REST + ADF paste), customer-supplied Markdown, and Figma screen
  captures used by the visual sidecars;
- the **multi-agent harness** (`shadow_eval` and `enforced` modes) and
  its evidence chain;
- the **inspector UI** surfaces that consume the runner's outputs.

Out of scope: the broader workspace-dev paste-ingestion flow for
non-test-intelligence features (covered by the existing DPIA bundle).

Cross-references: operational procedures, refusal codes, and break-glass
switches are in
[`docs/test-intelligence-operator-runbook.md`](./test-intelligence-operator-runbook.md).
The closing-gate policy for production-wired claims is in
[`docs/test-intelligence-live-e2e.md`](./test-intelligence-live-e2e.md).
Contract changes that touch any field documented here follow the
contract-bump workflow in `CONTRIBUTING.md` §Contract changes and are
recorded in `CONTRACT_CHANGELOG.md` + `COMPATIBILITY.md` together with
the `src/contract-version.test.ts` snapshot.

---

## 1. Data flows

### 1.1 Supported inputs

The runner accepts the following ingestion shapes
(`ProductionRunnerSource` and the multi-source attachments resolved
upstream):

| Input                        | Carrier                                                         | Boundary                                               | Notes                                                                                                                                                                                                                  |
| ---------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Figma URL**                | `{ kind: "figma_url", figmaUrl, accessToken }`                  | Operator browser → workspace HTTP server → Figma REST. | The `accessToken` is the server-side `WORKSPACE_FIGMA_PERSONAL_ACCESS_TOKEN`, never the operator's personal Figma token. SSRF guard at parse + redirect time (see §3.1).                                               |
| **Figma paste (normalized)** | `{ kind: "figma_paste_normalized", file }`                      | Operator browser → workspace HTTP server.              | The operator pastes a previously exported Figma file snapshot. Workspace re-validates the snapshot before use.                                                                                                         |
| **Figma REST file**          | `{ kind: "figma_rest_file", file }`                             | Workspace fixture / batch loader.                      | Used by validation-harness and operator batch runs. No outbound network IO at runtime.                                                                                                                                 |
| **Jira REST**                | `WORKSPACE_TI_JIRA_*` credentials, REST endpoint                | Workspace HTTP server → Jira Cloud / Data Center.      | Optional source enrichment. Allow-listed via the multi-source SSRF policy (`docs/runbooks/jira-source-setup.md`). Either basic (email + API token), OAuth 3LO, or Data Center bearer PAT.                              |
| **Jira paste (ADF)**         | Inspector "Jira" tab → `jira-adf-parser`                        | Operator browser → workspace HTTP server.              | Atlassian Document Format pasted directly. Hard byte cap per job (`maxIngestBytesPerJob`).                                                                                                                             |
| **Customer Markdown**        | Inspector custom-context tab → `custom-context-markdown-reader` | Operator browser → workspace HTTP server.              | Operator-supplied Markdown attached as additional context. Hard byte cap per job (`maxIngestBytesPerJob`).                                                                                                             |
| **Screen captures**          | Figma node renders fetched server-side                          | Workspace HTTP server → Figma REST → visual sidecar.   | Bytes are passed in-memory to the visual sidecar; **never** persisted to disk and **never** included in test-generation prompts. Only sha-256 capture-identity records and derived sidecar evidence hashes are sealed. |

The visual sidecar runs only when the request supplies an
`LlmGatewayClientBundle`. When it does not, the runner skips screen
ingestion entirely.

### 1.2 URL ingestion (detail)

| Step                                                                   | Data                                                                                        | Boundary                                     | Notes                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Operator pastes a Figma URL into the inspector.                        | Figma file URL (and optional node id).                                                      | Operator browser → workspace HTTP server.    | URL is the only client-supplied input. The bearer token used for ingestion is **not** the user's token; the workspace server uses its own server-side `WORKSPACE_FIGMA_PERSONAL_ACCESS_TOKEN` (held in process env, never echoed to the client). |
| Server validates the URL, extracts the file key + optional node id.    | Figma file key, node id.                                                                    | Server-side.                                 | Validation rejects non-Figma hosts and reserved IPs at the SSRF guard layer (see §3).                                                                                                                                                            |
| Server calls Figma REST API with the server-side token.                | File metadata, node tree, image renders.                                                    | Workspace server → Figma.                    | TLS-only, scoped to `api.figma.com`. The Figma response body is parsed in-memory; nothing is written to disk that the operator did not already see in the browser.                                                                               |
| Server runs the production runner (test generation + visual sidecars). | Bounded IR slice, prompt rules, model responses.                                            | Workspace server → Azure AI Foundry gateway. | The IR slice is bounded by `boundIntentForLlm` before being shipped to the model; only the structural shape needed to derive test cases leaves the workspace boundary.                                                                           |
| Server writes artifacts to `<artifactRoot>/<jobId>/`.                  | Generated test cases, validation report, policy report, evidence manifest, visual sidecars. | Server-local filesystem.                     | The artifact root is operator-controlled; default deployments mount it on a customer-controlled volume.                                                                                                                                          |
| Inspector fetches the artifacts.                                       | Same as above.                                                                              | Server → operator browser.                   | Each route is gated by the TI feature flag and (where applicable) the four-eyes policy.                                                                                                                                                          |

### 1.3 Token handling

- The Figma API token (`WORKSPACE_FIGMA_PERSONAL_ACCESS_TOKEN`) is
  read once from the process environment at boot. It is never:
    - serialized into a job artifact,
    - logged,
    - returned in a HTTP response body,
    - passed across the inspector → server boundary as a query string
      or header from the operator's browser.
- The Azure AI Foundry API key
  (`WORKSPACE_AZURE_AI_FOUNDRY_API_KEY`) is handled identically.
- The Jira credentials (`WORKSPACE_TI_JIRA_API_TOKEN`,
  `JIRA_OAUTH_ACCESS_TOKEN`, `WORKSPACE_TI_JIRA_PAT`) are handled
  identically. Only one of the three flavors is active per
  deployment, picked by the credential resolver.
- The reviewer's bearer token (used for inspector authz) is held in
  the browser's `sessionStorage` and is therefore tab-scoped — it does
  not survive a browser restart.

### 1.4 Cache isolation and replay-cache key derivation

The MCP resolver cache (test-intelligence) is **token-scoped**. Two
operators with distinct bearer tokens cannot read each other's cached
payloads even if they request the same key. This was hardened in
PR #1727 (commit `e601369e`); the production runner inherits that
behavior unchanged.

The disk-backed replay cache used by the multi-agent harness derives
its keys from canonical-JSON of the _bounded_ prompt input plus the
model binding identity (`providerId`, `modelId`,
`inferenceProfileId`, optional `ictRegisterRef`). **Raw request bodies
are never used as cache keys, and the cache never stores raw request
bodies on disk — only the canonical-JSON of the bounded inputs and the
hashed response shape.** Idempotent replay hits surface in the FinOps
report as `idempotentReplayHits` per agent source label; in-flight
deduplication within a single job surfaces as `inFlightDedupHits`. The
two counters are distinct — see the operator runbook §"FinOps
interpretation".

### 1.5 Multi-agent harness

When the operator sets `harness.mode` to `shadow_eval` or `enforced`,
the production runner additionally runs a `runAgentHarnessStep` over
the LLM call. Data handling differs from the single-pass `off` mode in
three ways:

1. **Per-step artifacts.** Each step writes a checkpoint under
   `<runDir>/agent-harness-checkpoints/<jobId>/` and a per-attempt
   record under `<runDir>/agent-role-runs/`. Artifacts are
   canonical-JSON; no raw prompt or response body is included — only
   bounded summaries, hash references, and the harness outcome enum.
2. **No chain-of-thought is persisted.** Hidden reasoning streams from
   the gateway are consumed in-memory and discarded; the harness
   stores only the classified outcome (`accepted` / refusal class) and
   the structured artifact shape needed for replay.
3. **Catch-Up Brief**
   (`src/test-intelligence/catch-up-brief.ts`).
   Reviewer-facing brief generated when a job has been idle past
   `idleThresholdMs` (default 5 min). The default
   `deterministic` generator is a pure function over the on-disk event
   log. The opt-in `no_tools_llm` generator runs an LLM call with
   no-tools constraint and falls back to `deterministic` if the
   response carries any tool-call shape, is empty/oversized, fails
   `semantic-content-sanitization`, or throws. Briefs include event
   _kinds_ and bounded "significant id" lists (≤ 16 each); raw event
   bodies are never included.

In `shadow_eval` mode the LLM call still drives the terminal decision;
the harness only observes. In `enforced` mode the harness owns the
terminal decision and a non-`accepted` outcome refuses the run with the
existing failure-class envelope (mapping in operator runbook §"Harness
refusal").

---

## 2. Lawful basis & data subject categories

The production runner is invoked by an authenticated operator on
internal Figma designs that the operator's organization owns. The
data processed is:

- **Design metadata** (frame names, node names, style attributes) —
  not personal data in the typical case; the DPIA assumes the
  operator has separately ensured no personal data is embedded in
  Figma file names or text content.
- **Operator identifiers** (reviewer handle, bearer token claims)
  used solely for authz and audit. Stored only in the evidence
  manifest and the review-events log; both are local to the
  artifact root.
- **Customer-supplied Markdown / Jira ADF / pasted Figma snapshots**
  — bounded by per-source byte caps and run through the
  `UntrustedContentNormalizer` (see §3.6) before any LLM call.

No personal data of end-users (customers of the bank / insurer) is
expected to enter the system. Where a designer has placed dummy PII
in a screen for visual realism, the visual sidecar's PII detector
flags the screen and the runner records a `visual_possible_pii`
four-eyes enforcement reason; the inspector surfaces this prominently
so the operator can redact before exporting.

---

## 3. Security controls

### 3.1 SSRF guard

URL ingestion uses an allow-listed host check before any outbound
request:

- Only `api.figma.com` (and equivalent Figma-owned hosts) is
  accepted for Figma sources.
- For Jira REST sources, the operator's configured Jira host is
  allow-listed via the multi-source SSRF policy.
- IP literals, link-local ranges, RFC1918, and the loopback
  network are rejected at parse time.
- The Figma and Jira REST clients refuse redirects to a different
  host so an attacker-controlled file cannot pivot the server toward
  an internal service.

This control is layered on top of the existing payload-bytes guard
documented for the broader workspace-dev application.

### 3.2 Token-scope isolation

See §1.3 and §1.4.

### 3.3 Fail-closed FinOps envelope

The production runner ships with `PRODUCTION_FINOPS_BUDGET_ENVELOPE`
(see `src/test-intelligence/finops-budget.ts`). Every role has caps;
no role is unconstrained. Envelope validation runs before any IO
touches the network — invalid envelopes refuse with
`FINOPS_BUDGET_INVALID`. Breach aborts the job and the FinOps report
records the breach class. This bounds the cost impact of a runaway
model, prevents accidental denial-of-wallet, and caps the replay-cache
miss rate via `maxReplayCacheMissRate`.

### 3.4 Four-eyes review

Test cases tagged with regulated-data, financial-transaction, or
visual-fallback signals require two distinct approvers before export.
The audit trail is append-only and lives in `review-events.jsonl`
under the artifact root.

### 3.5 Evidence chain (Merkle, in-toto, Sigstore, ML-BOM)

Every job emits an evidence chain rooted in
`AgentHarnessCheckpoint` records. Each checkpoint carries:

- `parentHash` — sha256 of the previous checkpoint's canonical-JSON
  (root uses the 64-char zero-hash sentinel
  `AGENT_HARNESS_CHECKPOINT_ROOT_PARENT_HASH`);
- `chainIndex` — monotonic, 0-based position;
- `runId` / `parentRunId` — stable role-step identifiers;
- input/output hashes — never raw bodies.

The runner seals the chain with a
`ProductionRunnerEvidenceSeal`
(`PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME`) that records the
`headOfChainHash`, `chainLength`, harness artifact filenames, the
FinOps `bySourceHash` (per-source cost map), the genealogy DAG hash,
and the per-screen `visualEvidenceHashes`. Verification:

```
pnpm exec tsx scripts/verify-evidence-manifest.ts \
  --job-dir <artifactRoot>/<jobId>
```

The verifier walks the chain end-to-end and reports a `chain_break` at
the first affected `chainIndex` if any link is missing or tampered.

<!-- prettier-ignore -->
No raw screenshot bytes are ever persisted; only SHA-256 capture identity records and derived sidecar evidence hashes are written to disk.

The CycloneDX 1.7 ML-BOM is emitted at
`evidence/ml-bom/cyclonedx-1.7-ml-bom.json`
(`ML_BOM_ARTIFACT_FILENAME`) and references the active model
bindings (§3.7), prompt-template hashes, schema versions, system-prompt
hashes, gateway endpoint identity, and policy-bundle hash. The ML-BOM
is hand-rolled (zero runtime dependencies) and validated against
`validateMlBomDocument` before being sealed. The in-toto v1 statement
and Sigstore bundle reference for the wave-1 validation attestation are
produced by `evidence-attestation.ts`; for wave-1 the runner supports
both keyed and keyless signers
(`createKeyBoundSigstoreSigner`,
`createKeylessSigstoreSignerScaffold`).

### 3.6 Untrusted-content redaction layers

Any operator-supplied content (Figma source, Jira ADF, customer
Markdown, ad-hoc text fields) is run through
`UntrustedContentNormalizer`
(`src/test-intelligence/untrusted-content-normalizer.ts`) before any
LLM call. The normalizer is the single chokepoint that integrates four
detectors:

| Layer                             | Source module                                                | Purpose                                                                                                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PII detection**                 | `src/test-intelligence/pii-detection.ts`                     | Detects shape-based PII (IBAN, BIC, contract numbers, customer-name-shaped fields). Returns counts only, never values.                                                                                                                                 |
| **Secret redaction**              | `src/secret-redaction.ts`                                    | Redacts high-risk secret shapes (cloud keys, JWTs, tokens). Counts byte-diff between pre- and post-redacted content.                                                                                                                                   |
| **Markdown / prompt-injection**   | Local regex set (e.g. role-prefix patterns, `<system>` tags) | Counts pattern hits; persistence is hit-count only.                                                                                                                                                                                                    |
| **Semantic content sanitization** | `src/test-intelligence/semantic-content-sanitization.ts`     | Applies to LLM-_generated_ test-case strings (post-generation): shell metacharacters, command substitution, JNDI, encoded payloads, `<script>` tags, HTML event handlers, dangerous URL schemes. Categories listed in `SEMANTIC_SUSPICION_CATEGORIES`. |

The normalizer report
(`untrusted-content-normalization-report.json`) is canonical-JSON and
contains **only counts** (`piiMatches`, `secretMatches`,
`markdownInjectionMatches`, `figmaHiddenLayers`, `sentinelLayerNames`,
`zeroWidthCharacters`, `adfCollapsedNodes`, `elementsTruncated`,
…). No matched values, raw content, or pre-redaction bytes are ever
persisted. Sentinel layer names (`__system__` and similar) escalate the
job to `needs_review` at "critical" severity. Any exception during
traversal is caught and the job is escalated to `needs_review` with the
`adf_collapsed_node` carrier — the normalizer fails closed.

### 3.7 Active model bindings and ICT register references

The runner records every `ActiveModelBinding` used by a job in the
evidence manifest. A binding is the tuple
`{ providerId, modelId, inferenceProfileId, ictRegisterRef? }`
(`AgentModelBinding` in `src/contracts/`). The bindings used by a
production-wired run are:

| Role              | Provider      | Model id (example)                    | Inference profile (example)                             | ICT register reference                                                               |
| ----------------- | ------------- | ------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `test_generation` | `llm-gateway` | `gpt-oss-120b` (or operator override) | `WORKSPACE_AZURE_AI_FOUNDRY_TEST_GENERATION_DEPLOYMENT` | Operator-managed, e.g. `ict://bank/registers/llm/azure-foundry/test-generation/<id>` |
| `visual_primary`  | `llm-gateway` | `llama-4-maverick-vision`             | `WORKSPACE_AZURE_AI_FOUNDRY_VISUAL_PRIMARY_DEPLOYMENT`  | Operator-managed, e.g. `ict://bank/registers/llm/azure-foundry/visual-primary/<id>`  |
| `visual_fallback` | `llm-gateway` | `phi-4-multimodal-poc` (or fallback)  | `WORKSPACE_AZURE_AI_FOUNDRY_VISUAL_FALLBACK_DEPLOYMENT` | Operator-managed, e.g. `ict://bank/registers/llm/azure-foundry/visual-fallback/<id>` |

Under the `eu-banking-default` policy profile, every active binding
**must** carry a non-empty `ictRegisterRef`. Missing references are
refused with the documented refusal code
`ict_register_ref_required`; the policy gate raises a
`policy:ict-register-ref-required` violation at error severity. The
exact `ictRegisterRef` strings are operator-managed and live in the
operator's compliance register; the runner enforces only that the
field is present and non-empty for banking deployments. Bindings are
also referenced from the CycloneDX 1.7 ML-BOM (§3.5) so auditors can
correlate the evidence chain with the operator's ICT register entry.

### 3.8 Hooks (signed-bundle policy)

Hook matchers (`src/test-intelligence/harness-hooks.ts`) are subject to
defensive validation before any execution:

- `http` commands must use `POST` and target hosts in
  `HookRuntimePolicy.allowedHttpHosts`. Telemetry/analytics-shaped
  URLs are blocked outright (`hook_telemetry_url_blocked`).
- `command` and `agent` hooks run inside the same FinOps + ICT-register
  envelope as the runner's primary roles. `hook:<bundleId>` cost lines
  appear in the FinOps `bySource` map.
- Banking-profile operators must register hook bundles in
  `CONTRACT_CHANGELOG.md` (read by
  `extractRegisteredSignedBundleIdsFromContractChangelog`) and pin the
  bundle id in `HookMatcher.signedBundleId`. Unregistered or unsigned
  bundles refuse with `hook_bundle_unregistered` /
  `hook_bundle_unsigned`. The full refusal-code list is in the operator
  runbook §"Hooks".

---

## 4. Retention

- Artifact root: operator-controlled. The runner does not delete
  prior jobs. Operators implementing a retention policy should rotate
  the directory under their own schedule and capture the deletions
  in their evidence pipeline. Note that rotating active job
  directories invalidates the evidence chain under those directories;
  retention should target only sealed jobs older than the operator's
  audit window.
- In-memory caches (MCP resolver, replay): bounded by process
  lifetime; restart clears them.
- Disk-backed replay cache: keyed only on bounded canonical-JSON of
  the prompt input + binding identity (§1.4). Operators wishing to
  expire entries early may delete the cache directory; entries are
  re-derived deterministically on next run.
- Session bearer tokens: cleared when the operator's browser tab
  closes (see §1.3).

---

## 5. DORA mapping (generic)

This section maps the production-runner controls to the DORA articles
that govern operational resilience for financial-sector ICT. The
mapping is at the **theme** level rather than the paragraph level —
operators in scope of DORA should validate the precise paragraph
references with their compliance team.

- **DORA Art. 16 — ICT-related incident management**: gateway
  timeouts, circuit-open events, FinOps breaches, harness refusals
  (`enforced` mode), policy refusals (including
  `ict_register_ref_required`), hook validation refusals, and
  untrusted-content escalations are recorded as job-level events with
  structured reasons. Recovery procedures are documented in
  `docs/test-intelligence-operator-runbook.md` §Recovery; the
  release-summary taxonomy (`provider_unavailable`, `quota_exceeded`,
  `policy_block`, `schema_invalid_response`, `circuit_breaker_open`)
  is in `docs/test-intelligence-live-e2e.md` §4.

- **DORA Art. 28 — managing ICT third-party risk**: the production
  runner has the third-party dependencies enumerated in §3.7
  (Azure AI Foundry gateway as `llm-gateway` provider; Figma REST API
  for URL ingestion; Jira REST when configured). Each is token-bound
  and SSRF-guarded. The token scopes, allow-listed hosts, and
  circuit-breaker policies for each are documented in the runbook and
  in `src/test-intelligence/finops-budget.ts`. Active model bindings
  are recorded with operator-managed `ictRegisterRef` values for
  banking-profile deployments and surfaced in the CycloneDX 1.7 ML-BOM
  at `evidence/ml-bom/cyclonedx-1.7-ml-bom.json`.

- **DORA Art. 31 — testing of ICT tools**: the production runner is
  exercised by:
    - the unit test suite (`src/test-intelligence/*.test.ts`);
    - the contract-version snapshot
      (`src/contract-version.test.ts`);
    - the live-end-to-end smoke against Azure
      (`src/test-intelligence/production-runner.live-e2e.test.ts`,
      nightly + on-demand via GitHub Actions, see
      `.github/workflows/test-intelligence-live-e2e.yml` and
      `docs/test-intelligence-live-e2e.md`);
    - the smoke-compile gate (`pnpm test:smoke:compile`).

    This satisfies the spirit of Art. 31's "regular testing" mandate;
    operators must confirm the cadence meets their internal testing
    policy.

---

## 6. Data minimization principles

The runner enforces these minimization rules by construction:

- **No chain-of-thought.** Hidden reasoning streams from the gateway
  are consumed in-memory and discarded. Harness checkpoints store only
  classified outcomes and structured artifact shapes.
- **No raw screenshots in test-generation prompts.** Visual sidecar
  output is structured JSON; only sha-256 capture-identity records and
  derived evidence hashes are sealed. Screen bytes never reach the
  test-generation prompt.
- **No raw bodies in idempotency / replay caches.** The cache key is
  canonical-JSON of the bounded prompt input plus the model binding
  identity (§1.4). Stored values are response shape hashes, not the
  responses themselves.
- **Hit-count-only redaction reports.** The
  `UntrustedContentNormalizer` report records counts per category; no
  matched values or pre-redaction bytes are persisted (§3.6).
- **Bounded IR slice.** `boundIntentForLlm` strips Figma node fields
  not needed for test derivation before the prompt compiler runs.
- **Bounded brief content.** Catch-Up Brief outputs are capped at 512
  characters of summary, ≤ 16 significant ids per event kind, and run
  through `semantic-content-sanitization` (in `no_tools_llm` mode)
  before display.

---

## 7. Open items / residual risk

- **Figma file content**: the runner trusts that the operator's
  Figma files do not contain personal data. There is no automated
  PII scrub of design text content beyond the visual sidecar's
  best-effort flag and the `UntrustedContentNormalizer`'s shape-based
  detector. Operators with strict PII-minimization requirements
  should establish a manual review step before ingestion.
- **Model provider data flows**: the Azure AI Foundry gateway is
  the model-side trust boundary. Workspace-dev does not see what
  the gateway does with prompts beyond its API contract. Operators
  must verify their gateway's data-retention and training-opt-out
  posture independently.
- **Jira REST + ADF paste**: trust assumptions mirror the broader
  multi-source DPIA in `docs/dpia/jira-source.md`. Operators routing
  Jira content through this runner should confirm that DPIA covers
  their tenant configuration.
- **Customer Markdown**: trust assumptions mirror
  `docs/dpia/custom-context-source.md`. Same confirmation
  requirement as Jira.
- **Replay cache enablement**: see Issue #1739. The current cache
  key derivation already excludes raw bodies; expanding the cache's
  scope must preserve that property and the token-scope isolation
  documented in §1.4.
- **`no_tools_llm` brief generator**: opt-in only. Even with the
  no-tools constraint and the deterministic fallback path, operators
  with strict provider-side data-egress policies should keep the
  generator in `deterministic` mode.

---

## 8. Document control

- Document owner: workspace-dev maintainers.
- Last reviewed: 2026-05-04 (Issue #1799 — multi-agent harness
  coverage added: harness modes, evidence chain, ICT register, hooks,
  Catch-Up Brief, expanded redaction enumeration).
- Triggers for re-review: any change to the URL-ingestion flow, the
  FinOps envelope, the SSRF guard, the active model binding list, the
  ICT-register enforcement rules, the hook command kinds, the
  `UntrustedContentNormalizer` integrations, or the third-party
  dependency list. The contract-version snapshot test catches changes
  to the shipped envelope and harness mode enums; reviewers should
  check this DPIA when bumping `CONTRACT_VERSION` per the workflow in
  `CONTRIBUTING.md` §Contract changes and `CONTRACT_CHANGELOG.md`.
