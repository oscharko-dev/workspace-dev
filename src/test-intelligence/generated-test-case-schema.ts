import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type GeneratedTestCaseReviewState,
  type GeneratedTestCaseStep,
  type TestCaseLevel,
  type TestCasePriority,
  type TestCaseRiskCategory,
  type TestCaseTechnique29119,
  type TestCaseType,
} from "../contracts/index.js";
import { sha256Hex } from "./content-hash.js";

const ISO_8601_PATTERN =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?(?:Z|[+-]\\d{2}:\\d{2})$";

const TECHNIQUES: readonly TestCaseTechnique29119[] = [
  "equivalence_partitioning",
  "boundary_value_analysis",
  "decision_table",
  "state_transition",
  "use_case",
  "exploratory",
  "error_guessing",
  "syntax_testing",
  "classification_tree",
];

const LEVELS: readonly TestCaseLevel[] = [
  "unit",
  "component",
  "integration",
  "system",
  "acceptance",
];

const TYPES: readonly TestCaseType[] = [
  "functional",
  "negative",
  "boundary",
  "validation",
  "navigation",
  "regression",
  "exploratory",
  "accessibility",
];

const PRIORITIES: readonly TestCasePriority[] = ["p0", "p1", "p2", "p3"];

const RISK_CATEGORIES: readonly TestCaseRiskCategory[] = [
  "low",
  "medium",
  "high",
  "regulated_data",
  "financial_transaction",
];

const REVIEW_STATES: readonly GeneratedTestCaseReviewState[] = [
  "draft",
  "auto_approved",
  "needs_review",
  "rejected",
];

const ROOT_KEYS = ["schemaVersion", "jobId", "testCases"] as const;
const TEST_CASE_KEYS = [
  "id",
  "sourceJobId",
  "contractVersion",
  "schemaVersion",
  "promptTemplateVersion",
  "title",
  "objective",
  "level",
  "type",
  "priority",
  "riskCategory",
  "technique",
  "preconditions",
  "testData",
  "steps",
  "expectedResults",
  "figmaTraceRefs",
  "assumptions",
  "openQuestions",
  "qcMappingPreview",
  "qualitySignals",
  "reviewState",
  "audit",
] as const;
const STEP_KEYS = ["index", "action", "data", "expected"] as const;
const FIGMA_TRACE_REF_KEYS = [
  "screenId",
  "nodeId",
  "nodeName",
  "nodePath",
] as const;
const QC_MAPPING_KEYS = [
  "folderHint",
  "mappingProfileId",
  "exportable",
  "blockingReasons",
] as const;
const QUALITY_SIGNAL_KEYS = [
  "coveredFieldIds",
  "coveredActionIds",
  "coveredValidationIds",
  "coveredNavigationIds",
  "confidence",
  "ambiguity",
] as const;
const AMBIGUITY_KEYS = ["reason"] as const;
const AUDIT_KEYS = [
  "jobId",
  "generatedAt",
  "contractVersion",
  "schemaVersion",
  "promptTemplateVersion",
  "redactionPolicyVersion",
  "visualSidecarSchemaVersion",
  "cacheHit",
  "cacheKey",
  "inputHash",
  "promptHash",
  "schemaHash",
] as const;

/** Stable schema name shared with structured-output gateways. */
export const GENERATED_TEST_CASE_LIST_SCHEMA_NAME: string = `workspace-dev.test-intelligence.generated-test-case-list.v${GENERATED_TEST_CASE_SCHEMA_VERSION}`;

/**
 * Build the JSON Schema for the structured test-case generator response.
 *
 * The schema is hand-derived from the TypeScript contract surface so it can
 * be enforced by structured-output gateways and replayed deterministically.
 * A drift test in `generated-test-case-schema.test.ts` keeps the schema in
 * lockstep with the TypeScript types.
 */
export const buildGeneratedTestCaseListJsonSchema = (): Record<
  string,
  unknown
