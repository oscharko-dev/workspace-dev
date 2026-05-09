import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOWED_INCIDENT_CATEGORIES,
  ALLOWED_INCIDENT_REVIEW_STATES,
  ALLOWED_INCIDENT_SEVERITIES,
  INCIDENT_REPORT_SCHEMA_VERSION,
  TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type IncidentCategory,
  type ManifestRef,
  type TestCasePolicyDecisionRecord,
  type TestCasePolicyReport,
  type TestCaseRiskCategory,
  type TestCaseValidationReport,
} from "../contracts/index.js";
import {
  classifyIncidents,
  requiresIncidentAck,
  type IncidentClassifierTestCase,
  type IncidentSignal,
} from "./incident-classifier.js";

const JOB_ID = "job-incident-2114";
const OBSERVED_AT = "2026-05-10T12:00:00.000Z";

const buildValidationReport = (
  errorCount: number,
): TestCaseValidationReport => ({
  schemaVersion: TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: OBSERVED_AT,
  jobId: JOB_ID,
  totalTestCases: 1,
  errorCount,
  warningCount: 0,
  blocked: errorCount > 0,
  issues: [],
});

const buildPolicyReport = (
  decisions: TestCasePolicyDecisionRecord[],
): TestCasePolicyReport => ({
  schemaVersion: TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: OBSERVED_AT,
  jobId: JOB_ID,
  policyProfileId: "default",
  policyProfileVersion: "1.0.0",
  totalTestCases: decisions.length,
  approvedCount: decisions.filter((d) => d.decision === "approved").length,
  blockedCount: decisions.filter((d) => d.decision === "blocked").length,
  needsReviewCount: decisions.filter((d) => d.decision === "needs_review")
    .length,
  blocked: decisions.some((d) => d.decision === "blocked"),
  decisions,
  jobLevelViolations: [],
});

const buildClassifierCase = (
  testCaseId: string,
  riskCategory: TestCaseRiskCategory,
): IncidentClassifierTestCase => ({
  testCaseId,
  riskCategory,
});

test("incident-classifier: contract enums match Issue #2114 spec", () => {
  assert.deepEqual([...ALLOWED_INCIDENT_SEVERITIES], [
    "low",
    "medium",
    "high",
    "critical",
  ]);
  assert.deepEqual([...ALLOWED_INCIDENT_CATEGORIES], [
    "compliance_rule_pack_violation",
    "drift_alert",
    "judge_disagreement_persistent",
    "pii_leakage",
    "policy_gate_bypass",
    "replay_cache_miss_unexpected",
    "subprocessor_outage",
  ]);
  assert.deepEqual([...ALLOWED_INCIDENT_REVIEW_STATES], [
    "ok",
    "incident_ack_required",
  ]);
});

