import assert from "node:assert/strict";
import test from "node:test";
import type { RenderContext, VirtualParent } from "./generator-render.js";
import type { DesignIR, DesignTokenTypographyVariant, DesignTokens, ScreenElementIR } from "./types.js";
import {
  appendVariantStateOverridesToSx,
  baseLayoutEntries,
  buildActionPalette,
  collectTextNodes,
  collectVectorPaths,
  dedupeSxEntries,
  deriveResponsiveThemeBreakpointValues,
  ensureContrastAgainstBackground,
  filterButtonVariantEntries,
  firstText,
  firstTextColor,
  firstVectorColor,
  hasVisibleGradient,
  indentBlock,
  inferButtonDisabled,
  inferButtonFullWidth,
  inferButtonSize,
  inferButtonVariant,
  inferChipSizeFromHeight,
  isLikelyErrorRedColor,
  isNearWhiteColor,
  isNeutralGrayColor,
  isVisibleColor,
  mapCounterAxisAlignToAlignItems,
  mapPrimaryAxisAlignToJustifyContent,
  matchesRoundedInteger,
  mixHexColors,
  normalizeHexColor,
  normalizeSpacingBase,
  resolveDeterministicColorSample,
  resolveDeterministicIntegerSample,
  resolveFormHandlingMode,
  sanitizeSelectOptionValue,
  sxString,
  toAlertSeverityFromName,
  toBoxSpacingSxEntries,
  toChipSize,
  toChipVariant,
  toContrastRatio,
  toDarkThemePalette,
  toElementSx,
  toEmLiteral,
  toHexWithAlpha,
  toLightThemePalette,
  toMuiContainerMaxWidth,
  toOpaqueHex,
  toPaintSxEntries,
  toRemLiteral,
  toRenderableAssetSource,
  toRgbaColor,
  toShadowSxEntry,
  toSpacingEdgeUnit,
  toSpacingUnitValue,
  toThemeBorderRadiusValue,
  toThemeColorLiteral,
  toThemePaletteBlock,
  toThemePaletteLiteral,
  toVariantStateSxObject,
  withOmittedSxKeys
} from "./templates/utility-functions.js";

const typographyVariant: DesignTokenTypographyVariant = {
  fontSizePx: 16,
  fontWeight: 400,
  lineHeightPx: 24,
  fontFamily: "Inter",
  letterSpacingEm: 0
};

const createTokens = (): DesignTokens => ({
  palette: {
    primary: "#112233",
    secondary: "#445566",
    background: "#ffffff",
    text: "#111111",
    success: "#2e7d32",
    warning: "#ed6c02",
    error: "#d32f2f",
    info: "#0288d1",
    divider: "#e0e0e0",
    action: {
      active: "#0000008a",
      hover: "#1122330a",
      selected: "#11223314",
      disabled: "#00000042",
      disabledBackground: "#0000001f",
      focus: "#1122331f"
    }
  },
  borderRadius: 8,
  spacingBase: 8,
  fontFamily: "Inter",
  headingSize: 32,
  bodySize: 16,
  typography: {
    h1: typographyVariant,
    h2: typographyVariant,
    h3: typographyVariant,
    h4: typographyVariant,
    h5: typographyVariant,
    h6: typographyVariant,
    subtitle1: typographyVariant,
    subtitle2: typographyVariant,
    body1: typographyVariant,
    body2: typographyVariant,
    button: typographyVariant,
    caption: typographyVariant,
    overline: typographyVariant
  }
});

const makeNode = ({
  id,
  type,
  nodeType = "FRAME",
  name = id,
  ...overrides
}: {
  id: string;
  type: ScreenElementIR["type"];
  nodeType?: string;
  name?: string;
} & Omit<Partial<ScreenElementIR>, "id" | "name" | "nodeType" | "type">): ScreenElementIR =>
  ({
    id,
    type,
    nodeType,
    name,
    ...overrides
  }) as ScreenElementIR;

const makeText = ({
  id,
  text,
  ...overrides
}: {
  id: string;
  text: string;
} & Omit<Partial<ScreenElementIR>, "id" | "name" | "nodeType" | "text" | "type">): ScreenElementIR =>
  ({
    id,
    name: id,
    type: "text",
    nodeType: "TEXT",
    text,
    ...overrides
  }) as ScreenElementIR;

