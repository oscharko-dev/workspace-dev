import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeComponentName,
  extractBaseComponentName,
  extractVariantFromPath,
  mapFigmaPropsToReact,
  parseCodeConnectMapResponse,
  parseDesignSystemComponentsResponse,
  findDesignSystemMatch,
  fetchCodeConnectMap,
  resolveComponentMappings,
} from "./figma-component-mapper.js";
import type { McpResolverConfig } from "./figma-mcp-resolver.js";

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
  assert.equal(result[0]?.figmaProp, "Has icon");
  assert.equal(result[0]?.reactProp, "hasIcon");
  assert.equal(result[0]?.transform, "boolean");
  assert.equal(result[0]?.defaultValue, "false");
});

test("mapFigmaPropsToReact maps TEXT label to children", () => {
  const result = mapFigmaPropsToReact({
    label: { type: "TEXT" },
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.reactProp, "children");
  assert.equal(result[0]?.transform, "text");
});

test("mapFigmaPropsToReact maps TEXT non-label to camelCase", () => {
  const result = mapFigmaPropsToReact({
    "helper text": { type: "TEXT" },
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.reactProp, "helperText");
  assert.equal(result[0]?.transform, "text");
});

test("mapFigmaPropsToReact maps INSTANCE_SWAP properties", () => {
  const result = mapFigmaPropsToReact({
    Icon: { type: "INSTANCE_SWAP" },
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.reactProp, "icon");
  assert.equal(result[0]?.transform, "component");
});

test("mapFigmaPropsToReact returns empty array for unknown prop types", () => {
  const result = mapFigmaPropsToReact({
    Unknown: { type: "CUSTOM_THING" },
  });
  assert.equal(result.length, 0);
});

test("mapFigmaPropsToReact handles empty contract", () => {
  const result = mapFigmaPropsToReact({});
  assert.equal(result.length, 0);
});

// ---------------------------------------------------------------------------
// parseCodeConnectMapResponse
// ---------------------------------------------------------------------------

test("parseCodeConnectMapResponse parses flat record", () => {
  const raw = {
    "1:2": {
      codeConnectSrc: "src/components/Button.tsx",
      codeConnectName: "Button",
    },
    "3:4": {
      codeConnectSrc: "src/components/Card.tsx",
      codeConnectName: "Card",
      label: "React",
    },
  };
  const result = parseCodeConnectMapResponse(raw);
  assert.equal(result.length, 2);
  assert.equal(result[0]?.nodeId, "1:2");
  assert.equal(result[0]?.componentName, "Button");
  assert.equal(result[0]?.source, "src/components/Button.tsx");
  assert.equal(result[1]?.label, "React");
});

test("parseCodeConnectMapResponse handles wrapped result", () => {
  const raw = {
    result: {
      "5:6": {
        codeConnectSrc: "src/Input.tsx",
        codeConnectName: "Input",
      },
    },
  };
  const result = parseCodeConnectMapResponse(raw);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.componentName, "Input");
});

test("parseCodeConnectMapResponse skips entries without src", () => {
  const raw = {
    "1:2": { codeConnectName: "Button" },
    "3:4": {
      codeConnectSrc: "src/Card.tsx",
      codeConnectName: "Card",
    },
  };
  const result = parseCodeConnectMapResponse(raw);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.componentName, "Card");
});

test("parseCodeConnectMapResponse returns empty for null input", () => {
  assert.deepEqual(parseCodeConnectMapResponse(null), []);
});

test("parseCodeConnectMapResponse returns empty for non-object", () => {
  assert.deepEqual(parseCodeConnectMapResponse("string"), []);
});

test("parseCodeConnectMapResponse preserves propContract", () => {
  const raw = {
    "1:2": {
      codeConnectSrc: "src/Button.tsx",
      codeConnectName: "Button",
      propContract: {
        Size: { type: "VARIANT", defaultValue: "md" },
      },
    },
  };
  const result = parseCodeConnectMapResponse(raw);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0]?.propContract, {
    Size: { type: "VARIANT", defaultValue: "md" },
  });
});

// ---------------------------------------------------------------------------
// parseDesignSystemComponentsResponse
// ---------------------------------------------------------------------------

test("parseDesignSystemComponentsResponse parses components array", () => {
  const raw = {
    components: [
      { name: "Button", key: "btn-1", libraryKey: "lib-1" },
      { name: "Card", key: "card-1" },
    ],
  };
  const result = parseDesignSystemComponentsResponse(raw);
  assert.equal(result.length, 2);
  assert.equal(result[0]?.name, "Button");
  assert.equal(result[0]?.libraryKey, "lib-1");
  assert.equal(result[1]?.name, "Card");
  assert.equal(result[1]?.libraryKey, undefined);
});

test("parseDesignSystemComponentsResponse returns empty for null", () => {
  assert.deepEqual(parseDesignSystemComponentsResponse(null), []);
});

test("parseDesignSystemComponentsResponse skips nameless entries", () => {
  const raw = {
    components: [{ key: "btn-1" }, { name: "Card", key: "card-1" }],
  };
  const result = parseDesignSystemComponentsResponse(raw);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.name, "Card");
});

// ---------------------------------------------------------------------------
// findDesignSystemMatch
// ---------------------------------------------------------------------------