test("incident-classifier: clean inputs emit zero events and review state ok", () => {
  const report = classifyIncidents({
    jobId: JOB_ID,
    observedAt: OBSERVED_AT,
    validationReport: buildValidationReport(0),
    policyReport: buildPolicyReport([
      {
        testCaseId: "tc-1",
        decision: "approved",
        violations: [],
      },
    ]),
    testCases: [buildClassifierCase("tc-1", "low")],
  });
  assert.equal(report.events.length, 0);
  assert.equal(report.reviewState, "ok");
  assert.equal(report.schemaVersion, INCIDENT_REPORT_SCHEMA_VERSION);
  assert.equal(report.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
  assert.equal(report.jobId, JOB_ID);
  assert.equal(report.generatedAt, OBSERVED_AT);
  assert.equal(requiresIncidentAck(report), false);
});

test("incident-classifier: PII outcome on regulated_data case is critical and pauses pipeline", () => {
  const report = classifyIncidents({
    jobId: JOB_ID,
    observedAt: OBSERVED_AT,
    validationReport: buildValidationReport(1),
    policyReport: buildPolicyReport([
      {
        testCaseId: "tc-pii",
        decision: "blocked",
        violations: [
          {
            rule: "policy.pii.testdata",
            outcome: "pii_in_test_data",
            severity: "error",
            reason: "raw IBAN observed in step.data",
          },
        ],
      },
    ]),
    testCases: [buildClassifierCase("tc-pii", "regulated_data")],
  });
  assert.equal(report.events.length, 1);
  const incident = report.events[0]!;
  assert.equal(incident.category, "pii_leakage");
  assert.equal(incident.severity, "critical");
  assert.equal(incident.jobId, JOB_ID);
  assert.equal(incident.observedAt, OBSERVED_AT);
  assert.match(incident.id, /^[0-9a-f]{16}$/);
  assert.equal(report.reviewState, "incident_ack_required");
  assert.equal(requiresIncidentAck(report), true);
});

test("incident-classifier: PII outcome on a low-risk approved case stays below critical", () => {
  const report = classifyIncidents({
    jobId: JOB_ID,
    observedAt: OBSERVED_AT,
    validationReport: buildValidationReport(1),
    policyReport: buildPolicyReport([
      {
        testCaseId: "tc-pii-low",
        decision: "needs_review",
        violations: [
          {
            rule: "policy.pii.visual",
            outcome: "visual_sidecar_possible_pii",
            severity: "warning",
            reason: "visual sidecar flagged possible PII near label",
          },
        ],
      },
    ]),
    testCases: [buildClassifierCase("tc-pii-low", "low")],
  });
  assert.equal(report.events.length, 1);
  assert.notEqual(report.events[0]!.severity, "critical");
  assert.equal(report.reviewState, "ok");
});

test("incident-classifier: judge disagreement outcomes derive judge_disagreement_persistent", () => {
  const report = classifyIncidents({
    jobId: JOB_ID,
    observedAt: OBSERVED_AT,
    validationReport: buildValidationReport(0),
    policyReport: buildPolicyReport([
      {
        testCaseId: "tc-judge",
        decision: "needs_review",
        violations: [
          {
            rule: "policy.judge.refusal",
            outcome: "judge_refused",
            severity: "warning",
            reason: "faithfulness judge refused to verdict",
          },
        ],
      },
    ]),
    testCases: [buildClassifierCase("tc-judge", "high")],
  });
  const categories = report.events.map((e) => e.category);
  assert.ok(categories.includes("judge_disagreement_persistent"));
});

test("incident-classifier: compliance outcomes derive compliance_rule_pack_violation and bump on regulated risk", () => {
  const report = classifyIncidents({
    jobId: JOB_ID,
    observedAt: OBSERVED_AT,
    validationReport: buildValidationReport(0),
    policyReport: buildPolicyReport([
      {
        testCaseId: "tc-comp",
        decision: "needs_review",
        violations: [
          {
            rule: "policy.compliance.regulated_review",
            outcome: "regulated_risk_review_required",
            severity: "warning",
            reason: "regulated_data case must be reviewed",
          },
        ],
      },
    ]),
    testCases: [buildClassifierCase("tc-comp", "regulated_data")],
  });
  const incident = report.events.find(
    (e) => e.category === "compliance_rule_pack_violation",
  );
  assert.ok(incident);
  assert.ok(
    incident.severity === "high" || incident.severity === "critical",
    `expected high/critical, got ${incident.severity}`,
  );
});

test("incident-classifier: policy_gate_bypass signal is always critical and pauses pipeline", () => {
  const signal: IncidentSignal = {
    kind: "policy_gate_bypass",
    bypassedRule: "policy.gate.compliance",
  };
  const report = classifyIncidents({
    jobId: JOB_ID,
    observedAt: OBSERVED_AT,
    validationReport: buildValidationReport(0),
    policyReport: buildPolicyReport([]),
    testCases: [],
    signals: [signal],
  });
  assert.equal(report.events.length, 1);
  assert.equal(report.events[0]!.category, "policy_gate_bypass");
  assert.equal(report.events[0]!.severity, "critical");
  assert.equal(report.reviewState, "incident_ack_required");
});

test("incident-classifier: drift_alert / subprocessor_outage / replay_cache_miss signals default to high", () => {
  const evidence: ManifestRef[] = [
    { filename: "validation-report.json", sha256: "a".repeat(64) },
  ];
  const signals: IncidentSignal[] = [
    { kind: "drift_alert" },
    { kind: "subprocessor_outage", provider: "azure-openai" },
    { kind: "replay_cache_miss_unexpected" },
  ];
  const report = classifyIncidents({
    jobId: JOB_ID,
    observedAt: OBSERVED_AT,
    validationReport: buildValidationReport(0),
    policyReport: buildPolicyReport([]),
    testCases: [],
    signals,
    evidence,
  });
  const observed = new Map<IncidentCategory, string>();
  for (const event of report.events) {
    observed.set(event.category, event.severity);
    assert.ok(
      event.evidence.some((ref) => ref.filename === "validation-report.json"),
      `event ${event.category} did not inherit evidence`,
    );
  }
  assert.equal(observed.get("drift_alert"), "high");
  assert.equal(observed.get("subprocessor_outage"), "high");
  assert.equal(observed.get("replay_cache_miss_unexpected"), "high");
  assert.equal(report.reviewState, "ok");
});

test("incident-classifier: events are deterministically sorted by severity desc, then category, then id", () => {
  const report = classifyIncidents({
    jobId: JOB_ID,
    observedAt: OBSERVED_AT,
    validationReport: buildValidationReport(2),
    policyReport: buildPolicyReport([
      {
        testCaseId: "tc-pii",
        decision: "blocked",
        violations: [
          {
            rule: "policy.pii.testdata",
            outcome: "pii_in_test_data",
            severity: "error",
            reason: "raw IBAN observed",
          },
        ],
      },
    ]),
    testCases: [buildClassifierCase("tc-pii", "financial_transaction")],
    signals: [
      { kind: "drift_alert" },
      { kind: "policy_gate_bypass", bypassedRule: "policy.gate.export" },
    ],
  });
  // Two critical events (pii_leakage, policy_gate_bypass) come before drift_alert (high).
  const severities = report.events.map((e) => e.severity);
  assert.deepEqual(severities, ["critical", "critical", "high"]);
  // Critical events tie-break by category ascending: pii_leakage > policy_gate_bypass alphabetically? p-i-i < p-o-l, so pii first.
  assert.equal(report.events[0]!.category, "pii_leakage");
  assert.equal(report.events[1]!.category, "policy_gate_bypass");
  assert.equal(report.events[2]!.category, "drift_alert");
});

test("incident-classifier: rejects mismatched jobId between input and reports", () => {
  assert.throws(() =>
    classifyIncidents({
      jobId: JOB_ID,
      observedAt: OBSERVED_AT,
      validationReport: { ...buildValidationReport(0), jobId: "other-job" },
      policyReport: buildPolicyReport([]),
      testCases: [],
    }),
  /validationReport\.jobId/);
  assert.throws(() =>
    classifyIncidents({
      jobId: JOB_ID,
      observedAt: OBSERVED_AT,
      validationReport: buildValidationReport(0),
      policyReport: { ...buildPolicyReport([]), jobId: "other-job" },
      testCases: [],
    }),
  /policyReport\.jobId/);
});

test("incident-classifier: same input produces byte-identical reports", () => {
  const input = {
    jobId: JOB_ID,
    observedAt: OBSERVED_AT,
    validationReport: buildValidationReport(1),
    policyReport: buildPolicyReport([
      {
        testCaseId: "tc-pii",
        decision: "blocked",
        violations: [
          {
            rule: "policy.pii.testdata",
            outcome: "pii_in_test_data" as const,
            severity: "error" as const,
            reason: "raw IBAN observed",
          },
        ],
      },
    ]),
    testCases: [buildClassifierCase("tc-pii", "regulated_data")],
  };
  const a = classifyIncidents(input);
  const b = classifyIncidents(input);
  assert.deepEqual(a, b);
});
