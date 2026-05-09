import assert from "node:assert/strict";
import test from "node:test";

import {
  TEST_DESIGN_MODEL_SCHEMA_VERSION,
  WORKFLOW_TOPOLOGY_SCHEMA_VERSION,
  type TestDesignModel,
} from "../contracts/index.js";
import {
  assertWorkflowTopologyInvariants,
  buildWorkflowTopology,
} from "./action-topology-agent.js";

const buildModel = (): TestDesignModel => ({
  schemaVersion: TEST_DESIGN_MODEL_SCHEMA_VERSION,
  jobId: "job-2035",
  sourceHash: "a".repeat(64),
  screens: [
    {
      screenId: "screen-1",
      name: "Finanzierungsbedarf",
      elements: [
        {
          elementId: "purchase-mode",
          label: "Wie soll der Kaufpreis erfasst werden?",
          kind: "radio",
        },
        {
          elementId: "purchase-price",
          label: "Höhe des Kaufpreises (Netto)",
          kind: "currency",
        },
        {
          elementId: "vat-rate",
          label: "Anfallender MwSt.-Satz bei Kauf",
          kind: "select",
        },
        {
          elementId: "total",
          label: "Finanzierungsbedarf des Investitionsobjekts",
          kind: "result display",
        },
      ],
      actions: [],
      validations: [],
      calculations: [],
      visualRefs: [],
      sourceRefs: ["figma-primary", "custom-context-markdown"],
    },
  ],
  businessRules: [],
  calculationConstraints: [],
  assumptions: [],
  openQuestions: [],
  riskSignals: [],
});

test("buildWorkflowTopology derives stable ACT-* actions and transitions", () => {
  const topology = buildWorkflowTopology({
    model: buildModel(),
    customContextMarkdown:
      "Die MwSt. ist nicht Teil des Finanzierungsbedarfs. Höhe der Nebenkosten (optional).",
  });

  assert.equal(topology.schemaVersion, WORKFLOW_TOPOLOGY_SCHEMA_VERSION);
  assert.equal(topology.actions.length, 4);
  assert.equal(topology.fieldLifecycles.length, 3);
  assert.deepEqual(
    topology.actions.map((action) => action.actionId),
    ["ACT-001", "ACT-002", "ACT-003", "ACT-004"],
  );
  assert.equal(topology.transitions.length, 4);
  assert.ok(topology.transitions.every((transition) => transition.actions.length > 0));
  assert.ok(
    topology.fieldLifecycles.every(
      (lifecycle) => lifecycle.transitions.length === 5,
    ),
  );
  assert.ok(
    topology.actions.some((action) => action.label.includes("Kaufpreis")),
  );
});

test("assertWorkflowTopologyInvariants rejects transitions with invalid guards", () => {
  const topology = buildWorkflowTopology({ model: buildModel() });
  const invalid = {
    ...topology,
    transitions: topology.transitions.map((transition, index) =>
      index === 0 ? { ...transition, guard: "   " } : transition,
    ),
  };
  assert.throws(
    () => assertWorkflowTopologyInvariants(invalid),
    /guard must be non-empty/u,
  );
});
