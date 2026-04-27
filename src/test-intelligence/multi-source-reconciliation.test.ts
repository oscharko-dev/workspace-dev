import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  MULTI_SOURCE_CONFLICT_REPORT_ARTIFACT_FILENAME,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type BusinessTestIntentIr,
  type CustomContextSource,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type JiraIssueIr,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import { buildMultiSourceTestIntentEnvelope } from "./multi-source-envelope.js";
import {
  reconcileMultiSourceIntent,
  writeMultiSourceReconciliationReport,
} from "./multi-source-reconciliation.js";
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

const jiraIssue = (
  seed: string,
  text: string,
  overrides: { issueKey?: string; acceptanceCriteria?: string[] } = {},
): JiraIssueIr => {
  const base = {
    version: "1.0.0" as const,
    issueKey: overrides.issueKey ?? "PAY-123",
    issueType: "story" as const,
    summary: "Payment field alignment",
    descriptionPlain: text,
    acceptanceCriteria: (overrides.acceptanceCriteria ?? [text]).map(
      (criterion, index) => ({ id: `ac.${index}`, text: criterion }),
    ),
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

const customContextSource = (value: string): CustomContextSource => {
  const entry = {
    entryId: "custom.0",
    authorHandle: "risk-reviewer",
    capturedAt: ISO,
    attributes: [{ key: "data_class", value }],
    contentHash: sha256Hex({ key: "data_class", value }),
    piiIndicators: [],
    redactions: [],
  };
  return {
    version: "1.0.0",
    sourceKind: "custom_structured",
    noteEntries: [],
    structuredEntries: [entry],
    aggregateContentHash: sha256Hex({ sourceKind: "custom_structured", entry }),
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

test("detects validation, risk, test-data, duplicate-criterion, and paste-collision conflicts", () => {
  const intent = figmaIntent();
  intent.detectedFields[0] = {
    ...intent.detectedFields[0]!,
    defaultValue: "DE00 OLD PLACEHOLDER",
  };
  const issueA = jiraIssue(
    "jira-conflict-a",
    [
      'The field "IBAN" must match regex ^DE[0-9]{20}$.',
      'The field "IBAN" example is "DE89 3704 0044 0532 0130 00".',
    ].join("\n"),
    {
      issueKey: "PAY-123",
      acceptanceCriteria: [
        'The field "IBAN" must match regex ^DE[0-9]{20}$.',
        'The field "IBAN" example is "DE89 3704 0044 0532 0130 00".',
        "Duplicate criterion",
      ],
    },
  );
  const issueB = jiraIssue("jira-conflict-b", "Duplicate criterion", {
    issueKey: "PAY-123",
    acceptanceCriteria: ["Duplicate criterion"],
  });
  const custom = customContextSource("PCI-DSS-3");
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
        contentHash: issueA.contentHash,
        capturedAt: ISO,
        canonicalIssueKey: issueA.issueKey,
      },
      {
        sourceId: "jira.1",
        kind: "jira_paste",
        contentHash: issueB.contentHash,
        capturedAt: ISO,
        canonicalIssueKey: issueB.issueKey,
      },
      {
        sourceId: "custom.0",
        kind: "custom_structured",
        contentHash: custom.aggregateContentHash,
        capturedAt: ISO,
        inputFormat: "structured_json",
      },
    ],
    conflictResolutionPolicy: "reviewer_decides",
  });

  const result = reconcileMultiSourceIntent({
    envelope,
    figmaIntent: intent,
    jiraIssues: [issueA, issueB],
    customContextSources: [custom],
  });
  const kinds = new Set(result.report.conflicts.map((conflict) => conflict.kind));
  assert.equal(kinds.has("validation_rule_mismatch"), true);
  assert.equal(kinds.has("risk_category_mismatch"), true);
  assert.equal(kinds.has("test_data_example_mismatch"), true);
  assert.equal(kinds.has("duplicate_acceptance_criterion"), true);
  assert.equal(kinds.has("paste_collision"), true);
  assert.equal(
    result.report.conflicts.every(
      (conflict) =>
        conflict.normalizedValues.join("|") ===
        [...conflict.normalizedValues].sort().join("|"),
    ),
    true,
  );
});

