import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  normalizeComponentName,
  extractBaseComponentName,
  extractVariantFromPath,
  mapFigmaPropsToReact,
  parseCodeConnectMapResponse,
  parseDesignSystemComponentsResponse,
  findDesignSystemMatch,
  findHeuristicMatch,
  fetchCodeConnectMap,
  resolveComponentMappings,
  consolidateComponentSetVariants,
  annotateIrWithMappings,
  mapFigmaComponents,
  scanWorkspaceComponents,
  loadPersistedMappings,
  savePersistedMappings,
  type MappedComponent,
} from "./figma-component-mapper.js";
import type { McpResolverConfig } from "./figma-mcp-resolver.js";
import type { DesignIR, ScreenElementIR } from "../parity/types-ir.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const mcpOk = (result: unknown) => ({ result });

const createConfig = (fetchImpl: typeof fetch): McpResolverConfig => ({
  serverUrl: "https://mcp.figma.com/mcp",
  accessToken: "test-token",
  authMode: "desktop" as const,
  fetchImpl,
  timeoutMs: 5_000,
  maxRetries: 1,
  onLog: () => {},
});

const parseTool = async (req: Request): Promise<string> => {
  const body = (await req.json()) as { params?: { name?: string } };
  return body.params?.name ?? "";
};

const createTempDir = () =>
  mkdtemp(path.join(os.tmpdir(), "workspace-dev-mapper-"));

const makeNode = (
  overrides: Partial<ScreenElementIR> & { id: string; name: string },
): ScreenElementIR => ({
  type: "container",
  nodeType: "FRAME",
  ...overrides,
});

const makeComponentNode = (
  overrides: Partial<ScreenElementIR> & { id: string; name: string },
): ScreenElementIR => ({
  type: "container",
  nodeType: "COMPONENT",
  ...overrides,
});

const makeInstanceNode = (
  overrides: Partial<ScreenElementIR> & { id: string; name: string },
): ScreenElementIR => ({
  type: "container",
  nodeType: "INSTANCE",
  ...overrides,
});

const makeIR = (children: ScreenElementIR[]): DesignIR => ({
  sourceName: "test",
  screens: [
    {
      id: "screen-1",
      name: "Screen",
      layoutMode: "VERTICAL",
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children,
    },
  ],
  tokens: {
    palette: {
      primary: "#000",
      secondary: "#111",
      background: "#fff",
      text: "#000",
      success: "#0f0",
      warning: "#ff0",
      error: "#f00",
      info: "#00f",
      divider: "#ccc",
      action: {
        active: "#000",
        hover: "#111",
        selected: "#222",
        disabled: "#999",
        disabledBackground: "#eee",
        focus: "#333",
      },
    },
    typography: {} as DesignIR["tokens"]["typography"],
    source: {
      palette: { primary: "figma" },
      typography: {},
    },
  },
});

// ---------------------------------------------------------------------------
// normalizeComponentName
// ---------------------------------------------------------------------------

test("normalizeComponentName converts slashes to dashes", () => {
  assert.equal(normalizeComponentName("Button/Primary"), "button-primary");
});

test("normalizeComponentName handles spaces around separators", () => {
  assert.equal(normalizeComponentName("Input / Default"), "input-default");
});

test("normalizeComponentName strips leading underscores and special chars", () => {
  assert.equal(normalizeComponentName("_Card__Elevated"), "card-elevated");
});

test("normalizeComponentName handles backslashes", () => {
  assert.equal(
    normalizeComponentName("Form\\Input\\Large"),
    "form-input-large",
  );
});

test("normalizeComponentName returns empty for empty string", () => {
  assert.equal(normalizeComponentName(""), "");
});

test("normalizeComponentName lowercases output", () => {
  assert.equal(normalizeComponentName("MyButton"), "mybutton");
});

// ---------------------------------------------------------------------------
// extractBaseComponentName
// ---------------------------------------------------------------------------

test("extractBaseComponentName returns parent for variant path", () => {
  assert.equal(extractBaseComponentName("Button/Primary"), "Button");
});

test("extractBaseComponentName returns second-to-last for deep path", () => {
  assert.equal(extractBaseComponentName("Form/Input/Default"), "Input");
});

