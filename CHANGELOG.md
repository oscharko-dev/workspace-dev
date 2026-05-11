# Changelog

## 1.1.0

### Minor Changes

- 1d08421: Introduce opt-in Figma-to-QC test case contract surface for Issue #1360.
  - Add `WorkspaceJobType` discriminator with values `"figma_to_code"` (default) and `"figma_to_qc_test_cases"`.
  - Add `WorkspaceTestIntelligenceMode` namespace (`"deterministic_llm" | "offline_eval" | "dry_run"`) isolated from `llmCodegenMode`.
  - Add `WorkspaceStartOptions.testIntelligence?: { enabled: boolean }` startup feature gate.
  - Add `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1` environment gate.
  - `POST /workspace/submit` with `jobType="figma_to_qc_test_cases"` fails closed with `503 FEATURE_DISABLED` unless both gates are enabled.
  - Export contract/schema/prompt-template version constants for the new surface.
  - `llmCodegenMode=deterministic` mode-lock is unchanged and remains isolated.

- a8e6e56: Add Business Test Intent IR derivation and PII redaction for Issue #1361.
  - Export `BusinessTestIntentIr` and supporting types (contracts 3.19.0).
  - Add pure `deriveBusinessTestIntentIr`, `detectPii`, `redactPii`, and `reconcileSources` helpers under `src/test-intelligence/`.
  - Add `businessTestIntentIr` artifact key and `WorkspaceJobArtifacts.businessTestIntentIrFile` for persisting the derived IR.
  - Golden fixture + tests cover IBAN, PAN, email, phone, full-name, and Steuer-ID redaction with trace refs.

- 322e215: Add prompt compiler, generated test case JSON schema, and replay cache for Issue #1362.
  - Export `compilePrompt`, `buildGeneratedTestCaseListJsonSchema`, `validateGeneratedTestCaseList`, `createMemoryReplayCache`, and `createFileSystemReplayCache` from `src/test-intelligence/`.
  - Add `GeneratedTestCase`, `GeneratedTestCaseList`, `CompiledPromptRequest`, `CompiledPromptArtifacts`, `ReplayCacheKey`, and `ReplayCacheEntry` to the public contract surface (contracts 3.20.0).
  - Add `VISUAL_SIDECAR_SCHEMA_VERSION` and `REDACTION_POLICY_VERSION` constants and bind them into the cache key so a sidecar/policy bump always forces a cache miss.
  - Replay cache hits skip the LLM gateway entirely; misses produce a `CompiledPromptRequest` ready for the gateway client.
  - Compiled artifacts persist only redacted material — golden test asserts no original PII can leak through prompt compilation.

- 2099d61: Add test-case validation, policy gate, coverage report, and visual-sidecar gate for Issue #1364.
  - Export `runValidationPipeline`, `runAndPersistValidationPipeline`, `validateGeneratedTestCases`, `evaluatePolicyGate`, `computeCoverageReport`, `detectDuplicateTestCases`, `validateVisualSidecar`, and the `EU_BANKING_DEFAULT_POLICY_PROFILE` from `src/test-intelligence/`.
  - Add the test-case validation, policy, coverage, and visual-sidecar artifact surface to the public contract (contracts 3.23.0): `TEST_CASE_VALIDATION_REPORT_*`, `TEST_CASE_POLICY_REPORT_*`, `TEST_CASE_COVERAGE_REPORT_*`, `VISUAL_SIDECAR_VALIDATION_REPORT_*`, `EU_BANKING_DEFAULT_POLICY_PROFILE_ID`, `EU_BANKING_DEFAULT_POLICY_PROFILE_VERSION`, plus runtime allow-lists and typed shapes for issues, decisions, outcomes, profile rules, coverage buckets, and duplicate pairs.
  - Persist `generated-testcases.json`, `validation-report.json`, `policy-report.json`, `coverage-report.json`, and (when visual input is supplied) `visual-sidecar-validation-report.json` deterministically via canonical JSON + atomic tmp+rename writes.
  - Block downstream review/export when validation finds any error, when the `eu-banking-default` policy gate marks the job blocked (PII in test data, missing trace, missing expected results, QC mapping not exportable, missing accessibility case for form screens, visual-sidecar prompt-injection-like text), or when the visual-sidecar gate is blocked.
  - Golden fixture (`issue-1364.expected.*.json`) covers the simple-form intent through the full pipeline; property tests cover Jaccard symmetry/bounds and duplicate-pair lex ordering.

- aaee47a: Add the optional self-verify rubric pass for Issue #1379.
  - New module `src/test-intelligence/self-verify-rubric.ts` with `runSelfVerifyRubricPass`, hand-rolled rubric response schema, dimension + visual-subscore aggregation, secret-redacted refusal classification, and a dedicated rubric replay cache (`createMemorySelfVerifyRubricReplayCache`, `createFileSystemSelfVerifyRubricReplayCache`) keyed by `passKind: "self_verify_rubric"` so it cannot collide with the test-generation cache.
  - Six rubric dimensions (`schema_conformance`, `source_trace_completeness`, `assumption_open_question_marking`, `expected_result_coverage`, `negative_boundary_presence`, `duplication_flag_consistency`) plus four multimodal visual subscores (`visible_control_coverage`, `state_validation_coverage`, `ambiguity_handling`, `unsupported_visual_claims`) per the 2026-04-24 multimodal addendum.
  - New async `runValidationPipelineWithSelfVerify` / `runAndPersistValidationPipelineWithSelfVerify` entrypoints insert the rubric pass between `testcase.validate` and `testcase.policy`. The synchronous `runValidationPipeline` path stays byte-identical when the opt-in is omitted.
  - Per-job rubric score is mirrored onto `coverage-report.json#rubricScore`; per-case rubric scores live in the new `<runDir>/testcases/self-verify-rubric.json` artifact and `TestCaseQualitySignalRubric[]` projection. The strict generated-test-case JSON schema is intentionally NOT widened, so cached test cases and replay-cache files remain byte-stable.
  - `runWave1Poc` accepts opt-in `selfVerifyRubric: { enabled: true; cache?, mockResponder?, ... }`. Default fixture-only POC runs are byte-identical to the pre-#1379 baseline; when enabled the harness builds a deterministic perfect-score mock client (role `test_generation`, deployment `gpt-oss-120b-mock`) and the resulting `self-verify-rubric.json` is attested by the evidence manifest under category `self_verify_rubric`.
  - `Wave1PocEvalThresholds` gains optional `minJobRubricScore` and `requireRubricPass` fields; the eval gate emits new `min_job_rubric_score` and `rubric_pass_refused` failure rules when those thresholds breach.
  - Rubric prompt + response schema + cache key are hand-rolled per the workspace-dev zero-runtime-deps policy. Refusal messages and rule citations are routed through `redactHighRiskSecrets` + bounded truncation; image inputs are refused at the gateway boundary so the `imagePayloadSentToTestGeneration: false` invariant from #1366 holds across the rubric call too.
  - 47 new tests across `self-verify-rubric.test.ts`, `self-verify-rubric.fuzz.test.ts`, and `validation-pipeline.self-verify.test.ts` covering enabled / disabled, refusal, cache-hit, secret redaction, rubric-prompt determinism, score bounds, missing / duplicate / extra ids, and structurally-invalid skip-the-rubric-pass cases. Wired into `pnpm run test:ti-eval` (367/367 green) plus the property-based suite (31/31).

