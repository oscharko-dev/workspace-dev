import assert from "node:assert/strict";
import test from "node:test";
import {
  assembleFallbackDependencies,
  buildFallbackRenderState,
  fallbackScreenFile,
  prepareFallbackScreenModel,
  renderAppBar,
  renderAvatar,
  renderButton,
  renderCard,
  renderChip,
  renderCssGridLayout,
  renderDialog,
  renderSemanticAccordion,
  renderPaper,
  renderProgress,
  renderSelectionControl,
  renderSelectElement,
  renderSemanticInput,
  resolveElementRenderStrategy,
  renderSimpleFlexContainerAsStack,
  renderStack,
  renderStepper,
  renderStructuredAppBarToolbarChildren,
  renderTable,
  renderText,
  renderTooltipElement,
  tryRenderIconOnlyStepperContainer
} from "./templates/screen-template.js";
import { toStateKey, type IconFallbackResolver, type RenderContext, type VirtualParent } from "./generator-render.js";
import type { DetectedDialogOverlayPattern } from "./templates/screen-template.js";
import type { ScreenElementIR, ScreenIR } from "./types.js";

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

const createRenderContext = ({
  formHandlingMode = "react_hook_form",
  generationLocale = "de-DE",
  hasScreenFormFields = false,
  primarySubmitButtonKey = "",
  routePathByScreenId,
  themeComponentDefaults,
  specializedComponentMappings,
  storybookTypographyVariants,
  datePickerProvider
}: {
  formHandlingMode?: RenderContext["formHandlingMode"];
  generationLocale?: string;
  hasScreenFormFields?: boolean;
  primarySubmitButtonKey?: string;
  routePathByScreenId?: Map<string, string>;
  themeComponentDefaults?: RenderContext["themeComponentDefaults"];
  specializedComponentMappings?: RenderContext["specializedComponentMappings"];
  storybookTypographyVariants?: RenderContext["storybookTypographyVariants"];
  datePickerProvider?: RenderContext["datePickerProvider"];
} = {}): RenderContext => ({
  screenId: "screen-1",
  screenName: "Example",
  screenElements: [],
  currentFilePath: "src/screens/Example.tsx",
  generationLocale,
  formHandlingMode,
  hasScreenFormFields,
  primarySubmitButtonKey,
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
  routePathByScreenId: routePathByScreenId ?? new Map(),
  usesRouterLink: false,
  usesNavigateHandler: false,
  prototypeNavigationRenderedCount: 0,
  mappedImports: [],
  specializedComponentMappings: specializedComponentMappings ?? {},
  ...(storybookTypographyVariants ? { storybookTypographyVariants } : {}),
  ...(datePickerProvider ? { datePickerProvider } : {}),
  usesDatePickerProvider: false,
  spacingBase: 8,
  mappingByNodeId: new Map(),
  usedMappingNodeIds: new Set(),
  mappingWarnings: [],
  consumedFieldLabelNodeIds: new Set(),
  emittedWarningKeys: new Set(),
  emittedAccessibilityWarningKeys: new Set(),
  pageBackgroundColorNormalized: undefined,
  requiresChangeEventTypeImport: false,
  themeComponentDefaults,
  extractionInvocationByNodeId: new Map(),
  responsiveTopLevelLayoutOverrides: undefined
});

const makeText = ({
  id,
  text,
  name = id,
  x = 0,
  y = 0,
  ...overrides
}: {
  id: string;
  text: string;
  name?: string;
  x?: number;
  y?: number;
} & Omit<Partial<ScreenElementIR>, "children" | "id" | "name" | "nodeType" | "text" | "type" | "x" | "y">): ScreenElementIR => ({
  ...overrides,
  ...{
    id,
    name,
    nodeType: "TEXT",
    type: "text",
    text,
    x,
    y
  }
});

const navigationRouteMap = (screenId = "screen-2", routePath = "/details"): Map<string, string> =>
  new Map([[screenId, routePath]]);

const makeNode = ({
  id,
  type,
  name = id,
  nodeType = "FRAME",
  ...overrides
}: {
  id: string;
  type: Exclude<ScreenElementIR["type"], "text">;
  name?: string;
  nodeType?: string;
} & Omit<Partial<ScreenElementIR>, "id" | "name" | "type" | "nodeType">): ScreenElementIR => ({
  id,
  name,
  nodeType,
  type,
  ...overrides
}) as ScreenElementIR;

const makeSpecializedMapping = ({
  componentKey,
  modulePath,
  importedName,
  localName = importedName
}: {
  componentKey: string;
  modulePath: string;
  importedName: string;
  localName?: string;
}): NonNullable<RenderContext["specializedComponentMappings"]>[string] => ({
  componentKey,
  modulePath,
  importedName,
  localName,
  propMappings: {},
  omittedProps: new Set<string>(),
  defaultProps: {}
});

test("renderText skips consumed labels and styles link-like text with contrast warnings", () => {
  const skippedContext = createRenderContext();
  skippedContext.consumedFieldLabelNodeIds?.add("consumed-label");

  assert.equal(renderText(makeText({ id: "consumed-label", text: "Amount" }), 1, rootParent, skippedContext), "");

  const linkContext = createRenderContext({
    generationLocale: "ar"
  });
  linkContext.headingComponentByNodeId.set("help-link", "h2");
  linkContext.typographyVariantByNodeId.set("help-link", "h6");

  const renderedLink = renderText(
    makeText({
      id: "help-link",
      text: "Need Help",
      textAlign: "RIGHT",
      fillColor: "#012345",
      fontSize: 16,
      lineHeight: 24,
      fontWeight: 700
    }),
    1,
    {
      ...rootParent,
      fillColor: "#ffffff"
    },
    linkContext
  );

  assert.match(renderedLink, /<Typography variant="h6" component="h2"/);
  assert.match(renderedLink, /textDecoration: "underline"/);
  assert.match(renderedLink, /cursor: "pointer"/);
  assert.match(renderedLink, /textAlign: "end"/);

  const warningContext = createRenderContext();
  renderText(
    makeText({
      id: "low-contrast-copy",
      text: "Almost white",
      fillColor: "#fefefe",
      fontSize: 16,
      lineHeight: 20
    }),
    1,
    {
      ...rootParent,
      fillColor: "#ffffff"
    },
    warningContext
  );

  assert.equal(warningContext.accessibilityWarnings.length, 1);
});

