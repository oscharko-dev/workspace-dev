/**
 * Duplicate detection for generated test cases (Issue #1364).
 *
 * Two test cases are considered "duplicate-like" when their canonical
 * fingerprint sets exceed a Jaccard similarity threshold. The fingerprint
 * combines title shingles, normalised step actions, and trace screen ids
 * so that two cases that exercise the same path under different cosmetic
 * wording are flagged.
 *
 * The implementation is pure and dependency-free: it operates on
 * `GeneratedTestCase` arrays and produces a deterministic list of pairs.
 */

import type {
  GeneratedTestCase,
  TestCaseDuplicatePair,
} from "../contracts/index.js";

const SHINGLE_SIZE = 3;

/**
 * Build a canonical fingerprint set for a test case.
 *
 * - Title is normalised (lowercased, whitespace-collapsed) and split into
 *   3-character shingles to surface near-duplicates with cosmetic edits.
 * - Step actions are stripped of step-index prefixes and combined as
 *   tokens.
 * - Trace screen ids contribute as `trace::<id>` markers so two cases on
 *   different screens diverge even when wording is identical.
 */
export const buildTestCaseFingerprint = (
  testCase: GeneratedTestCase,
): Set<string> => {
  const tokens = new Set<string>();
  for (const shingle of toShingles(normaliseString(testCase.title))) {
    tokens.add(`title::${shingle}`);
  }
  for (const step of testCase.steps) {
    const normalised = normaliseString(step.action);
    if (normalised.length === 0) continue;
    for (const t of normalised.split(" ")) {
      if (t.length > 0) tokens.add(`step::${t}`);
    }
  }
  for (const trace of testCase.figmaTraceRefs) {
    tokens.add(`trace::${trace.screenId}`);
  }
  tokens.add(`type::${testCase.type}`);
  tokens.add(`risk::${testCase.riskCategory}`);
  return tokens;
};

const normaliseString = (input: string): string => {
  return input
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const toShingles = (input: string): string[] => {
  if (input.length === 0) return [];
  if (input.length <= SHINGLE_SIZE) return [input];
  const out: string[] = [];
  for (let i = 0; i + SHINGLE_SIZE <= input.length; i++) {
    out.push(input.slice(i, i + SHINGLE_SIZE));
  }
  return out;
};

/** Jaccard similarity between two fingerprint sets in [0, 1]. */
export const jaccardSimilarity = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = smaller === a ? b : a;
  for (const v of smaller) {
    if (larger.has(v)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
};

/**
 * Detect duplicate-like pairs above the similarity threshold.
 *
 * Pairs are emitted in (left.id, right.id) lexical order; the list itself
 * is sorted to keep the report deterministic across runs.
 */
export const detectDuplicateTestCases = (input: {
  testCases: ReadonlyArray<GeneratedTestCase>;
  threshold: number;
}): TestCaseDuplicatePair[] => {
  if (input.threshold < 0 || input.threshold > 1) {
    throw new RangeError("threshold must be in [0, 1]");
  }
  const cases = input.testCases;
  const fingerprints = new Map<string, Set<string>>();
  for (const tc of cases) {
    fingerprints.set(tc.id, buildTestCaseFingerprint(tc));
  }
  const pairs: TestCaseDuplicatePair[] = [];
  for (let i = 0; i < cases.length; i++) {
    const left = cases[i];
    if (left === undefined) continue;
    const fpLeft = fingerprints.get(left.id);
    if (fpLeft === undefined) continue;
    for (let j = i + 1; j < cases.length; j++) {
      const right = cases[j];
      if (right === undefined) continue;
      const fpRight = fingerprints.get(right.id);
      if (fpRight === undefined) continue;
      const similarity = jaccardSimilarity(fpLeft, fpRight);
      if (similarity >= input.threshold) {
        const [a, b] =
          left.id <= right.id ? [left.id, right.id] : [right.id, left.id];
        pairs.push({
          leftTestCaseId: a,
          rightTestCaseId: b,
          similarity: roundTo(similarity, 6),
        });
      }
    }
  }
  pairs.sort((a, b) => {
    if (a.leftTestCaseId !== b.leftTestCaseId) {
      return a.leftTestCaseId < b.leftTestCaseId ? -1 : 1;
    }
    if (a.rightTestCaseId !== b.rightTestCaseId) {
      return a.rightTestCaseId < b.rightTestCaseId ? -1 : 1;
    }
    return 0;
  });
  return pairs;
};

const roundTo = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
