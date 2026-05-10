import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  GeneratedTestCase,
  LlmGenerationRequest,
  TestCasePolicyDecision,
  TestCasePolicyReport,
  TestCaseRiskCategory,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import {
  CALIBRATION_ECE_THRESHOLDS,
  CALIBRATION_HISTOGRAM_BIN_COUNT,
  CALIBRATION_MIN_SAMPLE_FLOOR,
  computeBrierScore,
  computeExpectedCalibrationError,
} from "./calibration-metrics.js";
export { computeBrierScore, computeExpectedCalibrationError } from "./calibration-metrics.js";
import {
  type BaselineArchetypeFixtureId,
} from "./baseline-fixtures.js";
import type { IntentDerivationFigmaInput } from "./intent-derivation.js";
import {
  computeFaithfulnessMetrics,
} from "./faithfulness-eval.js";
import {
  computeHallucinationMetrics,
} from "./hallucination-eval.js";
import type { JudgeCalibrationEvalArtifact } from "./judge-calibration-eval.js";
import type { LlmGatewayClient } from "./llm-gateway.js";
import type { RunFigmaToQcTestCasesResult } from "./production-runner.js";

export const DRIFT_CANARY_SCHEMA_VERSION = "1.0.0" as const;
export const DRIFT_REPORT_ARTIFACT_FILENAME = "drift-report.json" as const;
export const DRIFT_ALERTS_ARTIFACT_FILENAME = "drift-alerts.json" as const;
export const DRIFT_BASELINE_FILENAME = "baseline.json" as const;
export const DRIFT_CANARY_BASELINES_DIRNAME = "drift-canaries" as const;
export const DRIFT_CANARY_CANARY_SET_ID = "ti-holdout-5-v1" as const;
export const DRIFT_CANARY_HISTORY_DAYS = 30 as const;
export const DRIFT_CANARY_SIGMA_THRESHOLD = 2 as const;
export const DRIFT_CANARY_BRIER_ABSOLUTE_THRESHOLD = 0.05 as const;
export const DRIFT_CANARY_EPSILON = 0.000001 as const;

export const DRIFT_CANARY_HOLDOUT_FIXTURE_IDS: ReadonlyArray<BaselineArchetypeFixtureId> =
  Object.freeze([
    "baseline-simple-form",
    "baseline-calculation",
    "baseline-optional-fields",
    "baseline-multi-context",
    "baseline-ambiguous-rules",
  ] satisfies readonly BaselineArchetypeFixtureId[]);

export type DriftCanaryMetricName =
  | "brier_score"
  | "ece"
  | "faithfulness_field_coverage"
  | "faithfulness_action_coverage"
  | "faithfulness_trace_fidelity"
  | "faithfulness_fallback_rate"
  | "hallucination_rate"
  | "judge_accuracy"
  | "judge_false_positive_rate"
  | "judge_false_negative_rate";

export interface DriftMetricObservation {
  readonly deployment: string;
  readonly family: string;
  readonly metricName: DriftCanaryMetricName;
  readonly value: number;
  readonly riskCategory?: TestCaseRiskCategory;
  readonly judge?: "logic" | "faithfulness";
  readonly sampleCount?: number;
}

export interface DriftBaselineRecord {
  readonly recordedAt: string;
  readonly observations: ReadonlyArray<DriftMetricObservation>;
  readonly providerFingerprints: ReadonlyArray<ProviderFingerprintObservation>;
}

export interface DriftBaselineState {
  readonly schemaVersion: typeof DRIFT_CANARY_SCHEMA_VERSION;
  readonly tenantId: string;
  readonly policyProfileId: string;
  readonly canarySetId: string;
  readonly records: ReadonlyArray<DriftBaselineRecord>;
}

export type DriftFindingKind =
  | "metric_shift"
  | "brier_absolute_shift"
  | "ece_absolute_threshold"
  | "provider_fingerprint_changed"
  | "provider_token_count_changed"
  | "cross_family_correlated_drift";

export interface DriftFinding {
  readonly kind: DriftFindingKind;
  readonly severity: "warning" | "error";
  readonly message: string;
  readonly deployment?: string;
  readonly family?: string;
  readonly metricName?: DriftCanaryMetricName;
  readonly riskCategory?: TestCaseRiskCategory;
  readonly judge?: "logic" | "faithfulness";
  readonly currentValue?: number;
  readonly baselineMean?: number;
  readonly baselineStdDev?: number;
  readonly delta?: number;
  readonly threshold?: number;
}

