import {
  JUDGE_PANEL_REASON_MAX_CHARS,
  type JudgePanelJudgeId,
} from "../contracts/index.js";
import {
  buildJudgePanelVerdicts,
  type JudgePanelRawSample,
} from "./semantic-judge-panel.js";

export const HUMAN_REVIEW_CALIBRATION_SCHEMA_VERSION = "1.0.0" as const;

export const HUMAN_REVIEW_PIPELINE_IDS = [
  "multi_agent_harness",
  "single_pass",
] as const;

export type HumanReviewPipelineId =
  (typeof HUMAN_REVIEW_PIPELINE_IDS)[number];

export type HumanVerdict = "approved" | "rejected";

export interface HumanReviewJudgeScores {
  judgePrimary: number;
  judgeSecondary: number;
}

export interface HumanReviewCriterionSample {
  sampleId?: string;
  criterion: string;
  humanVerdict: HumanVerdict;
  singlePass: HumanReviewJudgeScores;
  multiAgentHarness: HumanReviewJudgeScores;
}

export interface HumanReviewCriterionCalibrationError {
  criterion: string;
  sampleSize: number;
  meanAbsoluteError: number;
  meanCalibratedScore: number;
  meanHumanVerdict: number;
}

export interface HumanReviewBiasControls {
  positionBiasMitigation: "empirical_cdf_post_hoc_calibration";
  hardLengthNormalizationApplied: false;
  selfPreferenceMitigation: "cross_family_panel";
  conciseOutputCapChars: number;
  judgeModelBindings: readonly [string, string];
}

export interface HumanReviewPipelineCalibrationReport {
  schemaVersion: typeof HUMAN_REVIEW_CALIBRATION_SCHEMA_VERSION;
  pipelineId: HumanReviewPipelineId;
  archetypeId: string;
  sampleSize: number;
  overallMeanAbsoluteError: number;
  criterionErrors: HumanReviewCriterionCalibrationError[];
  biasControls: HumanReviewBiasControls;
}

const PRIMARY_JUDGE_ID: JudgePanelJudgeId = "judge_primary";
const SECONDARY_JUDGE_ID: JudgePanelJudgeId = "judge_secondary";
const PRIMARY_MODEL = "gpt-oss-120b";
const SECONDARY_MODEL = "phi-4-multimodal-poc";

const sortByCriterion = <
  T extends { criterion: string },
>(
  left: T,
  right: T,
): number => left.criterion.localeCompare(right.criterion, "en");

const round6 = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;

const verdictToScore = (verdict: HumanVerdict): number =>
  verdict === "approved" ? 1 : 0;

const pipelineScores = (
  sample: HumanReviewCriterionSample,
  pipelineId: HumanReviewPipelineId,
): HumanReviewJudgeScores =>
  pipelineId === "single_pass" ? sample.singlePass : sample.multiAgentHarness;

const buildPipelineJudgeSamples = (
  archetypeId: string,
  samples: readonly HumanReviewCriterionSample[],
  pipelineId: HumanReviewPipelineId,
): JudgePanelRawSample[] => {
  const out: JudgePanelRawSample[] = [];
  for (const [index, sample] of samples.entries()) {
    const scores = pipelineScores(sample, pipelineId);
    const base = `${pipelineId}:${sample.criterion}`;
    const sampleId =
      typeof sample.sampleId === "string" && sample.sampleId.length > 0
        ? sample.sampleId
        : `${sample.criterion}:${index}`;
    const testCaseId = `${archetypeId}:${sampleId}`;
    out.push(
      {
        testCaseId,
        criterion: sample.criterion,
        judgeId: PRIMARY_JUDGE_ID,
        modelBinding: PRIMARY_MODEL,
        score: scores.judgePrimary,
        reason: `${base}:primary`,
      },
      {
        testCaseId,
        criterion: sample.criterion,
        judgeId: SECONDARY_JUDGE_ID,
        modelBinding: SECONDARY_MODEL,
        score: scores.judgeSecondary,
        reason: `${base}:secondary`,
      },
    );
  }
  return out;
};