test("extractBaseComponentName returns name for single segment", () => {
  assert.equal(extractBaseComponentName("Button"), "Button");
});

test("extractBaseComponentName handles empty string", () => {
  assert.equal(extractBaseComponentName(""), "");
});

// ---------------------------------------------------------------------------
// extractVariantFromPath
// ---------------------------------------------------------------------------

test("extractVariantFromPath returns variant for path", () => {
  assert.deepEqual(extractVariantFromPath("Button/Primary"), {
    variant: "Primary",
  });
});

test("extractVariantFromPath returns undefined for single segment", () => {
  assert.equal(extractVariantFromPath("Button"), undefined);
});

test("extractVariantFromPath returns last segment for deep path", () => {
  assert.deepEqual(extractVariantFromPath("Form/Input/Default"), {
    variant: "Default",
  });
});

// ---------------------------------------------------------------------------
// mapFigmaPropsToReact
// ---------------------------------------------------------------------------

test("mapFigmaPropsToReact maps VARIANT properties", () => {
  const result = mapFigmaPropsToReact({
    Size: { type: "VARIANT", defaultValue: "medium" },
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.figmaProp, "Size");
  assert.equal(result[0]?.reactProp, "size");
  assert.equal(result[0]?.transform, "enum");
  assert.equal(result[0]?.defaultValue, "medium");
});

test("mapFigmaPropsToReact maps BOOLEAN properties", () => {
  const result = mapFigmaPropsToReact({
    "Has icon": { type: "BOOLEAN", defaultValue: false },
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.reactProp, "hasIcon");
  assert.equal(result[0]?.transform, "boolean");
  assert.equal(result[0]?.defaultValue, "false");
});

test("mapFigmaPropsToReact maps TEXT label to children", () => {
  const result = mapFigmaPropsToReact({
    label: { type: "TEXT" },
  });
  assert.equal(result[0]?.reactProp, "children");
  assert.equal(result[0]?.transform, "text");
});

test("mapFigmaPropsToReact maps TEXT non-label to camelCase", () => {
  const result = mapFigmaPropsToReact({
    "helper text": { type: "TEXT" },
  });
  assert.equal(result[0]?.reactProp, "helperText");
});

test("mapFigmaPropsToReact maps INSTANCE_SWAP properties", () => {
  const result = mapFigmaPropsToReact({
    Icon: { type: "INSTANCE_SWAP" },
  });
  assert.equal(result[0]?.reactProp, "icon");
  assert.equal(result[0]?.transform, "component");
});

test("mapFigmaPropsToReact returns empty for unknown prop types", () => {
  assert.equal(mapFigmaPropsToReact({ X: { type: "CUSTOM" } }).length, 0);
});

test("mapFigmaPropsToReact handles empty contract", () => {
  assert.equal(mapFigmaPropsToReact({}).length, 0);
});

// ---------------------------------------------------------------------------
// parseCodeConnectMapResponse
// ---------------------------------------------------------------------------

test("parseCodeConnectMapResponse parses flat record", () => {
  const result = parseCodeConnectMapResponse({
    "1:2": {
      codeConnectSrc: "src/components/Button.tsx",
      codeConnectName: "Button",
    },
    "3:4": {
      codeConnectSrc: "src/components/Card.tsx",
      codeConnectName: "Card",
      label: "React",
    },
  });
  assert.equal(result.length, 2);
  assert.equal(result[0]?.componentName, "Button");
  assert.equal(result[1]?.label, "React");
});

test("parseCodeConnectMapResponse handles wrapped result", () => {
  const result = parseCodeConnectMapResponse({
    result: {
      "5:6": {
        codeConnectSrc: "src/Input.tsx",
        codeConnectName: "Input",
      },
    },
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.componentName, "Input");
});

test("parseCodeConnectMapResponse skips entries without src", () => {
  const result = parseCodeConnectMapResponse({
    "1:2": { codeConnectName: "Button" },
    "3:4": {
      codeConnectSrc: "src/Card.tsx",
      codeConnectName: "Card",
    },
  });
  assert.equal(result.length, 1);
});

test("parseCodeConnectMapResponse returns empty for null", () => {
  assert.deepEqual(parseCodeConnectMapResponse(null), []);
});

test("parseCodeConnectMapResponse returns empty for non-object", () => {
  assert.deepEqual(parseCodeConnectMapResponse("string"), []);
});

test("parseCodeConnectMapResponse preserves propContract", () => {
  const result = parseCodeConnectMapResponse({
    "1:2": {
      codeConnectSrc: "src/Button.tsx",
      codeConnectName: "Button",
      propContract: { Size: { type: "VARIANT", defaultValue: "md" } },
    },
  });
  assert.deepEqual(result[0]?.propContract, {
    Size: { type: "VARIANT", defaultValue: "md" },
  });
});

// ---------------------------------------------------------------------------
// parseDesignSystemComponentsResponse
// ---------------------------------------------------------------------------

test("parseDesignSystemComponentsResponse parses components array", () => {
  const result = parseDesignSystemComponentsResponse({
    components: [
      { name: "Button", key: "btn-1", libraryKey: "lib-1" },
      { name: "Card", key: "card-1" },
    ],
  });
  assert.equal(result.length, 2);
  assert.equal(result[0]?.libraryKey, "lib-1");
});

test("parseDesignSystemComponentsResponse returns empty for null", () => {
  assert.deepEqual(parseDesignSystemComponentsResponse(null), []);
});

test("parseDesignSystemComponentsResponse skips nameless entries", () => {
  const result = parseDesignSystemComponentsResponse({
    components: [{ key: "btn-1" }, { name: "Card", key: "card-1" }],
  });
  assert.equal(result.length, 1);
});

// ---------------------------------------------------------------------------
// findDesignSystemMatch
// ---------------------------------------------------------------------------

test("findDesignSystemMatch finds exact normalized match", () => {
  const match = findDesignSystemMatch({
    figmaName: "Button",
    dsComponents: [{ name: "Button", key: "btn-1" }],
  });
  assert.equal(match?.name, "Button");
});

test("findDesignSystemMatch finds base name match for variant path", () => {
  const match = findDesignSystemMatch({
    figmaName: "Button/Primary",
    dsComponents: [{ name: "Button", key: "btn-1" }],
  });
  assert.equal(match?.name, "Button");
});

test("findDesignSystemMatch returns undefined when no match", () => {
  const match = findDesignSystemMatch({
    figmaName: "Dropdown/Menu",
    dsComponents: [{ name: "Card", key: "card-1" }],
  });
  assert.equal(match, undefined);
});

test("findDesignSystemMatch ignores short base names for partial match", () => {
  const match = findDesignSystemMatch({
    figmaName: "AB/Primary",
    dsComponents: [{ name: "Box" }],
  });
  assert.equal(match, undefined);
});

// ---------------------------------------------------------------------------
// findHeuristicMatch
// ---------------------------------------------------------------------------

test("findHeuristicMatch matches by normalized base name", () => {
  const wsComponents = new Map([
    ["button", { name: "Button", filePath: "src/Button.tsx" }],
  ]);
  const match = findHeuristicMatch({
    figmaName: "Button/Primary",
    workspaceComponents: wsComponents,
  });
  assert.equal(match?.name, "Button");
  assert.equal(match?.confidence, "heuristic");
  assert.equal(match?.source, "src/Button.tsx");
});

test("findHeuristicMatch matches by full normalized name", () => {
  const wsComponents = new Map([
    [
      "button-primary",
      { name: "ButtonPrimary", filePath: "src/ButtonPrimary.tsx" },
    ],
  ]);
  const match = findHeuristicMatch({
    figmaName: "Button/Primary",
    workspaceComponents: wsComponents,
  });
  assert.equal(match?.name, "ButtonPrimary");
});

test("findHeuristicMatch returns undefined when no match", () => {
  const wsComponents = new Map([
    ["card", { name: "Card", filePath: "src/Card.tsx" }],
  ]);
  const match = findHeuristicMatch({
    figmaName: "Dropdown",
    workspaceComponents: wsComponents,
  });
  assert.equal(match, undefined);
});

test("findHeuristicMatch substring match requires 4+ chars", () => {
  const wsComponents = new Map([
    ["box", { name: "Box", filePath: "src/Box.tsx" }],
  ]);
  // "box" is only 3 chars, won't trigger substring match
  const match = findHeuristicMatch({
    figmaName: "Box",
    workspaceComponents: wsComponents,
  });
  // Should match via direct match instead
  assert.equal(match?.name, "Box");
});

// ---------------------------------------------------------------------------
// consolidateComponentSetVariants
// ---------------------------------------------------------------------------

test("consolidateComponentSetVariants groups variants under base name", () => {
  const nodes: ScreenElementIR[] = [
    makeNode({
      id: "1:1",
      name: "Button",
      nodeType: "COMPONENT_SET",
      children: [
        makeComponentNode({ id: "1:2", name: "Button/Primary" }),
        makeComponentNode({ id: "1:3", name: "Button/Secondary" }),
      ],
    }),
  ];

  const sets = consolidateComponentSetVariants({ irNodes: nodes });
  assert.equal(sets.size, 1);
  const buttonSet = sets.get("button");
  assert.ok(buttonSet);
  assert.equal(buttonSet.baseName, "Button");
  assert.deepEqual(buttonSet.variants, ["Primary", "Secondary"]);
});

test("consolidateComponentSetVariants handles nested component sets", () => {
  const nodes: ScreenElementIR[] = [
    makeNode({
      id: "0:1",
      name: "Wrapper",
      children: [
        makeNode({
          id: "1:1",
          name: "Input",
          nodeType: "COMPONENT_SET",
          children: [makeComponentNode({ id: "1:2", name: "Input/Default" })],
        }),
      ],
    }),
  ];

  const sets = consolidateComponentSetVariants({ irNodes: nodes });
  assert.equal(sets.size, 1);
  assert.ok(sets.has("input"));
});

// ---------------------------------------------------------------------------
// annotateIrWithMappings — nested instances
// ---------------------------------------------------------------------------

test("annotateIrWithMappings annotates nested instances independently", () => {
  const ir = makeIR([
    makeInstanceNode({
      id: "1:1",
      name: "Card",
      children: [
        makeInstanceNode({ id: "1:2", name: "Button" }),
        makeInstanceNode({ id: "1:3", name: "Icon" }),
      ],
    }),
  ]);

  const { annotated } = annotateIrWithMappings({
    ir,
    codeConnectMappings: [
      {
        nodeId: "1:1",
        componentName: "Card",
        source: "src/Card.tsx",
      },
      {
        nodeId: "1:2",
        componentName: "Button",
        source: "src/Button.tsx",
      },
    ],
    designSystemMappings: [],
    heuristicMappings: new Map(),
    componentSets: new Map(),
  });

  assert.equal(annotated, 2);
  assert.equal(ir.screens[0]?.children[0]?.codeConnect?.componentName, "Card");
  const nested = ir.screens[0]?.children[0]?.children;
  assert.equal(nested?.[0]?.codeConnect?.componentName, "Button");
  // Icon not mapped — should have no codeConnect
  assert.equal(nested?.[1]?.codeConnect, undefined);
});

test("annotateIrWithMappings resolves by name when nodeId not found", () => {
  const ir = makeIR([makeComponentNode({ id: "99:99", name: "Button" })]);

  const { annotated } = annotateIrWithMappings({
    ir,
    codeConnectMappings: [
      {
        nodeId: "1:1",
        componentName: "Button",
        source: "src/Button.tsx",
      },
    ],
    designSystemMappings: [],
    heuristicMappings: new Map(),
    componentSets: new Map(),
  });

  assert.equal(annotated, 1);
  assert.equal(ir.screens[0]?.children[0]?.codeConnect?.origin, "code_connect");
});

test("annotateIrWithMappings uses design system fallback", () => {
  const ir = makeIR([makeInstanceNode({ id: "2:1", name: "Card" })]);

  const { annotated } = annotateIrWithMappings({
    ir,
    codeConnectMappings: [],
    designSystemMappings: [
      {
        nodeId: "0:0",
        componentName: "Card",
        source: "card-key",
      },
    ],
    heuristicMappings: new Map(),
    componentSets: new Map(),
  });

  assert.equal(annotated, 1);
  assert.equal(
    ir.screens[0]?.children[0]?.codeConnect?.origin,
    "design_system",
  );
});

test("annotateIrWithMappings uses heuristic fallback", () => {
  const ir = makeIR([makeComponentNode({ id: "3:1", name: "Slider" })]);

  const heuristicMappings = new Map([
    [
      "slider",
      {
        name: "Slider",
        source: "src/Slider.tsx",
        confidence: "heuristic" as const,
      },
    ],
  ]);

  const { annotated } = annotateIrWithMappings({
    ir,
    codeConnectMappings: [],
    designSystemMappings: [],
    heuristicMappings,
    componentSets: new Map(),
  });

  assert.equal(annotated, 1);
  assert.equal(
    ir.screens[0]?.children[0]?.codeConnect?.componentName,
    "Slider",
  );
});

test("annotateIrWithMappings skips non-component nodes", () => {
  const ir = makeIR([
    makeNode({ id: "1:1", name: "Container", nodeType: "FRAME" }),
  ]);

  const { annotated } = annotateIrWithMappings({
    ir,
    codeConnectMappings: [
      { nodeId: "1:1", componentName: "Container", source: "src/C.tsx" },
    ],
    designSystemMappings: [],
    heuristicMappings: new Map(),
    componentSets: new Map(),
  });

  assert.equal(annotated, 0);
});

test("annotateIrWithMappings does not overwrite existing codeConnect", () => {
  const existingMapping = {
    origin: "code_connect" as const,
    componentName: "ExistingButton",
    source: "existing.tsx",
  };
  const ir = makeIR([
    makeComponentNode({
      id: "1:1",
      name: "Button",
      codeConnect: existingMapping,
    }),
  ]);

  annotateIrWithMappings({
    ir,
    codeConnectMappings: [
      { nodeId: "1:1", componentName: "NewButton", source: "new.tsx" },
    ],
    designSystemMappings: [],
    heuristicMappings: new Map(),
    componentSets: new Map(),
  });

  // Should preserve existing
  assert.equal(
    ir.screens[0]?.children[0]?.codeConnect?.componentName,
    "ExistingButton",
  );
});

// ---------------------------------------------------------------------------
// Persistence: load / save / stale validation
// ---------------------------------------------------------------------------

test("loadPersistedMappings returns empty map when file does not exist", async () => {
  const dir = await createTempDir();
  const result = await loadPersistedMappings({ workspaceRoot: dir });
  assert.equal(result.size, 0);
});

test("savePersistedMappings creates file and loadPersistedMappings reads it back", async () => {
  const dir = await createTempDir();

  // Create a fake source file so stale check passes
  const srcDir = path.join(dir, "src");
  await mkdir(srcDir, { recursive: true });
  await writeFile(
    path.join(srcDir, "Button.tsx"),
    "export const Button = () => null;",
    "utf8",
  );

  const mappings = new Map([
    [
      "btn-key",
      {
        name: "Button",
        source: "src/Button.tsx",
        confidence: "exact" as const,
      },
    ],
  ]);

  await savePersistedMappings({ workspaceRoot: dir, mappings });

  const loaded = await loadPersistedMappings({ workspaceRoot: dir });
  assert.equal(loaded.size, 1);
  assert.equal(loaded.get("btn-key")?.name, "Button");
  assert.equal(loaded.get("btn-key")?.confidence, "exact");
});

test("loadPersistedMappings filters out stale mappings (deleted source file)", async () => {
  const dir = await createTempDir();
  const wdDir = path.join(dir, ".workspace-dev");
  await mkdir(wdDir, { recursive: true });

  // Write a mapping pointing to a file that doesn't exist
  const persisted = {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: {
      "stale-key": {
        name: "Deleted",
        source: "src/Deleted.tsx",
        confidence: "exact",
        approvedAt: new Date().toISOString(),
      },
    },
  };
  await writeFile(
    path.join(wdDir, "figma-component-map.json"),
    JSON.stringify(persisted),
    "utf8",
  );

  const loaded = await loadPersistedMappings({ workspaceRoot: dir });
  // Stale mapping should be filtered out
  assert.equal(loaded.size, 0);
});

test("loadPersistedMappings handles invalid JSON gracefully", async () => {
  const dir = await createTempDir();
  const wdDir = path.join(dir, ".workspace-dev");
  await mkdir(wdDir, { recursive: true });
  await writeFile(
    path.join(wdDir, "figma-component-map.json"),
    "not-json",
    "utf8",
  );

  const loaded = await loadPersistedMappings({ workspaceRoot: dir });
  assert.equal(loaded.size, 0);
});

// ---------------------------------------------------------------------------
// scanWorkspaceComponents
// ---------------------------------------------------------------------------

test("scanWorkspaceComponents finds component declarations in tsx files", async () => {
  const dir = await createTempDir();
  const srcDir = path.join(dir, "src");
  await mkdir(srcDir, { recursive: true });
  await writeFile(
    path.join(srcDir, "Button.tsx"),
    "export const Button = () => <button />;\nexport function Card() { return null; }",
    "utf8",
  );

  const result = await scanWorkspaceComponents({ workspaceRoot: dir });
  assert.ok(result.has("button"));
  assert.ok(result.has("card"));
  assert.equal(result.get("button")?.name, "Button");
});

test("scanWorkspaceComponents skips lowercase exports (not components)", async () => {
  const dir = await createTempDir();
  const srcDir = path.join(dir, "src");
  await mkdir(srcDir, { recursive: true });
  await writeFile(
    path.join(srcDir, "utils.tsx"),
    "export const helper = () => null;",
    "utf8",
  );

  const result = await scanWorkspaceComponents({ workspaceRoot: dir });
  assert.equal(result.has("helper"), false);
});

test("scanWorkspaceComponents skips node_modules", async () => {
  const dir = await createTempDir();
  const srcDir = path.join(dir, "src", "node_modules", "pkg");
  await mkdir(srcDir, { recursive: true });
  await writeFile(
    path.join(srcDir, "Widget.tsx"),
    "export const Widget = () => null;",
    "utf8",
  );

  const result = await scanWorkspaceComponents({ workspaceRoot: dir });
  assert.equal(result.has("widget"), false);
});

// ---------------------------------------------------------------------------
// fetchCodeConnectMap (integration with mock fetch)
// ---------------------------------------------------------------------------

test("fetchCodeConnectMap calls get_code_connect_map and parses result", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push(await parseTool(new Request(input, init)));
    return jsonResponse(
      mcpOk({
        "1:2": {
          codeConnectSrc: "src/Button.tsx",
          codeConnectName: "Button",
        },
      }),
    );
  };

  const result = await fetchCodeConnectMap({
    fileKey: "abc123",
    nodeId: "1:2",
    config: createConfig(fetchImpl),
  });

  assert.deepEqual(calls, ["get_code_connect_map"]);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.componentName, "Button");
});