const rootParent: VirtualParent = {
  x: 0,
  y: 0,
  width: 320,
  height: 640,
  layoutMode: "NONE"
};

const createRenderContext = (): RenderContext =>
  ({
    screenId: "screen-1",
    screenName: "Example",
    screenElements: [],
    currentFilePath: "src/screens/Example.tsx",
    generationLocale: "ar",
    formHandlingMode: "react_hook_form",
    hasScreenFormFields: false,
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
    iconResolver: {
      entries: [],
      byIconName: new Map(),
      exactAliasMap: new Map(),
      tokenIndex: new Map(),
      synonymMap: new Map()
    },
    imageAssetMap: {},
    routePathByScreenId: new Map(),
    usesRouterLink: false,
    usesNavigateHandler: false,
    prototypeNavigationRenderedCount: 0,
    mappedImports: [],
    specializedComponentMappings: {},
    usesDatePickerProvider: false,
    spacingBase: 8,
    mappingByNodeId: new Map(),
    usedMappingNodeIds: new Set(),
    mappingWarnings: [],
    consumedFieldLabelNodeIds: new Set(),
    emittedWarningKeys: new Set(),
    emittedAccessibilityWarningKeys: new Set(),
    themeComponentDefaults: undefined,
    pageBackgroundColorNormalized: undefined,
    requiresChangeEventTypeImport: false,
    extractionInvocationByNodeId: new Map(),
    responsiveTopLevelLayoutOverrides: {
      flow: {
        md: {
          widthRatio: 0.75
        }
      }
    },
    tokens: createTokens()
  }) as RenderContext;

test("spacing and box helpers normalize invalid input and preserve small positive values", () => {
  assert.equal(normalizeSpacingBase(undefined), 8);
  assert.equal(normalizeSpacingBase(10), 10);
  assert.equal(toSpacingUnitValue({ value: Number.NaN, spacingBase: 8 }), undefined);
  assert.equal(toSpacingUnitValue({ value: 0.1, spacingBase: 8000 }), 0.125);
  assert.equal(toSpacingEdgeUnit({ value: 0, spacingBase: 8 }), undefined);

  assert.deepEqual(
    toBoxSpacingSxEntries({
      values: {
        top: 8,
        right: 8,
        bottom: 8,
        left: 8
      },
      spacingBase: 8,
      allKey: "p",
      xKey: "px",
      yKey: "py",
      topKey: "pt",
      rightKey: "pr",
      bottomKey: "pb",
      leftKey: "pl"
    }),
    [["p", 1]]
  );

  assert.deepEqual(
    toBoxSpacingSxEntries({
      values: {
        top: 8,
        right: 16,
        bottom: 8,
        left: 16
      },
      spacingBase: 8,
      allKey: "m",
      xKey: "mx",
      yKey: "my",
      topKey: "mt",
      rightKey: "mr",
      bottomKey: "mb",
      leftKey: "ml"
    }),
    [
      ["my", 1],
      ["mx", 2]
    ]
  );

  assert.deepEqual(
    toBoxSpacingSxEntries({
      values: {
        top: 8,
        right: 4,
        bottom: 16,
        left: 12
      },
      spacingBase: 8,
      allKey: "p",
      xKey: "px",
      yKey: "py",
      topKey: "pt",
      rightKey: "pr",
      bottomKey: "pb",
      leftKey: "pl"
    }),
    [
      ["pt", 1],
      ["pr", 0.5],
      ["pb", 2],
      ["pl", 1.5]
    ]
  );
});

