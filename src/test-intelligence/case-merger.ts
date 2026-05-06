import type {
  GeneratedTestCase,
  GeneratedTestCaseList,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

const buildSemanticIdentity = (testCase: GeneratedTestCase): string =>
  canonicalJson({
    title: testCase.title,
    objective: testCase.objective,
    type: testCase.type,
    priority: testCase.priority,
    riskCategory: testCase.riskCategory,
    level: testCase.level,
    technique: testCase.technique,
    preconditions: testCase.preconditions,
    testData: testCase.testData,
    steps: testCase.steps,
    expectedResults: testCase.expectedResults,
    figmaTraceRefs: testCase.figmaTraceRefs,
    assumptions: testCase.assumptions,
    openQuestions: testCase.openQuestions,
    regulatoryRelevance: testCase.regulatoryRelevance,
    qualitySignals: testCase.qualitySignals,
  });

export const mergeGeneratedTestCaseLists = (
  lists: readonly [GeneratedTestCaseList, GeneratedTestCaseList],
): GeneratedTestCaseList => {
  const [primary, secondary] = lists;
  if (primary.jobId !== secondary.jobId) {
    throw new RangeError(
      "mergeGeneratedTestCaseLists: lists must share the same jobId",
    );
  }
  if (primary.schemaVersion !== secondary.schemaVersion) {
    throw new RangeError(
      "mergeGeneratedTestCaseLists: lists must share the same schemaVersion",
    );
  }

  const seen = new Set<string>();
  const merged: GeneratedTestCase[] = [];
  for (const list of lists) {
    for (const testCase of list.testCases) {
      const identity = buildSemanticIdentity(testCase);
      if (seen.has(identity)) {
        continue;
      }
      seen.add(identity);
      merged.push(testCase);
    }
  }
  merged.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    schemaVersion: primary.schemaVersion,
    jobId: primary.jobId,
    testCases: merged,
  };
};
