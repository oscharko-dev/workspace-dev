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