test("theme literal and sampling helpers handle invalid, mapped, and fallback values", () => {
  const tokens = createTokens();

  assert.equal(toThemeBorderRadiusValue({ radiusPx: undefined, tokens }), undefined);
  assert.equal(toThemeBorderRadiusValue({ radiusPx: 6, tokens: undefined }), "\"6px\"");
  assert.equal(toThemeBorderRadiusValue({ radiusPx: 0.1, tokens: { ...tokens, borderRadius: 1000 } }), 0.125);
  assert.equal(toRemLiteral(undefined), undefined);
  assert.equal(toRemLiteral(16), "\"1rem\"");
  assert.equal(toEmLiteral(1.25), "\"1.25em\"");
  assert.equal(toEmLiteral(Number.NaN), undefined);
  assert.equal(normalizeHexColor("  #abc "), "#aabbcc");
  assert.equal(normalizeHexColor("bad"), undefined);

  assert.equal(
    resolveDeterministicIntegerSample({
      values: [undefined, 40.4, 39.6, 50, 50, 60],
      min: 1,
      max: 100
    }),
    50
  );
  assert.equal(resolveDeterministicIntegerSample({ values: [undefined], min: 1, max: 10 }), undefined);
  assert.equal(resolveDeterministicColorSample([undefined, "#def", "#abc", "#def", "#abc"]), "#aabbcc");
  assert.equal(resolveDeterministicColorSample([undefined, "oops"]), undefined);

  assert.deepEqual(
    withOmittedSxKeys({
      entries: [
        ["width", "\"100%\""],
        ["height", 24]
      ],
      keys: new Set(["height"])
    }),
    [
      ["width", "\"100%\""],
      ["height", undefined]
    ]
  );

  assert.equal(toThemePaletteLiteral({ color: "#112233", tokens }), "primary.main");
  assert.equal(toThemePaletteLiteral({ color: "#010203", tokens }), undefined);
  assert.equal(toThemeColorLiteral({ color: "  #112233  ", tokens }), "\"primary.main\"");
  assert.equal(toThemeColorLiteral({ color: "  #abcdef  ", tokens }), "\"#abcdef\"");
  assert.equal(toThemeColorLiteral({ color: "   ", tokens }), undefined);
});

test("color helpers detect visibility, neutral states, contrast, and fallbacks", () => {
  const white = toRgbaColor("#ffffff");
  const black = toRgbaColor("#000000");
  const nearWhite = toRgbaColor("#f7f7f7");
  const neutralGray = toRgbaColor("#999999");
  const errorRed = toRgbaColor("#d32f2f");

  assert.equal(resolveFormHandlingMode({ requestedMode: "legacy_use_state" }), "legacy_use_state");
  assert.equal(resolveFormHandlingMode({ requestedMode: undefined }), "react_hook_form");
  assert.equal(hasVisibleGradient("  linear-gradient(red, blue) "), true);
  assert.equal(hasVisibleGradient("   "), false);
  assert.equal(toRgbaColor("bad"), undefined);
  assert.deepEqual(toRgbaColor("#11223380"), { r: 17, g: 34, b: 51, a: 0.502 });
  assert.equal(isVisibleColor(undefined), false);
  assert.equal(isVisibleColor(white), true);
  assert.equal(isNearWhiteColor(nearWhite), true);
  assert.equal(isNearWhiteColor(toRgbaColor("#ffffff05")), false);
  assert.equal(isNeutralGrayColor(neutralGray), true);
  assert.equal(isNeutralGrayColor(toRgbaColor("#ff0000")), false);
  assert.equal(isLikelyErrorRedColor(errorRed), true);
  assert.equal(isLikelyErrorRedColor(neutralGray), false);
  assert.equal(toContrastRatio(white!, black!), 21);
  assert.equal(toOpaqueHex("#aabbccdd"), "#aabbcc");
  assert.equal(toOpaqueHex("oops"), undefined);
  assert.equal(mixHexColors({ left: "oops", right: "#ffffff", amount: 0.5 }), "oops");
  assert.equal(mixHexColors({ left: "#000000", right: "#ffffff", amount: 2 }), "#ffffff");
  assert.equal(toHexWithAlpha("oops", 0.5), "oops");
  assert.equal(toHexWithAlpha("#112233", 0.5), "#11223380");
  assert.equal(ensureContrastAgainstBackground({ color: "oops", background: "#000000" }), "oops");

  const adjusted = ensureContrastAgainstBackground({
    color: "#333333",
    background: "#000000",
    minContrast: 7
  });
  assert.notEqual(adjusted, "#333333");

  const darkPalette = toDarkThemePalette(createTokens(), {
    background: {
      default: "#111111",
      paper: "#222222"
    },
    text: {
      primary: "#f4f4f4"
    },
    primary: "#336699",
    divider: "#333333"
  });
  assert.equal(darkPalette.background.default, "#111111");
  assert.equal(darkPalette.background.paper, "#222222");
  assert.equal(darkPalette.divider, "#333333");
  assert.equal(darkPalette.action.focus.endsWith("1f"), true);

  const lightPalette = toLightThemePalette(createTokens());
  assert.equal(lightPalette.background.paper, "#ffffff");
  assert.match(toThemePaletteBlock({ mode: "dark", palette: darkPalette }), /mode: "dark"/);
  assert.deepEqual(buildActionPalette({ primaryColor: "#112233", textColor: "#ffffff" }), {
    active: "#ffffff8a",
    hover: "#1122330a",
    selected: "#11223314",
    disabled: "#ffffff42",
    disabledBackground: "#ffffff1f",
    focus: "#1122331f"
  });
});

