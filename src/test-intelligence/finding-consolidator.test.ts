import assert from "node:assert/strict";
import test from "node:test";

import type {
  JudgePanelVerdict,
  TestCaseValidationReport,
} from "../contracts/index.js";
import {
  consolidateFindings,
  serializeConsolidatedFindings,
  type ConsolidatedFinding,
} from "./finding-consolidator.js";

const validationReport: TestCaseValidationReport = {
  schemaVersion: "1.0.0",
  contractVersion: "1.6.0",
  generatedAt: "2026-05-03T00:00:00.000Z",
  jobId: "job-1786",
  blocked: true,
  issues: [
    {
      testCaseId: "tc-edit",
      path: "$.testCases[0].steps[0].action",
      code: "semantic_suspicious_content",
      severity: "error",
      message: "Suspicious content at rule:validator-line",
    },
    {
      testCaseId: "tc-edit",
      path: "$.testCases[0].steps[0].action",
      code: "semantic_suspicious_content",
      severity: "error",
      message: "Suspicious content at rule:validator-line",
    },
  ],
};

const judgeVerdicts: readonly JudgePanelVerdict[] = [
  {
    schemaVersion: "1.0.0",
    testCaseId: "tc-edit",
    criterion: "completeness",
    perJudge: [
      {
        judgeId: "judge_primary",
        modelBinding: "model-a",
        score: 0.2,
        calibratedScore: 0.2,
        verdict: "fail",
        reason: "missing coverage",
      },
      {
        judgeId: "judge_secondary",
        modelBinding: "model-b",
        score: 0.3,
        calibratedScore: 0.3,
        verdict: "fail",
        reason: "missing coverage",
      },
    ],
    agreement: "both_fail",
    resolvedSeverity: "critical",
    escalationRoute: "needs_review",
  },
];

const gapFindings = [
  {
    schemaVersion: "1.0.0" as const,
    findingId: "gap-missing-negative_case",
    kind: "missing_negative_case" as const,
    severity: "major" as const,
    summary:
      "Negative-path coverage is incomplete for surviving adversarial checks.",
    sourceRefs: ["rule:missing-required"],
    ruleRefs: ["mut-negative"],
    relatedMutationIds: ["mut-negative"],
    missingCaseType: "negative" as const,
  },
  {
    schemaVersion: "1.0.0" as const,
    findingId: "gap-missing-negative_case-duplicate",
    kind: "missing_negative_case" as const,
    severity: "major" as const,
    summary:
      "Negative-path coverage is incomplete for surviving adversarial checks.",
    sourceRefs: ["rule:missing-required"],
    ruleRefs: ["mut-negative"],
    relatedMutationIds: ["mut-negative"],
    missingCaseType: "negative" as const,
  },
];

test("AT-006 equivalent: consolidator dedupes and prioritizes deterministically", () => {
  const consolidated = consolidateFindings({
    validationReport,
    judgeVerdicts,
    gapFindings,
  });
  const reordered = consolidateFindings({
    validationReport: {
      ...validationReport,
      issues: [...validationReport.issues].reverse(),
    },
    judgeVerdicts: [...judgeVerdicts].reverse(),
    gapFindings: [...gapFindings].reverse(),
  });

  assert.equal(consolidated.length, 3);
  assert.deepEqual(
    consolidated.map((finding: ConsolidatedFinding) => finding.severity),
    ["critical", "critical", "major"],
  );
  assert.equal(
    serializeConsolidatedFindings(consolidated),
    serializeConsolidatedFindings(reordered),
  );
  assert.deepEqual(
    consolidated[2]?.relatedFindingIds,
    ["gap-missing-negative_case", "gap-missing-negative_case-duplicate", "mut-negative"],
  );
});