test("renderText prefers mapped customer typography for semantic Typography nodes when a Storybook variant matches confidently", () => {
  const context = createRenderContext({
    specializedComponentMappings: {
      Typography: makeSpecializedMapping({
        componentKey: "Typography",
        modulePath: "@customer/typography",
        importedName: "CustomerTypography"
      })
    },
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
  context.headingComponentByNodeId.set("dynamic-heading", "h1");

  const rendered = renderText(
    makeText({
      id: "dynamic-heading",
      text: "Dynamic Headline",
      semanticType: "Typography",
      fontFamily: "Storybook Sans",
      fontSize: 32,
      fontWeight: 700,
      lineHeight: 40
    }),
    1,
    rootParent,
    context
  );

  assert.match(rendered, /<CustomerTypography/);
  assert.match(rendered, /variant=\{"displayLg"\}/);
  assert.match(rendered, /component=\{"h1"\}/);
  assert.equal(rendered.includes("<Typography"), false);
  assert.deepEqual(context.mappedImports, [
    {
      localName: "CustomerTypography",
      modulePath: "@customer/typography",
      importMode: "named",
      importedName: "CustomerTypography"
    }
  ]);
});

test("renderText prefers DynamicTypography mapping over Typography mapping for semantic DynamicTypography nodes", () => {
  const context = createRenderContext({
    specializedComponentMappings: {
      DynamicTypography: makeSpecializedMapping({
        componentKey: "DynamicTypography",
        modulePath: "@customer/typography",
        importedName: "CustomerDynamicTypography"
      }),
      Typography: makeSpecializedMapping({
        componentKey: "Typography",
        modulePath: "@customer/typography",
        importedName: "CustomerTypography"
      })
    },
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

  const rendered = renderText(
    makeText({
      id: "dynamic-variant-heading",
      text: "Dynamic Headline",
      name: "<Dynamic Typography>, Variant=H1 light",
      semanticType: "DynamicTypography",
      variantMapping: {
        properties: {
          Variant: "H1 light"
        }
      },
      fontFamily: "Storybook Sans",
      fontSize: 32,
      fontWeight: 700,
      lineHeight: 40
    }),
    1,
    rootParent,
    context
  );

  assert.match(rendered, /<CustomerDynamicTypography/);
  assert.match(rendered, /variant=\{"H1-light"\}/);
  assert.equal(rendered.includes("CustomerTypography"), false);
});

test("renderText falls back to Typography mapping for DynamicTypography when no dedicated mapping exists", () => {
  const context = createRenderContext({
    specializedComponentMappings: {
      Typography: makeSpecializedMapping({
        componentKey: "Typography",
        modulePath: "@customer/typography",
        importedName: "CustomerTypography"
      })
    },
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

  const rendered = renderText(
    makeText({
      id: "dynamic-fallback-heading",
      text: "Dynamic Headline",
      semanticType: "DynamicTypography",
      fontFamily: "Storybook Sans",
      fontSize: 32,
      fontWeight: 700,
      lineHeight: 40
    }),
    1,
    rootParent,
    context
  );

  assert.match(rendered, /<CustomerTypography/);
  assert.match(rendered, /variant=\{"displayLg"\}/);
  assert.equal(rendered.includes("<Typography"), false);
});

test("renderButton renders icon-only router links and submit buttons with end icons", () => {
  const iconOnlyContext = createRenderContext({
    routePathByScreenId: navigationRouteMap()
  });
  const iconOnlyButton = makeNode({
    id: "search-button",
    type: "button",
    name: "Search",
    width: 40,
    height: 40,
    prototypeNavigation: {
      targetScreenId: "screen-2",
      mode: "replace"
    },
    children: [
      makeNode({
        id: "search-icon",
        type: "container",
        name: "",
        nodeType: "VECTOR",
        width: 18,
        height: 18,
        vectorPaths: ["M0 0L10 10"]
      })
    ]
  });

  const renderedIconOnlyButton = renderButton(iconOnlyButton, 1, rootParent, iconOnlyContext);

  assert.match(renderedIconOnlyButton, /<IconButton aria-label="Search"/);
  assert.match(renderedIconOnlyButton, /component=\{RouterLink\} to=\{".*details"\} replace/);
  assert.equal(iconOnlyContext.usesRouterLink, true);

  const submitButton = makeNode({
    id: "submit-button",
    type: "button",
    name: "Continue",
    width: 220,
    height: 48,
    fillColor: "#d32f2f",
    children: [
      makeText({ id: "submit-label", text: "Continue", x: 24, y: 12 }),
      makeNode({
        id: "submit-icon",
        type: "container",
        name: "",
        nodeType: "VECTOR",
        x: 176,
        y: 12,
        width: 16,
        height: 16,
        vectorPaths: ["M1 1L9 9"]
      })
    ]
  });
  const submitContext = createRenderContext({
    formHandlingMode: "react_hook_form",
    hasScreenFormFields: true,
    primarySubmitButtonKey: toStateKey(submitButton)
  });

  const renderedSubmitButton = renderButton(submitButton, 1, rootParent, submitContext);

  assert.match(renderedSubmitButton, /<Button variant="contained"/);
  assert.match(renderedSubmitButton, /type="submit"/);
  assert.match(renderedSubmitButton, /disabled=\{isSubmitting\}/);
  assert.match(renderedSubmitButton, /endIcon=\{/);
  assert.equal(submitContext.buttons.length, 1);
  assert.equal(submitContext.buttons[0]?.preferredSubmit, true);
});

test("renderButton upgrades composite button surfaces to cards", () => {
  const context = createRenderContext();
  const rendered = renderButton(
    makeNode({
      id: "summary-button",
      type: "button",
      name: "summary-button",
      width: 220,
      height: 120,
      fillColor: "#ffffff",
      cornerRadius: 16,
      children: [
        makeText({ id: "summary-title", text: "Balance" }),
        makeText({ id: "summary-meta", text: "Updated today", y: 32 }),
        makeNode({
          id: "summary-badge",
          type: "badge",
          width: 48,
          height: 24,
          y: 64,
          children: [makeText({ id: "summary-badge-text", text: "New" })]
        })
      ]
    }),
    1,
    rootParent,
    context
  );

  assert.match(rendered, /<Card/);
  assert.match(rendered, /<CardContent>/);
});

test("accordion render strategy dispatches directly and respects collapsed board state", () => {
  const context = createRenderContext();
  const element = makeNode({
    id: "loan-accordion",
    type: "accordion",
    name: "Accordion, State=Collapsed",
    semanticType: "Accordion",
    variantMapping: {
      properties: {
        State: "Collapsed"
      },
      muiProps: {}
    },
    children: [
      makeNode({
        id: "loan-accordion-summary",
        type: "container",
        name: "AccordionSummaryContent",
        children: [makeText({ id: "loan-accordion-summary-text", text: "Details" })]
      }),
      makeNode({
        id: "loan-accordion-details",
        type: "container",
        name: "CollapseWrapper",
        children: [makeText({ id: "loan-accordion-details-text", text: "Hidden content" })]
      })
    ]
  });

  const rendered = resolveElementRenderStrategy("accordion")({
    element,
    depth: 1,
    parent: rootParent,
    context
  });

  assert.equal(rendered, renderSemanticAccordion(element, 1, rootParent, context));
  assert.match(rendered ?? "", /<Accordion/);
  assert.match(rendered ?? "", /AccordionSummary/);
  assert.match(rendered ?? "", /AccordionDetails/);
  assert.equal(context.accordions[0]?.defaultExpanded, false);
});

test("renderCard renders media, actions, and navigation handlers", () => {
  const context = createRenderContext({
    routePathByScreenId: navigationRouteMap("screen-3", "/cards/details")
  });
  const rendered = renderCard(
    makeNode({
      id: "media-card",
      type: "card",
      name: "Media Card",
      width: 320,
      height: 240,
      fillColor: "#ffffff",
      cornerRadius: 16,
      prototypeNavigation: {
        targetScreenId: "screen-3",
        mode: "replace"
      },
      children: [
        makeNode({
          id: "hero-image",
          type: "image",
          name: "Hero media",
          width: 320,
          height: 140
        }),
        makeText({ id: "card-title", text: "Premium Account", y: 152 }),
        makeNode({
          id: "card-action",
          type: "button",
          name: "Open",
          y: 184,
          children: [makeText({ id: "card-action-label", text: "Open" })]
        })
      ]
    }),
    1,
    rootParent,
    context
  );

  assert.ok(rendered);
  assert.match(rendered, /<CardMedia component="img"/);
  assert.match(rendered, /<CardActions>/);
  assert.match(rendered, /role="button"/);
  assert.match(rendered, /navigate\(".*cards.*details", \{ replace: true \}\)/);
  assert.equal(context.usesNavigateHandler, true);
});

test("renderCard assembles explicit board slots into compound subcomponents", () => {
  const context = createRenderContext();
  const rendered = renderCard(
    makeNode({
      id: "explicit-card",
      type: "card",
      name: "<Card>",
      width: 320,
      height: 240,
      fillColor: "#ffffff",
      children: [
        makeNode({
          id: "card-header-slot",
          type: "container",
          name: "_<CardHeader>",
          semanticType: "CardHeader",
          children: [
            makeText({ id: "card-header-title", text: "Premium Account" }),
            makeText({ id: "card-header-subtitle", text: "Updated today", y: 24 })
          ]
        }),
        makeNode({
          id: "card-media-slot",
          type: "container",
          name: "_<CardMedia>",
          semanticType: "CardMedia",
          width: 320,
          height: 120
        }),
        makeNode({
          id: "card-content-slot",
          type: "container",
          name: "_<CardContent>",
          semanticType: "CardContent",
          children: [makeText({ id: "card-content-text", text: "Explicit body", y: 140 })]
        }),
        makeText({ id: "card-unmatched-text", text: "Unmatched body", y: 160 }),
        makeNode({
          id: "card-actions-slot",
          type: "container",
          name: "_<CardActions>",
          semanticType: "CardActions",
          children: [
            makeNode({
              id: "card-action-button",
              type: "button",
              name: "Details CTA",
              children: [makeText({ id: "card-action-label", text: "Details" })]
            })
          ]
        })
      ]
    }),
    1,
    rootParent,
    context
  );

  assert.ok(rendered);
  assert.match(rendered, /<CardHeader/);
  assert.match(rendered, /title=\{"Premium Account"\}/);
  assert.match(rendered, /subheader=\{"Updated today"\}/);
  assert.match(rendered, /<CardMedia component="img"/);
  assert.match(rendered, /<CardContent>/);
  assert.match(rendered, /"Explicit body"/);
  assert.match(rendered, /"Unmatched body"/);
  assert.match(rendered, /<CardActions>/);
  assert.ok(rendered.indexOf("<CardHeader") < rendered.indexOf("<CardMedia"));
  assert.ok(rendered.indexOf("<CardMedia") < rendered.indexOf("<CardContent>"));
  assert.ok(rendered.indexOf("<CardContent>") < rendered.indexOf("<CardActions>"));
  assert.equal(rendered.includes("component=\"main\" role=\"main\""), false);
  assert.equal(rendered.includes("<CardContent />"), false);
  assert.equal(context.muiImports.has("CardHeader"), true);
});

test("renderSemanticAccordion prefers explicit summary and details slots", () => {
  const context = createRenderContext();
  const rendered = renderSemanticAccordion(
    makeNode({
      id: "explicit-accordion",
      type: "accordion",
      name: "<Accordion>",
      semanticType: "Accordion",
      children: [
        makeNode({
          id: "accordion-summary-slot",
          type: "container",
          name: "_<AccordionSummary>",
          semanticType: "AccordionSummary",
          children: [makeText({ id: "accordion-summary-text", text: "Show details" })]
        }),
        makeNode({
          id: "accordion-details-slot",
          type: "container",
          name: "_<AccordionDetails>",
          semanticType: "AccordionDetails",
          children: [makeText({ id: "accordion-details-text", text: "Hidden content" })]
        })
      ]
    }),
    1,
    rootParent,
    context
  );

  assert.match(rendered, /<AccordionSummary/);
  assert.match(rendered, /"Show details"/);
  assert.match(rendered, /<AccordionDetails/);
  assert.match(rendered, /"Hidden content"/);
  assert.equal(rendered.includes("<Box />"), false);
});

test("renderSemanticAccordion omits empty explicit details wrappers", () => {
  const context = createRenderContext();
  const rendered = renderSemanticAccordion(
    makeNode({
      id: "explicit-accordion-empty",
      type: "accordion",
      name: "<Accordion>",
      semanticType: "Accordion",
      children: [
        makeNode({
          id: "accordion-summary-only-slot",
          type: "container",
          name: "_<AccordionSummary>",
          semanticType: "AccordionSummary",
          children: [makeText({ id: "accordion-summary-only-text", text: "Only summary" })]
        }),
        makeNode({
          id: "accordion-details-empty-slot",
          type: "container",
          name: "_<AccordionDetails>",
          semanticType: "AccordionDetails",
          children: []
        })
      ]
    }),
    1,
    rootParent,
    context
  );

  assert.match(rendered, /<AccordionSummary/);
  assert.match(rendered, /"Only summary"/);
  assert.equal(rendered.includes("<AccordionDetails"), false);
  assert.equal(rendered.includes("<Box />"), false);
});

test("renderSemanticAccordion routes unmatched children to details slot", () => {
  const context = createRenderContext();
  const rendered = renderSemanticAccordion(
    makeNode({
      id: "accordion-unmatched",
      type: "accordion",
      name: "<Accordion>",
      semanticType: "Accordion",
      children: [
        makeNode({
          id: "accordion-summary-slot-u",
          type: "container",
          name: "_<AccordionSummary>",
          semanticType: "AccordionSummary",
          children: [makeText({ id: "accordion-summary-text-u", text: "Header" })]
        }),
        makeText({ id: "accordion-orphan-text", text: "Orphan content", y: 40 })
      ]
    }),
    1,
    rootParent,
    context
  );

  assert.match(rendered, /<AccordionSummary/);
  assert.match(rendered, /"Header"/);
  assert.match(rendered, /<AccordionDetails/);
  assert.match(rendered, /"Orphan content"/);
});

test("renderCard assembles partial explicit slots alongside heuristic fallbacks", () => {
  const context = createRenderContext();
  const rendered = renderCard(
    makeNode({
      id: "partial-card",
      type: "card",
      name: "<Card>",
      width: 320,
      height: 200,
      fillColor: "#ffffff",
      children: [
        makeNode({
          id: "partial-header-slot",
          type: "container",
          name: "_<CardHeader>",
          semanticType: "CardHeader",
          children: [makeText({ id: "partial-header-title", text: "Partial Title" })]
        }),
        makeText({ id: "partial-body-text", text: "Body text", y: 40 }),
        makeNode({
          id: "partial-action-button",
          type: "button",
          name: "Submit CTA",
          y: 80,
          children: [makeText({ id: "partial-action-label", text: "Submit" })]
        })
      ]
    }),
    1,
    rootParent,
    context
  );

  assert.ok(rendered);
  assert.match(rendered, /<CardHeader/);
  assert.match(rendered, /title=\{"Partial Title"\}/);
  assert.match(rendered, /"Body text"/);
  assert.match(rendered, /"Submit"/);
  assert.equal(rendered.includes("<CardMedia"), false);
});

test("renderCard resolves nested image inside explicit media slot", () => {
  const context = createRenderContext();
  const rendered = renderCard(
    makeNode({
      id: "nested-media-card",
      type: "card",
      name: "<Card>",
      width: 320,
      height: 300,
      fillColor: "#ffffff",
      children: [
        makeNode({
          id: "nested-media-slot",
          type: "container",
          name: "_<CardMedia>",
          semanticType: "CardMedia",
          width: 320,
          height: 180,
          children: [
            makeNode({
              id: "nested-media-image",
              type: "image",
              name: "Hero Banner",
              width: 320,
              height: 180
            })
          ]
        }),
        makeNode({
          id: "nested-content-slot",
          type: "container",
          name: "_<CardContent>",
          semanticType: "CardContent",
          children: [makeText({ id: "nested-content-text", text: "Card body" })]
        })
      ]
    }),
    1,
    rootParent,
    context
  );

  assert.ok(rendered);
  assert.match(rendered, /<CardMedia component="img"/);
  assert.match(rendered, /alt=\{"Hero Banner"\}/);
  assert.match(rendered, /<CardContent>/);
  assert.match(rendered, /"Card body"/);
  assert.ok(rendered.indexOf("<CardMedia") < rendered.indexOf("<CardContent>"));
});

test("renderChip renders mapped variants and router links", () => {
  const context = createRenderContext({
    routePathByScreenId: navigationRouteMap("screen-4", "/filters")
  });
  const rendered = renderChip(
    makeNode({
      id: "active-chip",
      type: "chip",
      name: "Active",
      prototypeNavigation: {
        targetScreenId: "screen-4",
        mode: "push"
      },
      variantMapping: {
        muiProps: {
          variant: "outlined",
          size: "small"
        }
      }
    }),
    1,
    rootParent,
    context
  );

  assert.match(rendered, /<Chip label=\{"Active"\}/);
  assert.match(rendered, /variant="outlined"/);
  assert.match(rendered, /size="small"/);
  assert.match(rendered, /component=\{RouterLink\} to=\{".*filters"\}/);
});

test("renderSelectionControl renders radio groups and falls back for composite controls", () => {
  const radioContext = createRenderContext();
  const renderedRadioGroup = renderSelectionControl({
    element: makeNode({
      id: "preference-group",
      type: "radio",
      children: [
        makeText({ id: "choice-a", text: "Private" }),
        makeText({ id: "choice-b", text: "Business", y: 24 })
      ]
    }),
    depth: 1,
    parent: rootParent,
    context: radioContext,
    componentName: "Radio"
  });

  assert.match(renderedRadioGroup ?? "", /<RadioGroup/);
  assert.match(renderedRadioGroup ?? "", /label=\{"Private"\}/);
  assert.match(renderedRadioGroup ?? "", /label=\{"Business"\}/);

  const fallbackContext = createRenderContext();
  const fallback = renderSelectionControl({
    element: makeNode({
      id: "complex-checkbox",
      type: "checkbox",
      fillColor: "#ffffff",
      width: 180,
      height: 40,
      children: [
        makeNode({ id: "box-1", type: "container", width: 12, height: 12, fillColor: "#000000" }),
        makeNode({ id: "box-2", type: "container", width: 12, height: 12, fillColor: "#000000" })
      ]
    }),
    depth: 1,
    parent: rootParent,
    context: fallbackContext,
    componentName: "Checkbox"
  });

  assert.ok(fallback);
  assert.equal(fallback.includes("<Checkbox"), false);
});

test("renderStructuredAppBarToolbarChildren and renderAppBar handle structured and fallback toolbars", () => {
  const structuredContext = createRenderContext({
    routePathByScreenId: navigationRouteMap("screen-5", "/alerts")
  });
  const toolbar = makeNode({
    id: "toolbar",
    type: "navigation",
    name: "Toolbar",
    layoutMode: "HORIZONTAL",
    children: [
      makeText({ id: "toolbar-title", text: "Dashboard" }),
      makeNode({
        id: "toolbar-alert",
        type: "container",
        name: "alert",
        nodeType: "VECTOR",
        width: 20,
        height: 20,
        prototypeNavigation: {
          targetScreenId: "screen-5",
          mode: "push"
        },
        vectorPaths: ["M0 0L8 8"]
      }),
      makeNode({
        id: "toolbar-menu",
        type: "container",
        name: "menu",
        nodeType: "VECTOR",
        width: 20,
        height: 20,
        vectorPaths: ["M1 1L7 7"]
      })
    ]
  });

  const structuredChildren = renderStructuredAppBarToolbarChildren({
    element: toolbar,
    depth: 1,
    context: structuredContext,
    fallbackTitle: "Fallback"
  });

  assert.ok(structuredChildren);
  assert.match(structuredChildren, /<Typography variant="h6" sx=\{\{ flexGrow: 1 \}\}>\{"Dashboard"\}<\/Typography>/);
  assert.match(structuredChildren, /<IconButton edge="end" aria-label=\{"Alert"\} component=\{RouterLink\} to=\{".*alerts"\}>/);

  const fallbackContext = createRenderContext();
  const renderedAppBar = renderAppBar(
    makeNode({
      id: "fallback-appbar",
      type: "navigation",
      name: "Workspace"
    }),
    1,
    rootParent,
    fallbackContext
  );

  assert.match(renderedAppBar, /<AppBar component="header" role="banner" position="static"/);
  assert.match(renderedAppBar, /<Typography variant="h6">\{"Workspace"\}<\/Typography>/);
});

test("renderCssGridLayout renders template areas, spans, and placeholder children", () => {
  const context = createRenderContext();
  const rendered = renderCssGridLayout({
    element: makeNode({
      id: "dashboard-grid",
      type: "grid",
      gap: 16,
      children: [
        makeNode({ id: "empty-tile", type: "container", children: [] }),
        makeText({ id: "content-tile", text: "Summary" }),
        makeNode({
          id: "area-tile",
          type: "container",
          cssGridHints: {
            gridArea: "sidebar"
          },
          children: [makeText({ id: "area-tile-text", text: "Sidebar" })]
        })
      ]
    }),
    depth: 1,
    parent: rootParent,
    context,
    cssGridDetection: {
      gridTemplateColumns: ["1fr", "2fr"],
      gridTemplateRows: ["auto", "auto"],
      childSpans: new Map([[0, { columnStart: 1, columnEnd: 3, rowStart: 1, rowEnd: 2 }]])
    }
  });

  assert.match(rendered ?? "", /display: "grid"/);
  assert.match(rendered ?? "", /gridTemplateColumns: "1fr 2fr"/);
  assert.match(rendered ?? "", /gridColumn: "1 \/ 3"/);
  assert.match(rendered ?? "", /gridArea: "sidebar"/);
  assert.match(rendered ?? "", /<Box \/>/);
});

test("renderTable renders semantic tables and falls back for interactive rows", () => {
  const tableContext = createRenderContext();
  const renderedTable = renderTable(
    makeNode({
      id: "summary-table",
      type: "table",
      layoutMode: "VERTICAL",
      children: [
        makeNode({
          id: "row-head",
          type: "container",
          layoutMode: "HORIZONTAL",
          children: [
            makeText({ id: "head-name", text: "Name" }),
            makeText({ id: "head-value", text: "Value" })
          ]
        }),
        makeNode({
          id: "row-body",
          type: "container",
          layoutMode: "HORIZONTAL",
          children: [
            makeText({ id: "body-name", text: "Limit" }),
            makeText({ id: "body-value", text: "10.000 EUR" })
          ]
        })
      ]
    }),
    1,
    rootParent,
    tableContext
  );

  assert.match(renderedTable ?? "", /<Table size="small"/);
  assert.match(renderedTable ?? "", /<TableHead>/);
  assert.match(renderedTable ?? "", /<TableBody>/);

  const fallbackContext = createRenderContext();
  const fallback = renderTable(
    makeNode({
      id: "interactive-table",
      type: "table",
      fillColor: "#ffffff",
      children: [
        makeNode({
          id: "control-row-1",
          type: "container",
          layoutMode: "HORIZONTAL",
          children: [
            makeNode({ id: "control-cell-1a", type: "container", name: "muiinput" }),
            makeText({ id: "control-cell-1b", text: "A" })
          ]
        }),
        makeNode({
          id: "control-row-2",
          type: "container",
          layoutMode: "HORIZONTAL",
          children: [
            makeNode({ id: "control-cell-2a", type: "container", name: "muiinput" }),
            makeText({ id: "control-cell-2b", text: "B" })
          ]
        })
      ]
    }),
    1,
    rootParent,
    fallbackContext
  );

  assert.ok(fallback);
  assert.equal(fallback.includes("<Table"), false);
});

test("renderSelectElement derives options, sanitizes required labels, and supports react-hook-form mode", () => {
  const legacyContext = createRenderContext({
    formHandlingMode: "legacy_use_state"
  });
  const legacyRendered = renderSelectElement(
    makeNode({
      id: "country-select",
      type: "select",
      name: "Country *",
      children: [
        makeNode({ id: "country-option-1", type: "button", name: "Germany" }),
        makeNode({ id: "country-option-2", type: "button", name: "Austria", y: 24 })
      ]
    }),
    1,
    rootParent,
    legacyContext
  );

  assert.match(legacyRendered, /<FormControl/);
  assert.match(legacyRendered, /label=\{"Country"\}/);
  assert.equal(legacyContext.fields[0]?.required, true);
  assert.deepEqual(legacyContext.fields[0]?.options, ["Germany", "Austria"]);

  const rhfContext = createRenderContext();
  const rhfRendered = renderSelectElement(
    makeNode({
      id: "fallback-select",
      type: "select",
      name: "Account",
      text: "Business"
    }),
    1,
    rootParent,
    rhfContext
  );

  assert.match(rhfRendered, /<Controller/);
  assert.equal((rhfContext.fields[0]?.options.length ?? 0) > 0, true);
  assert.equal(rhfContext.fields[0]?.defaultValue, rhfContext.fields[0]?.options[0]);
});

test("renderSemanticInput renders legacy text fields with adornments and shell styling", () => {
  const context = createRenderContext({
    formHandlingMode: "legacy_use_state",
    themeComponentDefaults: {
      MuiTextField: {
        outlinedInputBorderRadiusPx: 4
      }
    }
  });
  const element = makeNode({
    id: "amount-field",
    type: "container",
    name: "Amount field",
    x: 0,
    y: 0,
    width: 260,
    height: 56,
    strokeColor: "#999999",
    cornerRadius: 12,
    children: [
      makeText({ id: "amount-label", text: "Amount", y: 0 }),
      makeText({ id: "amount-value", text: "1234", y: 28 }),
      makeText({ id: "amount-suffix", text: "€", x: 240, y: 28 }),
      makeNode({
        id: "outline-root",
        type: "container",
        name: "muioutlinedinputroot",
        x: 12,
        y: 8,
        width: 220,
        height: 40
      }),
      makeNode({
        id: "outline-border",
        type: "divider",
        name: "muinotchedoutlined",
        strokeColor: "#555555",
        cornerRadius: 4
      })
    ]
  });

  const rendered = renderSemanticInput(element, 1, rootParent, context);

  assert.match(rendered, /<TextField/);
  assert.match(rendered, /InputAdornment position="end"/);
  assert.match(rendered, /slotProps=\{\{/);
  assert.equal(context.fields.length, 1);
  assert.equal(context.fields[0]?.isSelect, false);
  assert.equal(context.muiImports.has("TextField"), true);
  assert.equal(context.muiImports.has("InputAdornment"), true);
});

test("renderSemanticInput prefers mapped customer banking inputs when specialized mappings are available", () => {
  const context = createRenderContext({
    specializedComponentMappings: {
      InputIBAN: makeSpecializedMapping({
        componentKey: "InputIBAN",
        modulePath: "@customer/forms",
        importedName: "CustomerIbanInput"
      })
    }
  });
  const element = makeNode({
    id: "iban-field",
    type: "input",
    semanticType: "InputIBAN",
    name: "IBAN field",
    width: 320,
    height: 56,
    children: [
      makeText({ id: "iban-label", text: "IBAN", y: 0 }),
      makeText({ id: "iban-value", text: "DE89 3704 0044 0532 0130 00", y: 28 })
    ]
  });

  const rendered = renderSemanticInput(element, 1, rootParent, context);

  assert.match(rendered, /<Controller/);
  assert.match(rendered, /<CustomerIbanInput/);
  assert.equal(rendered.includes("<TextField"), false);
  assert.equal(context.muiImports.has("TextField"), false);
  assert.equal(context.requiresChangeEventTypeImport, true);
  assert.deepEqual(context.mappedImports, [
    {
      localName: "CustomerIbanInput",
      modulePath: "@customer/forms",
      importMode: "named",
      importedName: "CustomerIbanInput"
    }
  ]);
});

test("renderSemanticInput renders react-hook-form select controls", () => {
  const context = createRenderContext();
  const element = makeNode({
    id: "country-field",
    type: "container",
    name: "Country field",
    x: 0,
    y: 0,
    width: 280,
    height: 56,
    children: [
      makeText({ id: "country-label", text: "Country", y: 0 }),
      makeText({ id: "country-value", text: "Germany", y: 30 }),
      makeNode({
        id: "country-select",
        type: "container",
        name: "muiselectselect",
        x: 220,
        y: 30,
        width: 24,
        height: 24
      })
    ]
  });

  const rendered = renderSemanticInput(element, 1, rootParent, context);

  assert.match(rendered, /<Controller/);
  assert.match(rendered, /<FormControl/);
  assert.match(rendered, /<Select/);
  assert.match(rendered, /SelectChangeEvent<string>/);
  assert.equal(context.fields.length, 1);
  assert.equal(context.fields[0]?.isSelect, true);
  assert.equal(context.muiImports.has("FormControl"), true);
  assert.equal(context.muiImports.has("Select"), true);
});

test("renderSimpleFlexContainerAsStack renders dividers and self-closes when children collapse", () => {
  const context = createRenderContext();

  const element = makeNode({
    id: "simple-stack",
    type: "container",
    layoutMode: "VERTICAL",
    gap: 16,
    children: [
      makeNode({ id: "empty-child-1", type: "container", children: [] }),
      makeNode({ id: "divider-1", type: "divider", width: 200, height: 1 }),
      makeNode({ id: "empty-child-2", type: "container", children: [] })
    ]
  });

  const rendered = renderSimpleFlexContainerAsStack({
    element,
    depth: 1,
    parent: rootParent,
    context
  });

  assert.match(rendered, /<Stack /);
  assert.match(rendered, /divider=\{<Divider flexItem \/>\}/);
  assert.match(rendered, /\/>$/);
  assert.equal(context.muiImports.has("Divider"), true);
});

test("renderDialog falls back to container rendering when no title or content exists", () => {
  const context = createRenderContext();
  const rendered = renderDialog(
    makeNode({
      id: "empty-dialog",
      type: "dialog",
      name: "empty-dialog",
      fillColor: "#fafafa",
      width: 320,
      height: 180,
      children: []
    }),
    1,
    rootParent,
    context
  );

  assert.ok(rendered);
  assert.equal(rendered.includes("<Dialog"), false);
  assert.match(rendered, /<Box/);
  assert.equal(context.dialogs.length, 1);
});

test("renderDialog renders detected overlays with title and actions", () => {
  const context = createRenderContext();
  const element = makeNode({
    id: "dialog-shell",
    type: "dialog",
    name: "Delete dialog",
    width: 360,
    height: 240
  });
  const detectedPattern: DetectedDialogOverlayPattern = {
    panelNode: makeNode({
      id: "dialog-panel",
      type: "paper",
      name: "Dialog Panel",
      width: 320,
      height: 180,
      layoutMode: "VERTICAL",
      children: []
    }),
    title: "Delete file",
    contentNodes: [
      makeText({
        id: "dialog-copy",
        text: "This action cannot be undone."
      })
    ],
    actionModels: [
      {
        id: "cancel",
        label: "Cancel",
        isPrimary: false
      },
      {
        id: "confirm",
        label: "Delete",
        isPrimary: true
      }
    ]
  };

  const rendered = renderDialog(element, 1, rootParent, context, detectedPattern);

  assert.ok(rendered);
  assert.match(rendered, /<Dialog /);
  assert.match(rendered, /<DialogTitle id=\{"dialog-title-1"\}>\{"Delete file"\}<\/DialogTitle>/);
  assert.match(rendered, /<DialogActions>/);
  assert.match(rendered, /variant="contained"/);
});

test("tryRenderIconOnlyStepperContainer renders icon-only steppers with connectors", () => {
  const context = createRenderContext();
  const match = tryRenderIconOnlyStepperContainer({
    element: makeNode({
      id: "icon-stepper",
      type: "container",
      layoutMode: "HORIZONTAL",
      gap: 12,
      children: [
        makeNode({
          id: "stepper-icon-1",
          type: "container",
          name: "",
          nodeType: "VECTOR",
          width: 16,
          height: 16,
          vectorPaths: ["M0 0L10 10"]
        }),
        makeNode({
          id: "stepper-connector",
          type: "divider",
          name: "",
          width: 48,
          height: 2,
          fillColor: "#cccccc"
        }),
        makeNode({
          id: "stepper-icon-2",
          type: "container",
          name: "",
          nodeType: "VECTOR",
          width: 16,
          height: 16,
          vectorPaths: ["M1 1L9 9"]
        })
      ]
    }),
    depth: 1,
    parent: rootParent,
    context
  });
  const rendered = match?.rendered ?? null;

  assert.ok(rendered);
  assert.match(rendered, /<Stack /);
  assert.match(rendered, /aria-hidden="true"/);
  assert.match(rendered, /<Box aria-hidden="true"/);
});

test("renderStepper renders labeled steppers when item labels are present", () => {
  const context = createRenderContext();
  const rendered = renderStepper(
    makeNode({
      id: "text-stepper",
      type: "stepper",
      layoutMode: "HORIZONTAL",
      children: [
        makeNode({
          id: "step-1",
          type: "button",
          children: [makeText({ id: "step-1-text", text: "Identify" })]
        }),
        makeNode({
          id: "step-2",
          type: "button",
          children: [makeText({ id: "step-2-text", text: "Confirm" })]
        })
      ]
    }),
    1,
    rootParent,
    context
  );

  assert.ok(rendered);
  assert.match(rendered, /<Stepper activeStep=\{0\}/);
  assert.match(rendered, /<StepLabel>\{"Identify"\}<\/StepLabel>/);
  assert.match(rendered, /<StepLabel>\{"Confirm"\}<\/StepLabel>/);
});

test("renderProgress switches between linear and circular variants", () => {
  const context = createRenderContext();
  const linear = renderProgress(
    makeNode({
      id: "linear-progress",
      type: "progress",
      width: 160,
      height: 16
    }),
    1,
    rootParent,
    context
  );
  const circular = renderProgress(
    makeNode({
      id: "circular-progress",
      type: "progress",
      width: 32,
      height: 32
    }),
    1,
    rootParent,
    context
  );

  assert.match(linear, /<LinearProgress/);
  assert.match(circular, /<CircularProgress/);
});

test("renderAvatar falls back for empty shells and renders styled avatars when content exists", () => {
  const fallbackContext = createRenderContext();
  const fallback = renderAvatar(
    makeNode({
      id: "empty-avatar",
      type: "avatar",
      children: []
    }),
    1,
    rootParent,
    fallbackContext
  );

  assert.equal(fallback, null);

  const styledContext = createRenderContext({
    themeComponentDefaults: {
      MuiAvatar: {
        widthPx: 40,
        heightPx: 40,
        borderRadiusPx: 20
      }
    }
  });
  const styled = renderAvatar(
    makeNode({
      id: "styled-avatar",
      type: "avatar",
      width: 40,
      height: 40,
      cornerRadius: 20,
      fillColor: "#eeeeee",
      children: [makeText({ id: "avatar-text", text: "AB" })]
    }),
    1,
    rootParent,
    styledContext
  );

  assert.ok(styled);
  assert.match(styled, /<Avatar/);
  assert.match(styled, /\{"AB"\}/);
});

test("renderTooltipElement uses a placeholder anchor when the element has no children", () => {
  const context = createRenderContext();
  const rendered = renderTooltipElement(
    makeNode({
      id: "tooltip",
      type: "tooltip",
      name: "Need help?"
    }),
    1,
    rootParent,
    context
  );

  assert.match(rendered, /<Tooltip title=\{"Need help\?"\}>/);
  assert.match(rendered, /width: "24px"/);
  assert.match(rendered, /height: "24px"/);
});

test("renderStack falls back for empty stacks and renders populated ones", () => {
  const context = createRenderContext();
  const fallback = renderStack(
    makeNode({
      id: "empty-stack",
      type: "stack",
      fillColor: "#f5f5f5",
      width: 200,
      height: 48,
      children: []
    }),
    1,
    rootParent,
    context
  );
  const populated = renderStack(
    makeNode({
      id: "populated-stack",
      type: "stack",
      layoutMode: "HORIZONTAL",
      gap: 8,
      children: [makeText({ id: "stack-item", text: "Ready" })]
    }),
    1,
    rootParent,
    context
  );

  assert.ok(fallback);
  assert.equal(fallback.includes("<Stack"), false);
  assert.match(fallback, /<Box/);
  assert.ok(populated);
  assert.match(populated, /<Stack direction="row" spacing=\{1\}/);
});

test("renderPaper returns self-closing outlined Paper when no children render", () => {
  const context = createRenderContext();
  const rendered = renderPaper(
    makeNode({
      id: "outlined-paper",
      type: "paper",
      strokeColor: "#999999",
      children: []
    }),
    1,
    rootParent,
    context
  );

  assert.match(rendered, /<Paper variant="outlined"/);
  assert.match(rendered, /\/>$/);
});

test("fallback screen dependency assembly splits multiple interactive form groups into dedicated context files", () => {
  const screen: ScreenIR = {
    id: "screen-multi-group",
    name: "Account Setup",
    layoutMode: "VERTICAL",
    gap: 16,
    width: 390,
    height: 844,
    padding: {
      top: 24,
      right: 24,
      bottom: 24,
      left: 24
    },
    children: [
      makeNode({
        id: "email-input",
        type: "input",
        x: 0,
        y: 0,
        width: 320,
        height: 56,
        children: [
          makeText({ id: "email-label", text: "Email", y: 0 }),
          makeText({ id: "email-value", text: "name@example.com", y: 28 })
        ]
      }),
      makeNode({
        id: "email-submit",
        type: "button",
        x: 0,
        y: 72,
        width: 160,
        height: 40,
        text: "Continue",
        children: [makeText({ id: "email-submit-text", text: "Continue" })]
      }),
      makeNode({
        id: "otp-input",
        type: "input",
        x: 0,
        y: 160,
        width: 320,
        height: 56,
        children: [
          makeText({ id: "otp-label", text: "Code", y: 160 }),
          makeText({ id: "otp-value", text: "123456", y: 188 })
        ]
      }),
      makeNode({
        id: "otp-submit",
        type: "button",
        x: 0,
        y: 232,
        width: 160,
        height: 40,
        text: "Verify",
        children: [makeText({ id: "otp-submit-text", text: "Verify" })]
      })
    ]
  };

  const prepared = prepareFallbackScreenModel({
    screen,
    mappingByNodeId: new Map(),
    enablePatternExtraction: true,
    formHandlingMode: "react_hook_form"
  });
  const renderState = buildFallbackRenderState({ prepared });
  const dependencies = assembleFallbackDependencies({
    prepared,
    renderState
  });
  const generated = fallbackScreenFile({
    screen,
    mappingByNodeId: new Map(),
    enablePatternExtraction: true,
    formHandlingMode: "react_hook_form"
  });

  assert.equal(renderState.renderContext.fields.length, 2);
  assert.equal(renderState.formGroups.length, 2);
  assert.equal(dependencies.formContextFileSpecs?.length, 2);
  assert.equal(generated.contextFiles.length, 2);
  assert.equal(
    generated.contextFiles.some((file) => file.path.includes("AccountSetupFormGroup0")),
    true
  );
  assert.equal(
    generated.contextFiles.some((file) => file.path.includes("AccountSetupFormGroup1")),
    true
  );
});

test("fallbackScreenFile wraps specialized date pickers with a single configured provider per screen", () => {
  const screen: ScreenIR = {
    id: "screen-date-pickers",
    name: "Appointment Setup",
    layoutMode: "VERTICAL",
    gap: 16,
    width: 390,
    height: 844,
    padding: {
      top: 24,
      right: 24,
      bottom: 24,
      left: 24
    },
    children: [
      makeNode({
        id: "date-picker-start",
        type: "input",
        semanticType: "DatePicker",
        width: 320,
        height: 56,
        children: [
          makeText({ id: "start-label", text: "Start date", y: 0 }),
          makeText({ id: "start-value", text: "2026-04-02", y: 28 })
        ]
      }),
      makeNode({
        id: "date-picker-end",
        type: "input",
        semanticType: "DatePicker",
        y: 88,
        width: 320,
        height: 56,
        children: [
          makeText({ id: "end-label", text: "End date", y: 88 }),
          makeText({ id: "end-value", text: "2026-04-03", y: 116 })
        ]
      })
    ]
  };

  const generated = fallbackScreenFile({
    screen,
    mappingByNodeId: new Map(),
    formHandlingMode: "react_hook_form",
    specializedComponentMappings: {
      DatePicker: makeSpecializedMapping({
        componentKey: "DatePicker",
        modulePath: "@customer/forms",
        importedName: "CustomerDatePicker"
      })
    },
    datePickerProvider: {
      modulePath: "@customer/date-provider",
      importedName: "CustomerDatePickerProvider",
      localName: "CustomerDatePickerProvider",
      props: {
        adapterLocale: "de"
      },
      adapter: {
        modulePath: "@customer/date-provider",
        importedName: "CustomerDateAdapter",
        localName: "CustomerDateAdapter",
        propName: "dateAdapter"
      }
    }
  });

  assert.equal((generated.file.content.match(/<CustomerDatePicker\b/g) ?? []).length, 2);
  assert.equal((generated.file.content.match(/<CustomerDatePickerProvider\b/g) ?? []).length, 1);
  assert.match(
    generated.file.content,
    /<CustomerDatePickerProvider adapterLocale=\{"de"\} dateAdapter=\{CustomerDateAdapter\}>[\s\S]*<AppointmentSetupScreenContent \/>[\s\S]*<\/CustomerDatePickerProvider>/
  );
});

test("fallbackScreenFile keeps DatePicker on the MUI DatePicker fallback path when no provider configuration is available", () => {
  const screen: ScreenIR = {
    id: "screen-generic-date-picker",
    name: "Generic Date Picker",
    layoutMode: "VERTICAL",
    gap: 16,
    width: 390,
    height: 844,
    padding: {
      top: 24,
      right: 24,
      bottom: 24,
      left: 24
    },
    children: [
      makeNode({
        id: "date-picker-generic",
        type: "input",
        semanticType: "DatePicker",
        width: 320,
        height: 56,
        children: [
          makeText({ id: "generic-date-label", text: "Booking date", y: 0 }),
          makeText({ id: "generic-date-value", text: "2026-04-02", y: 28 })
        ]
      })
    ]
  };

  const generated = fallbackScreenFile({
    screen,
    mappingByNodeId: new Map(),
    formHandlingMode: "react_hook_form",
    specializedComponentMappings: {
      DatePicker: makeSpecializedMapping({
        componentKey: "DatePicker",
        modulePath: "@customer/forms",
        importedName: "CustomerDatePicker"
      })
    }
  });

  assert.equal(generated.file.content.includes("CustomerDatePickerProvider"), false);
  assert.equal(generated.file.content.includes("CustomerDatePicker"), false);
  assert.match(generated.file.content, /<LocalizationProvider dateAdapter=\{AdapterDateFns\}>/);
  assert.match(generated.file.content, /<DatePicker/);
  assert.equal(generated.file.content.includes("<TextField"), false);
});
