import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type TestCaseRiskCategory,
} from "../contracts/index.js";
import {
  appendDistributionShiftBaselineRecord,
  buildDistributionShiftDashboard,
  computeKlDivergence,
  createFileDistributionShiftAlertSink,
  DISTRIBUTION_SHIFT_ALERTS_FILENAME,
  DISTRIBUTION_SHIFT_CENTROID_SIGMA_THRESHOLD,
  DISTRIBUTION_SHIFT_DASHBOARD_FILENAME,
  DISTRIBUTION_SHIFT_HISTORY_DAYS,
  DISTRIBUTION_SHIFT_KL_THRESHOLD,
  DISTRIBUTION_SHIFT_REPORT_FILENAME,
  DISTRIBUTION_SHIFT_SCHEMA_VERSION,
  DISTRIBUTION_SHIFT_TOKEN_BUCKET_COUNT,
  distributionShiftBaselinePath,
  emptyDistributionShiftBaselineState,
  evaluateDistributionShiftReport,
  loadDistributionShiftBaselineState,
  recordInputDistributionSnapshot,
  writeDistributionShiftBaselineState,
  writeDistributionShiftDashboard,
  writeDistributionShiftReport,
  type DistributionShiftBaselineState,
  type DistributionShiftEmbeddingProvider,
  type DistributionShiftSnapshot,
  type JobDistributionInput,
} from "./distribution-shift-detector.js";
import type { IntentDerivationFigmaInput } from "./intent-derivation.js";

const SUITE = "ti_holdout_v1";
const TENANT = "tenant_a";
const PROFILE = "eu-banking-default";

const recordedAt = (n: number): string =>
  new Date(Date.UTC(2026, 4, n, 0, 0, 0)).toISOString();

const buildScreen = (
  screenId: string,
  nodes: ReadonlyArray<{
    nodeId: string;
    nodeName: string;
    nodeType: string;
    text?: string;
  }>,
): IntentDerivationFigmaInput["screens"][number] => ({
  screenId,
  screenName: `Screen ${screenId}`,
  nodes: nodes.map((node) => ({
    nodeId: node.nodeId,
    nodeName: node.nodeName,
    nodeType: node.nodeType,
    ...(node.text !== undefined ? { text: node.text } : {}),
  })),
});

const buildFigma = (
  screens: ReadonlyArray<IntentDerivationFigmaInput["screens"][number]>,
): IntentDerivationFigmaInput => ({
  source: { kind: "figma_local_json" },
  screens: [...screens],
});

const buildTestCase = (
  id: string,
  riskCategory: TestCaseRiskCategory,
): GeneratedTestCase => ({
  id,
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: `Case ${id}`,
  objective: "exercise the field",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory,
  technique: "equivalence_partitioning",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: "submit" }],
  expectedResults: ["ok"],
  figmaTraceRefs: [],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: [],
    coveredActionIds: [],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.9,
  },
  reviewState: "draft",
  audit: {
    jobId: "job-1",
    generatedAt: "2026-05-10T00:00:00.000Z",
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    redactionPolicyVersion: REDACTION_POLICY_VERSION,
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    cacheHit: false,
    cacheKey: "key-1",
    inputHash: "ihash",
    promptHash: "phash",
    schemaHash: "shash",
  },
});

const buildTestCaseList = (
  jobId: string,
  cases: ReadonlyArray<GeneratedTestCase>,
): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId,
  testCases: [...cases],
});

const baselineJob = (): JobDistributionInput => ({
  figma: buildFigma([
    buildScreen("home", [
      { nodeId: "n1", nodeName: "Login", nodeType: "BUTTON", text: "Login" },
      { nodeId: "n2", nodeName: "Username", nodeType: "INPUT", text: "User" },
    ]),
    buildScreen("settings", [
      { nodeId: "n3", nodeName: "Save", nodeType: "BUTTON", text: "Save" },
    ]),
  ]),
  generatedTestCases: buildTestCaseList("job-base", [
    buildTestCase("c-1", "low"),
    buildTestCase("c-2", "medium"),
    buildTestCase("c-3", "high"),
  ]),
});

