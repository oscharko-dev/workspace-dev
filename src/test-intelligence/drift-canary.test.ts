import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadBaselineArchetypeFixture } from "./baseline-fixtures.js";
import {
  buildDriftCanaryFixtureSnapshot,
  readDriftCanaryFixtureIntentOverride,
} from "./drift-canary-fixture-snapshot.js";
import {
  appendDriftBaselineRecord,
  classifyCrossFamilyCorrelatedDrift,
  createFileDriftAlertSink,
  DRIFT_ALERTS_ARTIFACT_FILENAME,
  DRIFT_CANARY_BRIER_ABSOLUTE_THRESHOLD,
  DRIFT_CANARY_CANARY_SET_ID,
  DRIFT_CANARY_HOLDOUT_FIXTURE_IDS,
  emptyBaselineState,
  evaluateDriftReport,
  loadDriftBaselineState,
  PROVIDER_FINGERPRINT_PROMPTS,
  writeDriftBaselineState,
} from "./drift-canary.js";
import {
  computeBrierScore,
  buildReliabilityDiagram,
  computeExpectedCalibrationError,
} from "./calibration-metrics.js";
import { deriveBusinessTestIntentIr } from "./intent-derivation.js";

test("drift-canary: computeBrierScore returns the mean squared error", () => {
  assert.equal(
    computeBrierScore([
      { confidence: 0.8, label: 1 },
      { confidence: 0.2, label: 0 },
      { confidence: 0.4, label: 1 },
    ]),
    0.146667,
  );
});

test("drift-canary: computeExpectedCalibrationError bins confidence deltas", () => {
  assert.equal(
    computeExpectedCalibrationError([
      { confidence: 0.1, label: 0 },
      { confidence: 0.2, label: 0 },
      { confidence: 0.9, label: 1 },
      { confidence: 0.8, label: 1 },
    ]),
    0.15,
  );
});

test("drift-canary: computeExpectedCalibrationError applies debiasing within populated bins", () => {
  const samples = [
    { confidence: 0.05, label: 0 as const },
    { confidence: 0.05, label: 1 as const },
    { confidence: 0.15, label: 1 as const },
  ];
  const diagram = buildReliabilityDiagram(samples);

  assert.equal(computeExpectedCalibrationError(samples), 0.560599);
  assert.equal(diagram.pluginEce, 0.583333);
  assert.equal(diagram.debiasedEce, 0.560599);
  assert.equal(diagram.bins[0]?.sampleCount, 2);
  assert.equal(diagram.bins[0]?.debiasedAbsoluteCalibrationGap, 0.415899);
});

test("drift-canary: computeExpectedCalibrationError stays decile-bucketed at a bin boundary", () => {
  const samples = [
    { confidence: 0.49, label: 0 as const },
    { confidence: 0.51, label: 1 as const },
  ];

  assert.equal(computeExpectedCalibrationError(samples), 0.49);
  assert.equal(computeExpectedCalibrationError(samples, 5), 0);
});

test("drift-canary: holdout fixture set is explicitly pinned", () => {
  assert.deepEqual(DRIFT_CANARY_HOLDOUT_FIXTURE_IDS, [
    "baseline-simple-form",
    "baseline-calculation",
    "baseline-optional-fields",
    "baseline-multi-context",
    "baseline-ambiguous-rules",
  ]);
});

test("drift-canary: provider fingerprint prompts remain five text-safe probes", () => {
  assert.equal(PROVIDER_FINGERPRINT_PROMPTS.length, 5);
  assert.equal(
    PROVIDER_FINGERPRINT_PROMPTS.every(
      (prompt) => prompt.expectsImageInput === false,
    ),
    true,
  );
});

test("drift-canary: fixture snapshots preserve pinned holdout intent semantics", async () => {
  for (const fixtureId of DRIFT_CANARY_HOLDOUT_FIXTURE_IDS) {
    const fixture = await loadBaselineArchetypeFixture(fixtureId);
    const snapshot = buildDriftCanaryFixtureSnapshot({
      fixtureId,
      fixture: fixture.figma,
      name: fixture.summary.archetype,
    });
    const override = readDriftCanaryFixtureIntentOverride(snapshot);
    assert.notEqual(override, undefined);
    assert.deepEqual(override, fixture.figma);
    assert.deepEqual(
      deriveBusinessTestIntentIr({ figma: override! }),
      deriveBusinessTestIntentIr({ figma: fixture.figma }),
    );
  }
});