const average = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const buildHumanReviewCalibrationReport = (input: {
  archetypeId: string;
  samples: readonly HumanReviewCriterionSample[];
  pipelineId: HumanReviewPipelineId;
}): HumanReviewPipelineCalibrationReport => {
  if (typeof input.archetypeId !== "string" || input.archetypeId.length === 0) {
    throw new TypeError(
      "buildHumanReviewCalibrationReport: archetypeId must be a non-empty string",
    );
  }
  if (!HUMAN_REVIEW_PIPELINE_IDS.includes(input.pipelineId)) {
    throw new RangeError(
      `buildHumanReviewCalibrationReport: unknown pipelineId "${String(
        input.pipelineId,
      )}"`,
    );
  }
  if (!Array.isArray(input.samples) || input.samples.length === 0) {
    throw new TypeError(
      "buildHumanReviewCalibrationReport: samples must be a non-empty array",
    );
  }

  const verdicts = buildJudgePanelVerdicts({
    samples: buildPipelineJudgeSamples(
      input.archetypeId,
      input.samples,
      input.pipelineId,
    ),
  });
  const verdictByCriterion = new Map(
    verdicts.map((verdict) => [verdict.criterion, verdict]),
  );
  const grouped = new Map<string, HumanReviewCriterionCalibrationError>();

  for (const sample of input.samples) {
    const verdict = verdictByCriterion.get(sample.criterion);
    if (verdict === undefined) {
      throw new Error(
        `buildHumanReviewCalibrationReport: missing verdict for criterion "${sample.criterion}"`,
      );
    }
    const humanScore = verdictToScore(sample.humanVerdict);
    const meanCalibratedScore = average(
      verdict.perJudge.map((entry) => entry.calibratedScore),
    );
    const error = Math.abs(meanCalibratedScore - humanScore);
    const current = grouped.get(sample.criterion);
    if (current === undefined) {
      grouped.set(sample.criterion, {
        criterion: sample.criterion,
        sampleSize: 1,
        meanAbsoluteError: error,
        meanCalibratedScore,
        meanHumanVerdict: humanScore,
      });
      continue;
    }
    const nextSampleSize = current.sampleSize + 1;
    grouped.set(sample.criterion, {
      criterion: sample.criterion,
      sampleSize: nextSampleSize,
      meanAbsoluteError:
        (current.meanAbsoluteError * current.sampleSize + error) / nextSampleSize,
      meanCalibratedScore:
        (current.meanCalibratedScore * current.sampleSize + meanCalibratedScore) /
        nextSampleSize,
      meanHumanVerdict:
        (current.meanHumanVerdict * current.sampleSize + humanScore) /
        nextSampleSize,
    });
  }

  const criterionErrors = [...grouped.values()]
    .map((entry) => ({
      criterion: entry.criterion,
      sampleSize: entry.sampleSize,
      meanAbsoluteError: round6(entry.meanAbsoluteError),
      meanCalibratedScore: round6(entry.meanCalibratedScore),
      meanHumanVerdict: round6(entry.meanHumanVerdict),
    }))
    .sort(sortByCriterion);
  const overallMeanAbsoluteError = round6(
    average(criterionErrors.map((entry) => entry.meanAbsoluteError)),
  );

  return {
    schemaVersion: HUMAN_REVIEW_CALIBRATION_SCHEMA_VERSION,
    pipelineId: input.pipelineId,
    archetypeId: input.archetypeId,
    sampleSize: input.samples.length,
    overallMeanAbsoluteError,
    criterionErrors,
    biasControls: {
      positionBiasMitigation: "empirical_cdf_post_hoc_calibration",
      hardLengthNormalizationApplied: false,
      selfPreferenceMitigation: "cross_family_panel",
      conciseOutputCapChars: JUDGE_PANEL_REASON_MAX_CHARS,
      judgeModelBindings: [PRIMARY_MODEL, SECONDARY_MODEL],
    },
  };
};

export const compareHumanReviewCalibrationReports = (input: {
  baseline: HumanReviewPipelineCalibrationReport;
  candidate: HumanReviewPipelineCalibrationReport;
}): number =>
  round6(
    input.candidate.overallMeanAbsoluteError -
      input.baseline.overallMeanAbsoluteError,
  );
