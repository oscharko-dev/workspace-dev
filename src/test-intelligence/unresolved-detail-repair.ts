/**
 * Deterministic post-processor that repairs generated test cases which would
 * otherwise emit a `validation:unsupported_unresolved_validation_detail`
 * error — i.e. concrete numeric thresholds, exact validation messages, or
 * confirm/submit acceptance assertions in `title`, `objective`, `testData`,
 * `expectedResults`, or `steps[]` text while the source explicitly marks the underlying
 * validation/calculation rule as unresolved (Issue #2032).
 *
 * The repair is conservative and minimal:
 *
 *   - Only test cases that touch at least one unresolved validation
 *     constraint (per {@link deriveUnresolvedValidationConstraints}) are
 *     considered. Cases unrelated to unresolved scope are returned
 *     unchanged.
 *   - For each touching case, every entry in `testData` and
 *     `expectedResults` whose text classifies as `concrete_numeric_data`
 *     or `concrete_message_text` is removed. Visible UI labels and
 *     non-normative observations (`label_only`, `none`) are preserved so
 *     the case still has meaningful content.
 *   - `title`, `objective`, and step `action`/`expected` strings classified
 *     the same way are rewritten to conservative generic wording so the
 *     ordered test sequence remains exportable without inventing concrete
 *     validation behavior.
 *   - Step `expected` strings classified the same way are rewritten to
 *     {@link GENERIC_VALIDATION_EXPECTED_RESULT} so the ordered step
 *     sequence remains intact and the customer renderer still has a
 *     non-empty expectation per step.
 *   - Whenever a case is touched, the repair guarantees that the relevant
 *     unresolved evidence is reflected in `openQuestions`, deduplicated
 *     and capped at the soft limit used by the validator.
 *
 * The transform is pure and deterministic: identical inputs always yield
 * identical outputs, including the order of `changes`. Callers that need
 * an audit trail can persist the {@link UnresolvedDetailRepairResult.changes}
 * collection alongside the generated artifacts.
 */

import type {
  BusinessTestIntentIr,
  GeneratedTestCase,
  GeneratedTestCaseList,
  GeneratedTestCaseStep,
  MultiSourceTestIntentEnvelope,
  TestDesignModel,
  VisualScreenDescription,
  WorkflowTopology,
} from "../contracts/index.js";
import { buildTestDesignModel } from "./test-design-model.js";
import {
  GENERIC_VALIDATION_EXPECTED_RESULT,
  classifyUnresolvedValidationDetail,
  deriveUnresolvedValidationConstraints,
  testCaseTouchesUnresolvedConstraint,
  type UnresolvedValidationConstraint,
} from "./unresolved-validation-rules.js";

/** Maximum number of openQuestions kept on a repaired test case. Mirrors validator soft-limit. */
const OPEN_QUESTIONS_REPAIR_LIMIT = 25 as const;

/** Maximum length of a single appended openQuestion string. */
const OPEN_QUESTION_MAX_LENGTH = 600 as const;

/** Source label used when synthesizing missing openQuestions during repair. */
const REPAIR_OPEN_QUESTION_SOURCE_LABEL =
  "unresolved_validation_constraint" as const;

const GENERIC_UNRESOLVED_VALIDATION_TITLE =
  "Generischer Negativpfad für offene Fachregel" as const;

const GENERIC_UNRESOLVED_VALIDATION_OBJECTIVE =
  "Prüft den negativen Pfad anhand der dokumentierten offenen Fachregel, ohne konkrete Meldungen, Grenzwerte oder Rechenwerte zu behaupten." as const;

const GENERIC_UNRESOLVED_STEP_ACTION =
  "Führe den Prüfschritt mit fachlich geklärten Beispielwerten aus." as const;

export type UnresolvedDetailRepairKind =
  | "rewrote_title"
  | "rewrote_objective"
  | "removed_test_data"
  | "removed_expected_result"
  | "rewrote_step_action"
  | "rewrote_step_expected"
  | "added_open_question";

export interface UnresolvedDetailRepairChange {
  testCaseId: string;
  /** Path within the case relative to its root, mirroring the validator format. */
  path: string;
  kind: UnresolvedDetailRepairKind;
  /** Rationale derived from {@link classifyUnresolvedValidationDetail}. */
  reason: string;
  /** Original text snapshot (truncated to a safe length for audit). */
  before: string;
  /** Replacement text snapshot when the field was rewritten or appended. */
  after?: string;
}

export interface UnresolvedDetailRepairResult {
  list: GeneratedTestCaseList;
  changes: UnresolvedDetailRepairChange[];
}

export interface RepairUnresolvedDetailsInput {
  jobId: string;
  list: GeneratedTestCaseList;
  intent: BusinessTestIntentIr;
  workflowTopology?: WorkflowTopology;
  visual?: ReadonlyArray<VisualScreenDescription>;
  sourceEnvelope?: MultiSourceTestIntentEnvelope;
}

const SAFE_AUDIT_LENGTH = 240 as const;