test("button helpers infer variants, sizes, disabled state, and filter sx entries", () => {
  const tokens = createTokens();
  const parent: VirtualParent = {
    ...rootParent,
    width: 200
  };

  assert.equal(
    inferButtonVariant({
      element: makeNode({ id: "contained", type: "button", fillColor: "#112233" }),
      mappedVariant: undefined
    }),
    "contained"
  );
  assert.equal(
    inferButtonVariant({
      element: makeNode({ id: "outlined", type: "button", fillColor: "#ffffff", strokeColor: "#222222" }),
      mappedVariant: undefined
    }),
    "outlined"
  );
  assert.equal(
    inferButtonVariant({
      element: makeNode({ id: "text", type: "button" }),
      mappedVariant: undefined
    }),
    "text"
  );
  assert.equal(
    inferButtonVariant({
      element: makeNode({ id: "mapped", type: "button", fillGradient: "linear-gradient(red, blue)" }),
      mappedVariant: "outlined"
    }),
    "outlined"
  );

  assert.equal(inferButtonSize({ element: makeNode({ id: "small", type: "button", height: 32 }), mappedSize: undefined }), "small");
  assert.equal(inferButtonSize({ element: makeNode({ id: "medium", type: "button", height: 40 }), mappedSize: undefined }), "medium");
  assert.equal(inferButtonSize({ element: makeNode({ id: "large", type: "button", height: 48 }), mappedSize: undefined }), "large");
  assert.equal(inferButtonSize({ element: makeNode({ id: "no-height", type: "button" }), mappedSize: undefined }), undefined);
  assert.equal(inferButtonFullWidth({ element: makeNode({ id: "full", type: "button", width: 196 }), parent }), true);
  assert.equal(inferButtonFullWidth({ element: makeNode({ id: "partial", type: "button", width: 120 }), parent }), false);

  assert.equal(
    inferButtonDisabled({
      element: makeNode({ id: "mapped-disabled", type: "button" }),
      mappedDisabled: true,
      buttonTextColor: "#111111"
    }),
    true
  );
  assert.equal(
    inferButtonDisabled({
      element: makeNode({ id: "opacity-disabled", type: "button", opacity: 0.5 }),
      mappedDisabled: false,
      buttonTextColor: "#111111"
    }),
    true
  );
  assert.equal(
    inferButtonDisabled({
      element: makeNode({ id: "neutral", type: "button", fillColor: "#999999" }),
      mappedDisabled: false,
      buttonTextColor: "#888888"
    }),
    true
  );

  assert.deepEqual(
    filterButtonVariantEntries({
      entries: [
        ["width", "\"100%\""],
        ["maxWidth", "\"200px\""],
        ["background", "\"linear-gradient(red, blue)\""],
        ["bgcolor", "\"primary.main\""],
        ["border", "\"1px solid\""],
        ["borderColor", "\"#112233\""]
      ],
      variant: "contained",
      element: makeNode({ id: "gradient", type: "button", fillGradient: "linear-gradient(red, blue)" }),
      fullWidth: true,
      tokens
    }),
    [["background", "\"linear-gradient(red, blue)\""]]
  );

  assert.deepEqual(
    filterButtonVariantEntries({
      entries: [
        ["background", "\"linear-gradient(red, blue)\""],
        ["bgcolor", "\"primary.main\""],
        ["border", "\"1px solid\""],
        ["borderColor", "\"#112233\""]
      ],
      variant: "outlined",
      element: makeNode({ id: "outlined", type: "button", fillColor: "#ffffff", strokeColor: "#112233" }),
      fullWidth: false,
      tokens
    }),
    []
  );
});

