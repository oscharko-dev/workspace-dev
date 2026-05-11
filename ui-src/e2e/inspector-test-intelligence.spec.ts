import { expect, test } from "@playwright/test";
import { expectNoBlockingAccessibilityViolations } from "./a11y";
import { getWorkspaceUiUrl } from "./helpers";

const bundle = {
  jobId: "job-e2e",
  assembledAt: "2026-04-25T12:00:00.000Z",
  generatedTestCases: {
    jobId: "job-e2e",
    testCases: [
      {
        id: "tc-login",
        sourceJobId: "job-e2e",
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
            expected: "Login form is visible",
          },
        ],
        expectedResults: ["The user is authenticated"],
        figmaTraceRefs: [
          {
            screenId: "screen-login",
            nodeId: "1:42",
            nodeName: "Login form",
          },
        ],
        assumptions: [],
        openQuestions: [],
        qcMappingPreview: { exportable: true },
        qualitySignals: {
          coveredFieldIds: ["field-email"],
          coveredActionIds: ["action-submit"],
          coveredValidationIds: [],
          coveredNavigationIds: [],
          confidence: 0.9,
        },
        reviewState: "needs_review",
      },
    ],
  },
  validationReport: {
    jobId: "job-e2e",
    totalTestCases: 1,
    errorCount: 0,
    warningCount: 0,
    blocked: false,
    issues: [],
  },
  policyReport: {
    jobId: "job-e2e",
    policyProfileId: "eu-banking-default",
    policyProfileVersion: "1.0.0",
    totalTestCases: 1,
    approvedCount: 0,
    blockedCount: 0,
    needsReviewCount: 1,
    blocked: false,
    decisions: [
      {
        testCaseId: "tc-login",
        decision: "needs_review",
        violations: [],
      },
    ],
    jobLevelViolations: [],
  },
  coverageReport: {
    jobId: "job-e2e",
    policyProfileId: "eu-banking-default",
    totalTestCases: 1,
    fieldCoverage: { total: 1, covered: 1, ratio: 1, uncoveredIds: [] },
    actionCoverage: { total: 1, covered: 1, ratio: 1, uncoveredIds: [] },
    validationCoverage: { total: 0, covered: 0, ratio: 1, uncoveredIds: [] },
    navigationCoverage: { total: 0, covered: 0, ratio: 1, uncoveredIds: [] },
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
  },
  visualSidecarReport: {
    jobId: "job-e2e",
    totalScreens: 1,
    screensWithFindings: 1,
    blocked: false,
    records: [
      {
        screenId: "screen-login",
        deployment: "phi-4-multimodal-poc",
        outcomes: ["fallback_used", "low_confidence"],
        issues: [
          {
            path: "$.screens[0]",
            code: "low_confidence",
            severity: "warning",
            message: "Sidecar confidence below threshold",
            testCaseId: "tc-login",
          },
        ],
        meanConfidence: 0.55,
      },
    ],
  },
  qcMappingPreview: {
    jobId: "job-e2e",
    profileId: "qc-default",
    profileVersion: "1.0.0",
    entries: [
      {
        testCaseId: "tc-login",
        externalIdCandidate: "job-e2e-tc-login",
        testName: "Sign in with valid credentials",
        objective: "Verify the happy-path login flow",
        priority: "p1",
        riskCategory: "medium",
        targetFolderPath: "Workspace/Login",
        exportable: true,
        blockingReasons: [],
        visualProvenance: {
          deployment: "phi-4-multimodal-poc",
          fallbackReason: "primary_unavailable",
          confidenceMean: 0.55,
          ambiguityCount: 1,
          evidenceHash: "abcdef1234567890",
        },
      },
    ],
  },
  exportReport: {
    jobId: "job-e2e",
    profileId: "qc-default",
    profileVersion: "1.0.0",
    exportedTestCaseCount: 1,
    refused: false,
    refusalCodes: [],
    artifacts: [
      {
        filename: "testcases.csv",
        sha256: "abcdef1234567890",
        bytes: 128,
        contentType: "text/csv",
      },
    ],
    visualEvidenceHashes: ["abcdef1234567890"],
    rawScreenshotsIncluded: false,
  },
  reviewSnapshot: {
    jobId: "job-e2e",
    generatedAt: "2026-04-25T12:00:00.000Z",
    approvedCount: 0,
    needsReviewCount: 1,
    rejectedCount: 0,
    perTestCase: [
      {
        testCaseId: "tc-login",
        state: "needs_review",
        policyDecision: "needs_review",
        lastEventId: "evt-1",
        lastEventAt: "2026-04-25T12:00:00.000Z",
        fourEyesEnforced: true,
        approvers: [],
      },
    ],
  },
  reviewEvents: [],
  parseErrors: [],
};

test.describe("Inspector Test Intelligence", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/workspace", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ testIntelligenceEnabled: true }),
      });
    });
    await page.route(
      "**/workspace/test-intelligence/jobs/job-e2e",
      async (route) => {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(bundle),
        });
      },
    );
    await page.route(
      "**/workspace/test-intelligence/review/job-e2e/state",
      async (route) => {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            snapshot: bundle.reviewSnapshot,
            events: [],
          }),
        });
      },
    );
    await page.route(
      "**/workspace/test-intelligence/review/job-e2e/approve/tc-login",
      async (route) => {
        expect(route.request().method()).toBe("POST");
        expect(route.request().headers().authorization).toBe(
          "Bearer scoped-token",
        );
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            snapshot: {
              ...bundle.reviewSnapshot,
              approvedCount: 1,
              needsReviewCount: 0,
            },
            event: {
              id: "evt-2",
              jobId: "job-e2e",
              testCaseId: "tc-login",
              kind: "approved",
              at: "2026-04-25T12:01:00.000Z",
              sequence: 2,
              fromState: "needs_review",
              toState: "approved",
              actor: "alice",
            },
          }),
        });
      },
    );
  });

  test("renders provenance, passes a11y, and submits review actions", async ({
    page,
  }) => {
    const url = new URL(getWorkspaceUiUrl());
    url.pathname = "/workspace/ui/inspector/test-intelligence";
    url.searchParams.set("jobId", "job-e2e");
    await page.goto(url.toString());

    await expect(page.getByTestId("ti-test-case-list")).toBeVisible();
    await expect(
      page.getByTestId("ti-detail-visual-observations"),
    ).toContainText("visual_sidecar");
    await expect(
      page.getByTestId("ti-detail-qc-visual-provenance"),
    ).toContainText("abcdef123456");
    await expect(page.getByTestId("ti-export-diagnostics")).toContainText(
      "QC export diagnostics",
    );
    await expect(
      page.getByTestId("ti-visual-sidecar-issue-screen-login-0"),
    ).toContainText("low_confidence");

    await expectNoBlockingAccessibilityViolations({
      page,
      include: [
        '[data-testid="ti-detail-visual-observations"]',
        '[data-testid="ti-export-diagnostics"]',
      ],
    });

    await page.getByTestId("ti-reviewer-handle-input").fill("alice");
    await page.getByTestId("ti-reviewer-bearer-input").fill("scoped-token");
    await page.getByTestId("ti-detail-action-approve").click();
    await expect(page.getByTestId("ti-detail-action-approve")).toBeEnabled();
  });
});
