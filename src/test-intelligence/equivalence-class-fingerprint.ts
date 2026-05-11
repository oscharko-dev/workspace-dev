/**
 * Semantic equivalence-class fingerprint and intra-class redundancy
 * verification for generated test cases (Issue #2123).
 *
 * The previous validator path detected duplicates with a token-level
 * Jaccard / shingle similarity (see {@link
 * "./test-case-duplicate.ts" buildTestCaseFingerprint}). That signal is
 * retained as an auxiliary "exact-near-duplicate" warning, but it is
 * NOT the primary equivalence check anymore: two cases that differ in
 * a handful of characters but exercise the same equivalence class were
 * silently accepted, while two cases identical at character level but
 * covering different states were flagged as duplicates.
 *
 * This module replaces the equivalence check with a deterministic
 * fingerprint over `(coveredFieldIds, coveredActionIds, riskClass,
 * technique, oraclePolarity)`. Within a single equivalence class, every
 * case must add REAL coverage — a different oracle category, a
 * different action subset, or a different state path. Cases that fail
 * that distinctness test produce
 * {@link IntraEquivalenceClassRedundancyFinding} entries which the
 * validation pipeline surfaces as
 * `intra_equivalence_class_redundancy` warnings.
 *
 * Optionally, callers can wire a low-cost
 * {@link IntraClassBoundaryClassifier} (Issue #2123 / #2099 — phi-4-mini-instruct
 * is the canonical first-pass model). The classifier is only consulted
 * for boundary cases the deterministic logic flags as ambiguous, and
 * its verdict can ONLY downgrade a deterministic `redundant` decision
 * to `keep` — the deterministic logic vetoes false negatives. The
 * classifier is therefore strictly optional and the pipeline stays
 * fully air-gapped without it.
 */

