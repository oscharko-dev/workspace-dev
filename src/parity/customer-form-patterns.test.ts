// ---------------------------------------------------------------------------
// customer-form-patterns.test.ts — Acceptance tests for issue #693
// DatePicker-Provider wiring, Banking-Input prioritisation, DynamicTypography
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  renderSemanticInput,
  renderText,
  DYNAMIC_TYPOGRAPHY_VARIANT_CATALOG,
  resolveDynamicTypographyVariant
} from "./templates/screen-template.js";
import { resolveExplicitBoardComponentFromNode } from "./ir-classification.js";
import type { RenderContext, VirtualParent, IconFallbackResolver } from "./generator-render.js";
import type { ScreenElementIR, TextElementIR } from "./types.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const emptyIconResolver: IconFallbackResolver = {
  entries: [],
  byIconName: new Map(),
  exactAliasMap: new Map(),
  tokenIndex: new Map(),
  synonymMap: new Map()
};

const rootParent: VirtualParent = {
  x: 0,
  y: 0,
  width: 1440,
  height: 900,
  layoutMode: "VERTICAL"
};

const createRenderContext = (
  overrides: Partial<RenderContext> = {}
): RenderContext => ({
  screenId: "screen-1",
  screenName: "TestScreen",
  screenElements: [],
  currentFilePath: "src/screens/TestScreen.tsx",
  generationLocale: "de-DE",
  formHandlingMode: "react_hook_form",
  hasScreenFormFields: true,
  primarySubmitButtonKey: "",
  fields: [],
  accordions: [],
  tabs: [],
  dialogs: [],
  buttons: [],
  activeRenderElements: new Set<ScreenElementIR>(),
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
  extractionInvocationByNodeId: new Map(),
  specializedComponentMappings: {},
  requiresChangeEventTypeImport: false,
  ...overrides
});

const makeInputElement = (overrides: Partial<ScreenElementIR> = {}): ScreenElementIR => ({
  id: "node-test-input",
  name: "Test Input",
  nodeType: "INSTANCE",
  type: "input",
  x: 0,
  y: 0,
  width: 240,
  height: 56,
  layoutMode: "NONE",
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  ...overrides
});

// ---------------------------------------------------------------------------
// AC 1: DatePicker screens receive required provider wiring
// ---------------------------------------------------------------------------

describe("DatePicker-Provider wiring (#693 AC-1)", () => {
  it("classifies DatePicker INSTANCE nodes as input with DatePicker semanticType", () => {
    const match = resolveExplicitBoardComponentFromNode({
      type: "INSTANCE",
      name: "DatePicker, State=Single"
    });
    assert.ok(match);
    assert.equal(match.canonicalName, "DatePicker");
    assert.equal(match.type, "input");
  });

  it("renders DatePicker component instead of TextField", () => {
    const context = createRenderContext();
    const element = makeInputElement({
      id: "node-date-picker",
      name: "DatePicker",
      semanticType: "DatePicker",
      semanticSource: "board"
    });
    const rendered = renderSemanticInput(element, 3, rootParent, context);
    assert.ok(rendered.includes("DatePicker"), "Expected DatePicker component in rendered output");
    assert.ok(!rendered.includes("<TextField"), "Expected no TextField in DatePicker rendering");
  });

  it("sets usesDatePicker flag on render context", () => {
    const context = createRenderContext();
    const element = makeInputElement({
      id: "node-date-picker-flag",
      name: "DatePicker",
      semanticType: "DatePicker",
      semanticSource: "board"
    });
    renderSemanticInput(element, 3, rootParent, context);
    assert.equal(context.usesDatePicker, true);
  });

  it("does not set usesDatePicker for generic inputs", () => {
    const context = createRenderContext();
    const element = makeInputElement({
      id: "node-generic-input",
      name: "Email Input"
    });
    renderSemanticInput(element, 3, rootParent, context);
    assert.ok(!context.usesDatePicker, "usesDatePicker should remain falsy for generic inputs");
  });

  it("renders DatePicker with Controller wrapper in RHF mode", () => {
    const context = createRenderContext({ formHandlingMode: "react_hook_form" });
    const element = makeInputElement({
      id: "node-dp-rhf",
      name: "DatePicker",
      semanticType: "DatePicker",
      semanticSource: "board"
    });
    const rendered = renderSemanticInput(element, 3, rootParent, context);
    assert.ok(rendered.includes("Controller"), "Expected Controller wrapper for RHF mode");
    assert.ok(rendered.includes("controllerField.onChange"), "Expected onChange binding");
  });

  it("renders DatePicker with direct form state in legacy mode", () => {
    const context = createRenderContext({ formHandlingMode: "legacy" });
    const element = makeInputElement({
      id: "node-dp-legacy",
      name: "DatePicker",
      semanticType: "DatePicker",
      semanticSource: "board"
    });
    const rendered = renderSemanticInput(element, 3, rootParent, context);
    assert.ok(!rendered.includes("Controller"), "Expected no Controller in legacy mode");
    assert.ok(rendered.includes("updateFieldValue"), "Expected direct state update");
  });
});