test("keep_both emits deterministic sibling IR elements for conflicting Jira alternatives", () => {
  const issue = jiraIssue(
    "jira-keep-both",
    [
      'The field "IBAN field" must match regex ^DE[0-9]{20}$.',
      'The field "IBAN field" example is "DE89 3704 0044 0532 0130 00".',
    ].join("\n"),
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
    conflictResolutionPolicy: "keep_both",
  });

  const result = reconcileMultiSourceIntent({
    envelope,
    figmaIntent: figmaIntent(),
    jiraIssues: [issue],
  });
  const alternativeFields = result.mergedIntent.detectedFields.filter((field) =>
    field.id.includes("::alternative::jira.0::"),
  );
  const alternativeValidations = result.mergedIntent.detectedValidations.filter(
    (validation) => validation.id.includes("::alternative::jira.0::"),
  );
  assert.ok(alternativeFields.length >= 1);
  const labelAlternative = alternativeFields.find(
    (field) => field.label === "IBAN field",
  );
  assert.ok(labelAlternative);
  assert.deepEqual(
    labelAlternative.sourceRefs?.map((ref) => ref.sourceId),
    ["jira.0"],
  );
  assert.ok(
    alternativeValidations.some(
      (validation) => validation.rule === "must match regex ^DE[0-9]{20}$",
    ),
  );
  assert.ok(
    result.report.transcript.some(
      (entry) =>
        entry.action === "alternative_emitted" &&
        entry.affectedElementIds.some((id) => id.includes("::alternative::")),
    ),
  );
});

test("figma-only reconciliation remains conflict-free and uses only Figma provenance", () => {
  const envelope = buildMultiSourceTestIntentEnvelope({
    sources: [
      {
        sourceId: "figma.0",
        kind: "figma_local_json",
        contentHash: sha256Hex("figma"),
        capturedAt: ISO,
      },
    ],
    conflictResolutionPolicy: "reviewer_decides",
  });
  const result = reconcileMultiSourceIntent({
    envelope,
    figmaIntent: figmaIntent(),
  });
  assert.equal(result.report.conflicts.length, 0);
  assert.deepEqual(result.report.unmatchedSources, []);
  assert.deepEqual(
    result.mergedIntent.detectedFields[0]?.sourceRefs?.map((ref) => ref.kind),
    ["figma_local_json"],
  );
});

