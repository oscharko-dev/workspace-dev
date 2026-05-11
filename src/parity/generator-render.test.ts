import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  clusterAxisValues,
  compileIconFallbackResolver,
  createEmptySimplificationStats,
  detectCssGridLayout,
  detectGridLikeContainerLayout,
  isIconLikeNode,
  loadIconFallbackResolver,
  parseIconFallbackMapFile,
  renderMappedElement,
  resolveIconImportSpecFromCatalog,
  resolveFallbackIconComponent,
  simplifyElements,
  toBoundedLevenshteinDistance,
  toNearestClusterIndex,
  toSequentialDeltas,
  pickBestIconNode,
} from "./generator-render.js";
import { renderFallbackIconExpression } from "./templates/icon-template.js";
import type {
  IconFallbackResolver,
  RenderContext,
  VirtualParent,
} from "./generator-render.js";
import type { ScreenElementIR } from "./types.js";

const emptyIconResolver: IconFallbackResolver = {
  entries: [],
  byIconName: new Map(),
  exactAliasMap: new Map(),
  tokenIndex: new Map(),
  synonymMap: new Map(),
};

const createRenderContext = (): RenderContext => ({
  screenId: "screen-1",
  screenName: "Example",
  screenElements: [],
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
  extractionInvocationByNodeId: new Map(),
});

const rootParent: VirtualParent = {
  x: 0,
  y: 0,
  width: 1440,
  height: 900,
  layoutMode: "VERTICAL",
};

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
} & Omit<
  Partial<ScreenElementIR>,
  "id" | "type" | "name" | "nodeType"
>): ScreenElementIR => ({
  id,
  type,
  name,
  nodeType,
  ...overrides,
});

const createResolverEntry = ({
  iconName,
  aliases,
  priority,
}: {
  iconName: string;
  aliases: string[];
  priority: number;
}) => ({
  iconName,
  aliases,
  importSpec: {
    localName: `${iconName}Icon`,
    modulePath: `@mui/icons-material/${iconName}`,
  },
  priority,
});

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
        children: "{{text}}",
      },
    },
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
      source: "src/components/AcmeChip.tsx",
    },
  };

  const rendered = renderMappedElement(element, 1, rootParent, context);

  assert.ok(rendered);
  assert.match(rendered, />\{"Aktion"\}<\/AcmeChip>$/);
});

test("renderMappedElement escapes unsafe characters in mapped object contracts", () => {
  const context = createRenderContext();
  const element: ScreenElementIR = {
    id: "code-connect-escape-check",
    name: "Escaped contract",
    nodeType: "INSTANCE",
    type: "button",
    text: "Run",
    codeConnect: {
      componentName: "AcmeButton",
      source: "src/components/AcmeButton.tsx",
      propContract: {
        children: "{{text}}",
        options: { script: "</script><script>" },
      },
    },
  };

  const rendered = renderMappedElement(element, 1, rootParent, context);

  assert.ok(rendered);
  assert.ok(
    rendered.includes(
      'options={{"script":"\\u003C\\u002Fscript\\u003E\\u003Cscript\\u003E"}}',
    ),
  );
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
          text: "Dashboard",
        },
      ],
    },
  ];

  const simplified = simplifyElements({
    elements,
    depth: 0,
    stats,
  });

  assert.equal(simplified.length, 1);
  assert.equal(simplified[0]?.id, "semantic-header");
  assert.equal(simplified[0]?.children?.[0]?.id, "semantic-header-title");
  assert.equal(stats.promotedSingleChild, 0);
  assert.equal(stats.guardedSkips, 1);
});