const driftedJob = (): JobDistributionInput => ({
  figma: buildFigma([
    buildScreen("payment", [
      {
        nodeId: "p1",
        nodeName: "TransferAmountIBAN",
        nodeType: "RADIO_GROUP",
        text: "Transfer to IBAN amount",
      },
      {
        nodeId: "p2",
        nodeName: "ExchangeRateDisplay",
        nodeType: "DROPDOWN",
        text: "FX rate live ticker",
      },
      {
        nodeId: "p3",
        nodeName: "TaxCalculator",
        nodeType: "DROPDOWN",
        text: "Tax bracket selector",
      },
    ]),
  ]),
  generatedTestCases: buildTestCaseList("job-drift", [
    buildTestCase("d-1", "regulated_data"),
    buildTestCase("d-2", "regulated_data"),
    buildTestCase("d-3", "financial_transaction"),
    buildTestCase("d-4", "financial_transaction"),
  ]),
});

test("computeKlDivergence is zero for identical histograms and symmetric", () => {
  const a = [3, 7, 2, 0];
  const b = [6, 14, 4, 0];
  const aa = computeKlDivergence(a, a);
  assert.equal(aa, 0);
  const ab = computeKlDivergence(a, b);
  const ba = computeKlDivergence(b, a);
  assert.ok(Math.abs(ab - ba) < 1e-9, "symmetric KL must be order-independent");
});

test("computeKlDivergence rejects mismatched lengths", () => {
  assert.throws(() => computeKlDivergence([1, 2], [1, 2, 3]));
});

test("computeKlDivergence returns 0 for two empty histograms", () => {
  assert.equal(computeKlDivergence([], []), 0);
});

test("recordInputDistributionSnapshot produces a deterministic snapshot", async () => {
  const snapshotA = await recordInputDistributionSnapshot({
    fixtureSuiteId: SUITE,
    recordedAt: recordedAt(1),
    jobs: [baselineJob()],
  });
  const snapshotB = await recordInputDistributionSnapshot({
    fixtureSuiteId: SUITE,
    recordedAt: recordedAt(1),
    jobs: [baselineJob()],
  });
  assert.deepEqual(snapshotA, snapshotB);
  assert.equal(
    snapshotA.tokenHistogram.length,
    DISTRIBUTION_SHIFT_TOKEN_BUCKET_COUNT,
  );
  assert.equal(snapshotA.screenCount, 2);
  assert.equal(snapshotA.testCaseCount, 3);
  assert.equal(snapshotA.labelHistogram.low, 1);
  assert.equal(snapshotA.labelHistogram.medium, 1);
  assert.equal(snapshotA.labelHistogram.high, 1);
  assert.equal(snapshotA.labelHistogram.regulated_data, 0);
  assert.equal(snapshotA.labelHistogram.financial_transaction, 0);
  assert.equal(snapshotA.irShapeHistogram.BUTTON, 2);
  assert.equal(snapshotA.irShapeHistogram.INPUT, 1);
});

test("recordInputDistributionSnapshot rejects malformed fixtureSuiteId", async () => {
  await assert.rejects(
    recordInputDistributionSnapshot({
      fixtureSuiteId: "bad/suite id",
      recordedAt: recordedAt(1),
      jobs: [baselineJob()],
    }),
  );
});

