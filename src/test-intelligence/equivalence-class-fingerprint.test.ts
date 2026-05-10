import assert from "node:assert/strict";
import test from "node:test";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type GeneratedTestCase,
} from "../contracts/index.js";
import {
  buildEquivalenceClassFingerprint,
  deriveOraclePolarity,
  detectExactNearDuplicateText,
  detectIntraClassRedundancy,
  equivalenceClassKey,
  levenshteinCapped,
  type IntraClassBoundaryClassifier,
} from "./equivalence-class-fingerprint.js";

const ZERO = "0000000000000000000000000000000000000000000000000000000000000000";

const buildCase = (
  overrides: Partial<GeneratedTestCase>,
): GeneratedTestCase => ({
  id: "tc",
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "title",
  objective: "obj",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "regulated_data",
  technique: "equivalence_partitioning",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: "do something", expected: "ok" }],
  expectedResults: ["ok"],
  figmaTraceRefs: [{ screenId: "s-1", nodePath: "root/form" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: ["fld-iban"],
    coveredActionIds: ["act-submit"],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.9,
  },
  reviewState: "draft",
  audit: {
    jobId: "job-1",
    generatedAt: "2026-04-25T10:00:00.000Z",
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
  ...overrides,
});

test("Issue #2123: fingerprint sorts and de-duplicates covered ids", () => {
  const fp = buildEquivalenceClassFingerprint(
    buildCase({
      qualitySignals: {
        coveredFieldIds: ["b", "a", "a"],
        coveredActionIds: ["z", "y", "z"],
        coveredValidationIds: [],
        coveredNavigationIds: [],
        confidence: 0.9,
      },
    }),
  );
  assert.deepEqual(fp.coveredFieldIds, ["a", "b"]);
  assert.deepEqual(fp.coveredActionIds, ["y", "z"]);
});

test("Issue #2123: equivalenceClassKey is byte-stable across id ordering", () => {
  const left = buildCase({
    id: "tc-a",
    qualitySignals: {
      coveredFieldIds: ["f-1", "f-2"],
      coveredActionIds: ["a-1"],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: 1,
    },
  });
  const right = buildCase({
    id: "tc-b",
    qualitySignals: {
      coveredFieldIds: ["f-2", "f-1"],
      coveredActionIds: ["a-1"],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: 1,
    },
  });
  assert.equal(
    equivalenceClassKey(buildEquivalenceClassFingerprint(left)),
    equivalenceClassKey(buildEquivalenceClassFingerprint(right)),
  );
});

test("Issue #2123: oracle polarity collapses validation onto negative", () => {
  const negative = buildCase({ type: "negative", id: "n" });
  const validation = buildCase({ type: "validation", id: "v" });
  const positive = buildCase({ type: "functional", id: "p" });
  assert.equal(deriveOraclePolarity(negative), "negative");
  assert.equal(deriveOraclePolarity(validation), "negative");
  assert.equal(deriveOraclePolarity(positive), "positive");
  // Persisted polarity (Issue #2030) takes precedence over type fallback
  const persisted = buildCase({
    type: "functional",
    id: "x",
    polarity: "boundary",
  });
  assert.equal(deriveOraclePolarity(persisted), "boundary");
});

test("Issue #2123: redundant case in same class with no distinct coverage is flagged", () => {
  // Two cases differing only in cosmetic title (the historical
  // "Enter IBAN DE89..." vs "Enter IBAN AT..." regression).
  const a = buildCase({
    id: "tc-a",
    title: "Enter IBAN DE89 0000 0000 0000",
  });
  const b = buildCase({
    id: "tc-b",
    title: "Enter IBAN AT00 0000 0000 0000",
  });
  const result = detectIntraClassRedundancy({ testCases: [a, b] });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]?.representativeTestCaseId, "tc-a");
  assert.equal(result.findings[0]?.redundantTestCaseId, "tc-b");
  assert.equal(result.findings[0]?.source, "deterministic");
  assert.equal(result.redundantCount, 1);
  assert.equal(result.totalCases, 2);
  assert.equal(result.classCount, 1);
  assert.ok(result.redundancyRatio > 0);
});

