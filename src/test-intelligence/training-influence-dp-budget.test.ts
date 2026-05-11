import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOWED_DP_BUDGET_DECISIONS,
  ALLOWED_HARNESS_ARTIFACT_FILENAMES,
  DP_BUDGET_CONSUMED_MANIFEST_ARTIFACT_FILENAME,
  DP_BUDGET_CONSUMED_MANIFEST_SCHEMA_VERSION,
  DP_BUDGET_DEFAULT_DELTA_PER_JOB,
  DP_BUDGET_DEFAULT_PER_TOKEN_EPSILON,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type TrainingInfluenceDpBudgetConfig,
} from "../contracts/index.js";
import {
  applyDpCharge,
  buildDpBudgetConsumedManifest,
  createTenantDpBudgetState,
  estimateJobDpCharge,
  isDpBudgetConsumedManifest,
  resetTenantDpBudgetCycle,
  serializeDpBudgetConsumedManifest,
} from "./training-influence-dp-budget.js";

const ENABLED_CONFIG: TrainingInfluenceDpBudgetConfig = Object.freeze({
  enabled: true,
  perTokenEpsilon: 1e-3,
  deltaPerJob: 1e-6,
  tenantEpsilonBudget: 5,
  tenantDeltaBudget: 1e-4,
});

const DISABLED_CONFIG: TrainingInfluenceDpBudgetConfig = Object.freeze({
  enabled: false,
  tenantEpsilonBudget: 5,
  tenantDeltaBudget: 1e-4,
});

const freshState = (config: TrainingInfluenceDpBudgetConfig) =>
  createTenantDpBudgetState({
    tenantId: "tenant-1",
    cycleId: "cycle-2026Q2",
    cycleStartedAt: "2026-04-01T00:00:00.000Z",
    config,
  });

test("constants: filename appears in the harness artifact filename allow-list", () => {
  assert.equal(
    (ALLOWED_HARNESS_ARTIFACT_FILENAMES as readonly string[]).includes(
      DP_BUDGET_CONSUMED_MANIFEST_ARTIFACT_FILENAME,
    ),
    true,
  );
});

test("constants: schema and decision tokens are well-formed", () => {
  assert.equal(DP_BUDGET_CONSUMED_MANIFEST_SCHEMA_VERSION, "1.0.0");
  assert.equal(DP_BUDGET_CONSUMED_MANIFEST_ARTIFACT_FILENAME, "dp-budget-consumed.json");
  assert.deepEqual(
    [...ALLOWED_DP_BUDGET_DECISIONS].sort(),
    ["accepted", "rejected_budget_exhausted", "skipped_disabled"],
  );
  assert.equal(DP_BUDGET_DEFAULT_PER_TOKEN_EPSILON, 1e-4);
  assert.equal(DP_BUDGET_DEFAULT_DELTA_PER_JOB, 1e-6);
});

test("estimateJobDpCharge: linear in input tokens, deterministic", () => {
  const a = estimateJobDpCharge({ inputTokens: 1000 });
  const b = estimateJobDpCharge({ inputTokens: 2000 });
  const a2 = estimateJobDpCharge({ inputTokens: 1000 });
  assert.deepEqual(a, a2);
  assert.equal(b.epsilon, 2 * a.epsilon);
  assert.equal(b.delta, a.delta);
  assert.equal(a.perTokenEpsilon, DP_BUDGET_DEFAULT_PER_TOKEN_EPSILON);
  assert.equal(a.deltaPerJob, DP_BUDGET_DEFAULT_DELTA_PER_JOB);
});

test("estimateJobDpCharge: respects custom coefficients", () => {
  const charge = estimateJobDpCharge({
    inputTokens: 500,
    perTokenEpsilon: 1e-2,
    deltaPerJob: 1e-5,
  });
  assert.equal(charge.epsilon, 5);
  assert.equal(charge.delta, 1e-5);
});

test("estimateJobDpCharge: rejects invalid inputs", () => {
  assert.throws(() => estimateJobDpCharge({ inputTokens: -1 }), RangeError);
  assert.throws(() => estimateJobDpCharge({ inputTokens: 1.5 }), RangeError);
  assert.throws(
    () => estimateJobDpCharge({ inputTokens: 100, perTokenEpsilon: 0 }),
    RangeError,
  );
  assert.throws(
    () => estimateJobDpCharge({ inputTokens: 100, deltaPerJob: -1 }),
    RangeError,
  );
});

