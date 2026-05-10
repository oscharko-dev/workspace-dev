/**
 * Eingabemasken benchmark for the Issue #2114 incident classifier.
 *
 * Drives the classifier against the EU banking/insurance Eingabemaske
 * archetype catalog with the default green-run shape (zero validation
 * errors, every case approved with no policy violations). The
 * acceptance contract from the issue is verbatim: "with default
 * policy, zero CRITICAL incidents on green run". The assertion is
 * symmetric — a regression that flips an Eingabemaske into a
 * `critical` incident on clean inputs is caught here before it ships.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type TestCasePolicyDecisionRecord,
  type TestCasePolicyReport,
  type TestCaseValidationReport,
} from "../contracts/index.js";
import {
  EINGABEMASKEN_ARCHETYPE_FIXTURE_IDS,
  loadEingabemaskenArchetypeFixture,
  type EingabemaskenArchetypeFixtureId,
} from "./eingabemasken-fixtures.js";
import {
  classifyIncidents,
  type IncidentClassifierTestCase,
} from "./incident-classifier.js";

const OBSERVED_AT = "2026-05-10T00:00:00.000Z";

const buildGreenRun = (
  fixtureId: EingabemaskenArchetypeFixtureId,
  riskCategory: IncidentClassifierTestCase["riskCategory"],
): {
  jobId: string;
  validationReport: TestCaseValidationReport;
  policyReport: TestCasePolicyReport;
  testCases: IncidentClassifierTestCase[];
} => {
  const jobId = `job-${fixtureId}`;
  const testCases: IncidentClassifierTestCase[] = [
    { testCaseId: `${fixtureId}-tc-1`, riskCategory },
    { testCaseId: `${fixtureId}-tc-2`, riskCategory },
  ];
  const decisions: TestCasePolicyDecisionRecord[] = testCases.map((tc) => ({
    testCaseId: tc.testCaseId,
    decision: "approved",
    violations: [],
  }));
  const validationReport: TestCaseValidationReport = {
    schemaVersion: TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt: OBSERVED_AT,
    jobId,
    totalTestCases: testCases.length,
    errorCount: 0,
    warningCount: 0,
    blocked: false,
    issues: [],
  };
  const policyReport: TestCasePolicyReport = {
    schemaVersion: TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt: OBSERVED_AT,
    jobId,
    policyProfileId: "default",
    policyProfileVersion: "1.0.0",
    totalTestCases: testCases.length,
    approvedCount: testCases.length,
    blockedCount: 0,
    needsReviewCount: 0,
    blocked: false,
    decisions,
    jobLevelViolations: [],
  };
  return { jobId, validationReport, policyReport, testCases };
};

test("incident-eingabemasken-benchmark: covers every archetype fixture in the catalog", () => {
  // Sanity guard so a fixture removal doesn't silently shrink the benchmark.
  assert.equal(EINGABEMASKEN_ARCHETYPE_FIXTURE_IDS.length, 15);
});

for (const fixtureId of EINGABEMASKEN_ARCHETYPE_FIXTURE_IDS) {
  test(`incident-eingabemasken-benchmark: ${fixtureId} green run emits zero CRITICAL incidents`, async () => {
    const fixture = await loadEingabemaskenArchetypeFixture(fixtureId);
    const { jobId, validationReport, policyReport, testCases } = buildGreenRun(
      fixtureId,
      fixture.compliance.regulatedRiskOverride,
    );
    const report = classifyIncidents({
      jobId,
      observedAt: OBSERVED_AT,
      validationReport,
      policyReport,
      testCases,
    });
    const critical = report.events.filter((e) => e.severity === "critical");
    assert.equal(
      critical.length,
      0,
      `expected zero CRITICAL incidents on default green run for ${fixtureId}; got: ${critical
        .map((e) => `${e.category}@${e.severity}`)
        .join(", ")}`,
    );
    assert.equal(report.reviewState, "ok");
  });
}
