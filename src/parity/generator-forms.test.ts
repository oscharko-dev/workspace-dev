import assert from "node:assert/strict";
import test from "node:test";
import { createDeterministicScreenFile } from "./generator-core.js";
import {
  buildSemanticInputModel,
  deriveSelectOptions,
  detectFormGroups,
  formatLocalizedNumber,
  getLocaleNumberFormatSpec,
  inferRequiredFromLabel,
  inferValidationMode,
  isLikelyGroupingPattern,
  isNumericSelectValueCandidate,
  isLikelyInputContainer,
  normalizeInputSemanticText,
  parseLocalizedNumber,
  registerInteractiveField,
  sanitizeRequiredLabel
} from "./generator-forms.js";
import type { IconFallbackResolver, RenderContext } from "./generator-render.js";
import { toStateKey } from "./generator-render.js";
import type { ScreenIR } from "./types.js";
import type { ScreenElementIR } from "./types.js";

const emptyIconResolver: IconFallbackResolver = {
  entries: [],
  byIconName: new Map(),
  exactAliasMap: new Map(),
  tokenIndex: new Map(),
  synonymMap: new Map()
};

const createRenderContext = (screenElements: ScreenElementIR[] = []): RenderContext => ({
  screenId: "screen-forms",
  screenName: "Forms",
  screenElements,
  currentFilePath: "src/screens/Forms.tsx",
  generationLocale: "de-DE",
  formHandlingMode: "react_hook_form",
  fields: [],
  accordions: [],
  tabs: [],
  dialogs: [],
  buttons: [],
  activeRenderElements: new Set(),
  renderNodeVisitCount: 0,
  interactiveDescendantCache: new Map(),
  meaningfulTextDescendantCache: new Map(),
  headingComponentByNodeId: new Map(),
  typographyVariantByNodeId: new Map(),
  accessibilityWarnings: [],
  muiImports: new Set(),
  iconImports: [],
  iconResolver: emptyIconResolver,
  imageAssetMap: {},
  routePathByScreenId: new Map(),
  usesRouterLink: false,
  usesNavigateHandler: false,
  prototypeNavigationRenderedCount: 0,
  mappedImports: [],
  spacingBase: 8,
  mappingByNodeId: new Map(),
  usedMappingNodeIds: new Set(),
  mappingWarnings: [],
  consumedFieldLabelNodeIds: new Set(),
  emittedWarningKeys: new Set(),
  emittedAccessibilityWarningKeys: new Set(),
  pageBackgroundColorNormalized: undefined,
  extractionInvocationByNodeId: new Map()
});

const makeNode = ({
  id,
  type,
  name = id,
  nodeType = "FRAME",
  ...overrides
}: {
  id: string;
  type: ScreenElementIR["type"];
  name?: string;
  nodeType?: string;
} & Omit<Partial<ScreenElementIR>, "id" | "type" | "name" | "nodeType">): ScreenElementIR => ({
  id,
  type,
  name,
  nodeType,
  ...overrides
});

const makeText = ({
  id,
  text,
  x = 0,
  y = 0,
  name = id,
  ...overrides
}: {
  id: string;
  text: string;
  x?: number;
  y?: number;
  name?: string;
} & Omit<Partial<ScreenElementIR>, "id" | "type" | "name" | "nodeType" | "text" | "x" | "y">): ScreenElementIR => ({
  id,
  name,
  nodeType: "TEXT",
  type: "text",
  text,
  x,
  y,
  ...overrides
});

const createDetachedFieldScreen = (): ScreenIR => ({
  id: "forms-regression-screen",
  name: "Forms Regression",
  layoutMode: "NONE",
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  fillColor: "#ffffff",
  children: [
    {
      id: "helper-text",
      name: "MuiTypographyRoot",
      nodeType: "TEXT",
      type: "text",
      text: "Bitte erfassen Sie die gewünschte monatliche Sparrate und den Zeitraum.",
      x: 32,
      y: 8,
      width: 420,
      height: 18
    },
    {
      id: "detached-label",
      name: "MuiTypographyRoot",
      nodeType: "TEXT",
      type: "text",
      text: "Zu welchem Monat soll die Besparung starten?",
      x: 32,
      y: 44,
      width: 300,
      height: 14
    },
    {
      id: "detached-input",
      name: "MuiInputRoot",
      nodeType: "FRAME",
      type: "input",
      x: 32,
      y: 68,
      width: 360,
      height: 24,
      children: [
        {
          id: "detached-value",
          name: "MuiInputBaseInput",
          nodeType: "TEXT",
          type: "text",
          text: "April 2026",
          x: 32,
          y: 68,
          width: 120,
          height: 20
        }
      ]
    }
  ]
});

