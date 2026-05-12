import assert from "node:assert/strict";
import test from "node:test";

import {
  TEST_DESIGN_MODEL_SCHEMA_VERSION,
  type TestDesignModel,
} from "../contracts/index.js";
import {
  buildSourceScopedCalculationAssumptions,
  extractCalculationConstraints,
} from "./calculation-constraints.js";

const buildModel = (
  overrides: Partial<TestDesignModel> = {},
): TestDesignModel => ({
  schemaVersion: TEST_DESIGN_MODEL_SCHEMA_VERSION,
  jobId: "job-2013-calc",
  sourceHash: "f".repeat(64),
  screens: [
    {
      screenId: "screen-financing",
      name: "Finanzierungsbedarf",
      elements: [],
      actions: [],
      validations: [],
      calculations: [],
      visualRefs: [],
      sourceRefs: [],
    },
  ],
  businessRules: [],
  calculationConstraints: [],
  assumptions: [],
  openQuestions: [],
  riskSignals: [],
  ...overrides,
});

test("extractCalculationConstraints recognises the German VAT-exclusion phrasing for Issue #2013", () => {
  const model = buildModel({
    businessRules: [
      {
        ruleId: "rule-vat-exclusion",
        description: "Die MwSt. ist nicht Teil des Finanzierungsbedarfs.",
        screenId: "screen-financing",
        sourceRefs: ["custom-context-markdown"],
      },
    ],
  });

  const constraints = extractCalculationConstraints(model);
  assert.equal(constraints.length, 1);
  assert.equal(constraints[0]?.kind, "exclude_component");
  assert.equal(constraints[0]?.subject, "financing_need");
  assert.equal(constraints[0]?.component, "vat");
  assert.equal(constraints[0]?.screenId, "screen-financing");
  assert.ok(
    constraints[0]?.evidenceText.includes("nicht Teil"),
    "evidence text preserves the German exclusion phrasing",
  );
});

test("extractCalculationConstraints handles English exclusion phrasing without regression", () => {
  const model = buildModel({
    businessRules: [
      {
        ruleId: "rule-vat-en",
        description: "VAT is not part of the financing need.",
        sourceRefs: ["custom-context-markdown"],
      },
    ],
  });

  const constraints = extractCalculationConstraints(model);
  assert.equal(constraints.length, 1);
  assert.equal(constraints[0]?.kind, "exclude_component");
});

test("extractCalculationConstraints sees German openQuestions about the financing-need formula", () => {
  const model = buildModel({
    openQuestions: [
      {
        openQuestionId: "open-question-financing",
        text: "Es ist fachlich zu klären, ob die Mehrwertsteuer Teil des Finanzierungsbedarfs sein soll oder nicht.",
      },
    ],
  });

  const constraints = extractCalculationConstraints(model);
  assert.equal(constraints.length, 1);
  assert.ok(
    constraints[0]?.evidenceText.includes("Finanzierungsbedarf"),
    "German calculation evidence is surfaced",
  );
});

test("buildSourceScopedCalculationAssumptions extracts German VAT exclusion statements", () => {
  const text =
    "## Hinweis\nDie MwSt. ist nicht Teil des Finanzierungsbedarfs.\nWeitere Beträge werden separat geprüft.";
  const assumptions = buildSourceScopedCalculationAssumptions({
    sourceLabel: "custom_context_markdown",
    text,
  });

  assert.equal(assumptions.length, 1);
  assert.ok(assumptions[0]?.startsWith("custom_context_markdown: "));
  assert.ok(assumptions[0]?.includes("nicht Teil"));
});
