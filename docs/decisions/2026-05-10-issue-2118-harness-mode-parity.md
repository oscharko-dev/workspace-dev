# 2026-05-10 — Issue #2118: A/B shadow-mode parity tests (enforced vs shadow_eval output equivalence)

- **Status:** Accepted
- **Date:** 2026-05-10
- **Issue:** [#2118](https://github.com/oscharkowski/workspace-dev/issues/2118) (parent epic [#2098](https://github.com/oscharkowski/workspace-dev/issues/2098))
- **Closes audit finding:** Quality — _"Harness `enforced` and `shadow_eval` modes have no test guarantee of output equivalence."_

## Context

The production runner ships three harness modes (Issue #1791, Story MA-3 #1758) declared as the closed set `PRODUCTION_RUNNER_HARNESS_MODES = ["enforced", "off", "shadow_eval"]` in [src/test-intelligence/production-runner.ts:621](../../src/test-intelligence/production-runner.ts:621):

- `off` — single-pass fallback. Legacy callers that omit `harness` get this.
- `shadow_eval` — observation mode. The runner classifies the call through the multi-agent harness and records the verdict on a per-step artifact, but the harness's decision is purely informational; failure classification is identical to `off`.
- `enforced` — the harness owns the terminal decision. A non-`accept` verdict surfaces as a `ProductionRunnerError`.

Until #2118 the only tests that exercised mode equivalence were happy-path integration tests in `production-runner-harness.test.ts` (single fixture, no property coverage, no replay-cache cross-mode contract). Operators who wanted to roll back from `enforced` to `shadow_eval` (e.g. during an incident) had no signal that they would see the same case set after the rollback. They had to read 8 600 lines of runner code and trust nothing else had drifted.

The audit finding asked for three things:

1. A regression-locked **A/B parity contract** between `shadow_eval` and `enforced`: same input ⇒ same `(generatedTestCases, validation, policy.violations)` triple, modulo the enforcement decision itself.
2. A **shared replay-cache key** so a job cached under one mode is reachable under the other. Without this, every mode flip burns an LLM spend.
3. A **CI gate** that runs the parity contract on every PR touching the production runner or the validation pipeline.

## Decision

We introduce a single regression-locked test, [src/test-intelligence/harness-mode-parity.test.ts](../../src/test-intelligence/harness-mode-parity.test.ts), and a CI step that runs it on every PR.

### 1. Parity contract

For the same `RunFigmaToQcTestCasesInput`, the runner produces the **same triple** in `shadow_eval` and `enforced`:

- `result.generatedTestCases` — full deep-equal, including audit metadata.
- `result.validation` — full `TestCaseValidationReport` deep-equal.
- `result.policy.violations` — concatenation of `decisions[].violations` and `jobLevelViolations`, deep-equal in order.

The harness summary itself (`result.harness.mode`) is excluded from the comparison: the enforcement decision is the one field where the two modes are allowed to differ, and the contract is "modulo the enforcement decision itself".

When the comparison fails the test reports the **first divergent JSON path** (e.g. `$.testCases[2].steps[1].expected`) instead of dumping the full report. An operator can grep the path back into the runner module without re-running the failing fixture interactively.

### 2. Fixture coverage

The test executes 31 inputs in both modes:

| Source                    | Count | Purpose                                                                       |
| ------------------------- | ----- | ----------------------------------------------------------------------------- |
| Hand-curated normal       | 2     | Single-screen and multi-screen banking flows.                                 |
| Hand-curated edge         | 2     | Minimal screen with a single label; long label set straining the form quota. |
| Hand-curated adversarial  | 2     | Duplicate screen names; non-ASCII (German umlaut, em-dash, arrow) labels.    |
| Property-based (`fast-check`) | 24    | Random valid Figma payloads via `figmaModelArb` (1–3 screens × 1–4 labels). |
| Empty-payload throw parity | 1     | Both modes raise the same `ProductionRunnerError` failure class pre-LLM.    |

That is 31 inputs total — comfortably above the 30-input acceptance bar set on the issue.

### 3. Cross-mode replay-cache parity

The persisted [`ReplayCacheKey`](../../src/contracts/index.ts#L8078) shape does not encode the harness mode. The parity test pins this on two layers:

- **Structural pin.** A unit test enumerates `Object.keys(sampleKey)` and rejects any field whose name carries harness-mode semantics (`mode`, `harnessMode`, `harness`, `enforcement`, `enforced`, `shadowEval`, `shadow_eval`). Adding a future cache-partitioning field becomes a deliberate decision that fails the test instead of silently halving cache hit rates.
- **Runtime pin.** A test seeds the same `MemoryReplayCache` from a `shadow_eval` run, then runs `enforced` with the same input and asserts every test case in the second run has `audit.cacheHit === true` and matches the cache key recorded on the first run.

These two together are the operator-facing guarantee: switching modes does not force a cache miss.

### 4. CI gate

The parity test is added to the `Test-intelligence runner boundary` step in [.github/workflows/pr-quality-gate.yml](../../.github/workflows/pr-quality-gate.yml) alongside the existing production-runner property and adversarial tests. The gate triggers on every PR targeting `dev`, which transitively covers the validation pipeline (the runner consumes `validation-pipeline` outputs and any divergence surfaces in `result.validation`).

The full `pnpm run test` invocation in `dev-quality-gate.yml` already globs `src/**/*.test.ts`, so the parity test additionally runs in the `dev`-merge gate without further wiring.

## Consequences

### Wins

- **Operator confidence in mode rollbacks.** A reviewer reading the green CI light knows that the harness's verdict is the only field that can differ between modes. Rollback from `enforced` to `shadow_eval` no longer requires manual case-set diffing.
- **Cache-hit preservation across modes.** A run cached under `shadow_eval` is immediately reachable under `enforced` — important during the staged-rollout window when both modes typically run side-by-side on the same fixture set.
- **Diff output that diagnoses without rerunning.** The first-divergent-path message is enough for an operator to identify whether a regression came from the generator, the validation pipeline, or the policy gate.

### Costs

- The parity test adds ~1.5 s × 31 fixture pairs ≈ ~30 s to the PR quality-gate runner. Hand-curated fixtures keep the budget bounded; property-based runs are capped at `numRuns: 24`.
- Future mode additions (`PRODUCTION_RUNNER_HARNESS_MODES`) need explicit parity-test coverage. The existing `harness modes are exhaustively covered by the integration tests` regression in `production-runner-harness.test.ts` continues to enforce the closed set; the parity test currently pins only the `shadow_eval`/`enforced` axis because `off` does not produce a harness summary at all.

### Non-goals

- The parity contract does not extend to `harness.mode === "off"`. The `off` mode is the legacy single-pass fallback and intentionally writes no harness step artifact, so the triple is not directly comparable. `off`-vs-`shadow_eval` parity is already covered by the existing harness happy-path tests.
- The parity contract does not assert that the byte-shape of `result.harness` matches across modes — only that the enforcement-orthogonal triple matches.

## Validation

```bash
pnpm exec tsx --test src/test-intelligence/harness-mode-parity.test.ts
```

Expected: 10 tests pass, ~1.1 s wall clock with mocks.

## Related decisions

- [docs/decisions/2026-05-10-issue-2116-faithfulness-evaluation-mode.md](2026-05-10-issue-2116-faithfulness-evaluation-mode.md) — explicit semantics + audit trail for the cross-modal-faithfulness gate.
- [docs/adr/2105-remove-workspace-test-intelligence-dry-run.md](../adr/2105-remove-workspace-test-intelligence-dry-run.md) — removed the legacy `dry_run` mode, leaving the three-mode set this contract covers.
