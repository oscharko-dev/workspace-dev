import assert from "node:assert/strict";
import test from "node:test";

import type {
  CoveragePlan,
  CoverageRequirement,
  GeneratedTestCase,
  GeneratedTestCaseList,
  IrMutationCoverageStrengthReport,
} from "../contracts/index.js";
import {
  findAdversarialGaps,
  serializeAdversarialGapFindings,
} from "./adversarial-gap-finder.js";

const makeRequirement = (input: {
  id: string;
  technique: CoverageRequirement["technique"];
  sourceRef: string;
}): CoverageRequirement => ({
  requirementId: input.id,
  technique: input.technique,
  reasonCode: "screen_baseline",
  targetIds: [input.id],
  sourceRefs: [input.sourceRef],
  visualRefs: [],
});

const makeCoveragePlan = (): CoveragePlan => ({
  schemaVersion: "1.0.0",
  jobId: "job-1786",
  minimumCases: [
    makeRequirement({
      id: "cov-boundary",
      technique: "boundary_value",
      sourceRef: "rule:amount-boundary",
    }),
    makeRequirement({
      id: "cov-transition",
      technique: "state_transition",
      sourceRef: "rule:submit-transition",
    }),
  ],
  recommendedCases: [
    makeRequirement({
      id: "cov-negative",
      technique: "decision_table",
      sourceRef: "rule:missing-required",
    }),
  ],
  techniques: [
    "boundary_value",
    "decision_table",
    "state_transition",
  ],
  mutationKillRateTarget: 0.85,
});

const makeCase = (input: {
  id: string;
  type?: GeneratedTestCase["type"];
  technique?: GeneratedTestCase["technique"];
}): GeneratedTestCase => ({
  id: input.id,
  sourceJobId: "job-1786",
  contractVersion: "1.6.0",
  schemaVersion: "1.0.0",
  promptTemplateVersion: "prompt-v1",
  title: input.id,
  objective: "Objective",
  level: "system",
  type: input.type ?? "functional",
  priority: "p1",
  riskCategory: "medium",
  technique: input.technique ?? "use_case",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: "Do thing" }],
  expectedResults: ["Works"],
  figmaTraceRefs: [{ screenId: "screen-1" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: [],
    coveredActionIds: [],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.8,
  },
  reviewState: "draft",
  audit: {
    jobId: "job-1786",
    generatedAt: "2026-05-03T00:00:00.000Z",
    contractVersion: "1.6.0",
    schemaVersion: "1.0.0",
    promptTemplateVersion: "prompt-v1",
    redactionPolicyVersion: "redaction-v1",
    visualSidecarSchemaVersion: "1.0.0",
    cacheHit: false,
    cacheKey: "cache-key",
    inputHash: "a".repeat(64),
    promptHash: "b".repeat(64),
    schemaHash: "c".repeat(64),
  },
});

const makeList = (...testCases: GeneratedTestCase[]): GeneratedTestCaseList => ({
  schemaVersion: "1.0.0",
  jobId: "job-1786",
  testCases,
});

const makeMutationReport = (): IrMutationCoverageStrengthReport => ({
  schemaVersion: "1.0.0",
  jobId: "job-1786",
  mutationCount: 3,
  killedMutations: 0,
  mutationKillRate: 0,
  perMutation: [
    {
      mutationId: "mut-negative",
      mutationKind: "flip_required",
      affectedSourceRefs: ["rule:missing-required"],
      killedByTestCaseIds: [],
    },
    {
      mutationId: "mut-boundary",
      mutationKind: "shrink_boundary",
      affectedSourceRefs: ["rule:amount-boundary"],
      killedByTestCaseIds: [],
    },
    {
      mutationId: "mut-transition",
      mutationKind: "drop_state_transition",
      affectedSourceRefs: ["rule:submit-transition"],
      killedByTestCaseIds: [],
    },
  ],
  survivingMutationsForRepair: [
    "mut-boundary",
    "mut-negative",
    "mut-transition",
  ],
});

test("AT-005 equivalent: gap finder produces negative, boundary, and state-transition findings deterministically", () => {
  const findings = findAdversarialGaps({
    list: makeList(makeCase({ id: "tc-1" })),
    coveragePlan: makeCoveragePlan(),
    mutationReport: makeMutationReport(),
  });

  assert.deepEqual(
    findings.map((finding) => finding.kind),
    [
      "missing_boundary_case",
      "missing_negative_case",
      "missing_state_transition_case",
    ],
  );
  assert.equal(findings[0]?.ruleRefs.includes("mut-boundary"), true);
  assert.equal(findings[1]?.sourceRefs.includes("rule:missing-required"), true);
  assert.equal(
    serializeAdversarialGapFindings(findings),
    serializeAdversarialGapFindings(
      findAdversarialGaps({
        list: makeList(makeCase({ id: "tc-1" })),
        coveragePlan: makeCoveragePlan(),
        mutationReport: makeMutationReport(),
      }),
    ),
  );
});