const createEmbeddedLabelScreen = (): ScreenIR => ({
  id: "forms-embedded-screen",
  name: "Forms Embedded Label",
  layoutMode: "NONE",
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  fillColor: "#ffffff",
  children: [
    {
      id: "helper-text",
      name: "MuiTypographyRoot",
      nodeType: "TEXT",
      type: "text",
      text: "Bitte erfassen Sie den Zeitraum bis zum geplanten Bau oder Kauf.",
      x: 32,
      y: 8,
      width: 420,
      height: 18
    },
    {
      id: "input-with-label",
      name: "MuiInputBaseRoot",
      nodeType: "FRAME",
      type: "input",
      x: 32,
      y: 44,
      width: 360,
      height: 44,
      children: [
        {
          id: "embedded-label",
          name: "MuiTypographyRoot",
          nodeType: "TEXT",
          type: "text",
          text: "Monatliche Sparrate (optional)",
          x: 32,
          y: 44,
          width: 260,
          height: 14
        },
        {
          id: "embedded-value",
          name: "MuiInputBaseInput",
          nodeType: "TEXT",
          type: "text",
          text: "50,00",
          x: 32,
          y: 62,
          width: 72,
          height: 20
        }
      ]
    }
  ]
});

test("deterministic form rendering keeps helper text while consuming detached field labels", () => {
  const content = createDeterministicScreenFile(createDetachedFieldScreen()).content;

  assert.ok(content.includes("Bitte erfassen Sie die gewünschte monatliche Sparrate und den Zeitraum."));
  assert.ok(content.includes('label={"Zu welchem Monat soll die Besparung starten?"}'));
  assert.equal(content.includes('{"detached-label"}'), false);
});

test("deterministic form rendering preserves helper text when semantic model already has field label", () => {
  const content = createDeterministicScreenFile(createEmbeddedLabelScreen()).content;

  assert.ok(content.includes("Bitte erfassen Sie den Zeitraum bis zum geplanten Bau oder Kauf."));
  assert.ok(content.includes('label={"Monatliche Sparrate (optional)"}'));
});

test("deriveSelectOptions covers empty, year, numeric, percentage, and nominal defaults", () => {
  assert.deepEqual(deriveSelectOptions("", "de-DE"), ["Option 1", "Option 2", "Option 3"]);
  assert.deepEqual(deriveSelectOptions("10 Jahre", "de-DE"), ["10 Jahre", "5 Jahre", "15 Jahre"]);
  assert.deepEqual(deriveSelectOptions("50,00", "de-DE"), ["50,00", "45,00", "55,00"]);
  assert.deepEqual(deriveSelectOptions("10 %", "de-DE"), ["10 %", "9,75 %", "10,00 %", "10,25 %"]);
  assert.deepEqual(deriveSelectOptions("Tarif", "de-DE"), ["Tarif", "Tarif A", "Tarif B"]);
});

test("label helpers normalize semantic text and validation modes", () => {
  assert.equal(normalizeInputSemanticText("  User-Name / PLZ  "), "user name plz");
  assert.equal(inferRequiredFromLabel("Email *"), true);
  assert.equal(sanitizeRequiredLabel("Email * *"), "Email");
  assert.equal(inferValidationMode({ fields: [], hasVisualErrors: true }), "onTouched");
  assert.equal(
    inferValidationMode({
      fields: [
        { key: "a", label: "A", defaultValue: "", isSelect: false, options: [] },
        { key: "b", label: "B", defaultValue: "", isSelect: false, options: [] },
        { key: "c", label: "C", defaultValue: "", isSelect: false, options: [] },
        { key: "d", label: "D", defaultValue: "", isSelect: false, options: [] },
        { key: "e", label: "E", defaultValue: "", isSelect: false, options: [] }
      ],
      hasVisualErrors: false
    }),
    "onBlur"
  );
  assert.equal(
    inferValidationMode({
      fields: [{ key: "select", label: "Select", defaultValue: "", isSelect: true, options: [] }],
      hasVisualErrors: false
    }),
    "onSubmit"
  );
});