test("figma-only reconciliation deep-clones rich optional provenance", () => {
  const figmaRef = {
    sourceId: "figma.rich",
    kind: "figma_plugin" as const,
    contentHash: sha256Hex("figma-rich-provenance"),
    capturedAt: ISO,
  };
  const intent: BusinessTestIntentIr = {
    version: "1.0.0",
    source: { kind: "figma_plugin", contentHash: figmaRef.contentHash },
    screens: [
      {
        screenId: "screen.checkout",
        screenName: "Checkout",
        screenPath: "/Checkout/Payment",
        trace: {
          nodeId: "node.screen",
          nodeName: "Checkout screen",
          nodePath: "Root/Checkout",
          sourceRefs: [figmaRef],
        },
      },
    ],
    detectedFields: [
      {
        id: "field.card-number",
        screenId: "screen.checkout",
        trace: {
          nodeId: "node.card",
          nodeName: "Card number",
          nodePath: "Root/Checkout/Card number",
          sourceRefs: [figmaRef],
        },
        provenance: "figma_node",
        confidence: 0.91,
        label: "Card number",
        type: "text",
        defaultValue: "411111******1111",
        ambiguity: { reason: "masked card sample may be placeholder text" },
        sourceRefs: [figmaRef],
      },
    ],
    detectedActions: [
      {
        id: "action.submit",
        screenId: "screen.checkout",
        trace: {
          nodeId: "node.submit",
          nodeName: "Submit payment",
          nodePath: "Root/Checkout/Submit",
          sourceRefs: [figmaRef],
        },
        provenance: "figma_node",
        confidence: 0.88,
        label: "Submit payment",
        kind: "primary_button",
        ambiguity: { reason: "primary submit button inferred from visual emphasis" },
        sourceRefs: [figmaRef],
      },
    ],
    detectedValidations: [
      {
        id: "validation.card-number",
        screenId: "screen.checkout",
        trace: {
          nodeId: "node.card",
          nodeName: "Card number",
          nodePath: "Root/Checkout/Card number",
          sourceRefs: [figmaRef],
        },
        provenance: "figma_node",
        confidence: 0.87,
        rule: "Card number is required",
        targetFieldId: "field.card-number",
        ambiguity: { reason: "required marker inferred from nearby asterisk" },
        sourceRefs: [figmaRef],
      },
    ],
    detectedNavigation: [
      {
        id: "nav.confirmation",
        screenId: "screen.checkout",
        trace: {
          nodeId: "node.submit",
          nodeName: "Submit payment",
          nodePath: "Root/Checkout/Submit",
          sourceRefs: [figmaRef],
        },
        provenance: "figma_node",
        confidence: 0.83,
        targetScreenId: "screen.confirmation",
        triggerElementId: "action.submit",
        ambiguity: { reason: "prototype link inferred from component metadata" },
        sourceRefs: [figmaRef],
      },
    ],
    inferredBusinessObjects: [
      {
        id: "object.payment-card",
        screenId: "screen.checkout",
        trace: {
          nodeId: "node.card",
          nodeName: "Card number",
          nodePath: "Root/Checkout/Card number",
          sourceRefs: [figmaRef],
        },
        provenance: "figma_node",
        confidence: 0.86,
        name: "Payment card",
        fieldIds: ["field.card-number"],
        ambiguity: { reason: "card object inferred from masked PAN-like content" },
        sourceRefs: [figmaRef],
      },
    ],
    risks: ["financial_transaction"],
    assumptions: ["Card number is entered by the customer."],
    openQuestions: ["Should stored cards be supported?"],
    piiIndicators: [],
    redactions: [],
  };
  const envelope = buildMultiSourceTestIntentEnvelope({
    sources: [figmaRef],
    conflictResolutionPolicy: "reviewer_decides",
  });

  const result = reconcileMultiSourceIntent({ envelope, figmaIntent: intent });
  intent.screens[0]!.trace.sourceRefs![0]!.sourceId = "mutated";
  intent.detectedFields[0]!.sourceRefs![0]!.sourceId = "mutated";
  intent.detectedActions[0]!.sourceRefs![0]!.sourceId = "mutated";
  intent.detectedValidations[0]!.sourceRefs![0]!.sourceId = "mutated";
  intent.detectedNavigation[0]!.sourceRefs![0]!.sourceId = "mutated";
  intent.inferredBusinessObjects[0]!.sourceRefs![0]!.sourceId = "mutated";

  assert.equal(result.report.conflicts.length, 0);
  assert.equal(result.mergedIntent.screens[0]?.screenPath, "/Checkout/Payment");
  assert.equal(
    result.mergedIntent.screens[0]?.trace.sourceRefs?.[0]?.sourceId,
    "figma.rich",
  );
  assert.equal(
    result.mergedIntent.detectedFields[0]?.trace.nodePath,
    "Root/Checkout/Card number",
  );
  assert.equal(
    result.mergedIntent.detectedFields[0]?.ambiguity?.reason,
    "masked card sample may be placeholder text",
  );
  assert.equal(
    result.mergedIntent.detectedActions[0]?.sourceRefs?.[0]?.sourceId,
    "figma.rich",
  );
  assert.equal(
    result.mergedIntent.detectedNavigation[0]?.triggerElementId,
    "action.submit",
  );
  assert.equal(
    result.mergedIntent.inferredBusinessObjects[0]?.fieldIds[0],
    "field.card-number",
  );
  assert.deepEqual(
    result.report.unmatchedSources,
    [],
  );
});