test("renderMappedElement handles disabled and invalid manual mappings before normalizing code connect imports", () => {
  const context = createRenderContext();
  context.muiImports.add("AcmeButton");
  context.mappingByNodeId.set("manual-disabled", {
    boardKey: "board-1",
    nodeId: "manual-disabled",
    componentName: "AcmeButton",
    importPath: "src/components/AcmeButton.tsx",
    priority: 0,
    source: "local_override",
    enabled: false,
  });
  context.mappingByNodeId.set("manual-invalid", {
    boardKey: "board-1",
    nodeId: "manual-invalid",
    componentName: "AcmeButton",
    importPath: "src/components/AcmeButton.tsx",
    propContract: "children" as unknown as Record<string, unknown>,
    priority: 1,
    source: "local_override",
    enabled: true,
  });

  assert.equal(
    renderMappedElement(
      makeNode({
        id: "manual-disabled",
        type: "button",
        name: "Disabled mapped button",
        text: "Do not render",
      }),
      1,
      rootParent,
      context,
    ),
    undefined,
  );
  assert.equal(
    context.mappingWarnings[0]?.code,
    "W_COMPONENT_MAPPING_DISABLED",
  );

  assert.equal(
    renderMappedElement(
      makeNode({
        id: "manual-invalid",
        type: "button",
        name: "Invalid mapped button",
        text: "Broken",
      }),
      1,
      rootParent,
      context,
    ),
    undefined,
  );
  assert.equal(
    context.mappingWarnings[1]?.code,
    "W_COMPONENT_MAPPING_CONTRACT_MISMATCH",
  );

  const firstRendered = renderMappedElement(
    {
      id: "code-connect-one",
      name: "Primary action",
      nodeType: "INSTANCE",
      type: "button",
      text: "Continue",
      codeConnect: {
        componentName: "AcmeButton",
        source:
          "/Users/oscharko/Projects/workspace-dev/src/components/AcmeButton.tsx",
      },
    },
    1,
    rootParent,
    context,
  );
  const secondRendered = renderMappedElement(
    {
      id: "code-connect-two",
      name: "Secondary action",
      nodeType: "INSTANCE",
      type: "button",
      text: "Cancel",
      codeConnect: {
        componentName: "RenamedButton",
        source:
          "/Users/oscharko/Projects/workspace-dev/src/components/AcmeButton.tsx",
      },
    },
    1,
    rootParent,
    context,
  );

  assert.match(firstRendered ?? "", /<AcmeButton2 /);
  assert.match(secondRendered ?? "", /<AcmeButton2 /);
  assert.deepEqual(context.mappedImports, [
    {
      localName: "AcmeButton2",
      modulePath: "../components/AcmeButton",
      importMode: "default",
    },
  ]);
});

test("pickBestIconNode prefers vector-backed icon candidates and smaller areas on ties", () => {
  const best = pickBestIconNode(
    makeNode({
      id: "icon-host",
      type: "container",
      children: [
        makeNode({
          id: "large-generic",
          type: "container",
          name: "muiSvgIconRoot",
          width: 32,
          height: 32,
          vectorPaths: ["M0 0H24V24H0Z"],
        }),
        makeNode({
          id: "best-candidate",
          type: "container",
          name: "ic_arrow_right",
          width: 16,
          height: 16,
          vectorPaths: ["M0 0L10 10"],
        }),
        makeNode({
          id: "wrapper",
          type: "container",
          name: "iconcomponent",
          width: 24,
          height: 24,
        }),
      ],
    }),
  );

  assert.equal(best?.id, "best-candidate");
});

test("isIconLikeNode recognizes word-boundary icon names and prefix variants without degrading generic containers", () => {
  assert.equal(
    isIconLikeNode(
      makeNode({ id: "search-icon", type: "container", name: "search_icon" }),
    ),
    true,
  );
  assert.equal(
    isIconLikeNode(
      makeNode({ id: "close-icon", type: "container", name: "close icon" }),
    ),
    true,
  );
  assert.equal(
    isIconLikeNode(
      makeNode({ id: "brand-check", type: "container", name: "brand/check" }),
    ),
    true,
  );
  assert.equal(
    isIconLikeNode(
      makeNode({
        id: "semantic-success",
        type: "container",
        name: "semantic-success",
      }),
    ),
    true,
  );
  assert.equal(
    isIconLikeNode(
      makeNode({ id: "generic-box", type: "container", name: "my-box" }),
    ),
    false,
  );
});

