import {
  TEST_DATA_ORACLE_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
} from "../contracts/index.js";
import {
  formatOracleValueAsTestDataEntry,
  resolveTestData,
  type OracleResolution,
} from "./test-data-oracle.js";

const DEFAULT_ORACLE_ANCHOR = "2026-05-09T00:00:00.000Z" as const;
const OPEN_QUESTION_LIMIT = 25 as const;
const OPEN_QUESTION_PREFIX = "test-data oracle: " as const;

interface OracleFieldRecord {
  readonly fieldId: string;
  readonly fieldLabel: string;
  readonly governed: boolean;
  readonly resolution: OracleResolution;
}

export interface TestDataOracleGovernanceContext {
  readonly now: Date;
  readonly byFieldId: ReadonlyMap<string, OracleFieldRecord>;
}

export interface TestDataOracleResolvedFieldReport {
  readonly fieldId: string;
  readonly fieldLabel: string;
  readonly testDataEntries: readonly string[];
  readonly provenance: readonly string[];
}

export interface TestDataOracleUnresolvedFieldReport {
  readonly fieldId: string;
  readonly fieldLabel: string;
  readonly openQuestion: string;
}

export interface TestDataOracleCaseProjection {
  readonly testCaseId: string;
  readonly authoritativeTestData: readonly string[];
  readonly authoritativeOpenQuestions: readonly string[];
  readonly oracleResolvedFields: readonly TestDataOracleResolvedFieldReport[];
  readonly oracleUnresolvedFields: readonly TestDataOracleUnresolvedFieldReport[];
  readonly provenance: readonly string[];
}

export interface TestDataOracleReport {
  readonly schemaVersion: typeof TEST_DATA_ORACLE_REPORT_SCHEMA_VERSION;
  readonly contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  readonly jobId: string;
  readonly generatedAt: string;
  readonly oracleSeed: string;
  readonly cases: readonly TestDataOracleCaseProjection[];
}

export interface ApplyDeterministicTestDataOracleResult {
  readonly list: GeneratedTestCaseList;
  readonly report: TestDataOracleReport;
}

const uniqueStrings = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
};

const PRESENCE_ONLY_RULES: ReadonlySet<string> = new Set([
  "required",
  "pflichtfeld",
  "optional",
  "pflichtfeld, numerisch",
]);

const isPresenceOnlyRule = (rule: string): boolean =>
  PRESENCE_ONLY_RULES.has(rule.trim().toLowerCase());

const resolveOracleNow = (generatedAt: string): Date => {
  const candidate = new Date(generatedAt);
  if (Number.isNaN(candidate.getTime())) {
    return new Date(DEFAULT_ORACLE_ANCHOR);
  }
  return candidate;
};

const collectRulesByFieldId = (
  intent: BusinessTestIntentIr,
): ReadonlyMap<string, readonly string[]> => {
  const byFieldId = new Map<string, string[]>();
  for (const validation of intent.detectedValidations) {
    if (validation.targetFieldId === undefined) continue;
    const existing = byFieldId.get(validation.targetFieldId) ?? [];
    existing.push(validation.rule);
    byFieldId.set(validation.targetFieldId, existing);
  }
  return byFieldId;
};

const testDataEntriesFor = (
  testCase: GeneratedTestCase,
  fieldLabel: string,
  resolution: Extract<OracleResolution, { resolvable: true }>,
): readonly string[] => {
  const toEntry = (value: (typeof resolution.valid)[number]): string =>
    formatOracleValueAsTestDataEntry(fieldLabel, value);
  if (testCase.type === "negative" || testCase.type === "validation") {
    return resolution.invalid.map(toEntry);
  }
  if (testCase.type === "boundary") {
    return [...resolution.valid.map(toEntry), ...resolution.invalid.map(toEntry)];
  }
  return resolution.valid.map(toEntry);
};

export const buildTestDataOracleGovernanceContext = (input: {
  intent: BusinessTestIntentIr;
  generatedAt: string;
}): TestDataOracleGovernanceContext => {
  const now = resolveOracleNow(input.generatedAt);
  const rulesByFieldId = collectRulesByFieldId(input.intent);
  const byFieldId = new Map<string, OracleFieldRecord>();
  for (const field of input.intent.detectedFields) {
    const validations = rulesByFieldId.get(field.id) ?? [];
    const governed =
      validations.filter((rule) => !isPresenceOnlyRule(rule)).length > 0;
    byFieldId.set(field.id, {
      fieldId: field.id,
      fieldLabel: field.label,
      governed,
      resolution: resolveTestData({
        fieldLabel: field.label,
        validations,
        ...(field.defaultValue !== undefined
          ? { defaultValue: field.defaultValue }
          : {}),
        now,
      }),
    });
  }
  return { now, byFieldId };
};