test("evaluateDistributionShiftReport returns warming with no findings on first record", () => {
  const baseline = emptyDistributionShiftBaselineState({
    tenantId: TENANT,
    policyProfileId: PROFILE,
    fixtureSuiteId: SUITE,
  });
  // Build a snapshot off-line via the deterministic builder.
  const snapshot: DistributionShiftSnapshot = {
    recordedAt: recordedAt(1),
    fixtureSuiteId: SUITE,
    jobCount: 1,
    screenCount: 1,
    testCaseCount: 1,
    tokenHistogram: new Array(DISTRIBUTION_SHIFT_TOKEN_BUCKET_COUNT).fill(0),
    labelHistogram: {
      low: 1,
      medium: 0,
      high: 0,
      regulated_data: 0,
      financial_transaction: 0,
    },
    irShapeHistogram: { BUTTON: 1 },
  };
  const report = evaluateDistributionShiftReport({ baseline, snapshot });
  assert.equal(report.baselineStatus, "warming");
  assert.deepEqual(report.findings, []);
  assert.equal(report.klMeasurements.tokenKl, 0);
});

test("evaluateDistributionShiftReport flags KL > threshold for shifted inputs", async () => {
  // Warm baseline with three identical baseline-like records, each scaled
  // up so the token counts are realistic (hundreds per snapshot) — at
  // unit-test scale the 256-bucket histogram with Laplace smoothing only
  // produces measurable KL once each bucket has more than ~1 sample of
  // expected frequency.
  const baselineJobsPerSnapshot = Array.from({ length: 30 }, () =>
    baselineJob(),
  );
  const driftedJobsPerSnapshot = Array.from({ length: 30 }, () => driftedJob());
  let state: DistributionShiftBaselineState =
    emptyDistributionShiftBaselineState({
      tenantId: TENANT,
      policyProfileId: PROFILE,
      fixtureSuiteId: SUITE,
    });
  for (let day = 1; day <= 3; day += 1) {
    const baselineSnapshot = await recordInputDistributionSnapshot({
      fixtureSuiteId: SUITE,
      recordedAt: recordedAt(day),
      jobs: baselineJobsPerSnapshot,
    });
    state = appendDistributionShiftBaselineRecord(state, baselineSnapshot);
  }
  const driftedSnapshot = await recordInputDistributionSnapshot({
    fixtureSuiteId: SUITE,
    recordedAt: recordedAt(4),
    jobs: driftedJobsPerSnapshot,
  });
  const report = evaluateDistributionShiftReport({
    baseline: state,
    snapshot: driftedSnapshot,
  });
  assert.equal(report.baselineStatus, "ready");
  const tokenFinding = report.findings.find((f) => f.kind === "token_kl_shift");
  const labelFinding = report.findings.find((f) => f.kind === "label_kl_shift");
  const irFinding = report.findings.find((f) => f.kind === "ir_shape_kl_shift");
  assert.ok(tokenFinding, "expected token KL shift");
  assert.ok(labelFinding, "expected label KL shift");
  assert.ok(irFinding, "expected IR-shape KL shift");
  for (const finding of [tokenFinding, labelFinding, irFinding]) {
    assert.equal(finding!.severity, "warning");
    assert.equal(finding!.klThreshold, DISTRIBUTION_SHIFT_KL_THRESHOLD);
    assert.ok(
      finding!.klDivergence! > DISTRIBUTION_SHIFT_KL_THRESHOLD,
      `${finding!.kind} KL ${finding!.klDivergence} should exceed ${DISTRIBUTION_SHIFT_KL_THRESHOLD}`,
    );
  }
});

test("evaluateDistributionShiftReport stays quiet when current matches baseline", async () => {
  let state: DistributionShiftBaselineState =
    emptyDistributionShiftBaselineState({
      tenantId: TENANT,
      policyProfileId: PROFILE,
      fixtureSuiteId: SUITE,
    });
  for (let day = 1; day <= 5; day += 1) {
    const snapshot = await recordInputDistributionSnapshot({
      fixtureSuiteId: SUITE,
      recordedAt: recordedAt(day),
      jobs: [baselineJob()],
    });
    state = appendDistributionShiftBaselineRecord(state, snapshot);
  }
  const matchingSnapshot = await recordInputDistributionSnapshot({
    fixtureSuiteId: SUITE,
    recordedAt: recordedAt(6),
    jobs: [baselineJob()],
  });
  const report = evaluateDistributionShiftReport({
    baseline: state,
    snapshot: matchingSnapshot,
  });
  assert.equal(report.findings.length, 0);
  assert.ok(report.klMeasurements.tokenKl < DISTRIBUTION_SHIFT_KL_THRESHOLD);
  assert.ok(report.klMeasurements.labelKl < DISTRIBUTION_SHIFT_KL_THRESHOLD);
  assert.ok(report.klMeasurements.irShapeKl < DISTRIBUTION_SHIFT_KL_THRESHOLD);
});