// ---------------------------------------------------------------------------
// resolveComponentMappings (full orchestration)
// ---------------------------------------------------------------------------

test("resolveComponentMappings orchestrates all MCP calls", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const tool = await parseTool(new Request(input, init));
    calls.push(tool);

    if (tool === "get_code_connect_map") {
      return jsonResponse(
        mcpOk({
          "1:2": {
            codeConnectSrc: "src/components/Button.tsx",
            codeConnectName: "Button",
            propContract: { Size: { type: "VARIANT", defaultValue: "md" } },
          },
        }),
      );
    }
    if (tool === "search_design_system") {
      return jsonResponse(
        mcpOk({
          components: [{ name: "Card", key: "card-1", libraryKey: "lib-1" }],
        }),
      );
    }
    if (tool === "get_code_connect_suggestions") {
      return jsonResponse(
        mcpOk({
          "7:8": {
            codeConnectSrc: "src/components/Tooltip.tsx",
            codeConnectName: "Tooltip",
          },
        }),
      );
    }
    return jsonResponse(mcpOk({}));
  };

  const result = await resolveComponentMappings({
    fileKey: "abc123",
    nodeId: "1:2",
    mcpConfig: createConfig(fetchImpl),
  });

  assert.deepEqual(calls, [
    "get_code_connect_map",
    "search_design_system",
    "get_code_connect_suggestions",
  ]);
  assert.equal(result.stats.exact, 1);
  assert.equal(result.stats.designSystem, 1);
  assert.equal(result.stats.suggested, 1);
  assert.equal(result.mappings.get("button")?.confidence, "exact");
});

