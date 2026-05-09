import {
  TEST_DATA_ORACLE_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
} from "../contracts/index.js";
import {
  formatOracleValueAsTestDataEntry,
  isDeterministicTestDataRule,
  oracleValueNeedsLegacyRedactionMarker,
  resolveTestData,
  type OracleResolution,
  SYNTHETIC_ORACLE_NOTE,
} from "./test-data-oracle.js";

const DEFAULT_ORACLE_ANCHOR = "2026-05-09T00:00:00.000Z" as const;
const OPEN_QUESTION_LIMIT = 25 as const;
const OPEN_QUESTION_PREFIX = "test-data oracle: " as const;

interface OracleFieldRecord {
  readonly fieldId: string;
  readonly fieldLabel: string;
  readonly governed: boolean;
  readonly unresolvedRules: readonly string[];
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
  readonly oracleProvenance?: readonly OracleSyntheticProvenanceEntry[];
  readonly provenance: readonly string[];
}

export interface OracleSyntheticProvenanceEntry {
  readonly testDataEntry: string;
  readonly synthetic: true;
  readonly note: typeof SYNTHETIC_ORACLE_NOTE;
  readonly legacyRedactionMarker: boolean;
}

export interface OracleProvenanceContext {
  readonly byTestDataIndex: Readonly<Record<number, OracleSyntheticProvenanceEntry>>;
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
  readonly oracleProvenanceContext?: OracleProvenanceContext;
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

const uniqueOracleProvenanceEntries = (
  entries: readonly OracleSyntheticProvenanceEntry[],
): OracleSyntheticProvenanceEntry[] => {
  const seen = new Set<string>();
  const out: OracleSyntheticProvenanceEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.testDataEntry)) continue;
    seen.add(entry.testDataEntry);
    out.push(entry);
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
): readonly OracleSyntheticProvenanceEntry[] => {
  const toEntry = (
    value: (typeof resolution.valid)[number],
  ): OracleSyntheticProvenanceEntry => {
    const testDataEntry = formatOracleValueAsTestDataEntry(fieldLabel, value);
    return {
      testDataEntry,
      synthetic: value.synthetic,
      note: SYNTHETIC_ORACLE_NOTE,
      legacyRedactionMarker: oracleValueNeedsLegacyRedactionMarker(value),
    };
  };
  if (testCase.type === "negative" || testCase.type === "validation") {
    return resolution.invalid.map(toEntry);
  }
  if (testCase.type === "boundary") {
    return [...resolution.valid.map(toEntry), ...resolution.invalid.map(toEntry)];
  }
  return resolution.valid.map(toEntry);
};

const governsEntryForField = (entry: string, fieldLabel: string): boolean =>
  entry.startsWith(`${fieldLabel}:`);