test("figma reconciliation handles sparse optional provenance and unmatched custom sources", () => {
  const figmaRef = {
    sourceId: "figma.sparse",
    kind: "figma_local_json" as const,
    contentHash: sha256Hex("figma-sparse-provenance"),
    capturedAt: ISO,
  };
  const customRef = {
    sourceId: "custom.missing",
    kind: "custom_structured" as const,
    contentHash: sha256Hex("missing-custom-structured-source"),
    capturedAt: ISO,
    inputFormat: "structured_json" as const,
  };
  const intent: BusinessTestIntentIr = {
    version: "1.0.0",
    source: { kind: "figma_local_json", contentHash: figmaRef.contentHash },
    screens: [{ screenId: "sparse", screenName: "Sparse", trace: {} }],
    detectedFields: [
      {
        id: "!!!",
        screenId: "sparse",
        trace: {},
        provenance: "figma_node",
        confidence: 0.7,
        label: "Reference code",
        type: "text",
      },
    ],
    detectedActions: [
      {
        id: "action.sparse",
        screenId: "sparse",
        trace: {},
        provenance: "figma_node",
        confidence: 0.7,
        label: "Continue",
        kind: "button",
      },
    ],
    detectedValidations: [
      {
        id: "validation.sparse",
        screenId: "sparse",
        trace: {},
        provenance: "figma_node",
        confidence: 0.7,
        rule: "Reference code is required",
      },
    ],
    detectedNavigation: [
      {
        id: "nav.sparse",
        screenId: "sparse",
        trace: {},
        provenance: "figma_node",
        confidence: 0.7,
        targetScreenId: "done",
      },
    ],
    inferredBusinessObjects: [
      {
        id: "object.sparse",
        screenId: "sparse",
        trace: {},
        provenance: "figma_node",
        confidence: 0.7,
        name: "Sparse object",
        fieldIds: ["!!!"],
      },
    ],
    risks: ["unknown operational note", "payment checkout", "payment checkout"],
    assumptions: [],
    openQuestions: [],
    piiIndicators: [
      {
        id: "pii.email",
        kind: "email",
        confidence: 0.9,
        matchLocation: "field_default_value",
        redacted: "[REDACTED:EMAIL]",
        screenId: "sparse",
        elementId: "!!!",
      },
    ],
    redactions: [],
  };
  const result = reconcileMultiSourceIntent({
    envelope: buildMultiSourceTestIntentEnvelope({
      sources: [figmaRef, customRef],
      conflictResolutionPolicy: "reviewer_decides",
    }),
    figmaIntent: intent,
  });

  assert.deepEqual(result.report.unmatchedSources, ["custom.missing"]);
  assert.deepEqual(
    result.mergedIntent.detectedFields[0]?.sourceRefs?.map((ref) => ref.sourceId),
    ["figma.sparse"],
  );
  assert.equal(result.mergedIntent.risks.includes("financial_transaction"), true);
  assert.equal(result.mergedIntent.risks.includes("regulated_data"), true);
  assert.ok(
    result.report.contributingSourcesPerCase.some(
      (entry) => entry.testCaseId === "case:sparse:field:value",
    ),
  );
});

