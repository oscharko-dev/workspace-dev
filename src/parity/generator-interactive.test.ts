import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeListRow,
  detectDialogOverlayPattern,
  detectNavigationBarPattern,
  detectRepeatedListPattern,
  detectTabInterfacePattern,
  hasUnderlineIndicatorInTabStrip,
  resolveCenteredDialogPanelNode,
  resolveDialogActionModels,
  resolveTabPanelNodes,
  toListSecondaryActionExpression
} from "./generator-interactive.js";
import type { IconFallbackResolver, RenderContext, VirtualParent } from "./generator-render.js";
import type { ScreenElementIR } from "./types.js";

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

const createRenderContext = (): RenderContext => ({
  screenId: "screen-interactive",
  screenName: "Interactive",
  screenElements: [],
  currentFilePath: "src/screens/Interactive.tsx",
  generationLocale: "de-DE",
  formHandlingMode: "react_hook_form",
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
  routePathByScreenId: new Map([["screen-2", "/details"]]),
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
  pageBackgroundColorNormalized: undefined,
  requiresChangeEventTypeImport: false,
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

test("analyzeListRow detects avatar, two-line copy, and trailing actions while excluding action text", () => {
  const row = makeNode({
    id: "account-row",
    type: "container",
    layoutMode: "HORIZONTAL",
    children: [
      makeNode({
        id: "account-avatar",
        type: "avatar",
        name: "Avatar",
        x: 0,
        y: 0,
        width: 40,
        height: 40
      }),
      makeText({
        id: "account-title",
        text: "Primary account",
        x: 56,
        y: 0
      }),
      makeText({
        id: "account-subtitle",
        text: "Checking account",
        x: 56,
        y: 20
      }),
      makeNode({
        id: "account-action",
        type: "container",
        name: "Open details",
        x: 320,
        y: 8,
        width: 24,
        height: 24,
        children: [
          makeText({
            id: "account-action-label",
            text: "Ignored action text",
            x: 320,
            y: 8
          }),
          makeNode({
            id: "account-action-icon",
            type: "container",
            name: "ic_chevron_right",
            x: 320,
            y: 8,
            width: 16,
            height: 16,
            vectorPaths: ["M0 0L10 10"]
          })
        ]
      })
    ]
  });

  const analysis = analyzeListRow({
    row,
    generationLocale: "de-DE"
  });

  assert.equal(analysis.primaryText, "Primary account");
  assert.equal(analysis.secondaryText, "Checking account");
  assert.equal(analysis.leadingAvatarNode?.id, "account-avatar");
  assert.equal(analysis.trailingActionNode?.id, "account-action");
  assert.equal(analysis.structureSignature, "avatar|text2|action");
});

test("detectRepeatedListPattern accepts stable list rows and rejects inconsistent spacing", () => {
  const createRow = (id: string, y: number): ScreenElementIR =>
    makeNode({
      id,
      type: "container",
      layoutMode: "HORIZONTAL",
      x: 0,
      y,
      width: 360,
      height: 56,
      children: [
        makeNode({
          id: `${id}-icon`,
          type: "container",
          name: "ic_mail",
          x: 0,
          y,
          width: 16,
          height: 16,
          vectorPaths: ["M0 0L10 10"]
        }),
        makeText({
          id: `${id}-title`,
          text: `Item ${id}`,
          x: 40,
          y
        }),
        makeNode({
          id: `${id}-action`,
          type: "button",
          name: "Open",
          x: 320,
          y,
          width: 24,
          height: 24,
          children: [makeText({ id: `${id}-action-label`, text: "Open", x: 320, y })]
        })
      ]
    });

  const validList = makeNode({
    id: "valid-list",
    type: "container",
    layoutMode: "VERTICAL",
    children: [
      createRow("row-1", 0),
      makeNode({ id: "divider-1", type: "divider", width: 360, height: 1 }),
      createRow("row-2", 72),
      makeNode({ id: "divider-2", type: "divider", width: 360, height: 1 }),
      createRow("row-3", 144)
    ]
  });

  const validPattern = detectRepeatedListPattern({
    element: validList,
    generationLocale: "de-DE"
  });
  assert.equal(validPattern?.rows.length, 3);
  assert.equal(validPattern?.hasInterItemDivider, true);

  const irregularList = makeNode({
    id: "irregular-list",
    type: "container",
    layoutMode: "VERTICAL",
    children: [createRow("row-a", 0), createRow("row-b", 40), createRow("row-c", 144)]
  });
  assert.equal(
    detectRepeatedListPattern({
      element: irregularList,
      generationLocale: "de-DE"
    }),
    undefined
  );
});

test("toListSecondaryActionExpression renders router-linked icon buttons and rejects iconless actions", () => {
  const context = createRenderContext();
  const actionNode = makeNode({
    id: "secondary-action",
    type: "container",
    name: "Open details",
    prototypeNavigation: {
      targetScreenId: "screen-2",
      mode: "replace"
    },
    children: [
      makeNode({
        id: "secondary-action-icon",
        type: "container",
        name: "ic_chevron_right",
        width: 16,
        height: 16,
        vectorPaths: ["M0 0L10 10"]
      })
    ]
  });

  const expression = toListSecondaryActionExpression({
    actionNode,
    context
  });

  assert.match(expression ?? "", /<IconButton edge="end" aria-label=/);
  assert.match(expression ?? "", /component=\{RouterLink\} to=\{"\\u002Fdetails"\} replace/);
  assert.equal(context.usesRouterLink, true);
  assert.equal(context.prototypeNavigationRenderedCount, 1);
  assert.equal(context.muiImports.has("IconButton"), true);

  assert.equal(
    toListSecondaryActionExpression({
      actionNode: makeNode({
        id: "iconless-action",
        type: "container",
        name: "plain-action"
      }),
      context: createRenderContext()
    }),
    undefined
  );
});

test("detectTabInterfacePattern resolves nested tab strips with matching panels", () => {
  const context = createRenderContext();
  const tabStrip = makeNode({
    id: "tab-strip",
    type: "container",
    name: "Tabs",
    layoutMode: "HORIZONTAL",
    x: 0,
    y: 0,
    width: 520,
    height: 40,
    children: [
      makeNode({
        id: "tab-a",
        type: "button",
        name: "Overview",
        x: 0,
        y: 0,
        width: 160,
        height: 36,
        prototypeNavigation: {
          targetScreenId: "screen-2",
          mode: "push"
        },
        children: [makeText({ id: "tab-a-text", text: "Overview", x: 12, y: 8, fillColor: "#1976d2" })]
      }),
      makeNode({
        id: "tab-b",
        type: "button",
        name: "Details",
        x: 180,
        y: 0,
        width: 160,
        height: 36,
        children: [makeText({ id: "tab-b-text", text: "Details", x: 192, y: 8, fillColor: "#6b7280" })]
      }),
      makeNode({
        id: "tab-indicator",
        type: "container",
        name: "indicator",
        x: 12,
        y: 36,
        width: 120,
        height: 2,
        fillColor: "#1976d2"
      })
    ]
  });
  const tabHost = makeNode({
    id: "tab-host",
    type: "container",
    name: "Account tabs",
    layoutMode: "VERTICAL",
    children: [
      tabStrip,
      makeNode({
        id: "panel-a",
        type: "container",
        x: 0,
        y: 64,
        width: 520,
        height: 180,
        children: [makeText({ id: "panel-a-text", text: "Panel A content", x: 0, y: 64 })]
      }),
      makeNode({
        id: "panel-b",
        type: "container",
        x: 0,
        y: 264,
        width: 520,
        height: 180,
        children: [makeText({ id: "panel-b-text", text: "Panel B content", x: 0, y: 264 })]
      })
    ]
  });

  const pattern = detectTabInterfacePattern({
    element: tabHost,
    depth: 3,
    context
  });

  assert.equal(pattern?.tabStripNode.id, "tab-strip");
  assert.equal(pattern?.tabItems.length, 2);
  assert.equal(pattern?.panelNodes.length, 2);
  assert.equal(
    detectTabInterfacePattern({
      element: tabHost,
      depth: 2,
      context: createRenderContext()
    }),
    undefined
  );
});

test("tab helper internals detect underline indicators and validate panel sets", () => {
  const context = createRenderContext();
  const strip = makeNode({
    id: "tabs",
    type: "container",
    name: "Tabs",
    x: 0,
    y: 0,
    width: 360,
    height: 40,
    children: [
      makeNode({
        id: "tab-1",
        type: "button",
        name: "One",
        x: 0,
        y: 0,
        width: 120,
        height: 36,
        children: [makeText({ id: "tab-1-text", text: "One", x: 16, y: 8 })]
      }),
      makeNode({
        id: "tab-2",
        type: "button",
        name: "Two",
        x: 140,
        y: 0,
        width: 120,
        height: 36,
        children: [makeText({ id: "tab-2-text", text: "Two", x: 156, y: 8 })]
      }),
      makeNode({
        id: "indicator-line",
        type: "container",
        name: "indicator",
        x: 16,
        y: 36,
        width: 80,
        height: 2,
        fillColor: "#1976d2"
      }),
      makeNode({
        id: "full-divider",
        type: "divider",
        x: 0,
        y: 39,
        width: 360,
        height: 1,
        fillColor: "#e5e7eb"
      })
    ]
  });

  assert.equal(
    hasUnderlineIndicatorInTabStrip({
      tabStripNode: strip,
      tabActionNodeIds: new Set(["tab-1", "tab-2"])
    }),
    true
  );

  const host = makeNode({
    id: "tab-host",
    type: "container",
    layoutMode: "VERTICAL",
    children: [
      strip,
      makeNode({
        id: "panel-1",
        type: "container",
        x: 0,
        y: 60,
        width: 360,
        height: 120,
        children: [makeText({ id: "panel-1-text", text: "Panel one", x: 0, y: 60 })]
      }),
      makeNode({
        id: "panel-2",
        type: "container",
        x: 0,
        y: 200,
        width: 360,
        height: 120,
        children: [makeText({ id: "panel-2-text", text: "Panel two", x: 0, y: 200 })]
      })
    ]
  });
  assert.equal(resolveTabPanelNodes({ hostElement: strip, tabStripNode: strip, tabCount: 2, context }).length, 0);
  assert.equal(resolveTabPanelNodes({ hostElement: host, tabStripNode: strip, tabCount: 3, context }).length, 0);
  assert.equal(resolveTabPanelNodes({ hostElement: host, tabStripNode: strip, tabCount: 2, context }).length, 2);
  assert.equal(
    resolveTabPanelNodes({
      hostElement: {
        ...host,
        children: [
          strip,
          makeNode({ id: "short-panel", type: "container", x: 0, y: 20, width: 360, height: 20, children: [] }),
          host.children?.[2]!
        ]
      },
      tabStripNode: strip,
      tabCount: 2,
      context
    }).length,
    0
  );
});

test("detectDialogOverlayPattern finds centered modal panels with actions and close controls", () => {
  const context = createRenderContext();
  const overlay = makeNode({
    id: "dialog-overlay",
    type: "container",
    name: "Settings dialog overlay",
    x: 0,
    y: 0,
    width: 1440,
    height: 900,
    opacity: 0.72,
    children: [
      makeNode({
        id: "dialog-panel",
        type: "container",
        name: "Settings dialog panel",
        x: 420,
        y: 220,
        width: 600,
        height: 340,
        fillColor: "#ffffff",
        children: [
          makeNode({
            id: "dialog-header",
            type: "container",
            layoutMode: "HORIZONTAL",
            children: [
              makeText({ id: "dialog-title", text: "Settings", x: 456, y: 248 }),
              makeNode({
                id: "dialog-close",
                type: "button",
                name: "Close dialog",
                x: 960,
                y: 248,
                width: 24,
                height: 24,
                children: [
                  makeNode({
                    id: "dialog-close-icon",
                    type: "container",
                    name: "ic_close",
                    width: 16,
                    height: 16,
                    vectorPaths: ["M0 0L10 10"]
                  })
                ]
              })
            ]
          }),
          makeNode({
            id: "dialog-body",
            type: "container",
            x: 456,
            y: 292,
            width: 520,
            height: 140,
            children: [makeText({ id: "dialog-copy", text: "Review your account settings.", x: 456, y: 292 })]
          }),
          makeNode({
            id: "dialog-actions",
            type: "container",
            layoutMode: "HORIZONTAL",
            x: 456,
            y: 480,
            width: 320,
            height: 40,
            children: [
              makeNode({
                id: "cancel-action",
                type: "button",
                name: "Cancel",
                children: [makeText({ id: "cancel-label", text: "Cancel", x: 456, y: 480 })]
              }),
              makeNode({
                id: "save-action",
                type: "button",
                name: "Save",
                children: [makeText({ id: "save-label", text: "Save", x: 560, y: 480 })]
              })
            ]
          })
        ]
      })
    ]
  });

  const pattern = detectDialogOverlayPattern({
    element: overlay,
    depth: 3,
    parent: rootParent,
    context
  });

  assert.equal(pattern?.panelNode.id, "dialog-panel");
  assert.equal(pattern?.title, "Settings");
  assert.equal(pattern?.actionModels.length, 2);
  assert.equal(
    detectDialogOverlayPattern({
      element: {
        ...overlay,
        id: "non-overlay",
        opacity: 1
      },
      depth: 3,
      parent: rootParent,
      context: createRenderContext()
    }),
    undefined
  );
});

test("dialog helper internals pick centered panels and derive grouped or direct action models", () => {
  const context = createRenderContext();
  const overlay = makeNode({
    id: "overlay",
    type: "container",
    x: 0,
    y: 0,
    width: 1440,
    height: 900,
    opacity: 0.7,
    children: [
      makeNode({
        id: "off-center",
        type: "container",
        x: 80,
        y: 80,
        width: 260,
        height: 180,
        fillColor: "#ffffff",
        children: [makeText({ id: "off-center-copy", text: "Ignored", x: 96, y: 96 })]
      }),
      makeNode({
        id: "centered-panel",
        type: "container",
        x: 420,
        y: 220,
        width: 600,
        height: 320,
        fillColor: "#ffffff",
        children: [makeText({ id: "centered-copy", text: "Centered", x: 456, y: 256 })]
      })
    ]
  });
  assert.equal(resolveCenteredDialogPanelNode({ overlayNode: overlay, context })?.id, "centered-panel");

  const actionPanel = makeNode({
    id: "action-panel",
    type: "container",
    layoutMode: "VERTICAL",
    children: [
      makeNode({
        id: "action-row",
        type: "container",
        layoutMode: "HORIZONTAL",
        children: [
          makeNode({
            id: "cancel",
            type: "button",
            name: "Cancel",
            children: [makeText({ id: "cancel-text", text: "Cancel" })]
          }),
          makeNode({
            id: "save",
            type: "button",
            name: "Save",
            children: [makeText({ id: "save-text", text: "Save" })]
          })
        ]
      })
    ]
  });
  const extractedRowActions = resolveDialogActionModels({
    panelNode: actionPanel,
    context
  });
  assert.equal(extractedRowActions.actionHostNodeId, "action-row");
  assert.deepEqual(
    extractedRowActions.actionModels.map((model) => [model.label, model.isPrimary]),
    [
      ["Cancel", false],
      ["Save", true]
    ]
  );

  const directActionPanel = makeNode({
    id: "direct-action-panel",
    type: "container",
    children: [
      makeNode({
        id: "dismiss",
        type: "button",
        name: "Dismiss",
        children: [makeText({ id: "dismiss-text", text: "Dismiss" })]
      })
    ]
  });
  assert.deepEqual(resolveDialogActionModels({ panelNode: directActionPanel, context }).actionModels, [
    {
      id: "dismiss",
      label: "Dismiss",
      isPrimary: true
    }
  ]);
});

test("detectNavigationBarPattern distinguishes app bars from bottom navigation", () => {
  const appBar = makeNode({
    id: "app-bar",
    type: "container",
    name: "Header",
    x: 0,
    y: 0,
    width: 1440,
    height: 64,
    children: [
      makeNode({
        id: "menu-icon",
        type: "container",
        name: "ic_menu",
        x: 16,
        y: 20,
        width: 24,
        height: 24,
        vectorPaths: ["M0 0L10 10"]
      }),
      makeText({ id: "app-bar-title", text: "Dashboard", x: 64, y: 20 })
    ]
  });

  const bottomNavigation = makeNode({
    id: "bottom-navigation",
    type: "container",
    name: "Primary navigation",
    x: 0,
    y: 828,
    width: 1440,
    height: 72,
    children: [
      makeNode({
        id: "home-nav",
        type: "button",
        name: "Home",
        x: 120,
        y: 840,
        width: 100,
        height: 40,
        children: [makeText({ id: "home-label", text: "Home", x: 140, y: 852 })]
      }),
      makeNode({
        id: "search-nav",
        type: "button",
        name: "Search",
        x: 280,
        y: 840,
        width: 100,
        height: 40,
        children: [makeText({ id: "search-label", text: "Search", x: 300, y: 852 })]
      })
    ]
  });

  assert.equal(
    detectNavigationBarPattern({
      element: appBar,
      depth: 3,
      parent: rootParent,
      context: createRenderContext()
    }),
    "appbar"
  );
  assert.equal(
    detectNavigationBarPattern({
      element: bottomNavigation,
      depth: 3,
      parent: rootParent,
      context: createRenderContext()
    }),
    "navigation"
  );
});
