import assert from "node:assert/strict";
import test from "node:test";
import {
  BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
  type VisualScreenDescription,
} from "../contracts/index.js";
import {
  deriveBusinessTestIntentIr,
  type IntentDerivationFigmaInput,
} from "./intent-derivation.js";

const simpleForm: IntentDerivationFigmaInput = {
  source: { kind: "figma_local_json" },
  screens: [
    {
      screenId: "screen-login",
      screenName: "Login",
      nodes: [
        {
          nodeId: "node-username",
          nodeName: "Username input",
          nodeType: "TEXT_INPUT",
          text: "Username",
        },
        {
          nodeId: "node-submit",
          nodeName: "Submit",
          nodeType: "BUTTON",
          text: "Submit",
        },
      ],
    },
  ],
};

test("derivation emits fields and first-class interactions for a basic form", () => {
  const ir = deriveBusinessTestIntentIr({ figma: simpleForm });
  assert.equal(ir.version, BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION);
  assert.equal(ir.detectedFields.length, 1);
  assert.equal(ir.detectedActions.length, 2);
  const [field] = ir.detectedFields;
  const [action] = ir.detectedActions;
  assert.equal(field?.trace.nodeId, "node-username");
  assert.equal(field?.label, "Username");
  assert.equal(action?.trace.nodeId, "node-submit");
  assert.equal(action?.label, "Submit");
  assert.ok(
    ir.detectedActions.some(
      (candidate) =>
        candidate.trace.nodeId === "node-username" &&
        candidate.kind === "change_input",
    ),
  );
  assert.equal(ir.piiIndicators.length, 0);
  assert.equal(ir.redactions.length, 0);
});

test("derivation models radio, select, and amount inputs as interactions", () => {
  const figma: IntentDerivationFigmaInput = {
    source: { kind: "figma_local_json" },
    screens: [
      {
        screenId: "loan",
        screenName: "Loan calculator",
        nodes: [
          {
            nodeId: "netto",
            nodeName: "Netto option",
            nodeType: "RADIO_OPTION",
            text: "Netto",
          },
          {
            nodeId: "vat-rate",
            nodeName: "VAT rate select",
            nodeType: "SELECT_FIELD",
            text: "MwSt.",
          },
          {
            nodeId: "purchase-price",
            nodeName: "Purchase price",
            nodeType: "TEXT_INPUT",
            text: "Kaufpreis",
          },
        ],
      },
    ],
  };
  const ir = deriveBusinessTestIntentIr({ figma });
  assert.deepEqual(
    ir.detectedActions.map((action) => [action.trace.nodeId, action.kind]),
    [
      ["netto", "select_radio_option"],
      ["purchase-price", "change_input"],
      ["vat-rate", "change_select"],
    ],
  );
});

test("derivation does not promote raw typography text into input fields", () => {
  const figma: IntentDerivationFigmaInput = {
    source: { kind: "figma_local_json" },
    screens: [
      {
        screenId: "participants",
        screenName: "Participants",
        nodes: [
          {
            nodeId: "role-static",
            nodeName: "Typography",
            nodeType: "TEXT",
            text: "Sicherungsgeber",
          },
          {
            nodeId: "date-static",
            nodeName: "Typography",
            nodeType: "TEXT",
            text: "01.01.1970",
          },
          {
            nodeId: "role-select",
            nodeName: "Role select",
            nodeType: "SELECT_FIELD",
            text: "Rolle",
          },
        ],
      },
    ],
  };
  const ir = deriveBusinessTestIntentIr({ figma });
  assert.deepEqual(
    ir.detectedFields.map((field) => [field.trace.nodeId, field.type]),
    [["role-select", "select_field"]],
  );
  assert.deepEqual(
    ir.detectedActions.map((action) => [action.trace.nodeId, action.kind]),
    [["role-select", "change_select"]],
  );
});