const truncateForAudit = (value: string): string =>
  value.length <= SAFE_AUDIT_LENGTH
    ? value
    : `${value.slice(0, SAFE_AUDIT_LENGTH - 3)}...`;

const isConcreteUnsupportedClassification = (
  classification: ReturnType<typeof classifyUnresolvedValidationDetail>,
): boolean =>
  classification.classification === "concrete_numeric_data" ||
  classification.classification === "concrete_message_text";

const matchingConstraintsFor = (
  testCase: GeneratedTestCase,
  constraints: readonly UnresolvedValidationConstraint[],
): UnresolvedValidationConstraint[] =>
  constraints.filter((constraint) =>
    testCaseTouchesUnresolvedConstraint(testCase, constraint),
  );

const repairTestData = (
  testCase: GeneratedTestCase,
  changes: UnresolvedDetailRepairChange[],
): { testData: string[]; touched: boolean } => {
  const next: string[] = [];
  let touched = false;
  for (let index = 0; index < testCase.testData.length; index += 1) {
    const text = testCase.testData[index] ?? "";
    const classification = classifyUnresolvedValidationDetail(text);
    if (isConcreteUnsupportedClassification(classification)) {
      changes.push({
        testCaseId: testCase.id,
        path: `testData[${index}]`,
        kind: "removed_test_data",
        reason:
          classification.reason ??
          "concrete validation detail unsupported by unresolved source rule",
        before: truncateForAudit(text),
      });
      touched = true;
      continue;
    }
    next.push(text);
  }
  return { testData: next, touched };
};

const repairExpectedResults = (
  testCase: GeneratedTestCase,
  changes: UnresolvedDetailRepairChange[],
): { expectedResults: string[]; touched: boolean } => {
  const next: string[] = [];
  let touched = false;
  for (let index = 0; index < testCase.expectedResults.length; index += 1) {
    const text = testCase.expectedResults[index] ?? "";
    const classification = classifyUnresolvedValidationDetail(text);
    if (isConcreteUnsupportedClassification(classification)) {
      changes.push({
        testCaseId: testCase.id,
        path: `expectedResults[${index}]`,
        kind: "removed_expected_result",
        reason:
          classification.reason ??
          "concrete validation detail unsupported by unresolved source rule",
        before: truncateForAudit(text),
      });
      touched = true;
      continue;
    }
    next.push(text);
  }
  return { expectedResults: next, touched };
};

const repairScalarText = (input: {
  testCase: GeneratedTestCase;
  path: "title" | "objective";
  text: string;
  replacement: string;
  kind: Extract<
    UnresolvedDetailRepairKind,
    "rewrote_title" | "rewrote_objective"
  >;
  changes: UnresolvedDetailRepairChange[];
}): { text: string; touched: boolean } => {
  const classification = classifyUnresolvedValidationDetail(input.text);
  if (!isConcreteUnsupportedClassification(classification)) {
    return { text: input.text, touched: false };
  }
  input.changes.push({
    testCaseId: input.testCase.id,
    path: input.path,
    kind: input.kind,
    reason:
      classification.reason ??
      "concrete validation detail unsupported by unresolved source rule",
    before: truncateForAudit(input.text),
    after: input.replacement,
  });
  return { text: input.replacement, touched: true };
};

const repairSteps = (
  testCase: GeneratedTestCase,
  changes: UnresolvedDetailRepairChange[],
): { steps: GeneratedTestCaseStep[]; touched: boolean } => {
  const next: GeneratedTestCaseStep[] = [];
  let touched = false;
  for (let index = 0; index < testCase.steps.length; index += 1) {
    const step = testCase.steps[index];
    if (step === undefined) continue;
    const actionText = step.action;
    const expectedText = step.expected ?? "";
    const actionClassification = classifyUnresolvedValidationDetail(actionText);
    let nextStep: GeneratedTestCaseStep = step;
    if (isConcreteUnsupportedClassification(actionClassification)) {
      changes.push({
        testCaseId: testCase.id,
        path: `steps[${index}].action`,
        kind: "rewrote_step_action",
        reason:
          actionClassification.reason ??
          "concrete validation detail unsupported by unresolved source rule",
        before: truncateForAudit(actionText),
        after: GENERIC_UNRESOLVED_STEP_ACTION,
      });
      nextStep = { ...nextStep, action: GENERIC_UNRESOLVED_STEP_ACTION };
      touched = true;
    }
    if (expectedText.length === 0) {
      next.push(nextStep);
      continue;
    }
    const classification = classifyUnresolvedValidationDetail(expectedText);
    if (isConcreteUnsupportedClassification(classification)) {
      changes.push({
        testCaseId: testCase.id,
        path: `steps[${index}].expected`,
        kind: "rewrote_step_expected",
        reason:
          classification.reason ??
          "concrete validation detail unsupported by unresolved source rule",
        before: truncateForAudit(expectedText),
        after: GENERIC_VALIDATION_EXPECTED_RESULT,
      });
      next.push({ ...nextStep, expected: GENERIC_VALIDATION_EXPECTED_RESULT });
      touched = true;
      continue;
    }
    next.push(nextStep);
  }
  return { steps: next, touched };
};

