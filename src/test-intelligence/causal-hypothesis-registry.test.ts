/**
 * Unit tests for the causal-hypothesis registry (Issue #2180). Cover
 * the SemanticFieldId branding contract, the deterministic
 * derivation of hypotheses from registered invariants, and the
 * operator-fixture loader's defensive validation.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { TestDesignModel } from "../contracts/index.js";
import {
  buildCausalHypothesisRegistry,
  buildCausalHypothesisRegistryFromRegistry,
  CausalValidationFrameworkError,
  loadOperatorHypotheses,
  parseSemanticFieldId,
  semanticFieldId,
  type CausalHypothesis,
} from "./causal-hypothesis-registry.js";
import {
  buildActiveDatasetInvariantRegistry,
  type DomainInvariant,
} from "./domain-invariant-registry.js";

const buildModelWithVatAndFinancingNeed = (): TestDesignModel => ({
  schemaVersion: "1.0.0",
  jobId: "job-causal-1",
  sourceHash: "0000000000000000000000000000000000000000000000000000000000000000",
  screens: [
    {
      screenId: "s-loan",
      name: "Loan calculator",
      elements: [
        {
          elementId: "e-vat",
          label: "VAT rate",
          kind: "select",
        },
        {
          elementId: "e-price",
          label: "Kaufpreis",
          kind: "number_input",
        },
        {
          elementId: "e-financing-need",
          label: "Finanzierungsbedarf",
          kind: "result_display",
        },
      ],
      actions: [],
      validations: [
        {
          validationId: "v-price",
          rule: "Numeric in range 1000..50000",
          targetElementId: "e-price",
        },
      ],
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
});

const buildEmptyModel = (): TestDesignModel => ({
  schemaVersion: "1.0.0",
  jobId: "job-causal-empty",
  sourceHash: "0000000000000000000000000000000000000000000000000000000000000000",
  screens: [],
  businessRules: [],
  calculationConstraints: [],
  assumptions: [],
  openQuestions: [],
  riskSignals: [],
});

test("semanticFieldId: rejects components containing '#'", () => {
  assert.throws(() => semanticFieldId("s#bad", "e1"), CausalValidationFrameworkError);
  assert.throws(() => semanticFieldId("s1", "e#bad"), CausalValidationFrameworkError);
});

test("semanticFieldId: rejects empty components", () => {
  assert.throws(() => semanticFieldId("", "e1"), CausalValidationFrameworkError);
  assert.throws(() => semanticFieldId("s1", ""), CausalValidationFrameworkError);
});

test("semanticFieldId + parseSemanticFieldId: round-trip stable", () => {
  const id = semanticFieldId("s-loan", "e-vat");
  assert.equal(id, "s-loan#e-vat");
  assert.deepEqual(parseSemanticFieldId(id), {
    screenId: "s-loan",
    elementId: "e-vat",
  });
});

test("buildCausalHypothesisRegistry: derives hypotheses from registered invariants", () => {
  const model = buildModelWithVatAndFinancingNeed();
  const invariants = buildActiveDatasetInvariantRegistry().list();
  const hypotheses = buildCausalHypothesisRegistry({
    invariants,
    model,
  });
  assert.ok(hypotheses.length >= 2, `expected >= 2 hypotheses, got ${hypotheses.length}`);
  const vatHypothesis = hypotheses.find(
    (h) => h.hypothesisId === "H-INV-VAT-01-001",
  );
  assert.ok(vatHypothesis !== undefined, "INV-VAT-01 hypothesis missing");
  assert.equal(vatHypothesis?.relationship, "no-effect");
  assert.equal(vatHypothesis?.cause, "s-loan#e-vat");
  assert.equal(vatHypothesis?.effect, "s-loan#e-financing-need");
  const financingHypothesis = hypotheses.find(
    (h) => h.hypothesisId === "H-INV-FINANCING-NEED-01-001",
  );
  assert.ok(financingHypothesis !== undefined);
  assert.equal(financingHypothesis?.relationship, "monotonic-up");
  assert.equal(financingHypothesis?.cause, "s-loan#e-price");
});

test("buildCausalHypothesisRegistry: deterministic ordering by hypothesisId", () => {
  const model = buildModelWithVatAndFinancingNeed();
  const invariants = buildActiveDatasetInvariantRegistry().list();
  const a = buildCausalHypothesisRegistry({ invariants, model });
  const b = buildCausalHypothesisRegistry({ invariants, model });
  assert.deepEqual(a, b);
  const ids = a.map((h) => h.hypothesisId);
  assert.deepEqual([...ids].sort((l, r) => l.localeCompare(r)), ids);
});

test("buildCausalHypothesisRegistry: skips catalog rows whose fields are absent in the model", () => {
  const model = buildEmptyModel();
  const invariants = buildActiveDatasetInvariantRegistry().list();
  const hypotheses = buildCausalHypothesisRegistry({ invariants, model });
  assert.equal(hypotheses.length, 0);
});

test("buildCausalHypothesisRegistry: merges operator-declared hypotheses with invariant-derived rows", () => {
  const model = buildModelWithVatAndFinancingNeed();
  const invariants: readonly DomainInvariant[] = []; // disable invariant rows
  const operatorHypotheses: readonly CausalHypothesis[] = [
    {
      hypothesisId: "OP-001",
      cause: semanticFieldId("s-loan", "e-vat"),
      effect: semanticFieldId("s-loan", "e-financing-need"),
      relationship: "no-effect",
      source: { kind: "operator-declared", declaredAt: "2026-05-10T08:00:00.000Z" },
    },
  ];
  const hypotheses = buildCausalHypothesisRegistry({
    invariants,
    model,
    operatorHypotheses,
  });
  assert.equal(hypotheses.length, 1);
  assert.equal(hypotheses[0]?.hypothesisId, "OP-001");
});

test("buildCausalHypothesisRegistry: rejects operator hypotheses referencing unknown screens", () => {
  const model = buildModelWithVatAndFinancingNeed();
  const operatorHypotheses: readonly CausalHypothesis[] = [
    {
      hypothesisId: "OP-002",
      cause: semanticFieldId("s-missing", "e1"),
      effect: semanticFieldId("s-loan", "e-financing-need"),
      relationship: "no-effect",
      source: { kind: "operator-declared", declaredAt: "2026-05-10T08:00:00.000Z" },
    },
  ];
  assert.throws(
    () =>
      buildCausalHypothesisRegistry({
        invariants: [],
        model,
        operatorHypotheses,
      }),
    (err: unknown) =>
      err instanceof CausalValidationFrameworkError &&
      err.code === "E_INVALID_FIELD_ID",
  );
});

test("buildCausalHypothesisRegistry: rejects self-referential hypotheses", () => {
  const model = buildModelWithVatAndFinancingNeed();
  const operatorHypotheses: readonly CausalHypothesis[] = [
    {
      hypothesisId: "OP-003",
      cause: semanticFieldId("s-loan", "e-vat"),
      effect: semanticFieldId("s-loan", "e-vat"),
      relationship: "no-effect",
      source: { kind: "operator-declared", declaredAt: "2026-05-10T08:00:00.000Z" },
    },
  ];
  assert.throws(
    () =>
      buildCausalHypothesisRegistry({
        invariants: [],
        model,
        operatorHypotheses,
      }),
    (err: unknown) =>
      err instanceof CausalValidationFrameworkError &&
      err.code === "E_INVALID_HYPOTHESIS",
  );
});

test("buildCausalHypothesisRegistryFromRegistry: forwards registry list()", () => {
  const model = buildModelWithVatAndFinancingNeed();
  const registry = buildActiveDatasetInvariantRegistry();
  const direct = buildCausalHypothesisRegistry({
    invariants: registry.list(),
    model,
  });
  const wrapped = buildCausalHypothesisRegistryFromRegistry({ registry, model });
  assert.deepEqual(direct, wrapped);
});

test("loadOperatorHypotheses: accepts a top-level array", () => {
  const payload = [
    {
      hypothesisId: "OP-100",
      cause: "s-loan#e-vat",
      effect: "s-loan#e-financing-need",
      relationship: "no-effect",
      source: { kind: "operator-declared", declaredAt: "2026-05-10T08:00:00.000Z" },
    },
  ];
  const hypotheses = loadOperatorHypotheses(payload);
  assert.equal(hypotheses.length, 1);
  assert.equal(hypotheses[0]?.relationship, "no-effect");
});

test("loadOperatorHypotheses: accepts the { hypotheses: [...] } envelope", () => {
  const payload = {
    hypotheses: [
      {
        hypothesisId: "OP-101",
        cause: "s-loan#e-vat",
        effect: "s-loan#e-financing-need",
        relationship: "no-effect",
        source: { kind: "operator-declared", declaredAt: "2026-05-10T08:00:00.000Z" },
        rationale: "VAT rate is excluded from the financing-need calculation.",
      },
    ],
  };
  const hypotheses = loadOperatorHypotheses(payload);
  assert.equal(hypotheses.length, 1);
  assert.equal(hypotheses[0]?.rationale, "VAT rate is excluded from the financing-need calculation.");
});

test("loadOperatorHypotheses: rejects malformed payload kinds", () => {
  assert.throws(
    () => loadOperatorHypotheses("not an object"),
    CausalValidationFrameworkError,
  );
  assert.throws(
    () => loadOperatorHypotheses({ wrongKey: [] }),
    CausalValidationFrameworkError,
  );
});

test("loadOperatorHypotheses: rejects unknown relationship", () => {
  const payload = [
    {
      hypothesisId: "OP-200",
      cause: "s-loan#e-vat",
      effect: "s-loan#e-financing-need",
      relationship: "unknown-kind",
      source: { kind: "operator-declared", declaredAt: "2026-05-10T08:00:00.000Z" },
    },
  ];
  assert.throws(
    () => loadOperatorHypotheses(payload),
    (err: unknown) =>
      err instanceof CausalValidationFrameworkError &&
      err.code === "E_INVALID_HYPOTHESIS",
  );
});

test("loadOperatorHypotheses: rejects non-ISO declaredAt timestamps", () => {
  const payload = [
    {
      hypothesisId: "OP-201",
      cause: "s-loan#e-vat",
      effect: "s-loan#e-financing-need",
      relationship: "no-effect",
      source: { kind: "operator-declared", declaredAt: "yesterday" },
    },
  ];
  assert.throws(
    () => loadOperatorHypotheses(payload),
    (err: unknown) =>
      err instanceof CausalValidationFrameworkError &&
      err.code === "E_INVALID_HYPOTHESIS",
  );
});

test("loadOperatorHypotheses: rejects duplicate hypothesis ids", () => {
  const payload = [
    {
      hypothesisId: "OP-300",
      cause: "s-loan#e-vat",
      effect: "s-loan#e-financing-need",
      relationship: "no-effect",
      source: { kind: "operator-declared", declaredAt: "2026-05-10T08:00:00.000Z" },
    },
    {
      hypothesisId: "OP-300",
      cause: "s-loan#e-price",
      effect: "s-loan#e-financing-need",
      relationship: "monotonic-up",
      source: { kind: "operator-declared", declaredAt: "2026-05-10T08:00:00.000Z" },
    },
  ];
  assert.throws(
    () => loadOperatorHypotheses(payload),
    (err: unknown) =>
      err instanceof CausalValidationFrameworkError &&
      err.code === "E_INVALID_HYPOTHESIS",
  );
});

test("loadOperatorHypotheses: rejects malformed cause / effect that are not in <screen>#<element> form", () => {
  const payload = [
    {
      hypothesisId: "OP-400",
      cause: "s-loan-e-vat", // missing '#'
      effect: "s-loan#e-financing-need",
      relationship: "no-effect",
      source: { kind: "operator-declared", declaredAt: "2026-05-10T08:00:00.000Z" },
    },
  ];
  assert.throws(
    () => loadOperatorHypotheses(payload),
    (err: unknown) =>
      err instanceof CausalValidationFrameworkError &&
      err.code === "E_INVALID_HYPOTHESIS",
  );
});