export interface ProviderFingerprintPrompt {
  readonly promptId: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly expectsImageInput: boolean;
}

export interface ProviderFingerprintObservation {
  readonly deployment: string;
  readonly family: string;
  readonly role: string;
  readonly promptId: string;
  readonly modelRevision: string;
  readonly gatewayRelease: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly finishReason: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface DriftReport {
  readonly schemaVersion: typeof DRIFT_CANARY_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly canarySetId: string;
  readonly holdoutFixtureIds: ReadonlyArray<BaselineArchetypeFixtureId>;
  readonly observations: ReadonlyArray<DriftMetricObservation>;
  readonly providerFingerprints: ReadonlyArray<ProviderFingerprintObservation>;
  readonly findings: ReadonlyArray<DriftFinding>;
  readonly baselineStatus: "warming" | "ready";
}

export interface DriftAlert {
  readonly schemaVersion: typeof DRIFT_CANARY_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly canarySetId: string;
  readonly alerts: ReadonlyArray<DriftFinding>;
}

export interface DriftAlertSink {
  publish(input: DriftAlert): Promise<string | undefined>;
}

export interface CanaryFixtureRun {
  readonly deployment: string;
  readonly fixtureId: BaselineArchetypeFixtureId;
  readonly fixture: IntentDerivationFigmaInput;
  readonly result: RunFigmaToQcTestCasesResult;
}

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9p2J1XcAAAAASUVORK5CYII=";

export const PROVIDER_FINGERPRINT_PROMPTS: ReadonlyArray<ProviderFingerprintPrompt> =
  Object.freeze([
    {
      promptId: "stable-ok-1",
      systemPrompt: "Return compact JSON only.",
      userPrompt: 'Return exactly {"answer":"OK"}',
      expectsImageInput: false,
    },
    {
      promptId: "stable-ok-2",
      systemPrompt: "Return compact JSON only.",
      userPrompt: 'Return exactly {"answer":"PASS"}',
      expectsImageInput: false,
    },
    {
      promptId: "stable-code-3",
      systemPrompt: "Return compact JSON only.",
      userPrompt: 'Return exactly {"answer":"A1"}',
      expectsImageInput: false,
    },
    {
      promptId: "stable-state-4",
      systemPrompt: "Return compact JSON only.",
      userPrompt: 'Return exactly {"answer":"VISIBLE"}',
      expectsImageInput: false,
    },
    {
      promptId: "stable-state-5",
      systemPrompt: "Return compact JSON only.",
      userPrompt: 'Return exactly {"answer":"READY"}',
      expectsImageInput: false,
    },
  ]);

const STABLE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/u;

const round6 = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;

const variance = (values: readonly number[], mean: number): number => {
  if (values.length <= 1) return 0;
  let total = 0;
  for (const value of values) {
    const delta = value - mean;
    total += delta * delta;
  }
  return total / (values.length - 1);
};

const stddev = (values: readonly number[], mean: number): number =>
  round6(Math.sqrt(variance(values, mean)));

const mean = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : round6(values.reduce((sum, value) => sum + value, 0) / values.length);

export const familyForDeployment = (deployment: string): string => {
  const normalized = deployment.trim().toLowerCase();
  if (normalized.startsWith("mistral")) return "mistral";
  if (normalized.startsWith("gpt-oss")) return "gpt-oss";
  if (normalized.startsWith("phi")) return "phi";
  if (normalized.startsWith("llama")) return "llama";
  return "other";
};

const metricKey = (observation: DriftMetricObservation): string =>
  [
    observation.deployment,
    observation.family,
    observation.metricName,
    observation.riskCategory ?? "",
    observation.judge ?? "",
  ].join("\u0000");

const fingerprintKey = (observation: ProviderFingerprintObservation): string =>
  [
    observation.deployment,
    observation.role,
    observation.promptId,
    observation.family,
  ].join("\u0000");

const decisionByTestCaseId = (
  report: TestCasePolicyReport,
): ReadonlyMap<string, TestCasePolicyDecision> =>
  new Map(report.decisions.map((entry) => [entry.testCaseId, entry.decision]));

const confidenceForCase = (testCase: GeneratedTestCase): number =>
  typeof testCase.confidence === "number"
    ? testCase.confidence
    : typeof testCase.qualitySignals.confidence === "number"
      ? testCase.qualitySignals.confidence
      : 0;

export const computeDriftCanaryMetrics = (input: {
  deployment: string;
  runs: ReadonlyArray<CanaryFixtureRun>;
}): ReadonlyArray<DriftMetricObservation> => {
  const family = familyForDeployment(input.deployment);
  const samplesByRisk = new Map<
    TestCaseRiskCategory,
    Array<{ confidence: number; label: 0 | 1 }>
  >();
  let fieldCoverageTotal = 0;
  let actionCoverageTotal = 0;
  let traceFidelityTotal = 0;
  let hallucinationTotal = 0;
  let faithfulnessFallbackCount = 0;

  for (const run of input.runs) {
    const decisions = decisionByTestCaseId(run.result.policy);
    const samples = run.result.generatedTestCases.testCases.map((testCase) => ({
      riskCategory: testCase.riskCategory,
      confidence: confidenceForCase(testCase),
      label: decisions.get(testCase.id) === "approved" ? (1 as const) : (0 as const),
    }));
    for (const sample of samples) {
      const bucket = samplesByRisk.get(sample.riskCategory) ?? [];
      bucket.push({ confidence: sample.confidence, label: sample.label });
      samplesByRisk.set(sample.riskCategory, bucket);
    }

    const knownNodeIds = collectKnownNodeIds(run.fixture);
    const knownScreenIds = run.fixture.screens.map((screen) => screen.screenId);
    const faithfulnessMetrics = computeFaithfulnessMetrics({
      intent: run.result.intent,
      generatedList: run.result.generatedTestCases,
      knownFigmaNodeIds: knownNodeIds,
      knownScreenIds,
    });
    const hallucinationMetrics = computeHallucinationMetrics({
      intent: run.result.intent,
      generatedList: run.result.generatedTestCases,
      knownFigmaNodeIds: knownNodeIds,
      knownScreenIds,
    }).metrics;
    fieldCoverageTotal += faithfulnessMetrics.fieldCoverageRatio;
    actionCoverageTotal += faithfulnessMetrics.actionCoverageRatio;
    traceFidelityTotal += faithfulnessMetrics.traceFidelityScore;
    hallucinationTotal += hallucinationMetrics.hallucinatedActionRate;
    // Issue #2116 — count runs where the policy gate's faithfulness
    // evaluation fell back to the case-level score (or had no verdict
    // at all). A rising fallback rate over time is a silent
    // quality-regression signal: the cross-modal-faithfulness gate
    // stops reasoning over per-step evidence and lets verdicts pass on
    // a case-level number that carries no per-step audit trail.
    const evaluationMode = run.result.policy.faithfulnessEvaluation?.mode;
    if (
      evaluationMode === "case_level_fallback" ||
      evaluationMode === "missing"
    ) {
      faithfulnessFallbackCount += 1;
    }
  }

  const observations: DriftMetricObservation[] = [];
  for (const [riskCategory, samples] of samplesByRisk.entries()) {
    observations.push({
      deployment: input.deployment,
      family,
      metricName: "brier_score",
      value: computeBrierScore(samples),
      riskCategory,
      sampleCount: samples.length,
    });
    observations.push({
      deployment: input.deployment,
      family,
      metricName: "ece",
      value: computeExpectedCalibrationError(
        samples,
        CALIBRATION_HISTOGRAM_BIN_COUNT,
      ),
      riskCategory,
      sampleCount: samples.length,
    });
  }
  const denominator = input.runs.length === 0 ? 1 : input.runs.length;
  observations.push(
    {
      deployment: input.deployment,
      family,
      metricName: "faithfulness_field_coverage",
      value: round6(fieldCoverageTotal / denominator),
    },
    {
      deployment: input.deployment,
      family,
      metricName: "faithfulness_action_coverage",
      value: round6(actionCoverageTotal / denominator),
    },
    {
      deployment: input.deployment,
      family,
      metricName: "faithfulness_trace_fidelity",
      value: round6(traceFidelityTotal / denominator),
    },
    {
      deployment: input.deployment,
      family,
      metricName: "hallucination_rate",
      value: round6(hallucinationTotal / denominator),
    },
    {
      deployment: input.deployment,
      family,
      metricName: "faithfulness_fallback_rate",
      value: round6(faithfulnessFallbackCount / denominator),
    },
  );
  return observations.sort((left, right) =>
    metricKey(left).localeCompare(metricKey(right), "en"),
  );
};

export const buildJudgeMetricObservations = (
  artifact: JudgeCalibrationEvalArtifact,
): ReadonlyArray<DriftMetricObservation> => {
  const deployment =
    artifact.samples[0]?.judge === "faithfulness"
      ? "faithfulness-judge"
      : "logic-judge";
  const family = familyForDeployment(deployment);
  return [
    {
      deployment,
      family,
      metricName: "judge_accuracy",
      value: artifact.metrics.accuracy,
      judge: artifact.judge,
    },
    {
      deployment,
      family,
      metricName: "judge_false_positive_rate",
      value: artifact.metrics.falsePositiveRate,
      judge: artifact.judge,
    },
    {
      deployment,
      family,
      metricName: "judge_false_negative_rate",
      value: artifact.metrics.falseNegativeRate,
      judge: artifact.judge,
    },
  ];
};

export const emptyBaselineState = (input: {
  tenantId: string;
  policyProfileId: string;
  canarySetId: string;
}): DriftBaselineState => ({
  schemaVersion: DRIFT_CANARY_SCHEMA_VERSION,
  tenantId: input.tenantId,
  policyProfileId: input.policyProfileId,
  canarySetId: input.canarySetId,
  records: [],
});

export const driftBaselinePath = (input: {
  runtimeRoot: string;
  tenantId: string;
  policyProfileId: string;
  canarySetId: string;
}): string => {
  for (const [label, value] of Object.entries({
    tenantId: input.tenantId,
    policyProfileId: input.policyProfileId,
    canarySetId: input.canarySetId,
  })) {
    if (!STABLE_SEGMENT_RE.test(value)) {
      throw new Error(
        `drift-canary: ${label} "${value}" must match ${STABLE_SEGMENT_RE.source}`,
      );
    }
  }
  return join(
    input.runtimeRoot,
    DRIFT_CANARY_BASELINES_DIRNAME,
    input.tenantId,
    input.policyProfileId,
    `${input.canarySetId}.${DRIFT_BASELINE_FILENAME}`,
  );
};

export const loadDriftBaselineState = async (input: {
  runtimeRoot: string;
  tenantId: string;
  policyProfileId: string;
  canarySetId: string;
}): Promise<DriftBaselineState> => {
  const path = driftBaselinePath(input);
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<DriftBaselineState> &
      Record<string, unknown>;
    if (parsed.schemaVersion !== DRIFT_CANARY_SCHEMA_VERSION) {
      throw new Error(
        `drift-canary: baseline at ${path} has schemaVersion ${String(parsed.schemaVersion)}`,
      );
    }
    if (
      parsed.tenantId !== input.tenantId ||
      parsed.policyProfileId !== input.policyProfileId ||
      parsed.canarySetId !== input.canarySetId
    ) {
      throw new Error(
        `drift-canary: baseline identity mismatch at ${path}`,
      );
    }
    return {
      schemaVersion: DRIFT_CANARY_SCHEMA_VERSION,
      tenantId: input.tenantId,
      policyProfileId: input.policyProfileId,
      canarySetId: input.canarySetId,
      records: Array.isArray(parsed.records)
        ? (parsed.records as DriftBaselineRecord[])
        : [],
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return emptyBaselineState(input);
    }
    throw error;
  }
};