test("layout, sx, and state override helpers cover rtl, responsive, and selector fallbacks", () => {
  const context = createRenderContext();
  const absoluteElement = makeNode({
    id: "absolute",
    type: "container",
    x: 32,
    y: 24,
    width: 120,
    height: 48,
    strokeColor: "#112233",
    strokeWidth: 2,
    fillColor: "#ffffff",
    cornerRadius: 12,
    elevation: 4,
    insetShadow: "inset 0 1px 2px rgba(0,0,0,0.2)"
  });
  const flowElement = makeNode({
    id: "flow",
    type: "container",
    layoutMode: "VERTICAL",
    width: 160,
    height: 120,
    gap: 12,
    padding: {
      top: 8,
      right: 16,
      bottom: 12,
      left: 4
    },
    margin: {
      top: 4,
      right: 8,
      bottom: 12,
      left: 4
    },
    primaryAxisAlignItems: "SPACE_BETWEEN",
    counterAxisAlignItems: "BASELINE",
    children: [makeText({ id: "flow-child", text: "Child" })]
  });

  const absoluteEntries = Object.fromEntries(
    baseLayoutEntries(absoluteElement, rootParent, {
      spacingBase: 8,
      tokens: context.tokens,
      generationLocale: "ar"
    })
  );
  assert.equal(absoluteEntries.position, "\"absolute\"");
  assert.equal(absoluteEntries.insetInlineStart, "\"32px\"");
  assert.equal(absoluteEntries.top, "\"24px\"");
  assert.equal(absoluteEntries.boxShadow, "\"inset 0 1px 2px rgba(0,0,0,0.2)\"");

  const flowEntries = Object.fromEntries(
    baseLayoutEntries(flowElement, { ...rootParent, layoutMode: "VERTICAL" }, { includePaints: false, spacingBase: 8, generationLocale: "ar" })
  );
  assert.equal(flowEntries.width, "\"50%\"");
  assert.equal(flowEntries.maxWidth, "\"160px\"");
  assert.equal(flowEntries.display, "\"flex\"");
  assert.equal(flowEntries.alignItems, "\"baseline\"");
  assert.equal(flowEntries.justifyContent, "\"space-between\"");
  assert.equal(flowEntries.paddingInlineEnd, 2);
  assert.equal(flowEntries.marginInlineStart, 0.5);

  const elementSx = toElementSx({
    element: flowElement,
    parent: { ...rootParent, layoutMode: "VERTICAL" },
    context
  });
  assert.match(elementSx, /width: \{ md: "75%", lg: "50%" \}/);

  assert.equal(mapPrimaryAxisAlignToJustifyContent("MAX"), "flex-end");
  assert.equal(mapPrimaryAxisAlignToJustifyContent(undefined), undefined);
  assert.equal(mapCounterAxisAlignToAlignItems("MAX", "VERTICAL"), "flex-end");
  assert.equal(mapCounterAxisAlignToAlignItems(undefined, "HORIZONTAL"), "center");
  const rawEntries = [["width", "\"100%\""], undefined, ["width", "\"50%\""], ["height", 20]] as unknown as Array<
    [string, string | number | undefined]
  >;
  assert.deepEqual(dedupeSxEntries(rawEntries), [["width", "\"50%\""], ["height", 20]]);
  assert.equal(sxString([["width", "\"50%\""], ["height", 20], ["width", "\"100%\""]]), "height: 20, width: \"100%\"");
  assert.deepEqual(toPaintSxEntries({ fillColor: "#112233", fillGradient: undefined, includePaints: false, tokens: context.tokens }), []);
  assert.deepEqual(toPaintSxEntries({ fillColor: "#112233", fillGradient: "linear-gradient(red, blue)", includePaints: true, tokens: context.tokens }), [
    ["background", "\"linear-gradient(red, blue)\""],
    ["bgcolor", undefined]
  ]);
  assert.equal(matchesRoundedInteger({ value: undefined, target: 2 }), false);
  assert.equal(matchesRoundedInteger({ value: 2.4, target: 2 }), true);
  assert.equal(toShadowSxEntry({ elevation: undefined, insetShadow: " inset 0 0 1px #000 ", preferInsetShadow: true }), "\"inset 0 0 1px #000\"");
  assert.equal(toShadowSxEntry({ elevation: 30, insetShadow: undefined, preferInsetShadow: false }), 24);
  assert.equal(toVariantStateSxObject({ style: undefined, tokens: context.tokens }), undefined);
  assert.equal(toVariantStateSxObject({ style: {}, tokens: context.tokens }), undefined);
  assert.equal(
    appendVariantStateOverridesToSx({
      sx: "",
      element: makeNode({
        id: "variant",
        type: "button",
        variantMapping: {
          properties: {},
          muiProps: {},
          stateOverrides: {
            hover: {
              backgroundColor: "#112233"
            }
          }
        }
      }),
      tokens: context.tokens
    }),
    "\"&:hover\": { bgcolor: \"primary.main\" }"
  );
  assert.equal(
    appendVariantStateOverridesToSx({
      sx: "width: \"100%\"",
      element: makeNode({
        id: "variant-2",
        type: "button",
        variantMapping: {
          properties: {},
          muiProps: {},
          stateOverrides: {
            disabled: {
              color: "#d32f2f"
            }
          }
        }
      }),
      tokens: context.tokens
    }),
    "width: \"100%\", \"&.Mui-disabled\": { color: \"error.main\" }"
  );
  assert.equal(toChipVariant(undefined), undefined);
  assert.equal(toChipVariant("text"), "filled");
  assert.equal(toChipVariant("outlined"), "outlined");
  assert.equal(toChipSize("large"), "medium");
  assert.equal(toChipSize(undefined), undefined);
  assert.equal(inferChipSizeFromHeight(undefined), undefined);
  assert.equal(inferChipSizeFromHeight(24), "small");
  assert.equal(indentBlock("a\n\nb", 2), "  a\n\n  b");
});