test("Issue #2123: identical text with different action subset is NOT redundant", () => {
  const a = buildCase({
    id: "tc-a",
    qualitySignals: {
      coveredFieldIds: ["fld"],
      coveredActionIds: ["act-submit"],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: 0.9,
    },
  });
  const b = buildCase({
    id: "tc-b",
    qualitySignals: {
      coveredFieldIds: ["fld"],
      coveredActionIds: ["act-submit", "act-cancel"],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: 0.9,
    },
  });
  const result = detectIntraClassRedundancy({ testCases: [a, b] });
  // Different action subsets → SAME equivalence class only when sorted
  // sets are equal. Here they differ, so they fall into DIFFERENT
  // classes and no redundancy is reported.
  assert.equal(result.findings.length, 0);
  assert.equal(result.classCount, 2);
});

test("Issue #2123: same class but different state path is NOT redundant", () => {
  const a = buildCase({
    id: "tc-a",
    figmaTraceRefs: [{ screenId: "s-1", nodePath: "root/form" }],
  });
  const b = buildCase({
    id: "tc-b",
    figmaTraceRefs: [{ screenId: "s-1", nodePath: "root/details" }],
  });
  const result = detectIntraClassRedundancy({ testCases: [a, b] });
  assert.equal(result.findings.length, 0);
});

test("Issue #2123: same class but different oracle category is NOT redundant", () => {
  // Same fingerprint axes, but distinct persisted category.
  const a = buildCase({
    id: "tc-a",
    type: "functional",
    category: "positive_path",
  });
  const b = buildCase({
    id: "tc-b",
    type: "functional",
    category: "validation_rule",
  });
  const result = detectIntraClassRedundancy({ testCases: [a, b] });
  assert.equal(result.findings.length, 0);
});

test("Issue #2123: boundary classifier can VETO a deterministic redundancy verdict", () => {
  const calls: Array<string> = [];
  const classifier: IntraClassBoundaryClassifier = {
    identifier: "phi-4-mini-instruct@stub",
    classify: ({ candidate }) => {
      calls.push(candidate.id);
      return "keep";
    },
  };
  const a = buildCase({
    id: "tc-a",
    type: "boundary",
    technique: "boundary_value_analysis",
    title: "Boundary IBAN length 22",
    openQuestions: ["Is the IBAN length cap 22 or 34?"],
  });
  const b = buildCase({
    id: "tc-b",
    type: "boundary",
    technique: "boundary_value_analysis",
    title: "Boundary IBAN length 23",
    openQuestions: ["Is the IBAN length cap 22 or 34?"],
  });
  const without = detectIntraClassRedundancy({ testCases: [a, b] });
  assert.equal(without.findings.length, 1);
  const withClassifier = detectIntraClassRedundancy({
    testCases: [a, b],
    boundaryClassifier: classifier,
  });
  assert.equal(withClassifier.findings.length, 0);
  assert.deepEqual(calls, ["tc-b"]);
});

test("Issue #2123: boundary classifier 'redundant' verdict records source=deterministic+classifier", () => {
  const classifier: IntraClassBoundaryClassifier = {
    identifier: "phi-4-mini-instruct@stub",
    classify: () => "redundant",
  };
  const a = buildCase({
    id: "tc-a",
    type: "boundary",
    technique: "boundary_value_analysis",
    title: "Boundary IBAN length 22",
    openQuestions: ["edge"],
  });
  const b = buildCase({
    id: "tc-b",
    type: "boundary",
    technique: "boundary_value_analysis",
    title: "Boundary IBAN length 23",
    openQuestions: ["edge"],
  });
  const result = detectIntraClassRedundancy({
    testCases: [a, b],
    boundaryClassifier: classifier,
  });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]?.source, "deterministic+classifier");
});

test("Issue #2123: classifier is NOT consulted when deterministic logic keeps the case", () => {
  let invoked = 0;
  const classifier: IntraClassBoundaryClassifier = {
    identifier: "phi-4-mini-instruct@stub",
    classify: () => {
      invoked += 1;
      return "redundant";
    },
  };
  const a = buildCase({
    id: "tc-a",
    type: "functional",
    figmaTraceRefs: [{ screenId: "s-1", nodePath: "root/form" }],
  });
  const b = buildCase({
    id: "tc-b",
    type: "functional",
    figmaTraceRefs: [{ screenId: "s-1", nodePath: "root/details" }],
  });
  const result = detectIntraClassRedundancy({
    testCases: [a, b],
    boundaryClassifier: classifier,
  });
  assert.equal(result.findings.length, 0);
  assert.equal(invoked, 0);
});