test("derivation is deterministic across two runs with the same input", () => {
  const a = deriveBusinessTestIntentIr({ figma: simpleForm });
  const b = deriveBusinessTestIntentIr({ figma: simpleForm });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("derivation source hash ignores volatile visual sidecar metadata", () => {
  const visualBase = {
    screenId: "screen-login",
    sidecarDeployment: "llama-4-maverick-vision",
    screenName: "Login",
    confidenceSummary: { min: 0.72, max: 0.99, mean: 0.86 },
    regions: [
      {
        regionId: "r-username",
        confidence: 0.72,
        label: "Username",
        controlType: "input",
        visibleText: "Username",
      },
    ],
  } satisfies Omit<VisualScreenDescription, "capturedAt">;
  const first = deriveBusinessTestIntentIr({
    figma: simpleForm,
    visual: [{ ...visualBase, capturedAt: "2026-05-12T10:00:00.000Z" }],
  });
  const second = deriveBusinessTestIntentIr({
    figma: simpleForm,
    visual: [
      {
        ...visualBase,
        capturedAt: "2026-05-12T10:05:00.000Z",
        confidenceSummary: { min: 0.61, max: 0.93, mean: 0.79 },
        regions: [{ ...visualBase.regions[0]!, confidence: 0.61 }],
      },
    ],
  });

  assert.equal(first.source.contentHash, second.source.contentHash);
  assert.equal(JSON.stringify({ ...first, source: undefined }), JSON.stringify({ ...second, source: undefined }));
});

test("derivation output is stable when node order is shuffled", () => {
  const shuffled: IntentDerivationFigmaInput = {
    ...simpleForm,
    screens: simpleForm.screens.map((screen) => ({
      ...screen,
      nodes: [...screen.nodes].reverse(),
    })),
  };
  const a = deriveBusinessTestIntentIr({ figma: simpleForm });
  const b = deriveBusinessTestIntentIr({ figma: shuffled });
  // contentHash will differ because it is over raw input, but element IDs and
  // all sorted arrays must match.
  assert.deepEqual(
    a.detectedFields.map((f) => f.id),
    b.detectedFields.map((f) => f.id),
  );
  assert.deepEqual(
    a.detectedActions.map((f) => f.id),
    b.detectedActions.map((f) => f.id),
  );
});

test("derivation degrades gracefully when optional fields are missing", () => {
  const minimal: IntentDerivationFigmaInput = {
    source: { kind: "figma_plugin" },
    screens: [
      {
        screenId: "s1",
        screenName: "Empty",
        nodes: [],
      },
    ],
  };
  const ir = deriveBusinessTestIntentIr({ figma: minimal });
  assert.equal(ir.screens.length, 1);
  assert.equal(ir.detectedFields.length, 0);
  assert.equal(ir.detectedActions.length, 0);
  assert.equal(ir.detectedValidations.length, 0);
});

test("derivation redacts PII in default values and records indicators", () => {
  const withPii: IntentDerivationFigmaInput = {
    source: { kind: "figma_local_json" },
    screens: [
      {
        screenId: "pay",
        screenName: "Pay",
        nodes: [
          {
            nodeId: "iban-in",
            nodeName: "IBAN",
            nodeType: "TEXT_INPUT",
            text: "IBAN",
            defaultValue: "DE89 3704 0044 0532 0130 00",
          },
        ],
      },
    ],
  };
  const ir = deriveBusinessTestIntentIr({ figma: withPii });
  assert.equal(ir.detectedFields[0]?.defaultValue, "[REDACTED:IBAN]");
  assert.equal(ir.piiIndicators.length, 1);
  assert.equal(ir.piiIndicators[0]?.kind, "iban");
  assert.equal(ir.redactions.length, 1);
  assert.equal(ir.redactions[0]?.kind, "iban");
  assert.equal(ir.redactions[0]?.replacement, "[REDACTED:IBAN]");
});

test("derivation produces a trace.nodeId for every detected element", () => {
  const ir = deriveBusinessTestIntentIr({ figma: simpleForm });
  for (const f of ir.detectedFields)
    assert.equal(typeof f.trace.nodeId, "string");
  for (const a of ir.detectedActions)
    assert.equal(typeof a.trace.nodeId, "string");
});
