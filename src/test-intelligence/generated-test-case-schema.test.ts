import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type GeneratedTestCaseStep,
} from "../contracts/index.js";
import {
  GENERATED_TEST_CASE_LIST_SCHEMA_NAME,
  buildGeneratedTestCaseListJsonSchema,
  computeGeneratedTestCaseListSchemaHash,
  validateGeneratedTestCaseList,
} from "./generated-test-case-schema.js";

const buildSampleTestCase = (
  overrides: Partial<GeneratedTestCase> = {},
): GeneratedTestCase => ({
  id: "tc-001",
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Submit valid IBAN",
  objective: "Verify the form accepts a syntactically valid IBAN.",
  level: "system",
  type: "validation",
  priority: "p1",
  riskCategory: "regulated_data",
  technique: "boundary_value_analysis",
  preconditions: [],
  testData: ["[REDACTED:IBAN]"],
  steps: [{ index: 1, action: "Enter IBAN", expected: "Field accepts value" }],
  expectedResults: ["No validation error"],
  figmaTraceRefs: [{ screenId: "s-payment", nodeId: "n-iban" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: ["s-payment::field::n-iban"],
    coveredActionIds: [],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.85,
  },
  reviewState: "draft",
  audit: {
    jobId: "job-1",
    generatedAt: "2026-04-25T00:00:00.000Z",
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    redactionPolicyVersion: REDACTION_POLICY_VERSION,
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    cacheHit: false,
    cacheKey: "abc",
    inputHash: "a".repeat(64),
    promptHash: "b".repeat(64),
    schemaHash: "c".repeat(64),
  },
  ...overrides,
});

const buildSampleList = (
  overrides: Partial<GeneratedTestCaseList> = {},
): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1",
  testCases: [buildSampleTestCase()],
  ...overrides,
});

test("schema: build returns a Draft 2020-12 JSON Schema", () => {
  const schema = buildGeneratedTestCaseListJsonSchema();
  assert.equal(
    schema["$schema"],
    "https://json-schema.org/draft/2020-12/schema",
  );
  assert.equal(schema["$id"], GENERATED_TEST_CASE_LIST_SCHEMA_NAME);
  assert.equal(schema["title"], "GeneratedTestCaseList");
});

test("schema: hash is deterministic across calls", () => {
  const a = computeGeneratedTestCaseListSchemaHash();
  const b = computeGeneratedTestCaseListSchemaHash();
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test("schema: structurally pins the contract version constants", () => {
  const schema = buildGeneratedTestCaseListJsonSchema();
  // serialise to a string so we can search by const occurrences without
  // walking the nested structure manually.
  const serialized = JSON.stringify(schema);
  assert.match(
    serialized,
    new RegExp(`"const":"${GENERATED_TEST_CASE_SCHEMA_VERSION}"`),
  );
  assert.match(
    serialized,
    new RegExp(`"const":"${TEST_INTELLIGENCE_CONTRACT_VERSION}"`),
  );
  assert.match(
    serialized,
    new RegExp(`"const":"${TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION}"`),
  );
});

test("schema: drift guard — the hash is stable for the current contract", () => {
  // If this hash changes, the JSON schema (and hence every cache key) has
  // shifted. Bump GENERATED_TEST_CASE_SCHEMA_VERSION and update the
  // expected digest in lockstep.
  // Hash bumped by Issue #1676: schema $id renormalised
  // `workspace-dev.test-intelligence.generated-test-case-list.v1.0.0` ->
  // `workspace-dev-generated-test-case-list-v1` to comply with Azure
  // OpenAI's `response_format.json_schema.name` grammar.
  // Hash bumped by Issue #1735: optional additive field
  // `regulatoryRelevance` ({domain, rationale}) on each test case;
  // GENERATED_TEST_CASE_SCHEMA_VERSION bumped 1.0.0 -> 1.1.0 in lockstep.
  const expected =
    "a2cf4c25de0a43004225a7545ca5a95b62e571aa87d6a1956870ed3aa4136c98";
  const actual = computeGeneratedTestCaseListSchemaHash();
  if (actual !== expected) {
    assert.fail(
      `generated test case schema hash drifted from "${expected}" to "${actual}". ` +
        `If this change is intentional, bump GENERATED_TEST_CASE_SCHEMA_VERSION ` +
        `and update the expected hash in this drift guard.`,
    );
  }
});

test("validator: accepts a valid GeneratedTestCaseList", () => {
  const list = buildSampleList();
  const result = validateGeneratedTestCaseList(list);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("validator: rejects unexpected root properties", () => {
  const list = {
    ...buildSampleList(),
    unexpected: true,
  } as unknown as GeneratedTestCaseList;
  const result = validateGeneratedTestCaseList(list);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.path === "$"),
    "expected root property error",
  );
});

test("validator: rejects mismatched schema version", () => {
  const list = buildSampleList({
    schemaVersion:
      "9.9.9" as unknown as typeof GENERATED_TEST_CASE_SCHEMA_VERSION,
  });
  const result = validateGeneratedTestCaseList(list);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.path === "$.schemaVersion"),
    "expected schemaVersion error",
  );
});