test("estimateJobDpCharge: throws when epsilon overflows to Infinity", () => {
  assert.throws(
    () =>
      estimateJobDpCharge({
        inputTokens: Number.MAX_SAFE_INTEGER,
        perTokenEpsilon: Number.MAX_VALUE,
      }),
    /epsilon is not finite/,
  );
});

test("createTenantDpBudgetState: stamps schema + contract versions, zero consumed", () => {
  const state = freshState(ENABLED_CONFIG);
  assert.equal(state.schemaVersion, DP_BUDGET_CONSUMED_MANIFEST_SCHEMA_VERSION);
  assert.equal(state.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
  assert.equal(state.tenantId, "tenant-1");
  assert.equal(state.epsilonConsumed, 0);
  assert.equal(state.deltaConsumed, 0);
  assert.equal(state.jobsCharged, 0);
  assert.equal(state.epsilonBudget, 5);
  assert.equal(state.deltaBudget, 1e-4);
});

test("createTenantDpBudgetState: rejects invalid inputs", () => {
  assert.throws(
    () =>
      createTenantDpBudgetState({
        tenantId: "",
        cycleId: "c1",
        cycleStartedAt: "2026-04-01T00:00:00.000Z",
        config: ENABLED_CONFIG,
      }),
    TypeError,
  );
  assert.throws(
    () =>
      createTenantDpBudgetState({
        tenantId: "t1",
        cycleId: "c1",
        cycleStartedAt: "not-iso",
        config: ENABLED_CONFIG,
      }),
    TypeError,
  );
  assert.throws(
    () =>
      createTenantDpBudgetState({
        tenantId: "t1",
        cycleId: "c1",
        cycleStartedAt: "2026-04-01T00:00:00.000Z",
        config: { ...ENABLED_CONFIG, tenantEpsilonBudget: -1 },
      }),
    RangeError,
  );
});

test("applyDpCharge (disabled): skipped_disabled, state unchanged", () => {
  const state = freshState(DISABLED_CONFIG);
  const result = applyDpCharge(state, {
    config: DISABLED_CONFIG,
    inputTokens: 100,
  });
  assert.equal(result.decision, "skipped_disabled");
  assert.equal(result.newState, state);
  assert.equal(result.reason, "training_influence_dp_budget_disabled");
  assert.ok(result.charge.epsilon >= 0);
});

test("applyDpCharge (enabled): accepted accumulates consumed totals", () => {
  let state = freshState(ENABLED_CONFIG);
  const r1 = applyDpCharge(state, {
    config: ENABLED_CONFIG,
    inputTokens: 1000,
  });
  assert.equal(r1.decision, "accepted");
  assert.equal(r1.newState.epsilonConsumed, 1); // 1000 * 1e-3
  assert.equal(r1.newState.jobsCharged, 1);
  state = r1.newState;

  const r2 = applyDpCharge(state, {
    config: ENABLED_CONFIG,
    inputTokens: 2000,
  });
  assert.equal(r2.decision, "accepted");
  // 1 + 2 = 3
  assert.equal(r2.newState.epsilonConsumed, 3);
  assert.equal(r2.newState.deltaConsumed, 2 * 1e-6);
  assert.equal(r2.newState.jobsCharged, 2);
});

test("applyDpCharge: rejects when epsilon would exceed cap", () => {
  let state = freshState(ENABLED_CONFIG); // 5 epsilon cap
  state = applyDpCharge(state, {
    config: ENABLED_CONFIG,
    inputTokens: 4500,
  }).newState; // consumes 4.5
  const blocked = applyDpCharge(state, {
    config: ENABLED_CONFIG,
    inputTokens: 1000, // would push to 5.5 > 5
  });
  assert.equal(blocked.decision, "rejected_budget_exhausted");
  assert.equal(blocked.reason, "epsilon_budget_would_exceed_cap");
  // State is unchanged on rejection so caller can persist newState
  // unconditionally.
  assert.equal(blocked.newState, state);
  assert.equal(blocked.newState.epsilonConsumed, 4.5);
});

test("applyDpCharge: rejects when delta would exceed cap", () => {
  const config: TrainingInfluenceDpBudgetConfig = {
    enabled: true,
    perTokenEpsilon: 1e-4,
    deltaPerJob: 1e-5,
    tenantEpsilonBudget: 1000,
    tenantDeltaBudget: 1.5e-5,
  };
  let state = createTenantDpBudgetState({
    tenantId: "tenant-1",
    cycleId: "c1",
    cycleStartedAt: "2026-04-01T00:00:00.000Z",
    config,
  });
  const r1 = applyDpCharge(state, { config, inputTokens: 100 });
  assert.equal(r1.decision, "accepted");
  state = r1.newState;
  const blocked = applyDpCharge(state, { config, inputTokens: 100 });
  assert.equal(blocked.decision, "rejected_budget_exhausted");
  assert.equal(blocked.reason, "delta_budget_would_exceed_cap");
});

test("applyDpCharge: throws when config caps drift from persisted state caps", () => {
  const state = freshState(ENABLED_CONFIG);
  const driftedConfig: TrainingInfluenceDpBudgetConfig = {
    ...ENABLED_CONFIG,
    tenantEpsilonBudget: 999,
  };
  assert.throws(
    () => applyDpCharge(state, { config: driftedConfig, inputTokens: 100 }),
    /config caps must match persisted state caps/,
  );
});

test("applyDpCharge: charge exactly at cap is accepted, next is rejected", () => {
  const config: TrainingInfluenceDpBudgetConfig = {
    enabled: true,
    perTokenEpsilon: 1,
    deltaPerJob: 0,
    tenantEpsilonBudget: 10,
    tenantDeltaBudget: 1,
  };
  let state = createTenantDpBudgetState({
    tenantId: "t1",
    cycleId: "c1",
    cycleStartedAt: "2026-04-01T00:00:00.000Z",
    config,
  });
  const r1 = applyDpCharge(state, { config, inputTokens: 10 });
  assert.equal(r1.decision, "accepted");
  assert.equal(r1.newState.epsilonConsumed, 10);
  state = r1.newState;
  const r2 = applyDpCharge(state, { config, inputTokens: 1 });
  assert.equal(r2.decision, "rejected_budget_exhausted");
});

test("applyDpCharge: zero-token job is accepted as a no-op for epsilon", () => {
  const state = freshState(ENABLED_CONFIG);
  const r = applyDpCharge(state, { config: ENABLED_CONFIG, inputTokens: 0 });
  assert.equal(r.decision, "accepted");
  assert.equal(r.newState.epsilonConsumed, 0);
  // delta is constant per job and was charged.
  assert.equal(r.newState.deltaConsumed, 1e-6);
  assert.equal(r.newState.jobsCharged, 1);
});

test("resetTenantDpBudgetCycle: zeroes consumed but preserves tenant + budgets", () => {
  let state = freshState(ENABLED_CONFIG);
  state = applyDpCharge(state, { config: ENABLED_CONFIG, inputTokens: 1000 })
    .newState;
  assert.ok(state.epsilonConsumed > 0);
  const rolled = resetTenantDpBudgetCycle(state, {
    cycleId: "cycle-2026Q3",
    cycleStartedAt: "2026-07-01T00:00:00.000Z",
  });
  assert.equal(rolled.tenantId, state.tenantId);
  assert.equal(rolled.cycleId, "cycle-2026Q3");
  assert.equal(rolled.epsilonBudget, state.epsilonBudget);
  assert.equal(rolled.deltaBudget, state.deltaBudget);
  assert.equal(rolled.epsilonConsumed, 0);
  assert.equal(rolled.deltaConsumed, 0);
  assert.equal(rolled.jobsCharged, 0);
});

test("resetTenantDpBudgetCycle: rejects same cycleId, invalid ISO, invalid config", () => {
  const state = freshState(ENABLED_CONFIG);
  assert.throws(
    () =>
      resetTenantDpBudgetCycle(state, {
        cycleId: state.cycleId,
        cycleStartedAt: "2026-07-01T00:00:00.000Z",
      }),
    RangeError,
  );
  assert.throws(
    () =>
      resetTenantDpBudgetCycle(state, {
        cycleId: "cycle-x",
        cycleStartedAt: "not-iso",
      }),
    TypeError,
  );
  assert.throws(
    () =>
      resetTenantDpBudgetCycle(state, {
        cycleId: "cycle-x",
        cycleStartedAt: "2026-07-01T00:00:00.000Z",
        config: { ...ENABLED_CONFIG, tenantDeltaBudget: -1 },
      }),
    RangeError,
  );
});

test("buildDpBudgetConsumedManifest: validator accepts well-formed manifest", () => {
  const state = freshState(ENABLED_CONFIG);
  const result = applyDpCharge(state, {
    config: ENABLED_CONFIG,
    inputTokens: 1000,
  });
  const manifest = buildDpBudgetConsumedManifest({
    result,

    jobId: "job-42",
    generatedAt: "2026-05-11T00:00:00.000Z",
  });
  assert.equal(isDpBudgetConsumedManifest(manifest), true);
  assert.equal(manifest.jobId, "job-42");
  assert.equal(manifest.tenantId, "tenant-1");
  assert.equal(manifest.cycleId, "cycle-2026Q2");
  assert.equal(manifest.decision, "accepted");
  assert.equal(manifest.dpBudgetConsumed.inputTokens, 1000);
  assert.equal(manifest.dpBudgetConsumed.epsilon, 1);
  assert.equal(manifest.dpBudgetConsumed.delta, 1e-6);
  assert.equal(manifest.cycleTotals.epsilonConsumed, 1);
  assert.equal(manifest.cycleTotals.epsilonBudget, 5);
  assert.equal(manifest.cycleTotals.jobsCharged, 1);
  assert.equal(manifest.parameters.perTokenEpsilon, 1e-3);
});

test("buildDpBudgetConsumedManifest: rejected jobs still emit an audit-ready manifest", () => {
  const config: TrainingInfluenceDpBudgetConfig = {
    enabled: true,
    perTokenEpsilon: 1,
    deltaPerJob: 0,
    tenantEpsilonBudget: 1,
    tenantDeltaBudget: 1,
  };
  const state = createTenantDpBudgetState({
    tenantId: "t1",
    cycleId: "c1",
    cycleStartedAt: "2026-04-01T00:00:00.000Z",
    config,
  });
  const result = applyDpCharge(state, { config, inputTokens: 10 });
  assert.equal(result.decision, "rejected_budget_exhausted");
  const manifest = buildDpBudgetConsumedManifest({
    result,

    jobId: "job-rejected",
    generatedAt: "2026-05-11T00:00:00.000Z",
  });
  assert.equal(manifest.decision, "rejected_budget_exhausted");
  // State did not advance, so the totals reflect the pre-charge state.
  assert.equal(manifest.cycleTotals.epsilonConsumed, 0);
  assert.equal(manifest.cycleTotals.jobsCharged, 0);
  // The charge that WOULD have applied is still recorded for audit.
  assert.equal(manifest.dpBudgetConsumed.epsilon, 10);
  assert.equal(isDpBudgetConsumedManifest(manifest), true);
});

test("isDpBudgetConsumedManifest: rejects malformed payloads", () => {
  const state = freshState(ENABLED_CONFIG);
  const result = applyDpCharge(state, {
    config: ENABLED_CONFIG,
    inputTokens: 1000,
  });
  const manifest = buildDpBudgetConsumedManifest({
    result,

    jobId: "job-42",
    generatedAt: "2026-05-11T00:00:00.000Z",
  });
  assert.equal(isDpBudgetConsumedManifest(null), false);
  assert.equal(isDpBudgetConsumedManifest({}), false);
  assert.equal(
    isDpBudgetConsumedManifest({ ...manifest, schemaVersion: "9.9.9" }),
    false,
  );
  assert.equal(
    isDpBudgetConsumedManifest({ ...manifest, decision: "unknown" }),
    false,
  );
  assert.equal(
    isDpBudgetConsumedManifest({ ...manifest, generatedAt: "not-iso" }),
    false,
  );
  assert.equal(
    isDpBudgetConsumedManifest({ ...manifest, tenantId: "" }),
    false,
  );
  assert.equal(
    isDpBudgetConsumedManifest({
      ...manifest,
      dpBudgetConsumed: { ...manifest.dpBudgetConsumed, epsilon: -1 },
    }),
    false,
  );
  assert.equal(
    isDpBudgetConsumedManifest({
      ...manifest,
      cycleTotals: { ...manifest.cycleTotals, jobsCharged: -1 },
    }),
    false,
  );
});

test("serializeDpBudgetConsumedManifest: canonical, trailing newline, byte-stable", () => {
  const state = freshState(ENABLED_CONFIG);
  const result = applyDpCharge(state, {
    config: ENABLED_CONFIG,
    inputTokens: 1000,
  });
  const manifest = buildDpBudgetConsumedManifest({
    result,

    jobId: "job-42",
    generatedAt: "2026-05-11T00:00:00.000Z",
  });
  const a = serializeDpBudgetConsumedManifest(manifest);
  const b = serializeDpBudgetConsumedManifest(manifest);
  assert.equal(a, b);
  assert.equal(a.endsWith("\n"), true);
  // Canonical-JSON sorts object keys; the leading bytes are predictable.
  assert.equal(a.startsWith('{"contractVersion":"'), true);
});