export const writeDriftBaselineState = async (input: {
  runtimeRoot: string;
  tenantId: string;
  policyProfileId: string;
  canarySetId: string;
  state: DriftBaselineState;
}): Promise<string> => {
  const outputPath = driftBaselinePath(input);
  await mkdir(dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${canonicalJson(input.state)}\n`, "utf8");
  await rename(tempPath, outputPath);
  return outputPath;
};

export const appendDriftBaselineRecord = (
  state: DriftBaselineState,
  record: DriftBaselineRecord,
): DriftBaselineState => ({
  ...state,
  records: [...state.records, record].slice(-DRIFT_CANARY_HISTORY_DAYS),
});

export const evaluateDriftReport = (input: {
  baseline: DriftBaselineState;
  observations: ReadonlyArray<DriftMetricObservation>;
  providerFingerprints: ReadonlyArray<ProviderFingerprintObservation>;
}): { findings: ReadonlyArray<DriftFinding>; baselineStatus: "warming" | "ready" } => {
  const priorRecords = input.baseline.records;
  const priorObservationMap = new Map<string, number[]>();
  for (const record of priorRecords) {
    for (const observation of record.observations) {
      const key = metricKey(observation);
      const bucket = priorObservationMap.get(key) ?? [];
      bucket.push(observation.value);
      priorObservationMap.set(key, bucket);
    }
  }
  const findings: DriftFinding[] = [];
  for (const observation of input.observations) {
    if (observation.metricName === "ece" && observation.riskCategory !== undefined) {
      const threshold = CALIBRATION_ECE_THRESHOLDS[observation.riskCategory];
      const belowSampleFloor =
        observation.sampleCount !== undefined &&
        observation.sampleCount < CALIBRATION_MIN_SAMPLE_FLOOR;
      if (!belowSampleFloor && observation.value > threshold) {
        findings.push({
          kind: "ece_absolute_threshold",
          severity: "error",
          message: `ECE exceeded the hard threshold for ${observation.riskCategory}`,
          deployment: observation.deployment,
          family: observation.family,
          metricName: observation.metricName,
          riskCategory: observation.riskCategory,
          currentValue: observation.value,
          threshold,
        });
      }
    }
    const priorValues = priorObservationMap.get(metricKey(observation)) ?? [];
    if (priorValues.length < 2) continue;
    const baselineMean = mean(priorValues);
    const baselineStdDev = stddev(priorValues, baselineMean);
    const delta = round6(observation.value - baselineMean);
    const sigmaExceeded =
      baselineStdDev === 0
        ? Math.abs(delta) > DRIFT_CANARY_EPSILON
        : Math.abs(delta) > baselineStdDev * DRIFT_CANARY_SIGMA_THRESHOLD;
    if (sigmaExceeded) {
      findings.push({
        kind: "metric_shift",
        severity: "warning",
        message: `${observation.metricName} shifted beyond ${DRIFT_CANARY_SIGMA_THRESHOLD}σ`,
        deployment: observation.deployment,
        family: observation.family,
        metricName: observation.metricName,
        ...(observation.riskCategory !== undefined
          ? { riskCategory: observation.riskCategory }
          : {}),
        ...(observation.judge !== undefined ? { judge: observation.judge } : {}),
        currentValue: observation.value,
        baselineMean,
        baselineStdDev,
        delta,
        threshold:
          baselineStdDev === 0
            ? DRIFT_CANARY_EPSILON
            : round6(baselineStdDev * DRIFT_CANARY_SIGMA_THRESHOLD),
      });
    }
    if (
      observation.metricName === "brier_score" &&
      Math.abs(delta) > DRIFT_CANARY_BRIER_ABSOLUTE_THRESHOLD
    ) {
      findings.push({
        kind: "brier_absolute_shift",
        severity: "error",
        message: "Brier score drift exceeded the absolute 0.05 threshold",
        deployment: observation.deployment,
        family: observation.family,
        metricName: observation.metricName,
        ...(observation.riskCategory !== undefined
          ? { riskCategory: observation.riskCategory }
          : {}),
        currentValue: observation.value,
        baselineMean,
        baselineStdDev,
        delta,
        threshold: DRIFT_CANARY_BRIER_ABSOLUTE_THRESHOLD,
      });
    }
  }

  const priorFingerprintMap = new Map<string, ProviderFingerprintObservation>();
  for (const record of priorRecords) {
    for (const fingerprint of record.providerFingerprints) {
      priorFingerprintMap.set(fingerprintKey(fingerprint), fingerprint);
    }
  }
  for (const fingerprint of input.providerFingerprints) {
    const prior = priorFingerprintMap.get(fingerprintKey(fingerprint));
    if (prior === undefined) continue;
    if (
      prior.modelRevision === fingerprint.modelRevision &&
      prior.gatewayRelease === fingerprint.gatewayRelease &&
      prior.outputHash !== fingerprint.outputHash
    ) {
      findings.push({
        kind: "provider_fingerprint_changed",
        severity: "error",
        message:
          "Provider response fingerprint changed while modelRevision and gatewayRelease stayed constant",
        deployment: fingerprint.deployment,
        family: fingerprint.family,
      });
    }
    if (
      prior.modelRevision === fingerprint.modelRevision &&
      prior.gatewayRelease === fingerprint.gatewayRelease &&
      prior.outputTokens !== fingerprint.outputTokens
    ) {
      findings.push({
        kind: "provider_token_count_changed",
        severity: "warning",
        message:
          "Provider output token count changed while modelRevision and gatewayRelease stayed constant",
        deployment: fingerprint.deployment,
        family: fingerprint.family,
      });
    }
  }

  findings.push(...classifyCrossFamilyCorrelatedDrift(findings));
  return {
    findings: findings.sort((left, right) =>
      left.message.localeCompare(right.message, "en"),
    ),
    baselineStatus: priorRecords.length >= 2 ? "ready" : "warming",
  };
};

export const classifyCrossFamilyCorrelatedDrift = (
  findings: ReadonlyArray<DriftFinding>,
): ReadonlyArray<DriftFinding> => {
  const grouped = new Map<string, Set<string>>();
  for (const finding of findings) {
    if (finding.kind !== "metric_shift" && finding.kind !== "brier_absolute_shift") {
      continue;
    }
    const key = [
      finding.metricName ?? "",
      finding.riskCategory ?? "",
      finding.judge ?? "",
    ].join("\u0000");
    const families = grouped.get(key) ?? new Set<string>();
    if (finding.family !== undefined) {
      families.add(finding.family);
    }
    grouped.set(key, families);
  }
  const correlated: DriftFinding[] = [];
  for (const [key, families] of grouped.entries()) {
    if (families.size < 2) continue;
    const [metricName = "", riskCategory = "", judge = ""] =
      key.split("\u0000");
    correlated.push({
      kind: "cross_family_correlated_drift",
      severity: "error",
      message: `Correlated cross-family drift detected for ${metricName}`,
      metricName: metricName as DriftCanaryMetricName,
      ...(riskCategory.length > 0
        ? { riskCategory: riskCategory as TestCaseRiskCategory }
        : {}),
      ...(judge.length > 0 ? { judge: judge as "logic" | "faithfulness" } : {}),
    });
  }
  return correlated;
};

export const createFileDriftAlertSink = (runDir: string): DriftAlertSink => ({
  async publish(input) {
    const outputPath = join(runDir, DRIFT_ALERTS_ARTIFACT_FILENAME);
    await mkdir(dirname(outputPath), { recursive: true });
    const tempPath = `${outputPath}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${canonicalJson(input)}\n`, "utf8");
    await rename(tempPath, outputPath);
    return outputPath;
  },
});

export const writeDriftReport = async (input: {
  runDir: string;
  report: DriftReport;
}): Promise<string> => {
  const outputPath = join(input.runDir, DRIFT_REPORT_ARTIFACT_FILENAME);
  await mkdir(dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${canonicalJson(input.report)}\n`, "utf8");
  await rename(tempPath, outputPath);
  return outputPath;
};

