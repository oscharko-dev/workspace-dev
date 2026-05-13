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

const visualOnlyIntent = (): BusinessTestIntentIr => ({
  version: BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
  source: { kind: "figma_local_json", contentHash: "hash" },
  screens: [
    {
      screenId: "s1",
      screenName: "Form",
      trace: { nodeId: "s1" },
    },
  ],
  detectedFields: [],
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

test("reconciliation contextualizes repeated choice fields from whole-screen visual text", () => {
  const intent = baseIntent();
  intent.detectedFields = [
    {
      id: "s1::field::n-01-fleet-yes",
      screenId: "s1",
      trace: { nodeId: "n-fleet-yes", nodeName: "Typography" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Ja",
      type: "radio_option",
    },
    {
      id: "s1::field::n-02-fleet-no",
      screenId: "s1",
      trace: { nodeId: "n-fleet-no", nodeName: "Typography" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Nein",
      type: "radio_option",
    },
    {
      id: "s1::field::n-03-expansion-yes",
      screenId: "s1",
      trace: { nodeId: "n-expansion-yes", nodeName: "Typography" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Ja",
      type: "radio_option",
    },
    {
      id: "s1::field::n-04-expansion-no",
      screenId: "s1",
      trace: { nodeId: "n-expansion-no", nodeName: "Typography" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Nein",
      type: "radio_option",
    },
  ];
  const visual: VisualScreenDescription[] = [
    {
      screenId: "s1",
      sidecarDeployment: "mock",
      regions: [
        {
          regionId: "form",
          visibleText:
            "Ist die Anschaffung im Rahmen eines Fuhrparks angedacht?\nJa Nein\nHandelt es sich um eine Erweiterungsinvestition?\nJa Nein",
          confidence: 0.9,
        },
      ],
      confidenceSummary: { min: 0.9, max: 0.9, mean: 0.9 },
    },
  ];

  const result = reconcileSources({ figmaIntent: intent, visual });

  const labelsById = new Map(
    result.detectedFields.map((field) => [field.id, field.label]),
  );
  assert.equal(
    labelsById.get("s1::field::n-01-fleet-yes"),
    "Ist die Anschaffung im Rahmen eines Fuhrparks angedacht? = Ja",
  );
  assert.equal(
    labelsById.get("s1::field::n-02-fleet-no"),
    "Ist die Anschaffung im Rahmen eines Fuhrparks angedacht? = Nein",
  );
  assert.equal(
    labelsById.get("s1::field::n-03-expansion-yes"),
    "Handelt es sich um eine Erweiterungsinvestition? = Ja",
  );
  assert.equal(
    labelsById.get("s1::field::n-04-expansion-no"),
    "Handelt es sich um eine Erweiterungsinvestition? = Nein",
  );
});

test("reconciliation contextualizes choice fields from sequential visual regions", () => {
  const intent = baseIntent();
  intent.detectedFields = [
    {
      id: "s1::field::n-01-net",
      screenId: "s1",
      trace: { nodeId: "n-01-net", nodeName: "Typography" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Netto",
      type: "radio_option",
    },
    {
      id: "s1::field::n-02-gross",
      screenId: "s1",
      trace: { nodeId: "n-02-gross", nodeName: "Typography" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Brutto",
      type: "radio_option",
    },
  ];
  const visual: VisualScreenDescription[] = [
    {
      screenId: "s1",
      sidecarDeployment: "mock",
      regions: [
        {
          regionId: "question",
          controlType: "label",
          label: "Wie soll der Kaufpreis erfasst werden?",
          confidence: 0.9,
        },
        {
          regionId: "net",
          controlType: "radio-button",
          label: "Netto",
          confidence: 0.9,
        },
        {
          regionId: "gross",
          controlType: "radio-button",
          label: "Brutto",
          confidence: 0.9,
        },
      ],
      confidenceSummary: { min: 0.9, max: 0.9, mean: 0.9 },
    },
  ];

  const result = reconcileSources({ figmaIntent: intent, visual });

  assert.deepEqual(
    result.detectedFields.map((field) => field.label),
    [
      "Wie soll der Kaufpreis erfasst werden? = Netto",
      "Wie soll der Kaufpreis erfasst werden? = Brutto",
    ],
  );
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

test("reconciliation ignores non-actionable visual layout validation hints", () => {
  const visual: VisualScreenDescription[] = [
    {
      screenId: "s1",
      sidecarDeployment: "mock",
      regions: [
        {
          regionId: "table-header",
          label: "Name Rolle Geburtsdatum",
          confidence: 0.9,
          validationHints: ["table-header"],
        },
        {
          regionId: "table-row-1",
          label: "Meyer Technology GmbH",
          confidence: 0.9,
          validationHints: ["table-row"],
        },
        {
          regionId: "button-add-person",
          label: "Person hinzufügen",
          confidence: 0.9,
          validationHints: ["button"],
        },
      ],
      confidenceSummary: { min: 0.9, max: 0.9, mean: 0.9 },
    },
  ];

  const result = reconcileSources({ figmaIntent: baseIntent(), visual });

  assert.equal(result.detectedValidations.length, 0);
});

test("reconciliation redacts visual-only PII before serializing the IR", () => {
  const visual: VisualScreenDescription[] = [
    {
      screenId: "s1",
      sidecarDeployment: "mock",
      regions: [
        {
          regionId: "n-name",
          controlType: "text_input",
          label: "Max Mustermann",
          ambiguity: { reason: "State-derived from Max Mustermann" },
          confidence: 0.93,
        },
        {
          regionId: "n-email",
          controlType: "text_input",
          visibleText: "max.mustermann@sparkasse.de",
          confidence: 0.92,
        },
        {
          regionId: "n-pan",
          controlType: "text_input",
          label: "4111111111111111",
          confidence: 0.91,
        },
        {
          regionId: "n-iban",
          controlType: "text_input",
          label: "Account details",
          validationHints: ["Use DE89370400440532013000"],
          confidence: 0.9,
        },
      ],
      confidenceSummary: { min: 0.9, max: 0.93, mean: 0.915 },
    },
  ];

  const result = reconcileSources({
    figmaIntent: visualOnlyIntent(),
    visual,
  });
  const serialized = JSON.stringify(result);

  for (const pii of [
    "Max Mustermann",
    "max.mustermann@sparkasse.de",
    "4111111111111111",
    "DE89370400440532013000",
  ]) {
    assert.equal(
      serialized.includes(pii),
      false,
      `PII substring ${pii} leaked into serialized IR`,
    );
  }

  const labels = result.detectedFields.map((field) => field.label);
  assert(labels.includes("[REDACTED:FULL_NAME]"));
  assert(labels.includes("[REDACTED:EMAIL]"));
  assert(labels.includes("[REDACTED:PAN]"));

  const ambiguity = result.detectedFields.find(
    (field) => field.id === "s1::field::visual::n-name",
  )?.ambiguity?.reason;
  assert.equal(ambiguity, "[REDACTED:FULL_NAME]");

  const validation = result.detectedValidations[0];
  assert.equal(validation?.rule, "[REDACTED:IBAN]");
  assert.match(validation?.id ?? "", /\[REDACTED:IBAN]/);

  const kinds = new Set(result.piiIndicators.map((indicator) => indicator.kind));
  assert(kinds.has("full_name"));
  assert(kinds.has("email"));
  assert(kinds.has("pan"));
  assert(kinds.has("iban"));
});

test("reconciliation records visual sidecar piiFlags without original values", () => {
  const visual: VisualScreenDescription[] = [
    {
      screenId: "s1",
      sidecarDeployment: "mock",
      regions: [
        {
          regionId: "n-unknown",
          controlType: "text_input",
          label: "Customer reference",
          confidence: 0.81,
        },
      ],
      piiFlags: [
        {
          regionId: "n-unknown",
          kind: "tax_id",
          confidence: 0.66,
        },
      ],
      confidenceSummary: { min: 0.81, max: 0.81, mean: 0.81 },
    },
  ];

  const result = reconcileSources({
    figmaIntent: visualOnlyIntent(),
    visual,
  });

  assert.equal(result.detectedFields[0]?.label, "Customer reference");
  assert.equal(result.piiIndicators.length, 1);
  assert.equal(result.piiIndicators[0]?.kind, "tax_id");
  assert.equal(result.piiIndicators[0]?.redacted, "[REDACTED:TAX_ID]");
  assert.equal(result.redactions[0]?.replacement, "[REDACTED:TAX_ID]");
});
