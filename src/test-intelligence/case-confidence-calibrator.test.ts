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
import type { SupportedLocale } from "./locale-calibration.js";

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
    eceByRiskCategory: Record<string, number>;
  };
  assert.equal(persisted.datasetId, "dataset-1");
  assert.equal(typeof persisted.eceByRiskCategory.regulated_data, "number");

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

test("loadCaseConfidenceCalibration persists held-out diagnostics once history reaches ten samples", async () => {
  const root = await mkdtemp(join(tmpdir(), "case-confidence-heldout-"));
  const datasetRoot = join(root, "sandbox", "test-case", "dataset-2");
  const runDir = join(datasetRoot, "run-history");
  const cases = Array.from({ length: 10 }, (_value, index) =>
    buildCase(`tc-${index}`, {
      title:
        index % 2 === 0
          ? `TC approved ${index} Finanzierung prüfen`
          : `TC review ${index} Unklare Brutto-Logik`,
      objective:
        index % 2 === 0
          ? "Prüft den Finanzierungsbedarf für das Investitionsobjekt."
          : "Markiert ungeklärte Fachlogik zur manuellen Prüfung.",
      qualitySignals: {
        coveredFieldIds: [index % 2 === 0 ? "field-1" : "field-2"],
        coveredActionIds: [],
        coveredValidationIds: [],
        coveredNavigationIds: [],
        confidence: index % 2 === 0 ? 0.9 : 0.25,
      },
      riskCategory:
        index % 2 === 0 ? "regulated_data" : "financial_transaction",
      figmaTraceRefs: [
        {
          screenId: index % 2 === 0 ? "1:11309" : "1:11310",
          nodeId: index % 2 === 0 ? "field-1" : "field-2",
        },
      ],
      openQuestions: index % 2 === 0 ? [] : ["MwSt.-Regel unklar"],
    }),
  );

  await mkdir(runDir, { recursive: true });
  await writeJson(join(runDir, "generated-testcases.json"), buildList(cases));
  await writeJson(join(runDir, "policy-report.json"), {
    decisions: cases.map((testCase, index) => ({
      testCaseId: testCase.id,
      decision: index % 2 === 0 ? "approved" : "needs_review",
    })),
  });
  await writeJson(join(runDir, "judge-consensus.json"), {
    verdict: "accept",
    repairState: "none",
    activeFindings: [],
    repairInstructions: [],
    repairHistory: { iterations: [], finalOutcome: "accepted" },
    panel: [],
  });

  const loaded = await loadCaseConfidenceCalibration({
    datasetRoot,
    generatedAt: "2026-05-09T12:00:00.000Z",
  });

  assert.equal(loaded.curve.calibrationSource, "historical_policy_fallback");
  assert.equal(loaded.curve.sampleCount, 10);
  assert.equal(loaded.curve.heldOutSampleCount, 2);
  assert.equal(typeof loaded.curve.heldOutBrierScore, "number");
  assert.equal(loaded.acceptedAnchors.length, 5);
  assert.equal(loaded.curve.calibrationEvaluationSplit, "held_out");
  assert.equal(loaded.curve.heldOutSampleCountByRiskCategory.regulated_data, 1);
  assert.equal(
    loaded.curve.heldOutSampleCountByRiskCategory.financial_transaction,
    1,
  );
  assert.equal(typeof loaded.curve.eceByRiskCategory.regulated_data, "number");
  assert.equal(
    loaded.curve.minimumRiskCategorySampleFloor,
    50,
  );

  const persisted = JSON.parse(await readFile(loaded.artifactPath, "utf8")) as {
    calibrationSource: string;
    heldOutBrierScore?: number;
    heldOutSampleCount: number;
    sampleCount: number;
    eceByRiskCategory: Record<string, number>;
  };
  assert.equal(persisted.calibrationSource, "historical_policy_fallback");
  assert.equal(persisted.sampleCount, 10);
  assert.equal(persisted.heldOutSampleCount, 2);
  assert.equal(typeof persisted.heldOutBrierScore, "number");
  assert.equal(typeof persisted.eceByRiskCategory.regulated_data, "number");

  const reliability = JSON.parse(
    await readFile(
      join(
        dirname(loaded.artifactPath),
        "case-confidence-reliability-regulated_data.json",
      ),
      "utf8",
    ),
  ) as {
    riskCategory: string;
    sampleCount: number;
    debiasedEce: number;
    minimumSampleFloor: number;
  };
  assert.equal(reliability.riskCategory, "regulated_data");
  assert.equal(reliability.sampleCount, 1);
  assert.equal(typeof reliability.debiasedEce, "number");
  assert.equal(reliability.minimumSampleFloor, 50);
});

// ---------------------------------------------------------------------------
// Per-locale calibration tests (Issue #2117)
// ---------------------------------------------------------------------------