test("resolveComponentMappings handles all MCP failures gracefully", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("Service Unavailable", { status: 503 });

  const result = await resolveComponentMappings({
    fileKey: "abc123",
    nodeId: "1:2",
    mcpConfig: createConfig(fetchImpl),
  });

  assert.equal(result.codeConnectMappings.length, 0);
  assert.ok(result.diagnostics.length > 0);
});

test("resolveComponentMappings deduplicates Code Connect and design system", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    const tool = await parseTool(new Request(input, init));
    if (tool === "get_code_connect_map") {
      return jsonResponse(
        mcpOk({
          "1:2": {
            codeConnectSrc: "src/Button.tsx",
            codeConnectName: "Button",
          },
        }),
      );
    }
    if (tool === "search_design_system") {
      return jsonResponse(
        mcpOk({ components: [{ name: "Button", key: "btn-1" }] }),
      );
    }
    return jsonResponse(mcpOk({}));
  };

  const result = await resolveComponentMappings({
    fileKey: "abc123",
    nodeId: "1:2",
    mcpConfig: createConfig(fetchImpl),
  });

  assert.equal(result.codeConnectMappings.length, 1);
  assert.equal(result.designSystemMappings.length, 0);
});

test("resolveComponentMappings performs heuristic matching when workspaceRoot provided", async () => {
  const dir = await createTempDir();
  const srcDir = path.join(dir, "src");
  await mkdir(srcDir, { recursive: true });
  await writeFile(
    path.join(srcDir, "Tooltip.tsx"),
    "export const Tooltip = () => null;",
    "utf8",
  );

  const fetchImpl: typeof fetch = async (input, init) => {
    const tool = await parseTool(new Request(input, init));
    if (tool === "get_code_connect_map") return jsonResponse(mcpOk({}));
    if (tool === "search_design_system")
      return jsonResponse(mcpOk({ components: [] }));
    if (tool === "get_code_connect_suggestions") {
      return jsonResponse(
        mcpOk({
          "7:8": {
            codeConnectSrc: "suggested/Tooltip.tsx",
            codeConnectName: "Tooltip",
          },
        }),
      );
    }
    return jsonResponse(mcpOk({}));
  };

  const result = await resolveComponentMappings({
    fileKey: "abc123",
    nodeId: "1:2",
    mcpConfig: createConfig(fetchImpl),
    workspaceRoot: dir,
  });

  // The unmapped "Tooltip" suggestion should be resolved via heuristic matching
  assert.equal(result.stats.heuristic, 1);
});