export const runProviderFingerprintCanary = async (input: {
  deployment: string;
  family: string;
  role: string;
  client: LlmGatewayClient;
  prompts?: ReadonlyArray<ProviderFingerprintPrompt>;
}): Promise<ReadonlyArray<ProviderFingerprintObservation>> => {
  const observations: ProviderFingerprintObservation[] = [];
  for (const prompt of input.prompts ?? PROVIDER_FINGERPRINT_PROMPTS) {
    if (
      prompt.expectsImageInput &&
      !input.client.declaredCapabilities.imageInputSupport
    ) {
      continue;
    }
    const request: LlmGenerationRequest = {
      jobId: `drift-canary-${prompt.promptId}`,
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      responseSchemaName: "workspace-dev-drift-canary-fingerprint-v1",
      responseSchema: {
        type: "object",
        additionalProperties: false,
        required: ["answer"],
        properties: {
          answer: { type: "string", minLength: 1, maxLength: 32 },
        },
      },
      ...(prompt.expectsImageInput
        ? {
            imageInputs: [
              {
                mimeType: "image/png",
                base64Data: ONE_PIXEL_PNG_BASE64,
                widthPx: 1,
                heightPx: 1,
              },
            ],
          }
        : {}),
      maxOutputTokens: 32,
      maxRetries: 0,
    };
    const result = await input.client.generate(request);
    if (result.outcome !== "success") {
      throw new Error(
        `provider fingerprint canary failed for ${input.role}/${prompt.promptId}: ${result.errorClass} ${result.message}`,
      );
    }
    observations.push({
      deployment: input.deployment,
      family: input.family,
      role: input.role,
      promptId: prompt.promptId,
      modelRevision: result.modelRevision,
      gatewayRelease: result.gatewayRelease,
      inputHash: sha256Hex({
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        expectsImageInput: prompt.expectsImageInput,
      }),
      outputHash: sha256Hex(result.content),
      finishReason: result.finishReason,
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    });
  }
  return observations.sort((left, right) =>
    fingerprintKey(left).localeCompare(fingerprintKey(right), "en"),
  );
};

const collectKnownNodeIds = (
  fixture: IntentDerivationFigmaInput,
): ReadonlyArray<string> =>
  fixture.screens.flatMap((screen) => screen.nodes.map((node) => node.nodeId));
