import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
} from "../contracts/index.js";
import {
  applyCaseConfidenceCalibration,
  CASE_CONFIDENCE_CURVE_ARTIFACT_FILENAME,
  buildGeneratedTestCaseConfidenceComponents,
  loadCaseConfidenceCalibration,
  summarizeCaseConfidenceDistribution,
} from "./case-confidence-calibrator.js";

const buildCase = (
  id: string,
  overrides: Partial<GeneratedTestCase> = {},
): GeneratedTestCase => ({
  id,
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: `TC ${id} Finanzierung prüfen`,
  objective: "Prüft den Finanzierungsbedarf für das Investitionsobjekt.",
  level: "system",
  type: "functional",
  polarity: "positive",
  category: "positive_path",
  priority: "p1",
  riskCategory: "medium",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [
    {
      index: 1,
      action: "Öffne den Finanzierungsdialog",
      expected: "Dialog ist sichtbar",
    },
  ],
  expectedResults: ["Finanzierungsbedarf wird korrekt angezeigt."],
  figmaTraceRefs: [{ screenId: "1:11309", nodeId: "field-1" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: ["field-1"],
    coveredActionIds: [],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.8,
  },
  reviewState: "draft",
  audit: {
    jobId: "job-1",
    generatedAt: "2026-05-09T00:00:00.000Z",
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    redactionPolicyVersion: REDACTION_POLICY_VERSION,
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    cacheHit: false,
    cacheKey: "cache-key",
    inputHash: "a".repeat(64),
    promptHash: "b".repeat(64),
    schemaHash: "c".repeat(64),
  },
  ...overrides,
});

const buildList = (testCases: readonly GeneratedTestCase[]): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1",
  testCases: [...testCases],
});

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2));
};

test("buildGeneratedTestCaseConfidenceComponents derives deterministic raw inputs", () => {
  const testCase = buildCase("tc-accepted");
  const components = buildGeneratedTestCaseConfidenceComponents({
    testCase,
    judgeConsensus: {
      verdict: "accept",
      activeFindings: [],
      repairInstructions: [],
      repairState: "none",
      repairHistory: { iterations: [], finalOutcome: "accepted" },
      panel: [],
    } as never,
    faithfulnessTierReport: {
      aggregateScore: 0.95,
      entries: [
        {
          testCaseId: "tc-accepted",
          stepIndex: 1,
          tier: "concrete_data",
          tierReason: "fixture",
          verdict: "match",
          score: 1,
          passesThreshold: true,
        },
      ],
    } as never,
    selfConsistencyReport: {
      selfConsistencyAgreement: 0.88,
      targets: [
        {
          targetKey: "target-1",
          selectedTestCaseId: "tc-accepted",
          samplePresenceCount: 3,
          agreement: 0.88,
          disagreement: false,
          votes: [],
        },
      ],
    } as never,
    oracleReport: {
      cases: [
        {
          testCaseId: "tc-accepted",
          authoritativeTestData: ["Amount: 50.000,00 EUR"],
          authoritativeOpenQuestions: [],
          oracleResolvedFields: [],
          oracleUnresolvedFields: [],
          provenance: [],
        },
      ],
    } as never,
  });
  assert.equal(components.oracleResolved, true);
  assert.equal(components.judgePanelAgreement > 0.8, true);
  assert.equal(components.selfConsistencyAgreement, 0.88);
  assert.equal(components.rawScore > 0.7, true);
});

