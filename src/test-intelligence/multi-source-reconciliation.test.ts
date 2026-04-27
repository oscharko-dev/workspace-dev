import assert from "node:assert/strict";
import test from "node:test";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type JiraIssueIr,
} from "../contracts/index.js";
import { sha256Hex } from "./content-hash.js";
import { buildMultiSourceTestIntentEnvelope } from "./multi-source-envelope.js";
import { reconcileMultiSourceIntent } from "./multi-source-reconciliation.js";
import { evaluatePolicyGate } from "./policy-gate.js";
import { cloneEuBankingDefaultProfile } from "./policy-profile.js";
import { computeCoverageReport } from "./test-case-coverage.js";
import { validateGeneratedTestCases } from "./test-case-validation.js";

const ZERO = "0".repeat(64);
const GENERATED_AT = "2026-04-27T10:00:00.000Z";
const ISO = "2026-04-27T09:00:00.000Z";

const figmaIntent = (): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: sha256Hex("figma") },
  screens: [{ screenId: "s-payment", screenName: "Payment", trace: { nodeId: "s-payment" } }],
  detectedFields: [
    {
      id: "f-iban",
      screenId: "s-payment",
      trace: { nodeId: "n-iban" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "IBAN",
      type: "text",
    },
  ],
  detectedActions: [],
  detectedValidations: [
    {
      id: "v-iban",
      screenId: "s-payment",
      trace: { nodeId: "n-iban" },
      provenance: "figma_node",
      confidence: 0.85,
      rule: "Required",
      targetFieldId: "f-iban",
    },
  ],
  detectedNavigation: [],
  inferredBusinessObjects: [],
  risks: ["financial_transaction"],
  assumptions: [],
  openQuestions: [],
  piiIndicators: [],
  redactions: [],
});

const jiraIssue = (seed: string, text: string): JiraIssueIr => {
  const base = {
    version: "1.0.0" as const,
    issueKey: "PAY-123",
    issueType: "story" as const,
    summary: "Payment field alignment",
    descriptionPlain: text,
    acceptanceCriteria: [{ id: "ac.0", text }],
    labels: [],
    components: [],
    fixVersions: [],
    status: "Open",
    customFields: [],
    comments: [],
    attachments: [],
    links: [],
    piiIndicators: [],
    redactions: [],
    dataMinimization: {
      descriptionIncluded: true,
      descriptionTruncated: false,
      commentsIncluded: false,
      commentsDropped: 0,
      commentsCapped: 0,
      attachmentsIncluded: false,
      attachmentsDropped: 0,
      linksIncluded: false,
      linksDropped: 0,
      customFieldsIncluded: 0,
      unknownCustomFieldsExcluded: 0,
      customFieldsCapped: 0,
    },
    capturedAt: ISO,
  };
  return {
    ...base,
    contentHash: sha256Hex({ seed, base }),
  };
};

const buildCase = (): GeneratedTestCase => ({
  id: "tc-iban",
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Validate IBAN",
  objective: "Validate IBAN behavior",
  level: "system",
  type: "validation",
  priority: "p1",
  riskCategory: "low",
  technique: "decision_table",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: "Submit invalid IBAN", expected: "Validation shown" }],
  expectedResults: ["Validation shown"],
  figmaTraceRefs: [{ screenId: "s-payment", nodeId: "n-iban" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: ["f-iban"],
    coveredActionIds: [],
    coveredValidationIds: ["v-iban"],
    coveredNavigationIds: [],
    confidence: 0.9,
  },
  reviewState: "draft",
  audit: {
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    redactionPolicyVersion: "1.0.0",
    visualSidecarSchemaVersion: "1.0.0",
    cacheHit: false,
    cacheKey: "k",
    inputHash: ZERO,
    promptHash: ZERO,
    schemaHash: ZERO,
  },
});

const evaluate = (intent: BusinessTestIntentIr) => {
  const list: GeneratedTestCaseList = {
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    jobId: "job-1",
    testCases: [buildCase()],
  };
  const profile = cloneEuBankingDefaultProfile();
  const validation = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list,
    intent,
  });
  const coverage = computeCoverageReport({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    policyProfileId: profile.id,
    list,
    intent,
    duplicateSimilarityThreshold: profile.rules.duplicateSimilarityThreshold,
  });
  return evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list,
    intent,
    profile,
    validation,
    coverage,
  });
};

