/**
 * Distribution-shift detector (Issue #2120).
 *
 * The drift-canary lane from Issue #2103 detects shifts on the **output**
 * side: ECE / Brier / faithfulness / hallucination drift on a five-fixture
 * holdout set. Distribution-shift detection sits one layer earlier — on the
 * **input** distribution itself — so concept drift surfaces before
 * downstream metrics move.
 *
 * Per evaluation window (one record per day, 30-day rolling window) the
 * detector records a deterministic snapshot of the input distribution:
 *
 *   - **Token-distribution histogram.** A 256-bucket histogram of FNV-1a
 *     hashed lowercase word tokens from the canonical input text (screen
 *     names + node text + node names). Deterministic, no tokenizer
 *     dependency, no PII risk because we only persist bucket counts.
 *   - **Label distribution.** Counts per `TestCaseRiskCategory` across all
 *     test cases the runner emitted in the window. Tracks the routing of
 *     work between low / medium / high / regulated_data / financial_transaction.
 *   - **IR-shape distribution.** Counts per Figma `nodeType` across the
 *     screens the runner saw, plus a screen count. Tracks structural
 *     changes in upstream Figma sources (e.g. a new component family
 *     suddenly dominating).
 *   - **Embedding centroid (optional).** Caller-supplied embedding provider
 *     (typically `phi-4-mini-instruct` from Issue #2099) embeds each screen
 *     into a fixed-dim vector; the detector averages those vectors into a
 *     single centroid per record.
 *
 * The detector then compares the current snapshot against the rolling-mean
 * of the past records:
 *
 *   - KL divergence (Laplace-smoothed) on each histogram. A shift fires
 *     when KL > 0.3.
 *   - Embedding centroid drift in σ-units of the per-component standard
 *     deviation across past centroids. A shift fires when the L2 distance
 *     between current and rolling-mean centroid exceeds 2σ of the historical
 *     L2-distance distribution.
 *
 * Findings feed the drift alert pipeline (Issue #2103) via the existing
 * `DriftAlertSink` shape. The detector also writes a per-fixture-suite
 * `distribution-shift-dashboard.json` with the KL trend, the latest
 * snapshot, and the current findings — consumed by the admin portal.
 *
 * The module is pure and deterministic for identical inputs, has no I/O
 * outside the explicit persistence helpers, and never reads or writes
 * secrets. Document text is hashed into bucket counts; no raw input is
 * persisted.
 *
 * Documented as Art. 9 ongoing post-market monitoring in
 * `docs/eu-ai-act/post-market-monitoring.md`.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  GeneratedTestCaseList,
  TestCaseRiskCategory,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import type { IntentDerivationFigmaInput } from "./intent-derivation.js";

export const DISTRIBUTION_SHIFT_SCHEMA_VERSION = "1.0.0" as const;

export const DISTRIBUTION_SHIFT_REPORT_FILENAME =
  "distribution-shift-report.json" as const;
export const DISTRIBUTION_SHIFT_ALERTS_FILENAME =
  "distribution-shift-alerts.json" as const;
export const DISTRIBUTION_SHIFT_DASHBOARD_FILENAME =
  "distribution-shift-dashboard.json" as const;
export const DISTRIBUTION_SHIFT_BASELINE_FILENAME = "baseline.json" as const;
export const DISTRIBUTION_SHIFT_BASELINES_DIRNAME =
  "distribution-shift" as const;

export const DISTRIBUTION_SHIFT_HISTORY_DAYS = 30 as const;
export const DISTRIBUTION_SHIFT_TOKEN_BUCKET_COUNT = 256 as const;
export const DISTRIBUTION_SHIFT_KL_THRESHOLD = 0.3 as const;
export const DISTRIBUTION_SHIFT_CENTROID_SIGMA_THRESHOLD = 2 as const;
export const DISTRIBUTION_SHIFT_EPSILON = 0.000001 as const;
/** Minimum past records required before σ-based centroid alerts can fire. */
export const DISTRIBUTION_SHIFT_MIN_HISTORY_FOR_SIGMA = 2 as const;

const STABLE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/u;

const RISK_CATEGORIES: ReadonlyArray<TestCaseRiskCategory> = Object.freeze([
  "low",
  "medium",
  "high",
  "regulated_data",
  "financial_transaction",
]);