const stableEmbeddingProvider = (
  identifier: string,
  scaling: number,
): DistributionShiftEmbeddingProvider => ({
  identifier,
  async embed(text) {
    // Deterministic 4-dim "embedding": four character-class counts scaled.
    const lower = text.toLowerCase();
    let alpha = 0;
    let digit = 0;
    let space = 0;
    let other = 0;
    for (const ch of lower) {
      const c = ch.charCodeAt(0);
      if (c >= 97 && c <= 122) alpha += 1;
      else if (c >= 48 && c <= 57) digit += 1;
      else if (ch === " " || ch === "\n" || ch === "\t") space += 1;
      else other += 1;
    }
    const total = alpha + digit + space + other || 1;
    return [
      (alpha / total) * scaling,
      (digit / total) * scaling,
      (space / total) * scaling,
      (other / total) * scaling,
    ];
  },
});

test("recordInputDistributionSnapshot uses the embedding provider when supplied", async () => {
  const provider = stableEmbeddingProvider("phi-4-mini-instruct", 1);
  const snapshot = await recordInputDistributionSnapshot({
    fixtureSuiteId: SUITE,
    recordedAt: recordedAt(1),
    jobs: [baselineJob()],
    embeddingProvider: provider,
  });
  assert.ok(snapshot.embeddingCentroid !== undefined);
  assert.equal(snapshot.embeddingCentroid!.length, 4);
  assert.equal(snapshot.embeddingProviderId, "phi-4-mini-instruct");
});

test("evaluateDistributionShiftReport flags embedding centroid > 2σ", async () => {
  const stableProvider = stableEmbeddingProvider("phi-4-mini-instruct", 1);
  let state: DistributionShiftBaselineState =
    emptyDistributionShiftBaselineState({
      tenantId: TENANT,
      policyProfileId: PROFILE,
      fixtureSuiteId: SUITE,
    });
  for (let day = 1; day <= 4; day += 1) {
    const snapshot = await recordInputDistributionSnapshot({
      fixtureSuiteId: SUITE,
      recordedAt: recordedAt(day),
      jobs: [baselineJob()],
      embeddingProvider: stableProvider,
    });
    state = appendDistributionShiftBaselineRecord(state, snapshot);
  }
  // Create a sharp shift: scale every component up by 100×, blowing past the
  // historical L2-distance distribution which sat near zero.
  const shiftedProvider = stableEmbeddingProvider("phi-4-mini-instruct", 100);
  const shiftedSnapshot = await recordInputDistributionSnapshot({
    fixtureSuiteId: SUITE,
    recordedAt: recordedAt(5),
    jobs: [baselineJob()],
    embeddingProvider: shiftedProvider,
  });
  const report = evaluateDistributionShiftReport({
    baseline: state,
    snapshot: shiftedSnapshot,
  });
  const centroidFinding = report.findings.find(
    (f) => f.kind === "embedding_centroid_shift",
  );
  assert.ok(centroidFinding, "expected embedding centroid shift finding");
  assert.equal(centroidFinding!.severity, "error");
  assert.equal(
    centroidFinding!.centroidSigmaThreshold,
    DISTRIBUTION_SHIFT_CENTROID_SIGMA_THRESHOLD,
  );
  // The historical centroids are byte-identical (deterministic provider on
  // the same fixture), so the historical L2 standard deviation is zero and
  // the σ-units value is undefined. The detector falls back to the
  // L2-vs-epsilon test for that branch — assert the L2 shift is large.
  assert.ok(
    centroidFinding!.centroidShiftL2! > 0.1,
    `expected non-trivial L2 shift, got ${centroidFinding!.centroidShiftL2}`,
  );
  assert.equal(
    centroidFinding!.centroidShiftSigma,
    undefined,
    "zero-variance historical scatter must not report a fake sigma=0 value",
  );
  assert.equal(centroidFinding!.embeddingProviderId, "phi-4-mini-instruct");
  // Issue #2120 audit follow-up: the centroidMeasurement struct on the
  // report must also OMIT sigma when historical std-dev is zero — a
  // prior bug fell back to `sigma: 0`, silently suppressing the
  // +Infinity signal that the σ branch could not express.
  assert.ok(report.centroidMeasurement !== undefined);
  assert.equal(
    report.centroidMeasurement!.sigma,
    undefined,
    "zero-variance historical scatter must not report a fake sigma=0 in centroidMeasurement",
  );
  assert.ok(
    report.centroidMeasurement!.l2Distance > 0.1,
    "centroidMeasurement.l2Distance must reflect the real shift",
  );
});

