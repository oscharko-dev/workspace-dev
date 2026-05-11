# 2026-05-11 — Issue #2128: Training-influence differential-privacy budget tracking

- **Status:** Accepted
- **Date:** 2026-05-11
- **Issue:** [#2128](https://github.com/oscharkowski/workspace-dev/issues/2128) (parent epic [#2098](https://github.com/oscharkowski/workspace-dev/issues/2098))
- **Phase:** 4 — P4 above SOTA (differentiator)

## Context

EU AI Act transparency obligations require operators of high-risk AI systems to account for how customer inputs may influence downstream model updates. LLM gateway providers may use customer prompts for retraining (the exact policy is provider- and tier-dependent). Until #2128 the `workspace-dev` harness had no mechanism that tracked, per tenant, how much input content had been contributed to provider gateways inside a given audit window, and operators could not point an auditor at a per-job artifact carrying that figure.

A true differential-privacy guarantee cannot be enforced from the client side. The mechanism that adds calibrated noise (or otherwise bounds influence) has to live inside the training pipeline. What CAN live on the client side is an accounting layer: a deterministic record of how much input was sent, computed against an operator-configured cap, with a hard stop when the cap is reached. That is the deliverable for #2128.

## Decision

We ship an opt-in per-tenant DP budget ACCOUNTANT. It is explicitly NOT a cryptographic DP guarantee. Every shipped policy profile leaves the accountant disabled; operators opt in on a derived profile.

### 1. Mathematical model

For a single job `j` charged against tenant `t` inside cycle `c`:

```
ε_j = T_j · ε_per_token
δ_j = δ_per_job
```

where `T_j` is the input-token count for the job (as estimated by the existing `estimateLlmInputTokens` pipeline), and `(ε_per_token, δ_per_job)` are operator-supplied coefficients on the policy profile (`DP_BUDGET_DEFAULT_PER_TOKEN_EPSILON = 1e-4` and `DP_BUDGET_DEFAULT_DELTA_PER_JOB = 1e-6` are the conservative defaults).

For a cycle of `N` jobs, totals are tracked additively (basic / sequential composition):

```
ε_c = Σ_{i=1..N} ε_i  ≤  ε_budget(t)
δ_c = Σ_{i=1..N} δ_i  ≤  δ_budget(t)
```

When the projected post-charge totals would exceed either cap, the accountant returns `rejected_budget_exhausted` and the call-site MUST NOT issue the inference. State does not advance on rejection, so a caller that retries with a smaller `T_j` (or after the operator advances the cycle) gets a fresh decision against the unmodified state.

The accountant pins two extra integrity rules at the call-site:

- The persisted state carries the budget caps that were authoritative at cycle creation. `applyDpCharge` throws if the supplied `config` caps drift from the state caps — that would let an operator silently bypass the contractually agreed limit by mutating the policy profile mid-cycle. Operators that want to change caps roll the cycle forward via `resetTenantDpBudgetCycle`.
- `estimateJobDpCharge` throws if `inputTokens * perTokenEpsilon` overflows to `Infinity`. Canonical JSON serializes `Infinity` as `null`, which would corrupt the audit trail; a typed error at the call-site is the safer outcome.

We deliberately use BASIC composition rather than advanced composition (Dwork-Roth strong composition, RDP, GDP). Advanced composition gives a tighter bound (`O(√N · ε · √(log(1/δ′)))` instead of `O(N · ε)`) but only under DP semantics that, again, this accountant does not provide. Using basic composition is the more conservative and easier-to-audit choice for a budget-accounting layer.

### 2. Decision space

`ALLOWED_DP_BUDGET_DECISIONS` is the closed three-element set:

- `accepted` — projected charge stays under both caps. `newState` reflects the post-charge totals.
- `rejected_budget_exhausted` — projected charge would push `ε_c` or `δ_c` past its cap. `newState === previousState`; the caller MUST NOT issue inference for this job until the cycle is reset.
- `skipped_disabled` — `TrainingInfluenceDpBudgetConfig.enabled === false`. The accountant short-circuits, returns the estimate that WOULD have been charged (useful for shadow / preview reporting), and leaves state untouched.

The three-state shape is intentional: a missing `dpBudget` config returns `skipped_disabled`, not an exception, so callers that always invoke the accountant can persist `result.newState` unconditionally.

### 3. Cycle advancement

The accountant does not interpret `cycleId`. Operators advance the cycle on whatever cadence matches their contract — daily, quarterly, per-engagement — by calling `resetTenantDpBudgetCycle(state, { cycleId, cycleStartedAt })`. The reset must use a different `cycleId` than the current state (a same-id call throws) so audit can distinguish a deliberate roll-over from a misconfigured caller.

### 4. Per-job manifest

This PR ships the accountant as a LIBRARY SURFACE — a set of pure, exported helpers (`applyDpCharge`, `buildDpBudgetConsumedManifest`, `resetTenantDpBudgetCycle`, …) that operators wire into their gateway adapter. The harness itself does not call these helpers; the call-site lives in the operator's deployment glue (typically the gateway adapter or the per-job pre-flight hook). When the call-site invokes `buildDpBudgetConsumedManifest` and writes the canonical JSON to the run-dir as `dp-budget-consumed.json`, the existing `buildHarnessArtifactManifest` automatically picks the file up (the filename is in `ALLOWED_HARNESS_ARTIFACT_FILENAMES`) and pins its sha256 + size for evidence-verify replay.

The decision to ship a library rather than an auto-wired hard gate matches the parent epic's framing: the AC explicitly calls this "operator concern" and the cap is policy-profile-driven. Until customers commit to specific caps, auto-wiring would force every deployment to either set a cap or carry the burden of explicitly disabling the gate. A future Issue can wire the helpers into the canonical job-engine entry-point once the operator-facing knob has stabilized.

The manifest schema (`DP_BUDGET_CONSUMED_MANIFEST_SCHEMA_VERSION = "1.0.0"`) carries:

- `tenantId`, `jobId`, `cycleId`, `generatedAt` — identity.
- `decision` — one of the three decisions above.
- `dpBudgetConsumed: { epsilon, delta, inputTokens }` — the charge.
- `cycleTotals: { epsilonConsumed, deltaConsumed, epsilonBudget, deltaBudget, jobsCharged }` — running totals AFTER the charge (unchanged from before for non-`accepted` decisions).
- `parameters: { perTokenEpsilon, deltaPerJob }` — the coefficients used, for replay.

`dp-budget-consumed.json` is a member of `ALLOWED_HARNESS_ARTIFACT_FILENAMES`, so `buildHarnessArtifactManifest` pins its sha256 + size into `harness-artifact-manifest.json` when the artifact is present on disk. The evidence-verify route reproduces the audit trail offline by re-hashing the file.

Even `rejected_budget_exhausted` jobs should emit a manifest: an auditor must be able to point at the artifact and see "this job was blocked, here is what it would have charged."

### 5. Opt-in posture

`TestCasePolicyProfileRules.trainingInfluenceDpBudget` is OPTIONAL and OMITTED on `eu-banking-default` and `eu-banking-sovereign`. The accountant is therefore inactive by default in every shipped profile: no charge is computed at the call site, no manifest is written, and the entry in `ALLOWED_HARNESS_ARTIFACT_FILENAMES` is harmless because `buildHarnessArtifactManifest` skips filenames whose file is absent on disk.

Operators that contractually require the accountant enable it on a derived profile:

```ts
const profile = {
  ...EU_BANKING_DEFAULT_POLICY_PROFILE,
  rules: {
    ...EU_BANKING_DEFAULT_POLICY_PROFILE.rules,
    trainingInfluenceDpBudget: {
      enabled: true,
      perTokenEpsilon: 1e-4,
      deltaPerJob: 1e-6,
      tenantEpsilonBudget: 100,
      tenantDeltaBudget: 1e-4,
    },
  },
};
```

## Consequences

- A regulated tenant can now point an EU AI Act auditor at `dp-budget-consumed.json` and `harness-artifact-manifest.json` to demonstrate operator-controlled bounded input contribution per cycle, with the cap and per-token coefficient transparently recorded.
- The accountant is a STOP signal, not a noise-injection mechanism. Reaching the cap blocks further inference under the current cycle; it does not modify any prompt. The provider's training pipeline is still the only authority on whether the inputs influence a future model update — the ADR and the module docstring both call this out.
- Operators that do not enable the accountant pay no runtime cost and emit no new artifact, so the rollout is risk-free for the default deployment lane.
- The contract bump is additive (`TEST_INTELLIGENCE_CONTRACT_VERSION 1.38.0 → 1.39.0`). No existing field, type, or hard gate changes.

## Alternatives considered

- **Advanced composition (Dwork-Roth) or RDP accounting.** Rejected. The accountant is not a DP mechanism, so a tighter composition bound would over-state the rigor of the layer. Basic composition is the most conservative choice and the easiest to explain to an auditor who is not a DP specialist.
- **Server-side enforcement only.** Rejected for now. The client-side accountant is the layer the operator controls; pushing enforcement to the gateway makes the cap invisible to the local audit trail and depends on the provider implementing it. The two are complementary, and a future Issue can wire the gateway-side enforcement when the upstream supports it.
- **Always-on default.** Rejected. Until customers explicitly request the accountant, defaulting it on would change harness behavior for every existing deployment without operator consent. The `eu-banking-default` profile is contractually byte-stable across the Wave 1–8 series; turning the accountant on by default would break that contract.
- **Encode the cap as a hard-coded constant.** Rejected. Different customer contracts will negotiate different caps; the config-driven approach lets operators derive a profile without a code change.