export type DistributionShiftFindingKind =
  | "token_kl_shift"
  | "label_kl_shift"
  | "ir_shape_kl_shift"
  | "embedding_centroid_shift";

export interface DistributionShiftFinding {
  readonly kind: DistributionShiftFindingKind;
  readonly severity: "warning" | "error";
  readonly message: string;
  readonly fixtureSuiteId: string;
  readonly klDivergence?: number;
  readonly klThreshold?: number;
  readonly centroidShiftSigma?: number;
  readonly centroidShiftL2?: number;
  readonly centroidSigmaThreshold?: number;
  readonly embeddingProviderId?: string;
}

export interface DistributionShiftLabelHistogram {
  readonly low: number;
  readonly medium: number;
  readonly high: number;
  readonly regulated_data: number;
  readonly financial_transaction: number;
}

export interface DistributionShiftSnapshot {
  readonly recordedAt: string;
  readonly fixtureSuiteId: string;
  readonly jobCount: number;
  readonly screenCount: number;
  readonly testCaseCount: number;
  readonly tokenHistogram: ReadonlyArray<number>;
  readonly labelHistogram: DistributionShiftLabelHistogram;
  readonly irShapeHistogram: Readonly<Record<string, number>>;
  readonly embeddingCentroid?: ReadonlyArray<number>;
  readonly embeddingProviderId?: string;
}

export interface DistributionShiftBaselineState {
  readonly schemaVersion: typeof DISTRIBUTION_SHIFT_SCHEMA_VERSION;
  readonly tenantId: string;
  readonly policyProfileId: string;
  readonly fixtureSuiteId: string;
  readonly records: ReadonlyArray<DistributionShiftSnapshot>;
}

export interface DistributionShiftReport {
  readonly schemaVersion: typeof DISTRIBUTION_SHIFT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly fixtureSuiteId: string;
  readonly snapshot: DistributionShiftSnapshot;
  readonly findings: ReadonlyArray<DistributionShiftFinding>;
  readonly baselineStatus: "warming" | "ready";
  readonly klMeasurements: {
    readonly tokenKl: number;
    readonly labelKl: number;
    readonly irShapeKl: number;
  };
  readonly centroidMeasurement?: {
    readonly l2Distance: number;
    readonly sigma: number;
    readonly historyL2Mean: number;
    readonly historyL2StdDev: number;
  };
}

export interface DistributionShiftAlert {
  readonly schemaVersion: typeof DISTRIBUTION_SHIFT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly fixtureSuiteId: string;
  readonly alerts: ReadonlyArray<DistributionShiftFinding>;
}

export interface DistributionShiftAlertSink {
  publish(input: DistributionShiftAlert): Promise<string | undefined>;
}

export interface DistributionShiftDashboardSeriesEntry {
  readonly recordedAt: string;
  readonly tokenKl: number;
  readonly labelKl: number;
  readonly irShapeKl: number;
  readonly centroidL2?: number;
}

export interface DistributionShiftDashboard {
  readonly schemaVersion: typeof DISTRIBUTION_SHIFT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly fixtureSuiteId: string;
  readonly latest: DistributionShiftSnapshot;
  readonly history: ReadonlyArray<DistributionShiftDashboardSeriesEntry>;
  readonly findings: ReadonlyArray<DistributionShiftFinding>;
  readonly thresholds: {
    readonly kl: typeof DISTRIBUTION_SHIFT_KL_THRESHOLD;
    readonly centroidSigma: typeof DISTRIBUTION_SHIFT_CENTROID_SIGMA_THRESHOLD;
    readonly historyDays: typeof DISTRIBUTION_SHIFT_HISTORY_DAYS;
  };
}

/**
 * Caller-supplied embedding provider used to compute per-screen vectors.
 * The detector itself never makes a network call. The expected production
 * binding is the `phi-4-mini-instruct` deployment from Issue #2099 used in
 * embedding-only mode (cheap, no generation).
 */
export interface DistributionShiftEmbeddingProvider {
  readonly identifier: string;
  embed(text: string): Promise<ReadonlyArray<number>>;
}

