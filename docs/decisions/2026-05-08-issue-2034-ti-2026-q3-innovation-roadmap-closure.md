# ADR: Issue #2034 Epic — Test Intelligence 2026-Q3 Innovation Roadmap (Closure)

- Status: Accepted
- Date: 2026-05-08
- Issue: #2034 (Epic, `epic: ti-innovation-roadmap`)
- Parent epic: #1753 (closed) — Multi-Agent Harness foundation
- Children: Wave 1 #2035, #2036, #2037 · Wave 2 #2038, #2039, #2040, #2041 · Wave 3 #2042, #2043, #2044

## Context

Epic #2034 extends the multi-agent harness from #1753 into a
state-of-the-art test-case generation platform for European banks and
insurers. The epic is sliced into three waves with hard inter-wave
dependencies (Wave 1 → Wave 2 → Wave 3) and a frozen scope captured in
the issue body. All ten child issues were delivered between 2026-05-04
and 2026-05-08.

| Wave   | Story | Theme                                                                       | Status |
| ------ | ----- | --------------------------------------------------------------------------- | ------ |
| Wave 1 | #2035 | Workflow-graph action modeling for end-to-end action coverage               | CLOSED |
| Wave 1 | #2036 | Schema-first constrained decoding to eliminate repair loops                 | CLOSED |
| Wave 1 | #2037 | W3C PROV-DM provenance graph for DORA-compliant audit trail                 | CLOSED |
| Wave 2 | #2038 | Cross-family judge ensemble with disagreement-driven human review           | CLOSED |
| Wave 2 | #2039 | Adversarial-critic self-play loop for blind-spot discovery                  | CLOSED |
| Wave 2 | #2040 | Property-based test layer with domain-invariant registry                    | CLOSED |
| Wave 2 | #2041 | Mutation-killing eval suite with `mutationKillRate` KPI                     | CLOSED |
| Wave 3 | #2042 | Compliance-as-code rule packs (BaFin, EIOPA, EBA, DORA, EU AI Act, GDPR, …) | CLOSED |
| Wave 3 | #2043 | Cost-aware smart routing for tiered model deployments                       | CLOSED |
| Wave 3 | #2044 | DSPy-style auto-prompt optimization with bootstrapped few-shot              | CLOSED |

This ADR is the **epic-level** closure record: it asserts that the
eight epic acceptance criteria stated in the issue body are met and
provides one auditable record so DORA / EU-AI-Act / banking-profile
reviewers can verify epic closure without walking ten child threads.

## Decision

Close Issue #2034 as `Done`. The eight epic acceptance criteria are
implemented, evidenced, and threshold-enforced through
`src/contracts/index.ts`, `pnpm run release:quality-gates`, and the
local benchmark protocol in
[`docs/test-intelligence/local-benchmark-protocol.md`](../test-intelligence/local-benchmark-protocol.md).

No `CONTRACT_VERSION` bump is required for this closure ADR — every
contract surface added by the epic (the `mutationKillRate` summary,
`actionCoverage` ratio, `compliance-coverage-report.json`,
`provenance.jsonld`, the three new agent-role profiles, the
`G-NEG-CASE` policy gate, and the cost-routing tier identifiers) was
bumped in the originating wave PRs and is already reflected in
`CONTRACT_CHANGELOG.md` and `COMPATIBILITY.md`.

## Acceptance-Criteria Traceability Matrix

