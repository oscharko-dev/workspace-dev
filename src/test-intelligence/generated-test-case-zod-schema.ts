import * as z from "zod";

import {
  ALLOWED_GENERATED_TEST_CASE_CATEGORIES,
  ALLOWED_GENERATED_TEST_CASE_POLARITIES,
  ALLOWED_REGULATORY_RELEVANCE_DOMAINS,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type GeneratedTestCaseCategory,
  type GeneratedTestCasePolarity,
  type GeneratedTestCaseReviewState,
  type RegulatoryRelevanceDomain,
  type TestCaseLevel,
  type TestCasePriority,
  type TestCaseRiskCategory,
  type TestCaseTechnique29119,
  type TestCaseType,
} from "../contracts/index.js";

const ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;

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
const POLARITIES: readonly GeneratedTestCasePolarity[] =
  ALLOWED_GENERATED_TEST_CASE_POLARITIES;
const CASE_CATEGORIES: readonly GeneratedTestCaseCategory[] =
  ALLOWED_GENERATED_TEST_CASE_CATEGORIES;

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

const REGULATORY_DOMAINS: readonly RegulatoryRelevanceDomain[] =
  ALLOWED_REGULATORY_RELEVANCE_DOMAINS;

const SCHEMA_NAME_VERSION_MAJOR = GENERATED_TEST_CASE_SCHEMA_VERSION.split(
  ".",
)[0] as string;
export const GENERATED_TEST_CASE_LIST_SCHEMA_NAME: string = `workspace-dev-generated-test-case-list-v${SCHEMA_NAME_VERSION_MAJOR}`;

export const generatedTestCaseListZodSchema: z.ZodType = z
  .strictObject({
    schemaVersion: z.literal(GENERATED_TEST_CASE_SCHEMA_VERSION),
    jobId: z.string().min(1),
    testCases: z.array(
      z.strictObject({
        id: z.string().min(1),
        sourceJobId: z.string().min(1),
        contractVersion: z.literal(TEST_INTELLIGENCE_CONTRACT_VERSION),
        schemaVersion: z.literal(GENERATED_TEST_CASE_SCHEMA_VERSION),
        promptTemplateVersion: z.literal(
          TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
        ),
        title: z.string().min(1).max(200),
        objective: z.string().min(1).max(1000),
        level: z.enum(LEVELS),
        type: z.enum(TYPES),
        polarity: z.enum(POLARITIES).optional(),
        category: z.enum(CASE_CATEGORIES).optional(),
        priority: z.enum(PRIORITIES),
        riskCategory: z.enum(RISK_CATEGORIES),
        technique: z.enum(TECHNIQUES),
        preconditions: z.array(z.string()),
        testData: z.array(z.string()),
        steps: z
          .array(
            z.strictObject({
              index: z.number().int().min(1),
              action: z.string().min(1),
              data: z.string().optional(),
              expected: z.string().optional(),
              fieldLifecycleTransitionId: z.string().min(1).optional(),
            }),
          )
          .min(1),
        expectedResults: z.array(z.string()),
        figmaTraceRefs: z.array(
          z.strictObject({
            screenId: z.string().min(1),
            nodeId: z.string().optional(),
            nodeName: z.string().optional(),
            nodePath: z.string().optional(),
          }),
        ),
        assumptions: z.array(z.string()),
        openQuestions: z.array(z.string()),
        qcMappingPreview: z.strictObject({
          folderHint: z.string().optional(),
          mappingProfileId: z.string().optional(),
          decisionBasis: z.literal("mapping_preview_only").optional(),
          exportable: z.boolean(),
          blockingReasons: z.array(z.string().min(1)).optional(),
        }),
        qualitySignals: z.strictObject({
          coveredFieldIds: z.array(z.string()),
          coveredActionIds: z.array(z.string()),
          coveredValidationIds: z.array(z.string()),
          coveredNavigationIds: z.array(z.string()),
          confidence: z.number().min(0).max(1),
          ambiguity: z
            .strictObject({
              reason: z.string().min(1),
            })
            .optional(),
        }),
        reviewState: z.enum(REVIEW_STATES),
        audit: z.strictObject({
          jobId: z.string().min(1),
          generatedAt: z.string().regex(ISO_8601_PATTERN),
          contractVersion: z.literal(TEST_INTELLIGENCE_CONTRACT_VERSION),
          schemaVersion: z.literal(GENERATED_TEST_CASE_SCHEMA_VERSION),
          promptTemplateVersion: z.literal(
            TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
          ),
          redactionPolicyVersion: z.string().min(1),
          visualSidecarSchemaVersion: z.string().min(1),
          cacheHit: z.boolean(),
          cacheKey: z.string().min(1),
          inputHash: z.string().regex(SHA256_HEX_PATTERN),
          promptHash: z.string().regex(SHA256_HEX_PATTERN),
          schemaHash: z.string().regex(SHA256_HEX_PATTERN),
        }),
        regulatoryRelevance: z
          .strictObject({
            domain: z.enum(REGULATORY_DOMAINS),
            rationale: z.string().min(1).max(240),
          })
          .optional(),
      }),
    ),
  })
  .meta({
    id: GENERATED_TEST_CASE_LIST_SCHEMA_NAME,
    title: "GeneratedTestCaseList",
  });

export const buildGeneratedTestCaseListJsonSchemaFromZod = (): Record<
  string,
  unknown
> => {
  const schema = z.toJSONSchema(generatedTestCaseListZodSchema) as Record<
    string,
    unknown
  >;
  const rootId = schema["id"];
  if (typeof rootId === "string" && rootId.length > 0) {
    schema["$id"] = rootId;
    delete schema["id"];
  }
  return schema;
};