test("pickBestIconNode scores word-boundary icon names above unrelated candidates and below explicit prefixes", () => {
  const wordBoundaryWinner = pickBestIconNode(
    makeNode({
      id: "host-word",
      type: "container",
      name: "Frame 1",
      children: [
        makeNode({ id: "search-icon", type: "container", name: "search_icon" }),
        makeNode({
          id: "unrelated-box",
          type: "container",
          name: "unrelated_box",
        }),
      ],
    }),
  );
  assert.equal(wordBoundaryWinner?.id, "search-icon");

  const prefixWinner = pickBestIconNode(
    makeNode({
      id: "host-prefix",
      type: "container",
      name: "Frame 2",
      children: [
        makeNode({ id: "ic-home", type: "container", name: "ic_home" }),
        makeNode({ id: "search-icon", type: "container", name: "search_icon" }),
      ],
    }),
  );
  assert.equal(prefixWinner?.id, "ic-home");
});

test("loadIconFallbackResolver falls back to built-in catalog for missing, invalid, or malformed files", async () => {
  const tempDirectory = mkdtempSync(
    path.join(tmpdir(), "workspace-dev-icon-map-"),
  );

  const missingPath = path.join(
    tempDirectory,
    "nested",
    "icon-fallback-map.json",
  );
  const missingLogs: string[] = [];
  const missingResolver = await loadIconFallbackResolver({
    iconMapFilePath: missingPath,
    onLog: (message) => missingLogs.push(message),
  });

  assert.equal(missingResolver.entries.length > 0, true);
  assert.equal(
    missingLogs.some((message) => message.includes("not found")),
    true,
  );

  const invalidPath = path.join(tempDirectory, "invalid.json");
  writeFileSync(
    invalidPath,
    JSON.stringify({ version: 1, entries: [] }),
    "utf8",
  );
  const invalidLogs: string[] = [];
  const invalidResolver = await loadIconFallbackResolver({
    iconMapFilePath: invalidPath,
    onLog: (message) => invalidLogs.push(message),
  });

  assert.equal(invalidResolver.entries.length > 0, true);
  assert.equal(
    invalidLogs.some((message) => message.includes("is invalid")),
    true,
  );

  const malformedPath = path.join(tempDirectory, "malformed.json");
  writeFileSync(malformedPath, "{ malformed", "utf8");
  const malformedLogs: string[] = [];
  const malformedResolver = await loadIconFallbackResolver({
    iconMapFilePath: malformedPath,
    onLog: (message) => malformedLogs.push(message),
  });

  assert.equal(malformedResolver.entries.length > 0, true);
  assert.equal(
    malformedLogs.some((message) =>
      message.includes("Failed to load icon fallback map"),
    ),
    true,
  );
});