export const buildTestDataOracleGovernanceContext = (input: {
  intent: BusinessTestIntentIr;
  generatedAt: string;
}): TestDataOracleGovernanceContext => {
  const now = resolveOracleNow(input.generatedAt);
  const rulesByFieldId = collectRulesByFieldId(input.intent);
  const byFieldId = new Map<string, OracleFieldRecord>();
  for (const field of input.intent.detectedFields) {
    const validations = rulesByFieldId.get(field.id) ?? [];
    const significantRules = validations.filter(
      (rule) => !isPresenceOnlyRule(rule),
    );
    const governed = significantRules.length > 0;
    const unresolvedRules = significantRules.filter(
      (rule) => !isDeterministicTestDataRule({ rule, now }),
    );
    byFieldId.set(field.id, {
      fieldId: field.id,
      fieldLabel: field.label,
      governed,
      unresolvedRules,
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
  const authoritativeEntries: OracleSyntheticProvenanceEntry[] = [];
  const authoritativeOpenQuestions: string[] = [];
  const provenance: string[] = [];
  const seenFieldIds = new Set<string>();

  for (const fieldId of input.testCase.qualitySignals.coveredFieldIds) {
    if (seenFieldIds.has(fieldId)) continue;
    seenFieldIds.add(fieldId);
    const fieldRecord = input.context.byFieldId.get(fieldId);
    if (fieldRecord === undefined || !fieldRecord.governed) continue;
    if (fieldRecord.resolution.resolvable) {
      const oracleProvenance = testDataEntriesFor(
        input.testCase,
        fieldRecord.fieldLabel,
        fieldRecord.resolution,
      );
      resolvedFields.push({
        fieldId,
        fieldLabel: fieldRecord.fieldLabel,
        testDataEntries: oracleProvenance.map((entry) => entry.testDataEntry),
        oracleProvenance,
        provenance: fieldRecord.resolution.provenance,
      });
      authoritativeEntries.push(...oracleProvenance);
      provenance.push(...fieldRecord.resolution.provenance);
    }
    if (fieldRecord.resolution.resolvable && fieldRecord.unresolvedRules.length > 0) {
      const openQuestion =
        `${OPEN_QUESTION_PREFIX}Field "${fieldRecord.fieldLabel}" has additional unresolved validation rules: ${fieldRecord.unresolvedRules.join("; ")}`;
      unresolvedFields.push({
        fieldId,
        fieldLabel: fieldRecord.fieldLabel,
        openQuestion,
      });
      authoritativeOpenQuestions.push(openQuestion);
      continue;
    }
    if (!fieldRecord.resolution.resolvable) {
      const openQuestion = `${OPEN_QUESTION_PREFIX}${fieldRecord.resolution.openQuestion}`;
      unresolvedFields.push({
        fieldId,
        fieldLabel: fieldRecord.fieldLabel,
        openQuestion,
      });
      authoritativeOpenQuestions.push(openQuestion);
    }
  }

  const uniqueAuthoritativeEntries = uniqueOracleProvenanceEntries(
    authoritativeEntries,
  );
  const authoritativeTestData = uniqueAuthoritativeEntries.map(
    (entry) => entry.testDataEntry,
  );
  const oracleProvenanceContext =
    uniqueAuthoritativeEntries.length === 0
      ? undefined
      : {
          byTestDataIndex: Object.freeze(
            Object.fromEntries(
              uniqueAuthoritativeEntries.map((entry, index) => [index, entry]),
            ),
          ),
        };

  return {
    testCaseId: input.testCase.id,
    authoritativeTestData,
    authoritativeOpenQuestions: uniqueStrings(authoritativeOpenQuestions),
    ...(oracleProvenanceContext !== undefined
      ? { oracleProvenanceContext }
      : {}),
    oracleResolvedFields: resolvedFields,
    oracleUnresolvedFields: unresolvedFields,
    provenance: uniqueStrings(provenance),
  };
};

const appendOracleOpenQuestions = (
  existing: readonly string[],
  required: readonly string[],
): string[] => {
  const requiredUnique = uniqueStrings(required);
  const existingWithoutRequired = existing.filter(
    (entry) => !requiredUnique.includes(entry),
  );
  const budget = Math.max(0, OPEN_QUESTION_LIMIT - requiredUnique.length);
  return uniqueStrings([
    ...existingWithoutRequired.slice(0, budget),
    ...requiredUnique,
  ]);
};

const preserveNonOracleTestData = (
  testCase: GeneratedTestCase,
  governedLabels: readonly string[],
): string[] =>
  testCase.testData.filter(
    (entry) =>
      !governedLabels.some((fieldLabel) => governsEntryForField(entry, fieldLabel)),
  );

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
    const preservedTestData = preserveNonOracleTestData(
      testCase,
      [
        ...projection.oracleResolvedFields.map((field) => field.fieldLabel),
        ...projection.oracleUnresolvedFields.map((field) => field.fieldLabel),
      ],
    );
    return {
      ...testCase,
      testData: [...preservedTestData, ...projection.authoritativeTestData],
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