// ---------------------------------------------------------------------------
// mapFigmaComponents — full integration
// ---------------------------------------------------------------------------

test("mapFigmaComponents enriches IR nodes and returns stats", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    const tool = await parseTool(new Request(input, init));
    if (tool === "get_code_connect_map") {
      return jsonResponse(
        mcpOk({
          "1:1": {
            codeConnectSrc: "src/Button.tsx",
            codeConnectName: "Button",
          },
        }),
      );
    }
    if (tool === "search_design_system") {
      return jsonResponse(mcpOk({ components: [] }));
    }
    return jsonResponse(mcpOk({}));
  };

  const ir = makeIR([
    makeInstanceNode({ id: "1:1", name: "Button" }),
    makeInstanceNode({ id: "2:2", name: "Unknown" }),
  ]);

  const result = await mapFigmaComponents("abc123", "0:1", ir, {
    mcpConfig: createConfig(fetchImpl),
  });

  assert.equal(result.stats.exact, 1);
  // Button node should be annotated
  assert.equal(
    ir.screens[0]?.children[0]?.codeConnect?.componentName,
    "Button",
  );
  // Unknown node should not be annotated
  assert.equal(ir.screens[0]?.children[1]?.codeConnect, undefined);
});

// ---------------------------------------------------------------------------
// ir-derive integration simulation: enrichment → heuristic → annotate
// ---------------------------------------------------------------------------

