# DPIA — Test Intelligence production runner (URL ingestion)

This document records the Data Protection Impact Assessment for the
`figma_to_qc_test_cases` production runner exposed at
`/workspace/test-intelligence/...`. It complements the broader
`docs/dpia/` directory (which covers the workspace-dev application as a
whole) by zooming in on the URL-ingestion flow shipped with the
production runner.

Scope:

- the **production runner** (`src/test-intelligence/production-runner.ts`)
  invoked from the inspector's Figma URL tab and the CLI;
- the **URL ingestion** path that fetches a Figma file by REST API
  using a token-bound, server-side request;
- the **inspector UI** surfaces that consume the runner's outputs.

Out of scope: the broader workspace-dev paste-ingestion flow (covered
by the existing DPIA bundle).

---

## 1. Data flows

### 1.1 URL ingestion

| Step                                                                   | Data                                                                                        | Boundary                                     | Notes                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Operator pastes a Figma URL into the inspector.                        | Figma file URL (and optional node id).                                                      | Operator browser → workspace HTTP server.    | URL is the only client-supplied input. The bearer token used for ingestion is **not** the user's token; the workspace server uses its own server-side `WORKSPACE_FIGMA_PERSONAL_ACCESS_TOKEN` (held in process env, never echoed to the client). |
| Server validates the URL, extracts the file key + optional node id.    | Figma file key, node id.                                                                    | Server-side.                                 | Validation rejects non-Figma hosts and reserved IPs at the SSRF guard layer (see §3).                                                                                                                                                            |
| Server calls Figma REST API with the server-side token.                | File metadata, node tree, image renders.                                                    | Workspace server → Figma.                    | TLS-only, scoped to `api.figma.com`. The Figma response body is parsed in-memory; nothing is written to disk that the operator did not already see in the browser.                                                                               |
| Server runs the production runner (test generation + visual sidecars). | Bounded IR slice, prompt rules, model responses.                                            | Workspace server → Azure AI Foundry gateway. | The IR slice is bounded by `boundIntentForLlm` before being shipped to the model; only the structural shape needed to derive test cases leaves the workspace boundary.                                                                           |
| Server writes artifacts to `<artifactRoot>/<jobId>/`.                  | Generated test cases, validation report, policy report, evidence manifest, visual sidecars. | Server-local filesystem.                     | The artifact root is operator-controlled; default deployments mount it on a customer-controlled volume.                                                                                                                                          |
| Inspector fetches the artifacts.                                       | Same as above.                                                                              | Server → operator browser.                   | Each route is gated by the TI feature flag and (where applicable) the four-eyes policy.                                                                                                                                                          |

### 1.2 Token handling

- The Figma API token (`WORKSPACE_FIGMA_PERSONAL_ACCESS_TOKEN`) is
  read once from the process environment at boot. It is never:
    - serialized into a job artifact,
    - logged,
    - returned in a HTTP response body,
    - passed across the inspector → server boundary as a query string
      or header from the operator's browser.
- The Azure AI Foundry API key
  (`WORKSPACE_AZURE_AI_FOUNDRY_API_KEY`) is handled identically.
- The reviewer's bearer token (used for inspector authz) is held in
  the browser's `sessionStorage` and is therefore tab-scoped — it does
  not survive a browser restart.

### 1.3 Cache isolation

The MCP resolver cache (test-intelligence) is **token-scoped**. Two
operators with distinct bearer tokens cannot read each other's cached
payloads even if they request the same key. This was hardened in
PR #1727 (commit `e601369e`); the production runner inherits that
behavior unchanged.

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
  accepted.
- IP literals, link-local ranges, RFC1918, and the loopback
  network are rejected at parse time.
- The Figma REST client refuses redirects to a different host so an
  attacker-controlled Figma file cannot pivot the server toward an
  internal service.

This control is layered on top of the existing payload-bytes guard
documented for the broader workspace-dev application.

### 3.2 Token-scope isolation

See §1.3.

### 3.3 Fail-closed FinOps envelope