// ---------------------------------------------------------------------------
// AC 2: Banking inputs preferred when available and permitted
// ---------------------------------------------------------------------------

describe("Banking-Input prioritisation (#693 AC-2)", () => {
  it("classifies InputCurrency before generic Input", () => {
    const match = resolveExplicitBoardComponentFromNode({
      type: "INSTANCE",
      name: "InputCurrency"
    });
    assert.ok(match);
    assert.equal(match.canonicalName, "InputCurrency");
    assert.equal(match.type, "input");
  });

  it("classifies InputIBAN before generic Input", () => {
    const match = resolveExplicitBoardComponentFromNode({
      type: "INSTANCE",
      name: "InputIBAN"
    });
    assert.ok(match);
    assert.equal(match.canonicalName, "InputIBAN");
    assert.equal(match.type, "input");
  });

  it("classifies InputTAN before generic Input", () => {
    const match = resolveExplicitBoardComponentFromNode({
      type: "INSTANCE",
      name: "InputTAN"
    });
    assert.ok(match);
    assert.equal(match.canonicalName, "InputTAN");
    assert.equal(match.type, "input");
  });

  it("renders InputCurrency with euro adornment and decimal inputMode", () => {
    const context = createRenderContext();
    const element = makeInputElement({
      id: "node-currency",
      name: "InputCurrency",
      semanticType: "InputCurrency",
      semanticSource: "board"
    });
    const rendered = renderSemanticInput(element, 3, rootParent, context);
    assert.ok(rendered.includes("InputAdornment"), "Expected InputAdornment for currency");
    assert.ok(rendered.includes("\\u20AC") || rendered.includes("\u20AC"), "Expected euro symbol");
    assert.ok(rendered.includes('"decimal"'), "Expected decimal inputMode");
    assert.ok(rendered.includes("currency input"), "Expected currency aria-roledescription");
  });

  it("renders InputIBAN with text inputMode and IBAN placeholder", () => {
    const context = createRenderContext();
    const element = makeInputElement({
      id: "node-iban",
      name: "InputIBAN",
      semanticType: "InputIBAN",
      semanticSource: "board"
    });
    const rendered = renderSemanticInput(element, 3, rootParent, context);
    assert.ok(rendered.includes("DE00 0000"), "Expected IBAN placeholder format");
    assert.ok(rendered.includes("IBAN input"), "Expected IBAN aria-roledescription");
  });

  it("renders InputTAN with numeric inputMode and TAN placeholder", () => {
    const context = createRenderContext();
    const element = makeInputElement({
      id: "node-tan",
      name: "InputTAN",
      semanticType: "InputTAN",
      semanticSource: "board"
    });
    const rendered = renderSemanticInput(element, 3, rootParent, context);
    assert.ok(rendered.includes('"numeric"'), "Expected numeric inputMode for TAN");
    assert.ok(rendered.includes("000000"), "Expected 6-digit TAN placeholder");
    assert.ok(rendered.includes("TAN input"), "Expected TAN aria-roledescription");
  });

  it("banking inputs register MUI TextField and InputAdornment imports", () => {
    const context = createRenderContext();
    const element = makeInputElement({
      id: "node-currency-imports",
      name: "InputCurrency",
      semanticType: "InputCurrency",
      semanticSource: "board"
    });
    renderSemanticInput(element, 3, rootParent, context);
    assert.ok(context.muiImports.has("TextField"), "Expected TextField import");
    assert.ok(context.muiImports.has("InputAdornment"), "Expected InputAdornment import");
  });

  it("falls back to generic TextField for non-banking input elements", () => {
    const context = createRenderContext();
    const element = makeInputElement({
      id: "node-email",
      name: "Email"
    });
    const rendered = renderSemanticInput(element, 3, rootParent, context);
    assert.ok(rendered.includes("<TextField"), "Expected generic TextField");
    assert.ok(!rendered.includes("aria-roledescription"), "Expected no banking-specific ARIA");
  });
});

