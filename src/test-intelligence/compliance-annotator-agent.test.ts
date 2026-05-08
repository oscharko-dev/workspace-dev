import assert from "node:assert/strict";
import test from "node:test";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  REDACTION_POLICY_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type GeneratedTestCase,
} from "../contracts/index.js";
import {
  annotateTestCases,
  COMPLIANCE_ANNOTATION_SCHEMA_VERSION,
  COMPLIANCE_ANNOTATOR_ROLE_ID,
} from "./compliance-annotator-agent.js";

const buildCase = (
  overrides: Partial<GeneratedTestCase>,
): GeneratedTestCase => ({
  id: overrides.id ?? "tc-001",
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "untitled",
  objective: "objective",
  level: "system",
  type: "functional",
  priority: "p2",
  riskCategory: "low",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: "do something" }],
  expectedResults: [],
  figmaTraceRefs: [],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: [],
    coveredActionIds: [],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.9,
  },
  reviewState: "draft",
  audit: {
    jobId: "job-1",
    generatedAt: "2026-01-01T00:00:00Z",
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    redactionPolicyVersion: REDACTION_POLICY_VERSION,
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    cacheHit: false,
    cacheKey: "ck",
    inputHash: "ih",
    promptHash: "ph",
    schemaHash: "sh",
  },
  ...overrides,
});

test("role identifier is the documented constant", () => {
  assert.equal(COMPLIANCE_ANNOTATOR_ROLE_ID, "compliance_annotator");
});

test("annotateTestCases emits stable schemaVersion and frozen entries", () => {
  const artifact = annotateTestCases({
    jobId: "job-1",
    generatedAt: "2026-01-01T00:00:00Z",
    testCases: [],
    activeFrameworks: ["PSD2"],
  });
  assert.equal(artifact.schemaVersion, COMPLIANCE_ANNOTATION_SCHEMA_VERSION);
  assert.ok(Object.isFrozen(artifact));
  assert.deepEqual([...artifact.activeFrameworks], ["PSD2"]);
  assert.equal(artifact.entries.length, 0);
});

test("PSD2 SCA case applies and satisfies the mandatory test classes", () => {
  const artifact = annotateTestCases({
    jobId: "job-1",
    generatedAt: "2026-01-01T00:00:00Z",
    testCases: [
      buildCase({
        id: "tc-sca-positive",
        title: "Login mit OTP",
        objective:
          "Starke Kundenauthentifizierung mit zweitem Faktor wird erfolgreich durchlaufen",
        type: "functional",
      }),
      buildCase({
        id: "tc-sca-refusal",
        title: "Login ohne OTP wird abgelehnt",
        objective: "Die starke Kundenauthentifizierung verweigert den Login",
        type: "negative",
      }),
    ],
    activeFrameworks: ["PSD2"],
  });

  const positive = artifact.entries.find((e) => e.testCaseId === "tc-sca-positive");
  const refusal = artifact.entries.find((e) => e.testCaseId === "tc-sca-refusal");
  assert.ok(positive);
  assert.ok(refusal);
  assert.deepEqual([...positive!.appliesTo], ["PSD2-SCA-Art-97"]);
  assert.deepEqual([...refusal!.appliesTo], ["PSD2-SCA-Art-97"]);
  for (const entry of [positive!, refusal!]) {
    const match = entry.matches.find((m) => m.ruleId === "PSD2-SCA-Art-97");
    assert.ok(match);
    assert.equal(match!.satisfiesMandatoryTestClass, true);
    assert.equal(match!.framework, "PSD2");
  }
});

test("non-matching cases are emitted with empty appliesTo arrays", () => {
  const artifact = annotateTestCases({
    jobId: "job-1",
    generatedAt: "2026-01-01T00:00:00Z",
    testCases: [
      buildCase({ id: "tc-unrelated", title: "Color picker", objective: "x" }),
    ],
    activeFrameworks: ["PSD2"],
  });
  assert.equal(artifact.entries.length, 1);
  assert.equal(artifact.entries[0]!.appliesTo.length, 0);
});

test("entries are stably ordered by test case id", () => {
  const artifact = annotateTestCases({
    jobId: "job-1",
    generatedAt: "2026-01-01T00:00:00Z",
    testCases: [
      buildCase({ id: "tc-z", objective: "OTP authentication" }),
      buildCase({ id: "tc-a", objective: "OTP authentication" }),
      buildCase({ id: "tc-m", objective: "OTP authentication" }),
    ],
    activeFrameworks: ["PSD2"],
  });
  assert.deepEqual(
    artifact.entries.map((e) => e.testCaseId),
    ["tc-a", "tc-m", "tc-z"],
  );
});

test("matches across multiple frameworks are merged on a single case", () => {
  const artifact = annotateTestCases({
    jobId: "job-1",
    generatedAt: "2026-01-01T00:00:00Z",
    testCases: [
      buildCase({
        id: "tc-cross",
        title: "PII-Eingabe verhindert unredigierte Speicherung",
        objective:
          "Personenbezogene Daten werden durch Redaction gesichert; OTP wird ergänzt",
        type: "validation",
      }),
    ],
    activeFrameworks: ["PSD2", "GDPR"],
  });
  const entry = artifact.entries[0];
  assert.ok(entry);
  // Both PSD2 (otp keyword) and GDPR (pii / personenbezogene daten) apply.
  assert.ok(entry!.appliesTo.includes("PSD2-SCA-Art-97"));
  assert.ok(entry!.appliesTo.includes("GDPR-Security-Art-32"));
});