> => {
  const figmaTraceRef = {
    type: "object",
    additionalProperties: false,
    required: ["screenId"],
    properties: {
      screenId: { type: "string", minLength: 1 },
      nodeId: { type: "string" },
      nodeName: { type: "string" },
      nodePath: { type: "string" },
    },
  } as const;

  const ambiguity = {
    type: "object",
    additionalProperties: false,
    required: ["reason"],
    properties: {
      reason: { type: "string", minLength: 1 },
    },
  } as const;

  const step: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    required: ["index", "action"],
    properties: {
      index: { type: "integer", minimum: 1 },
      action: { type: "string", minLength: 1 },
      data: { type: "string" },
      expected: { type: "string" },
    },
  };

  const qcMapping: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    required: ["exportable"],
    properties: {
      folderHint: { type: "string" },
      mappingProfileId: { type: "string" },
      exportable: { type: "boolean" },
      blockingReasons: {
        type: "array",
        items: { type: "string", minLength: 1 },
      },
    },
  };

  const qualitySignals: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    required: [
      "coveredFieldIds",
      "coveredActionIds",
      "coveredValidationIds",
      "coveredNavigationIds",
      "confidence",
    ],
    properties: {
      coveredFieldIds: { type: "array", items: { type: "string" } },
      coveredActionIds: { type: "array", items: { type: "string" } },
      coveredValidationIds: { type: "array", items: { type: "string" } },
      coveredNavigationIds: { type: "array", items: { type: "string" } },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      ambiguity,
    },
  };

  const audit: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    required: [
      "jobId",
      "generatedAt",
      "contractVersion",
      "schemaVersion",
      "promptTemplateVersion",
      "redactionPolicyVersion",
      "visualSidecarSchemaVersion",
      "cacheHit",
      "cacheKey",
      "inputHash",
      "promptHash",
      "schemaHash",
    ],
    properties: {
      jobId: { type: "string", minLength: 1 },
      generatedAt: { type: "string", pattern: ISO_8601_PATTERN },
      contractVersion: { const: TEST_INTELLIGENCE_CONTRACT_VERSION },
      schemaVersion: { const: GENERATED_TEST_CASE_SCHEMA_VERSION },
      promptTemplateVersion: {
        const: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
      },
      redactionPolicyVersion: { type: "string", minLength: 1 },
      visualSidecarSchemaVersion: { type: "string", minLength: 1 },
      cacheHit: { type: "boolean" },
      cacheKey: { type: "string", minLength: 1 },
      inputHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
      promptHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
      schemaHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    },
  };

  const testCase: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "sourceJobId",
      "contractVersion",
      "schemaVersion",
      "promptTemplateVersion",
      "title",
      "objective",
      "level",
      "type",
      "priority",
      "riskCategory",
      "technique",
      "preconditions",
      "testData",
      "steps",
      "expectedResults",
      "figmaTraceRefs",
      "assumptions",
      "openQuestions",
      "qcMappingPreview",
      "qualitySignals",
      "reviewState",
      "audit",
    ],
    properties: {
      id: { type: "string", minLength: 1 },
      sourceJobId: { type: "string", minLength: 1 },
      contractVersion: { const: TEST_INTELLIGENCE_CONTRACT_VERSION },
      schemaVersion: { const: GENERATED_TEST_CASE_SCHEMA_VERSION },
      promptTemplateVersion: {
        const: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
      },
      title: { type: "string", minLength: 1, maxLength: 200 },
      objective: { type: "string", minLength: 1, maxLength: 1000 },
      level: { enum: [...LEVELS] },
      type: { enum: [...TYPES] },
      priority: { enum: [...PRIORITIES] },
      riskCategory: { enum: [...RISK_CATEGORIES] },
      technique: { enum: [...TECHNIQUES] },
      preconditions: { type: "array", items: { type: "string" } },
      testData: { type: "array", items: { type: "string" } },
      steps: { type: "array", minItems: 1, items: step },
      expectedResults: { type: "array", items: { type: "string" } },
      figmaTraceRefs: { type: "array", items: figmaTraceRef },
      assumptions: { type: "array", items: { type: "string" } },
      openQuestions: { type: "array", items: { type: "string" } },
      qcMappingPreview: qcMapping,
      qualitySignals,
      reviewState: { enum: [...REVIEW_STATES] },
      audit,
    },
  };

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: GENERATED_TEST_CASE_LIST_SCHEMA_NAME,
    title: "GeneratedTestCaseList",
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "jobId", "testCases"],
    properties: {
      schemaVersion: { const: GENERATED_TEST_CASE_SCHEMA_VERSION },
      jobId: { type: "string", minLength: 1 },
      testCases: {
        type: "array",
        items: testCase,
      },
    },
  };
};