test("Issue #2123: A/B/A pattern marks the third case redundant when it collapses back onto an earlier kept case", () => {
  const a = buildCase({
    id: "tc-a",
    figmaTraceRefs: [{ screenId: "s-1", nodePath: "root/form" }],
  });
  const b = buildCase({
    id: "tc-b",
    figmaTraceRefs: [{ screenId: "s-1", nodePath: "root/details" }],
  });
  const c = buildCase({
    id: "tc-c",
    figmaTraceRefs: [{ screenId: "s-1", nodePath: "root/form" }],
  });
  const result = detectIntraClassRedundancy({ testCases: [a, b, c] });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]?.representativeTestCaseId, "tc-a");
  assert.equal(result.findings[0]?.redundantTestCaseId, "tc-c");
});

test("Issue #2123: empty input yields zero ratio and no findings", () => {
  const result = detectIntraClassRedundancy({ testCases: [] });
  assert.equal(result.findings.length, 0);
  assert.equal(result.totalCases, 0);
  assert.equal(result.classCount, 0);
  assert.equal(result.redundancyRatio, 0);
});

test("Issue #2123: single-case input never produces a finding", () => {
  const result = detectIntraClassRedundancy({
    testCases: [buildCase({ id: "tc-only" })],
  });
  assert.equal(result.findings.length, 0);
  assert.equal(result.classCount, 1);
});

test("Issue #2123: levenshteinCapped short-circuits beyond cap", () => {
  assert.equal(levenshteinCapped("abc", "abc", 2), 0);
  assert.equal(levenshteinCapped("abc", "abd", 2), 1);
  assert.equal(levenshteinCapped("abc", "xyz", 2), 3);
  assert.equal(levenshteinCapped("", "abcdef", 2), 3);
  assert.equal(levenshteinCapped("kitten", "sitting", 2), 3);
  assert.throws(() => levenshteinCapped("a", "b", -1), RangeError);
});

test("Issue #2123: detectExactNearDuplicateText flags Levenshtein-2 pairs", () => {
  const a = buildCase({
    id: "tc-a",
    title: "Enter IBAN value",
    steps: [{ index: 1, action: "Type the IBAN" }],
  });
  const b = buildCase({
    id: "tc-b",
    title: "Enter IBAN value.",
    steps: [{ index: 1, action: "Type the IBAN" }],
  });
  const c = buildCase({
    id: "tc-c",
    title: "Different title entirely",
    steps: [{ index: 1, action: "A wholly different action body" }],
  });
  const findings = detectExactNearDuplicateText({ testCases: [a, b, c] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.leftTestCaseId, "tc-a");
  assert.equal(findings[0]?.rightTestCaseId, "tc-b");
  assert.ok((findings[0]?.characterDistance ?? Number.POSITIVE_INFINITY) <= 2);
});

test("Issue #2123: detectExactNearDuplicateText respects the configured budget", () => {
  const a = buildCase({ id: "tc-a", title: "alpha" });
  const b = buildCase({ id: "tc-b", title: "alpaca" });
  // Distance is 2, so the default budget catches the pair.
  assert.equal(detectExactNearDuplicateText({ testCases: [a, b] }).length, 1);
  // Budget 0 (disabled) returns nothing; the validator wires this off
  // when callers set `exactNearDuplicateTextDistance` to 0.
  assert.equal(
    detectExactNearDuplicateText({ testCases: [a, b], distance: 0 }).length,
    0,
  );
});

test("Issue #2123: redundancy findings are sorted deterministically", () => {
  const cases: GeneratedTestCase[] = [];
  for (const id of ["tc-z", "tc-y", "tc-x", "tc-w"]) {
    cases.push(buildCase({ id }));
  }
  const result = detectIntraClassRedundancy({ testCases: cases });
  // 4 cases, same class → 3 redundant findings (against tc-w as representative).
  assert.equal(result.findings.length, 3);
  const ids = result.findings.map((f) => f.redundantTestCaseId);
  assert.deepEqual(ids, ["tc-x", "tc-y", "tc-z"]);
  for (const f of result.findings) {
    assert.equal(f.representativeTestCaseId, "tc-w");
  }
});