test("ir-derive flow: enrichment heuristic mappings are used for annotation", () => {
  // Simulates what ir-derive-service does: take enrichment heuristic entries,
  // build heuristicMappings map, and pass to annotateIrWithMappings
  const ir = makeIR([
    makeInstanceNode({ id: "5:1", name: "Tooltip" }),
    makeInstanceNode({ id: "5:2", name: "Badge" }),
  ]);

  // Simulate enrichment.heuristicComponentMappings
  const enrichmentHeuristics = [
    { nodeId: "", componentName: "Tooltip", source: "src/Tooltip.tsx" },
  ];

  const heuristicMappings = new Map<string, MappedComponent>();
  for (const entry of enrichmentHeuristics) {
    heuristicMappings.set(normalizeComponentName(entry.componentName), {
      name: entry.componentName,
      source: entry.source,
      confidence: "heuristic",
    });
  }

  const allNodes: (typeof ir.screens)[0]["children"] = [];
  for (const screen of ir.screens) {
    allNodes.push(...screen.children);
  }
  const componentSets = consolidateComponentSetVariants({ irNodes: allNodes });

  const { annotated } = annotateIrWithMappings({
    ir,
    codeConnectMappings: [],
    designSystemMappings: [],
    heuristicMappings,
    componentSets,
  });

  assert.equal(annotated, 1);
  assert.equal(
    ir.screens[0]?.children[0]?.codeConnect?.componentName,
    "Tooltip",
  );
  assert.equal(
    ir.screens[0]?.children[0]?.codeConnect?.source,
    "src/Tooltip.tsx",
  );
  // Badge not in heuristic mappings — should remain unannotated
  assert.equal(ir.screens[0]?.children[1]?.codeConnect, undefined);
});