test("jira sources with unmatched hashes stay unmatched without synthetic fields", () => {
  const issue = jiraIssue(
    "jira-hash-mismatch",
    'The field "Email" must be required. The field "Email" example is "ada@example.test".',
  );
  const envelope = buildMultiSourceTestIntentEnvelope({
    sources: [
      {
        sourceId: "jira.mismatch",
        kind: "jira_rest",
        contentHash: sha256Hex("not-the-issue-content"),
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

  assert.deepEqual(result.report.unmatchedSources, ["jira.mismatch"]);
  assert.equal(result.mergedIntent.detectedFields.length, 0);
  assert.equal(result.mergedIntent.detectedValidations.length, 0);
});

test("matching Jira field, validation, and example merge into sparse Figma fields", () => {
  const intent = figmaIntent();
  intent.detectedFields[0] = {
    ...intent.detectedFields[0]!,
    label: "Email",
    defaultValue: "ada@example",
    sourceRefs: undefined,
  };
  intent.detectedValidations[0] = {
    ...intent.detectedValidations[0]!,
    rule: "must be required",
    targetFieldId: undefined,
    sourceRefs: undefined,
  };
  const issue = jiraIssue(
    "jira-merge",
    'The field "Email" must be required. The field "Email" example is "ada@example.test".',
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
    figmaIntent: intent,
    jiraIssues: [issue],
  });

  assert.deepEqual(
    result.mergedIntent.detectedFields[0]?.sourceRefs?.map((ref) => ref.sourceId),
    ["figma.0", "jira.0"],
  );
  assert.ok(
    result.report.transcript.some(
      (entry) =>
        entry.action === "merged" &&
        entry.rationale.includes("matching test-data example"),
    ),
  );
});

test("keep_both retains alternative Jira examples for matching fields", () => {
  const intent = figmaIntent();
  intent.detectedFields[0] = {
    ...intent.detectedFields[0]!,
    label: "IBAN",
    defaultValue: "DE00 OLD PLACEHOLDER",
  };
  intent.detectedValidations = [];
  const issue = jiraIssue(
    "jira-example-keep-both",
    'The field "IBAN" example is "DE89 3704 0044 0532 0130 00".',
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
        kind: "jira_paste",
        contentHash: issue.contentHash,
        capturedAt: ISO,
        canonicalIssueKey: issue.issueKey,
      },
    ],
    conflictResolutionPolicy: "keep_both",
  });

  const result = reconcileMultiSourceIntent({
    envelope,
    figmaIntent: intent,
    jiraIssues: [issue],
  });
  const alternative = result.mergedIntent.detectedFields.find(
    (field) =>
      field.id.includes("::alternative::jira.0::") &&
      field.defaultValue === "DE89 3704 0044 0532 0130 00",
  );

  assert.ok(alternative);
  assert.equal(
    result.report.conflicts.some(
      (conflict) => conflict.kind === "test_data_example_mismatch",
    ),
    true,
  );
});

