import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { TEST_INTELLIGENCE_CONTRACT_VERSION } from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  BASELINE_ARCHETYPE_FIXTURE_IDS,
  type BaselineArchetypeFixtureId,
  loadBaselineArchetypeFixture,
} from "./baseline-fixtures.js";
import {
  buildHumanReviewCalibrationReport,
  compareHumanReviewCalibrationReports,
  type HumanReviewCriterionSample,
  type HumanReviewPipelineCalibrationReport,
} from "./human-review-calibration.js";

const FIXTURES_DIR = join(new URL(".", import.meta.url).pathname, "fixtures");

const EVAL_AB_INPUT_SCHEMA_VERSION = "1.0.0" as const;
export const EVAL_AB_SCHEMA_VERSION = "1.0.0" as const;
export const EVAL_AB_FIXTURE_GENERATED_AT = "2026-05-04T00:00:00.000Z" as const;

export interface EvalAbPipelineInputMetrics {
  coverageScore: number;
  duplicateRate: number;
  genericExpectedResultRate: number;
  finOpsSpendMinorUnits: number;
}

export interface EvalAbInputArchetypeRecord {
  archetypeId: BaselineArchetypeFixtureId;
  singlePass: EvalAbPipelineInputMetrics;
  multiAgentHarness: EvalAbPipelineInputMetrics;
  reviewSamples: HumanReviewCriterionSample[];
}

interface EvalAbInputDocument {
  schemaVersion: typeof EVAL_AB_INPUT_SCHEMA_VERSION;
  generatedAt: string;
  archetypes: EvalAbInputArchetypeRecord[];
}

export interface EvalAbMetric {
  value: number;
  deltaVsSinglePass: number;
}

export interface EvalAbPipelineReport {
  pipelineId: "multi_agent_harness" | "single_pass";
  metrics: {
    coverageDelta: EvalAbMetric;
    duplicateRateDelta: EvalAbMetric;
    genericExpectedResultDelta: EvalAbMetric;
    finOpsSpendDelta: EvalAbMetric;
  };
  humanCalibration: HumanReviewPipelineCalibrationReport;
}

export interface EvalAbArtifact {
  schemaVersion: typeof EVAL_AB_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  generatedAt: string;
  archetypeId: BaselineArchetypeFixtureId;
  archetype: string;
  intent: string;
  singlePassReference: EvalAbPipelineInputMetrics;
  pipelines: readonly [EvalAbPipelineReport, EvalAbPipelineReport];
  summary: {
    winningPipeline: "multi_agent_harness" | "single_pass" | "tie";
    winsOnRequiredMetrics: boolean;
    humanCalibrationErrorDelta: number;
  };
}

const EVAL_AB_INPUT_FIXTURE = join(FIXTURES_DIR, "eval-ab-input.json");

const round6 = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;

const round2 = (value: number): number =>
  Math.round(value * 100) / 100;

const evalAbInputFixturePath = (): string => EVAL_AB_INPUT_FIXTURE;

const normalizeText = (value: string): string => value.trim();

const assertRate = (value: number, where: string): void => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new RangeError(`${where} must be a finite number in [0, 1]`);
  }
};

const assertMetricBlock = (
  metrics: EvalAbPipelineInputMetrics,
  where: string,
): void => {
  if (
    typeof metrics.coverageScore !== "number" ||
    !Number.isFinite(metrics.coverageScore) ||
    metrics.coverageScore < 0
  ) {
    throw new RangeError(`${where}.coverageScore must be a finite number >= 0`);
  }
  assertRate(metrics.duplicateRate, `${where}.duplicateRate`);
  assertRate(
    metrics.genericExpectedResultRate,
    `${where}.genericExpectedResultRate`,
  );
  if (
    typeof metrics.finOpsSpendMinorUnits !== "number" ||
    !Number.isFinite(metrics.finOpsSpendMinorUnits)
  ) {
    throw new RangeError(
      `${where}.finOpsSpendMinorUnits must be a finite number`,
    );
  }
};

const assertReviewSample = (
  sample: HumanReviewCriterionSample,
  where: string,
): void => {
  if (normalizeText(sample.criterion).length === 0) {
    throw new TypeError(`${where}.criterion must be a non-empty string`);
  }
  if (!["approved", "rejected"].includes(sample.humanVerdict)) {
    throw new RangeError(
      `${where}.humanVerdict must be "approved" or "rejected"`,
    );
  }
  assertRate(sample.singlePass.judgePrimary, `${where}.singlePass.judgePrimary`);
  assertRate(
    sample.singlePass.judgeSecondary,
    `${where}.singlePass.judgeSecondary`,
  );
  assertRate(
    sample.multiAgentHarness.judgePrimary,
    `${where}.multiAgentHarness.judgePrimary`,
  );
  assertRate(
    sample.multiAgentHarness.judgeSecondary,
    `${where}.multiAgentHarness.judgeSecondary`,
  );
};

