import assert from "node:assert/strict";
import test from "node:test";
import {
  BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type VisualScreenDescription,
} from "../contracts/index.js";
import { reconcileSources } from "./reconciliation.js";

const baseIntent = (): BusinessTestIntentIr => ({
  version: BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
  source: { kind: "figma_local_json", contentHash: "hash" },
  screens: [
    {
      screenId: "s1",
      screenName: "Form",
      trace: { nodeId: "s1" },
    },
  ],
  detectedFields: [
    {
      id: "s1::field::n1",
      screenId: "s1",
      trace: { nodeId: "n1", nodeName: "Email" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Email",
      type: "text",
    },
  ],
  detectedActions: [],
  detectedValidations: [],
  detectedNavigation: [],
  inferredBusinessObjects: [],
  risks: [],
  assumptions: [],
  openQuestions: [],
  piiIndicators: [],
  redactions: [],
});

test("reconciliation promotes existing Figma field to reconciled when visual agrees", () => {
  const visual: VisualScreenDescription[] = [
    {
      screenId: "s1",
      sidecarDeployment: "mock",
      regions: [{ regionId: "n1", label: "Email", confidence: 0.9 }],
      confidenceSummary: { min: 0.9, max: 0.9, mean: 0.9 },
    },
  ];
  const result = reconcileSources({ figmaIntent: baseIntent(), visual });
  assert.equal(result.detectedFields[0]?.provenance, "reconciled");
  assert.equal(result.detectedFields[0]?.ambiguity, undefined);
});

test("reconciliation emits ambiguity when visual label disagrees with Figma", () => {
  const visual: VisualScreenDescription[] = [
    {
      screenId: "s1",
      sidecarDeployment: "mock",
      regions: [{ regionId: "n1", label: "Password", confidence: 0.9 }],
      confidenceSummary: { min: 0.9, max: 0.9, mean: 0.9 },
    },
  ];
  const result = reconcileSources({ figmaIntent: baseIntent(), visual });
  assert.equal(result.detectedFields[0]?.provenance, "reconciled");
  assert.notEqual(result.detectedFields[0]?.ambiguity, undefined);
  assert.equal(result.detectedFields[0]?.label, "Email");
});

test("reconciliation adds visual-only fields with provenance visual_sidecar", () => {
  const visual: VisualScreenDescription[] = [
    {
      screenId: "s1",
      sidecarDeployment: "mock",
      regions: [
        { regionId: "n1", label: "Email", confidence: 0.9 },
        {
          regionId: "n2",
          controlType: "text_input",
          label: "Phone",
          confidence: 0.7,
        },
      ],
      confidenceSummary: { min: 0.7, max: 0.9, mean: 0.8 },
    },
  ];
  const result = reconcileSources({ figmaIntent: baseIntent(), visual });
  assert.equal(result.detectedFields.length, 2);
  const visualField = result.detectedFields.find(
    (f) => f.provenance === "visual_sidecar",
  );
  assert.notEqual(visualField, undefined);
  assert.equal(visualField?.label, "Phone");
});

test("reconciliation adds visual validation hints not already in Figma", () => {
  const visual: VisualScreenDescription[] = [
    {
      screenId: "s1",
      sidecarDeployment: "mock",
      regions: [
        {
          regionId: "n1",
          label: "Email",
          confidence: 0.9,
          validationHints: ["Required"],
        },
      ],
      confidenceSummary: { min: 0.9, max: 0.9, mean: 0.9 },
    },
  ];
  const result = reconcileSources({ figmaIntent: baseIntent(), visual });
  assert.equal(result.detectedValidations.length, 1);
  assert.equal(result.detectedValidations[0]?.provenance, "visual_sidecar");
  assert.equal(result.detectedValidations[0]?.rule, "Required");
});