export interface JobDistributionInput {
  readonly figma: IntentDerivationFigmaInput;
  readonly generatedTestCases: GeneratedTestCaseList;
}

const round6 = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;

const fnv1aHash32 = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

const tokenizeForHistogram = (text: string): ReadonlyArray<string> =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 0);

const collectInputText = (
  figma: IntentDerivationFigmaInput,
): ReadonlyArray<string> => {
  const out: string[] = [];
  for (const screen of figma.screens) {
    out.push(screen.screenName);
    for (const node of screen.nodes) {
      out.push(node.nodeName);
      if (typeof node.text === "string" && node.text.length > 0) {
        out.push(node.text);
      }
      if (typeof node.defaultValue === "string" && node.defaultValue.length > 0) {
        out.push(node.defaultValue);
      }
    }
  }
  return out;
};

const buildTokenHistogram = (
  texts: ReadonlyArray<string>,
): number[] => {
  const buckets = new Array<number>(DISTRIBUTION_SHIFT_TOKEN_BUCKET_COUNT).fill(
    0,
  );
  for (const text of texts) {
    for (const token of tokenizeForHistogram(text)) {
      const bucketIndex =
        fnv1aHash32(token) % DISTRIBUTION_SHIFT_TOKEN_BUCKET_COUNT;
      buckets[bucketIndex] = (buckets[bucketIndex] ?? 0) + 1;
    }
  }
  return buckets;
};

const buildLabelHistogram = (
  testCaseLists: ReadonlyArray<GeneratedTestCaseList>,
): DistributionShiftLabelHistogram => {
  const counts: Record<TestCaseRiskCategory, number> = {
    low: 0,
    medium: 0,
    high: 0,
    regulated_data: 0,
    financial_transaction: 0,
  };
  for (const list of testCaseLists) {
    for (const testCase of list.testCases) {
      counts[testCase.riskCategory] += 1;
    }
  }
  return Object.freeze({ ...counts });
};

const buildIrShapeHistogram = (
  figmaInputs: ReadonlyArray<IntentDerivationFigmaInput>,
): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const figma of figmaInputs) {
    for (const screen of figma.screens) {
      for (const node of screen.nodes) {
        const key = node.nodeType;
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
  }
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(counts).sort()) {
    sorted[key] = counts[key] ?? 0;
  }
  return sorted;
};

const sumArray = (values: ReadonlyArray<number>): number => {
  let total = 0;
  for (const value of values) total += value;
  return total;
};

const elementWiseAverage = (
  vectors: ReadonlyArray<ReadonlyArray<number>>,
): ReadonlyArray<number> => {
  if (vectors.length === 0) return [];
  const head = vectors[0];
  if (head === undefined) return [];
  const dim = head.length;
  for (const vector of vectors) {
    if (vector.length !== dim) {
      throw new Error(
        `distribution-shift: embedding vectors must share dimension (got ${dim} and ${vector.length})`,
      );
    }
  }
  const out = new Array<number>(dim).fill(0);
  for (const vector of vectors) {
    for (let index = 0; index < dim; index += 1) {
      const component = vector[index];
      if (component === undefined || !Number.isFinite(component)) {
        throw new Error(
          "distribution-shift: embedding vectors must be finite numbers",
        );
      }
      out[index] = (out[index] ?? 0) + component;
    }
  }
  for (let index = 0; index < dim; index += 1) {
    out[index] = round6((out[index] ?? 0) / vectors.length);
  }
  return out;
};

const l2Distance = (
  left: ReadonlyArray<number>,
  right: ReadonlyArray<number>,
): number => {
  if (left.length !== right.length) {
    throw new Error(
      `distribution-shift: L2 distance requires equal-dim vectors (got ${left.length} and ${right.length})`,
    );
  }
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    const delta = leftValue - rightValue;
    total += delta * delta;
  }
  return round6(Math.sqrt(total));
};

/**
 * Symmetric KL divergence between two non-negative integer histograms,
 * with add-1 (Laplace) smoothing to avoid log(0). Returns the symmetric
 * variant (½(KL(P‖Q) + KL(Q‖P))) so the metric is order-independent.
 *
 * Returns 0 when both histograms are entirely empty (no input observed
 * either side).
 */
