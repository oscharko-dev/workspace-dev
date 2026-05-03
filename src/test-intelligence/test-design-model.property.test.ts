import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";

import {
  BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
  type BusinessTestIntentIr,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import { buildTestDesignModel } from "./test-design-model.js";

const fieldArb = fc
  .record({
    id: fc.string({ minLength: 1, maxLength: 10, unit: "grapheme-ascii" }),
    label: fc.string({ minLength: 1, maxLength: 18 }),
    type: fc.constantFrom("text", "email", "number"),
  })
  .map((field) => ({
    id: `screen-a::field::${field.id.replace(/[^A-Za-z0-9_-]/g, "x")}`,
    screenId: "screen-a",
    trace: { nodeId: field.id },
    provenance: "figma_node" as const,
    confidence: 0.9,
    label: field.label,
    type: field.type,
  }));

const intentArb: fc.Arbitrary<BusinessTestIntentIr> = fc
  .uniqueArray(fieldArb, { selector: (field) => field.id, maxLength: 6 })
  .map((detectedFields) => ({
    version: BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
    source: {
      kind: "figma_local_json" as const,
      contentHash: sha256Hex({ detectedFields }),
    },
    screens: [
      {
        screenId: "screen-a",
        screenName: "Screen A",
        trace: { nodeId: "screen-a" },
      },
    ],
    detectedFields,
    detectedActions: [],
    detectedValidations: [],
    detectedNavigation: [],
    inferredBusinessObjects: [],
    risks: [],
    assumptions: [],
    openQuestions: [],
    piiIndicators: [],
    redactions: [],
  }));

test("property: sourceHash is stable for byte-identical input", () => {
  fc.assert(
    fc.property(intentArb, (intent) => {
      const first = buildTestDesignModel({ jobId: "job-a", intent });
      const second = buildTestDesignModel({ jobId: "job-b", intent });
      assert.equal(first.sourceHash, second.sourceHash);
    }),
    { numRuns: 120 },
  );
});

test("property: canonical serialization is stable for repeated projection", () => {
  fc.assert(
    fc.property(intentArb, (intent) => {
      const first = buildTestDesignModel({ jobId: "job-a", intent });
      const second = buildTestDesignModel({ jobId: "job-a", intent });
      assert.equal(canonicalJson(first), canonicalJson(second));
    }),
    { numRuns: 120 },
  );
});