test("evaluateDistributionShiftReport flags centroid shift in σ-units when historical scatter is non-zero", async () => {
  // Build a baseline whose centroids drift slightly between days so the
  // historical L2 distribution has a real (non-zero) standard deviation —
  // this is the σ-arm of the alert policy.
  let state: DistributionShiftBaselineState =
    emptyDistributionShiftBaselineState({
      tenantId: TENANT,
      policyProfileId: PROFILE,
      fixtureSuiteId: SUITE,
    });
  for (let day = 1; day <= 4; day += 1) {
    // Each day's provider scales by a tiny different factor — produces
    // small inter-day centroid drift.
    const provider = stableEmbeddingProvider(
      "phi-4-mini-instruct",
      1 + day * 0.001,
    );
    const snapshot = await recordInputDistributionSnapshot({
      fixtureSuiteId: SUITE,
      recordedAt: recordedAt(day),
      jobs: [baselineJob()],
      embeddingProvider: provider,
    });
    state = appendDistributionShiftBaselineRecord(state, snapshot);
  }
  const shiftedProvider = stableEmbeddingProvider("phi-4-mini-instruct", 5);
  const shiftedSnapshot = await recordInputDistributionSnapshot({
    fixtureSuiteId: SUITE,
    recordedAt: recordedAt(5),
    jobs: [baselineJob()],
    embeddingProvider: shiftedProvider,
  });
  const report = evaluateDistributionShiftReport({
    baseline: state,
    snapshot: shiftedSnapshot,
  });
  const centroidFinding = report.findings.find(
    (f) => f.kind === "embedding_centroid_shift",
  );
  assert.ok(centroidFinding, "expected embedding centroid shift finding");
  assert.ok(report.centroidMeasurement !== undefined);
  assert.ok(report.centroidMeasurement!.historyL2StdDev > 0);
  assert.ok(
    centroidFinding!.centroidShiftSigma! >
      DISTRIBUTION_SHIFT_CENTROID_SIGMA_THRESHOLD,
    `expected sigma to exceed threshold, got ${centroidFinding!.centroidShiftSigma}`,
  );
});