export const computeKlDivergence = (
  current: ReadonlyArray<number>,
  baseline: ReadonlyArray<number>,
): number => {
  if (current.length !== baseline.length) {
    throw new Error(
      `distribution-shift: KL requires equal-length histograms (got ${current.length} and ${baseline.length})`,
    );
  }
  if (current.length === 0) return 0;
  const dim = current.length;
  const currentTotal = sumArray(current) + dim;
  const baselineTotal = sumArray(baseline) + dim;
  let forward = 0;
  let reverse = 0;
  for (let index = 0; index < dim; index += 1) {
    const p = ((current[index] ?? 0) + 1) / currentTotal;
    const q = ((baseline[index] ?? 0) + 1) / baselineTotal;
    forward += p * Math.log(p / q);
    reverse += q * Math.log(q / p);
  }
  return round6((forward + reverse) / 2);
};

const labelHistogramAsArray = (
  histogram: DistributionShiftLabelHistogram,
): number[] => RISK_CATEGORIES.map((category) => histogram[category]);

const sumLabelHistograms = (
  histograms: ReadonlyArray<DistributionShiftLabelHistogram>,
): number[] => {
  const out = new Array<number>(RISK_CATEGORIES.length).fill(0);
  for (const histogram of histograms) {
    const arr = labelHistogramAsArray(histogram);
    for (let index = 0; index < arr.length; index += 1) {
      out[index] = (out[index] ?? 0) + (arr[index] ?? 0);
    }
  }
  return out;
};

const sumNumericHistograms = (
  histograms: ReadonlyArray<ReadonlyArray<number>>,
): number[] => {
  if (histograms.length === 0) {
    return new Array<number>(DISTRIBUTION_SHIFT_TOKEN_BUCKET_COUNT).fill(0);
  }
  const head = histograms[0];
  if (head === undefined) {
    return new Array<number>(DISTRIBUTION_SHIFT_TOKEN_BUCKET_COUNT).fill(0);
  }
  const dim = head.length;
  const out = new Array<number>(dim).fill(0);
  for (const histogram of histograms) {
    if (histogram.length !== dim) {
      throw new Error(
        `distribution-shift: cannot sum histograms of different lengths (${dim} vs ${histogram.length})`,
      );
    }
    for (let index = 0; index < dim; index += 1) {
      out[index] = (out[index] ?? 0) + (histogram[index] ?? 0);
    }
  }
  return out;
};

const sumKeyedHistograms = (
  histograms: ReadonlyArray<Record<string, number>>,
): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const histogram of histograms) {
    for (const [key, value] of Object.entries(histogram)) {
      out[key] = (out[key] ?? 0) + value;
    }
  }
  return out;
};

const alignKeyedHistograms = (
  current: Record<string, number>,
  baseline: Record<string, number>,
): { current: number[]; baseline: number[] } => {
  const keys = Array.from(
    new Set([...Object.keys(current), ...Object.keys(baseline)]),
  ).sort();
  return {
    current: keys.map((key) => current[key] ?? 0),
    baseline: keys.map((key) => baseline[key] ?? 0),
  };
};

/**
 * Build a per-evaluation-window snapshot of the input distribution. The
 * caller provides the jobs that ran in this window plus an optional
 * `embeddingProvider`; when supplied, the detector embeds each screen and
 * averages the vectors into the snapshot's centroid.
 */