test("adversarial edge reconciliation covers sparse priority and source metadata branches", () => {
  const conflictingIntent = figmaIntent();
  conflictingIntent.detectedFields[0] = {
    ...conflictingIntent.detectedFields[0]!,
    trace: {},
    label: "IBAN",
    defaultValue: "FIGMA-ONLY",
  };
  conflictingIntent.detectedValidations = [];
  conflictingIntent.risks = ["regulated customer data", "privileged admin workflow"];
  const fieldIssue = jiraIssue(
    "jira-keep-both-no-example",
    'The field "IBAN field" must be required.',
  );
  const keepBoth = reconcileMultiSourceIntent({
    envelope: buildMultiSourceTestIntentEnvelope({
      sources: [
        {
          sourceId: "figma.0",
          kind: "figma_local_json",
          contentHash: sha256Hex("figma"),
          capturedAt: ISO,
        },
        {
          sourceId: "jira.no-key",
          kind: "jira_paste",
          contentHash: fieldIssue.contentHash,
          capturedAt: ISO,
        },
      ],
      conflictResolutionPolicy: "keep_both",
    }),
    figmaIntent: conflictingIntent,
    jiraIssues: [fieldIssue],
  });
  assert.equal(keepBoth.mergedIntent.risks.includes("regulated_data"), true);
  assert.equal(keepBoth.mergedIntent.risks.includes("high"), true);
  assert.ok(
    keepBoth.mergedIntent.detectedFields.some(
      (field) =>
        field.id.includes("::alternative::jira.no-key::") &&
        field.defaultValue === "FIGMA-ONLY",
    ),
  );

  const priorityIntent = figmaIntent();
  priorityIntent.detectedFields[0] = {
    ...priorityIntent.detectedFields[0]!,
    label: "IBAN",
    defaultValue: "DE00 FIGMA VALUE",
  };
  priorityIntent.detectedValidations = [];
  const exampleIssue = jiraIssue(
    "jira-example-priority",
    'The field "IBAN" example is "DE89 3704 0044 0532 0130 00".',
  );
  const priority = reconcileMultiSourceIntent({
    envelope: buildMultiSourceTestIntentEnvelope({
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
          contentHash: exampleIssue.contentHash,
          capturedAt: ISO,
          canonicalIssueKey: exampleIssue.issueKey,
        },
      ],
      conflictResolutionPolicy: "priority",
      priorityOrder: ["figma_local_json", "jira_rest"],
    }),
    figmaIntent: priorityIntent,
    jiraIssues: [exampleIssue],
  });
  assert.equal(priority.mergedIntent.detectedFields[0]?.defaultValue, "DE00 FIGMA VALUE");
  assert.equal(
    priority.report.conflicts.some(
      (conflict) =>
        conflict.kind === "test_data_example_mismatch" &&
        conflict.resolution === "auto_priority",
    ),
    true,
  );

  const mismatchedEnvelope = buildMultiSourceTestIntentEnvelope({
    sources: [
      {
        sourceId: "jira.no-figma",
        kind: "jira_rest",
        contentHash: fieldIssue.contentHash,
        capturedAt: ISO,
        canonicalIssueKey: fieldIssue.issueKey,
      },
    ],
    conflictResolutionPolicy: "reviewer_decides",
  });
  const sparse = reconcileMultiSourceIntent({
    envelope: mismatchedEnvelope,
    figmaIntent: figmaIntent(),
    jiraIssues: [fieldIssue],
  });
  assert.equal(sparse.mergedIntent.source.kind, "hybrid");
  assert.equal(
    sparse.report.conflicts.some((conflict) => conflict.kind === "field_label_mismatch"),
    true,
  );
});

test("jira plus custom reconciliation records custom risk without Figma placeholders", () => {
  const issue = jiraIssue("jira-custom", 'The field "Email" must be required.');
  const custom = customContextSource("PCI-DSS-3");
  const envelope = buildMultiSourceTestIntentEnvelope({
    sources: [
      {
        sourceId: "jira.0",
        kind: "jira_paste",
        contentHash: issue.contentHash,
        capturedAt: ISO,
        canonicalIssueKey: issue.issueKey,
      },
      {
        sourceId: "custom.0",
        kind: "custom_structured",
        contentHash: custom.aggregateContentHash,
        capturedAt: ISO,
        inputFormat: "structured_json",
      },
    ],
    conflictResolutionPolicy: "reviewer_decides",
  });
  const result = reconcileMultiSourceIntent({
    envelope,
    jiraIssues: [issue],
    customContextSources: [custom],
  });
  assert.equal(result.mergedIntent.screens[0]?.screenId, "jira:PAY-123");
  assert.equal(result.mergedIntent.risks.includes("regulated_data"), true);
  assert.deepEqual(result.report.unmatchedSources, []);
  assert.equal(
    result.mergedIntent.detectedFields.some((field) =>
      field.sourceRefs?.some((ref) => ref.kind === "figma_local_json"),
    ),
    false,
  );
});