export const projectTestDataOracleCase = (input: {
  testCase: GeneratedTestCase;
  context: TestDataOracleGovernanceContext;
}): TestDataOracleCaseProjection => {
  const resolvedFields: TestDataOracleResolvedFieldReport[] = [];
  const unresolvedFields: TestDataOracleUnresolvedFieldReport[] = [];
  const authoritativeTestData: string[] = [];
  const authoritativeOpenQuestions: string[] = [];
  const provenance: string[] = [];
  const seenFieldIds = new Set<string>();

  for (const fieldId of input.testCase.qualitySignals.coveredFieldIds) {
    if (seenFieldIds.has(fieldId)) continue;
    seenFieldIds.add(fieldId);
    const fieldRecord = input.context.byFieldId.get(fieldId);
    if (fieldRecord === undefined || fieldRecord.governed !== true) continue;
    if (fieldRecord.resolution.resolvable) {
      const testDataEntries = testDataEntriesFor(
        input.testCase,
        fieldRecord.fieldLabel,
        fieldRecord.resolution,
      );
      resolvedFields.push({
        fieldId,
        fieldLabel: fieldRecord.fieldLabel,
        testDataEntries,
        provenance: fieldRecord.resolution.provenance,
      });
      authoritativeTestData.push(...testDataEntries);
      provenance.push(...fieldRecord.resolution.provenance);
      continue;
    }
    const openQuestion = `${OPEN_QUESTION_PREFIX}${fieldRecord.resolution.openQuestion}`;
    unresolvedFields.push({
      fieldId,
      fieldLabel: fieldRecord.fieldLabel,
      openQuestion,
    });
    authoritativeOpenQuestions.push(openQuestion);
  }

  return {
    testCaseId: input.testCase.id,
    authoritativeTestData: uniqueStrings(authoritativeTestData),
    authoritativeOpenQuestions: uniqueStrings(authoritativeOpenQuestions),
    oracleResolvedFields: resolvedFields,
    oracleUnresolvedFields: unresolvedFields,
    provenance: uniqueStrings(provenance),
  };
};

const appendOracleOpenQuestions = (
  existing: readonly string[],
  required: readonly string[],
): string[] => uniqueStrings([...existing, ...required]).slice(0, OPEN_QUESTION_LIMIT);

export const applyDeterministicTestDataOracle = (input: {
  jobId: string;
  generatedAt: string;
  list: GeneratedTestCaseList;
  intent: BusinessTestIntentIr;
}): ApplyDeterministicTestDataOracleResult => {
  if (!Array.isArray(input.list.testCases)) {
    return {
      list: input.list,
      report: {
        schemaVersion: TEST_DATA_ORACLE_REPORT_SCHEMA_VERSION,
        contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
        jobId: input.jobId,
        generatedAt: input.generatedAt,
        oracleSeed: resolveOracleNow(input.generatedAt).toISOString(),
        cases: [],
      },
    };
  }
  const context = buildTestDataOracleGovernanceContext({
    intent: input.intent,
    generatedAt: input.generatedAt,
  });
  const reportCases: TestDataOracleCaseProjection[] = [];
  const governedCases = input.list.testCases.map((testCase) => {
    const projection = projectTestDataOracleCase({ testCase, context });
    const governsCase =
      projection.oracleResolvedFields.length > 0 ||
      projection.oracleUnresolvedFields.length > 0;
    if (governsCase) {
      reportCases.push(projection);
    }
    if (!governsCase) return testCase;
    return {
      ...testCase,
      testData: [...projection.authoritativeTestData],
      openQuestions: appendOracleOpenQuestions(
        testCase.openQuestions,
        projection.authoritativeOpenQuestions,
      ),
    };
  });

  return {
    list: { ...input.list, testCases: governedCases },
    report: {
      schemaVersion: TEST_DATA_ORACLE_REPORT_SCHEMA_VERSION,
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      jobId: input.jobId,
      generatedAt: input.generatedAt,
      oracleSeed: context.now.toISOString(),
      cases: reportCases,
    },
  };
};