test("drift-canary: metric drift alerts on >2σ changes and absolute Brier deltas", () => {
  const baseline = appendDriftBaselineRecord(
    appendDriftBaselineRecord(
      emptyBaselineState({
        tenantId: "default",
        policyProfileId: "eu-banking-default",
        canarySetId: DRIFT_CANARY_CANARY_SET_ID,
      }),
      {
        recordedAt: "2026-05-01T00:00:00.000Z",
        observations: [
          {
            deployment: "mistral-large-3",
            family: "mistral",
            metricName: "brier_score",
            riskCategory: "low",
            value: 0.1,
          },
        ],
        providerFingerprints: [],
      },
    ),
    {
      recordedAt: "2026-05-02T00:00:00.000Z",
      observations: [
        {
          deployment: "mistral-large-3",
          family: "mistral",
          metricName: "brier_score",
          riskCategory: "low",
          value: 0.11,
        },
      ],
      providerFingerprints: [],
    },
  );

  const evaluation = evaluateDriftReport({
    baseline,
    observations: [
      {
        deployment: "mistral-large-3",
        family: "mistral",
        metricName: "brier_score",
        riskCategory: "low",
        value: 0.22,
      },
    ],
    providerFingerprints: [],
  });

  assert.equal(evaluation.baselineStatus, "ready");
  assert.equal(
    evaluation.findings.some((finding) => finding.kind === "metric_shift"),
    true,
  );
  assert.equal(
    evaluation.findings.some(
      (finding) =>
        finding.kind === "brier_absolute_shift" &&
        finding.threshold === DRIFT_CANARY_BRIER_ABSOLUTE_THRESHOLD,
    ),
    true,
  );
});

test("drift-canary: absolute ECE threshold breaches fail the canary", () => {
  const evaluation = evaluateDriftReport({
    baseline: emptyBaselineState({
      tenantId: "default",
      policyProfileId: "eu-banking-default",
      canarySetId: DRIFT_CANARY_CANARY_SET_ID,
    }),
    observations: [
      {
        deployment: "mistral-large-3",
        family: "mistral",
        metricName: "ece",
        riskCategory: "regulated_data",
        value: 0.051,
      },
    ],
    providerFingerprints: [],
  });

  assert.equal(
    evaluation.findings.some(
      (finding) =>
        finding.kind === "ece_absolute_threshold" &&
        finding.riskCategory === "regulated_data" &&
        finding.threshold === 0.05,
    ),
    true,
  );
});

test("drift-canary: per-risk ECE findings stay risk-scoped and Brier keeps the absolute gate", () => {
  const baseline = appendDriftBaselineRecord(
    appendDriftBaselineRecord(
      emptyBaselineState({
        tenantId: "default",
        policyProfileId: "eu-banking-default",
        canarySetId: DRIFT_CANARY_CANARY_SET_ID,
      }),
      {
        recordedAt: "2026-05-01T00:00:00.000Z",
        observations: [
          {
            deployment: "mistral-large-3",
            family: "mistral",
            metricName: "ece",
            riskCategory: "regulated_data",
            value: 0.02,
          },
          {
            deployment: "mistral-large-3",
            family: "mistral",
            metricName: "brier_score",
            riskCategory: "regulated_data",
            value: 0.11,
          },
        ],
        providerFingerprints: [],
      },
    ),
    {
      recordedAt: "2026-05-02T00:00:00.000Z",
      observations: [
        {
          deployment: "mistral-large-3",
          family: "mistral",
          metricName: "ece",
          riskCategory: "regulated_data",
          value: 0.03,
        },
        {
          deployment: "mistral-large-3",
          family: "mistral",
          metricName: "brier_score",
          riskCategory: "regulated_data",
          value: 0.12,
        },
      ],
      providerFingerprints: [],
    },
  );

  const evaluation = evaluateDriftReport({
    baseline,
    observations: [
      {
        deployment: "mistral-large-3",
        family: "mistral",
        metricName: "ece",
        riskCategory: "regulated_data",
        value: 0.12,
      },
      {
        deployment: "mistral-large-3",
        family: "mistral",
        metricName: "brier_score",
        riskCategory: "regulated_data",
        value: 0.2,
      },
    ],
    providerFingerprints: [],
  });

  const eceFinding = evaluation.findings.find(
    (finding) =>
      finding.metricName === "ece" &&
      finding.riskCategory === "regulated_data" &&
      finding.kind === "metric_shift",
  );
  assert.notEqual(eceFinding, undefined);
  assert.equal(eceFinding?.threshold !== undefined, true);

  const brierFinding = evaluation.findings.find(
    (finding) =>
      finding.metricName === "brier_score" &&
      finding.riskCategory === "regulated_data" &&
      finding.kind === "brier_absolute_shift",
  );
  assert.notEqual(brierFinding, undefined);
  assert.equal(brierFinding?.threshold, DRIFT_CANARY_BRIER_ABSOLUTE_THRESHOLD);
});