test("priority policy prefers the higher-priority Jira label and records the loser as a conflict", () => {
  const issue = jiraIssue(
    "jira-priority",
    'The field "IBAN field" must be required.',
  );
  const envelope = buildMultiSourceTestIntentEnvelope({
    sources: [
      {
        sourceId: "figma.0",
        kind: "figma_local_json",
        contentHash: sha256Hex("figma"),
        capturedAt: ISO,
      },
      {
        sourceId: "jira.0",
        kind: "jira_rest",
        contentHash: issue.contentHash,
        capturedAt: ISO,
        canonicalIssueKey: issue.issueKey,
      },
    ],
    conflictResolutionPolicy: "priority",
    priorityOrder: ["jira_rest", "figma_local_json"],
  });
  const result = reconcileMultiSourceIntent({
    envelope,
    figmaIntent: figmaIntent(),
    jiraIssues: [issue],
  });
  assert.equal(result.mergedIntent.detectedFields[0]?.label, "IBAN field");
  const labelConflict = result.report.conflicts.find(
    (conflict) => conflict.kind === "field_label_mismatch",
  );
  assert.equal(labelConflict?.resolution, "auto_priority");
});

test("reviewer_decides conflicts escalate the downstream policy gate to needs_review", () => {
  const issue = jiraIssue(
    "jira-review",
    'The field "IBAN field" must be required.',
  );
  const envelope = buildMultiSourceTestIntentEnvelope({
    sources: [
      {
        sourceId: "figma.0",
        kind: "figma_local_json",
        contentHash: sha256Hex("figma"),
        capturedAt: ISO,
      },
      {
        sourceId: "jira.0",
        kind: "jira_rest",
        contentHash: issue.contentHash,
        capturedAt: ISO,
        canonicalIssueKey: issue.issueKey,
      },
    ],
    conflictResolutionPolicy: "reviewer_decides",
  });
  const result = reconcileMultiSourceIntent({
    envelope,
    figmaIntent: figmaIntent(),
    jiraIssues: [issue],
  });
  assert.ok((result.mergedIntent.multiSourceConflicts?.length ?? 0) > 0);
  const report = evaluate(result.mergedIntent);
  assert.equal(report.decisions[0]?.decision, "needs_review");
  assert.ok(
    report.decisions[0]?.violations.some(
      (violation) => violation.outcome === "multi_source_conflict_present",
    ),
  );
});

test("non-priority reconciliation is stable under source reordering", () => {
  const issue = jiraIssue(
    "jira-stable",
    'The field "IBAN field" must be required.',
  );
  const sourceA = {
    sourceId: "figma.0",
    kind: "figma_local_json" as const,
    contentHash: sha256Hex("figma"),
    capturedAt: ISO,
  };
  const sourceB = {
    sourceId: "jira.0",
    kind: "jira_rest" as const,
    contentHash: issue.contentHash,
    capturedAt: ISO,
    canonicalIssueKey: issue.issueKey,
  };
  const left = reconcileMultiSourceIntent({
    envelope: buildMultiSourceTestIntentEnvelope({
      sources: [sourceA, sourceB],
      conflictResolutionPolicy: "reviewer_decides",
    }),
    figmaIntent: figmaIntent(),
    jiraIssues: [issue],
  });
  const right = reconcileMultiSourceIntent({
    envelope: buildMultiSourceTestIntentEnvelope({
      sources: [sourceB, sourceA],
      conflictResolutionPolicy: "reviewer_decides",
    }),
    figmaIntent: figmaIntent(),
    jiraIssues: [issue],
  });
  assert.equal(
    JSON.stringify(left.report),
    JSON.stringify(right.report),
  );
});

test("jira-only reconciliation emits a merged IR without synthetic figma provenance", () => {
  const issue = jiraIssue(
    "jira-only",
    'The field "Email" must be required.',
  );
  const envelope = buildMultiSourceTestIntentEnvelope({
    sources: [
      {
        sourceId: "jira.0",
        kind: "jira_paste",
        contentHash: issue.contentHash,
        capturedAt: ISO,
        canonicalIssueKey: issue.issueKey,
      },
    ],
    conflictResolutionPolicy: "reviewer_decides",
  });
  const result = reconcileMultiSourceIntent({
    envelope,
    jiraIssues: [issue],
  });
  assert.equal(result.mergedIntent.screens[0]?.screenId, "jira:PAY-123");
  assert.equal(result.mergedIntent.detectedFields[0]?.label, "Email");
  assert.deepEqual(
    result.mergedIntent.detectedFields[0]?.sourceRefs?.map((ref) => ref.kind),
    ["jira_paste"],
  );
  assert.equal(result.report.conflicts.length, 0);
});