test("ir-derive flow: persisted mappings are loaded and used for annotation", async () => {
  const dir = await createTempDir();
  const srcDir = path.join(dir, "src");
  await mkdir(srcDir, { recursive: true });
  await writeFile(
    path.join(srcDir, "Alert.tsx"),
    "export const Alert = () => null;",
    "utf8",
  );

  // Persist a mapping
  await savePersistedMappings({
    workspaceRoot: dir,
    mappings: new Map([
      [
        "alert",
        {
          name: "Alert",
          source: "src/Alert.tsx",
          confidence: "exact" as const,
        },
      ],
    ]),
  });

  // Load and verify
  const persisted = await loadPersistedMappings({ workspaceRoot: dir });
  assert.equal(persisted.size, 1);
  assert.equal(persisted.get("alert")?.name, "Alert");

  // Use in annotation (simulating ir-derive path)
  const ir = makeIR([makeInstanceNode({ id: "8:1", name: "Alert" })]);

  const { annotated } = annotateIrWithMappings({
    ir,
    codeConnectMappings: [],
    designSystemMappings: [],
    heuristicMappings: persisted,
    componentSets: new Map(),
  });

  assert.equal(annotated, 1);
  assert.equal(ir.screens[0]?.children[0]?.codeConnect?.componentName, "Alert");
});