test("loadIconFallbackResolver compiles custom aliases and synonyms", async () => {
  const tempDirectory = mkdtempSync(
    path.join(tmpdir(), "workspace-dev-custom-icon-map-"),
  );
  const customMapPath = path.join(tempDirectory, "icon-fallback-map.json");
  writeFileSync(
    customMapPath,
    JSON.stringify(
      {
        version: 1,
        entries: [
          {
            iconName: "PersonSearch",
            aliases: ["people lookup", "advisor search"],
          },
          { iconName: "Mail", aliases: ["mail"] },
        ],
        synonyms: {
          consultant: "PersonSearch",
          inbox: "Mail",
          invalid: 42,
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const resolver = await loadIconFallbackResolver({
    iconMapFilePath: customMapPath,
    onLog: () => undefined,
  });

  assert.equal(
    resolver.exactAliasMap.get("people lookup")?.iconName,
    "PersonSearch",
  );
  assert.equal(resolver.synonymMap.get("consultant")?.iconName, "PersonSearch");
  assert.equal(resolver.synonymMap.get("inbox")?.iconName, "Mail");
});

test("parseIconFallbackMapFile and compileIconFallbackResolver sanitize entries, aliases, and collisions", () => {
  assert.equal(
    parseIconFallbackMapFile({ input: { version: 2, entries: [] } }),
    undefined,
  );
  assert.equal(
    parseIconFallbackMapFile({ input: { version: 1, entries: [] } }),
    undefined,
  );

  const parsed = parseIconFallbackMapFile({
    input: {
      version: 1,
      entries: [
        null,
        { iconName: "Mail", aliases: [" message ", "", 42] },
        { iconName: "ChatBubble", aliases: ["message", " chat bubble "] },
        { iconName: "bad icon", aliases: ["broken"] },
        { iconName: "HomeOutlined" },
      ],
      synonyms: {
        " inbox ": "Mail",
        chat: "ChatBubble",
        broken: 42,
      },
    },
  });

  assert.deepEqual(parsed, {
    version: 1,
    entries: [
      { iconName: "Mail" },
      { iconName: "ChatBubble", aliases: ["message", "chat bubble"] },
      { iconName: "HomeOutlined" },
    ],
    synonyms: {
      inbox: "Mail",
      chat: "ChatBubble",
    },
  });

  const resolver = compileIconFallbackResolver({
    map: parsed!,
  });
  assert.equal(resolver.exactAliasMap.get("message")?.iconName, "ChatBubble");
  assert.deepEqual(
    resolver.tokenIndex.get("chat")?.map((entry) => entry.iconName),
    ["ChatBubble"],
  );
  assert.equal(resolver.synonymMap.get("chat")?.iconName, "ChatBubble");
  assert.equal(resolver.exactAliasMap.get("home")?.iconName, "HomeOutlined");
});

test("toBoundedLevenshteinDistance and resolveIconImportSpecFromCatalog handle exact, boundary, synonym, fuzzy, and default matches", () => {
  const resolver = compileIconFallbackResolver({
    map: {
      version: 1,
      entries: [
        { iconName: "Mail", aliases: ["mail", "message center"] },
        { iconName: "Search", aliases: ["search"] },
      ],
      synonyms: {
        inbox: "Mail",
      },
    },
  });

  assert.equal(
    toBoundedLevenshteinDistance({
      left: "search",
      right: "search",
      maxDistance: 1,
    }),
    0,
  );
  assert.equal(
    toBoundedLevenshteinDistance({
      left: "search",
      right: "serch",
      maxDistance: 2,
    }),
    1,
  );
  assert.equal(
    toBoundedLevenshteinDistance({
      left: "search",
      right: "completely-different",
      maxDistance: 2,
    }),
    undefined,
  );

  assert.deepEqual(
    resolveIconImportSpecFromCatalog({ rawInput: "mail", resolver }),
    {
      localName: "MailIcon",
      modulePath: "@mui/icons-material/Mail",
    },
  );
  assert.deepEqual(
    resolveIconImportSpecFromCatalog({
      rawInput: "open mail drawer",
      resolver,
    }),
    {
      localName: "MailIcon",
      modulePath: "@mui/icons-material/Mail",
    },
  );
  assert.deepEqual(
    resolveIconImportSpecFromCatalog({
      rawInput: "Inbox notifications",
      resolver,
    }),
    {
      localName: "MailIcon",
      modulePath: "@mui/icons-material/Mail",
    },
  );
  assert.deepEqual(
    resolveIconImportSpecFromCatalog({ rawInput: "serch", resolver }),
    {
      localName: "SearchIcon",
      modulePath: "@mui/icons-material/Search",
    },
  );
  assert.deepEqual(
    resolveIconImportSpecFromCatalog({ rawInput: "", resolver }),
    {
      localName: "InfoOutlinedIcon",
      modulePath: "@mui/icons-material/InfoOutlined",
    },
  );
});

test("resolveFallbackIconComponent honors deterministic parent hints and resolver-based fallback matching", () => {
  const mailEntry = createResolverEntry({
    iconName: "Mail",
    aliases: ["mail"],
    priority: 0,
  });
  const searchEntry = createResolverEntry({
    iconName: "Search",
    aliases: ["search"],
    priority: 1,
  });
  const resolver: IconFallbackResolver = {
    entries: [mailEntry, searchEntry],
    byIconName: new Map([
      ["Mail", mailEntry],
      ["Search", searchEntry],
    ]),
    exactAliasMap: new Map([
      ["mail", mailEntry],
      ["search", searchEntry],
    ]),
    tokenIndex: new Map([
      ["mail", [mailEntry]],
      ["search", [searchEntry]],
    ]),
    synonymMap: new Map([["message", mailEntry]]),
  };

  const chevronContext = createRenderContext();
  assert.equal(
    resolveFallbackIconComponent({
      element: makeNode({
        id: "end-icon",
        type: "container",
        name: "Vector Host",
      }),
      parent: { name: "ButtonEndIcon" },
      context: chevronContext,
    }),
    "ChevronRightIcon",
  );

  const expandContext = createRenderContext();
  assert.equal(
    resolveFallbackIconComponent({
      element: makeNode({
        id: "select-indicator",
        type: "container",
        name: "ArrowDropDownIcon",
      }),
      parent: { name: "MuiSelectSelect" },
      context: expandContext,
    }),
    "ExpandMoreIcon",
  );

  const accordionContext = createRenderContext();
  assert.equal(
    resolveFallbackIconComponent({
      element: makeNode({
        id: "accordion-indicator",
        type: "container",
        name: "Whatever",
      }),
      parent: { name: "AccordionSummaryContent" },
      context: accordionContext,
    }),
    "TuneIcon",
  );

  const exactContext = createRenderContext();
  exactContext.iconResolver = resolver;
  assert.equal(
    resolveFallbackIconComponent({
      element: makeNode({
        id: "exact-match",
        type: "container",
        name: "Mail",
      }),
      parent: { name: "IconHost" },
      context: exactContext,
    }),
    "MailIcon",
  );

  const synonymContext = createRenderContext();
  synonymContext.iconResolver = resolver;
  assert.equal(
    resolveFallbackIconComponent({
      element: makeNode({
        id: "synonym-match",
        type: "container",
        name: "Message Center",
      }),
      parent: { name: "IconHost" },
      context: synonymContext,
    }),
    "MailIcon",
  );

  const fuzzyContext = createRenderContext();
  fuzzyContext.iconResolver = resolver;
  assert.equal(
    resolveFallbackIconComponent({
      element: makeNode({
        id: "fuzzy-match",
        type: "container",
        name: "Serch",
      }),
      parent: { name: "IconHost" },
      context: fuzzyContext,
    }),
    "SearchIcon",
  );

  const defaultContext = createRenderContext();
  defaultContext.iconResolver = emptyIconResolver;
  assert.equal(
    resolveFallbackIconComponent({
      element: makeNode({
        id: "default-match",
        type: "container",
        name: "Completely Unknown Symbol",
      }),
      parent: { name: "IconHost" },
      context: defaultContext,
    }),
    "InfoOutlinedIcon",
  );
});

test("renderFallbackIconExpression uses exact Storybook-first customer icon imports before heuristic fallbacks", () => {
  const context = createRenderContext();
  context.storybookFirstIconLookup = new Map([
    [
      "mail",
      {
        iconKey: "mail",
        status: "resolved_import",
        reason: "profile_icon_import_resolved",
        import: {
          package: "@customer/icons",
          exportName: "MailIcon",
          localName: "CustomerMailIcon",
        },
      },
    ],
  ]);

  const rendered = renderFallbackIconExpression({
    element: makeNode({
      id: "mail-icon",
      type: "container",
      name: "Icon",
      semanticName: "Mail",
    }),
    parent: rootParent,
    context,
  });

  assert.equal(rendered.includes("<CustomerMailIcon"), true);
  assert.deepEqual(context.mappedImports, [
    {
      localName: "CustomerMailIcon",
      modulePath: "@customer/icons",
      importMode: "named",
      importedName: "MailIcon",
    },
  ]);
});

test("renderFallbackIconExpression uses generic Storybook-first icon wrapper with normalized icon key prop", () => {
  const context = createRenderContext();
  context.storybookFirstIconLookup = new Map([
    [
      "search",
      {
        iconKey: "search",
        status: "wrapper_fallback_allowed",
        reason: "profile_icon_wrapper_allowed",
        wrapper: {
          package: "@customer/icons",
          exportName: "Icon",
          localName: "CustomerIcon",
          iconPropName: "name",
        },
      },
    ],
  ]);

  const rendered = renderFallbackIconExpression({
    element: makeNode({
      id: "search-icon",
      type: "container",
      name: "Icon",
      semanticName: "Search",
    }),
    parent: rootParent,
    context,
  });

  assert.equal(rendered.includes("<CustomerIcon"), true);
  assert.equal(rendered.includes('name={"search"}'), true);
});

test("renderFallbackIconExpression emits a warning and falls back to heuristic MUI icon when Storybook-first icon lookup is unresolved", () => {
  const context = createRenderContext();
  context.storybookFirstIconLookup = new Map([
    [
      "mail",
      {
        iconKey: "mail",
        status: "wrapper_fallback_denied",
        reason: "profile_icon_wrapper_denied",
      },
    ],
  ]);
  context.iconWarnings = [];
  context.emittedIconWarningKeys = new Set();
  context.iconResolver = compileIconFallbackResolver({
    map: {
      version: 1,
      entries: [{ iconName: "Mail", aliases: ["mail"] }],
    },
  });

  const rendered = renderFallbackIconExpression({
    element: makeNode({
      id: "mail-icon",
      type: "container",
      name: "Mail",
    }),
    parent: rootParent,
    context,
  });

  assert.equal(rendered.includes("<MailIcon"), true);
  assert.equal(context.iconWarnings?.length, 1);
  assert.equal(
    context.iconWarnings?.[0]?.code,
    "W_STORYBOOK_ICON_HEURISTIC_FALLBACK",
  );
});

test("renderFallbackIconExpression uses direct customer-profile icon imports when storybookFirstIconLookup has no match", () => {
  const context = createRenderContext();
  context.storybookFirstIconLookup = new Map([
    [
      "other",
      {
        iconKey: "other",
        status: "resolved_import",
        reason: "profile_icon_import_resolved",
        import: {
          package: "@customer/icons",
          exportName: "OtherIcon",
          localName: "CustomerOtherIcon",
        },
      },
    ],
  ]);
  context.profileIconImportsByKey = new Map([
    [
      "mail",
      {
        iconKey: "mail",
        package: "@customer/icons",
        exportName: "MailIcon",
        localName: "CustomerMailIcon",
      },
    ],
  ]);

  const rendered = renderFallbackIconExpression({
    element: makeNode({
      id: "mail-icon",
      type: "container",
      name: "Icon",
      semanticName: "Mail",
    }),
    parent: rootParent,
    context,
  });

  assert.equal(rendered.includes("<CustomerMailIcon"), true);
  assert.deepEqual(context.mappedImports, [
    {
      localName: "CustomerMailIcon",
      modulePath: "@customer/icons",
      importMode: "named",
      importedName: "MailIcon",
    },
  ]);
});

test("renderFallbackIconExpression uses profile icon imports even without storybookFirstIconLookup", () => {
  const context = createRenderContext();
  context.profileIconImportsByKey = new Map([
    [
      "search",
      {
        iconKey: "search",
        package: "@customer/icons",
        exportName: "SearchIcon",
        localName: "CustomerSearchIcon",
      },
    ],
  ]);

  const rendered = renderFallbackIconExpression({
    element: makeNode({
      id: "search-icon",
      type: "container",
      name: "Icon",
      semanticName: "Search",
    }),
    parent: rootParent,
    context,
  });

  assert.equal(rendered.includes("<CustomerSearchIcon"), true);
});

test("grid helpers detect matrix, equal-row, css-grid, and edge-case clustering branches", () => {
  const matrixLayout = detectGridLikeContainerLayout(
    makeNode({
      id: "matrix-layout",
      type: "container",
      layoutMode: "NONE",
      children: [
        makeNode({
          id: "m1",
          type: "container",
          x: 0,
          y: 0,
          width: 100,
          height: 50,
        }),
        makeNode({
          id: "m2",
          type: "container",
          x: 120,
          y: 0,
          width: 100,
          height: 50,
        }),
        makeNode({
          id: "m3",
          type: "container",
          x: 0,
          y: 80,
          width: 100,
          height: 50,
        }),
        makeNode({
          id: "m4",
          type: "container",
          x: 120,
          y: 80,
          width: 100,
          height: 50,
        }),
      ],
    }),
  );
  assert.equal(matrixLayout?.mode, "matrix");
  assert.equal(matrixLayout?.columnCount, 2);

  const equalRowLayout = detectGridLikeContainerLayout(
    makeNode({
      id: "equal-row-layout",
      type: "container",
      layoutMode: "NONE",
      children: [
        makeNode({
          id: "e1",
          type: "container",
          x: 0,
          y: 0,
          width: 100,
          height: 40,
        }),
        makeNode({
          id: "e2",
          type: "container",
          x: 120,
          y: 0,
          width: 96,
          height: 40,
        }),
        makeNode({
          id: "e3",
          type: "container",
          x: 240,
          y: 0,
          width: 104,
          height: 40,
        }),
      ],
    }),
  );
  assert.equal(equalRowLayout?.mode, "equal-row");
  assert.equal(equalRowLayout?.columnCount, 3);

  assert.equal(
    detectGridLikeContainerLayout(
      makeNode({
        id: "invalid-grid",
        type: "container",
        layoutMode: "HORIZONTAL",
        children: [
          makeNode({
            id: "only",
            type: "container",
            x: 0,
            y: 0,
            width: 100,
            height: 40,
          }),
        ],
      }),
    ),
    null,
  );

  const cssGridLayout = detectCssGridLayout(
    makeNode({
      id: "css-grid-layout",
      type: "container",
      layoutMode: "NONE",
      children: [
        makeNode({
          id: "header",
          type: "container",
          name: "Panel",
          x: 0,
          y: 0,
          width: 100,
          height: 40,
          cssGridHints: {
            gridArea: "header",
          },
        }),
        makeNode({
          id: "content-left",
          type: "container",
          x: 0,
          y: 60,
          width: 100,
          height: 120,
        }),
        makeNode({
          id: "content-right",
          type: "container",
          x: 120,
          y: 60,
          width: 100,
          height: 120,
        }),
        makeNode({
          id: "footer",
          type: "container",
          x: 120,
          y: 0,
          width: 100,
          height: 40,
        }),
      ],
    }),
  );
  assert.equal(cssGridLayout?.mode, "css-grid");
  assert.equal(cssGridLayout?.columnCount, 2);

  assert.deepEqual(clusterAxisValues({ values: [], tolerance: 18 }), []);
  assert.deepEqual(
    clusterAxisValues({ values: [0, 6, 100, 108], tolerance: 18 }).length,
    2,
  );
  assert.equal(toNearestClusterIndex({ value: 40, clusters: [0] }), 0);
  assert.equal(
    toNearestClusterIndex({ value: 160, clusters: [0, 100, 200] }),
    2,
  );
  assert.deepEqual(toSequentialDeltas([5]), []);
  assert.deepEqual(toSequentialDeltas([5, 15, 30]), [10, 15]);
});