test("jira-only reconciliation extracts adversarial semantic labels and custom risk signals", () => {
  const issue = jiraIssue(
    "jira-semantic-sweep",
    [
      'The field "Email field" must be required. The field "Email field" example is "ada@example.test".',
      'The field "PAN field" should be tokenized. The field "PAN field" example is "4111111111111111".',
      'The field "Phone field" must be masked.',
      'The field "Tax field" must be reviewed.',
      'The field "Name field" should be redacted.',
      'The field "Address field" must be minimized.',
      'The field "Password field" must never be exported.',
      'The field "Amount field" must match regex ^[0-9]+$.',
    ].join("\n"),
    {
      issueKey: "PAY-1438",
      acceptanceCriteria: [
        'The field "Email field" must be required. The field "Email field" example is "ada@example.test".',
        'The field "PAN field" should be tokenized. The field "PAN field" example is "4111111111111111".',
        'The field "Phone field" must be masked.',
        'The field "Tax field" must be reviewed.',
        'The field "Name field" should be redacted.',
        'The field "Address field" must be minimized.',
        'The field "Password field" must never be exported.',
        'The field "Amount field" must match regex ^[0-9]+$.',
      ],
    },
  );
  const custom = customContextSource("regulated customer data");
  const envelope = buildMultiSourceTestIntentEnvelope({
    sources: [
      {
        sourceId: "jira.0",
        kind: "jira_paste",
        contentHash: issue.contentHash,
        capturedAt: ISO,
        canonicalIssueKey: issue.issueKey,
      },
      {
        sourceId: "custom.0",
        kind: "custom_structured",
        contentHash: custom.aggregateContentHash,
        capturedAt: ISO,
        inputFormat: "structured_json",
      },
    ],
    conflictResolutionPolicy: "reviewer_decides",
  });

  const result = reconcileMultiSourceIntent({
    envelope,
    jiraIssues: [issue],
    customContextSources: [custom],
  });
  const labels = new Set(result.mergedIntent.detectedFields.map((field) => field.label));
  for (const label of [
    "Email field",
    "PAN field",
    "Phone field",
    "Tax field",
    "Name field",
    "Address field",
    "Password field",
    "Amount field",
  ]) {
    assert.equal(labels.has(label), true, `${label} should be accepted`);
  }
  assert.equal(
    result.mergedIntent.detectedValidations.some(
      (validation) =>
        validation.rule === "must match regex ^[0-9]+$" &&
        validation.targetFieldId?.includes("amount-field"),
    ),
    true,
  );
  assert.equal(
    result.mergedIntent.detectedFields.some(
      (field) => field.label === "Email field" && field.defaultValue === "ada@example",
    ),
    true,
  );
  assert.equal(result.mergedIntent.risks.includes("regulated_data"), true);
  assert.deepEqual(result.report.unmatchedSources, []);
});

test("present custom text with no deterministic contribution is unmatched but absent families are silent", () => {
  const issue = jiraIssue("jira-unmatched", 'The field "Email" must be required.');
  const customHash = sha256Hex("supporting-note");
  const envelope = buildMultiSourceTestIntentEnvelope({
    sources: [
      {
        sourceId: "jira.0",
        kind: "jira_paste",
        contentHash: issue.contentHash,
        capturedAt: ISO,
        canonicalIssueKey: issue.issueKey,
      },
      {
        sourceId: "custom.text",
        kind: "custom_text",
        contentHash: customHash,
        capturedAt: ISO,
        inputFormat: "markdown",
      },
    ],
    conflictResolutionPolicy: "reviewer_decides",
  });
  const result = reconcileMultiSourceIntent({
    envelope,
    jiraIssues: [issue],
  });
  assert.deepEqual(result.report.unmatchedSources, ["custom.text"]);
  assert.ok(
    result.report.transcript.some(
      (entry) =>
        entry.action === "source_unmatched" &&
        entry.sourceIds.includes("custom.text"),
    ),
  );
});

test("writeMultiSourceReconciliationReport writes canonical byte-stable JSON", async () => {
  const issue = jiraIssue(
    "jira-write",
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
  const dir = await mkdtemp(join(tmpdir(), "multi-source-report-"));
  try {
    const written = await writeMultiSourceReconciliationReport({
      report: result.report,
      destinationDir: dir,
    });
    assert.equal(
      written.artifactPath,
      join(dir, MULTI_SOURCE_CONFLICT_REPORT_ARTIFACT_FILENAME),
    );
    const first = await readFile(written.artifactPath, "utf8");
    await writeMultiSourceReconciliationReport({
      report: result.report,
      destinationDir: dir,
    });
    const second = await readFile(written.artifactPath, "utf8");
    assert.equal(first, canonicalJson(result.report));
    assert.equal(second, first);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