test("drift-canary: provider fingerprint drift alerts when hashes change under a stable revision", () => {
  const baseline = appendDriftBaselineRecord(
    emptyBaselineState({
      tenantId: "default",
      policyProfileId: "eu-banking-default",
      canarySetId: DRIFT_CANARY_CANARY_SET_ID,
    }),
    {
      recordedAt: "2026-05-01T00:00:00.000Z",
      observations: [],
      providerFingerprints: [
        {
          deployment: "mistral-large-3",
          family: "mistral",
          role: "test_generation",
          promptId: "stable-ok-1",
          modelRevision: "mistral-large-3@rev",
          gatewayRelease: "gateway@rev",
          inputHash: "input-1",
          outputHash: "output-a",
          finishReason: "stop",
          inputTokens: 5,
          outputTokens: 3,
        },
      ],
    },
  );

  const evaluation = evaluateDriftReport({
    baseline,
    observations: [],
    providerFingerprints: [
      {
        deployment: "mistral-large-3",
        family: "mistral",
        role: "test_generation",
        promptId: "stable-ok-1",
        modelRevision: "mistral-large-3@rev",
        gatewayRelease: "gateway@rev",
        inputHash: "input-1",
        outputHash: "output-b",
        finishReason: "stop",
        inputTokens: 5,
        outputTokens: 4,
      },
    ],
  });

  assert.equal(
    evaluation.findings.some(
      (finding) => finding.kind === "provider_fingerprint_changed",
    ),
    true,
  );
  assert.equal(
    evaluation.findings.some(
      (finding) => finding.kind === "provider_token_count_changed",
    ),
    true,
  );
});

test("drift-canary: classifyCrossFamilyCorrelatedDrift emits a synthesized finding", () => {
  const correlated = classifyCrossFamilyCorrelatedDrift([
    {
      kind: "metric_shift",
      severity: "warning",
      message: "a",
      family: "mistral",
      metricName: "judge_accuracy",
      judge: "logic",
    },
    {
      kind: "metric_shift",
      severity: "warning",
      message: "b",
      family: "gpt-oss",
      metricName: "judge_accuracy",
      judge: "logic",
    },
  ]);

  assert.equal(correlated.length, 1);
  assert.equal(correlated[0]?.kind, "cross_family_correlated_drift");
});

test("drift-canary: writes and reloads baseline state atomically", async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "drift-canary-runtime-"));
  const state = appendDriftBaselineRecord(
    emptyBaselineState({
      tenantId: "default",
      policyProfileId: "eu-banking-default",
      canarySetId: DRIFT_CANARY_CANARY_SET_ID,
    }),
    {
      recordedAt: "2026-05-01T00:00:00.000Z",
      observations: [],
      providerFingerprints: [],
    },
  );
  await writeDriftBaselineState({
    runtimeRoot,
    tenantId: "default",
    policyProfileId: "eu-banking-default",
    canarySetId: DRIFT_CANARY_CANARY_SET_ID,
    state,
  });
  const loaded = await loadDriftBaselineState({
    runtimeRoot,
    tenantId: "default",
    policyProfileId: "eu-banking-default",
    canarySetId: DRIFT_CANARY_CANARY_SET_ID,
  });
  assert.deepEqual(loaded, state);
});

test("drift-canary: default alert sink writes drift-alerts.json", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "drift-canary-run-"));
  const sink = createFileDriftAlertSink(runDir);
  const outputPath = await sink.publish({
    schemaVersion: "1.0.0",
    generatedAt: "2026-05-09T00:00:00.000Z",
    canarySetId: DRIFT_CANARY_CANARY_SET_ID,
    alerts: [
      {
        kind: "metric_shift",
        severity: "warning",
        message: "shifted",
      },
    ],
  });
  assert.equal(outputPath, join(runDir, DRIFT_ALERTS_ARTIFACT_FILENAME));
  const persisted = JSON.parse(await readFile(outputPath!, "utf8")) as {
    alerts: Array<{ message: string }>;
  };
  assert.equal(persisted.alerts[0]?.message, "shifted");
});