- 087056c: Add four hard CI gates to `release:quality-gates` (Issue #1801).
  - `mutationKillRate >= 0.85` aggregated across curated mutation fixtures, with per-fixture breach attribution.
  - `promptCacheHitRate >= 0.7` aggregated across repair iterations 2..N, with per-role breach attribution. Roles with zero counted iterations are excluded so a never-repaired role cannot mask a real cache regression.
  - Tamper-detection round-trip: every release-job sample must verify Merkle chain, head-of-chain hash, and ML-BOM hash against the evidence manifest. Any failure (or zero samples) fails the gate.
  - `cacheBreakRate <= 5%` aggregated globally, with the offending `querySource` attributed for diff-artifact review.

  Each gate writes a section of a single canonical-JSON report to `artifacts/release-quality-gates/release-quality-gates.json` (atomic tmp + rename) and the runner exits non-zero on any threshold breach. New runtime constants `RELEASE_QUALITY_GATES_REPORT_ARTIFACT_FILENAME`, `RELEASE_QUALITY_GATES_REPORT_SCHEMA_VERSION`, `RELEASE_QUALITY_GATES_THRESHOLDS`, and `ALLOWED_RELEASE_QUALITY_GATE_IDS` are exported from the package root. `TEST_INTELLIGENCE_CONTRACT_VERSION` bumps from `1.6.0` to `1.7.0`; `CONTRACT_VERSION` bumps from `4.40.0` to `4.41.0`.

- cd54298: Promote customer-supplied markdown to a dedicated `[5] CustomerDomainContext` prompt section for Issue #1941.
  - Move `custom_context_markdown` out of `[7] Findings / RepairInstructions / Iteration Inputs` (now `[8]`) into a new authoritative `[5] CustomerDomainContext` section that signals "customer-supplied banking/insurance domain rules — cite via `figmaTraceRefs (screenId="custom_context_markdown")` or `assumptions/openQuestions` prefixes".
  - Re-number downstream sections so the canonical order is `[1] System Instructions`, `[2] AgentRoleProfile`, `[3] TestDesignModel`, `[4] CoveragePlan`, `[5] CustomerDomainContext` (optional), `[6] Customer Rubric`, `[7] AgentLessons`, `[8] Findings / RepairInstructions / Iteration Inputs`, `[9] Output Schema-Hint`, `[10] RiskPriorities`.
  - Tighten the system-prompt wording so the model treats `[5] CustomerDomainContext` as the authoritative customer source rather than as supporting evidence.
  - Bump `TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION` from `1.2.0` to `1.3.0` so the replay cache picks up the new layout.
  - Mark the customer-domain category as `priority: "required"` (compactible, non-droppable) so the budget analyzer compacts it instead of silently dropping authoritative customer rules.
  - Backwards-compat: when `customContextMarkdown` is absent the `[5]` section is omitted entirely; the structured-attributes payload stays in `[8] Findings`.

- f44d6dd: Add a property-based test layer with a domain-invariant registry for Issue #2040.
  - New `src/test-intelligence/domain-invariant-registry` module exposes the typed DSL (`DomainInvariant` with `{ id, scope, forall, holds, severity, source }`) plus `createInvariantRegistry`, `buildActiveDatasetInvariantRegistry`, `registerActiveDatasetInvariants`, `evaluateInvariants`, and `computeInvariantCoverageRatio`.
  - New `src/test-intelligence/property-sampler` module derives deterministic seed test data from the registry via `fast-check` (`sampleInvariantSeeds`, `findInvariantsMissingSamplerFactory`).
  - The active-dataset registry ships four invariants — `INV-VAT-01` (VAT exclusion), `INV-NETTO-BRUTTO-01` (brutto/netto exclusivity), `INV-OPTIONAL-COST-01` (optional-cost-field semantics), `INV-FINANCING-NEED-01` (financing-need formula bounds).
  - Validation pipeline runs the registry by default; matched cases that fail an invariant produce `domain_invariant_violation` issues and block the run when severity is `error`. Set `invariantRegistry: null` on the pipeline input to opt out.
  - `coverage-report.json` gains optional additive `invariantCoverage` (`total / exercised / ratio / registeredIds / exercisedIds`) and `invariantAnnotations` (per-case `exercises: ["INV-VAT-01", ...]`) fields.
  - Contract version impacts: `CONTRACT_VERSION` 4.53.0 → 4.54.0; `TEST_INTELLIGENCE_CONTRACT_VERSION` 1.14.0 → 1.15.0; both `TEST_CASE_COVERAGE_REPORT_SCHEMA_VERSION` and `TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION` remain `1.0.0`.
  - New unit, property-based, and integration tests for the registry, sampler, and pipeline integration; new docs at `docs/test-intelligence/property-based-layer.md` covering the DSL, the active-dataset invariants, and worked banking + insurance examples.

- 4ef37c5: Add an in-process mutation-killing eval suite with the `mutationKillRate` KPI for Issue #2041.
  - New `src/test-intelligence/mutation-killing-eval` module exposes the typed DSL (`Mutation` with `{ id, mutationClass, description, source, severity, applies, kills }`) plus `createMutationCatalog`, `buildDefaultMutationCatalog`, `registerDefaultMutations`, `evaluateMutationKillingSuite`, `buildMutationKillRateSummary`, `writeMutationReportArtifact`, and `encodeCanonicalReportBytes`.
  - The default catalog ships fifteen first-order mutations covering every class declared in `ALLOWED_MUTATION_CLASSES`: `field-required-flipped`, `vat-applied-to-netto`, `currency-rounding-off-by-one`, `boundary-off-by-one`, `state-transition-skipped`, `regex-relaxed`, `null-equals-empty`, `optional-cost-treated-required`, `currency-locale-confusion`, `error-message-suppressed`, `accessibility-name-removed`, `iban-checksum-skipped`, `pii-redaction-disabled`, `four-eyes-principle-skipped`, `audit-log-omitted`. The synthetic SUT stub is implicit (no real SUT execution) and the evaluator never calls the LLM gateway, so the eval pass consumes no token budget and stays well below the documented `0.20` cap (`MUTATION_EVAL_TOKEN_BUDGET_RATIO_CAP`).
  - The production runner runs the eval after the validation pipeline when `mutationEval.enabled === true`, persists `mutation-report.json` with byte-stable canonical-JSON, embeds the summary into `policy-report.json#mutationKillRate`, and adds the artifact to the Wave-1 evidence manifest. The eval is opt-in (default off for fast iterative runs; on for benchmark runs).
  - New CLI flag `--enable-mutation-eval` (env override `FIGMAPIPE_WORKSPACE_TI_ENABLE_MUTATION_EVAL=1`) plus the inverse `--no-mutation-eval` so benchmark CI lanes can opt in or out without authoring a derived policy profile.
  - New runtime constants exposed: `MUTATION_REPORT_ARTIFACT_FILENAME` (`"mutation-report.json"`), `MUTATION_REPORT_SCHEMA_VERSION` (`"1.0.0"`), `MUTATION_KILL_RATE_DEFAULT_THRESHOLD` (`0.85`), `MUTATION_EVAL_TOKEN_BUDGET_RATIO_CAP` (`0.20`), `ALLOWED_MUTATION_CLASSES`, `ALLOWED_MUTATION_SEVERITIES`.
  - Contract version impacts: `CONTRACT_VERSION` 4.54.0 → 4.55.0; `TEST_INTELLIGENCE_CONTRACT_VERSION` 1.15.0 → 1.16.0; `MUTATION_REPORT_SCHEMA_VERSION` introduced at `"1.0.0"`. All additive — no removals, no renames, no migration-hash impact.
  - New unit tests (catalog DSL, deterministic ordering, kill-rate aggregation, byte-stable artifact, summary projection); new docs at `docs/test-intelligence/mutation-eval.md` and the local benchmark protocol at `docs/test-intelligence/local-benchmark-protocol.md` (relocated from the gitignored `sandbox/` tree referenced in earlier changelog entries).

- bc1429d: Add cost-aware smart routing for tiered model deployments (Issue #2043).
  - New `task_classifier` deterministic-service role that classifies each task into a complexity tier (`tier-low`, `tier-mid`, `tier-high`) based on input signals (`taskKind`, `isRegulatoryInference`, `isCalculationLogic`, `hasVisualInput`, `estimatedInputTokens`, `estimatedOutputTokens`, `constrainedDecodingAvailable`). Heuristic-first per the issue spec; the classifier itself runs zero LLM calls so it sits below the tier-low cost target.
  - New `src/test-intelligence/routing-table.ts` module ships three default routing tables (`eu-banking-default`, `standard-default`, `permissive-default`), each carrying a tier-to-deployment binding for every environment (`dev`, `staging`, `prod`). EU-residency is enforced by `validateEuResidencyConstraint` for the banking profile.
  - New `src/test-intelligence/routing-savings-report.ts` module builds and persists a deterministic, byte-stable pre- vs post-routing FinOps report under `<runDir>/finops/routing-savings-report.json`. `assertRoutingSavingsAtLeast(report, 0.5)` is the CI gate that fails when the realised savings fall below 50%.
  - New `src/test-intelligence/cost-routing-quality-sampler.ts` module ships a deterministic seeded sampler for tier-low decisions plus a regression report that fails CI when the sampled-tier-low regression rate exceeds the configured threshold (default 5%).
  - `agent-participation.json` schema bumped from `1.0.0` to `1.1.0` for the optional `routingDecisions` field. Legacy runs without classification keep their byte-shape because the field is omitted when no decisions are present. `task_classifier` is also added to `AGENT_PARTICIPATION_ROLES` for cost attribution.
  - New runtime exports from `test-intelligence/task-classifier-agent`: `TASK_COMPLEXITY_TIERS`, `TASK_CLASSIFIER_TASK_KINDS`, `TASK_CLASSIFIER_ROLE_ID`, `TASK_CLASSIFIER_VERSION`, `DEFAULT_TIER_LOW_QUALITY_SAMPLE_RATE`, `DEFAULT_TIER_LOW_QUALITY_REGRESSION_THRESHOLD`, plus the typed DSL (`TaskComplexityTier`, `TaskClassifierTaskKind`, `TaskClassificationInput`, `TaskClassificationDecision`).
  - New runtime exports from `test-intelligence/routing-table`: `ROUTING_TABLE_ENVIRONMENTS`, `ROUTING_TABLE_PROFILES`, `ROUTING_TABLE_SCHEMA_VERSION`, `ROUTING_TABLE_REGISTRY`, `EU_BANKING_DEFAULT_ROUTING_TABLE`, `STANDARD_DEFAULT_ROUTING_TABLE`, `PERMISSIVE_DEFAULT_ROUTING_TABLE`, `getDefaultRoutingTable`, `validateRoutingTable`, `validateEuResidencyConstraint`, `resolveRoutingBinding`, `cloneRoutingTable`, `freezeRoutingTableExternal`.
  - New runtime exports from `test-intelligence/routing-savings-report`: `ROUTING_SAVINGS_REPORT_SCHEMA_VERSION`, `ROUTING_SAVINGS_REPORT_ARTIFACT_FILENAME`, `buildRoutingSavingsReport`, `writeRoutingSavingsReport`, `assertRoutingSavingsAtLeast`.
  - New runtime exports from `test-intelligence/cost-routing-quality-sampler`: `ROUTING_QUALITY_REGRESSION_REPORT_SCHEMA_VERSION`, `ROUTING_QUALITY_REGRESSION_REPORT_ARTIFACT_FILENAME`, `ROUTING_QUALITY_DEFAULT_TOLERANCE`, `ROUTING_QUALITY_DEFAULT_THRESHOLD`, `sampleTierLowDecisions`, `evaluateTierLowRegression`, `assertRoutingQualityNotRegressed`.
  - The classifier is implemented as a `deterministic_service` (per the #2042 compliance-annotator pattern) so the multi-agent harness's hard invariants on `AgentHarnessRole` profiles remain unchanged. No `CONTRACT_VERSION` bump is required — every new symbol lives in `src/test-intelligence/`. All additive; no removals, no renames, no migration-hash impact.
  - New unit tests across `task-classifier-agent.test.ts`, `routing-table.test.ts`, `routing-savings-report.test.ts`, `cost-routing-quality-sampler.test.ts`, and `agent-participation.test.ts` (73 tests covering classification rules, routing-table validation, savings calculation, deterministic sampling, regression detection, and persistence). New docs at `docs/test-intelligence/cost-aware-routing.md`.

- 09977ee: Default-on EU banking + insurance domain-invariant catalog for Issue #2108.
  - The `eu-banking-default` validation profile now ships the domain-invariant registry **default-on** with **20 invariants**, up from the four Issue #2040 active-dataset invariants. `buildActiveDatasetInvariantRegistry()` now returns a registry pre-populated with both the Wave-2 active-dataset set and the Issue #2108 EU banking + insurance compliance catalog; the validation pipeline picks it up automatically. Pass `{ invariantRegistry: null }` to opt out, or `{ invariantRegistry: customRegistry }` to override.
  - Added 16 net-new compliance invariants, each carrying a mandatory `legalSource` citation (`{ framework, citation, url? }`) so auditors can trace every predicate back to the article that justifies it: `INV-PSD2-SCA-01`, `INV-PSD2-DYNLINK-01`, `INV-MIFID-SUITAB-01`, `INV-MIFID-APPROP-01`, `INV-MIFID-COSTS-01`, `INV-GWG-PEP-01`, `INV-AML-CUMUL-01`, `INV-DORA-ICT-01`, `INV-GDPR-ART9-01`, `INV-GDPR-ART15-01`, `INV-IDD-DEMANDS-01`, `INV-SOLV2-COOLOFF-01`, `INV-FX-MARGIN-01`, `INV-KYC-AGE-01`, `INV-EAA-KBD-01`, `INV-VAG-BERATUNG-01`.
  - `DomainInvariant` gains an optional `legalSource: { framework; citation; url? }` field. Existing Wave-2 invariants keep their `source` provenance unchanged; the new compliance invariants register with `source: "Issue #2108 (registered)"` and a populated `legalSource`.
  - Compliance invariants gate `forall` on the case's `riskCategory`: only cases the policy gate considers regulated (`regulated_data`, `financial_transaction`, `high`) reach the predicate, with the EAA accessibility invariant additionally accepting `low` so a11y cases on payment screens still surface keyboard-only gaps. This prevents synthesized field-level stubs from triggering false-positive blocks on unrelated screens.
  - Each new invariant ships at least one positive and one negative test fixture in `domain-invariant-registry.test.ts`. The Eingabemasken benchmark (`eingabemasken-fixtures.ts`) gains a new `EINGABEMASKEN_APPLICABLE_INVARIANTS` map and tests that pin the per-fixture invariant set; a regression that hides an invariant from a regulatory mask now fails CI.
  - `docs/test-intelligence/property-based-layer.md` documents the catalog, the legal-source field, the regulated-risk gate, and the per-invariant severity (error for hard regulatory, warning for soft / disclosure).
  - The `issue-1364.expected.coverage-report.json` golden fixture is regenerated to include the new `registeredIds`. No contract-version bump: artifact shapes are unchanged, only the canonical content of the additive `invariantCoverage` block grows with the registry.

- 21013e5: Inter-rater agreement protocol on the judge-calibration gold set for Issue #2109.
  - Every `<id>.gold.json` under `src/test-intelligence/fixtures/judge-calibration/` is re-labeled with a `goldVerdicts` array carrying at least two distinct independent reviewer entries (`reviewer`, `verdict`, `findingCodes`, `rationale`, `timestamp`). The schema parser rejects fewer than `JUDGE_CALIBRATION_MIN_REVIEWERS_PER_CASE` entries, duplicate reviewers, and any inconsistency between the resolved `humanVerdict` and the consensus / adjudication.
  - Adjudication workflow: when the two reviewers disagree on either verdict or finding codes, the case is marked `adjudicated: true` and an `adjudication` block records the arbiter's resolution. The arbiter must be distinct from both original reviewers. The top-level `humanVerdict` / `humanFindingCodes` always reflect the resolved labels (consensus or arbiter call) so the existing calibration math is unchanged.
  - New `src/test-intelligence/inter-rater-agreement.ts` module computes Cohen's κ (Cohen, 1960) per judge type and per judge × scenario class, plus a reviewer-rotation log per judge with each reviewer's fixture-count and share. Pure: identical paired ratings produce byte-identical output (rounded to 1e-6).
  - Runner `scripts/run-judge-calibration-eval.ts` writes the per-run artifact at `storybook-static/eval-reports/judge-calibration-inter-rater-agreement.json` and applies a structured gate: per-judge κ < 0.7 fails CI; κ < 0.8 warns; reviewer share > 0.6 fails; reviewer share > 0.45 warns; per-scenario κ floor is suppressed below 8 paired ratings (Cohen's κ is too unstable to gate against on small N).
  - The `eu-banking-default` calibration set (10 logic + 10 faithfulness fixtures) is rotated across two banking-domain SMEs, one insurance-domain SME, and a senior arbiter, with two adjudicated disagreements (one per judge) so the kappa math actually exercises the gate. Observed κ: logic 0.830508, faithfulness 0.84375 (both ≥ the 0.8 target).
  - `docs/eu-ai-act/human-oversight.md` §3.5 documents the regulatory rationale for Art. 14(4)(a)(b), the schema, the adjudication workflow, the gate severity table, and the artifact path. `docs/test-intelligence-judge-calibration.md` cross-links from the calibration-suite operator docs.
  - New `src/test-intelligence/inter-rater-agreement.test.ts` plus four regression tests in `src/test-intelligence/judge-calibration-eval.test.ts` cover the kappa math (textbook 9/10, perfect, full-disagreement, and degenerate cells), the report builder, the gate severity ladder, the rotation log, the artifact write/read round-trip, and the production-set κ ≥ 0.8 invariant.

- 07d3f5d: Add the cross-field invariant engine for Issue #2110.
  - Introduce `CrossFieldInvariant`, `InvariantExpr` (typed AST: comparison, arithmetic, conditional/implies), `FieldAnchor`, and `InvariantCitation` types in `src/test-intelligence/cross-field-invariant-engine.ts`. The engine is fully deterministic: every node kind has its own discriminant, division-by-zero throws, and the registry validates that every BVA seed round-trips through the evaluator with a matching `expectedSatisfied` verdict and that at least one _non-vacuous_ positive seed is present.
  - Ship a default-on banking + insurance catalog of 23 cross-field invariants (15 banking + 8 insurance) covering DTI, LTV, FATCA, CRS, PSD2 SCA threshold, MiFID II suitability + appropriateness + costs disclosure, daily-limit aggregation, overdraft cap, account-opening age gate, SEPA Instant ceiling, PEP enhanced due diligence, FX margin disclosure, IBAN/currency, IDD demands-and-needs, DMD/Solvency II cooling-off, BU sum-insured ratio, minor-beneficiary guardian gate, KFZ Vollkasko vehicle-age gating, life medical underwriting, and cyber minimum coverage. Every invariant carries a regulatory citation, field anchors for traceability, and BVA seeds (positive + negative).
  - Add the validation-pipeline gate `evaluateCrossFieldInvariantCoverage` (`src/test-intelligence/cross-field-invariant-gate.ts`) which enforces "every screen with ≥ 1 cross-field invariant has ≥ 1 positive AND ≥ 1 negative test-case claim". The gate emits `cross-field-invariant-coverage-report.json` (atomic write) and folds its `blocked` flag into `runValidationPipeline`'s job-level `blocked`.
  - Wire opt-in `crossFieldInvariantRegistry` + `crossFieldInvariantClaims` into `RunValidationPipelineInput`; both forms (`runValidationPipeline` and `runValidationPipelineWithSelfVerify`) pass the gate output through the artifact bundle. The hook is opt-in so existing fixtures stay byte-stable and produce no new blocking.
  - Add an Eingabemasken cross-field benchmark (`cross-field-invariant-benchmark.test.ts`) that synthesises the BVA seeds for every registered invariant, projects them into pipeline-gate claims, and asserts the gate is non-blocking with full per-invariant coverage.

- 4480606: Add the workflow state-machine step-sequence validator for Issue #2111.
  - Introduce `WorkflowStateMachine`, `WorkflowStateMachineState`, `WorkflowStateMachineTransition`, `WorkflowStateMachineRegistry`, and `WorkflowStateMachineIndex` in `src/test-intelligence/workflow-state-machine.ts`. The schema follows the issue acceptance contract (`{ states, transitions: { from, to, guard, action } }`) and the builder rejects empty/duplicate ids, dangling state references, and state machines with no entry state. A factory `buildStateMachineFromWorkflowTopology` derives the state machine 1:1 from a deterministic `WorkflowTopology` (Issues #2072 / #2095): topology states become state-machine states (`entryStates` / `exitStates` propagate as flags), and each topology transition yields a state-machine transition with `actions` joined as the auditor-facing `action` string. Provenance is stamped (`manual`, `workflow-topology`, `manual-override`) so downstream audits can distinguish hand-curated entries from topology-derived ones. The shortest-path search is breadth-first with `transitionId`-sorted edges so reachability output is deterministic.
  - Ship a default-on EU banking + insurance catalog of 12 eingabemasken state machines (`workflow-state-machine-catalog.ts`): login, KYC onboarding, MiFID order, BU antrag, KFZ schaden, GwG screening, anlegerprofil, konto-eroeffnung, kreditantrag-konsumkredit, lebensversicherung-antrag, sepa-ueberweisung, fatca-crs-fragebogen. Each carries explicit `entry`/`terminal` flags, `guard`/`action` audit strings, and ≥ 3 transitions covering happy and rejection branches.
  - Add the per-test-case validator `validateStepSequenceAgainstStateMachine` and the pipeline gate `evaluateWorkflowStateMachineGate` (`workflow-state-machine-validator.ts`). The walker chains consecutive transitions (`step[i].to === step[i+1].from`) and reports the first divergence with the concrete state path that fails to close. Severity matches the issue: `error` for hard infeasibility (`transition_unknown`, `first_step_not_from_entry`, `consecutive_states_unreachable`, `last_state_not_terminal`, `step_indices_out_of_order`, `duplicate_step_index`); `warning` for `missing_intermediate_step` (the gap is bridgeable via ≥ 1 intermediate transition, included in the issue payload). The gate emits `workflow-state-machine-report.json` (atomic write) and folds its `blocked` flag into `runValidationPipeline`'s job-level `blocked`.
  - Wire opt-in `workflowStateMachineRegistry` + `workflowStateMachineCaseClaims` into `RunValidationPipelineInput`; both forms (`runValidationPipeline` and `runValidationPipelineWithSelfVerify`) pass the gate output through the artifact bundle. The hook is opt-in so existing fixtures stay byte-stable and produce no new blocking.
  - Add the eingabemasken benchmark (`workflow-state-machine-benchmark.test.ts`): a hand-curated happy-path corpus exercises every default state machine without firing any error, and an adversarial corpus of eight known-infeasible sequences proves the validator surfaces ≥ 5 with a concrete failing state path (covering `submit before validation`, `navigate before required fields filled`, `skip SCA`, `sign before classification`, `submit before validation verdict`, etc.). Pipeline integration tests assert the gate stays opt-in, persists under the canonical filename, and flips `workflowStateMachineReport.blocked` only on hard-infeasible sequences.

- 464909f: Add the structured ICT-incident classification + escalation hook for Issue #2114 (DORA Art. 10).
  - New typed contract surface in `src/contracts/index.ts`: `IncidentSeverity`, `IncidentCategory`, `IncidentReviewState`, `ManifestRef`, `IncidentEvent`, `IncidentReport`, plus the artifact filename `INCIDENT_REPORT_ARTIFACT_FILENAME = "incidents.json"` and schema-version constant `INCIDENT_REPORT_SCHEMA_VERSION = "1.0.0"`. The category list (`pii_leakage`, `judge_disagreement_persistent`, `drift_alert`, `policy_gate_bypass`, `replay_cache_miss_unexpected`, `subprocessor_outage`, `compliance_rule_pack_violation`) is closed; new categories require a contract-version bump. `IncidentReviewState` adds the pipeline-pause value `"incident_ack_required"` distinct from the per-test-case `ReviewState` so the existing review-gate transition table is unaffected.
  - New pure classifier in `src/test-intelligence/incident-classifier.ts`: `classifyIncidents` derives `IncidentEvent`s from `validationReport × policyReport × testCases × signals` using the Issue #2114 base formula `errorCount × riskWeight × (decisionWeight + 1)` mapped to `low/medium/high/critical`, with categorical bumps that force `pii_leakage` on a `regulated_data` or `financial_transaction` case to `critical`, force `policy_gate_bypass` to `critical`, and force `compliance_rule_pack_violation` on a regulated case to at least `high`. The classifier is fully deterministic (canonical ordering of events by severity desc → category → id) and rejects mismatched job-ids fail-closed. Operator-supplied signals (`drift_alert`, `subprocessor_outage`, `replay_cache_miss_unexpected`, `policy_gate_bypass`) cover categories that are not derivable from validation or policy reports alone. `requiresIncidentAck(report)` is the pause-the-pipeline predicate.
  - New `IncidentSink` interface and default file-system implementation in `src/test-intelligence/incident-sink.ts`. `createFileSystemIncidentSink({ destinationDir })` writes `<destinationDir>/<jobId>/incidents.json` using the same `${path}.${pid}.tmp → rename` atomic-write pattern as the review-store, so a partial write is never observed. Operators may swap in a sink that forwards to PagerDuty / OpsGenie / ServiceNow / internal incident management without modifying the package.
  - New eingabemasken benchmark `incident-eingabemasken-benchmark.test.ts` drives the classifier against every archetype in the EU banking + insurance fixture catalog with the default green-run shape (zero validation errors, all approved, no violations). The benchmark asserts the Issue #2114 acceptance contract verbatim: "with default policy, zero CRITICAL incidents on green run" and `reviewState: "ok"`.
  - New documentation `docs/dora/incident-handling.md` with the DORA Art. 10 mapping (severity rubric, category sources, operator obligations, replay-verifiability, CI gates).

- 87dafa2: Add per-locale Platt-curve calibration stratified by DE-DE, DE-AT, DE-CH, EN-IE, FR-FR, IT-IT for Issue #2117.
  - New `locale` optional field on `BusinessTestIntentScreen` (typed as `SupportedLocale`); wired through `deriveScreens` in `intent-derivation.ts`. Additive: existing callers unaffected.
  - New module `src/test-intelligence/locale-calibration.ts` exporting `SupportedLocale`, `SUPPORTED_LOCALES`, `LOCALE_CALIBRATION_FALLBACK_KEY`, `LocaleCalibrationKey`, `isSupportedLocale`, `deriveLocaleFromScreen`, `deriveLocaleFromBusinessTestIntentScreen`. All functions are pure and deterministic.
  - `CaseConfidenceCurveArtifact` extended with three additive fields: `localeCurves` (per-locale Platt fits; `"default"` key is always the aggregate), `perLocaleEceThreshold` (fixed 0.10, sourced from Issue #2107 criteria), `localeSampleCount`. New exported type `LocaleCurveEntry` with `fallbackToDefault` flag.
  - `LoadCaseConfidenceCalibrationInput` extended with optional `screenLocaleMap`; `LoadedCaseConfidenceCalibration` extended with optional `localeReliabilityArtifactPaths`.
  - Per-locale reliability diagram artifacts written as `case-confidence-reliability-locale-<locale>.json` using the canonical-JSON atomic-write pattern. New exported interface `CaseConfidenceLocaleReliabilityDiagramArtifact`.
  - `applyCaseConfidenceCalibration` accepts optional `screenLocaleMap` and selects the per-locale curve per test case (falls back to default for unseen locales).
  - `DriftMetricObservation` and `DriftFinding` extended with optional `locale?: LocaleCalibrationKey`. `metricKey` updated to include locale dimension (empty string for base observations, keeping existing baselines green). `computeDriftCanaryMetrics` accepts optional `screenLocaleMap` and emits per-locale `brier_score` / `ece` observations. `evaluateDriftReport` propagates locale into `ece_absolute_threshold` findings.
  - Six new calibration fixtures under `fixtures/test-intelligence/per-locale-calibration/` (`DE-AT.figma.json`, `DE-CH.figma.json`, `DE-DE.figma.json`, `EN-IE.figma.json`, `FR-FR.figma.json`, `IT-IT.figma.json`) plus a README.
  - `TEST_INTELLIGENCE_CONTRACT_VERSION` bumped 1.22.0 → 1.23.0. `SupportedLocale` type exported from `src/contracts/index.ts`.

- 4d7fdbd: Add curated adversarial corpus + CI gate for Issue #2122.
  - New top-level catalogue at `fixtures/adversarial-corpus/catalog.json` (versioned `1.0.0`, calendar `version` `2026.05.10`, quarterly review cadence) with 56 entries spanning all 15 categories required by the AC: prompt injection (direct, indirect via Figma / Jira / custom markdown), data exfiltration, instruction-following hijack, role confusion, output-side injection (shell, JNDI, XSS), oracle bypass, ranking manipulation, context stuffing, charset tricks (zero-width, RTL override). Each entry: `{ id, category, payload, expectedOutcome, citation }`. Provenance recorded as `mistral-large-3` design-time generation + SME review.
  - New module `src/test-intelligence/adversarial-corpus.ts` exporting `loadAdversarialCorpus`, `validateAdversarialCorpus`, `runAdversarialCorpusGate`, `loadAndRunAdversarialCorpusGate`, `isAdversarialCorpusReviewOverdue`, `adversarialCorpusCoversAllRequiredCategories`, plus the corpus types and `AdversarialCorpusValidationError`. Pure / deterministic; no model invoked at gate time.
  - New `src/test-intelligence/adversarial-corpus.test.ts` CI gate: shape + coverage invariants, ≥ 50 entries floor, unique ids, deterministic per-entry outcome assertion, review-cadence ordering, validator rejection paths, and a synthetic-mismatch backstop.
  - Additive widening of `untrusted-content-normalizer.ts:ZERO_WIDTH_RE` to also strip Unicode bidirectional override / isolate codepoints (`U+2028`, `U+2029`, `U+202A`–`U+202E`, `U+2066`–`U+2069`). Persisted `zeroWidthCharacters` count name preserved for backwards compatibility.
  - New ADR `docs/decisions/2026-05-10-issue-2122-adversarial-corpus.md` with the full decision record.
  - Additive re-exports from `src/test-intelligence/index.ts`. No public API in `src/index.ts` changes; no `TEST_INTELLIGENCE_CONTRACT_VERSION` bump.

- 96b0fdc: Add semantic equivalence-class verification for generated test cases (Issue #2123).
  - New module `src/test-intelligence/equivalence-class-fingerprint.ts` exporting `buildEquivalenceClassFingerprint`, `equivalenceClassKey`, `deriveOraclePolarity`, `detectIntraClassRedundancy`, `detectExactNearDuplicateText`, and `levenshteinCapped`. The fingerprint is derived from `(coveredFieldIds, coveredActionIds, riskClass, technique, oraclePolarity)` — not text — so two cases that differ in a few characters but cover the same equivalence class are now flagged as redundant within the same technique bucket.
  - Within an equivalence class, a case is required to add real coverage relative to the prior kept set: a different oracle category, a different action subset, or a different state path (trace path / lifecycle transition / step-action sequence). The validator emits `intra_equivalence_class_redundancy` warnings for cases that fail that test.
  - Levenshtein-2 (character-edit distance, capped) is retained as a SEPARATE auxiliary auditor signal: `detectExactNearDuplicateText` flags pairs whose canonicalised `(title, ordered step actions)` differ by ≤ 2 characters, surfaced as `exact_near_duplicate_text` warnings. This is the auxiliary check the AC requires alongside the new equivalence-class verification, not the primary equivalence signal.
  - New optional `IntraClassBoundaryClassifier` hook reserved for the `phi-4-mini-instruct` first-pass route declared in #2099. The hook is consulted only for ambiguous boundary cases AFTER deterministic logic has flagged redundancy and can VETO the verdict by returning `"keep"` — the model can never upgrade a deterministic `keep` to a redundancy warning.
  - New validation issue codes `intra_equivalence_class_redundancy` and `exact_near_duplicate_text` (both `warning` severity) added to `ALLOWED_TEST_CASE_VALIDATION_ISSUE_CODES`.
  - `validateGeneratedTestCasesWithInvariants` now emits the new warnings and surfaces the `IntraClassRedundancyOutcome` (totals, class count, redundancy ratio) on the returned outcome bundle.
  - Eingabemasken benchmark (`equivalence-class-fingerprint.benchmark.test.ts`) asserts the redundancy ratio stays below 5% across all fifteen archetype fixtures.
  - ADR `docs/decisions/2026-05-10-issue-2123-equivalence-class-fingerprint.md`. Additive re-exports from `src/test-intelligence/index.ts`. No `TEST_INTELLIGENCE_CONTRACT_VERSION` bump (additive issue codes only).

- 78ef0b6: Tighten the field-lifecycle state-machine validator scope (Issue #2168).
  - The Issue #2111 validator emitted a blocking `uncovered_field_lifecycle_transition` error for every uncovered transition, over-firing 30–139× per dataset on the M0 multi-dataset benchmark and blocking G4 across the suite. The validator now classifies each transition into one of three tiers and only the `mandatory_negative_path` tier blocks the run.
  - New module `src/test-intelligence/field-lifecycle-transition-tier.ts` exports `classifyFieldLifecycleTransition`, `classifyFieldLifecycleTransitionPair`, `FIELD_LIFECYCLE_TRANSITION_TIER_TABLE`, and `FieldLifecycleTransitionTier`. The classifier is deterministic and table-driven (one row per `(fromState, toState)` pair across the canonical six-state lifecycle, exhaustively asserted at module load).
  - Tier rules: `mandatory_negative_path` covers entry transitions out of `initial` and the `validation_pass` / `validation_fail` outcomes (`in_progress → validated`, `in_progress → error`); `recommended_positive_path` covers positive-path completion (`focused → in_progress`, `validated → terminal`, `error → terminal`, `error → in_progress`, `in_progress → in_progress` / `terminal`, `focused → validated` / `error`); `state_transition_test_only` covers reset/edit/restart edges (e.g., every outgoing edge from `terminal`).
  - New validation issue code `uncovered_field_lifecycle_transition_recommended` (always `warning`) replaces the over-firing `error` for non-mandatory transitions. `state_transition_test_only` transitions stay silent unless the run carries a `technique === "state_transition"` case, in which case they surface as warnings.
  - `coverage-report.json` gains an optional additive `recommendedTransitionCoverage` bucket (`{ total, covered, ratio, uncoveredIds }`) that mirrors the existing `fieldLifecycleCoverage` shape but scoped to the `recommended_positive_path` subset. The field is omitted when the workflow topology declares no recommended-tier transitions, so the byte shape stays stable for legacy runs.
  - Property-based regression coverage (`field-lifecycle-transition-tier.test.ts`, `fast-check`) verifies the load-bearing AC: for any fixture with N fields × M transitions, only the mandatory-tier subset can produce `severity: error`. The Issue #2111 fixture set in `test-case-validation.test.ts` is updated to assert the tier-aware error/warning split (3 mandatory errors, 2 recommended warnings on the canonical IBAN lifecycle) so regressions on the original defect surface still fail.
  - Documentation: `docs/test-intelligence/state-machine-validator.md` describes the tier table, the validator emission contract, and the M0 benchmark that motivated the change. No `TEST_INTELLIGENCE_CONTRACT_VERSION` bump (additive issue code + optional coverage field only).

- 37fdd43: Add human-oversight review queue + decision-capture surface for Issue #2179.
  - New `src/test-intelligence/human-review-queue.ts` module with
    enqueue / fetch / record-verdict / SLA tracking / replay-determinism
    helpers. Verdicts carry detached ed25519 signatures over the
    canonical-JSON serialisation of the verdict body and are verified
    before persistence.
  - New CLI subcommands `workspace-dev test-intelligence review
list|get|decide` for operator-side queue inspection and signed
    verdict capture.
  - New framework-agnostic HTTP route handlers under
    `src/test-intelligence/human-review-http-routes.ts`
    (`GET /api/human-review/queue`, `GET /api/human-review/items/:id`,
    `POST /api/human-review/decisions`).
  - New minimal React UI mounted at `/workspace/ui/human-review`.
  - Audit-dossier (Issue #2175) now bundles `human-review-log.json` when
    present and exposes new EU AI Act Art. 14 + DSGVO Art. 22 regulator-
    coverage rows that reference the per-run human-oversight evidence.
  - New documentation page `docs/test-intelligence/human-oversight.md`
    covering the legal basis (DSGVO Art. 22, EU AI Act Art. 14, DORA
    Art. 28) and the operational flow.
  - `TEST_INTELLIGENCE_CONTRACT_VERSION` bumped `1.28.0` → `1.29.0`;
    `CONTRACT_VERSION` bumped `4.63.0` → `4.64.0`. All changes are
    additive — no existing field, type, or command was removed or
    renamed.

- bb95bcc: Add causal-validation framework (counterfactual test cases via do-calculus) for Issue #2180.
  - New `src/test-intelligence/causal-hypothesis-registry.ts` exposing
    the branded `SemanticFieldId` type, the
    `semanticFieldId(screenId, elementId)` constructor + reader, the
    `CausalHypothesis` / `CausalRelationship` types, and the
    `buildCausalHypothesisRegistry({ invariants, model,
operatorHypotheses })` API that derives hypotheses from the
    registered domain invariants (Issue #2040 + Issue #2108) and merges
    operator-declared hypotheses loaded via `loadOperatorHypotheses`.
  - New `src/test-intelligence/causal-validation-framework.ts` exposing
    the `CounterfactualPair` interface, the deterministic
    `deriveCounterfactualPairs({ cases, invariants, model,
operatorHypotheses?, now, seed })` generator (every value variation
    between pair members is supplied by the deterministic test-data
    oracle from Issue #2071), and the `evaluateCounterfactualPairs`
    aggregator that builds the persisted `CausalValidationReport`.
  - New `causal-validation-report.json` artifact (per-hypothesis
    evaluation + per-pair `CausalValidationPairAudit` rows) and
    `causalCoverage` summary block on `policy-report.json`. The KPI
    carries `hypothesesEvaluated`, `pairsGenerated`, `pairsViolated`,
    and the `causalCoverageRatio` (rounded to six digits, `0` when no
    pairs were generated).
  - The framework operates at the **generation layer** — Issue #2180
    explicitly puts live SUT execution out of scope. `pairsViolated`
    surfaces _harness-side structural defects_ (degenerate
    cause-deltas, drifted projection text), not SUT bugs. Wave-8 will
    add an executor that wires the pairs into a live SUT and substitutes
    runtime effect outcomes for the projected assertion text.
  - FinOps cap exposed as `CAUSAL_VALIDATION_TOKEN_BUDGET_RATIO_CAP`
    (`0.3`). Pair generation is fully deterministic and never calls an
    LLM; under default operation the actual token-cost ratio is `0`.
  - New documentation page `docs/test-intelligence/causal-validation.md`
    describing the do-calculus primer, the hypothesis derivation rules,
    and worked banking + insurance examples (VAT-rate vs financing-need
    for banking; insurance-product change vs cooling-off-period for
    insurance).
  - `TEST_INTELLIGENCE_CONTRACT_VERSION` bumped `1.29.0` → `1.30.0`;
    `CONTRACT_VERSION` bumped `4.64.0` → `4.65.0`. All changes are
    additive — no existing field, type, or command was removed or
    renamed.

- c5efaa4: Add production-grade TMS adapters for Jira Xray, OpenText/HP ALM,
  Tricentis qTest, and Siemens Polarion (Issue #2183, Wave 8).
  - New `src/test-intelligence/tms-adapters/` module exposing the
    provider-neutral `TmsAdapter` contract (`connect`, `validateProject`,
    `mapTestCase`, `pushTestCase`, `pushTestCaseBatch`, `pollSyncStatus`,
    `disconnect`) plus four adapter implementations and a default
    `node:fetch`-backed `TmsHttpClient`.
  - Each adapter handles per-TMS authentication (PAT, OAuth 2.0, Bearer),
    exponential-backoff retry with jitter for transport + rate-limit
    errors (auth + validation errors fail fast), `Idempotency-Key`-based
    dedupe, and TMS-specific schema mapping (folder hierarchy, custom
    fields, test types, priority enums). Default batch size is 50 cases
    per `pushTestCaseBatch`.
  - New CLI subcommand `workspace-dev test-intelligence tms-push
--run-dir <path> --tms <xray|alm|qtest|polarion> --project <id>
[--endpoint <alias>] [--tenant <id>] [--run-id <id>]
[--batch-size <n>] [--dry-run]` that drives the full lifecycle and
    writes a per-run `tms-push-report.json` with per-case verdicts,
    TMS-assigned ids (round-trip evidence), and sanitised failure detail.
  - Per-tenant credentials read from
    `WORKSPACE_TEST_SPACE_TMS_<NAME>_TOKEN` /
    `WORKSPACE_TEST_SPACE_TMS_<NAME>_OAUTH_ACCESS_TOKEN` /
    `WORKSPACE_TEST_SPACE_TMS_<NAME>_BEARER` (NAME ∈ {XRAY, ALM, QTEST,
    POLARION}). The adapters NEVER persist or echo the token, the
    resolved URL, or raw response bodies.
  - Vendored mock TMS servers under `fixtures/tms-adapters/` for
    offline integration testing of every adapter (`startXrayMockServer`,
    `startAlmMockServer`, `startQtestMockServer`,
    `startPolarionMockServer`).
  - Per-adapter operator documentation under
    `docs/test-intelligence/tms-adapters/<adapter>.md` covering
    authentication, endpoint resolution, schema mapping, and failure
    modes.
  - New persisted contract `TmsPushReportArtifact` (schema 1.0.0,
    filename `tms-push-report.json`) plus the `TmsAdapterId` /
    `TmsAuthKind` / `TmsPushVerdict` / `TmsPushRefusalCode` value sets.
  - Polarion's two-protocol surface (REST + WebDAV) is supported via an
    optional `PolarionWebDavClient` injected at adapter construction;
    the default CLI omits WebDAV so attachment writes are skipped
    silently and the per-case verdict still records `pushed`. Operators
    that need attachments must call the adapter from a custom entry
    point.

  Hard invariants on every emitted artifact:
  `rawScreenshotsIncluded: false`, `credentialsIncluded: false`,
  `transferUrlIncluded: false`.

- 675695e: Add BYO-rubric / BYO-guidelines tenant-bundle resolver (Issue #2184,
  Wave 8) so customer banks and insurers can register their own naming
  conventions, compliance house standards, design-system tokens,
  terminology, and customer-eval rubric references without forking the
  harness.
  - New `src/test-intelligence/tenant-bundle.ts` module exposing the
    `TenantBundleInput` schema, a structured parse + canonicalize
    function, the resolver, and a deep-clone-safe merge against the
    active `TestCasePolicyProfile`. The hard
    `TENANT_BUNDLE_OVERRIDE_ALLOW_LIST` is the customer-facing contract
    surface; unknown top-level fields are rejected. Hard
    `TENANT_BUNDLE_SAFETY_FLOORS` invariants stop any future numeric or
    gate-mode override from weakening the base policy profile.
  - New CLI flag `--tenant-bundle <path>` on `test-intelligence run`.
    256 KiB hard cap is stat'd before read; an invalid or
    allow-list-violating bundle aborts with exit code 1 before the LLM
    is dispatched.
  - Production runner emits `tenant-bundle-resolved.json` per run,
    threads the bundle's `terminologyGlossary` into the prompt
    compiler's `[5] CustomerDomainContext` section, and applies the
    bundle's `riskClassTaxonomy[].mode === "review_only"` overrides to
    the base profile's `reviewOnlyRiskCategories`. The override surface
    is intentionally additive only — a customer cannot weaken the base
    policy.
  - Multi-tenant isolation (Issue #2176): the resolver calls
    `assertTenantBundleScope` which throws `TenantIsolationViolation`
    when an active `TenantScope` does not match the bundle's
    `tenantId`. Single-tenant CLI use (no ALS scope) is unaffected.
  - Audit dossier (`audit-dossier.json`) gains an optional
    `customerBundle` summary block and a new `tenant_bundle_resolved`
    artifact kind; the PDF renderer adds a _Customer-Specific
    Configuration_ section when a bundle is present. Legacy runs that
    omit `--tenant-bundle` keep the dossier shape stable.
  - Documentation: `docs/test-intelligence/tenant-bundles.md` with one
    banking and one insurance example bundle, the safety-floor table,
    and the authoring checklist.
  - New `ProductionRunnerFailureClass`: `TENANT_BUNDLE_INVALID` for
    schema, allow-list, safety-floor, and base-profile-mismatch
    failures.

  Backwards-compatible: omitting `--tenant-bundle` runs with the default
  `eu-banking-default` profile, no behaviour change. No regression on
  G1–G7 + G8 + G9 hard gates.

- 8741385: Add a self-service customer-onboarding CLI (Issue #2185, Wave 8) so a
  tier-1 bank's operator can stand up a tenant directory in one command
  instead of requiring half-a-day of operator hand-holding. Closes the
  gating operational scalability bottleneck above ~5 tenants.
  - New `src/test-intelligence/tenant-onboarding.ts` module with
    `runTenantOnboarding` (the provision flow) and
    `runTenantOnboardingDoctor` (the safety-net validator). Pure over
    its inputs and the filesystem; no env-var reads, no network calls,
    no secret material printed.
  - New CLI subcommand
    `pnpm exec tsx src/cli.ts test-intelligence onboard --tenant-id <id> --legal-name <name> --policy-profile <id> --output-root <dir>`
    that lays down `tenant-bundle.json` (W8-2), an empty
    `calibration-corpus/`, three locally-generated signing keys
    (audit-dossier W6-1, region-attestation W6-3, reviewer-signing
    W6-5), `ict-register.json` (DORA Art. 28-conformant), and
    `onboarding-evidence.json` audit trail. Refuses to overwrite an
    existing tenant directory unless `--force`.
  - Doctor subcommand
    `pnpm exec tsx src/cli.ts test-intelligence onboard --doctor --tenant-id <id> --output-root <dir>`
    validates the layout, parses every key, cross-checks public-key
    fingerprints against the ICT register, and refuses tenant-scope
    mismatches as multi-tenant isolation violations (W6-2).
  - Key generation is strictly local via
    `crypto.generateKeyPairSync("ed25519")` and `crypto.randomBytes(32)`;
    private keys are written with mode `0600` and never reprinted by the
    harness. The operator owns key custody from the moment they land on
    disk. (HSM / KMS integration is the W8-5 sovereign-cloud follow-on.)
  - Documentation: `docs/test-intelligence/onboarding.md` — the
    five-minute onboarding walkthrough plus the doctor checklist.
  - Tests: 15 unit tests in
    `src/test-intelligence/tenant-onboarding.test.ts` and
    `src/test-intelligence-onboard-cli.test.ts`; 4 new CLI contract
    tests in `src/cli.contract.test.ts` covering help text, missing
    flags, doctor on a missing tenant, and the
    end-to-end provision-then-doctor handshake.

- 411de94: Add sovereign-cloud / air-gap deployment profile for Issue #2187 (Wave 8).

  DE Sparkassen, Volksbanken, and on-prem-only insurers can now run the
  test-intelligence harness without any internet connectivity to public
  Azure / external LLM endpoints. The standard EU banking compliance gate
  (`eu-banking-default`) is unchanged; the new topology overlay adds:
  - **Policy profile `eu-banking-sovereign`** (id + version distinct from
    default; rule set inherits the full default profile so every Wave 1–7
    hard gate stays in force). `cloneEuBankingSovereignProfile({ allowedHostingRegions })`
    narrows the attested region allow-list to the customer's contract.
  - **`createSovereignLlmGatewayClient`** in `llm-gateway-sovereign.ts` —
    thin wrapper around `createLlmGatewayClient` that pins the `baseUrl`
    host into an air-gap fetch allow-list. Reuses the existing
    circuit-breaker, idempotency, and failure-class taxonomy unchanged.
  - **`WORKSPACE_TEST_SPACE_AIR_GAP_MODE=1`** strict env flag and
    `air-gap-guard.ts` utilities (`createAirGapFetchGuard`,
    `assertLocalFilesystemPath`). Refuses every HTTP request outside the
    operator-configured allow-list and rejects `s3://`, `https://`,
    `gs://`, … as replay-cache roots.
  - **`workspace-dev test-intelligence figma-export`** sub-command —
    runs on a connected machine, packages the Figma payload as
    `figma-payload.json` for the air-gapped harness, which consumes it
    via the new `--figma-payload <path>` alias of `--figma-json-file`.
  - **`sovereign-cloud` region-attestation source** — extends W6-3
    with a first-class attestation label for sovereign-cloud / on-prem
    deployments that don't implement Azure IMDS. Driven by
    `WORKSPACE_TEST_SPACE_REGION_ATTESTATION_SOVEREIGN_SOURCE=1` or
    implied by strict air-gap mode.
  - **CI air-gap smoke (`pnpm run test:ti-airgap-smoke`)** — runs every
    air-gap-mode invariant test under the strict env flag so a
    silently-leaking HTTP call fails the build.
  - **Documentation** — `docs/test-intelligence/sovereign-cloud.md`
    covers deployment topology, env flags, operator runbook, and
    failure modes.

  No regression on G1–G7 + G8 + G9 hard gates for the default profile.

- 60e75d9: Extend per-locale Platt-curve calibration with five additional EU-banking locales (PL-PL, ES-ES, NL-NL, CS-CZ, HU-HU) for Issue #2188.
  - `SupportedLocale` union widened from six locales to eleven; `SUPPORTED_LOCALES`, the IBAN-prefix table, primary-tag promotion, and the keyword heuristic in `src/test-intelligence/locale-calibration.ts` extended accordingly.
  - New module `src/test-intelligence/locale-calibration-health.ts` exporting the `G13_LOCALE_CALIBRATION_HEALTHY` hard gate plus the per-locale invariants (κ ≥ 0.7, held-out ECE ≤ 0.10, sample count ≥ 30, no `fallbackToDefault`).
  - `AuditDossierManifest` gains an optional `localeCalibrationHealth` block; audit-dossier renderer table-renders it when the per-locale fixtures are present. Legacy dossiers without per-locale fixtures keep the existing shape.
  - Per-locale corpora added under `fixtures/test-intelligence/locale-calibration/<locale>/` (gold set of 30 cases + fitted Platt curve), `fixtures/test-intelligence/terminology/<locale>.json` (50 banking + 30 insurance terms), and `fixtures/compliance/<locale>.json` (local-regulator → EU regulation citation map).
  - New operator-facing onboarding checklist at `docs/test-intelligence/locales.md`.

  All changes are additive; the existing six locales (DE-DE/AT/CH, EN-IE, FR-FR, IT-IT) and the G1–G7 + G8 + G9 hard gates are byte-identical to the previous release. Contract version bumped 1.37.0 → 1.38.0.

### Patch Changes

- 7832f2a: Add public, professional documentation for the Figma-to-QC Test Case Intelligence subsurface (Issue #1370).
  - New operator guide at `docs/test-intelligence.md` covering enablement, dual-gate fail-closed behavior, job type and mode namespace, artifact tree, review flow, export-only flow, OpenText ALM dry-run flow, evidence manifest verification, multimodal visual sidecar role separation, network boundary, secret handling, DORA / GDPR / EU AI Act positioning, and gateway operator responsibilities for the structured-test-case generator (`gpt-oss-120b`).
  - Extend `COMPLIANCE.md` with a DORA control-mapping row for the subsurface plus a dedicated section on GDPR controls, EU AI Act considerations, and gateway operator responsibilities.
  - Extend `ZERO_TELEMETRY.md` with the optional outbound paths to operator-controlled gateway endpoints and the live-smoke gate.
  - Extend `THREAT_MODEL.md` with a trust-boundary row and an attack-surface entry for the subsurface.
  - Surface the subsurface in `README.md` for package consumers.
  - Record the documentation surface decision as ADR `docs/decisions/2026-04-25-issue-1370-test-intelligence-public-docs.md`.

  No public contract surface changes; `CONTRACT_VERSION` is not bumped.

- 132f2d8: Document the Rocket compatibility fallback migration and deprecation policy for Issue #1554.
  - Add copy-pastable before/after examples for customer-profile jobs migrating from omitted `pipelineId` to explicit `pipelineId: "rocket"`.
  - Provide downstream release-note wording for the `default,rocket` compatibility window, including the deprecation warning for omitted-`pipelineId` Rocket auto-selection.
  - State that removing the compatibility fallback is a future package-major release only, with changelog, migration-guide, contract-evidence, and regression-test requirements in the same change set.

- d5fdc27: # Build Profile Allowlists

  Add profile-aware build and pack allowlists for default, rocket, and combined pipeline distributions.

- dbb47f0: Document the pipeline authoring, packaging, Rocket migration, and compatibility fallback contract for Issue #1566.
  - Add a maintainer guide that explains how future pipelines are authored through registered definitions, fixed stage plans, delegates, artifact contracts, and package profiles.
  - Document how the `default`, `rocket`, and `default-rocket` profiles map to runtime pipeline IDs and packaged template bundles.
  - Clarify the explicit `pipelineId: "rocket"` migration path and the deprecated omitted-`pipelineId` Rocket compatibility fallback removal policy.

- b48c082: Harden Storybook token extraction for Issue #700.
  - Promote `storybook.tokens` and `storybook.themes` extension metadata to version `3`.
  - Add sanitized provenance metadata grouped by token class and theme context.
  - Merge authoritative Storybook theme bundle evidence across compatible sources and allow Storybook args/argTypes backfill only for missing token classes.
  - Fail `ir.derive` with `E_STORYBOOK_TOKEN_EXTRACTION_INVALID` when Storybook token extraction has fatal completeness or consistency diagnostics.

All notable user-facing changes to `workspace-dev` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Contract-level surface changes remain tracked in `CONTRACT_CHANGELOG.md`.

## [Unreleased]

### Added

- Test Intelligence — explicit synthetic oracle provenance replaces
  redaction-token-only semantics for deterministic test-data entries
  (#2106):
  - `OracleValue` now carries `synthetic: true` so deterministic
    oracle emissions can be identified structurally instead of only via
    the legacy `[REDACTED:DOC_EXAMPLE]` suffix.
  - The oracle governance report now persists per-entry synthetic
    provenance, including the migration note
    `"synthesized by deterministic oracle"` and a test-data-index
    context that the validator can consult explicitly.
  - `validatePiiInTextFields` now skips PII detection for
    oracle-governed synthetic entries via that provenance context
    rather than relying solely on token-shape heuristics.
  - The legacy `[REDACTED:DOC_EXAMPLE]` rendering remains dual-emitted
    for one migration sprint for documentation examples and ISO
    date/datetime oracle samples; downstream consumers should migrate
    to the structural `synthetic` provenance signal before the suffix
    is removed.

- Test Intelligence — llguidance constrained-decoding adapter for the
  `openai_chat` transport (#2065):
  - New transport-specific adapter under
    `src/test-intelligence/constrained-decoding/openai-chat-adapter.ts`
    that implements the existing `ConstrainedDecodingAdapter` contract
    using the `openai_chat` transport's tool-calling and
    `response_format=json_schema` hooks. Both Outlines-style
    (FSM-bound) and llguidance-style (provider-bound) integrations
    sit behind the same internal contract and resolve with
    `enforcement: "provider"`.
  - Adapter selection is automatic and deterministic: when the
    deployment is reachable via `openai_chat` and the operator config
    prefers `llguidance` or `outlines`, the new adapter is used;
    otherwise the legacy registry resolves (e.g.
    `openai_json_schema`), and transports without a constrained mode
    fall back gracefully with a redacted `fallbackReason`.
  - `LlmConstrainedDecodingMetadata.adapterVersion` is now populated
    on every resolved metadata record (success and fallback paths)
    so FinOps and provenance graphs always have a deterministic
    version pin to correlate cost/quality shifts with adapter
    rollouts.
  - `CONTRACT_VERSION` bumps from `4.56.0` to `4.57.0`;
    `TEST_INTELLIGENCE_CONTRACT_VERSION` bumps from `1.17.0` to
    `1.18.0` (additive — new exported module, new runtime constants,
    no removals or renames).
  - Documentation: `docs/test-intelligence/constrained-decoding.md`.

- Test Intelligence — 2026-Q3 Innovation Roadmap epic closure (#2034):
  - Closure ADR (`docs/decisions/2026-05-08-issue-2034-ti-2026-q3-innovation-roadmap-closure.md`)
    records the AC-traceability matrix for all eight epic acceptance
    criteria and links the ten child issues (#2035–#2044) shipped
    across Wave 1 (action topology, schema-first decoding, W3C PROV-DM
    provenance), Wave 2 (cross-family judge ensemble + human review,
    adversarial-critic self-play, property-based invariants,
    mutation-killing eval), and Wave 3 (compliance-as-code rule packs,
    cost-aware smart routing, DSPy-style prompt optimization).
  - DPIA §3.7.1 (`docs/test-intelligence-dpia-production-runner.md`)
    now documents the closed set of multi-agent harness agent roles,
    including the three roles introduced by this epic
    (`action_topology` from #2035, `human_review` from #2038, and
    `adversarial_critic` from #2039 / #2052 / #2053). The new
    sub-section restates the LLM-role capability invariant
    (`LLM_ROLE_FORBIDDEN_CAPABILITIES = ["propose_changes"]`) and the
    `ictRegisterRef` requirement under `eu-banking-default`.
  - No `CONTRACT_VERSION` bump: every contract surface used by the
    epic was bumped in the originating wave PRs and is reflected in
    `CONTRACT_CHANGELOG.md` and `COMPATIBILITY.md`. KPI thresholds
    (`mutationKillRate >= 0.85`, `actionCoverage.ratio >= 0.7`,
    `G-NEG-CASE >= 0.30`) remain enforced by the contract constants
    in `src/contracts/index.ts` and the `eu-banking-default` policy
    profile.

- OSS default demo and documentation story completion (#1532):
  - The default pipeline now has a synthetic, OSS-neutral financial demo
    fixture pack covering global banking dashboard, payment authorization
    card, login/MFA, transaction table, risk alert modal, mobile navigation,
    token-heavy board, forms, responsive layout, and unsupported-node
    evidence scenarios.
  - Maintainer and evaluator docs now cover local install, token-free
    `local_json` / paste / plugin source modes, default-vs-Rocket pipeline
    selection, quality-passport evidence, troubleshooting, future pipeline
    authoring, package-profile boundaries, and Rocket migration guidance.
- Pipeline quality passport story completion (#1529):
  - Jobs now persist deterministic `quality-passport.json` evidence even
    when a pipeline fails before `validate.project`; successful validation
    passports remain unchanged, while early-failure passports record the
    failed stage, failure code, available stage state, generated-file
    evidence, and warning summary.
  - Release evidence now generates and verifies separate SBOM pairs for the
    shipped React MUI and React Tailwind generated-app templates.
- Default design-token compiler output (#1546):
  - Generated apps now include deterministic `src/theme/tokens.css` CSS
    custom properties and `src/theme/token-report.json` coverage evidence
    beside the existing `src/theme/tokens.json` artifact.
  - The token bridge now classifies and emits border, shadow, and z-index
    token variables in addition to color, typography, spacing, radius, size,
    and opacity variables.
- OSS default React + TypeScript + Tailwind template story completion (#1525):
  - `template/react-tailwind-app/` now ships as a private Vite React TS
    template with Tailwind CSS v4 through `@tailwindcss/vite`, strict
    DOM/JSX TypeScript settings, `.tsx` entrypoints, Vitest, Testing Library,
    ESLint, Playwright UI validation, and performance baseline/assertion
    scripts.
  - Root template gates install, lint, typecheck, test, build, validate UI,
    run Playwright validation, assert performance budgets, and enforce the
    default-template dependency denylist for the OSS template path.
- Default Tailwind template dependency denylist gate:
  - `pnpm run template:tailwind:dependency-denylist` now blocks direct
    MUI, Emotion, customer/Rocket, telemetry SDK, and unreviewed static
    asset additions to `template/react-tailwind-app/`.
  - Release quality gates run the denylist after the Tailwind template
    frozen-lockfile install, and template maintenance docs describe the
    review workflow for future template dependency or asset changes. (#1545)

- Wave 4 multi-source test-intent ingestion — Jira REST, paste-only Jira,
  and reviewer Markdown/structured-attribute custom context (#1431–#1439):
  - Three new primary-and-supporting source paths: `jira_rest` (Jira Cloud
    / Data Center / OAuth 2.0), `jira_paste` (air-gap safe; no outbound
    API calls), and `custom_text` / `custom_structured` (reviewer-authored
    supporting evidence).
  - Dual-gate: `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE=1` plus
    `testIntelligence.multiSourceEnabled: true`; fails closed before any
    source artifact is persisted.
  - Jira IR (`jira-issue-ir.json`) is canonical, PII-redacted, and
    deterministically hashed; ADF documents are parsed in memory and
    discarded. Byte caps: description 32 KiB, comment body 4 KiB, ADF
    input 1 MiB, REST calls 20 per job, paste budget 512 KiB per job.
  - Custom context Markdown is parsed with a strict allow-list subset
    (headings, lists, tables, blockquotes, inline code, fenced code blocks,
    emphasis, links with redacted hrefs); raw HTML, `javascript:`, and
    private-host URLs are rejected fail-closed.
  - Source reconciliation (Wave 4.F): conflict-resolution policy
    (`priority` / `reviewer_decides` / `keep_both`); conflicts persisted
    as `multi-source-conflicts.json`; four-eyes review triggered on
    `multi_source_conflict_present`.
  - Wave 4 production-readiness gate: `runWave4ProductionReadiness` +
    `evaluateWave4ProductionReadiness` wired into `pnpm run test:ti-eval`.
  - Single-source Figma-only jobs unchanged; backward-compatible in all
    Wave 1–3 artifact paths.
- Compliance and operations documentation for Wave 4 multi-source (#1440):
  - GDPR DPIA addenda: `docs/dpia/jira-source.md` and
    `docs/dpia/custom-context-source.md` — per-artifact data category
    and redaction tables, legal basis, retention, and DPO escalation.
  - Operator runbooks: `docs/runbooks/jira-source-setup.md` (Jira Cloud /
    Data Center / OAuth 2.0 setup, least-privilege scopes, token rotation,
    SSRF allow-list, end-to-end verification) and
    `docs/runbooks/multi-source-air-gap.md` (paste-only deployment,
    reviewer onboarding, Markdown editor guidance, paste-collision
    resolution, evidence-export-only workflow).
  - DORA mapping: `docs/dora/multi-source.md` — Art. 6/8/9/28 mapping,
    register-of-information template entry for Jira Cloud as ICT
    third-party, supply-chain integrity notes.
  - EU AI Act: `docs/eu-ai-act/human-oversight.md` — how the conflict-
    resolution gate and four-eyes trigger on `multi_source_conflict_present`
    discharge Art. 14 human oversight requirements.
  - Public API reference: `docs/api/test-intelligence-multi-source.md` —
    feature-flag matrix, source-mix decision table, envelope/Jira IR/
    reconciliation contract shapes, full HTTP route reference, worked
    request/response examples for Jira REST-only, paste-only, Figma+Jira,
    primary+custom, and Markdown+Jira-only jobs.
  - Migration note: `docs/migration/wave-4-additive.md` — additive contract
    diff, artifact tree additions, fallback rules, migration checklist.
  - Architecture diagram: `docs/architecture/multi-source-flow.mmd` —
    Mermaid source for the source-merge flow.

- Wave 1 Figma-to-Test end-to-end POC harness, evidence manifest, and CI evaluation gate (#1366):
  - Two public synthetic fixtures under `src/test-intelligence/fixtures/` — `poc-onboarding` (sign-up + identity verification) and `poc-payment-auth` (SEPA payment + 3-D Secure authorisation) — each shipped with a companion visual sidecar fixture.
  - `runWave1Poc(input)` composes the full chain (Figma → IR → redacted prompt → mock LLM → validation → review gate → export-only QC artifacts) into a deterministic run directory; replay produces byte-identical artifact hashes for the same fixture.
  - `wave1-poc-evidence-manifest.json` records SHA-256 + byte length for every emitted artifact, plus the prompt / schema / model / policy / export profile identities used during the run. `verifyWave1PocEvidenceManifest` and `verifyWave1PocEvidenceFromDisk` re-hash artifacts to detect tampering fail-closed.
  - Two type-level negative invariants are stamped on every manifest: `rawScreenshotsIncluded: false` and `imagePayloadSentToTestGeneration: false`. The harness additionally asserts the recorded mock-LLM requests carried no image payloads — `gpt-oss-120b` never receives screenshots.
  - `evaluateWave1Poc` enforces threshold-driven pass/fail across trace coverage (fields/actions/validations), QC mapping completeness, duplicate similarity, expected-results-per-case count, and policy/visual/export gate outcomes. Default thresholds match `eu-banking-default`.
  - New `pnpm run test:ti-eval` script runs the POC end-to-end + golden + verification + threshold tests; wired into the `dev-quality-gate` workflow.
- Onboarding and troubleshooting guide for the direct Figma import path at [`docs/figma-import.md`](docs/figma-import.md): Figma plugin install steps (Design and Dev Mode), Inspector paste-zone behaviour (paste / drop / upload), SmartBanner intent labels and override flow, payload-size limits, an example `workspace-dev/figma-selection@1` envelope, a REST `JSON_REST_V1` skeleton, FAQ, and a troubleshooting matrix covering "nothing happens on ⌘V/Ctrl+V", invalid JSON, unrecognised component, payload too large, and secure-context requirements. (#990)
- Incremental delta import scaffolding for Figma paste imports (#992):
  - Persistent paste-fingerprint store keyed by `{figmaFileKey, rootNodeIds}` under `${outputRoot}/paste-fingerprints/` (LRU + TTL, contract-version gated).
  - Tree-diff module classifies node changes as `baseline_created`, `no_changes`, `delta`, or `structural_break` with a configurable structural-change threshold (default 0.5).
  - New submit-time field `WorkspaceJobInput.importMode?: "full" | "delta" | "auto"`; auto mode falls back to full when the diff exceeds the threshold or when no prior manifest exists.
  - `WorkspaceSubmitAccepted.pasteDeltaSummary` returns mode, strategy, `nodesReused`, `nodesReprocessed`, structural ratio, and paste identity key so clients can render delta insight immediately on accept.
  - Inspector paste-pipeline now surfaces a "Delta Update" vs "Full Build" badge with an "N/M reused" detail on the pipeline status bar.
- Template web-performance pipeline:
  - `perf-budget.json` policy
  - `scripts/perf-runner.mjs`
  - scripts `perf:baseline` and `perf:assert`
- Field metric hook for CWV reporting in template app (`web-vitals` for INP/LCP/CLS).
- CI `performance-web` jobs in release workflows with artifact upload.
- Responsive viewport configuration for visual benchmark: declare per-fixture or per-screen viewport lists with `id/width/height/deviceScaleFactor/weight` in `visual-quality.config.json`. Default behavior is a single `desktop` viewport (1280x800) for byte-identical back-compat. Explicit viewports are honored by the `validate-project` service via `visualQualityViewportHeight` + `visualQualityDeviceScaleFactor` runtime fields. (#838)
- `--viewport <id>` CLI flag on `pnpm benchmark:visual` for future per-viewport filtering. Flag is parsed and validated today; runner integration follows. (#838)
- Proactive Figma MCP plan-budget warning (#1093): a non-blocking banner appears in the Inspector when usage reaches ≥80% (5/6 calls) of the Figma Starter MCP budget. Counter is local-only (localStorage), driven by backend-reported successful MCP tool usage, and dismissal is session- and month-scoped.

### Changed

- Rocket compatibility fallback documentation (#1554):
  - Added migration-guide examples that move customer-profile submissions
    from omitted `pipelineId` to explicit `pipelineId: "rocket"`.
  - Added downstream release-note wording for the `default,rocket`
    compatibility window and its deprecation warning.
  - Documented that removing omitted-`pipelineId` Rocket auto-selection is a
    future package-major release only and must ship with changelog,
    migration-guide, contract-evidence, and regression-test updates.
- Inspector bootstrap now submits confirmed plugin-envelope imports as `figma_plugin`, and plugin-ingress telemetry logs expose `payload_size`, `node_count`, and `runtime_ms` aliases. (#987)
- Public docs and compatibility tables now advertise `figma_plugin` anywhere the backend already supports it. (#987)
- Deterministic app generation now uses route-level lazy loading for non-initial screens (`React.lazy` + `Suspense`).
- Deterministic generated app shell defaults to `BrowserRouter` and supports runtime router mode override (`--router browser|hash`).
- Documented BrowserRouter rewrite requirements and hash compatibility mode in README router guidance.
- Added offline local Figma JSON ingestion mode (`figmaSourceMode=local_json`, `figmaJsonPath`) with strict submit-source exclusivity validation.
- `validate.project` can execute optional performance assertion when `FIGMAPIPE_WORKSPACE_ENABLE_PERF_VALIDATION=true` (or `FIGMAPIPE_ENABLE_PERF_VALIDATION=true`).
- Hardened deterministic MUI icon import emission with tuple-based dedupe and stable ordering for reproducible outputs.
- Extended `WorkspaceVisualReferenceFixtureMetadata.viewport` with optional `deviceScaleFactor`. Back-compatible for v1/v2 fixtures. (#838)
- Composite score key in visual-benchmark runner is now `fixtureId::screenId::viewportId` with `"default"` fallback when viewportId is missing. Back-compatible for baseline v3 entries without viewportId. (#838)

## [1.0.0] - 2026-03-13

### Changed

- Promoted `workspace-dev` to standalone OSS package release line.
- Removed legacy CLI alias; only `workspace-dev` remains.
- Replaced monorepo-coupled template parity test with self-contained template integrity snapshots.
- Updated governance and contribution docs for standalone repository operations.

### Migration notes

- Replace all legacy CLI alias invocations with `workspace-dev`.
- No HTTP API contract changes in `/workspace` runtime endpoints.

## [0.3.0] - 2026-03-12

### Changed

- Switched generation runtime to parity-aligned deterministic pipeline:
  - `figma.source`
  - `ir.derive`
  - `template.prepare`
  - `codegen.generate`
  - `validate.project`
  - `repro.export`
  - optional `git.pr`
- Bundled Workspace Dev React + TypeScript + MUI v7 template into `workspace-dev`.
- Replaced simplified generator with parity deterministic IR + codegen core.
- Added optional Git/PR flow (`enableGitPr`) with contract-safe repo credential handling.
- UI now exposes explicit Git/PR toggle and keeps `Generate` CTA visible in header and form.
- Added no-store cache headers for UI and preview routes to avoid stale asset rendering.

## [0.2.0] - 2026-03-12

### Changed

- `workspace-dev` evolved from validator-only runtime to autonomous local generator.
- `POST /workspace/submit` now accepts jobs (`202`) and starts real local execution.
- Added async job polling endpoints (`/workspace/jobs/:id`, `/workspace/jobs/:id/result`).
- Added integrated local preview serving (`/workspace/repros/:id/*`).
- Updated UI to reduced but functional workspace flow with required inputs:
  - `figmaFileKey`
  - `figmaAccessToken`
  - `repoUrl`
  - `repoToken`
- Added deterministic local artifact pipeline:
  - Figma REST fetch
  - IR derivation
  - local code generation
  - local preview export

### Maintained constraints

- Mode lock remains strict:
  - `figmaSourceMode=rest`
  - `llmCodegenMode=deterministic`
- No MCP, no hybrid, no `llm_strict`.
- No dependency on Workspace Dev platform backend services.

## [0.1.1] - 2026-03-12

### Changed

- Hardened npm release readiness for `workspace-dev`:
  - release governance changelog
  - `sideEffects` metadata
  - CJS guard export paths with ESM migration guidance
  - package quality checks (`publint`, `attw`, `size-limit`)
  - package-local changesets + OIDC provenance publish

## [0.1.0] - 2026-03-11

### Added

- Initial `workspace-dev` package release for local mode-locked workspace validation.
- Public status and validation endpoints (`/workspace`, `/healthz`, `/workspace/submit`).