export const recordInputDistributionSnapshot = async (input: {
  fixtureSuiteId: string;
  recordedAt: string;
  jobs: ReadonlyArray<JobDistributionInput>;
  embeddingProvider?: DistributionShiftEmbeddingProvider;
}): Promise<DistributionShiftSnapshot> => {
  if (!STABLE_SEGMENT_RE.test(input.fixtureSuiteId)) {
    throw new Error(
      `distribution-shift: fixtureSuiteId "${input.fixtureSuiteId}" must match ${STABLE_SEGMENT_RE.source}`,
    );
  }
  const figmaInputs = input.jobs.map((job) => job.figma);
  const testCaseLists = input.jobs.map((job) => job.generatedTestCases);
  const allTexts: string[] = [];
  let screenCount = 0;
  for (const figma of figmaInputs) {
    screenCount += figma.screens.length;
    allTexts.push(...collectInputText(figma));
  }
  let testCaseCount = 0;
  for (const list of testCaseLists) {
    testCaseCount += list.testCases.length;
  }

  let embeddingCentroid: ReadonlyArray<number> | undefined;
  let embeddingProviderId: string | undefined;
  if (input.embeddingProvider !== undefined) {
    embeddingProviderId = input.embeddingProvider.identifier;
    const screenVectors: Array<ReadonlyArray<number>> = [];
    for (const figma of figmaInputs) {
      for (const screen of figma.screens) {
        const screenText = [
          screen.screenName,
          ...screen.nodes.map((node) => node.nodeName),
          ...screen.nodes
            .map((node) => node.text)
            .filter((text): text is string => typeof text === "string"),
        ].join("\n");
        const vector = await input.embeddingProvider.embed(screenText);
        if (vector.length === 0) {
          throw new Error(
            "distribution-shift: embedding provider returned an empty vector",
          );
        }
        for (const component of vector) {
          if (!Number.isFinite(component)) {
            throw new Error(
              "distribution-shift: embedding provider returned a non-finite component",
            );
          }
        }
        screenVectors.push(vector);
      }
    }
    if (screenVectors.length > 0) {
      embeddingCentroid = elementWiseAverage(screenVectors);
    }
  }

  return {
    recordedAt: input.recordedAt,
    fixtureSuiteId: input.fixtureSuiteId,
    jobCount: input.jobs.length,
    screenCount,
    testCaseCount,
    tokenHistogram: buildTokenHistogram(allTexts),
    labelHistogram: buildLabelHistogram(testCaseLists),
    irShapeHistogram: buildIrShapeHistogram(figmaInputs),
    ...(embeddingCentroid !== undefined ? { embeddingCentroid } : {}),
    ...(embeddingProviderId !== undefined ? { embeddingProviderId } : {}),
  };
};

export const emptyDistributionShiftBaselineState = (input: {
  tenantId: string;
  policyProfileId: string;
  fixtureSuiteId: string;
}): DistributionShiftBaselineState => ({
  schemaVersion: DISTRIBUTION_SHIFT_SCHEMA_VERSION,
  tenantId: input.tenantId,
  policyProfileId: input.policyProfileId,
  fixtureSuiteId: input.fixtureSuiteId,
  records: [],
});

export const distributionShiftBaselinePath = (input: {
  runtimeRoot: string;
  tenantId: string;
  policyProfileId: string;
  fixtureSuiteId: string;
}): string => {
  for (const [label, value] of Object.entries({
    tenantId: input.tenantId,
    policyProfileId: input.policyProfileId,
    fixtureSuiteId: input.fixtureSuiteId,
  })) {
    if (!STABLE_SEGMENT_RE.test(value)) {
      throw new Error(
        `distribution-shift: ${label} "${value}" must match ${STABLE_SEGMENT_RE.source}`,
      );
    }
  }
  return join(
    input.runtimeRoot,
    DISTRIBUTION_SHIFT_BASELINES_DIRNAME,
    input.tenantId,
    input.policyProfileId,
    `${input.fixtureSuiteId}.${DISTRIBUTION_SHIFT_BASELINE_FILENAME}`,
  );
};

export const loadDistributionShiftBaselineState = async (input: {
  runtimeRoot: string;
  tenantId: string;
  policyProfileId: string;
  fixtureSuiteId: string;
}): Promise<DistributionShiftBaselineState> => {
  const path = distributionShiftBaselinePath(input);
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<DistributionShiftBaselineState> &
      Record<string, unknown>;
    if (parsed.schemaVersion !== DISTRIBUTION_SHIFT_SCHEMA_VERSION) {
      throw new Error(
        `distribution-shift: baseline at ${path} has schemaVersion ${String(parsed.schemaVersion)}`,
      );
    }
    if (
      parsed.tenantId !== input.tenantId ||
      parsed.policyProfileId !== input.policyProfileId ||
      parsed.fixtureSuiteId !== input.fixtureSuiteId
    ) {
      throw new Error(
        `distribution-shift: baseline identity mismatch at ${path}`,
      );
    }
    return {
      schemaVersion: DISTRIBUTION_SHIFT_SCHEMA_VERSION,
      tenantId: input.tenantId,
      policyProfileId: input.policyProfileId,
      fixtureSuiteId: input.fixtureSuiteId,
      records: Array.isArray(parsed.records)
        ? (parsed.records as DistributionShiftSnapshot[])
        : [],
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return emptyDistributionShiftBaselineState(input);
    }
    throw error;
  }
};

