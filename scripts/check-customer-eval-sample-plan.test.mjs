import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOMER_EVAL_DIR,
  NON_UPDATE_NOTE_FILE,
  RUBRIC_FILES,
  SAMPLE_PLAN_FILE,
  diffRangeArgs,
  evaluateCustomerEvalSamplePlanUpdate,
  isCustomerEvalRubricFile,
  parseArgs,
} from "./check-customer-eval-sample-plan.mjs";

test("customer-eval sample-plan gate: skips when no rubric file changed", () => {
  const result = evaluateCustomerEvalSamplePlanUpdate(["README.md"]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.rubricFilesChanged, []);
  assert.equal(result.samplePlanChanged, false);
  assert.equal(result.nonUpdateNoteChanged, false);
});

test("customer-eval sample-plan gate: passes when rubric and sample plan both change", () => {
  const result = evaluateCustomerEvalSamplePlanUpdate([
    RUBRIC_FILES[0],
    SAMPLE_PLAN_FILE,
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.samplePlanChanged, true);
  assert.equal(result.nonUpdateNoteChanged, false);
});

test("customer-eval sample-plan gate: passes when rubric and non-update note both change", () => {
  const result = evaluateCustomerEvalSamplePlanUpdate([
    RUBRIC_FILES[1],
    NON_UPDATE_NOTE_FILE,
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.samplePlanChanged, false);
  assert.equal(result.nonUpdateNoteChanged, true);
});

test("customer-eval sample-plan gate: fails when rubric changes alone", () => {
  const result = evaluateCustomerEvalSamplePlanUpdate([RUBRIC_FILES[0]]);
  assert.equal(result.ok, false);
  assert.match(
    result.reason,
    /fixtures\/test-intelligence\/customer-evals\/ without updating SAMPLE-PLAN\.md/u,
  );
});

test("customer-eval sample-plan gate: treats any file under the customer-evals folder as a rubric change", () => {
  assert.equal(
    isCustomerEvalRubricFile(`${CUSTOMER_EVAL_DIR}Future-Rubric.md`),
    true,
  );
  assert.equal(isCustomerEvalRubricFile(SAMPLE_PLAN_FILE), false);
  assert.equal(isCustomerEvalRubricFile(NON_UPDATE_NOTE_FILE), false);

  const result = evaluateCustomerEvalSamplePlanUpdate([
    `${CUSTOMER_EVAL_DIR}Future-Rubric.md`,
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.rubricFilesChanged, [
    `${CUSTOMER_EVAL_DIR}Future-Rubric.md`,
  ]);
});

test("customer-eval sample-plan gate: parses supported args", () => {
  assert.deepEqual(
    parseArgs(["--", "--base", "origin/dev", "--head", "HEAD", "--merge-base"]),
    {
      base: "origin/dev",
      head: "HEAD",
      mergeBase: true,
    },
  );
});

test("customer-eval sample-plan gate: rejects unknown args", () => {
  assert.throws(() => parseArgs(["--wat"]), /Unknown argument/u);
});

test("customer-eval sample-plan gate: defaults diff range to HEAD^..HEAD", () => {
  assert.deepEqual(diffRangeArgs({}), ["HEAD^", "HEAD"]);
  assert.deepEqual(diffRangeArgs({ base: "origin/dev" }), [
    "origin/dev",
    "HEAD",
  ]);
  assert.deepEqual(diffRangeArgs({ base: "abc", head: "def" }), [
    "abc",
    "def",
  ]);
  assert.deepEqual(
    diffRangeArgs({ base: "origin/dev", head: "HEAD", mergeBase: true }),
    ["origin/dev...HEAD"],
  );
});