test("tree traversal and responsive helpers handle cycles, placeholders, and defaults", () => {
  const cyclicRoot = makeNode({
    id: "cyclic-root",
    type: "container",
    children: []
  });
  const nestedText = makeText({
    id: "label",
    text: "  Hello  ",
    fillColor: "#112233"
  });
  const nestedVector = makeNode({
    id: "vector",
    type: "container",
    fillColor: "#445566",
    vectorPaths: ["M0 0L1 1", "", "M0 0L1 1"]
  });
  cyclicRoot.children = [nestedText, nestedVector, cyclicRoot];

  assert.equal(firstText(cyclicRoot), "Hello");
  assert.equal(firstTextColor(cyclicRoot), "#112233");
  assert.deepEqual(collectVectorPaths(cyclicRoot), ["M0 0L1 1"]);
  assert.equal(firstText(makeNode({ id: "empty-root", type: "container", children: [makeText({ id: "blank", text: "   " })] })), undefined);
  assert.equal(firstVectorColor(cyclicRoot), "#445566");
  assert.deepEqual(collectTextNodes(cyclicRoot).map((node) => node.id), ["label"]);
  assert.equal(toRenderableAssetSource("/images/hero.png"), "./images/hero.png");
  assert.equal(toRenderableAssetSource(" https://cdn.example.com/hero.png "), "https://cdn.example.com/hero.png");
  assert.equal(sanitizeSelectOptionValue("   "), "Option");
  assert.equal(sanitizeSelectOptionValue(" Premium "), "Premium");

  const ir = {
    screens: [
      {
        id: "screen-1",
        name: "Home",
        layoutMode: "VERTICAL",
        width: 390,
        height: 844,
        children: [],
        responsive: {
          variants: [
            {
              breakpoint: "sm",
              width: 640
            },
            {
              breakpoint: "md",
              width: 900
            },
            {
              breakpoint: "lg",
              width: 1240
            }
          ]
        }
      }
    ]
  } as DesignIR;

  const breakpoints = deriveResponsiveThemeBreakpointValues(ir);
  assert.deepEqual(breakpoints, {
    xs: 0,
    sm: 320,
    md: 770,
    lg: 1070,
    xl: 1388
  });
  assert.equal(deriveResponsiveThemeBreakpointValues({ screens: [] } as DesignIR), undefined);
  assert.equal(toMuiContainerMaxWidth(600), "sm");
  assert.equal(toMuiContainerMaxWidth(899), "md");
  assert.equal(toMuiContainerMaxWidth(1300), "xl");
  assert.equal(toAlertSeverityFromName("Payment error"), "error");
  assert.equal(toAlertSeverityFromName("System warning"), "warning");
  assert.equal(toAlertSeverityFromName("Success banner"), "success");
  assert.equal(toAlertSeverityFromName("FYI"), "info");
});