// ---------------------------------------------------------------------------
// AC 3: DynamicTypography variants derived from catalogued Storybook variants
// ---------------------------------------------------------------------------

describe("DynamicTypography variant mapping (#693 AC-3)", () => {
  it("classifies DynamicTypography separately from Typography", () => {
    const dynamicMatch = resolveExplicitBoardComponentFromNode({
      type: "INSTANCE",
      name: "DynamicTypography"
    });
    assert.ok(dynamicMatch);
    assert.equal(dynamicMatch.canonicalName, "DynamicTypography");
    assert.equal(dynamicMatch.type, "text");

    const plainMatch = resolveExplicitBoardComponentFromNode({
      type: "INSTANCE",
      name: "Typography"
    });
    assert.ok(plainMatch);
    assert.equal(plainMatch.canonicalName, "Typography");
    assert.equal(plainMatch.type, "text");
  });

  it("resolves angle-bracket <Dynamic Typography> to DynamicTypography", () => {
    const match = resolveExplicitBoardComponentFromNode({
      type: "INSTANCE",
      name: "<Dynamic Typography>"
    });
    assert.ok(match);
    assert.equal(match.canonicalName, "DynamicTypography");
    assert.equal(match.type, "text");
  });

  it("maps variant properties to MUI typography variants via catalog", () => {
    assert.equal(
      resolveDynamicTypographyVariant({
        id: "dt-1",
        name: "DynamicTypography",
        nodeType: "INSTANCE",
        type: "text",
        text: "Title",
        variantMapping: {
          properties: { Size: "display-large" }
        }
      } as TextElementIR),
      "h1"
    );
  });

  it("matches Storybook variant keys from DynamicTypography candidates case-insensitively", () => {
    const context = createRenderContext({
      storybookTypographyVariants: {
        "H1-light": {
          fontFamily: "Storybook Sans",
          fontSizePx: 32,
          fontWeight: 700,
          lineHeight: 40,
          letterSpacing: "0em"
        }
      }
    });
    assert.equal(
      resolveDynamicTypographyVariant(
        {
          id: "dt-1b",
          name: "<Dynamic Typography>, Variant=h1 light",
          nodeType: "INSTANCE",
          type: "text",
          text: "Title",
          semanticType: "DynamicTypography",
          variantMapping: {
            properties: { Variant: "h1 light" }
          }
        } as TextElementIR,
        context
      ),
      "H1-light"
    );
  });

  it("falls back to Storybook style scoring when DynamicTypography candidates do not match", () => {
    const context = createRenderContext({
      storybookTypographyVariants: {
        displayLg: {
          fontFamily: "Storybook Sans",
          fontSizePx: 32,
          fontWeight: 700,
          lineHeight: 40,
          letterSpacing: "0em"
        },
        bodyMd: {
          fontFamily: "Storybook Sans",
          fontSizePx: 16,
          fontWeight: 400,
          lineHeight: 24,
          letterSpacing: "0em"
        }
      }
    });
    assert.equal(
      resolveDynamicTypographyVariant(
        {
          id: "dt-1c",
          name: "Dynamic Typography",
          nodeType: "INSTANCE",
          type: "text",
          text: "Title",
          semanticType: "DynamicTypography",
          fontFamily: "Storybook Sans",
          fontSize: 32,
          fontWeight: 700,
          lineHeight: 40
        } as TextElementIR,
        context
      ),
      "displayLg"
    );
  });

  it("does not use static DynamicTypography fallback when Storybook variants are available but unresolved", () => {
    const context = createRenderContext({
      storybookTypographyVariants: {
        displayLg: {
          fontFamily: "Storybook Sans",
          fontSizePx: 32,
          fontWeight: 700,
          lineHeight: 40,
          letterSpacing: "0em"
        }
      }
    });
    assert.equal(
      resolveDynamicTypographyVariant(
        {
          id: "dt-1d",
          name: "headline-medium",
          nodeType: "INSTANCE",
          type: "text",
          text: "Title",
          semanticType: "DynamicTypography",
          fontFamily: "Storybook Sans",
          fontSize: 12,
          fontWeight: 300,
          lineHeight: 14
        } as TextElementIR,
        context
      ),
      undefined
    );
  });

  it("maps name-based tokens to MUI typography variants", () => {
    assert.equal(
      resolveDynamicTypographyVariant({
        id: "dt-2",
        name: "body-medium",
        nodeType: "INSTANCE",
        type: "text",
        text: "Content"
      } as TextElementIR),
      "body2"
    );
  });

  it("returns undefined for unknown variant tokens", () => {
    assert.equal(
      resolveDynamicTypographyVariant({
        id: "dt-3",
        name: "custom-variant",
        nodeType: "INSTANCE",
        type: "text",
        text: "Custom"
      } as TextElementIR),
      undefined
    );
  });

  it("catalog covers all standard Material Design typography roles", () => {
    const catalogKeys = [...DYNAMIC_TYPOGRAPHY_VARIANT_CATALOG.keys()];
    const expectedRoles = [
      "display-large",
      "display-medium",
      "display-small",
      "headline-large",
      "headline-medium",
      "headline-small",
      "title-large",
      "title-medium",
      "body-large",
      "body-medium",
      "body-small",
      "label-large",
      "label-medium",
      "label-small"
    ];
    for (const role of expectedRoles) {
      assert.ok(catalogKeys.includes(role), `Expected catalog to contain '${role}'`);
    }
  });

  it("renders DynamicTypography with resolved variant in Typography output", () => {
    const context = createRenderContext();
    const element: TextElementIR = {
      id: "dt-render-1",
      name: "headline-medium",
      nodeType: "INSTANCE",
      type: "text",
      text: "Welcome",
      semanticType: "DynamicTypography",
      semanticSource: "board",
      layoutMode: "NONE",
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 }
    };
    const rendered = renderText(element, 3, rootParent, context);
    assert.ok(rendered.includes('variant="h5"'), `Expected variant="h5" for headline-medium, got: ${rendered}`);
    assert.ok(rendered.includes("<Typography"), "Expected Typography component");
  });

  it("does not apply DynamicTypography variant for plain Typography elements", () => {
    const context = createRenderContext();
    const element: TextElementIR = {
      id: "plain-typo-1",
      name: "headline-medium",
      nodeType: "INSTANCE",
      type: "text",
      text: "Welcome",
      semanticType: "Typography",
      semanticSource: "board",
      layoutMode: "NONE",
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 }
    };
    const rendered = renderText(element, 3, rootParent, context);
    assert.ok(!rendered.includes('variant="h5"'), "Plain Typography should not get DynamicTypography variant mapping");
  });
});

