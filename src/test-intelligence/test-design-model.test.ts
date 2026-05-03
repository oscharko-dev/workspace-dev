import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
  TEST_DESIGN_MODEL_ARTIFACT_FILENAME,
  TEST_DESIGN_MODEL_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type VisualScreenDescription,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  buildTestDesignModel,
  computeTestDesignModelSchemaHash,
  validateTestDesignModel,
  writeTestDesignModelArtifact,
} from "./test-design-model.js";

const buildIntent = (): BusinessTestIntentIr => ({
  version: BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
  source: { kind: "figma_local_json", contentHash: "a".repeat(64) },
  screens: [
    {
      screenId: "screen-a",
      screenName: "Payment Form",
      trace: {
        nodeId: "screen-a",
        sourceRefs: [
          {
            sourceId: "figma-primary",
            kind: "figma_local_json",
            contentHash: "a".repeat(64),
            capturedAt: "2026-05-03T00:00:00.000Z",
          },
        ],
      },
    },
  ],
  detectedFields: [
    {
      id: "screen-a::field::iban",
      screenId: "screen-a",
      trace: {
        nodeId: "iban-node",
        sourceRefs: [
          {
            sourceId: "figma-primary",
            kind: "figma_local_json",
            contentHash: "a".repeat(64),
            capturedAt: "2026-05-03T00:00:00.000Z",
          },
        ],
      },
      provenance: "figma_node",
      confidence: 0.9,
      label: "IBAN",
      type: "text",
      defaultValue: "[REDACTED:IBAN]",
    },
  ],
  detectedActions: [
    {
      id: "screen-a::action::submit",
      screenId: "screen-a",
      trace: { nodeId: "submit-node" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Submit",
      kind: "submit",
    },
  ],
  detectedValidations: [
    {
      id: "screen-a::validation::iban-required",
      screenId: "screen-a",
      trace: {
        nodeId: "iban-node",
        sourceRefs: [
          {
            sourceId: "figma-primary",
            kind: "figma_local_json",
            contentHash: "a".repeat(64),
            capturedAt: "2026-05-03T00:00:00.000Z",
          },
        ],
      },
      provenance: "figma_node",
      confidence: 0.9,
      rule: "required",
      targetFieldId: "screen-a::field::iban",
    },
  ],
  detectedNavigation: [],
  inferredBusinessObjects: [],
  risks: ["regulated payment flow"],
  assumptions: ["Operator has a valid account."],
  openQuestions: ["Is IBAN optional for draft flows?"],
  piiIndicators: [],
  redactions: [],
  sourceEnvelope: {
    version: "1.0.0",
    sources: [
      {
        sourceId: "figma-primary",
        kind: "figma_local_json",
        contentHash: "a".repeat(64),
        capturedAt: "2026-05-03T00:00:00.000Z",
      },
    ],
    aggregateContentHash: "b".repeat(64),
    conflictResolutionPolicy: "reviewer_decides",
  },
  multiSourceConflicts: [
    {
      conflictId: "c".repeat(64),
      kind: "validation_rule_mismatch",
      participatingSourceIds: ["figma-primary", "jira-42"],
      normalizedValues: ["required", "optional"],
      resolution: "deferred_to_reviewer",
      affectedScreenIds: ["screen-a"],
      detail: "IBAN requirement differs across sources",
    },
  ],
});

const buildVisual = (): VisualScreenDescription[] => [
  {
    screenId: "screen-a",
    sidecarDeployment: "mock",
    regions: [
      {
        regionId: "region-1",
        confidence: 0.91,
        label: "IBAN field",
      },
    ],
    confidenceSummary: { min: 0.91, max: 0.91, mean: 0.91 },
    screenName: "Payment Form",
  },
];

test("buildTestDesignModel projects intent into a bounded screen model", () => {
  const model = buildTestDesignModel({
    jobId: "job-1765",
    intent: buildIntent(),
    visual: buildVisual(),
  });

  assert.equal(model.schemaVersion, TEST_DESIGN_MODEL_SCHEMA_VERSION);
  assert.equal(model.jobId, "job-1765");
  assert.match(model.sourceHash, /^[0-9a-f]{64}$/);
  assert.equal(model.screens[0]?.screenId, "screen-a");
  assert.deepEqual(model.screens[0]?.visualRefs, ["visual:screen-a:region-1"]);
  assert.deepEqual(model.screens[0]?.sourceRefs, ["figma-primary"]);
  assert.equal(model.businessRules[0]?.description, "IBAN: required");
  assert.equal(model.riskSignals.length, 2);
});

test("computeTestDesignModelSchemaHash is deterministic", () => {
  const first = computeTestDesignModelSchemaHash();
  const second = computeTestDesignModelSchemaHash();
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test("validateTestDesignModel accepts a valid projected model", () => {
  const result = validateTestDesignModel(
    buildTestDesignModel({
      jobId: "job-1765",
      intent: buildIntent(),
      visual: buildVisual(),
    }),
  );
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("validateTestDesignModel rejects unexpected root properties", () => {
  const candidate = {
    ...buildTestDesignModel({
      jobId: "job-1765",
      intent: buildIntent(),
      visual: buildVisual(),
    }),
    extra: true,
  };
  const result = validateTestDesignModel(candidate);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.path === "$"));
});

test("validateTestDesignModel rejects malformed optional string fields", () => {
  const candidate = buildTestDesignModel({
    jobId: "job-1765",
    intent: buildIntent(),
    visual: buildVisual(),
  }) as Record<string, unknown>;

  const screens = candidate["screens"] as Array<Record<string, unknown>>;
  const screen = screens[0];
  assert.ok(screen);

  const elements = screen["elements"] as Array<Record<string, unknown>>;
  const actions = screen["actions"] as Array<Record<string, unknown>>;
  const validations = screen["validations"] as Array<Record<string, unknown>>;

  elements[0] = { ...elements[0], defaultValue: 123 };
  actions[0] = {
    ...actions[0],
    targetScreenId: { bad: true },
    ambiguity: { bad: true },
  };
  validations[0] = { ...validations[0], targetElementId: ["bad"] };

  const result = validateTestDesignModel(candidate);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(
      (error) =>
        error.path === "$.screens[0].elements[0].defaultValue" &&
        error.message === "expected string",
    ),
  );
  assert.ok(
    result.errors.some(
      (error) =>
        error.path === "$.screens[0].actions[0].targetScreenId" &&
        error.message === "expected string",
    ),
  );
  assert.ok(
    result.errors.some(
      (error) =>
        error.path === "$.screens[0].actions[0].ambiguity" &&
        error.message === "expected string",
    ),
  );
  assert.ok(
    result.errors.some(
      (error) =>
        error.path === "$.screens[0].validations[0].targetElementId" &&
        error.message === "expected string",
    ),
  );
});

test("writeTestDesignModelArtifact persists canonical JSON to the run directory", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-tdm-"));
  const model = buildTestDesignModel({
    jobId: "job-1765",
    intent: buildIntent(),
    visual: buildVisual(),
  });

  const artifactPath = await writeTestDesignModelArtifact({ model, runDir });
  assert.equal(
    artifactPath,
    path.join(runDir, TEST_DESIGN_MODEL_ARTIFACT_FILENAME),
  );

  const persisted = await readFile(artifactPath, "utf8");
  assert.equal(persisted, canonicalJson(model));
});
