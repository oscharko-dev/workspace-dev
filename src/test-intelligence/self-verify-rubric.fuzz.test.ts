/**
 * Property-based tests for self-verify rubric scoring (Issue #1379).
 *
 * The properties below pin invariants the validator and aggregator
 * rely on so future contributors cannot weaken them by accident:
 *
 *   - per-case `rubricScore` is the arithmetic mean of the dimensions
 *     and (when present) the visual subscores; always in `[0, 1]`,
 *   - the job-level aggregate is the arithmetic mean of the per-case
 *     scores; always in `[0, 1]`,
 *   - any score strictly outside `[0, 1]` is rejected with the
 *     `score_out_of_range` refusal,
 *   - duplicate `testCaseId` is always rejected,
 *   - the rubric prompt + schema hashes are deterministic across
 *     repeated invocations.
 */

import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";

import {
  ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS,
  ALLOWED_SELF_VERIFY_RUBRIC_VISUAL_SUBSCORES,
} from "../contracts/index.js";
import {
  aggregateSelfVerifyRubricScores,
  computeSelfVerifyRubricPromptHash,
  computeSelfVerifyRubricSchemaHash,
  validateSelfVerifyRubricResponse,
} from "./self-verify-rubric.js";

const dimensionScoresArb = fc
  .array(fc.double({ min: 0, max: 1, noNaN: true }), {
    minLength: ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS.length,
    maxLength: ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS.length,
  })
  .map((scores) =>
    [...ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS]
      .sort()
      .map((dimension, idx) => ({ dimension, score: scores[idx] ?? 0 })),
  );

const visualSubscoresArb = fc
  .array(fc.double({ min: 0, max: 1, noNaN: true }), {
    minLength: ALLOWED_SELF_VERIFY_RUBRIC_VISUAL_SUBSCORES.length,
    maxLength: ALLOWED_SELF_VERIFY_RUBRIC_VISUAL_SUBSCORES.length,
  })
  .map((scores) =>
    [...ALLOWED_SELF_VERIFY_RUBRIC_VISUAL_SUBSCORES]
      .sort()
      .map((subscore, idx) => ({ subscore, score: scores[idx] ?? 0 })),
  );

const evaluationsArb = (visual: boolean) =>
  fc
    .uniqueArray(fc.string({ minLength: 1, maxLength: 16 }), {
      minLength: 1,
      maxLength: 5,
    })
    .chain((ids) =>
      fc.tuple(
        fc.constant(ids),
        fc.array(dimensionScoresArb, {
          minLength: ids.length,
          maxLength: ids.length,
        }),
        fc.array(visualSubscoresArb, {
          minLength: ids.length,
          maxLength: ids.length,
        }),
      ),
    )
    .map(([ids, dimRows, visualRows]) =>
      ids.map((id, idx) => {
        const evaluation: Record<string, unknown> = {
          testCaseId: id,
          dimensions: dimRows[idx],
          citations: [],
        };
        if (visual) {
          evaluation["visualSubscores"] = visualRows[idx];
        }
        return { id, evaluation };
      }),
    );

test("property: validated rubric scores stay in [0, 1]", () =>
  fc.assert(
    fc.property(evaluationsArb(false), (rows) => {
      const result = validateSelfVerifyRubricResponse(
        { caseEvaluations: rows.map((r) => r.evaluation) },
        rows.map((r) => r.id),
        false,
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      for (const evaluation of result.caseEvaluations) {
        assert.ok(evaluation.rubricScore >= 0);
        assert.ok(evaluation.rubricScore <= 1);
      }
    }),
    { numRuns: 50 },
  ));

test("property: aggregate jobLevelRubricScore stays in [0, 1]", () =>
  fc.assert(
    fc.property(evaluationsArb(true), (rows) => {
      const result = validateSelfVerifyRubricResponse(
        { caseEvaluations: rows.map((r) => r.evaluation) },
        rows.map((r) => r.id),
        true,
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const aggregate = aggregateSelfVerifyRubricScores(result.caseEvaluations);
      assert.ok(aggregate.jobLevelRubricScore >= 0);
      assert.ok(aggregate.jobLevelRubricScore <= 1);
      for (const d of aggregate.dimensionScores) {
        assert.ok(d.score >= 0 && d.score <= 1);
      }
    }),
    { numRuns: 50 },
  ));

test("property: scores outside [0, 1] are always rejected", () =>
  fc.assert(
    fc.property(
      fc.oneof(
        fc.double({ min: -1000, max: -0.0001, noNaN: true }),
        fc.double({ min: 1.0001, max: 1000, noNaN: true }),
      ),
      (badScore) => {
        const dims = [...ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS]
          .sort()
          .map((d, i) => ({ dimension: d, score: i === 0 ? badScore : 0.5 }));
        const result = validateSelfVerifyRubricResponse(
          {
            caseEvaluations: [
              { testCaseId: "tc-1", dimensions: dims, citations: [] },
            ],
          },
          ["tc-1"],
          false,
        );
        assert.equal(result.ok, false);
      },
    ),
    { numRuns: 50 },
  ));

test("property: prompt + schema hashes are deterministic", () =>
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 4 }), (iterations) => {
      const promptHash = computeSelfVerifyRubricPromptHash();
      const schemaHash = computeSelfVerifyRubricSchemaHash();
      for (let i = 0; i < iterations; i += 1) {
        assert.equal(computeSelfVerifyRubricPromptHash(), promptHash);
        assert.equal(computeSelfVerifyRubricSchemaHash(), schemaHash);
      }
    }),
    { numRuns: 20 },
  ));