// ---------------------------------------------------------------------------
// AC 4: Existing RHF/Zod scaffolding remains intact
// ---------------------------------------------------------------------------

describe("RHF/Zod scaffolding integrity (#693 AC-4)", () => {
  it("generic input with RHF still renders Controller + TextField", () => {
    const context = createRenderContext({ formHandlingMode: "react_hook_form" });
    const element = makeInputElement({
      id: "node-rhf-intact",
      name: "Username"
    });
    const rendered = renderSemanticInput(element, 3, rootParent, context);
    assert.ok(rendered.includes("Controller"), "Expected Controller for RHF mode");
    assert.ok(rendered.includes("<TextField"), "Expected TextField");
    assert.ok(rendered.includes("controllerField.onChange"), "Expected controller field binding");
    assert.ok(rendered.includes("controllerField.onBlur"), "Expected blur handler binding");
  });

  it("generic input with legacy mode still renders inline form state", () => {
    const context = createRenderContext({ formHandlingMode: "legacy" });
    const element = makeInputElement({
      id: "node-legacy-intact",
      name: "Password"
    });
    const rendered = renderSemanticInput(element, 3, rootParent, context);
    assert.ok(!rendered.includes("Controller"), "Expected no Controller in legacy mode");
    assert.ok(rendered.includes("formValues"), "Expected inline form state reference");
    assert.ok(rendered.includes("updateFieldValue"), "Expected field update call");
  });
});