The production runner ships with `PRODUCTION_FINOPS_BUDGET_ENVELOPE`
(see `src/test-intelligence/finops-budget.ts`). Every role has caps;
no role is unconstrained. Breach aborts the job and writes a
`reason="finops-breach"` event. This bounds the cost impact of a
runaway model and prevents accidental denial-of-wallet.

### 3.4 Four-eyes review

Test cases tagged with regulated-data, financial-transaction, or
visual-fallback signals require two distinct approvers before export.
The audit trail is append-only and lives in `review-events.jsonl`
under the artifact root.

### 3.5 Evidence manifest

Every job emits an evidence manifest with content hashes for every
artifact. The verify script
(`scripts/verify-evidence-manifest.ts`) recomputes the hashes and
exits non-zero on mismatch — auditors can run it without read access
to the source.
No raw screenshot bytes are ever persisted; the only persisted visual
evidence is structured sidecar output plus SHA-256 capture identity
records and derived evidence hashes.

---

## 4. Retention

- Artifact root: operator-controlled. The runner does not delete
  prior jobs. Operators implementing a retention policy should rotate
  the directory under their own schedule and capture the deletions
  in their evidence pipeline.
- In-memory caches (MCP resolver, replay): bounded by process
  lifetime; restart clears them.
- Session bearer tokens: cleared when the operator's browser tab
  closes (see §1.2).

---

## 5. DORA mapping (generic)

This section maps the production-runner controls to the DORA articles
that govern operational resilience for financial-sector ICT. The
mapping is at the **theme** level rather than the paragraph level —
operators in scope of DORA should validate the precise paragraph
references with their compliance team.

- **DORA Art. 16 — ICT-related incident management**: gateway
  timeouts, circuit-open events, and FinOps breaches are recorded as
  job-level events with structured reasons. The events feed into the
  operator's incident management pipeline via the standard log
  drain. Recovery procedures are documented in
  `docs/test-intelligence-operator-runbook.md` §Recovery.

- **DORA Art. 28 — managing ICT third-party risk**: the production
  runner has exactly two third-party dependencies (Figma REST API
  and the Azure AI Foundry gateway), each token-bound and SSRF-
  guarded. The token scopes, allow-listed hosts, and circuit-breaker
  policies for each are documented in the runbook and in
  `src/test-intelligence/finops-budget.ts`.

- **DORA Art. 31 — testing of ICT tools**: the production runner is
  exercised by:
    - the unit test suite (`src/test-intelligence/*.test.ts`);
    - the contract-version snapshot
      (`src/contract-version.test.ts`);
    - the live-end-to-end smoke against Azure
      (`src/test-intelligence/production-runner.live-e2e.test.ts`,
      nightly + on-demand via GitHub Actions, see
      `.github/workflows/test-intelligence-live-e2e.yml`);
    - the smoke-compile gate (`pnpm test:smoke:compile`).

    This satisfies the spirit of Art. 31's "regular testing" mandate;
    operators must confirm the cadence meets their internal testing
    policy.

---

## 6. Open items / residual risk

- **Figma file content**: the runner trusts that the operator's
  Figma files do not contain personal data. There is no automated
  PII scrub of design text content beyond the visual sidecar's
  best-effort flag. Operators with strict PII-minimization
  requirements should establish a manual review step before
  ingestion.
- **Model provider data flows**: the Azure AI Foundry gateway is
  the model-side trust boundary. Workspace-dev does not see what
  the gateway does with prompts beyond its API contract. Operators
  must verify their gateway's data-retention and training-opt-out
  posture independently.
- **Replay cache**: not yet enabled in the production runner
  (Issue #1739). Once enabled, the cache key derivation must
  preserve the same token-scope isolation as the MCP resolver
  cache.

---

## 7. Document control

- Document owner: workspace-dev maintainers.
- Last reviewed: 2026-05-02.
- Triggers for re-review: any change to the URL-ingestion flow, the
  FinOps envelope, the SSRF guard, or the third-party dependency
  list. The contract-version snapshot test catches changes to the
  shipped envelope; reviewers should check this DPIA when bumping
  the contract version.