/** sha256 of the canonical JSON serialization of the schema. */
export const computeGeneratedTestCaseListSchemaHash = (): string => {
  return sha256Hex(buildGeneratedTestCaseListJsonSchema());
};

/**
 * Validation error with a JSON-pointer-style path to the offending field.
 * The validator is intentionally minimal — it covers the structural rules
 * the structured-output gateway is expected to enforce, and it never
 * inspects values beyond the contract surface.
 */
export interface GeneratedTestCaseValidationError {
  path: string;
  message: string;
}

export interface GeneratedTestCaseValidationResult {
  valid: boolean;
  errors: GeneratedTestCaseValidationError[];
}

/**
 * Lightweight structural validator for `GeneratedTestCaseList` objects.
 *
 * The validator is kept small on purpose: it enforces the same shape as the
 * exported JSON schema, but without pulling in a third-party runtime. It is
 * used by `prompt-compiler` snapshot tests and by the cache-hit path to
 * reject corrupted entries before they reach the consumer.
 */
export const validateGeneratedTestCaseList = (
  value: unknown,
): GeneratedTestCaseValidationResult => {
  const errors: GeneratedTestCaseValidationError[] = [];
  if (!isObject(value)) {
    errors.push({ path: "$", message: "expected object" });
    return { valid: false, errors };
  }
  const root = value;
  expectExactKeys(root, ROOT_KEYS, "$", errors);
  if (root["schemaVersion"] !== GENERATED_TEST_CASE_SCHEMA_VERSION) {
    errors.push({
      path: "$.schemaVersion",
      message: `expected "${GENERATED_TEST_CASE_SCHEMA_VERSION}"`,
    });
  }
  if (typeof root["jobId"] !== "string" || root["jobId"].length === 0) {
    errors.push({ path: "$.jobId", message: "expected non-empty string" });
  }
  if (!Array.isArray(root["testCases"])) {
    errors.push({ path: "$.testCases", message: "expected array" });
    return { valid: errors.length === 0, errors };
  }
  for (let i = 0; i < root["testCases"].length; i++) {
    validateTestCase(root["testCases"][i], `$.testCases[${i}]`, errors);
  }
  return { valid: errors.length === 0, errors };
};

const validateTestCase = (
  value: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (!isObject(value)) {
    errors.push({ path, message: "expected object" });
    return;
  }
  const tc = value;
  expectExactKeys(tc, TEST_CASE_KEYS, path, errors);
  expectString(tc["id"], `${path}.id`, errors);
  expectString(tc["sourceJobId"], `${path}.sourceJobId`, errors);
  expectConst(
    tc["contractVersion"],
    TEST_INTELLIGENCE_CONTRACT_VERSION,
    `${path}.contractVersion`,
    errors,
  );
  expectConst(
    tc["schemaVersion"],
    GENERATED_TEST_CASE_SCHEMA_VERSION,
    `${path}.schemaVersion`,
    errors,
  );
  expectConst(
    tc["promptTemplateVersion"],
    TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    `${path}.promptTemplateVersion`,
    errors,
  );
  expectString(tc["title"], `${path}.title`, errors);
  expectString(tc["objective"], `${path}.objective`, errors);
  expectEnum(tc["level"], LEVELS, `${path}.level`, errors);
  expectEnum(tc["type"], TYPES, `${path}.type`, errors);
  expectEnum(tc["priority"], PRIORITIES, `${path}.priority`, errors);
  expectEnum(
    tc["riskCategory"],
    RISK_CATEGORIES,
    `${path}.riskCategory`,
    errors,
  );
  expectEnum(tc["technique"], TECHNIQUES, `${path}.technique`, errors);
  expectStringArray(tc["preconditions"], `${path}.preconditions`, errors);
  expectStringArray(tc["testData"], `${path}.testData`, errors);
  expectStepsArray(tc["steps"], `${path}.steps`, errors);
  expectStringArray(tc["expectedResults"], `${path}.expectedResults`, errors);
  expectTraceRefs(tc["figmaTraceRefs"], `${path}.figmaTraceRefs`, errors);
  expectStringArray(tc["assumptions"], `${path}.assumptions`, errors);
  expectStringArray(tc["openQuestions"], `${path}.openQuestions`, errors);
  expectQcMapping(tc["qcMappingPreview"], `${path}.qcMappingPreview`, errors);
  expectQualitySignals(tc["qualitySignals"], `${path}.qualitySignals`, errors);
  expectEnum(tc["reviewState"], REVIEW_STATES, `${path}.reviewState`, errors);
  expectAudit(tc["audit"], `${path}.audit`, errors);
};