test("loadCaseConfidenceCalibration fits a historical fallback curve and persists it under sandbox/calibration", async () => {
  const root = await mkdtemp(join(tmpdir(), "case-confidence-"));
  const datasetRoot = join(root, "sandbox", "test-case", "dataset-1");
  const approvedRunDir = join(datasetRoot, "run-approved");
  const reviewRunDir = join(datasetRoot, "run-review");
  const approvedCase = buildCase("tc-approved");
  const reviewCase = buildCase("tc-review", {
    title: "TC review Unklare Brutto-Logik",
    objective: "Markiert ungeklärte Fachlogik zur manuellen Prüfung.",
    qualitySignals: {
      coveredFieldIds: ["field-2"],
      coveredActionIds: [],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: 0.35,
    },
    figmaTraceRefs: [{ screenId: "1:11309", nodeId: "field-2" }],
    openQuestions: ["MwSt.-Regel unklar"],
  });

  await mkdir(approvedRunDir, { recursive: true });
  await mkdir(reviewRunDir, { recursive: true });

  for (const [runDir, testCase, decision, verdict, faithfulnessScore, agreement, oracleResolved] of [
    [approvedRunDir, approvedCase, "approved", "accept", 1, 0.95, true] as const,
    [reviewRunDir, reviewCase, "needs_review", "repair", 0, 0.42, false] as const,
  ]) {
    await writeJson(
      join(runDir, "generated-testcases.json"),
      buildList([testCase]),
    );
    await writeJson(join(runDir, "policy-report.json"), {
      decisions: [{ testCaseId: testCase.id, decision }],
    });
    await writeJson(join(runDir, "judge-consensus.json"), {
      verdict,
      repairState: verdict === "accept" ? "none" : "needs_repair",
      activeFindings:
        verdict === "accept"
          ? []
          : [
              {
                testCaseId: testCase.id,
                code: "policy:manual-review",
              },
            ],
      repairInstructions:
        verdict === "accept"
          ? []
          : [
              {
                testCaseId: testCase.id,
                instruction: "Clarify rule",
                path: "$.openQuestions[0]",
              },
            ],
      repairHistory: {
        iterations: [],
        finalOutcome: verdict === "accept" ? "accepted" : "needs_review",
      },
      panel: [],
    });
    await writeJson(join(runDir, "faithfulness-tier-report.json"), {
      aggregateScore: faithfulnessScore,
      entries: [
        {
          testCaseId: testCase.id,
          stepIndex: 1,
          tier: "concrete_data",
          tierReason: "fixture",
          verdict: faithfulnessScore === 1 ? "match" : "mismatch",
          score: faithfulnessScore,
          passesThreshold: faithfulnessScore >= 0.8,
        },
      ],
    });
    await writeJson(join(runDir, "self-consistency-report.json"), {
      selfConsistencyAgreement: agreement,
      targets: [
        {
          targetKey: testCase.id,
          selectedTestCaseId: testCase.id,
          samplePresenceCount: 3,
          agreement,
          disagreement: agreement < 0.5,
          votes: [],
        },
      ],
    });
    await writeJson(join(runDir, "test-data-oracle-report.json"), {
      cases: [
        {
          testCaseId: testCase.id,
          authoritativeTestData: oracleResolved ? ["Amount: 50.000,00 EUR"] : [],
          authoritativeOpenQuestions: [],
          oracleResolvedFields: oracleResolved
            ? [{ fieldId: "field-1", fieldLabel: "Amount", testDataEntries: [], provenance: [] }]
            : [],
          oracleUnresolvedFields: [],
          provenance: [],
        },
      ],
    });
  }

  const loaded = await loadCaseConfidenceCalibration({
    datasetRoot,
    generatedAt: "2026-05-09T12:00:00.000Z",
  });
  assert.equal(loaded.curve.calibrationSource, "historical_policy_fallback");
  assert.equal(loaded.acceptedAnchors.length, 1);
  assert.match(
    loaded.artifactPath,
    new RegExp(`${CASE_CONFIDENCE_CURVE_ARTIFACT_FILENAME.replace(".", "\\.")}$`),
  );
  const persisted = JSON.parse(await readFile(loaded.artifactPath, "utf8")) as {
    datasetId: string;
  };
  assert.equal(persisted.datasetId, "dataset-1");

  const candidateList = buildList([
    buildCase("tc-candidate-approved"),
    buildCase("tc-candidate-review", {
      title: "TC review Unklare Brutto-Logik",
      objective: "Markiert ungeklärte Fachlogik zur manuellen Prüfung.",
      qualitySignals: {
        coveredFieldIds: ["field-2"],
        coveredActionIds: [],
        coveredValidationIds: [],
        coveredNavigationIds: [],
        confidence: 0.2,
      },
      figmaTraceRefs: [{ screenId: "1:11309", nodeId: "field-2" }],
    }),
  ]);
  const calibrated = applyCaseConfidenceCalibration({
    list: candidateList,
    curve: loaded.curve,
    judgeConsensus: {
      verdict: "accept",
      repairState: "none",
      activeFindings: [],
      repairInstructions: [],
      repairHistory: { iterations: [], finalOutcome: "accepted" },
      panel: [],
    } as never,
    acceptedAnchors: loaded.acceptedAnchors,
  });
  const approvedConfidence = calibrated.testCases[0]?.confidence ?? 0;
  const reviewConfidence = calibrated.testCases[1]?.confidence ?? 0;
  assert.equal(approvedConfidence > reviewConfidence, true);
  assert.equal(typeof calibrated.testCases[0]?.confidenceComponents?.rawScore, "number");
  const summary = summarizeCaseConfidenceDistribution(calibrated);
  assert.notEqual(summary, undefined);
  assert.equal((summary?.confidenceP90 ?? 0) >= (summary?.confidenceP10 ?? 0), true);
});
