# DORA Mapping — Multi-Source Test Intelligence Surface (Wave 4)

**Scope:** DORA (Digital Operational Resilience Act) Article mapping for the
Wave 4 multi-source test-intelligence ingestion surface. This document is the
Wave 4 extension of the top-level DORA control mapping in `COMPLIANCE.md`.

**Regulation:** REGULATION (EU) 2022/2554 (DORA), applicable to EU financial
entities and their ICT third-party service providers.

**Last reviewed:** 2026-04-27

---

## 1. Multi-source surface summary

Wave 4 extends the test-intelligence subsurface with three new data ingestion
paths:

| Source kind                         | Description                                           | Wave     |
| ----------------------------------- | ----------------------------------------------------- | -------- |
| `jira_rest`                         | Jira REST API (Cloud / Data Center / OAuth 2.0)       | Wave 4.C |
| `jira_paste`                        | Paste-only Jira ingestion for air-gapped environments | Wave 4.D |
| `custom_text` / `custom_structured` | Reviewer-supplied Markdown and structured attributes  | Wave 4.E |

All three paths are guarded by the dual feature gate
(`FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE` +
`FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE`) and require
`llmCodegenMode=deterministic`. The gate fails closed before any source
artifact is persisted.

---

## 2. Article 6 — ICT risk management framework

**Obligation:** Financial entities must have a comprehensive ICT risk
management framework that identifies, classifies, and manages ICT risks.

| Control                  | Implementation                                                                                                                                                                       | Evidence                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Mode-lock isolation      | Multi-source gate is strictly nested behind the parent test-intelligence gate; neither gate affects `ALLOWED_LLM_CODEGEN_MODES` or the deterministic code-generation pipeline        | `src/test-intelligence/multi-source-envelope.ts` — `enforceMultiSourceModeGate`                     |
| Fail-closed gate         | Any missing or disabled predicate (parent gate, multi-source env, multi-source startup option, `llmCodegenMode`) fails closed with zero side effects; structured diagnostic returned | `ALLOWED_MULTI_SOURCE_MODE_GATE_REFUSAL_CODES`                                                      |
| Bounded resource usage   | All Jira API calls, paste bytes, and custom-context bytes are capped per job; caps are `const`-exported runtime values                                                               | `MAX_JIRA_API_REQUESTS_PER_JOB`, `MAX_JIRA_PASTE_BYTES_PER_JOB`, `MAX_CUSTOM_CONTEXT_BYTES_PER_JOB` |
| Air-gap compliance       | Paste-only mode operates without outbound Jira API calls; all processing is local; `pnpm run test:ti-eval` performs no outbound network calls                                        | `docs/runbooks/multi-source-air-gap.md`                                                             |
| Zero-telemetry invariant | No telemetry SDKs, no outbound `fetch` to non-local hosts, no `sendBeacon` or `WebSocket` to telemetry-shaped URLs in any Wave 4 module                                              | `lint:no-telemetry` CI gate                                                                         |

---

## 3. Article 8 — ICT-related incident classification

**Obligation:** Financial entities must classify ICT-related incidents according
to their impact on operations, data integrity, and service continuity.

| Control                        | Implementation                                                                                                                                                          | Evidence                                                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Structured refusal codes       | All validation failures are emitted as typed `refusalCode` values, not free-form error strings, so monitoring systems can classify incidents without string parsing     | `ALLOWED_MULTI_SOURCE_ENVELOPE_REFUSAL_CODES`, `ALLOWED_JIRA_IR_REFUSAL_CODES`, `ALLOWED_MULTI_SOURCE_MODE_GATE_REFUSAL_CODES` |
| Fail-closed on every gate miss | Gate failures write no artifacts and return a deterministic code; callers cannot proceed past a gate failure                                                            | `enforceMultiSourceModeGate` throws `MultiSourceModeGateError`                                                                 |
| Paste collision detection      | Duplicate `canonicalIssueKey` between a `jira_rest` and `jira_paste` source is detected and surfaced as `duplicate_jira_paste_collision` before any artifact is written | `validateMultiSourceTestIntentEnvelope`                                                                                        |
| Evidence manifest              | Every job emits a `wave1-poc-evidence-manifest.json` (or Wave 4 equivalent) with SHA-256 hashes for every persisted artifact; tampering can be detected post-incident   | `verifyWave1PocEvidenceManifest`                                                                                               |

---

## 4. Article 9 — Digital operational resilience testing

**Obligation:** Financial entities must maintain and regularly test ICT
continuity measures, including business continuity plans covering ICT systems.