const expectString = (
  value: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (typeof value !== "string" || value.length === 0) {
    errors.push({ path, message: "expected non-empty string" });
  }
};

const expectConst = <T extends string>(
  value: unknown,
  expected: T,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (value !== expected) {
    errors.push({ path, message: `expected "${expected}"` });
  }
};

const expectEnum = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    errors.push({
      path,
      message: `expected one of ${allowed.join(", ")}`,
    });
  }
};

const expectStringArray = (
  value: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (!Array.isArray(value)) {
    errors.push({ path, message: "expected array" });
    return;
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string") {
      errors.push({ path: `${path}[${i}]`, message: "expected string" });
    }
  }
};

const expectStepsArray = (
  value: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push({ path, message: "expected non-empty array" });
    return;
  }
  for (let i = 0; i < value.length; i++) {
    const step: unknown = value[i];
    if (!isObject(step)) {
      errors.push({ path: `${path}[${i}]`, message: "expected object" });
      continue;
    }
    expectExactKeys(step, STEP_KEYS, `${path}[${i}]`, errors);
    if (
      typeof step["index"] !== "number" ||
      !Number.isInteger(step["index"]) ||
      step["index"] < 1
    ) {
      errors.push({
        path: `${path}[${i}].index`,
        message: "expected integer >= 1",
      });
    }
    expectString(step["action"], `${path}[${i}].action`, errors);
    if (step["data"] !== undefined) {
      expectString(step["data"], `${path}[${i}].data`, errors);
    }
    if (step["expected"] !== undefined) {
      expectString(step["expected"], `${path}[${i}].expected`, errors);
    }
  }
};

const expectTraceRefs = (
  value: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (!Array.isArray(value)) {
    errors.push({ path, message: "expected array" });
    return;
  }
  for (let i = 0; i < value.length; i++) {
    const ref: unknown = value[i];
    if (!isObject(ref)) {
      errors.push({ path: `${path}[${i}]`, message: "expected object" });
      continue;
    }
    expectExactKeys(ref, FIGMA_TRACE_REF_KEYS, `${path}[${i}]`, errors);
    expectString(ref["screenId"], `${path}[${i}].screenId`, errors);
    if (ref["nodeId"] !== undefined) {
      expectString(ref["nodeId"], `${path}[${i}].nodeId`, errors);
    }
    if (ref["nodeName"] !== undefined) {
      expectString(ref["nodeName"], `${path}[${i}].nodeName`, errors);
    }
    if (ref["nodePath"] !== undefined) {
      expectString(ref["nodePath"], `${path}[${i}].nodePath`, errors);
    }
  }
};