const ensureOpenQuestions = (
  testCase: GeneratedTestCase,
  matchingConstraints: readonly UnresolvedValidationConstraint[],
  changes: UnresolvedDetailRepairChange[],
): string[] => {
  const existing = new Set(testCase.openQuestions);
  const next = [...testCase.openQuestions];
  for (const constraint of matchingConstraints) {
    if (next.length >= OPEN_QUESTIONS_REPAIR_LIMIT) break;
    const evidenceText = constraint.evidenceText.trim();
    if (evidenceText.length === 0) continue;
    const labeled = `${REPAIR_OPEN_QUESTION_SOURCE_LABEL}: ${evidenceText}`;
    const candidates: readonly string[] = [labeled, evidenceText];
    if (
      candidates.some((candidate) =>
        existing.has(candidate.slice(0, OPEN_QUESTION_MAX_LENGTH)),
      )
    ) {
      continue;
    }
    if (
      [...existing].some((entry) => entry.includes(evidenceText.slice(0, 80)))
    ) {
      continue;
    }
    const formatted = labeled.slice(0, OPEN_QUESTION_MAX_LENGTH);
    next.push(formatted);
    existing.add(formatted);
    changes.push({
      testCaseId: testCase.id,
      path: `openQuestions[${next.length - 1}]`,
      kind: "added_open_question",
      reason:
        "ensure unresolved evidence is captured after concrete detail removal",
      before: "",
      after: truncateForAudit(formatted),
    });
  }
  return next;
};

const repairCase = (
  testCase: GeneratedTestCase,
  constraints: readonly UnresolvedValidationConstraint[],
  changes: UnresolvedDetailRepairChange[],
): GeneratedTestCase => {
  const matching = matchingConstraintsFor(testCase, constraints);
  if (matching.length === 0) return testCase;

  const beforeChangeCount = changes.length;
  const titleResult = repairScalarText({
    testCase,
    path: "title",
    text: testCase.title,
    replacement: GENERIC_UNRESOLVED_VALIDATION_TITLE,
    kind: "rewrote_title",
    changes,
  });
  const objectiveResult = repairScalarText({
    testCase,
    path: "objective",
    text: testCase.objective,
    replacement: GENERIC_UNRESOLVED_VALIDATION_OBJECTIVE,
    kind: "rewrote_objective",
    changes,
  });
  const testDataResult = repairTestData(testCase, changes);
  const expectedResultsResult = repairExpectedResults(testCase, changes);
  const stepsResult = repairSteps(testCase, changes);

  const removedAnything =
    titleResult.touched ||
    objectiveResult.touched ||
    testDataResult.touched ||
    expectedResultsResult.touched ||
    stepsResult.touched;

  if (!removedAnything) return testCase;

  const openQuestions = ensureOpenQuestions(testCase, matching, changes);

  const repaired: GeneratedTestCase = {
    ...testCase,
    title: titleResult.text,
    objective: objectiveResult.text,
    testData: testDataResult.testData,
    expectedResults: expectedResultsResult.expectedResults,
    steps: stepsResult.steps,
    openQuestions,
  };

  // Sanity guard: if no concrete change was actually recorded (e.g. all
  // entries collapsed back to identical) the repair was a no-op.
  if (changes.length === beforeChangeCount) {
    return testCase;
  }

  return repaired;
};

const buildModel = (
  input: RepairUnresolvedDetailsInput,
): TestDesignModel =>
  buildTestDesignModel({
    jobId: input.jobId,
    intent: input.intent,
    ...(input.visual !== undefined ? { visual: input.visual } : {}),
    ...(input.sourceEnvelope !== undefined
      ? { sourceEnvelope: input.sourceEnvelope }
      : {}),
  });

/**
 * Apply the deterministic unresolved-detail repair to a generated test
 * case list. Returns the repaired list (cases without offending detail)
 * and the ordered set of {@link UnresolvedDetailRepairChange} entries
 * describing what was modified.
 *
 * If no unresolved validation constraints are derivable from the design
 * model, the input list is returned unchanged with an empty `changes`
 * array.
 */
export const repairUnresolvedValidationDetails = (
  input: RepairUnresolvedDetailsInput,
): UnresolvedDetailRepairResult => {
  const model = buildModel(input);
  const constraints = deriveUnresolvedValidationConstraints(model);
  if (constraints.length === 0) {
    return { list: input.list, changes: [] };
  }
  const changes: UnresolvedDetailRepairChange[] = [];
  const repairedCases = input.list.testCases.map((testCase) =>
    repairCase(testCase, constraints, changes),
  );
  if (changes.length === 0) {
    return { list: input.list, changes: [] };
  }
  return {
    list: { ...input.list, testCases: repairedCases },
    changes,
  };
};