const parseEvalAbInputDocument = (raw: string): EvalAbInputDocument => {
  const parsed = JSON.parse(raw) as Partial<EvalAbInputDocument>;
  if (parsed.schemaVersion !== EVAL_AB_INPUT_SCHEMA_VERSION) {
    throw new Error(
      `eval-ab input schemaVersion must be "${EVAL_AB_INPUT_SCHEMA_VERSION}"`,
    );
  }
  if (!Array.isArray(parsed.archetypes) || parsed.archetypes.length === 0) {
    throw new TypeError("eval-ab input must define a non-empty archetypes array");
  }
  for (const [index, entry] of parsed.archetypes.entries()) {
    const where = `eval-ab input archetypes[${index}]`;
    if (
      entry === undefined ||
      !BASELINE_ARCHETYPE_FIXTURE_IDS.includes(entry.archetypeId)
    ) {
      throw new RangeError(`${where}.archetypeId is invalid`);
    }
    assertMetricBlock(entry.singlePass, `${where}.singlePass`);
    assertMetricBlock(entry.multiAgentHarness, `${where}.multiAgentHarness`);
    if (!Array.isArray(entry.reviewSamples) || entry.reviewSamples.length === 0) {
      throw new TypeError(`${where}.reviewSamples must be a non-empty array`);
    }
    entry.reviewSamples.forEach((sample, sampleIndex) =>
      assertReviewSample(sample, `${where}.reviewSamples[${sampleIndex}]`),
    );
  }
  return parsed as EvalAbInputDocument;
};

const loadEvalAbInputDocument = async (): Promise<EvalAbInputDocument> => {
  const raw = await readFile(evalAbInputFixturePath(), "utf8");
  return parseEvalAbInputDocument(raw);
};

const metric = (value: number, baseline: number): EvalAbMetric => ({
  value: round6(value),
  deltaVsSinglePass: round6(value - baseline),
});

const buildPipelineReport = (input: {
  archetypeId: BaselineArchetypeFixtureId;
  pipelineId: "multi_agent_harness" | "single_pass";
  metrics: EvalAbPipelineInputMetrics;
  singlePassReference: EvalAbPipelineInputMetrics;
  reviewSamples: readonly HumanReviewCriterionSample[];
}): EvalAbPipelineReport => ({
  pipelineId: input.pipelineId,
  metrics: {
    coverageDelta: metric(
      input.metrics.coverageScore,
      input.singlePassReference.coverageScore,
    ),
    duplicateRateDelta: metric(
      input.metrics.duplicateRate,
      input.singlePassReference.duplicateRate,
    ),
    genericExpectedResultDelta: metric(
      input.metrics.genericExpectedResultRate,
      input.singlePassReference.genericExpectedResultRate,
    ),
    finOpsSpendDelta: metric(
      input.metrics.finOpsSpendMinorUnits,
      input.singlePassReference.finOpsSpendMinorUnits,
    ),
  },
  humanCalibration: buildHumanReviewCalibrationReport({
    archetypeId: input.archetypeId,
    pipelineId: input.pipelineId,
    samples: input.reviewSamples,
  }),
});

export const resolveEvalAbWinningPipeline = (input: {
  multiAgentHarness: EvalAbPipelineReport;
  singlePass: EvalAbPipelineReport;
  humanCalibrationErrorDelta: number;
}): "multi_agent_harness" | "single_pass" | "tie" => {
  const harnessWins =
    input.multiAgentHarness.metrics.coverageDelta.deltaVsSinglePass > 0 &&
    input.multiAgentHarness.metrics.duplicateRateDelta.deltaVsSinglePass < 0 &&
    input.multiAgentHarness.metrics.genericExpectedResultDelta.deltaVsSinglePass <
      0 &&
    input.multiAgentHarness.metrics.finOpsSpendDelta.deltaVsSinglePass < 0 &&
    input.humanCalibrationErrorDelta < 0;
  if (harnessWins) {
    return "multi_agent_harness";
  }
  const singlePassWins =
    input.multiAgentHarness.metrics.coverageDelta.deltaVsSinglePass < 0 &&
    input.multiAgentHarness.metrics.duplicateRateDelta.deltaVsSinglePass > 0 &&
    input.multiAgentHarness.metrics.genericExpectedResultDelta.deltaVsSinglePass >
      0 &&
    input.multiAgentHarness.metrics.finOpsSpendDelta.deltaVsSinglePass > 0 &&
    input.humanCalibrationErrorDelta > 0;
  if (singlePassWins) {
    return "single_pass";
  }
  return "tie";
};