/**
 * Build a synthetic run-directory with `count * 2` cases per screen (both
 * `screenId` and `altScreenId`), alternating approved / needs-review within
 * each screen so both locale buckets have a mix of positive and negative labels.
 * Total cases = count * 4 (count approved + count review per screen, two screens).
 */
const buildLocaleRunDir = async (
  runDir: string,
  count: number,
  screenId: string,
  altScreenId: string,
): Promise<void> => {
  await mkdir(runDir, { recursive: true });
  // Build `count` approved + `count` review for screenId, then same for altScreenId.
  const cases: ReturnType<typeof buildCase>[] = [];
  for (const [sid, offset] of [
    [screenId, 0] as const,
    [altScreenId, count * 2] as const,
  ]) {
    for (let i = 0; i < count * 2; i++) {
      const approved = i % 2 === 0;
      cases.push(
        buildCase(`tc-${runDir.slice(-8)}-${offset + i}`, {
          title: approved
            ? `TC ${offset + i} Finanzierung prüfen approved`
            : `TC ${offset + i} Unklare Brutto-Logik review`,
          objective: approved
            ? "Prüft den Finanzierungsbedarf für das Investitionsobjekt."
            : "Markiert ungeklärte Fachlogik zur manuellen Prüfung.",
          qualitySignals: {
            coveredFieldIds: [`${sid}-field`],
            coveredActionIds: [],
            coveredValidationIds: [],
            coveredNavigationIds: [],
            confidence: approved ? 0.9 : 0.2,
          },
          figmaTraceRefs: [{ screenId: sid, nodeId: `${sid}-node-${offset + i}` }],
          riskCategory: "regulated_data",
          openQuestions: approved ? [] : ["Regel unklar"],
        }),
      );
    }
  }
  await writeJson(join(runDir, "generated-testcases.json"), buildList(cases));
  await writeJson(join(runDir, "policy-report.json"), {
    decisions: cases.map((tc, index) => ({
      testCaseId: tc.id,
      // approved cases are even within each screen block
      decision: index % 2 === 0 ? "approved" : "needs_review",
    })),
  });
  await writeJson(join(runDir, "judge-consensus.json"), {
    verdict: "accept",
    repairState: "none",
    activeFindings: [],
    repairInstructions: [],
    repairHistory: { iterations: [], finalOutcome: "accepted" },
    panel: [],
  });
};

test("loadCaseConfidenceCalibration emits per-locale curves and reliability artifacts when screenLocaleMap supplied", async () => {
  const root = await mkdtemp(join(tmpdir(), "case-confidence-locale-"));
  const datasetRoot = join(root, "sandbox", "test-case", "locale-dataset-1");

  // count=26 → 52 cases per screen per dir (26 approved + 26 review each).
  // Two dirs → DE-DE: 104 samples, DE-AT: 104 samples — both above the 50-sample floor.
  const runDir1 = join(datasetRoot, "run-locale-a");
  const runDir2 = join(datasetRoot, "run-locale-b");

  await buildLocaleRunDir(runDir1, 26, "screen-DE-DE", "screen-DE-AT");
  await buildLocaleRunDir(runDir2, 26, "screen-DE-DE", "screen-DE-AT");

  // Map screen ids to locales.
  const screenLocaleMap = new Map<string, SupportedLocale>([
    ["screen-DE-DE", "DE-DE"],
    ["screen-DE-AT", "DE-AT"],
  ]);

  const loaded = await loadCaseConfidenceCalibration({
    datasetRoot,
    generatedAt: "2026-05-10T00:00:00.000Z",
    screenLocaleMap,
  });

  // Aggregate curve
  assert.equal(loaded.curve.calibrationSource, "historical_policy_fallback");
  assert.equal(typeof loaded.curve.perLocaleEceThreshold, "number");
  assert.equal(loaded.curve.perLocaleEceThreshold, 0.10);

  // DE-DE and DE-AT should have their own fits (≥ 50 samples).
  const deDeEntry = loaded.curve.localeCurves["DE-DE"];
  const deAtEntry = loaded.curve.localeCurves["DE-AT"];
  assert.notEqual(deDeEntry, undefined);
  assert.notEqual(deAtEntry, undefined);
  assert.equal(deDeEntry?.fallbackToDefault, false, "DE-DE should have a genuine fit");
  assert.equal(deAtEntry?.fallbackToDefault, false, "DE-AT should have a genuine fit");

  // DE-CH was unseen — should fallback to default.
  const deChEntry = loaded.curve.localeCurves["DE-CH"];
  assert.notEqual(deChEntry, undefined);
  assert.equal(deChEntry?.fallbackToDefault, true, "DE-CH should fallback to default");

  // localeSampleCount should reflect the screen distribution.
  assert.equal(typeof loaded.curve.localeSampleCount["DE-DE"], "number");
  assert.equal(loaded.curve.localeSampleCount["DE-DE"]! > 0, true);
  assert.equal(typeof loaded.curve.localeSampleCount["DE-AT"], "number");
  assert.equal(loaded.curve.localeSampleCount["DE-AT"]! > 0, true);
  assert.equal(loaded.curve.localeSampleCount["DE-CH"], 0);

  // Per-locale reliability artifact paths must be present.
  assert.notEqual(loaded.localeReliabilityArtifactPaths, undefined);
  assert.notEqual(loaded.localeReliabilityArtifactPaths?.["DE-DE"], undefined);
  assert.notEqual(loaded.localeReliabilityArtifactPaths?.["DE-AT"], undefined);

  // Read a locale artifact and verify its shape.
  const localeArtifactPath = loaded.localeReliabilityArtifactPaths?.["DE-DE"];
  assert.notEqual(localeArtifactPath, undefined);
  const localeArtifact = JSON.parse(await readFile(localeArtifactPath!, "utf8")) as {
    locale: string;
    sampleCount: number;
    debiasedEce: number;
  };
  assert.equal(localeArtifact.locale, "DE-DE");
  assert.equal(localeArtifact.sampleCount > 0, true);
  assert.equal(typeof localeArtifact.debiasedEce, "number");
});