test("ir-derive flow: heuristic enrichment results flow through resolveComponentMappings", async () => {
  const dir = await createTempDir();
  const srcDir = path.join(dir, "src");
  await mkdir(srcDir, { recursive: true });
  await writeFile(
    path.join(srcDir, "Tooltip.tsx"),
    "export const Tooltip = () => null;",
    "utf8",
  );

  const fetchImpl: typeof fetch = async (input, init) => {
    const tool = await parseTool(new Request(input, init));
    if (tool === "get_code_connect_map") return jsonResponse(mcpOk({}));
    if (tool === "search_design_system")
      return jsonResponse(mcpOk({ components: [] }));
    if (tool === "get_code_connect_suggestions") {
      return jsonResponse(
        mcpOk({
          "9:1": {
            codeConnectSrc: "suggested/Tooltip.tsx",
            codeConnectName: "Tooltip",
          },
        }),
      );
    }
    return jsonResponse(mcpOk({}));
  };

  const result = await resolveComponentMappings({
    fileKey: "abc123",
    nodeId: "1:2",
    mcpConfig: createConfig(fetchImpl),
    workspaceRoot: dir,
  });

  // Heuristic match should be in mappings with normalized key
  assert.equal(result.stats.heuristic, 1);
  const tooltipMapping = result.mappings.get("tooltip");
  assert.ok(tooltipMapping);
  assert.equal(tooltipMapping.confidence, "heuristic");
  assert.equal(tooltipMapping.source, "src/Tooltip.tsx");
});
