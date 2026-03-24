import assert from "node:assert/strict";
import test from "node:test";
import { createEmptySimplificationStats, renderMappedElement, simplifyElements } from "./generator-render.js";
import type { IconFallbackResolver, RenderContext, VirtualParent } from "./generator-render.js";
import type { ScreenElementIR } from "./types.js";

const emptyIconResolver: IconFallbackResolver = {
  entries: [],
  byIconName: new Map(),
  exactAliasMap: new Map(),
  tokenIndex: new Map(),
  synonymMap: new Map()
};

const createRenderContext = (): RenderContext => ({
  screenId: "screen-1",
  screenName: "Example",
  currentFilePath: "src/screens/Example.tsx",
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
  emittedWarningKeys: new Set(),
  emittedAccessibilityWarningKeys: new Set(),
  pageBackgroundColorNormalized: undefined,
  extractionInvocationByNodeId: new Map()
});

const rootParent: VirtualParent = {
  width: 1440,
  height: 900,
  layoutMode: "VERTICAL"
};

test("renderMappedElement resolves {{text}} from element.text on non-text nodes", () => {
  const context = createRenderContext();
  const element: ScreenElementIR = {
    id: "code-connect-button",
    name: "Primary action",
    nodeType: "INSTANCE",
    type: "button",
    text: "Weiter",
    codeConnect: {
      componentName: "AcmeButton",
      source: "src/components/AcmeButton.tsx",
      propContract: {
        children: "{{text}}"
      }
    }
  };

  const rendered = renderMappedElement(element, 2, rootParent, context);

  assert.ok(rendered);
  assert.match(rendered, />\{"Weiter"\}<\/AcmeButton>$/);
});

test("renderMappedElement uses element.text as implicit children when mapped contract omits children", () => {
  const context = createRenderContext();
  const element: ScreenElementIR = {
    id: "code-connect-chip",
    name: "Chip action",
    nodeType: "INSTANCE",
    type: "button",
    text: "Aktion",
    codeConnect: {
      componentName: "AcmeChip",
      source: "src/components/AcmeChip.tsx"
    }
  };

  const rendered = renderMappedElement(element, 1, rootParent, context);

  assert.ok(rendered);
  assert.match(rendered, />\{"Aktion"\}<\/AcmeChip>$/);
});

test("simplifyElements preserves semantic metadata containers instead of promoting their only child", () => {
  const stats = createEmptySimplificationStats();
  const elements: ScreenElementIR[] = [
    {
      id: "semantic-header",
      name: "Frame 12",
      nodeType: "FRAME",
      type: "container",
      semanticName: "Main Header",
      semanticType: "header",
      semanticSource: "metadata",
      children: [
        {
          id: "semantic-header-title",
          name: "Heading",
          nodeType: "TEXT",
          type: "text",
          text: "Dashboard"
        }
      ]
    }
  ];

  const simplified = simplifyElements({
    elements,
    depth: 0,
    stats
  });

  assert.equal(simplified.length, 1);
  assert.equal(simplified[0]?.id, "semantic-header");
  assert.equal(simplified[0]?.children?.[0]?.id, "semantic-header-title");
  assert.equal(stats.promotedSingleChild, 0);
  assert.equal(stats.guardedSkips, 1);
});
