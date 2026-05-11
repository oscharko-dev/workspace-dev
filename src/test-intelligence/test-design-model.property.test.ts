import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";

import {
  BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
  MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type MultiSourceTestIntentEnvelope,
  type VisualScreenDescription,
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
    trace: {
      nodeId: field.id,
      sourceRefs: [
        {
          sourceId: "figma-primary",
          kind: "figma_local_json" as const,
          contentHash: sha256Hex({ field }),
          capturedAt: "2026-05-03T00:00:00.000Z",
        },
      ],
    },
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
        trace: {
          nodeId: "screen-a",
          sourceRefs: [
            {
              sourceId: "figma-primary",
              kind: "figma_local_json" as const,
              contentHash: sha256Hex("screen"),
              capturedAt: "2026-05-03T00:00:00.000Z",
            },
          ],
        },
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

const visualArb: fc.Arbitrary<VisualScreenDescription[]> = fc
  .uniqueArray(
    fc.record({
      regionId: fc.string({ minLength: 1, maxLength: 8, unit: "grapheme-ascii" }),
      label: fc.string({ minLength: 1, maxLength: 12 }),
    }),
    { selector: (region) => region.regionId, maxLength: 4 },
  )
  .map((regions) => [
    {
      screenId: "screen-a",
      sidecarDeployment: "mock" as const,
      regions: regions.map((region) => ({
        regionId: region.regionId.replace(/[^A-Za-z0-9_-]/g, "x"),
        confidence: 0.91,
        label: region.label,
      })),
      confidenceSummary: { min: 0.91, max: 0.91, mean: 0.91 },
      screenName: "Screen A",
    },
  ]);

const envelopeArb: fc.Arbitrary<MultiSourceTestIntentEnvelope> = fc
  .constantFrom("reviewer_decides" as const, "priority" as const)
  .map((conflictResolutionPolicy) => ({
    version: MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION,
    sources: [
      {
        sourceId: "figma-primary",
        kind: "figma_local_json" as const,
        contentHash: sha256Hex("figma"),
        capturedAt: "2026-05-03T00:00:00.000Z",
      },
      {
        sourceId: "jira-42",
        kind: "jira_rest" as const,
        contentHash: sha256Hex("jira"),
        capturedAt: "2026-05-03T00:00:00.000Z",
      },
    ],
    aggregateContentHash: sha256Hex({ conflictResolutionPolicy }),
    conflictResolutionPolicy,
    ...(conflictResolutionPolicy === "priority"
      ? { priorityOrder: ["figma_local_json", "jira_rest"] as const }
      : {}),
  }));

test("property: sourceHash is stable for byte-identical input", () => {
  fc.assert(
    fc.property(intentArb, visualArb, envelopeArb, (intent, visual, sourceEnvelope) => {
      const first = buildTestDesignModel({
        jobId: "job-a",
        intent,
        visual,
        sourceEnvelope,
      });
      const second = buildTestDesignModel({
        jobId: "job-b",
        intent,
        visual,
        sourceEnvelope,
      });
      assert.equal(first.sourceHash, second.sourceHash);
    }),
    { numRuns: 120 },
  );
});

test("property: canonical serialization is stable for repeated projection", () => {
  fc.assert(
    fc.property(intentArb, visualArb, envelopeArb, (intent, visual, sourceEnvelope) => {
      const first = buildTestDesignModel({
        jobId: "job-a",
        intent,
        visual,
        sourceEnvelope,
      });
      const second = buildTestDesignModel({
        jobId: "job-a",
        intent,
        visual,
        sourceEnvelope,
      });
      assert.equal(canonicalJson(first), canonicalJson(second));
    }),
    { numRuns: 120 },
  );
});

test("property: envelope changes participate in sourceHash", () => {
  fc.assert(
    fc.property(intentArb, visualArb, (intent, visual) => {
      const first = buildTestDesignModel({
        jobId: "job-a",
        intent,
        visual,
        sourceEnvelope: {
          version: MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION,
          sources: [
            {
              sourceId: "figma-primary",
              kind: "figma_local_json",
              contentHash: sha256Hex("figma-a"),
              capturedAt: "2026-05-03T00:00:00.000Z",
            },
          ],
          aggregateContentHash: sha256Hex("envelope-a"),
          conflictResolutionPolicy: "reviewer_decides",
        },
      });
      const second = buildTestDesignModel({
        jobId: "job-a",
        intent,
        visual,
        sourceEnvelope: {
          version: MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION,
          sources: [
            {
              sourceId: "figma-primary",
              kind: "figma_local_json",
              contentHash: sha256Hex("figma-b"),
              capturedAt: "2026-05-03T00:00:00.000Z",
            },
          ],
          aggregateContentHash: sha256Hex("envelope-b"),
          conflictResolutionPolicy: "reviewer_decides",
        },
      });
      assert.notEqual(first.sourceHash, second.sourceHash);
    }),
    { numRuns: 60 },
  );
});