test("number parsing helpers normalize grouping, decimals, and invalid input deterministically", () => {
  const deSpec = getLocaleNumberFormatSpec("de-DE");
  assert.equal(deSpec.decimalSymbol, ",");
  assert.equal(getLocaleNumberFormatSpec("de-DE"), deSpec);

  assert.equal(isLikelyGroupingPattern({ value: "1.234.567", separator: "." }), true);
  assert.equal(isLikelyGroupingPattern({ value: "12.34", separator: "." }), false);
  assert.equal(isLikelyGroupingPattern({ value: "1234", separator: "." }), false);

  assert.equal(parseLocalizedNumber("1.234,56", "de-DE"), 1234.56);
  assert.equal(parseLocalizedNumber("1,234.56", "en-US"), 1234.56);
  assert.equal(parseLocalizedNumber("1 234,56", "de-DE"), 1234.56);
  assert.equal(parseLocalizedNumber("−12,5", "de-DE"), -12.5);
  assert.equal(parseLocalizedNumber("1.234.567", "de-DE"), 1234567);
  assert.equal(parseLocalizedNumber("not-a-number", "de-DE"), undefined);
  assert.equal(parseLocalizedNumber("++", "de-DE"), undefined);

  assert.equal(formatLocalizedNumber(1234.5, 2, "de-DE"), "1.234,50");
  assert.equal(isNumericSelectValueCandidate("10 %"), true);
  assert.equal(isNumericSelectValueCandidate("10 Jahre"), false);
  assert.equal(isNumericSelectValueCandidate(""), false);
});

test("isLikelyInputContainer accepts visual field shells and rejects sliders and multi-input hosts", () => {
  const shell = makeNode({
    id: "shell",
    type: "container",
    width: 240,
    height: 56,
    fillColor: "#ffffff",
    strokeColor: "#d0d0d0",
    children: [
      makeText({ id: "label", text: "Amount", x: 16, y: 8 }),
      makeText({ id: "value", text: "50,00", x: 16, y: 30 })
    ]
  });
  assert.equal(isLikelyInputContainer(shell), true);

  const sliderHost = makeNode({
    id: "slider-host",
    type: "container",
    width: 240,
    height: 56,
    name: "Slider shell",
    children: [makeNode({ id: "slider", type: "slider", name: "MuiSlider" })]
  });
  assert.equal(isLikelyInputContainer(sliderHost), false);

  const multiInputHost = makeNode({
    id: "multi-input-host",
    type: "container",
    width: 240,
    height: 56,
    fillColor: "#ffffff",
    children: [makeNode({ id: "input-a", type: "input" }), makeNode({ id: "input-b", type: "select" })]
  });
  assert.equal(isLikelyInputContainer(multiInputHost), false);
});

test("buildSemanticInputModel detects placeholder rows, label icons, suffix text, select indicators, and adornments", () => {
  const currencyField = makeNode({
    id: "currency-field",
    type: "input",
    x: 0,
    y: 0,
    width: 220,
    height: 56,
    children: [
      makeNode({
        id: "label-icon",
        type: "container",
        name: "icon/info",
        x: 0,
        y: 2,
        width: 12,
        height: 12,
        vectorPaths: ["M0 0L10 10"],
        fillColor: "#0f172a"
      }),
      makeText({ id: "label-text", text: "Amount", x: 18, y: 0 }),
      makeText({ id: "placeholder-text", text: "0,00", x: 18, y: 24, textRole: "placeholder" }),
      makeText({ id: "value-text", text: "50,00", x: 72, y: 24 }),
      makeText({ id: "suffix-text", text: "€", x: 188, y: 24 })
    ]
  });
  const currencyModel = buildSemanticInputModel(currencyField);
  assert.equal(currencyModel.labelNode?.id, "label-text");
  assert.equal(currencyModel.placeholderNode?.id, "placeholder-text");
  assert.equal(currencyModel.valueNode?.id, "value-text");
  assert.equal(currencyModel.labelIcon?.paths.length, 1);
  assert.equal(currencyModel.suffixText, "€");
  assert.equal(currencyModel.isSelect, false);

  const selectField = makeNode({
    id: "select-field",
    type: "input",
    x: 0,
    y: 0,
    width: 220,
    height: 56,
    children: [
      makeText({ id: "select-label", text: "Laufzeit", x: 18, y: 0 }),
      makeText({ id: "select-value", text: "10 Jahre", x: 18, y: 24 }),
      makeNode({
        id: "select-icon",
        type: "container",
        name: "icon/expand-more",
        x: 190,
        y: 24,
        width: 16,
        height: 16,
        vectorPaths: ["M0 0L10 10"]
      })
    ]
  });
  const selectModel = buildSemanticInputModel(selectField);
  assert.equal(selectModel.isSelect, true);
  assert.equal(selectModel.suffixIcon?.paths.length, 1);

  const adornedField = makeNode({
    id: "adorned-field",
    type: "input",
    x: 0,
    y: 0,
    width: 220,
    height: 56,
    children: [
      makeText({ id: "adorned-label", text: "Rate", x: 18, y: 0 }),
      makeText({ id: "adorned-value", text: "50,00", x: 18, y: 24 }),
      makeNode({
        id: "adornment-root",
        type: "container",
        name: "MuiInputAdornmentRoot",
        x: 180,
        y: 24,
        width: 24,
        height: 16
      })
    ]
  });
  const adornedModel = buildSemanticInputModel(adornedField);
  assert.equal(adornedModel.suffixText, "€");
});

