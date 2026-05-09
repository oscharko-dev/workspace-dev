/**
 * Unit tests for the cross-field invariant engine (Issue #2110).
 *
 * Coverage targets:
 *
 *   - Every AST node kind evaluates correctly under representative
 *     valuations (comparison, arithmetic, conditional/implies).
 *   - The evaluator surfaces vacuous truth via the `vacuous` flag.
 *   - Registry validation rejects malformed invariants (id pattern,
 *     anchor coverage, BVA seed shape, seed/AST disagreement, missing
 *     non-vacuous positive seed).
 *   - {@link synthesizeCrossFieldTestData} returns positive-then-negative
 *     ordering and stable label sort.
 *   - {@link evaluateValuationAgainstInvariant} carries one violation
 *     row per anchor and threads citation + severity intact.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  collectInvariantFieldRefs,
  createCrossFieldInvariantRegistry,
  evaluateBoolExpr,
  evaluateInvariantExpression,
  evaluateNumberExpr,
  evaluateValuationAgainstInvariant,
  synthesizeCrossFieldTestData,
  type CrossFieldInvariant,
  type InvariantBoolExpr,
  type InvariantNumberExpr,
} from "./cross-field-invariant-engine.js";

const num = (value: number): InvariantNumberExpr => ({
  kind: "number_lit",
  value,
});

const fnum = (fieldRef: string): InvariantNumberExpr => ({
  kind: "field_number",
  fieldRef,
});

const buildSampleInvariant = (
  overrides: Partial<CrossFieldInvariant> = {},
): CrossFieldInvariant => ({
  id: "XINV-TEST-DTI-01",
  scope: "screen",
  description: "Sample DTI test invariant",
  expression: {
    kind: "lte",
    left: fnum("monthly"),
    right: {
      kind: "mul",
      left: num(0.6),
      right: fnum("annual"),
    },
  },
  severity: "error",
  citation: { framework: "Test", citation: "Test Citation §1" },
  anchors: [
    {
      screenId: "s-loan",
      elementId: "fld-monthly",
      fieldRef: "monthly",
    },
    {
      screenId: "s-loan",
      elementId: "fld-annual",
      fieldRef: "annual",
    },
  ],
  bvaSeeds: [
    {
      label: "below cap",
      values: { monthly: "100", annual: "1000" },
      expectedSatisfied: true,
      rationale: "100 ≤ 0.6 × 1000",
    },
    {
      label: "above cap",
      values: { monthly: "700", annual: "1000" },
      expectedSatisfied: false,
      rationale: "700 > 0.6 × 1000",
    },
  ],
  source: "Issue #2110 (registered)",
  ...overrides,
});

void test("evaluateNumberExpr handles arithmetic, min/max, and division", () => {
  const valuation = { a: "5", b: "2" };
  assert.equal(
    evaluateNumberExpr(
      { kind: "add", left: fnum("a"), right: fnum("b") },
      valuation,
    ),
    7,
  );
  assert.equal(
    evaluateNumberExpr(
      { kind: "sub", left: fnum("a"), right: fnum("b") },
      valuation,
    ),
    3,
  );
  assert.equal(
    evaluateNumberExpr(
      { kind: "mul", left: fnum("a"), right: fnum("b") },
      valuation,
    ),
    10,
  );
  assert.equal(
    evaluateNumberExpr(
      { kind: "div", left: fnum("a"), right: fnum("b") },
      valuation,
    ),
    2.5,
  );
  assert.equal(
    evaluateNumberExpr(
      { kind: "min", left: fnum("a"), right: fnum("b") },
      valuation,
    ),
    2,
  );
  assert.equal(
    evaluateNumberExpr(
      { kind: "max", left: fnum("a"), right: fnum("b") },
      valuation,
    ),
    5,
  );
});

void test("evaluateNumberExpr throws on division by zero", () => {
  assert.throws(
    () =>
      evaluateNumberExpr(
        { kind: "div", left: num(1), right: num(0) },
        {},
      ),
    /division by zero/i,
  );
});

void test("evaluateNumberExpr throws on missing or non-numeric field", () => {
  assert.throws(
    () => evaluateNumberExpr(fnum("missing"), {}),
    /missing/i,
  );
  assert.throws(
    () => evaluateNumberExpr(fnum("a"), { a: "abc" }),
    /non-numeric/i,
  );
});

void test("evaluateBoolExpr covers all comparison kinds", () => {
  const v = { x: "5", y: "5", z: "10" };
  const cases: Array<[InvariantBoolExpr, boolean]> = [
    [{ kind: "lt", left: fnum("x"), right: fnum("z") }, true],
    [{ kind: "lt", left: fnum("x"), right: fnum("y") }, false],
    [{ kind: "lte", left: fnum("x"), right: fnum("y") }, true],
    [{ kind: "gt", left: fnum("z"), right: fnum("x") }, true],
    [{ kind: "gte", left: fnum("y"), right: fnum("x") }, true],
    [{ kind: "eq_number", left: fnum("x"), right: fnum("y") }, true],
    [
      {
        kind: "eq_number",
        left: fnum("x"),
        right: num(5.0001),
        tolerance: 0.001,
      },
      true,
    ],
    [
      {
        kind: "eq_number",
        left: fnum("x"),
        right: num(5.5),
        tolerance: 0.1,
      },
      false,
    ],
  ];
  for (const [expr, expected] of cases) {
    assert.equal(
      evaluateBoolExpr(expr, v).satisfied,
      expected,
      `expected ${JSON.stringify(expr)} => ${expected}`,
    );
  }
});

void test("evaluateBoolExpr eq_number rejects negative tolerance", () => {
  assert.throws(
    () =>
      evaluateBoolExpr(
        {
          kind: "eq_number",
          left: num(1),
          right: num(1),
          tolerance: -0.1,
        },
        {},
      ),
    /tolerance/i,
  );
});

void test("evaluateBoolExpr handles string ops and field presence", () => {
  const v = { name: "Alice", role: "ADMIN", currency: "" };
  assert.equal(
    evaluateBoolExpr(
      {
        kind: "eq_string",
        left: { kind: "field_string", fieldRef: "name" },
        right: { kind: "string_lit", value: "Alice" },
      },
      v,
    ).satisfied,
    true,
  );
  assert.equal(
    evaluateBoolExpr(
      {
        kind: "eq_string",
        left: { kind: "field_string", fieldRef: "role" },
        right: { kind: "string_lit", value: "admin" },
        caseInsensitive: true,
      },
      v,
    ).satisfied,
    true,
  );
  assert.equal(
    evaluateBoolExpr(
      {
        kind: "in_set_string",
        value: { kind: "field_string", fieldRef: "role" },
        set: ["admin", "user"],
        caseInsensitive: true,
      },
      v,
    ).satisfied,
    true,
  );
  assert.equal(
    evaluateBoolExpr(
      {
        kind: "matches_regex",
        value: { kind: "field_string", fieldRef: "name" },
        pattern: "^A",
      },
      v,
    ).satisfied,
    true,
  );
  assert.equal(
    evaluateBoolExpr({ kind: "field_present", fieldRef: "name" }, v).satisfied,
    true,
  );
  assert.equal(
    evaluateBoolExpr({ kind: "field_absent", fieldRef: "currency" }, v)
      .satisfied,
    true,
  );
  assert.equal(
    evaluateBoolExpr({ kind: "field_present", fieldRef: "currency" }, v)
      .satisfied,
    false,
  );
});

void test("evaluateBoolExpr composes and / or / not / implies with vacuous flag", () => {
  const v = { a: "1", b: "2" };
  // and: short-circuits on first false
  assert.deepEqual(
    evaluateBoolExpr(
      {
        kind: "and",
        operands: [
          { kind: "lt", left: fnum("a"), right: fnum("b") },
          { kind: "gt", left: fnum("a"), right: fnum("b") },
        ],
      },
      v,
    ),
    { satisfied: false, vacuous: false },
  );
  // implies vacuous when antecedent false
  assert.deepEqual(
    evaluateBoolExpr(
      {
        kind: "implies",
        antecedent: { kind: "gt", left: fnum("a"), right: fnum("b") },
        consequent: { kind: "lt", left: fnum("a"), right: fnum("b") },
      },
      v,
    ),
    { satisfied: true, vacuous: true },
  );
  // implies non-vacuous when antecedent true
  assert.deepEqual(
    evaluateBoolExpr(
      {
        kind: "implies",
        antecedent: { kind: "lt", left: fnum("a"), right: fnum("b") },
        consequent: { kind: "lt", left: fnum("a"), right: fnum("b") },
      },
      v,
    ),
    { satisfied: true, vacuous: false },
  );
  // not flips satisfaction
  assert.deepEqual(
    evaluateBoolExpr(
      {
        kind: "not",
        operand: { kind: "lt", left: fnum("a"), right: fnum("b") },
      },
      v,
    ),
    { satisfied: false, vacuous: false },
  );
});

void test("collectInvariantFieldRefs returns sorted unique refs", () => {
  const refs = collectInvariantFieldRefs({
    kind: "and",
    operands: [
      { kind: "lt", left: fnum("z"), right: fnum("a") },
      { kind: "field_present", fieldRef: "m" },
      {
        kind: "eq_string",
        left: { kind: "field_string", fieldRef: "z" },
        right: { kind: "string_lit", value: "x" },
      },
    ],
  });
  assert.deepEqual(refs, ["a", "m", "z"]);
});

void test("registry rejects malformed id", () => {
  const registry = createCrossFieldInvariantRegistry();
  assert.throws(
    () => registry.register(buildSampleInvariant({ id: "BAD-ID" })),
    /must match/i,
  );
});

void test("registry rejects missing anchor for AST field", () => {
  const registry = createCrossFieldInvariantRegistry();
  assert.throws(
    () =>
      registry.register(
        buildSampleInvariant({
          anchors: [
            {
              screenId: "s-loan",
              elementId: "fld-monthly",
              fieldRef: "monthly",
            },
          ],
        }),
      ),
    /references field "annual" without a matching anchor/,
  );
});

void test("registry rejects when only positive seeds are provided", () => {
  const registry = createCrossFieldInvariantRegistry();
  assert.throws(
    () =>
      registry.register(
        buildSampleInvariant({
          bvaSeeds: [
            {
              label: "ok",
              values: { monthly: "100", annual: "1000" },
              expectedSatisfied: true,
              rationale: "fine",
            },
          ],
        }),
      ),
    /positive and one negative bvaSeed/,
  );
});

void test("registry rejects when AST disagrees with seed verdict", () => {
  const registry = createCrossFieldInvariantRegistry();
  assert.throws(
    () =>
      registry.register(
        buildSampleInvariant({
          bvaSeeds: [
            {
              label: "wrong-positive",
              values: { monthly: "999", annual: "1000" },
              expectedSatisfied: true,
              rationale: "intentionally wrong",
            },
            {
              label: "valid-negative",
              values: { monthly: "999", annual: "1000" },
              expectedSatisfied: false,
              rationale: "ok",
            },
          ],
        }),
      ),
    /expected satisfied=true but engine returned false/,
  );
});

void test("registry rejects when only vacuous positives are provided", () => {
  const registry = createCrossFieldInvariantRegistry();
  // Build an implies-only invariant whose only positive seed is vacuous.
  const invariant: CrossFieldInvariant = {
    id: "XINV-TEST-IMP-01",
    scope: "screen",
    description: "Implies test invariant",
    expression: {
      kind: "implies",
      antecedent: {
        kind: "eq_string",
        left: { kind: "field_string", fieldRef: "kind" },
        right: { kind: "string_lit", value: "premium" },
      },
      consequent: { kind: "field_present", fieldRef: "rider" },
    },
    severity: "warning",
    citation: { framework: "T", citation: "T-1" },
    anchors: [
      {
        screenId: "s",
        elementId: "fld-kind",
        fieldRef: "kind",
      },
      {
        screenId: "s",
        elementId: "fld-rider",
        fieldRef: "rider",
      },
    ],
    bvaSeeds: [
      {
        label: "non-premium-vacuous",
        values: { kind: "basic", rider: "" },
        expectedSatisfied: true,
        rationale: "vacuously true",
      },
      {
        label: "premium-without-rider",
        values: { kind: "premium", rider: "" },
        expectedSatisfied: false,
        rationale: "antecedent matches but rider missing",
      },
    ],
    source: "Issue #2110 (test)",
  };
  assert.throws(
    () => registry.register(invariant),
    /non-vacuous positive bvaSeed/,
  );
});

void test("registry preserves insertion ordering by id sort", () => {
  const registry = createCrossFieldInvariantRegistry();
  registry.register(buildSampleInvariant({ id: "XINV-TEST-Z-01" }));
  registry.register(buildSampleInvariant({ id: "XINV-TEST-A-01" }));
  assert.deepEqual(registry.ids(), ["XINV-TEST-A-01", "XINV-TEST-Z-01"]);
});

void test("registry rejects duplicate ids", () => {
  const registry = createCrossFieldInvariantRegistry();
  registry.register(buildSampleInvariant());
  assert.throws(
    () => registry.register(buildSampleInvariant()),
    /already registered/,
  );
});

void test("registry byScreen filters by anchor screen id", () => {
  const registry = createCrossFieldInvariantRegistry();
  registry.register(buildSampleInvariant({ id: "XINV-TEST-DTI-01" }));
  registry.register(
    buildSampleInvariant({
      id: "XINV-TEST-DTI-02",
      anchors: [
        { screenId: "s-other", elementId: "fld-monthly", fieldRef: "monthly" },
        { screenId: "s-other", elementId: "fld-annual", fieldRef: "annual" },
      ],
    }),
  );
  assert.deepEqual(
    registry.byScreen("s-loan").map((row) => row.id),
    ["XINV-TEST-DTI-01"],
  );
  assert.deepEqual(
    registry.byScreen("s-other").map((row) => row.id),
    ["XINV-TEST-DTI-02"],
  );
  assert.deepEqual(registry.byScreen("none-existent"), []);
});

void test("synthesizeCrossFieldTestData orders positive before negative and label-sorts", () => {
  const invariant = buildSampleInvariant({
    bvaSeeds: [
      {
        label: "z-positive",
        values: { monthly: "100", annual: "1000" },
        expectedSatisfied: true,
        rationale: "fine",
      },
      {
        label: "a-negative",
        values: { monthly: "700", annual: "1000" },
        expectedSatisfied: false,
        rationale: "violates",
      },
      {
        label: "a-positive",
        values: { monthly: "200", annual: "1000" },
        expectedSatisfied: true,
        rationale: "also fine",
      },
    ],
  });
  const synthesized = synthesizeCrossFieldTestData(invariant);
  assert.deepEqual(
    synthesized.map((row) => `${row.category}|${row.label}`),
    [
      "cross_field_positive|a-positive",
      "cross_field_positive|z-positive",
      "cross_field_negative|a-negative",
    ],
  );
});

void test("evaluateValuationAgainstInvariant emits one violation per anchor on miss", () => {
  const invariant = buildSampleInvariant();
  const { result, violations } = evaluateValuationAgainstInvariant(invariant, {
    monthly: "700",
    annual: "1000",
  });
  assert.equal(result.satisfied, false);
  assert.equal(violations.length, 2);
  assert.equal(violations[0]?.invariantId, "XINV-TEST-DTI-01");
  assert.equal(violations[0]?.severity, "error");
  assert.equal(violations[0]?.citation.framework, "Test");
  assert.equal(violations[0]?.fieldRef, "monthly");
  assert.equal(violations[1]?.fieldRef, "annual");
});

void test("evaluateValuationAgainstInvariant returns no violations on satisfy", () => {
  const invariant = buildSampleInvariant();
  const { result, violations } = evaluateValuationAgainstInvariant(invariant, {
    monthly: "100",
    annual: "1000",
  });
  assert.equal(result.satisfied, true);
  assert.equal(violations.length, 0);
});

void test("evaluateInvariantExpression matches evaluateBoolExpr", () => {
  const expr: InvariantBoolExpr = {
    kind: "lt",
    left: fnum("a"),
    right: fnum("b"),
  };
  assert.deepEqual(
    evaluateInvariantExpression(expr, { a: "1", b: "2" }),
    evaluateBoolExpr(expr, { a: "1", b: "2" }),
  );
});