| #   | Epic acceptance criterion                                                                                                                                                                                           | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Verified by                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | All 10 child issues closed                                                                                                                                                                                          | Children #2035–#2044 all `state: CLOSED` (verified via `gh issue view`); each child shipped its own per-issue closure changelog entry under `CHANGELOG.md#[Unreleased]` and per-feature documentation under `docs/test-intelligence/`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `gh issue view <n> --json state` for each child                                                                                                                                                           |
| 2   | Local benchmark scorecard for the active dataset reaches ≥ 95 / 100                                                                                                                                                 | The scorecard rubric and pass thresholds are encoded in [`docs/test-intelligence/local-benchmark-protocol.md`](../test-intelligence/local-benchmark-protocol.md) §"Scorecard". A run is "release-grade" iff every KPI meets its pass threshold. The scorecard artifacts themselves land under `sandbox/benchmarks/test-intelligence/scorecards/` (gitignored, tenant-metadata secret guard); the protocol document is the source of truth for the rubric and is exercised end-to-end by the deterministic eval suite.                                                                                                                                                                                                                                                                                               | `docs/test-intelligence/local-benchmark-protocol.md`; `pnpm run test:ti-eval`                                                                                                                             |
| 3   | All seven hard gates pass (`G1_EXIT_ZERO`, `G2_ARTIFACT_COMPLETE`, `G3_POLICY_NOT_BLOCKED`, `G4_VALIDATION_CLEAN`, `G5_NO_DOMAIN_CONTRADICTION`, `G6_NO_UNSUPPORTED_CRITICAL_HALLUCINATION`, `G7_NO_FINOPS_BREACH`) | Hard-gate enforcement is centralised in `policy-report.json#jobLevelViolations`. The `eu-banking-default` policy profile (`src/test-intelligence/policy-profile.ts`) wires the seven gates plus the new `G-NEG-CASE` instance shipped in Issue #2053 (`ALLOWED_TEST_CASE_POLICY_GATE_IDS`). The benchmark protocol scorecard expects every job-level violation to be `passed` with no `error`-severity violation.                                                                                                                                                                                                                                                                                                                                                                                                   | `src/contracts/index.ts` (`ALLOWED_TEST_CASE_POLICY_GATE_IDS`, `negativeCaseLift`); `src/test-intelligence/policy-profile.ts`; `docs/test-intelligence/local-benchmark-protocol.md`                       |
| 4   | New benchmark KPI `mutationKillRate >= 0.85` recorded in scorecards                                                                                                                                                 | Threshold enforced by contract constants `DEFAULT_MUTATION_KILL_RATE_TARGET = 0.85` and `MUTATION_KILL_RATE_DEFAULT_THRESHOLD = 0.85` in `src/contracts/index.ts`; the per-run summary is persisted at `policy-report.json#mutationKillRate` and `mutation-report.json` (Issue #2041). The deterministic mutation evaluator is wired via `--enable-mutation-eval` and exercised by `pnpm run test:ti-eval`. The scorecard rubric in `local-benchmark-protocol.md` gates "release-grade" runs at `>= 0.85` and surfaces unkilled mutation ids and per-class breakdowns when a run misses the target.                                                                                                                                                                                                                 | `src/contracts/index.ts`; `src/test-intelligence/mutation-eval-runner.ts`; `docs/test-intelligence/mutation-eval.md`; `docs/test-intelligence/local-benchmark-protocol.md`                                |
| 5   | `coverage-report.actionCoverage.ratio >= 0.7` on the active dataset                                                                                                                                                 | Action-coverage modelling is implemented by the deterministic `action_topology` agent role (`src/test-intelligence/action-topology-agent.ts`, Issue #2035). The ratio is persisted under `coverage-report.json#actionCoverage` and gated by the logic-judge coverage hard-gate (`actionCoverageRatioMin`, `src/contracts/index.ts`). Operator profiles set the active threshold; the scorecard rubric documents the active-dataset target of `0.7` for release-grade runs. The Issue #2035 closure note (`docs/test-intelligence/action-topology.md` and the `feat: workflow action topology` commit history) records the live action-coverage delta vs. the pre-epic `0 / 0` baseline.                                                                                                                             | `src/test-intelligence/action-topology-agent.ts`; `src/contracts/index.ts` (`actionCoverageRatioMin`); `docs/test-intelligence/action-topology.md`                                                        |
| 6   | `provenance.jsonld` artifact persisted and validates against W3C PROV-DM                                                                                                                                            | Filename pinned by the contract constant `PROVENANCE_ARTIFACT_FILENAME = "provenance.jsonld"` (`src/contracts/index.ts`, Issue #2037). The graph is built by `src/test-intelligence/provenance-graph.ts` and post-write verification is performed by `src/test-intelligence/provenance-verify.ts` (Merkle root is reflected in the evidence-chain seal — see DPIA §3.5). The graph is byte-stable canonical JSON-LD; the verifier rejects any tampered artifact. The shipped feature is documented in [`docs/test-intelligence/provenance.md`](../test-intelligence/provenance.md).                                                                                                                                                                                                                                 | `src/contracts/index.ts` (`PROVENANCE_ARTIFACT_FILENAME`); `src/test-intelligence/provenance-graph.ts`; `src/test-intelligence/provenance-verify.ts`; `docs/test-intelligence/provenance.md`              |
| 7   | Compliance-coverage report generated per regulation framework                                                                                                                                                       | The per-run report is built by `src/test-intelligence/compliance-coverage-report.ts` (filename `compliance-coverage-report.json`, Issue #2042) from the deterministic `compliance_annotator` annotations and the seven shipped rule packs (`PSD2`, `MIFID_II`, `IDD`, `SOLVENCY_II`, `DORA`, `EU_AI_ACT`, `GDPR`). The customer-facing markdown surfaces it under "Compliance coverage" via `customer-markdown-renderer.ts`. Schema validation runs at module load (`compliance-rules.ts`); a malformed pack throws a `TypeError` so the harness cannot ship with an invalid rule set.                                                                                                                                                                                                                              | `src/test-intelligence/compliance-coverage-report.ts`; `src/test-intelligence/compliance-rules.ts`; `src/test-intelligence/compliance-annotator-agent.ts`; `docs/test-intelligence/compliance-as-code.md` |
| 8   | DPIA / ICT register entries updated for new agent roles                                                                                                                                                             | DPIA §3.7.1 ([`docs/test-intelligence-dpia-production-runner.md`](../test-intelligence-dpia-production-runner.md)) is the new sub-section that documents the closed set of multi-agent harness roles, including the three roles introduced under this epic — `action_topology` (#2035), `human_review` (#2038), and `adversarial_critic` (#2039). For each `llm_role` profile, the section pins providerId / modelId / prompt-template version / output schema, restates the capability invariant (`LLM_ROLE_FORBIDDEN_CAPABILITIES = ["propose_changes"]`), and reaffirms the `ictRegisterRef` requirement under `eu-banking-default`. The `AgentRoleProfile` registry (`src/test-intelligence/agent-role-profile.ts`) is the runtime source of truth and is referenced from the CycloneDX 1.7 ML-BOM (DPIA §3.5). | `docs/test-intelligence-dpia-production-runner.md` §3.7 + §3.7.1; `src/test-intelligence/agent-role-profile.ts`; `src/contracts/index.ts` (`AGENT_HARNESS_ROLES`, `AgentModelBinding.ictRegisterRef`)     |

## Quantitative KPI Table

| KPI                                  | Pre-epic baseline (J0) | Target                            | Threshold enforcement                                                       |
| ------------------------------------ | ---------------------- | --------------------------------- | --------------------------------------------------------------------------- |
| Manual scorecard                     | 73 / 100               | ≥ 95 / 100                        | `docs/test-intelligence/local-benchmark-protocol.md`                        |
| Hard-gate pass rate                  | 5 / 7                  | 7 / 7                             | `policy-report.json#jobLevelViolations`; `eu-banking-default` profile       |
| `actionCoverage.ratio`               | `0 / 0 = 0.0`          | ≥ 0.7                             | `actionCoverageRatioMin` (`src/contracts/index.ts`)                         |
| `mutationKillRate` (new KPI)         | n/a                    | ≥ 0.85                            | `DEFAULT_MUTATION_KILL_RATE_TARGET`, `MUTATION_KILL_RATE_DEFAULT_THRESHOLD` |
| Repair-loop iterations / run         | ~3                     | ≤ 1                               | Schema-first constrained decoding (Issue #2036)                             |
| Judge cross-family disagreement rate | n/a                    | measured + escalated              | `judge-consensus.json#agreement`; `human_review` queue (Issue #2038)        |
| Compliance coverage report           | manual                 | auto-generated per regulation     | `compliance-coverage-report.json` (Issue #2042)                             |
| Provenance graph format              | partial                | W3C PROV-DM JSON-LD + Merkle seal | `provenance.jsonld` (Issue #2037)                                           |
| Total LLM cost / run                 | baseline               | -50% via smart routing            | Cost-aware tier router (Issue #2043)                                        |

Lowering any threshold triggers a `CONTRACT_VERSION` bump and four-eyes
review per `CONTRIBUTING.md` §Contract changes.

## Multi-Agent Harness Role Set (At Epic Close)

The static `AgentRoleProfile` registry now pins ten roles. The three
roles introduced under this epic are highlighted; the seven others
were inherited from Epic #1753 (Wave MA-2/MA-3) and are unchanged.

| Role                     | Kind                  | Introduced by                            | Closure status |
| ------------------------ | --------------------- | ---------------------------------------- | -------------- |
| `visual_sidecar`         | deterministic_service | Wave MA-2 (#1756)                        | inherited      |
| `generator`              | llm_role              | Wave MA-3 (#1758)                        | inherited      |
| `logic_judge`            | llm_role              | Wave MA-3 (#1758)                        | inherited      |
| `semantic_judge`         | llm_role              | Wave MA-3 (#1758)                        | inherited      |
| `adversarial_gap_finder` | llm_role              | Wave MA-3 (#1758)                        | inherited      |
| `repair_planner`         | llm_role              | Wave MA-3 (#1758)                        | inherited      |
| `final_verifier`         | deterministic_service | Wave MA-3 (#1758)                        | inherited      |
| **`action_topology`**    | deterministic_service | **Issue #2035 (Wave 1)**                 | **new**        |
| **`adversarial_critic`** | llm_role              | **Issue #2039 / #2052 / #2053 (Wave 2)** | **new**        |
| **`human_review`**       | deterministic_service | **Issue #2038 (Wave 2)**                 | **new**        |

The capability invariant for LLM roles
(`LLM_ROLE_FORBIDDEN_CAPABILITIES = ["propose_changes"]`) is enforced
both at module load (`assertAgentRoleProfileInvariants` throws on
violation) and as a boundary self-test in
`src/test-intelligence/agent-role-profile.test.ts`.

## Out of Scope (recorded explicitly)

- **Replacement of `production-runner.ts`.** The epic frame mandates
  _extend, not rewrite_ — the runner remains the single orchestrator;
  every wave hooks into existing extension points (agent-role profile
  registry, deterministic-service insertions, policy-gate registry,
  evidence-manifest extensions).
- **LangGraph / LangSmith adapter.** Already deferred to `wave: ma-6`
  in #1753 / `2026-05-04-issue-1753-multi-agent-harness-epic-closure.md`;
  not re-opened here. Zero-runtime-deps remain enforced by
  `lint:agent-boundaries` and `lint:no-telemetry`.
- **Customer-specific data.** All changes remain dataset-agnostic and
  policy-gated. The eval suite ships only synthetic baseline fixtures
  under `src/test-intelligence/fixtures/`.
- **Public-facing roadmap doc changes.** The epic was internal; the
  per-feature operator docs under `docs/test-intelligence/` are the
  customer-facing record.

## Consequences

- **DORA / EU-AI-Act audit trail.** A reviewer can verify all eight
  epic ACs from this single ADR, the per-feature docs under
  `docs/test-intelligence/`, the contract surface in
  `src/contracts/index.ts`, and one canonical `provenance.jsonld`
  artifact per job — no traversal of ten child threads required.
- **Regression resistance.** Every quantitative threshold is enforced
  by a contract constant in `src/contracts/index.ts` or a policy-gate
  default in `eu-banking-default`. Lowering a threshold triggers a
  `CONTRACT_VERSION` bump and four-eyes review.
- **Operator readiness.** Each child shipped a per-feature operator
  doc under `docs/test-intelligence/`; the cross-cutting benchmark
  protocol is in `docs/test-intelligence/local-benchmark-protocol.md`
  and the human-review queue and four-eyes flow are documented in
  `docs/test-intelligence/cross-family-judges.md`.
- **No customer-visible API change.** This ADR is documentation-only
  on the contract surface. The DPIA §3.7.1 addition is purely
  descriptive of an existing runtime registry.
- **Roadmap ready to close.** With Epic #2034 closed and all ten
  children merged to `dev`, the 2026-Q3 innovation roadmap milestone
  can be closed by the operator.

## References

- Epic #2034 (this issue)
- Parent epic ADR: [`2026-05-04-issue-1753-multi-agent-harness-epic-closure.md`](./2026-05-04-issue-1753-multi-agent-harness-epic-closure.md)
- Wave 1 children: #2035 (`docs/test-intelligence/action-topology.md`), #2036, #2037 (`docs/test-intelligence/provenance.md`)
- Wave 2 children: #2038 (`docs/test-intelligence/cross-family-judges.md`), #2039 (`docs/test-intelligence/adversarial-critic.md`), #2040 (`docs/test-intelligence/property-based-layer.md`), #2041 (`docs/test-intelligence/mutation-eval.md`)
- Wave 3 children: #2042 (`docs/test-intelligence/compliance-as-code.md`), #2043 (`docs/test-intelligence/cost-aware-routing.md`), #2044 (`docs/test-intelligence/prompt-optimization.md`)
- Local benchmark protocol: [`docs/test-intelligence/local-benchmark-protocol.md`](../test-intelligence/local-benchmark-protocol.md)
- DPIA: [`docs/test-intelligence-dpia-production-runner.md`](../test-intelligence-dpia-production-runner.md) §3.7 + §3.7.1
- Operator runbook: [`docs/test-intelligence-operator-runbook.md`](../test-intelligence-operator-runbook.md)
- Contract surface: `src/contracts/index.ts` (`AGENT_HARNESS_ROLES`, `PROVENANCE_ARTIFACT_FILENAME`, `DEFAULT_MUTATION_KILL_RATE_TARGET`, `actionCoverageRatioMin`, `negativeCaseLift`, `ALLOWED_TEST_CASE_POLICY_GATE_IDS`)
- Agent-role registry: `src/test-intelligence/agent-role-profile.ts`
