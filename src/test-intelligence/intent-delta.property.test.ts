import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";

import {
  type BusinessTestIntentIr,
  type DetectedField,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import { computeIntentDelta } from "./intent-delta.js";

const fieldArb: fc.Arbitrary<DetectedField> = fc
  .record({
    id: fc.string({ minLength: 1, maxLength: 12 }),
    label: fc.string({ minLength: 1, maxLength: 24 }),
    type: fc.constantFrom("text", "email", "password"),
  })
  .map((r) => ({
    id: `screen-a::field::${r.id}`,
    screenId: "screen-a",
    trace: { nodeId: r.id, nodeName: r.label },
    provenance: "figma_node" as const,
    confidence: 0.9,
    label: r.label,
    type: r.type,
  }));

const irArb: fc.Arbitrary<BusinessTestIntentIr> = fc
  .uniqueArray(fieldArb, { selector: (f) => f.id, maxLength: 6 })
  .map((fields) => ({
    version: "1.0.0" as const,
    source: { kind: "figma_local_json" as const, contentHash: "0".repeat(64) },
    screens: [
      {
        screenId: "screen-a",
        screenName: "S",
        trace: { nodeId: "screen-a" },
      },
    ],
    detectedFields: fields,
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

test("property: computeIntentDelta is deterministic (byte-identical for same inputs)", () => {
  fc.assert(
    fc.property(irArb, irArb, (a, b) => {
      const x = computeIntentDelta({
        jobId: "job",
        generatedAt: "2026-04-26T00:00:00.000Z",
        prior: a,
        current: b,
      });
      const y = computeIntentDelta({
        jobId: "job",
        generatedAt: "2026-04-26T00:00:00.000Z",
        prior: a,
        current: b,
      });
      assert.equal(canonicalJson(x), canonicalJson(y));
    }),
    { numRuns: 64 },
  );
});

test("property: identical inputs always yield zero entries", () => {
  fc.assert(
    fc.property(irArb, (ir) => {
      const delta = computeIntentDelta({
        jobId: "job",
        generatedAt: "2026-04-26T00:00:00.000Z",
        prior: ir,
        current: ir,
      });
      assert.equal(delta.entries.length, 0);
    }),
    { numRuns: 64 },
  );
});

test("property: removing a field always surfaces a `removed` entry for that id", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fieldArb, {
        selector: (f) => f.id,
        minLength: 1,
        maxLength: 6,
      }),
      (fields) => {
        const targetIndex = 0;
        const target = fields[targetIndex];
        if (target === undefined) return;
        const remaining = fields.filter((_, i) => i !== targetIndex);
        const prior: BusinessTestIntentIr = {
          version: "1.0.0",
          source: {
            kind: "figma_local_json",
            contentHash: "0".repeat(64),
          },
          screens: [
            {
              screenId: "screen-a",
              screenName: "S",
              trace: { nodeId: "screen-a" },
            },
          ],
          detectedFields: fields,
          detectedActions: [],
          detectedValidations: [],
          detectedNavigation: [],
          inferredBusinessObjects: [],
          risks: [],
          assumptions: [],
          openQuestions: [],
          piiIndicators: [],
          redactions: [],
        };
        const current: BusinessTestIntentIr = {
          ...prior,
          detectedFields: remaining,
        };
        const delta = computeIntentDelta({
          jobId: "job",
          generatedAt: "2026-04-26T00:00:00.000Z",
          prior,
          current,
        });
        const removed = delta.entries.find(
          (e) =>
            e.kind === "field" &&
            e.changeType === "removed" &&
            e.elementId === target.id,
        );
        assert.ok(
          removed,
          `expected removed entry for ${target.id}, got ${JSON.stringify(delta.entries)}`,
        );
      },
    ),
    { numRuns: 64 },
  );
});