test("appendDistributionShiftBaselineRecord trims to the history window", async () => {
  let state: DistributionShiftBaselineState =
    emptyDistributionShiftBaselineState({
      tenantId: TENANT,
      policyProfileId: PROFILE,
      fixtureSuiteId: SUITE,
    });
  for (let day = 1; day <= DISTRIBUTION_SHIFT_HISTORY_DAYS + 5; day += 1) {
    const snapshot: DistributionShiftSnapshot = {
      recordedAt: recordedAt(day),
      fixtureSuiteId: SUITE,
      jobCount: 1,
      screenCount: 1,
      testCaseCount: 0,
      tokenHistogram: new Array(DISTRIBUTION_SHIFT_TOKEN_BUCKET_COUNT).fill(0),
      labelHistogram: {
        low: 1,
        medium: 0,
        high: 0,
        regulated_data: 0,
        financial_transaction: 0,
      },
      irShapeHistogram: {},
    };
    state = appendDistributionShiftBaselineRecord(state, snapshot);
  }
  assert.equal(state.records.length, DISTRIBUTION_SHIFT_HISTORY_DAYS);
});

test("baseline persistence round-trips byte-stable canonical JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "distribution-shift-baseline-"));
  try {
    let state = emptyDistributionShiftBaselineState({
      tenantId: TENANT,
      policyProfileId: PROFILE,
      fixtureSuiteId: SUITE,
    });
    const snapshot = await recordInputDistributionSnapshot({
      fixtureSuiteId: SUITE,
      recordedAt: recordedAt(1),
      jobs: [baselineJob()],
    });
    state = appendDistributionShiftBaselineRecord(state, snapshot);
    const path = await writeDistributionShiftBaselineState({
      runtimeRoot: dir,
      tenantId: TENANT,
      policyProfileId: PROFILE,
      fixtureSuiteId: SUITE,
      state,
    });
    assert.equal(
      path,
      distributionShiftBaselinePath({
        runtimeRoot: dir,
        tenantId: TENANT,
        policyProfileId: PROFILE,
        fixtureSuiteId: SUITE,
      }),
    );
    const reloaded = await loadDistributionShiftBaselineState({
      runtimeRoot: dir,
      tenantId: TENANT,
      policyProfileId: PROFILE,
      fixtureSuiteId: SUITE,
    });
    assert.equal(reloaded.records.length, 1);
    assert.equal(reloaded.records[0].fixtureSuiteId, SUITE);
    assert.equal(reloaded.schemaVersion, DISTRIBUTION_SHIFT_SCHEMA_VERSION);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadDistributionShiftBaselineState returns an empty state when the file is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "distribution-shift-empty-"));
  try {
    const state = await loadDistributionShiftBaselineState({
      runtimeRoot: dir,
      tenantId: TENANT,
      policyProfileId: PROFILE,
      fixtureSuiteId: SUITE,
    });
    assert.equal(state.records.length, 0);
    assert.equal(state.schemaVersion, DISTRIBUTION_SHIFT_SCHEMA_VERSION);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("distributionShiftBaselinePath rejects unstable identifiers", () => {
  assert.throws(() =>
    distributionShiftBaselinePath({
      runtimeRoot: "/tmp",
      tenantId: "tenant a",
      policyProfileId: PROFILE,
      fixtureSuiteId: SUITE,
    }),
  );
});

test("buildDistributionShiftDashboard summarises the per-record KL trend", async () => {
  let state: DistributionShiftBaselineState =
    emptyDistributionShiftBaselineState({
      tenantId: TENANT,
      policyProfileId: PROFILE,
      fixtureSuiteId: SUITE,
    });
  for (let day = 1; day <= 3; day += 1) {
    const snapshot = await recordInputDistributionSnapshot({
      fixtureSuiteId: SUITE,
      recordedAt: recordedAt(day),
      jobs: [baselineJob()],
    });
    state = appendDistributionShiftBaselineRecord(state, snapshot);
  }
  const driftSnapshot = await recordInputDistributionSnapshot({
    fixtureSuiteId: SUITE,
    recordedAt: recordedAt(4),
    jobs: [driftedJob()],
  });
  const report = evaluateDistributionShiftReport({
    baseline: state,
    snapshot: driftSnapshot,
  });
  state = appendDistributionShiftBaselineRecord(state, driftSnapshot);
  const dashboard = buildDistributionShiftDashboard({
    baseline: state,
    report,
  });
  assert.equal(dashboard.fixtureSuiteId, SUITE);
  assert.equal(dashboard.thresholds.kl, DISTRIBUTION_SHIFT_KL_THRESHOLD);
  assert.equal(
    dashboard.thresholds.centroidSigma,
    DISTRIBUTION_SHIFT_CENTROID_SIGMA_THRESHOLD,
  );
  assert.equal(dashboard.history.length, state.records.length);
  // The first entry has no past — KL must be 0.
  assert.equal(dashboard.history[0].tokenKl, 0);
  assert.equal(dashboard.history[0].labelKl, 0);
  assert.equal(dashboard.history[0].irShapeKl, 0);
  // The drifted record should be the largest-KL entry.
  const driftedEntry = dashboard.history[dashboard.history.length - 1];
  assert.ok(driftedEntry.tokenKl > 0);
  assert.equal(dashboard.findings.length, report.findings.length);
});

test("artifact writers persist canonical JSON byte-stably", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "distribution-shift-artifacts-"));
  try {
    let state: DistributionShiftBaselineState =
      emptyDistributionShiftBaselineState({
        tenantId: TENANT,
        policyProfileId: PROFILE,
        fixtureSuiteId: SUITE,
      });
    for (let day = 1; day <= 2; day += 1) {
      const snapshot = await recordInputDistributionSnapshot({
        fixtureSuiteId: SUITE,
        recordedAt: recordedAt(day),
        jobs: [baselineJob()],
      });
      state = appendDistributionShiftBaselineRecord(state, snapshot);
    }
    const driftSnapshot = await recordInputDistributionSnapshot({
      fixtureSuiteId: SUITE,
      recordedAt: recordedAt(3),
      jobs: [driftedJob()],
    });
    const report = evaluateDistributionShiftReport({
      baseline: state,
      snapshot: driftSnapshot,
    });
    state = appendDistributionShiftBaselineRecord(state, driftSnapshot);
    const dashboard = buildDistributionShiftDashboard({
      baseline: state,
      report,
    });

    const reportPath = await writeDistributionShiftReport({ runDir, report });
    const dashboardPath = await writeDistributionShiftDashboard({
      runDir,
      dashboard,
    });
    const sink = createFileDistributionShiftAlertSink(runDir);
    const alertPath = await sink.publish({
      schemaVersion: DISTRIBUTION_SHIFT_SCHEMA_VERSION,
      generatedAt: report.generatedAt,
      fixtureSuiteId: report.fixtureSuiteId,
      alerts: report.findings,
    });

    assert.equal(reportPath, join(runDir, DISTRIBUTION_SHIFT_REPORT_FILENAME));
    assert.equal(
      dashboardPath,
      join(runDir, DISTRIBUTION_SHIFT_DASHBOARD_FILENAME),
    );
    assert.equal(alertPath, join(runDir, DISTRIBUTION_SHIFT_ALERTS_FILENAME));

    const reportRaw = await readFile(reportPath, "utf8");
    const dashboardRaw = await readFile(dashboardPath, "utf8");
    const alertsRaw = await readFile(alertPath!, "utf8");

    assert.ok(reportRaw.endsWith("\n"));
    assert.ok(dashboardRaw.endsWith("\n"));
    assert.ok(alertsRaw.endsWith("\n"));

    const reportParsed = JSON.parse(reportRaw);
    assert.equal(reportParsed.fixtureSuiteId, SUITE);
    assert.equal(reportParsed.schemaVersion, DISTRIBUTION_SHIFT_SCHEMA_VERSION);

    const dashboardParsed = JSON.parse(dashboardRaw);
    assert.equal(dashboardParsed.fixtureSuiteId, SUITE);

    const alertsParsed = JSON.parse(alertsRaw);
    assert.equal(alertsParsed.fixtureSuiteId, SUITE);
    assert.ok(Array.isArray(alertsParsed.alerts));
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