test("findDesignSystemMatch finds exact normalized match", () => {
  const dsComponents = [
    { name: "Button", key: "btn-1" },
    { name: "Card", key: "card-1" },
  ];
  const match = findDesignSystemMatch({
    figmaName: "Button",
    dsComponents,
  });
  assert.equal(match?.name, "Button");
});

test("findDesignSystemMatch finds base name match for variant path", () => {
  const dsComponents = [
    { name: "Button", key: "btn-1" },
    { name: "Input", key: "input-1" },
  ];
  const match = findDesignSystemMatch({
    figmaName: "Button/Primary",
    dsComponents,
  });
  assert.equal(match?.name, "Button");
});

test("findDesignSystemMatch finds partial match", () => {
  const dsComponents = [{ name: "PrimaryButton", key: "btn-1" }];
  const match = findDesignSystemMatch({
    figmaName: "Button/Primary",
    dsComponents,
  });
  // "button" (base) is contained in "primarybutton" (normalized ds)
  assert.equal(match?.name, "PrimaryButton");
});

test("findDesignSystemMatch returns undefined when no match", () => {
  const dsComponents = [{ name: "Card", key: "card-1" }];
  const match = findDesignSystemMatch({
    figmaName: "Dropdown/Menu",
    dsComponents,
  });
  assert.equal(match, undefined);
});

test("findDesignSystemMatch ignores very short base names for partial match", () => {
  const dsComponents = [{ name: "Box", key: "box-1" }];
  // Base name "AB" is < 3 chars, so partial match is skipped
  const match = findDesignSystemMatch({
    figmaName: "AB/Primary",
    dsComponents,
  });
  assert.equal(match, undefined);
});

// ---------------------------------------------------------------------------
// fetchCodeConnectMap (integration with mock fetch)
// ---------------------------------------------------------------------------

test("fetchCodeConnectMap calls get_code_connect_map and parses result", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const tool = await parseTool(new Request(input, init));
    calls.push(tool);
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
// resolveComponentMappings (full integration)
// ---------------------------------------------------------------------------

test("resolveComponentMappings orchestrates all three MCP calls", async () => {
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
            propContract: {
              Size: { type: "VARIANT", defaultValue: "md" },
            },
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

  // Exact mapping from Code Connect
  assert.equal(result.codeConnectMappings.length, 1);
  assert.equal(result.codeConnectMappings[0]?.componentName, "Button");

  // Design system mapping
  assert.equal(result.designSystemMappings.length, 1);
  assert.equal(result.designSystemMappings[0]?.componentName, "Card");

  // AI suggestion stored as unmapped
  assert.equal(result.unmapped.length, 1);
  assert.equal(result.unmapped[0]?.figmaName, "Tooltip");
  assert.equal(result.unmapped[0]?.suggestions?.[0]?.confidence, "suggested");

  // Stats
  assert.equal(result.stats.exact, 1);
  assert.equal(result.stats.designSystem, 1);
  assert.equal(result.stats.suggested, 1);
});

test("resolveComponentMappings handles Code Connect failure gracefully", async () => {
  let callCount = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const tool = await parseTool(new Request(input, init));
    callCount++;

    if (tool === "get_code_connect_map") {
      return new Response("Internal Server Error", { status: 500 });
    }
    if (tool === "search_design_system") {
      return jsonResponse(mcpOk({ components: [] }));
    }
    if (tool === "get_code_connect_suggestions") {
      return jsonResponse(mcpOk({}));
    }
    return jsonResponse(mcpOk({}));
  };

  const result = await resolveComponentMappings({
    fileKey: "abc123",
    nodeId: "1:2",
    mcpConfig: createConfig(fetchImpl),
  });

  // Should still proceed with remaining strategies
  assert.equal(result.codeConnectMappings.length, 0);
  assert.ok(
    result.diagnostics.some(
      (d) => d.code === "W_COMPONENT_MAPPER_CODE_CONNECT_SKIPPED",
    ),
  );
  assert.ok(callCount >= 2, "Should attempt remaining MCP calls");
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
  assert.equal(result.designSystemMappings.length, 0);
  assert.ok(result.diagnostics.length > 0);
});

test("resolveComponentMappings passes libraryKeys to design system search", async () => {
  let capturedArgs: Record<string, unknown> = {};
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = (await new Request(input, init).json()) as {
      params?: { name?: string; arguments?: Record<string, unknown> };
    };
    const tool = body.params?.name ?? "";

    if (tool === "search_design_system") {
      capturedArgs = body.params?.arguments ?? {};
    }
    return jsonResponse(mcpOk({}));
  };

  await resolveComponentMappings({
    fileKey: "abc123",
    nodeId: "1:2",
    mcpConfig: createConfig(fetchImpl),
    libraryKeys: ["lib-1", "lib-2"],
  });

  assert.deepEqual(capturedArgs["includeLibraryKeys"], ["lib-1", "lib-2"]);
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
      // Design system also returns "Button" — should be deduped
      return jsonResponse(
        mcpOk({
          components: [{ name: "Button", key: "btn-1", libraryKey: "lib-1" }],
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

  assert.equal(result.codeConnectMappings.length, 1);
  // Button already in Code Connect, so it should NOT appear in designSystemMappings
  assert.equal(result.designSystemMappings.length, 0);
});