const expectQcMapping = (
  value: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (!isObject(value)) {
    errors.push({ path, message: "expected object" });
    return;
  }
  expectExactKeys(value, QC_MAPPING_KEYS, path, errors);
  if (typeof value["exportable"] !== "boolean") {
    errors.push({ path: `${path}.exportable`, message: "expected boolean" });
  }
  if (value["folderHint"] !== undefined) {
    expectString(value["folderHint"], `${path}.folderHint`, errors);
  }
  if (value["mappingProfileId"] !== undefined) {
    expectString(value["mappingProfileId"], `${path}.mappingProfileId`, errors);
  }
  if (value["blockingReasons"] !== undefined) {
    expectStringArray(
      value["blockingReasons"],
      `${path}.blockingReasons`,
      errors,
    );
  }
};

const expectQualitySignals = (
  value: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (!isObject(value)) {
    errors.push({ path, message: "expected object" });
    return;
  }
  expectExactKeys(value, QUALITY_SIGNAL_KEYS, path, errors);
  expectStringArray(
    value["coveredFieldIds"],
    `${path}.coveredFieldIds`,
    errors,
  );
  expectStringArray(
    value["coveredActionIds"],
    `${path}.coveredActionIds`,
    errors,
  );
  expectStringArray(
    value["coveredValidationIds"],
    `${path}.coveredValidationIds`,
    errors,
  );
  expectStringArray(
    value["coveredNavigationIds"],
    `${path}.coveredNavigationIds`,
    errors,
  );
  if (
    typeof value["confidence"] !== "number" ||
    value["confidence"] < 0 ||
    value["confidence"] > 1
  ) {
    errors.push({
      path: `${path}.confidence`,
      message: "expected number in [0, 1]",
    });
  }
  if (value["ambiguity"] !== undefined) {
    expectAmbiguity(value["ambiguity"], `${path}.ambiguity`, errors);
  }
};

const expectAudit = (
  value: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (!isObject(value)) {
    errors.push({ path, message: "expected object" });
    return;
  }
  expectExactKeys(value, AUDIT_KEYS, path, errors);
  expectString(value["jobId"], `${path}.jobId`, errors);
  if (
    typeof value["generatedAt"] !== "string" ||
    !new RegExp(ISO_8601_PATTERN).test(value["generatedAt"])
  ) {
    errors.push({
      path: `${path}.generatedAt`,
      message: "expected ISO-8601 timestamp",
    });
  }
  expectConst(
    value["contractVersion"],
    TEST_INTELLIGENCE_CONTRACT_VERSION,
    `${path}.contractVersion`,
    errors,
  );
  expectConst(
    value["schemaVersion"],
    GENERATED_TEST_CASE_SCHEMA_VERSION,
    `${path}.schemaVersion`,
    errors,
  );
  expectConst(
    value["promptTemplateVersion"],
    TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    `${path}.promptTemplateVersion`,
    errors,
  );
  expectString(
    value["redactionPolicyVersion"],
    `${path}.redactionPolicyVersion`,
    errors,
  );
  expectString(
    value["visualSidecarSchemaVersion"],
    `${path}.visualSidecarSchemaVersion`,
    errors,
  );
  if (typeof value["cacheHit"] !== "boolean") {
    errors.push({ path: `${path}.cacheHit`, message: "expected boolean" });
  }
  expectString(value["cacheKey"], `${path}.cacheKey`, errors);
  expectHash(value["inputHash"], `${path}.inputHash`, errors);
  expectHash(value["promptHash"], `${path}.promptHash`, errors);
  expectHash(value["schemaHash"], `${path}.schemaHash`, errors);
};

const expectHash = (
  value: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    errors.push({ path, message: "expected sha256 hex digest" });
  }
};

const expectAmbiguity = (
  value: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (!isObject(value)) {
    errors.push({ path, message: "expected object" });
    return;
  }
  expectExactKeys(value, AMBIGUITY_KEYS, path, errors);
  expectString(value["reason"], `${path}.reason`, errors);
};

const expectExactKeys = (
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push({
        path,
        message: `unexpected property "${key}"`,
      });
      return;
    }
  }
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

/** Re-export for consumers that need the types in one place. */
export type { GeneratedTestCase, GeneratedTestCaseList, GeneratedTestCaseStep };