| Control                | Implementation                                                                                                                                                                                | Evidence                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Deterministic CI gate  | `pnpm run test:ti-eval` runs the full Wave 4 production-readiness harness with deterministic mock gateways (no outbound calls); green gate required before merge                              | `.github/workflows/dev-quality-gate.yml`                                           |
| Paste-only fallback    | When Jira REST API is unavailable, reviewers can manually paste Jira content via the Inspector UI; the paste-only path produces identical IR artifacts                                        | `docs/runbooks/multi-source-air-gap.md`                                            |
| Backward compatibility | Wave 1 single-source Figma-only jobs continue to work unchanged when the multi-source gate is disabled; no migration required                                                                 | `COMPATIBILITY.md` multi-source matrix; `multi-source-envelope.backcompat.test.ts` |
| Replay determinism     | Identical inputs always produce byte-identical artifacts (deterministic canonical JSON, deterministic content hashes); replay is verifiable from the evidence manifest alone                  | `computeAggregateContentHash`, `canonicalJson`                                     |
| Four-eyes continuity   | The four-eyes review policy (Issue #1376) fires on `multi_source_conflict_present` from the conflict-resolution gate, requiring a second reviewer to approve cases flagged by source conflict | `docs/eu-ai-act/human-oversight.md`                                                |

---

## 5. Article 28 — ICT third-party risk management

**Obligation:** Financial entities must manage risk associated with ICT
third-party service providers, including contractual arrangements and register
of information.

The Jira `jira_rest` source kind introduces Atlassian (Jira Cloud) or the
operator's own Jira Data Center instance as an ICT third-party service where
applicable.

### 5.1 Jira as an ICT third-party (Cloud)

When using `jira_rest` against Jira Cloud (`*.atlassian.net`):

| DORA requirement        | Implementation / Operator action                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Contractual arrangement | Operator must maintain a written agreement with Atlassian covering the use of the Jira REST API for this workflow                            |
| Service description     | Jira REST API v3 is used exclusively; no other Atlassian services are called by this package                                                 |
| Sub-processor mapping   | Operator must map Atlassian's own sub-processors as required by Art. 28(3)                                                                   |
| Data residency          | Operator must verify their Jira Cloud instance's data residency configuration aligns with their ICT risk policy                              |
| Token rotation          | Operator is responsible for rotating API tokens or OAuth 2.0 credentials on their defined cadence (see `docs/runbooks/jira-source-setup.md`) |
| Business continuity     | If Jira Cloud is unavailable, the paste-only fallback (`jira_paste`) provides continuity for the test-intelligence workflow                  |

### 5.2 Jira Data Center (self-hosted)

When using `jira_rest` against a self-hosted Jira Data Center instance:

- The Jira Data Center is typically under the financial entity's own control
  and may not require a separate ICT third-party register entry.
- The operator must still apply the same credential governance (token rotation,
  SSRF allow-list, least-privilege scopes) as for Jira Cloud.
- Network egress from the workspace-dev process must be whitelisted to the
  Jira Data Center host; all other hosts are rejected by the SSRF guard.

### 5.3 Register of information template entry

For the Jira Cloud case, a minimal register-of-information entry (per DORA
Art. 28(3)(a)):

```
ICT third-party provider:    Atlassian Network Services, Inc.
Service description:         Jira Cloud REST API v3 (issue read access)
Function supported:          Multi-source test-intent ingestion for QA test-case generation
Contractual arrangement:     Atlassian Cloud Terms of Service / Enterprise agreement
Criticality classification:  Supporting (test-intelligence is opt-in; paste-only fallback available)
Data categories:             Issue summaries, descriptions, acceptance criteria, comments (opt-in),
                             attachment metadata (opt-in), linked issue keys (opt-in), custom fields (opt-in)
                             — all PII-redacted before persistence
Subcontracting:              Refer to Atlassian sub-processor list at trust.atlassian.com
Exit plan:                   Switch to jira_paste (paste-only) mode; no Jira API dependency
Token rotation cadence:      [operator-defined — see jira-source-setup.md]
SSRF guard:                  Host allow-list enforced by workspace-dev; no call outside the configured host
```

### 5.4 LLM gateway as ICT third-party

The multi-source surface does not add new LLM deployments. The
operator-supplied LLM gateway (`gpt-oss-120b` for test-case generation) is
already addressed in the baseline DORA mapping in `COMPLIANCE.md`.

---

## 6. Reconciliation and conflict-resolution gate

Wave 4 introduces source reconciliation (Wave 4.F) for jobs that have both
Figma and Jira sources. The reconciliation outcome:

- `resolved` — sources agree; no human intervention required.
- `conflict_present` — sources disagree; the conflict resolution policy
  (`priority`, `reviewer_decides`, or `keep_both`) determines the next step.
- `conflict_present` with `reviewer_decides` policy — the four-eyes review
  trigger fires, requiring a second reviewer.

The conflict-resolution report is persisted as
`multi-source-conflict-report.json` and the reconciliation report as
`multi-source-reconciliation-report.json` under the job's artifact directory.
These records are part of the DORA Art. 9 testing evidence.

---

## 7. Supply-chain integrity for the multi-source surface

| Control                    | Implementation                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Zero runtime dependencies  | Wave 4 modules add no new npm runtime dependencies; all validators are hand-rolled                                | `lint:boundaries` CI gate                  |
| SBOM coverage              | The `sbom:*` scripts cover the full published package; no new external packages                                   | `artifacts/sbom/workspace-dev.cdx.json`    |
| Provenance-enabled publish | The CI publish path uses OIDC trusted publishing with npm provenance; Wave 4 does not change the publish boundary | `.github/workflows/changesets-release.yml` |

---

## 8. See also

- `COMPLIANCE.md` — top-level DORA control mapping
- `docs/dpia/jira-source.md` — GDPR DPIA addendum for the Jira source
- `docs/dpia/custom-context-source.md` — GDPR DPIA addendum for the custom context source
- `docs/runbooks/jira-source-setup.md` — Jira token setup and rotation
- `docs/runbooks/multi-source-air-gap.md` — paste-only deployment guide
- `docs/eu-ai-act/human-oversight.md` — EU AI Act Art. 14 human oversight mapping
- `THREAT_MODEL.md` — package-scoped threat model