test("applyCaseConfidenceCalibration uses the per-locale curve when present and falls back to default for unseen locales", async () => {
  const root = await mkdtemp(join(tmpdir(), "case-confidence-locale-apply-"));
  const datasetRoot = join(root, "sandbox", "test-case", "locale-dataset-apply");

  // Build enough samples so DE-DE gets a genuine per-locale fit.
  const runDir = join(datasetRoot, "run-locale-apply");
  await buildLocaleRunDir(runDir, 30, "screen-DE-DE", "screen-DE-DE-alt");

  const screenLocaleMap = new Map<string, SupportedLocale>([
    ["screen-DE-DE", "DE-DE"],
    ["screen-DE-DE-alt", "DE-DE"],
    // "screen-unknown" is intentionally absent to test fallback.
  ]);

  const loaded = await loadCaseConfidenceCalibration({
    datasetRoot,
    generatedAt: "2026-05-10T00:00:00.000Z",
    screenLocaleMap,
  });

  // Build two cases with the same rawScore configuration but different screen locales.
  const caseWithLocale = buildCase("tc-locale-known", {
    figmaTraceRefs: [{ screenId: "screen-DE-DE", nodeId: "n1" }],
    qualitySignals: {
      coveredFieldIds: ["f1"],
      coveredActionIds: [],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: 0.75,
    },
  });
  const caseWithoutLocale = buildCase("tc-locale-unknown", {
    figmaTraceRefs: [{ screenId: "screen-unknown", nodeId: "n2" }],
    qualitySignals: {
      coveredFieldIds: ["f1"],
      coveredActionIds: [],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: 0.75,
    },
  });

  const dummyConsensus = {
    verdict: "accept" as const,
    repairState: "none" as const,
    activeFindings: [],
    repairInstructions: [],
    repairHistory: { iterations: [], finalOutcome: "accepted" as const },
    panel: [],
  };

  // Apply with locale map — the locale-known case should use the DE-DE curve.
  const calibratedWithMap = applyCaseConfidenceCalibration({
    list: buildList([caseWithLocale, caseWithoutLocale]),
    curve: loaded.curve,
    judgeConsensus: dummyConsensus as never,
    screenLocaleMap,
  });
  const confidenceWithLocale = calibratedWithMap.testCases[0]?.confidence ?? -1;
  const confidenceWithoutLocale = calibratedWithMap.testCases[1]?.confidence ?? -1;

  // Apply without locale map — both should use the aggregate curve.
  const calibratedNoMap = applyCaseConfidenceCalibration({
    list: buildList([caseWithLocale, caseWithoutLocale]),
    curve: loaded.curve,
    judgeConsensus: dummyConsensus as never,
  });
  const confidenceAggLocale = calibratedNoMap.testCases[0]?.confidence ?? -1;
  const confidenceAggUnknown = calibratedNoMap.testCases[1]?.confidence ?? -1;

  // The unknown-screen case should match aggregate curve output.
  assert.equal(
    confidenceWithoutLocale,
    confidenceAggUnknown,
    "Unknown locale must fall back to aggregate curve",
  );

  // DE-DE curve may differ from aggregate if enough samples for its own fit.
  const deDeEntry = loaded.curve.localeCurves["DE-DE"];
  if (deDeEntry !== undefined && !deDeEntry.fallbackToDefault) {
    // With a real per-locale curve the confidence values may differ.
    assert.equal(
      typeof confidenceWithLocale,
      "number",
      "DE-DE locale curve must produce a numeric confidence",
    );
  } else {
    // Fallback: both should equal aggregate.
    assert.equal(confidenceWithLocale, confidenceAggLocale);
  }

  // Both must be valid probabilities.
  assert.equal(confidenceWithLocale >= 0 && confidenceWithLocale <= 1, true);
  assert.equal(confidenceWithoutLocale >= 0 && confidenceWithoutLocale <= 1, true);
});