import type {
  EquivalenceClassFingerprint,
  GeneratedTestCase,
  TestCaseOraclePolarity,
  TestCaseRiskCategory,
  TestCaseTechnique29119,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

/**
 * Derive the oracle polarity of a generated case (Issue #2123).
 *
 * Resolution order:
 *  1. Honour the persisted {@link GeneratedTestCase.polarity} (Issue #2030)
 *     when it maps to a fingerprint axis. `validation` collapses to
 *     `negative` because both polarities expect the system to reject the
 *     input — they share the equivalence-class semantics.
 *  2. Otherwise fall back to the case `type` discriminator using the
 *     same collapse so older 1.0.0 / 1.1.0 emissions classify
 *     consistently with 1.2.0+ ones.
 */
export const deriveOraclePolarity = (
  testCase: GeneratedTestCase,
): TestCaseOraclePolarity => {
  if (testCase.polarity !== undefined) {
    switch (testCase.polarity) {
      case "positive":
        return "positive";
      case "negative":
      case "validation":
        return "negative";
      case "boundary":
        return "boundary";
      case "navigation":
        return "navigation";
      case "accessibility":
        return "accessibility";
    }
  }
  switch (testCase.type) {
    case "negative":
    case "validation":
      return "negative";
    case "boundary":
      return "boundary";
    case "navigation":
      return "navigation";
    case "accessibility":
      return "accessibility";
    case "functional":
    case "regression":
    case "exploratory":
      return "positive";
  }
};

const sortedUnique = (ids: ReadonlyArray<string>): string[] => {
  const out = Array.from(new Set(ids));
  out.sort();
  return out;
};

/**
 * Build the canonical equivalence-class fingerprint for a single case.
 * Two cases share the same equivalence class iff
 * {@link equivalenceClassKey} returns the same string for both.
 */
export const buildEquivalenceClassFingerprint = (
  testCase: GeneratedTestCase,
): EquivalenceClassFingerprint => ({
  coveredFieldIds: sortedUnique(testCase.qualitySignals.coveredFieldIds),
  coveredActionIds: sortedUnique(testCase.qualitySignals.coveredActionIds),
  riskClass: testCase.riskCategory,
  technique: testCase.technique,
  oraclePolarity: deriveOraclePolarity(testCase),
});

/**
 * Canonical-JSON serialisation of a fingerprint. Equal fingerprints
 * always serialise to byte-equal strings, which makes the key safe to
 * use as a `Map` key, snapshot field, or audit record.
 */
export const equivalenceClassKey = (
  fingerprint: EquivalenceClassFingerprint,
): string => canonicalJson(fingerprint);

/**
 * Reasons two cases in the same equivalence class are considered
 * DISTINCT (i.e. both add real coverage). The validator marks a case
 * redundant when none of these reasons apply against any earlier case
 * in its class.
 */
export const ALLOWED_INTRA_CLASS_DISTINCTNESS_REASONS = [
  "different_oracle_category",
  "different_action_subset",
  "different_state_path",
] as const;
export type IntraClassDistinctnessReason =
  (typeof ALLOWED_INTRA_CLASS_DISTINCTNESS_REASONS)[number];

/**
 * Verdict shape returned by an optional boundary classifier
 * (Issue #2123 / #2099, phi-4-mini-instruct first-pass).
 *
 * The classifier is consulted only when deterministic logic is
 * ambiguous — i.e. it considered the case redundant but the case
 * carries a non-empty `assumptions` or `openQuestions` list, or its
 * fingerprint sits on a partition boundary (`boundary` polarity AND
 * `boundary_value_analysis` technique). The classifier's verdict is
 * advisory: a `keep` verdict downgrades the deterministic flag to a
 * non-warning, but a `redundant` verdict cannot upgrade a deterministic
 * `keep` — deterministic logic vetoes the model.
 */
export type IntraClassBoundaryVerdict = "keep" | "redundant";

/**
 * Optional boundary classifier hook. Implementations are caller-supplied
 * and may route through `phi-4-mini-instruct` (per Issue #2099) or any
 * other first-pass model. The hook is invoked synchronously and MUST
 * be deterministic given identical inputs — the validator caches its
 * verdicts by `(representativeTestCaseId, candidateTestCaseId)`.
 */
export interface IntraClassBoundaryClassifier {
  readonly identifier: string;
  classify(input: {
    representative: GeneratedTestCase;
    candidate: GeneratedTestCase;
    fingerprint: EquivalenceClassFingerprint;
  }): IntraClassBoundaryVerdict;
}

const sameSet = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean => {
  if (left.length !== right.length) return false;
  const set = new Set(left);
  for (const value of right) {
    if (!set.has(value)) return false;
  }
  return true;
};

const oracleCategory = (testCase: GeneratedTestCase): string => {
  if (testCase.category !== undefined) return testCase.category;
  switch (testCase.type) {
    case "negative":
      return "negative_path";
    case "validation":
      return "validation_rule";
    case "boundary":
      return "boundary_value";
    case "navigation":
      return "navigation_flow";
    case "accessibility":
      return "accessibility";
    case "functional":
    case "regression":
      return "positive_path";
    case "exploratory":
      return `exploratory:${testCase.technique}`;
  }
};

const stepActionSequence = (testCase: GeneratedTestCase): string[] =>
  [...testCase.steps]
    .sort((a, b) => a.index - b.index)
    .map((step) => step.action.trim());

const tracePathSet = (testCase: GeneratedTestCase): string[] => {
  const set = new Set<string>();
  for (const trace of testCase.figmaTraceRefs) {
    const path = trace.nodePath ?? trace.nodeId ?? trace.screenId;
    set.add(`${trace.screenId}::${path}`);
  }
  return Array.from(set).sort();
};

const lifecycleTransitionSet = (testCase: GeneratedTestCase): string[] => {
  const set = new Set<string>();
  for (const step of testCase.steps) {
    if (step.fieldLifecycleTransitionId !== undefined) {
      set.add(step.fieldLifecycleTransitionId);
    }
  }
  return Array.from(set).sort();
};

const isAmbiguousBoundary = (
  fingerprint: EquivalenceClassFingerprint,
  candidate: GeneratedTestCase,
): boolean => {
  if (
    fingerprint.oraclePolarity === "boundary" &&
    fingerprint.technique === "boundary_value_analysis"
  ) {
    return true;
  }
  return candidate.assumptions.length > 0 || candidate.openQuestions.length > 0;
};

const distinctnessReason = (
  representative: GeneratedTestCase,
  candidate: GeneratedTestCase,
): IntraClassDistinctnessReason | undefined => {
  if (oracleCategory(representative) !== oracleCategory(candidate)) {
    return "different_oracle_category";
  }
  if (
    !sameSet(
      representative.qualitySignals.coveredActionIds,
      candidate.qualitySignals.coveredActionIds,
    )
  ) {
    return "different_action_subset";
  }
  const repTraces = tracePathSet(representative);
  const candTraces = tracePathSet(candidate);
  if (!sameSet(repTraces, candTraces)) return "different_state_path";
  const repLife = lifecycleTransitionSet(representative);
  const candLife = lifecycleTransitionSet(candidate);
  if (!sameSet(repLife, candLife)) return "different_state_path";
  const repSteps = stepActionSequence(representative).join("␟");
  const candSteps = stepActionSequence(candidate).join("␟");
  if (repSteps !== candSteps) return "different_state_path";
  return undefined;
};

/** One redundant-case finding emitted by the intra-class detector. */
export interface IntraEquivalenceClassRedundancyFinding {
  readonly equivalenceClassKey: string;
  readonly representativeTestCaseId: string;
  readonly redundantTestCaseId: string;
  readonly fingerprint: EquivalenceClassFingerprint;
  readonly riskClass: TestCaseRiskCategory;
  readonly technique: TestCaseTechnique29119;
  readonly oraclePolarity: TestCaseOraclePolarity;
  /** Reason the case was deemed redundant; mirrors the validator path. */
  readonly reason: "no_distinct_coverage";
  /**
   * `"deterministic"` when the deterministic distinctness check alone
   * decided redundancy. `"deterministic+classifier"` when an optional
   * boundary classifier was consulted and concurred. `"keep"` is never
   * surfaced here — only redundant cases produce findings.
   */
  readonly source: "deterministic" | "deterministic+classifier";
}

/** Aggregate result of {@link detectIntraClassRedundancy}. */
export interface IntraClassRedundancyOutcome {
  readonly findings: IntraEquivalenceClassRedundancyFinding[];
  /** Total number of cases inspected (including the unique class representatives). */
  readonly totalCases: number;
  /** Number of distinct equivalence classes observed. */
  readonly classCount: number;
  /** Cases marked redundant. Equal to `findings.length`. */
  readonly redundantCount: number;
  /**
   * Redundancy ratio in `[0, 1]`. `0` when `totalCases === 0` so empty
   * inputs do not trip downstream gates. Rounded to six digits to keep
   * persistence byte-stable.
   */
  readonly redundancyRatio: number;
}

export interface DetectIntraClassRedundancyInput {
  readonly testCases: ReadonlyArray<GeneratedTestCase>;
  /**
   * Optional first-pass classifier (e.g. phi-4-mini-instruct). When
   * supplied, the classifier is only consulted for ambiguous boundary
   * cases AFTER the deterministic logic has flagged redundancy. A
   * classifier verdict of `"keep"` overrides the deterministic flag and
   * the case is preserved; a `"redundant"` verdict is recorded with
   * `source: "deterministic+classifier"`.
   */
  readonly boundaryClassifier?: IntraClassBoundaryClassifier;
}

const roundTo = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/**
 * Detect intra-class redundancy across a list of generated test cases.
 *
 * The algorithm groups cases by {@link equivalenceClassKey}. Within each
 * class the first case (by stable id ordering) is the representative;
 * every subsequent case is required to add real coverage relative to
 * EVERY prior kept case. If it collapses back onto any earlier kept
 * case, it is recorded as redundant; otherwise it is added to the kept
 * set so subsequent cases must differ from it too.
 */
export const detectIntraClassRedundancy = (
  input: DetectIntraClassRedundancyInput,
): IntraClassRedundancyOutcome => {
  const cases = [...input.testCases].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  const buckets = new Map<
    string,
    { fingerprint: EquivalenceClassFingerprint; cases: GeneratedTestCase[] }
  >();

  for (const tc of cases) {
    const fingerprint = buildEquivalenceClassFingerprint(tc);
    const key = equivalenceClassKey(fingerprint);
    const existing = buckets.get(key);
    if (existing === undefined) {
      buckets.set(key, { fingerprint, cases: [tc] });
    } else {
      existing.cases.push(tc);
    }
  }

  const findings: IntraEquivalenceClassRedundancyFinding[] = [];

  for (const [key, bucket] of buckets) {
    if (bucket.cases.length < 2) continue;
    const kept: GeneratedTestCase[] = [bucket.cases[0]!];
    for (let i = 1; i < bucket.cases.length; i += 1) {
      const candidate = bucket.cases[i]!;
      let collapsesIntoPrior = false;
      for (const prior of kept) {
        if (distinctnessReason(prior, candidate) === undefined) {
          collapsesIntoPrior = true;
          break;
        }
      }
      if (!collapsesIntoPrior) {
        kept.push(candidate);
        continue;
      }
      const representative = kept[0]!;
      let source: "deterministic" | "deterministic+classifier" =
        "deterministic";
      if (
        input.boundaryClassifier !== undefined &&
        isAmbiguousBoundary(bucket.fingerprint, candidate)
      ) {
        const verdict = input.boundaryClassifier.classify({
          representative,
          candidate,
          fingerprint: bucket.fingerprint,
        });
        if (verdict === "keep") {
          // Classifier vetoes the redundancy verdict — keep the case
          // and require subsequent candidates to differ from it too.
          kept.push(candidate);
          continue;
        }
        source = "deterministic+classifier";
      }
      findings.push({
        equivalenceClassKey: key,
        representativeTestCaseId: representative.id,
        redundantTestCaseId: candidate.id,
        fingerprint: bucket.fingerprint,
        riskClass: bucket.fingerprint.riskClass,
        technique: bucket.fingerprint.technique,
        oraclePolarity: bucket.fingerprint.oraclePolarity,
        reason: "no_distinct_coverage",
        source,
      });
    }
  }

  findings.sort((a, b) => {
    if (a.equivalenceClassKey !== b.equivalenceClassKey) {
      return a.equivalenceClassKey < b.equivalenceClassKey ? -1 : 1;
    }
    if (a.representativeTestCaseId !== b.representativeTestCaseId) {
      return a.representativeTestCaseId < b.representativeTestCaseId ? -1 : 1;
    }
    return a.redundantTestCaseId < b.redundantTestCaseId ? -1 : 1;
  });

  const totalCases = input.testCases.length;
  return {
    findings,
    totalCases,
    classCount: buckets.size,
    redundantCount: findings.length,
    redundancyRatio:
      totalCases === 0 ? 0 : roundTo(findings.length / totalCases, 6),
  };
};

/**
 * Levenshtein character-edit distance between two strings, capped at
 * {@link cap}. The cap short-circuits the row computation: when every
 * cell on a row exceeds the cap the distance is at LEAST `cap + 1`, so
 * the function returns `cap + 1` early and avoids quadratic work for
 * obviously distant strings. This keeps the validator linear in
 * practice on long step bodies.
 */
export const levenshteinCapped = (
  left: string,
  right: string,
  cap: number,
): number => {
  if (cap < 0) {
    throw new RangeError("levenshteinCapped: cap must be >= 0");
  }
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > cap) return cap + 1;
  if (left.length === 0) return Math.min(right.length, cap + 1);
  if (right.length === 0) return Math.min(left.length, cap + 1);

  const m = left.length;
  const n = right.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    let rowMin = curr[0]!;
    const lo = Math.max(1, i - cap);
    const hi = Math.min(n, i + cap);
    if (lo > 1) curr[lo - 1] = cap + 1;
    for (let j = lo; j <= hi; j += 1) {
      const cost = left.charCodeAt(i - 1) === right.charCodeAt(j - 1) ? 0 : 1;
      const del = (prev[j] ?? cap + 1) + 1;
      const ins = (curr[j - 1] ?? cap + 1) + 1;
      const sub = (prev[j - 1] ?? cap + 1) + cost;
      const v = Math.min(del, ins, sub);
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (hi < n) curr[hi + 1] = cap + 1;
    if (rowMin > cap) return cap + 1;
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return Math.min(prev[n] ?? cap + 1, cap + 1);
};

const canonicalCaseText = (testCase: GeneratedTestCase): string => {
  const parts: string[] = [testCase.title.trim().toLowerCase()];
  for (const step of [...testCase.steps].sort((a, b) => a.index - b.index)) {
    parts.push(step.action.trim().toLowerCase());
  }
  return parts.join("\n");
};

/** One finding emitted by {@link detectExactNearDuplicateText}. */
export interface ExactNearDuplicateTextFinding {
  readonly leftTestCaseId: string;
  readonly rightTestCaseId: string;
  readonly characterDistance: number;
}

/**
 * Detect exact-near-duplicate TEXT pairs (Issue #2123).
 *
 * Pairs whose canonicalised `(title, ordered step actions)` text differs
 * by AT MOST {@link distance} characters under the
 * {@link levenshteinCapped} metric are flagged. The default budget of
 * `2` matches the Levenshtein-2 contract preserved from the original
 * detector; callers may supply a different budget per profile. The
 * result is sorted lexicographically by `(left, right)` for byte-stable
 * persistence.
 */
export const detectExactNearDuplicateText = (input: {
  readonly testCases: ReadonlyArray<GeneratedTestCase>;
  readonly distance?: number;
}): ExactNearDuplicateTextFinding[] => {
  const cap = input.distance ?? 2;
  if (cap < 0) {
    throw new RangeError("detectExactNearDuplicateText: distance must be >= 0");
  }
  const findings: ExactNearDuplicateTextFinding[] = [];
  const cases = input.testCases;
  const texts: string[] = cases.map(canonicalCaseText);
  for (let i = 0; i < cases.length; i += 1) {
    for (let j = i + 1; j < cases.length; j += 1) {
      const left = cases[i]!;
      const right = cases[j]!;
      const distance = levenshteinCapped(texts[i]!, texts[j]!, cap);
      if (distance <= cap) {
        const [lo, hi] =
          left.id <= right.id ? [left.id, right.id] : [right.id, left.id];
        findings.push({
          leftTestCaseId: lo,
          rightTestCaseId: hi,
          characterDistance: distance,
        });
      }
    }
  }
  findings.sort((a, b) => {
    if (a.leftTestCaseId !== b.leftTestCaseId) {
      return a.leftTestCaseId < b.leftTestCaseId ? -1 : 1;
    }
    return a.rightTestCaseId < b.rightTestCaseId ? -1 : 1;
  });
  return findings;
};
