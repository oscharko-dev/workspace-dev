import type {
  CoverageReport,
  GeneratedTestCase,
  PolicyReport,
  ReviewSnapshotEntry,
  TestIntelligenceBundle,
  ValidationReport,
  VisualSidecarReport,
} from "./types";

export const ASSEMBLED_AT = "2026-04-25T11:00:00.000Z";

export function buildTestCase(
  overrides: Partial<GeneratedTestCase> = {},
): GeneratedTestCase {
  return {
    id: "tc-1",
    sourceJobId: "job-1",
    title: "Sign in with valid credentials",
    objective: "Verify the happy-path login flow",
    level: "system",
    type: "functional",
    priority: "p1",
    riskCategory: "medium",
    technique: "equivalence_partitioning",
    preconditions: ["User has an active account"],
    testData: ["alice@example.test"],
    steps: [
      {
        index: 1,
        action: "Open the login form",
        data: "Navigation: app shell",
        expected: "Login form is visible",
      },
      {
        index: 2,
        action: "Enter valid credentials",
        data: "alice / correct-password",
      },
    ],
    expectedResults: ["The user is authenticated"],
    figmaTraceRefs: [
      { screenId: "screen-login", nodeId: "1:42", nodeName: "Login form" },
    ],
    assumptions: ["The auth backend is reachable"],
    openQuestions: [],
    qcMappingPreview: { exportable: true },
    qualitySignals: {
      coveredFieldIds: ["field-email"],
      coveredActionIds: ["action-submit"],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: 0.91,
    },
    reviewState: "needs_review",
    ...overrides,
  };
}

export function buildReviewSnapshotEntry(
  overrides: Partial<ReviewSnapshotEntry> = {},
): ReviewSnapshotEntry {
  return {
    testCaseId: "tc-1",
    state: "needs_review",
    policyDecision: "needs_review",
    lastEventId: "evt-1",
    lastEventAt: ASSEMBLED_AT,
    fourEyesEnforced: false,
    approvers: [],
    ...overrides,
  };
}

export function buildPolicyReport(
  overrides: Partial<PolicyReport> = {},
): PolicyReport {
  return {
    jobId: "job-1",
    policyProfileId: "eu-banking-default",
    policyProfileVersion: "1.0.0",
    totalTestCases: 1,
    approvedCount: 0,
    blockedCount: 0,
    needsReviewCount: 1,
    blocked: false,
    decisions: [
      {
        testCaseId: "tc-1",
        decision: "needs_review",
        violations: [],
      },
    ],
    jobLevelViolations: [],
    ...overrides,
  };
}

export function buildValidationReport(
  overrides: Partial<ValidationReport> = {},
): ValidationReport {
  return {
    jobId: "job-1",
    totalTestCases: 1,
    errorCount: 0,
    warningCount: 0,
    blocked: false,
    issues: [],
    ...overrides,
  };
}

export function buildCoverageReport(
  overrides: Partial<CoverageReport> = {},
): CoverageReport {
  return {
    jobId: "job-1",
    policyProfileId: "eu-banking-default",
    totalTestCases: 1,
    fieldCoverage: {
      total: 2,
      covered: 1,
      ratio: 0.5,
      uncoveredIds: ["field-password"],
    },
    actionCoverage: { total: 1, covered: 1, ratio: 1, uncoveredIds: [] },
    validationCoverage: {
      total: 1,
      covered: 0,
      ratio: 0,
      uncoveredIds: ["v1"],
    },
    navigationCoverage: { total: 1, covered: 1, ratio: 1, uncoveredIds: [] },
    traceCoverage: { total: 1, withTrace: 1, ratio: 1 },
    negativeCaseCount: 0,
    validationCaseCount: 0,
    boundaryCaseCount: 0,
    accessibilityCaseCount: 0,
    workflowCaseCount: 1,
    positiveCaseCount: 1,
    assumptionsRatio: 0,
    openQuestionsCount: 0,
    duplicatePairs: [],
    ...overrides,
  };
}

export function buildVisualSidecarReport(
  overrides: Partial<VisualSidecarReport> = {},
): VisualSidecarReport {
  return {
    jobId: "job-1",
    totalScreens: 1,
    screensWithFindings: 0,
    blocked: false,
    records: [
      {
        screenId: "screen-login",
        deployment: "llama-4-maverick-vision",
        outcomes: ["ok"],
        meanConfidence: 0.92,
      },
    ],
    ...overrides,
  };
}

export function buildBundle(
  overrides: Partial<TestIntelligenceBundle> = {},
): TestIntelligenceBundle {
  return {
    jobId: "job-1",
    assembledAt: ASSEMBLED_AT,
    generatedTestCases: { jobId: "job-1", testCases: [buildTestCase()] },
    validationReport: buildValidationReport(),
    policyReport: buildPolicyReport(),
    coverageReport: buildCoverageReport(),
    visualSidecarReport: buildVisualSidecarReport(),
    reviewSnapshot: {
      jobId: "job-1",
      generatedAt: ASSEMBLED_AT,
      approvedCount: 0,
      needsReviewCount: 1,
      rejectedCount: 0,
      perTestCase: [buildReviewSnapshotEntry()],
    },
    reviewEvents: [],
    parseErrors: [],
    ...overrides,
  };
}