test("validator: rejects an unknown technique", () => {
  const list = buildSampleList({
    testCases: [
      buildSampleTestCase({
        technique:
          "made_up_technique" as unknown as GeneratedTestCase["technique"],
      }),
    ],
  });
  const result = validateGeneratedTestCaseList(list);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.path === "$.testCases[0].technique"),
    "expected technique error",
  );
});

test("validator: rejects empty steps array", () => {
  const list = buildSampleList({
    testCases: [buildSampleTestCase({ steps: [] })],
  });
  const result = validateGeneratedTestCaseList(list);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.path === "$.testCases[0].steps"),
    "expected steps error",
  );
});

test("validator: rejects unexpected nested properties in a step", () => {
  const tc = buildSampleTestCase();
  const list = buildSampleList({
    testCases: [
      {
        ...tc,
        steps: [
          {
            ...tc.steps[0],
            unexpected: "boom",
          } as unknown as GeneratedTestCaseStep,
        ],
      },
    ],
  });
  const result = validateGeneratedTestCaseList(list);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.path === "$.testCases[0].steps[0]"),
    "expected nested step property error",
  );
});

test("validator: rejects malformed optional nested fields", () => {
  const tc = buildSampleTestCase();
  const list = buildSampleList({
    testCases: [
      {
        ...tc,
        steps: [
          {
            index: 1,
            action: "Enter IBAN",
            expected: 42,
          } as unknown as GeneratedTestCaseStep,
        ],
        figmaTraceRefs: [
          {
            screenId: "s-payment",
            nodeName: 42,
          } as unknown as GeneratedTestCase["figmaTraceRefs"][number],
        ],
        qcMappingPreview: {
          exportable: false,
          blockingReasons: ["missing folder", 42],
        } as unknown as GeneratedTestCase["qcMappingPreview"],
      },
    ],
  });
  const result = validateGeneratedTestCaseList(list);
  assert.equal(result.valid, false);
  const paths = result.errors.map((error) => error.path);
  assert.ok(paths.includes("$.testCases[0].steps[0].expected"));
  assert.ok(paths.includes("$.testCases[0].figmaTraceRefs[0].nodeName"));
  assert.ok(
    paths.includes("$.testCases[0].qcMappingPreview.blockingReasons[1]"),
  );
});

test("validator: rejects unexpected nested properties in qualitySignals.ambiguity", () => {
  const tc = buildSampleTestCase();
  const list = buildSampleList({
    testCases: [
      {
        ...tc,
        qualitySignals: {
          ...tc.qualitySignals,
          ambiguity: {
            reason: "needs manual review",
            unexpected: true,
          } as unknown as GeneratedTestCase["qualitySignals"]["ambiguity"],
        },
      },
    ],
  });
  const result = validateGeneratedTestCaseList(list);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(
      (error) => error.path === "$.testCases[0].qualitySignals.ambiguity",
    ),
    "expected ambiguity property error",
  );
});

test("validator: rejects malformed audit hashes", () => {
  const tc = buildSampleTestCase();
  const list = buildSampleList({
    testCases: [
      {
        ...tc,
        audit: { ...tc.audit, inputHash: "not-a-hash" },
      },
    ],
  });
  const result = validateGeneratedTestCaseList(list);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(
      (error) => error.path === "$.testCases[0].audit.inputHash",
    ),
    "expected audit.inputHash error",
  );
});

test("validator: rejects out-of-range confidence", () => {
  const tc = buildSampleTestCase();
  const list = buildSampleList({
    testCases: [
      {
        ...tc,
        qualitySignals: { ...tc.qualitySignals, confidence: 1.5 },
      },
    ],
  });
  const result = validateGeneratedTestCaseList(list);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(
      (error) => error.path === "$.testCases[0].qualitySignals.confidence",
    ),
    "expected confidence error",
  );
});

test("validator: rejects non-object root", () => {
  const result = validateGeneratedTestCaseList(null);
  assert.equal(result.valid, false);
  assert.equal(result.errors[0]?.path, "$");
});