export const evalAbFixtureFilename = (
  archetypeId: BaselineArchetypeFixtureId,
): string => `eval-ab-${archetypeId.replace(/^baseline-/u, "")}.json`;

export const evalAbFixturePath = (
  archetypeId: BaselineArchetypeFixtureId,
): string => join(FIXTURES_DIR, evalAbFixtureFilename(archetypeId));

export const buildEvalAbArtifact = async (input: {
  archetypeId: BaselineArchetypeFixtureId;
  generatedAt?: string;
}): Promise<EvalAbArtifact> => {
  const [fixture, abInput] = await Promise.all([
    loadBaselineArchetypeFixture(input.archetypeId),
    loadEvalAbInputDocument(),
  ]);
  const generatedAt = input.generatedAt ?? abInput.generatedAt;
  const record = abInput.archetypes.find(
    (entry) => entry.archetypeId === input.archetypeId,
  );
  if (record === undefined) {
    throw new Error(
      `buildEvalAbArtifact: missing input record for ${input.archetypeId}`,
    );
  }

  const singlePass = buildPipelineReport({
    archetypeId: input.archetypeId,
    pipelineId: "single_pass",
    metrics: record.singlePass,
    singlePassReference: record.singlePass,
    reviewSamples: record.reviewSamples,
  });
  const multiAgentHarness = buildPipelineReport({
    archetypeId: input.archetypeId,
    pipelineId: "multi_agent_harness",
    metrics: record.multiAgentHarness,
    singlePassReference: record.singlePass,
    reviewSamples: record.reviewSamples,
  });
  const humanCalibrationErrorDelta = compareHumanReviewCalibrationReports({
    baseline: singlePass.humanCalibration,
    candidate: multiAgentHarness.humanCalibration,
  });
  const winningPipeline = resolveEvalAbWinningPipeline({
    multiAgentHarness,
    singlePass,
    humanCalibrationErrorDelta,
  });
  const winsOnRequiredMetrics = winningPipeline === "multi_agent_harness";

  return {
    schemaVersion: EVAL_AB_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt,
    archetypeId: input.archetypeId,
    archetype: fixture.summary.archetype,
    intent: fixture.summary.intent,
    singlePassReference: {
      coverageScore: round6(record.singlePass.coverageScore),
      duplicateRate: round6(record.singlePass.duplicateRate),
      genericExpectedResultRate: round6(
        record.singlePass.genericExpectedResultRate,
      ),
      finOpsSpendMinorUnits: round2(record.singlePass.finOpsSpendMinorUnits),
    },
    pipelines: [multiAgentHarness, singlePass],
    summary: {
      winningPipeline,
      winsOnRequiredMetrics,
      humanCalibrationErrorDelta,
    },
  };
};

export const buildAllEvalAbArtifacts = async (
  input?: { generatedAt?: string },
): Promise<ReadonlyArray<EvalAbArtifact>> =>
  Promise.all(
    BASELINE_ARCHETYPE_FIXTURE_IDS.map((archetypeId) =>
      buildEvalAbArtifact({
        archetypeId,
        ...(input?.generatedAt !== undefined
          ? { generatedAt: input.generatedAt }
          : {}),
      }),
    ),
  );

export const readEvalAbArtifact = async (
  archetypeId: BaselineArchetypeFixtureId,
): Promise<EvalAbArtifact> => {
  const raw = await readFile(evalAbFixturePath(archetypeId), "utf8");
  return JSON.parse(raw) as EvalAbArtifact;
};

export const writeEvalAbArtifact = async (input: {
  artifact: EvalAbArtifact;
  outputPath?: string;
}): Promise<string> => {
  const outputPath =
    input.outputPath ?? evalAbFixturePath(input.artifact.archetypeId);
  await mkdir(dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, canonicalJson(input.artifact), "utf8");
  await rename(tempPath, outputPath);
  return outputPath;
};

export const writeAllEvalAbArtifacts = async (
  input?: { generatedAt?: string },
): Promise<ReadonlyArray<string>> => {
  const artifacts = await buildAllEvalAbArtifacts(input);
  return Promise.all(
    artifacts.map((artifact) => writeEvalAbArtifact({ artifact })),
  );
};