test("registerInteractiveField consumes nearby labels, infers validation metadata, deduplicates, and preserves form groups", () => {
  const emailLabel = makeText({
    id: "email-label",
    text: "Email *",
    x: 32,
    y: 12
  });
  const emailField = makeNode({
    id: "email-field",
    type: "input",
    name: "MuiInputBaseRoot",
    x: 32,
    y: 40,
    width: 280,
    height: 48,
    strokeColor: "#d32f2f",
    children: [
      makeNode({
        id: "email-outline",
        type: "container",
        name: "MuiNotchedOutline",
        strokeColor: "#d32f2f"
      })
    ]
  });
  const emailContext = createRenderContext([emailLabel, emailField]);
  const emailModel = {
    labelNode: makeText({ id: "impl-label", text: "MuiInputBaseRoot" }),
    valueNode: makeText({ id: "email-value", text: "name@example.com" }),
    placeholderNode: makeText({ id: "email-placeholder", text: "name@example.com", textRole: "placeholder" }),
    isSelect: false
  };

  const createdEmailField = registerInteractiveField({
    context: emailContext,
    element: emailField,
    model: emailModel
  });

  assert.equal(createdEmailField.key, toStateKey(emailField));
  assert.equal(createdEmailField.label, "Email");
  assert.equal(createdEmailField.required, true);
  assert.equal(createdEmailField.inputType, "email");
  assert.equal(createdEmailField.autoComplete, "email");
  assert.equal(createdEmailField.validationType, "email");
  assert.equal(createdEmailField.hasVisualErrorExample, true);
  assert.equal(emailContext.consumedFieldLabelNodeIds?.has("email-label"), true);

  const dedupedEmailField = registerInteractiveField({
    context: emailContext,
    element: emailField,
    model: emailModel
  });
  assert.equal(dedupedEmailField, createdEmailField);
  assert.equal(emailContext.fields.length, 1);

  const selectField = makeNode({
    id: "duration-field",
    type: "input",
    name: "MuiSelectSelect",
    x: 32,
    y: 120,
    width: 240,
    height: 48
  });
  const selectContext = createRenderContext([selectField]);
  selectContext.currentFormGroupId = "formGroup1";
  const createdSelectField = registerInteractiveField({
    context: selectContext,
    element: selectField,
    model: {
      labelNode: makeText({ id: "duration-label", text: "Laufzeit" }),
      valueNode: makeText({ id: "duration-value", text: "10 Jahre" }),
      isSelect: true
    }
  });

  assert.deepEqual(createdSelectField.options, ["10 Jahre", "5 Jahre", "15 Jahre"]);
  assert.equal(createdSelectField.formGroupId, "formGroup1");
});

test("detectFormGroups groups multiple form sections and ignores single-section layouts", () => {
  const multiGroupChildren: ScreenElementIR[] = [
    makeNode({ id: "intro-field", type: "input" }),
    makeText({ id: "intro-copy", text: "Helper copy" }),
    makeNode({ id: "intro-submit", type: "button" }),
    makeText({ id: "body-copy", text: "Informational copy" }),
    makeNode({ id: "details-field", type: "input" }),
    makeNode({ id: "details-submit", type: "button" })
  ];
  assert.deepEqual(detectFormGroups(multiGroupChildren), [
    {
      groupId: "formGroup0",
      childIndices: [0, 1, 2]
    },
    {
      groupId: "formGroup1",
      childIndices: [4, 5]
    }
  ]);

  assert.deepEqual(
    detectFormGroups([makeNode({ id: "single-field", type: "input" }), makeNode({ id: "single-submit", type: "button" })]),
    []
  );
});