export const writeDistributionShiftBaselineState = async (input: {
  runtimeRoot: string;
  tenantId: string;
  policyProfileId: string;
  fixtureSuiteId: string;
  state: DistributionShiftBaselineState;
}): Promise<string> => {
  const outputPath = distributionShiftBaselinePath(input);
  await mkdir(dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${canonicalJson(input.state)}\n`, "utf8");
  await rename(tempPath, outputPath);
  return outputPath;
};

export const appendDistributionShiftBaselineRecord = (
  state: DistributionShiftBaselineState,
  record: DistributionShiftSnapshot,
): DistributionShiftBaselineState => ({
  ...state,
  records: [...state.records, record].slice(-DISTRIBUTION_SHIFT_HISTORY_DAYS),
});

const meanAndStdDev = (
  values: ReadonlyArray<number>,
): { mean: number; stdDev: number } => {
  if (values.length === 0) return { mean: 0, stdDev: 0 };
  const sum = sumArray(values);
  const mean = sum / values.length;
  if (values.length === 1) {
    return { mean: round6(mean), stdDev: 0 };
  }
  let variance = 0;
  for (const value of values) {
    const delta = value - mean;
    variance += delta * delta;
  }
  variance /= values.length - 1;
  return { mean: round6(mean), stdDev: round6(Math.sqrt(variance)) };
};

/**
 * Evaluate a snapshot against the rolling baseline and produce findings.
 *
 * KL is computed against the rolling-mean of the past records' histograms
 * (sum of past histograms acts as the rolling mean since KL is invariant
 * to scaling on the baseline-side under add-1 smoothing). Centroid drift
 * is computed in σ-units of the historical L2-distance distribution
 * between past consecutive centroids.
 */
export const evaluateDistributionShiftReport = (input: {
  baseline: DistributionShiftBaselineState;
  snapshot: DistributionShiftSnapshot;
}): DistributionShiftReport => {
  const priorRecords = input.baseline.records;
  const priorTokenHistograms = priorRecords.map(
    (record) => record.tokenHistogram,
  );
  const priorLabelHistograms = priorRecords.map(
    (record) => record.labelHistogram,
  );
  const priorIrShapeHistograms = priorRecords.map(
    (record) => record.irShapeHistogram,
  );
  const baselineStatus =
    priorRecords.length >= DISTRIBUTION_SHIFT_MIN_HISTORY_FOR_SIGMA
      ? ("ready" as const)
      : ("warming" as const);

  const findings: DistributionShiftFinding[] = [];
  const fixtureSuiteId = input.snapshot.fixtureSuiteId;

  let tokenKl = 0;
  let labelKl = 0;
  let irShapeKl = 0;

  if (priorTokenHistograms.length > 0) {
    const baselineTokens = sumNumericHistograms(priorTokenHistograms);
    tokenKl = computeKlDivergence(input.snapshot.tokenHistogram, baselineTokens);
    if (tokenKl > DISTRIBUTION_SHIFT_KL_THRESHOLD) {
      findings.push({
        kind: "token_kl_shift",
        severity: "warning",
        message:
          "Token-distribution KL divergence exceeded the input-shift threshold",
        fixtureSuiteId,
        klDivergence: tokenKl,
        klThreshold: DISTRIBUTION_SHIFT_KL_THRESHOLD,
      });
    }
  }
  if (priorLabelHistograms.length > 0) {
    const baselineLabels = sumLabelHistograms(priorLabelHistograms);
    labelKl = computeKlDivergence(
      labelHistogramAsArray(input.snapshot.labelHistogram),
      baselineLabels,
    );
    if (labelKl > DISTRIBUTION_SHIFT_KL_THRESHOLD) {
      findings.push({
        kind: "label_kl_shift",
        severity: "warning",
        message:
          "Label-distribution KL divergence exceeded the input-shift threshold",
        fixtureSuiteId,
        klDivergence: labelKl,
        klThreshold: DISTRIBUTION_SHIFT_KL_THRESHOLD,
      });
    }
  }
  if (priorIrShapeHistograms.length > 0) {
    const baselineIrShape = sumKeyedHistograms(priorIrShapeHistograms);
    const aligned = alignKeyedHistograms(
      input.snapshot.irShapeHistogram,
      baselineIrShape,
    );
    irShapeKl = computeKlDivergence(aligned.current, aligned.baseline);
    if (irShapeKl > DISTRIBUTION_SHIFT_KL_THRESHOLD) {
      findings.push({
        kind: "ir_shape_kl_shift",
        severity: "warning",
        message:
          "IR-shape KL divergence exceeded the input-shift threshold",
        fixtureSuiteId,
        klDivergence: irShapeKl,
        klThreshold: DISTRIBUTION_SHIFT_KL_THRESHOLD,
      });
    }
  }

  let centroidMeasurement: DistributionShiftReport["centroidMeasurement"];
  const priorCentroids = priorRecords
    .map((record) => record.embeddingCentroid)
    .filter((vector): vector is ReadonlyArray<number> => vector !== undefined);
  if (
    input.snapshot.embeddingCentroid !== undefined &&
    priorCentroids.length >= 1
  ) {
    const dim = input.snapshot.embeddingCentroid.length;
    const sameDimPrior = priorCentroids.filter(
      (vector) => vector.length === dim,
    );
    if (sameDimPrior.length >= 1) {
      const baselineCentroid = elementWiseAverage(sameDimPrior);
      const currentL2 = l2Distance(
        input.snapshot.embeddingCentroid,
        baselineCentroid,
      );
      // Historical L2 distances measure how much each past centroid sat from
      // the rolling-mean centroid. The σ is the standard deviation of that
      // distribution. The current run's distance is then expressed in
      // σ-units of the historical scatter — exactly the "shift > 2σ"
      // threshold required by Issue #2120.
      const historicalL2 = sameDimPrior.map((vector) =>
        l2Distance(vector, baselineCentroid),
      );
      const { mean: historyL2Mean, stdDev: historyL2StdDev } =
        meanAndStdDev(historicalL2);
      const stdNonZero = historyL2StdDev > DISTRIBUTION_SHIFT_EPSILON;
      const sigma = stdNonZero
        ? round6((currentL2 - historyL2Mean) / historyL2StdDev)
        : currentL2 > DISTRIBUTION_SHIFT_EPSILON
          ? Number.POSITIVE_INFINITY
          : 0;
      const reportedSigma = Number.isFinite(sigma) ? sigma : undefined;
      centroidMeasurement = {
        l2Distance: currentL2,
        sigma: reportedSigma ?? 0,
        historyL2Mean,
        historyL2StdDev,
      };
      const enoughHistoryForSigma =
        sameDimPrior.length >= DISTRIBUTION_SHIFT_MIN_HISTORY_FOR_SIGMA;
      const exceedsThreshold = stdNonZero
        ? sigma > DISTRIBUTION_SHIFT_CENTROID_SIGMA_THRESHOLD
        : currentL2 > DISTRIBUTION_SHIFT_EPSILON;
      if (enoughHistoryForSigma && exceedsThreshold) {
        findings.push({
          kind: "embedding_centroid_shift",
          severity: "error",
          message: `Embedding-centroid shift exceeded ${DISTRIBUTION_SHIFT_CENTROID_SIGMA_THRESHOLD}σ of the rolling baseline`,
          fixtureSuiteId,
          centroidShiftL2: currentL2,
          ...(reportedSigma !== undefined
            ? { centroidShiftSigma: reportedSigma }
            : {}),
          centroidSigmaThreshold: DISTRIBUTION_SHIFT_CENTROID_SIGMA_THRESHOLD,
          ...(input.snapshot.embeddingProviderId !== undefined
            ? { embeddingProviderId: input.snapshot.embeddingProviderId }
            : {}),
        });
      }
    }
  }

  return {
    schemaVersion: DISTRIBUTION_SHIFT_SCHEMA_VERSION,
    generatedAt: input.snapshot.recordedAt,
    fixtureSuiteId,
    snapshot: input.snapshot,
    findings: findings.sort((left, right) =>
      left.kind.localeCompare(right.kind, "en"),
    ),
    baselineStatus,
    klMeasurements: {
      tokenKl: round6(tokenKl),
      labelKl: round6(labelKl),
      irShapeKl: round6(irShapeKl),
    },
    ...(centroidMeasurement !== undefined ? { centroidMeasurement } : {}),
  };
};

export const buildDistributionShiftDashboard = (input: {
  baseline: DistributionShiftBaselineState;
  report: DistributionShiftReport;
}): DistributionShiftDashboard => {
  const { records } = input.baseline;
  const series: DistributionShiftDashboardSeriesEntry[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const current = records[index];
    if (current === undefined) continue;
    const past = records.slice(0, index);
    const tokenKl =
      past.length === 0
        ? 0
        : computeKlDivergence(
            current.tokenHistogram,
            sumNumericHistograms(past.map((record) => record.tokenHistogram)),
          );
    const labelKl =
      past.length === 0
        ? 0
        : computeKlDivergence(
            labelHistogramAsArray(current.labelHistogram),
            sumLabelHistograms(past.map((record) => record.labelHistogram)),
          );
    let irShapeKl = 0;
    if (past.length > 0) {
      const baselineIrShape = sumKeyedHistograms(
        past.map((record) => record.irShapeHistogram),
      );
      const aligned = alignKeyedHistograms(
        current.irShapeHistogram,
        baselineIrShape,
      );
      irShapeKl = computeKlDivergence(aligned.current, aligned.baseline);
    }
    let centroidL2: number | undefined;
    if (current.embeddingCentroid !== undefined) {
      const sameDim = past
        .map((record) => record.embeddingCentroid)
        .filter(
          (vector): vector is ReadonlyArray<number> =>
            vector !== undefined &&
            vector.length === current.embeddingCentroid!.length,
        );
      if (sameDim.length > 0) {
        centroidL2 = l2Distance(
          current.embeddingCentroid,
          elementWiseAverage(sameDim),
        );
      }
    }
    series.push({
      recordedAt: current.recordedAt,
      tokenKl: round6(tokenKl),
      labelKl: round6(labelKl),
      irShapeKl: round6(irShapeKl),
      ...(centroidL2 !== undefined ? { centroidL2 } : {}),
    });
  }
  return {
    schemaVersion: DISTRIBUTION_SHIFT_SCHEMA_VERSION,
    generatedAt: input.report.generatedAt,
    fixtureSuiteId: input.report.fixtureSuiteId,
    latest: input.report.snapshot,
    history: series,
    findings: input.report.findings,
    thresholds: {
      kl: DISTRIBUTION_SHIFT_KL_THRESHOLD,
      centroidSigma: DISTRIBUTION_SHIFT_CENTROID_SIGMA_THRESHOLD,
      historyDays: DISTRIBUTION_SHIFT_HISTORY_DAYS,
    },
  };
};

export const writeDistributionShiftReport = async (input: {
  runDir: string;
  report: DistributionShiftReport;
}): Promise<string> => {
  const outputPath = join(input.runDir, DISTRIBUTION_SHIFT_REPORT_FILENAME);
  await mkdir(dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${canonicalJson(input.report)}\n`, "utf8");
  await rename(tempPath, outputPath);
  return outputPath;
};

export const writeDistributionShiftDashboard = async (input: {
  runDir: string;
  dashboard: DistributionShiftDashboard;
}): Promise<string> => {
  const outputPath = join(input.runDir, DISTRIBUTION_SHIFT_DASHBOARD_FILENAME);
  await mkdir(dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${canonicalJson(input.dashboard)}\n`, "utf8");
  await rename(tempPath, outputPath);
  return outputPath;
};

export const createFileDistributionShiftAlertSink = (
  runDir: string,
): DistributionShiftAlertSink => ({
  async publish(input) {
    const outputPath = join(runDir, DISTRIBUTION_SHIFT_ALERTS_FILENAME);
    await mkdir(dirname(outputPath), { recursive: true });
    const tempPath = `${outputPath}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${canonicalJson(input)}\n`, "utf8");
    await rename(tempPath, outputPath);
    return outputPath;
  },
});
