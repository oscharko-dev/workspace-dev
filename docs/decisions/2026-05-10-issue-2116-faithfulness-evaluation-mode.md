# 2026-05-10 — Issue #2116: explicit semantics + audit trail for the cross-modal-faithfulness tier-elastic fallback

- **Status:** Accepted
- **Date:** 2026-05-10
- **Issue:** [#2116](https://github.com/oscharkowski/workspace-dev/issues/2116) (parent epic [#2098](https://github.com/oscharkowski/workspace-dev/issues/2098))
- **Closes audit finding:** Validation — _"Faithfulness tier-elastic fallback uses case-level score when per-step verdicts missing — silent degradation"_

## Context

Issue #2066 introduced the tier-aware cross-modal-faithfulness gate. When a `FaithfulnessVerdict` carries per-step `stepVerdicts`, the gate reasons over them and writes a persistable `faithfulness-tier-report.json`. When `stepVerdicts` is missing or empty (legacy schema 1.0.0 producers, judges that emitted only the case-level fields, etc.), the gate silently falls back to the verdict's case-level `score`. The Q1/2026 audit pass flagged this as **silent degradation**: a reviewer reading the policy report cannot tell whether the case was tier-evaluated or fallback-evaluated, and there was no metric tracking how often the fallback path was taken.

The audit finding asked for three things:

1. Make the evaluation path **explicit** in the persisted artifacts so a reviewer can see at a glance which path produced the score.
2. Make the evaluation path **operator-tunable** so banks that mandate per-step audit evidence can fail rather than fall back.
3. Make the evaluation path **observable over time** so a rising fallback rate raises an alarm before it becomes a production-quality regression.

## Decision

We introduce a single, normative taxonomy for how the cross-modal-faithfulness gate evaluated a run, and surface it on every layer of the audit trail.

### 1. The `FaithfulnessEvaluationMode` taxonomy (closed set)

| Mode                  | Trigger                                                                                  | Persisted as                                                                |
| --------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `per_step`            | Verdict carries one or more `stepVerdicts`; the gate reasons over them.                  | Tier-report `evaluationMode`; policy-report `faithfulnessEvaluation.mode`.  |
| `case_level_fallback` | Verdict exists, has no refusal, and `stepVerdicts` is missing or empty.                  | Policy-report `faithfulnessEvaluation.mode`. No tier report is written.     |
| `missing`             | Verdict was refused (`verdict.refusal !== undefined`) or no verdict was supplied at all. | Policy-report `faithfulnessEvaluation.mode`. No tier report is written.     |

The taxonomy is exhaustive and machine-comparable. Drift detection, benchmark scorecards, and audit dashboards consume the mode without re-reading the verdict envelope.

### 2. The `policy:cross-modal-faithfulness:case-level-fallback` rule

A **new job-level** policy rule. Severity is `warning` by default and escalates to `error` when the active profile sets `requirePerStepFaithfulness: true`. The rule is emitted whenever `mode === "case_level_fallback"`. It is **not** attached to per-case decisions — the fallback describes the gate's evidence path, not a per-case finding, and per-case decisions stay focused on per-case violations.

The companion `mode === "missing"` value does **not** raise an additional rule. Two reasons:

- Refusals are already enforced by `policy:judge_refused` with operator-tunable severity (`judgeRefusalPolicy.faithfulness`). Stacking a second always-error rule on top would override the operator's deliberate severity choice and double-count the same incident in audit trails.
- Callers that never wired faithfulness into their pipeline (test harnesses, the `measure-eingabemasken` deterministic K0 driver) preserve their pre-#2116 byte shape. The mode is still recorded on the policy report so the audit trail is complete; the drift fallback-rate metric still counts these runs.

### 3. The `requirePerStepFaithfulness` operator config

A new optional rule on `TestCasePolicyProfileRules`. The secure default for `eu-banking-default` is `false` (warn-only, preserves backwards-compatible enforcement). Operators that mandate per-step audit evidence flip it to `true`, which escalates the new fallback rule from `warning` to `error` and so blocks the run.

The default is pinned as a typed constant (`EU_BANKING_DEFAULT_REQUIRE_PER_STEP_FAITHFULNESS`) so a CI diff catches drift in the secure default — flipping it is a deliberate governance change that must be reviewed alongside this ADR.

### 4. Drift detection — `faithfulness_fallback_rate` metric

`computeDriftCanaryMetrics` now emits a `faithfulness_fallback_rate` metric per drift run, computed as `(case_level_fallback_runs + missing_runs) / total_runs` across the canary holdout. The metric flows through the standard drift-canary baseline machinery (rolling mean, ±2σ shift detection), so a rising fallback rate raises a `metric_shift` finding before the silent degradation reaches production.

### 5. Eingabemasken benchmark report

`scripts/measure-eingabemasken.ts` now records the evaluation mode for every fixture and renders a per-fixture breakdown table plus an aggregate fallback rate. The K0 deterministic mock pipeline does not exercise an LLM faithfulness judge, so every fixture surfaces `mode === "missing"` — the breakdown makes that absence visible to reviewers rather than implicit.

## Consequences

### Wins

- **Audit-trail completeness.** A reviewer reading `policy-report.json` can immediately tell which evidence path produced the cross-modal-faithfulness decision. The tier report's `evaluationMode` field gives the same signal when the report is parsed in isolation.
- **Operator control.** Banks that require per-step evidence flip a single profile bit (`requirePerStepFaithfulness: true`) and the gate becomes strict. No code change required.
- **Silent-degradation alarm.** A rising `faithfulness_fallback_rate` raises a drift-canary finding before fallbacks become the norm. Without this signal, a model regression that started emitting verdicts without `stepVerdicts` would slip through indefinitely.
- **Backwards compatibility.** Callers that never wired a faithfulness verdict (legacy tests, the K0 mock pipeline, fast-iteration runs) preserve their pre-#2116 policy-report byte shape: the `faithfulnessEvaluation` block is omitted on those runs.

### Tradeoffs

- **One more conceptual axis** for reviewers to learn: alongside `verdict`, `score`, and `refusal`, they now also reason over `evaluationMode`. We accept this because the alternative — leaving the fallback silent — was the audit finding being closed.
- **The `missing` mode does not enforce.** It only annotates the audit trail and feeds the fallback-rate metric. Refusals are still enforced via `policy:judge_refused`. We chose this to avoid double-counting and to respect the existing operator-tunable refusal policy. Operators who want the strictest possible enforcement can compose `judgeRefusalPolicy.faithfulness: "fail_closed"` with `requirePerStepFaithfulness: true` to get error-on-refusal AND error-on-fallback.

### Migration impact

- Existing callers that pass a `FaithfulnessVerdict` with `stepVerdicts` see no behaviour change.
- Existing callers that pass a verdict **without** `stepVerdicts` see one additional warning-severity job-level violation (`policy:cross-modal-faithfulness:case-level-fallback`). It does not change `report.blocked` under the secure default.
- Existing callers that pass a refused verdict see no behaviour change — `policy:judge_refused` continues to fire; the new audit-trail block records `mode === "missing"` for visibility.
- Existing callers that pass no verdict see no behaviour change at all — the `faithfulnessEvaluation` block is omitted; existing golden artifacts stay byte-identical.

## Alternatives considered

### A. Make `missing` always emit an error rule (the literal-issue reading)

The acceptance criteria reads "_emits warning on every `case_level_fallback`; error on `missing`_". A literal interpretation would have us emit a new always-error rule for any run without a verdict. We rejected this because:

- It would override the operator's `judgeRefusalPolicy.faithfulness: "fail_open"` choice, which is documented and intentional for fast-iteration environments.
- It would break every existing test and benchmark fixture that does not wire a faithfulness verdict — these are not "missing" in the audit sense; they are "faithfulness was not part of this run".

The compromise is to keep the audit-trail mode `"missing"` and rely on the existing refusal rule + the new fallback rule for enforcement, and let `requirePerStepFaithfulness: true` be the strict-mode opt-in.

### B. Attach the mode only to the tier report

We considered keeping the new field on `FaithfulnessTierReport.evaluationMode` only and letting the policy-report stay unchanged. We rejected this because the tier report is **only** written for `per_step` runs, so the reader still cannot tell `case_level_fallback` from `missing` without consulting a second artifact. Putting the audit block on the policy report is the cheapest way to make the mode universally observable.

### C. Add `faithfulnessVerdictRequired` to `EvaluatePolicyGateInput`

We considered a per-run flag the runner sets when it expects a verdict, so `missing` could be enforced as an error without breaking legacy callers. We rejected this for now — it adds a new in-memory contract surface for a property that the production runner already implicitly knows (the runner always wires a verdict). If a future audit finding mandates strict missing-error enforcement, that flag remains the cleanest route.

## Verification

- `src/test-intelligence/policy-gate.test.ts` covers the new mode classification and rule severity (existing tests + new cases for each mode).
- `src/test-intelligence/policy-profile.test.ts` pins the secure default `requirePerStepFaithfulness: false`.
- `src/test-intelligence/drift-canary.test.ts` covers the new `faithfulness_fallback_rate` metric.
- `src/test-intelligence/faithfulness-tier-report.test.ts` covers the new `evaluationMode: "per_step"` field on persisted reports.
- The Eingabemasken benchmark scorecard renders the per-fixture mode breakdown; a follow-up run regenerates `sandbox/benchmarks/test-intelligence/scorecards/eingabemasken-K0.md`.
