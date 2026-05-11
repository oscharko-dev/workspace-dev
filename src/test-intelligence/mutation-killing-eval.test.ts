/**
 * Unit tests for the mutation-killing-eval suite (Issue #2041). Cover the
 * catalog DSL, the deterministic evaluation contract, the kill-rate
 * aggregation, the byte-stable persisted artifact, and the summary
 * projection embedded in `policy-report.json#mutationKillRate`.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ALLOWED_MUTATION_CLASSES,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  MUTATION_EVAL_TOKEN_BUDGET_RATIO_CAP,
  MUTATION_KILL_RATE_DEFAULT_THRESHOLD,
  MUTATION_REPORT_ARTIFACT_FILENAME,
  MUTATION_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type MutationClass,
  type MutationReport,
} from "../contracts/index.js";
import {
  buildDefaultMutationCatalog,
  buildMutationKillRateSummary,
  createMutationCatalog,
  encodeCanonicalReportBytes,
  evaluateMutationKillingSuite,
  registerDefaultMutations,
  writeMutationReportArtifact,
  type Mutation,
} from "./mutation-killing-eval.js";

const ZERO_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";
const GENERATED_AT = "2026-05-08T10:00:00.000Z";

const buildIntent = (
  overrides: Partial<BusinessTestIntentIr> = {},
): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO_HASH },
  screens: [
    {
      screenId: "s-loan",
      screenName: "Loan",
      trace: { nodeId: "s-loan" },
    },
  ],
  detectedFields: [
    {
      id: "s-loan::field::n-iban",
      screenId: "s-loan",
      trace: { nodeId: "n-iban" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "IBAN",
      type: "text",
    },
  ],
  detectedActions: [
    {
      id: "s-loan::action::n-submit",
      screenId: "s-loan",
      trace: { nodeId: "n-submit" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Submit",
      kind: "submit",
    },
  ],
  detectedValidations: [
    {
      id: "s-loan::validation::n-iban-required",
      screenId: "s-loan",
      trace: { nodeId: "n-iban" },
      provenance: "figma_node",
      confidence: 0.85,
      rule: "required",
      targetFieldId: "s-loan::field::n-iban",
    },
    {
      id: "s-loan::validation::n-iban-pattern",
      screenId: "s-loan",
      trace: { nodeId: "n-iban" },
      provenance: "figma_node",
      confidence: 0.85,
      rule: "iban-pattern",
      targetFieldId: "s-loan::field::n-iban",
    },
  ],
  detectedNavigation: [
    {
      id: "s-loan::nav::n-receipt",
      screenId: "s-loan",
      trace: { nodeId: "n-submit" },
      provenance: "figma_node",
      confidence: 0.9,
      targetScreenId: "s-receipt",
    },
  ],
  inferredBusinessObjects: [],
  risks: [],
  assumptions: [],
  openQuestions: [],
  piiIndicators: [],
  redactions: [],
  ...overrides,
});

const buildCase = (
  overrides: Partial<GeneratedTestCase> = {},
): GeneratedTestCase => ({
  id: "tc-1",
  sourceJobId: "job-2041",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Submit loan application",
  objective: "Submit a loan application",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "financial_transaction",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [
    { index: 1, action: "Open the loan form" },
    {
      index: 2,
      action: "Submit the form",
      expected: "Confirmation displayed",
    },
  ],
  expectedResults: ["Confirmation displayed"],
  figmaTraceRefs: [{ screenId: "s-loan" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: [],
    coveredActionIds: [],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.8,
  },
  reviewState: "draft",
  audit: {
    jobId: "job-2041",
    generatedAt: GENERATED_AT,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    redactionPolicyVersion: "1.0.0",
    visualSidecarSchemaVersion: "1.0.0",
    cacheHit: false,
    cacheKey: "k",
    inputHash: ZERO_HASH,
    promptHash: ZERO_HASH,
    schemaHash: ZERO_HASH,
  },
  ...overrides,
});

test("catalog: rejects malformed mutation ids", () => {
  const catalog = createMutationCatalog();
  assert.throws(() =>
    catalog.register({
      id: "not-prefixed",
      mutationClass: "field-required-flipped",
      description: "desc",
      source: "test",
      severity: "error",
      applies: () => true,
      kills: () => true,
    }),
  );
});

test("catalog: rejects unknown mutation classes", () => {
  const catalog = createMutationCatalog();
  assert.throws(() =>
    catalog.register({
      id: "MUT-UNKNOWN-01",
      mutationClass: "made-up-class" as unknown as MutationClass,
      description: "desc",
      source: "test",
      severity: "error",
      applies: () => true,
      kills: () => true,
    }),
  );
});

test("catalog: rejects duplicate mutation ids", () => {
  const catalog = createMutationCatalog();
  const mutation: Mutation = {
    id: "MUT-TEST-01",
    mutationClass: "field-required-flipped",
    description: "desc",
    source: "test",
    severity: "error",
    applies: () => true,
    kills: () => true,
  };
  catalog.register(mutation);
  assert.throws(() => catalog.register(mutation));
});

test("catalog: list() and ids() are sorted alphabetically", () => {
  const catalog = createMutationCatalog();
  catalog.register({
    id: "MUT-ZZZ-01",
    mutationClass: "field-required-flipped",
    description: "desc",
    source: "test",
    severity: "error",
    applies: () => true,
    kills: () => true,
  });
  catalog.register({
    id: "MUT-AAA-01",
    mutationClass: "field-required-flipped",
    description: "desc",
    source: "test",
    severity: "error",
    applies: () => true,
    kills: () => true,
  });
  assert.deepEqual(catalog.ids(), ["MUT-AAA-01", "MUT-ZZZ-01"]);
});

test("default catalog: every mutation class has at least one entry", () => {
  const catalog = buildDefaultMutationCatalog();
  const mutations = catalog.list();
  assert.ok(
    mutations.length >= 12,
    `expected >= 12 catalog entries; got ${mutations.length}`,
  );
  assert.ok(
    mutations.length <= 30,
    `unexpected catalog growth; got ${mutations.length} (cap is 30)`,
  );
  const classes = new Set(mutations.map((m) => m.mutationClass));
  for (const cls of ALLOWED_MUTATION_CLASSES) {
    assert.ok(
      classes.has(cls),
      `expected default catalog to include class "${cls}"`,
    );
  }
});

test("default catalog: every mutation id matches MUT-* pattern", () => {
  const catalog = buildDefaultMutationCatalog();
  for (const mutation of catalog.list()) {
    assert.match(mutation.id, /^MUT-[A-Z0-9-]+$/);
  }
});

test("registerDefaultMutations: composable on existing catalog", () => {
  const catalog = createMutationCatalog();
  registerDefaultMutations(catalog);
  assert.ok(catalog.list().length >= 12);
});

test("evaluation: empty test-case list yields zero kill rate", () => {
  const intent = buildIntent();
  const report = evaluateMutationKillingSuite({
    jobId: "job-2041",
    generatedAt: GENERATED_AT,
    policyProfileId: "eu-banking-default",
    testCases: [],
    intent,
  });
  assert.equal(report.totalTestCases, 0);
  assert.equal(report.applicableMutations, 0);
  assert.equal(report.killedMutations, 0);
  assert.equal(report.killRate, 0);
  assert.equal(report.meetsThreshold, false);
  assert.equal(report.threshold, MUTATION_KILL_RATE_DEFAULT_THRESHOLD);
});

test("evaluation: rejects out-of-range threshold", () => {
  const intent = buildIntent();
  assert.throws(() =>
    evaluateMutationKillingSuite({
      jobId: "job-2041",
      generatedAt: GENERATED_AT,
      policyProfileId: "eu-banking-default",
      testCases: [],
      intent,
      threshold: 1.5,
    }),
  );
  assert.throws(() =>
    evaluateMutationKillingSuite({
      jobId: "job-2041",
      generatedAt: GENERATED_AT,
      policyProfileId: "eu-banking-default",
      testCases: [],
      intent,
      threshold: -0.1,
    }),
  );
  assert.throws(() =>
    evaluateMutationKillingSuite({
      jobId: "job-2041",
      generatedAt: GENERATED_AT,
      policyProfileId: "eu-banking-default",
      testCases: [],
      intent,
      threshold: Number.POSITIVE_INFINITY,
    }),
  );
});

test("evaluation: a single highly-specific case kills field-required + IBAN mutations", () => {
  const intent = buildIntent();
  const cases: GeneratedTestCase[] = [
    buildCase({
      id: "tc-iban-required",
      type: "negative",
      title: "Submission rejected when required IBAN is empty",
      objective: "Verify that submission is blocked when the required IBAN field is empty",
      preconditions: ["IBAN field is required"],
      steps: [
        { index: 1, action: "Leave IBAN empty" },
        {
          index: 2,
          action: "Press Submit",
          expected: "Submission is blocked and an error message is displayed: Required field",
        },
      ],
      expectedResults: [
        "An error message is displayed: required field",
        "Submission is blocked",
      ],
    }),
  ];
  const report = evaluateMutationKillingSuite({
    jobId: "job-2041",
    generatedAt: GENERATED_AT,
    policyProfileId: "eu-banking-default",
    testCases: cases,
    intent,
  });
  const killedClasses = new Set(
    report.mutations
      .filter((m) => m.killed)
      .map((m) => m.mutationClass),
  );
  assert.ok(killedClasses.has("field-required-flipped"));
  assert.ok(killedClasses.has("error-message-suppressed"));
});

test("evaluation: financial calculation case kills VAT + currency-rounding mutations", () => {
  const intent = buildIntent();
  const cases: GeneratedTestCase[] = [
    buildCase({
      id: "tc-vat-calc",
      type: "functional",
      title: "Compute financing need without VAT",
      objective:
        "The financing need calculation excludes VAT from the netto amount",
      expectedResults: [
        "Financing need total is 1000.00 EUR (Netto, excludes VAT)",
      ],
    }),
  ];
  const report = evaluateMutationKillingSuite({
    jobId: "job-2041",
    generatedAt: GENERATED_AT,
    policyProfileId: "eu-banking-default",
    testCases: cases,
    intent,
  });
  const killed = new Set(
    report.mutations.filter((m) => m.killed).map((m) => m.mutationClass),
  );
  assert.ok(killed.has("vat-applied-to-netto"));
  assert.ok(killed.has("currency-rounding-off-by-one"));
  assert.ok(killed.has("currency-locale-confusion"));
});

test("evaluation: deterministic ordering across runs", () => {
  const intent = buildIntent();
  const cases = [
    buildCase({ id: "tc-a", type: "functional", title: "alpha" }),
    buildCase({ id: "tc-b", type: "negative", title: "beta error message" }),
  ];
  const a = evaluateMutationKillingSuite({
    jobId: "job-2041",
    generatedAt: GENERATED_AT,
    policyProfileId: "eu-banking-default",
    testCases: cases,
    intent,
  });
  const b = evaluateMutationKillingSuite({
    jobId: "job-2041",
    generatedAt: GENERATED_AT,
    policyProfileId: "eu-banking-default",
    testCases: cases,
    intent,
  });
  assert.deepEqual(a, b);
  assert.deepEqual(
    a.mutations.map((m) => m.mutationId),
    [...a.mutations.map((m) => m.mutationId)].sort(),
  );
  assert.deepEqual(
    a.byClass.map((row) => row.mutationClass),
    [...ALLOWED_MUTATION_CLASSES],
    "byClass rows must follow the closed ALLOWED_MUTATION_CLASSES order",
  );
});

test("evaluation: reports unkilled mutations sorted alphabetically", () => {
  const intent = buildIntent();
  const cases: GeneratedTestCase[] = [
    buildCase({ id: "tc-bare", title: "Bare", type: "functional" }),
  ];
  const report = evaluateMutationKillingSuite({
    jobId: "job-2041",
    generatedAt: GENERATED_AT,
    policyProfileId: "eu-banking-default",
    testCases: cases,
    intent,
  });
  for (let i = 0; i < report.unkilledMutations.length - 1; i += 1) {
    const left = report.unkilledMutations[i];
    const right = report.unkilledMutations[i + 1];
    assert.ok(left !== undefined && right !== undefined);
    if (left === undefined || right === undefined) continue;
    assert.ok(left.localeCompare(right) <= 0);
  }
});

test("evaluation: a comprehensive negative + positive suite reaches the 0.85 KPI", () => {
  const intent = buildIntent();
  const cases: GeneratedTestCase[] = [
    buildCase({
      id: "tc-required",
      type: "negative",
      title: "Required IBAN missing rejected",
      objective: "Submit blocked when required IBAN is empty",
      preconditions: ["IBAN is required and left empty"],
      steps: [
        {
          index: 1,
          action: "Press submit with empty IBAN",
          expected: "Validation error: required field; submission blocked",
        },
      ],
      expectedResults: [
        "Validation error message is displayed: required field",
        "Submission is blocked",
      ],
    }),
    buildCase({
      id: "tc-pattern",
      type: "validation",
      title: "Invalid IBAN format rejected",
      objective: "IBAN that fails format pattern is rejected",
      steps: [
        {
          index: 1,
          action: "Enter invalid IBAN that does not match the pattern format",
          expected: "Invalid IBAN: rejected with error message",
        },
      ],
      expectedResults: [
        "Validation error: invalid IBAN format pattern, rejected",
      ],
    }),
    buildCase({
      id: "tc-checksum",
      type: "negative",
      title: "Invalid IBAN checksum rejected",
      objective: "IBAN with bad checksum is rejected",
      steps: [
        {
          index: 1,
          action: "Submit invalid IBAN checksum",
          expected: "IBAN checksum invalid: rejected with error message",
        },
      ],
      expectedResults: [
        "IBAN checksum failed; input rejected with an error message",
      ],
    }),
    buildCase({
      id: "tc-boundary",
      type: "boundary",
      title: "Maximum 34 characters boundary",
      objective: "IBAN exceeding 34 characters is rejected",
      steps: [
        {
          index: 1,
          action: "Enter IBAN with 35 characters at maximum boundary",
          expected: "Rejected: exceeds 34 characters; error message displayed",
        },
      ],
      expectedResults: [
        "IBAN with 35 characters at maximum boundary is rejected; error message displayed",
      ],
    }),
    buildCase({
      id: "tc-financing",
      type: "functional",
      title: "Financing need excludes VAT",
      objective: "Compute financing need without VAT (Netto basis)",
      expectedResults: [
        "Financing need total is 1234.56 EUR (Netto, excludes VAT)",
      ],
    }),
    buildCase({
      id: "tc-optional-cost",
      type: "functional",
      title: "Optional fee not selected",
      objective: "Optional fee left unchecked",
      preconditions: ["Optional fee not selected"],
      expectedResults: ["Optional fee is not added to the total"],
    }),
    buildCase({
      id: "tc-workflow",
      type: "navigation",
      title: "Navigate to receipt after submit",
      objective: "User reaches receipt page after submit",
      expectedResults: ["After submit, navigate to the receipt confirmation page"],
    }),
    buildCase({
      id: "tc-a11y",
      type: "accessibility",
      title: "IBAN field accessible name",
      objective: "Screen reader announces the IBAN field accessible name",
      expectedResults: [
        "Screen reader announces the IBAN field's accessible name correctly; focus order preserved",
      ],
    }),
    buildCase({
      id: "tc-pii",
      type: "functional",
      title: "PII redaction in logs",
      objective: "Customer name is redacted in logs",
      expectedResults: [
        "Customer name PII is redacted in the audit log entry",
      ],
    }),
    buildCase({
      id: "tc-four-eyes",
      type: "functional",
      title: "Four-eyes principle approval",
      objective: "Submit requires second approver",
      expectedResults: [
        "Submit requires a second approver under the four-eyes principle",
      ],
    }),
    buildCase({
      id: "tc-audit",
      type: "functional",
      title: "Audit log entry on submit",
      objective: "Audit log entry written on submit",
      expectedResults: [
        "An audit log entry is written when the submit action completes",
      ],
    }),
    buildCase({
      id: "tc-null",
      type: "negative",
      title: "Null vs empty distinction",
      objective: "Null and empty are not equivalent",
      expectedResults: [
        "Null IBAN is rejected with a different error message than empty IBAN",
      ],
    }),
  ];
  const report = evaluateMutationKillingSuite({
    jobId: "job-2041",
    generatedAt: GENERATED_AT,
    policyProfileId: "eu-banking-default",
    testCases: cases,
    intent,
  });
  assert.ok(
    report.killRate >= 0.85,
    `expected killRate >= 0.85; got ${report.killRate}. Unkilled: ${report.unkilledMutations.join(",")}`,
  );
  assert.equal(report.meetsThreshold, true);
});

test("buildMutationKillRateSummary: projects the report shape", () => {
  const intent = buildIntent();
  const report: MutationReport = evaluateMutationKillingSuite({
    jobId: "job-2041",
    generatedAt: GENERATED_AT,
    policyProfileId: "eu-banking-default",
    testCases: [buildCase({})],
    intent,
  });
  const summary = buildMutationKillRateSummary(report);
  assert.equal(summary.artifactFilename, MUTATION_REPORT_ARTIFACT_FILENAME);
  assert.equal(summary.killRate, report.killRate);
  assert.equal(summary.totalMutations, report.totalMutations);
  assert.equal(summary.applicableMutations, report.applicableMutations);
  assert.equal(summary.killedMutations, report.killedMutations);
  assert.equal(summary.threshold, report.threshold);
  assert.equal(summary.meetsThreshold, report.meetsThreshold);
});

test("encodeCanonicalReportBytes: deterministic UTF-8 with trailing newline", () => {
  const intent = buildIntent();
  const report = evaluateMutationKillingSuite({
    jobId: "job-2041",
    generatedAt: GENERATED_AT,
    policyProfileId: "eu-banking-default",
    testCases: [buildCase({})],
    intent,
  });
  const a = encodeCanonicalReportBytes(report);
  const b = encodeCanonicalReportBytes(report);
  assert.equal(a.toString("utf8"), b.toString("utf8"));
  const encoded = a.toString("utf8");
  assert.ok(encoded.endsWith("\n"));
  const parsed = JSON.parse(encoded.trimEnd());
  assert.equal(parsed.schemaVersion, MUTATION_REPORT_SCHEMA_VERSION);
  assert.equal(parsed.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
});

test("writeMutationReportArtifact: persists at the canonical filename", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "ti-mut-"));
  try {
    const intent = buildIntent();
    const report = evaluateMutationKillingSuite({
      jobId: "job-2041",
      generatedAt: GENERATED_AT,
      policyProfileId: "eu-banking-default",
      testCases: [buildCase({})],
      intent,
    });
    const result = await writeMutationReportArtifact({
      artifactDir: tmp,
      report,
    });
    assert.equal(
      result.path,
      join(tmp, MUTATION_REPORT_ARTIFACT_FILENAME),
    );
    const onDisk = await readFile(result.path, "utf8");
    assert.equal(onDisk, result.bytes.toString("utf8"));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("FinOps cap constant is the documented 0.20 ceiling", () => {
  assert.equal(MUTATION_EVAL_TOKEN_BUDGET_RATIO_CAP, 0.2);
});

test("default threshold matches the >=0.85 KPI from Issue #1753", () => {
  assert.equal(MUTATION_KILL_RATE_DEFAULT_THRESHOLD, 0.85);
});
