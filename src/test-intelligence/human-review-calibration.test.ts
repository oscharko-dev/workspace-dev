import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHumanReviewCalibrationReport,
  compareHumanReviewCalibrationReports,
  HUMAN_REVIEW_CALIBRATION_SCHEMA_VERSION,
  type HumanReviewCriterionSample,
} from "./human-review-calibration.js";

const SAMPLE_ARCTYPE = "baseline-simple-form";

const SAMPLES: ReadonlyArray<HumanReviewCriterionSample> = [
  {
    criterion: "coverage_completeness",
    humanVerdict: "approved",
    singlePass: { judgePrimary: 0.42, judgeSecondary: 0.47 },
    multiAgentHarness: { judgePrimary: 0.88, judgeSecondary: 0.83 },
  },
  {
    criterion: "specific_expected_results",
    humanVerdict: "approved",
    singlePass: { judgePrimary: 0.4, judgeSecondary: 0.45 },
    multiAgentHarness: { judgePrimary: 0.86, judgeSecondary: 0.81 },
  },
  {
    criterion: "budget_discipline",
    humanVerdict: "rejected",
    singlePass: { judgePrimary: 0.71, judgeSecondary: 0.69 },
    multiAgentHarness: { judgePrimary: 0.18, judgeSecondary: 0.22 },
  },
];

test("human-review-calibration: multi-agent harness is better calibrated against human truth", () => {
  const singlePass = buildHumanReviewCalibrationReport({
    archetypeId: SAMPLE_ARCTYPE,
    pipelineId: "single_pass",
    samples: SAMPLES,
  });
  const multiAgent = buildHumanReviewCalibrationReport({
    archetypeId: SAMPLE_ARCTYPE,
    pipelineId: "multi_agent_harness",
    samples: SAMPLES,
  });

  assert.equal(singlePass.schemaVersion, HUMAN_REVIEW_CALIBRATION_SCHEMA_VERSION);
  assert.equal(multiAgent.schemaVersion, HUMAN_REVIEW_CALIBRATION_SCHEMA_VERSION);
  assert.equal(singlePass.sampleSize, 3);
  assert.equal(multiAgent.sampleSize, 3);
  assert.equal(singlePass.criterionErrors.length, 3);
  assert.equal(multiAgent.criterionErrors.length, 3);
  assert.ok(
    multiAgent.overallMeanAbsoluteError < singlePass.overallMeanAbsoluteError,
  );
  assert.ok(
    compareHumanReviewCalibrationReports({
      baseline: singlePass,
      candidate: multiAgent,
    }) < 0,
  );
});

test("human-review-calibration: bias controls are explicit and stable", () => {
  const report = buildHumanReviewCalibrationReport({
    archetypeId: SAMPLE_ARCTYPE,
    pipelineId: "multi_agent_harness",
    samples: SAMPLES,
  });

  assert.deepEqual(report.biasControls, {
    positionBiasMitigation: "empirical_cdf_post_hoc_calibration",
    hardLengthNormalizationApplied: false,
    selfPreferenceMitigation: "cross_family_panel",
    conciseOutputCapChars: 240,
    judgeModelBindings: ["gpt-oss-120b", "phi-4-multimodal-poc"],
  });
  assert.deepEqual(
    report.criterionErrors.map((entry) => entry.criterion),
    ["budget_discipline", "coverage_completeness", "specific_expected_results"],
  );
});

test("human-review-calibration: repeated reviewed examples per criterion aggregate without duplicate-key failures", () => {
  const report = buildHumanReviewCalibrationReport({
    archetypeId: SAMPLE_ARCTYPE,
    pipelineId: "multi_agent_harness",
    samples: [
      {
        sampleId: "coverage-1",
        criterion: "coverage_completeness",
        humanVerdict: "approved",
        singlePass: { judgePrimary: 0.41, judgeSecondary: 0.43 },
        multiAgentHarness: { judgePrimary: 0.88, judgeSecondary: 0.85 },
      },
      {
        sampleId: "coverage-2",
        criterion: "coverage_completeness",
        humanVerdict: "approved",
        singlePass: { judgePrimary: 0.44, judgeSecondary: 0.45 },
        multiAgentHarness: { judgePrimary: 0.86, judgeSecondary: 0.84 },
      },
      {
        sampleId: "specificity-1",
        criterion: "specific_expected_results",
        humanVerdict: "rejected",
        singlePass: { judgePrimary: 0.71, judgeSecondary: 0.69 },
        multiAgentHarness: { judgePrimary: 0.18, judgeSecondary: 0.21 },
      },
    ],
  });

  const coverage = report.criterionErrors.find(
    (entry) => entry.criterion === "coverage_completeness",
  );
  assert.ok(coverage);
  assert.equal(coverage?.sampleSize, 2);
});
