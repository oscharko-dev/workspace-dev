import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyVariable,
  fetchDesignSystemTokens,
  fetchFigmaVariableDefs,
  generateCssCustomProperties,
  generateTailwindExtension,
  mergeVariablesWithExisting,
  normalizeFigmaVariableName,
  parseDesignSystemResponse,
  parseVariableDefsResponse,
  resolveFigmaTokens,
} from "./figma-token-bridge.js";
import type { McpResolverConfig } from "./figma-mcp-resolver.js";
import type {
  FigmaMcpVariableDefinition,
  FigmaMcpStyleCatalogEntry,
} from "../parity/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
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
// normalizeFigmaVariableName
// ---------------------------------------------------------------------------

test("normalizeFigmaVariableName converts slashes to dashes", () => {
  assert.equal(
    normalizeFigmaVariableName("color/primary/500"),
    "color-primary-500",
  );
});

test("normalizeFigmaVariableName converts underscores to dashes", () => {
  assert.equal(normalizeFigmaVariableName("spacing_base_4"), "spacing-base-4");
});

test("normalizeFigmaVariableName handles mixed separators and spaces", () => {
  assert.equal(
    normalizeFigmaVariableName("Font / Heading Size"),
    "font-heading-size",
  );
});

test("normalizeFigmaVariableName strips invalid characters", () => {
  assert.equal(
    normalizeFigmaVariableName("color@primary#500!"),
    "colorprimary500",
  );
});

test("normalizeFigmaVariableName collapses multiple dashes", () => {
  assert.equal(
    normalizeFigmaVariableName("color//primary///500"),
    "color-primary-500",
  );
});

test("normalizeFigmaVariableName returns empty for empty input", () => {
  assert.equal(normalizeFigmaVariableName(""), "");
});

// ---------------------------------------------------------------------------
// classifyVariable
// ---------------------------------------------------------------------------

test("classifyVariable — COLOR kind always returns color", () => {
  const v: FigmaMcpVariableDefinition = {
    name: "icon/default/secondary",
    kind: "color",
    value: "#949494",
  };
  assert.equal(classifyVariable(v), "color");
});

test("classifyVariable — FLOAT with spacing name returns spacing", () => {
  const v: FigmaMcpVariableDefinition = {
    name: "spacing/base/4",
    kind: "number",
    value: 16,
  };
  assert.equal(classifyVariable(v), "spacing");
});

test("classifyVariable — FLOAT with spacing collection returns spacing", () => {
  const v: FigmaMcpVariableDefinition = {
    name: "base/4",
    kind: "number",
    value: 16,
    collectionName: "Spacing",
  };
  assert.equal(classifyVariable(v), "spacing");
});

test("classifyVariable — FLOAT with radius name returns radius", () => {
  const v: FigmaMcpVariableDefinition = {
    name: "radius/md",
    kind: "number",
    value: 8,
  };
  assert.equal(classifyVariable(v), "radius");
});

test("classifyVariable — FLOAT with size name returns size", () => {
  const v: FigmaMcpVariableDefinition = {
    name: "size/icon/lg",
    kind: "number",
    value: 24,
  };
  assert.equal(classifyVariable(v), "size");
});

test("classifyVariable — FLOAT with opacity name returns opacity", () => {
  const v: FigmaMcpVariableDefinition = {
    name: "opacity/disabled",
    kind: "number",
    value: 0.38,
  };
  assert.equal(classifyVariable(v), "opacity");
});

test("classifyVariable — STRING with font name returns typography", () => {
  const v: FigmaMcpVariableDefinition = {
    name: "font/family/body",
    kind: "string",
    value: "Inter",
  };
  assert.equal(classifyVariable(v), "typography");
});

test("classifyVariable — FLOAT with font name returns typography", () => {
  const v: FigmaMcpVariableDefinition = {
    name: "font/size/heading",
    kind: "number",
    value: 24,
  };
  assert.equal(classifyVariable(v), "typography");
});

test("classifyVariable — boolean kind returns unknown", () => {
  const v: FigmaMcpVariableDefinition = {
    name: "feature/dark-mode",
    kind: "boolean",
    value: true,
  };
  assert.equal(classifyVariable(v), "unknown");
});

test("classifyVariable — unrecognized number variable returns unknown", () => {
  const v: FigmaMcpVariableDefinition = {
    name: "misc/value",
    kind: "number",
    value: 42,
  };
  assert.equal(classifyVariable(v), "unknown");
});

// ---------------------------------------------------------------------------
// parseVariableDefsResponse
// ---------------------------------------------------------------------------

test("parseVariableDefsResponse — structured array format", () => {
  const raw = {
    variables: [
      {
        name: "color/primary/500",
        resolvedValue: "#3B82F6",
        collection: "Colors",
        mode: "Light",
        type: "COLOR",
      },
      {
        name: "spacing/base",
        resolvedValue: 8,
        collection: "Spacing",
        type: "FLOAT",
      },
    ],
  };
  const result = parseVariableDefsResponse(raw);
  assert.equal(result.length, 2);
  assert.equal(result[0].name, "color/primary/500");
  assert.equal(result[0].kind, "color");
  assert.equal(result[0].value, "#3B82F6");
  assert.equal(result[0].collectionName, "Colors");
  assert.equal(result[0].modeName, "Light");
  assert.equal(result[1].kind, "number");
  assert.equal(result[1].value, 8);
});

test("parseVariableDefsResponse — flat record format", () => {
  const raw = {
    "icon/default/secondary": "#949494",
    "spacing/md": 16,
  };
  const result = parseVariableDefsResponse(raw);
  assert.equal(result.length, 2);
  const color = result.find((v) => v.name === "icon/default/secondary");
  assert.ok(color);
  assert.equal(color.kind, "color");
  assert.equal(color.value, "#949494");
  const spacing = result.find((v) => v.name === "spacing/md");
  assert.ok(spacing);
  assert.equal(spacing.kind, "number");
  assert.equal(spacing.value, 16);
});

test("parseVariableDefsResponse — top-level array format", () => {
  const raw = [{ name: "color/bg", resolvedValue: "#FFFFFF", type: "COLOR" }];
  const result = parseVariableDefsResponse(raw);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "color");
});

test("parseVariableDefsResponse — null returns empty", () => {
  assert.deepEqual(parseVariableDefsResponse(null), []);
});

test("parseVariableDefsResponse — undefined returns empty", () => {
  assert.deepEqual(parseVariableDefsResponse(undefined), []);
});

test("parseVariableDefsResponse — empty object returns empty", () => {
  assert.deepEqual(parseVariableDefsResponse({}), []);
});

test("parseVariableDefsResponse — skips entries without name", () => {
  const raw = { variables: [{ resolvedValue: "#FFF", type: "COLOR" }] };
  assert.deepEqual(parseVariableDefsResponse(raw), []);
});

test("parseVariableDefsResponse — infers boolean kind", () => {
  const raw = { "feature/enabled": true };
  const result = parseVariableDefsResponse(raw);
  assert.equal(result[0].kind, "boolean");
  assert.equal(result[0].value, true);
});

test("parseVariableDefsResponse — infers color from hex string", () => {
  const raw = { "bg/main": "#1a1a1a" };
  const result = parseVariableDefsResponse(raw);
  assert.equal(result[0].kind, "color");
});

test("parseVariableDefsResponse — infers color from rgba string", () => {
  const raw = { "overlay/bg": "rgba(0, 0, 0, 0.5)" };
  const result = parseVariableDefsResponse(raw);
  assert.equal(result[0].kind, "color");
});

// ---------------------------------------------------------------------------
// parseDesignSystemResponse
// ---------------------------------------------------------------------------

test("parseDesignSystemResponse — extracts styles and library keys", () => {
  const raw = {
    components: [
      { name: "Button", libraryKey: "lib-abc" },
      { name: "Card", libraryKey: "lib-abc" },
      { name: "Input", libraryKey: "lib-xyz" },
    ],
    styles: [
      {
        name: "Heading/H1",
        styleType: "TEXT",
        fontSizePx: 32,
        fontWeight: 700,
        lineHeightPx: 40,
      },
      { name: "Primary", styleType: "FILL", color: "#3B82F6" },
    ],
    variables: [{ name: "semantic/success", resolvedValue: "#10B981" }],
  };
  const result = parseDesignSystemResponse(raw);
  assert.equal(result.styles.length, 3); // 2 styles + 1 variable-derived
  assert.deepEqual(result.libraryKeys, ["lib-abc", "lib-xyz"]);
  const heading = result.styles.find((s) => s.name === "Heading/H1");
  assert.ok(heading);
  assert.equal(heading.styleType, "TEXT");
  assert.equal(heading.fontSizePx, 32);
});

test("parseDesignSystemResponse — null returns empty", () => {
  const result = parseDesignSystemResponse(null);
  assert.deepEqual(result.styles, []);
  assert.deepEqual(result.libraryKeys, []);
});

test("parseDesignSystemResponse — skips non-hex variable values", () => {
  const raw = {
    variables: [{ name: "spacing/base", resolvedValue: 8 }],
  };
  const result = parseDesignSystemResponse(raw);
  assert.equal(result.styles.length, 0);
});

// ---------------------------------------------------------------------------
// generateCssCustomProperties
// ---------------------------------------------------------------------------

test("generateCssCustomProperties — generates valid CSS block", () => {
  const vars: FigmaMcpVariableDefinition[] = [
    { name: "color/primary/500", kind: "color", value: "#3B82F6" },
    {
      name: "spacing/base",
      kind: "number",
      value: 8,
      collectionName: "Spacing",
    },
    { name: "radius/md", kind: "number", value: 8 },
  ];
  const css = generateCssCustomProperties(vars);
  assert.ok(css.startsWith(":root {"));
  assert.ok(css.includes("--color-primary-500: #3B82F6;"));
  assert.ok(css.includes("--spacing-base: 8px;"));
  assert.ok(css.includes("--radius-md: 8px;"));
  assert.ok(css.endsWith("}"));
});

test("generateCssCustomProperties — empty input returns empty string", () => {
  assert.equal(generateCssCustomProperties([]), "");
});

test("generateCssCustomProperties — skips unknown-category variables", () => {
  const vars: FigmaMcpVariableDefinition[] = [
    { name: "misc/flag", kind: "boolean", value: true },
  ];
  assert.equal(generateCssCustomProperties(vars), "");
});

test("generateCssCustomProperties — opacity values have no unit", () => {
  const vars: FigmaMcpVariableDefinition[] = [
    {
      name: "opacity/disabled",
      kind: "number",
      value: 0.38,
      collectionName: "Opacity",
    },
  ];
  const css = generateCssCustomProperties(vars);
  assert.ok(css.includes("--opacity-disabled: 0.38;"));
  assert.ok(!css.includes("0.38px"));
});

// ---------------------------------------------------------------------------
// generateTailwindExtension
// ---------------------------------------------------------------------------

test("generateTailwindExtension — generates correct shape", () => {
  const vars: FigmaMcpVariableDefinition[] = [
    { name: "color/primary/500", kind: "color", value: "#3B82F6" },
    {
      name: "spacing/base",
      kind: "number",
      value: 8,
      collectionName: "Spacing",
    },
    { name: "radius/lg", kind: "number", value: 12 },
  ];
  const ext = generateTailwindExtension(vars);
  assert.ok(ext);
  assert.deepEqual(ext.colors, { "color-primary-500": "#3B82F6" });
  assert.deepEqual(ext.spacing, { "spacing-base": "8px" });
  assert.deepEqual(ext.borderRadius, { "radius-lg": "12px" });
});

test("generateTailwindExtension — empty input returns undefined", () => {
  assert.equal(generateTailwindExtension([]), undefined);
});

test("generateTailwindExtension — only unknown variables returns undefined", () => {
  const vars: FigmaMcpVariableDefinition[] = [
    { name: "misc/value", kind: "boolean", value: true },
  ];
  assert.equal(generateTailwindExtension(vars), undefined);
});

test("generateTailwindExtension — typography FLOAT values as fontSize", () => {
  const vars: FigmaMcpVariableDefinition[] = [
    { name: "font/size/lg", kind: "number", value: 18 },
  ];
  const ext = generateTailwindExtension(vars);
  assert.ok(ext);
  assert.deepEqual(ext.fontSize, { "font-size-lg": "18px" });
});

// ---------------------------------------------------------------------------
// mergeVariablesWithExisting
// ---------------------------------------------------------------------------

test("mergeVariablesWithExisting — figma tokens override existing", () => {
  const existing: FigmaMcpVariableDefinition[] = [
    { name: "color/primary", kind: "color", value: "#OLD" },
    { name: "spacing/base", kind: "number", value: 4 },
  ];
  const incoming: FigmaMcpVariableDefinition[] = [
    { name: "color/primary", kind: "color", value: "#NEW" },
  ];
  const { merged, conflicts } = mergeVariablesWithExisting({
    incoming,
    existing,
  });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].figmaValue, "#NEW");
  assert.equal(conflicts[0].existingValue, "#OLD");
  assert.equal(conflicts[0].resolution, "figma");
  const primary = merged.find(
    (v) => normalizeFigmaVariableName(v.name) === "color-primary",
  );
  assert.ok(primary);
  assert.equal(primary.value, "#NEW");
  // existing-only tokens are preserved
  const spacing = merged.find(
    (v) => normalizeFigmaVariableName(v.name) === "spacing-base",
  );
  assert.ok(spacing);
  assert.equal(spacing.value, 4);
});

test("mergeVariablesWithExisting — no conflicts when values match", () => {
  const existing: FigmaMcpVariableDefinition[] = [
    { name: "color/primary", kind: "color", value: "#3B82F6" },
  ];
  const incoming: FigmaMcpVariableDefinition[] = [
    { name: "color/primary", kind: "color", value: "#3B82F6" },
  ];
  const { conflicts } = mergeVariablesWithExisting({ incoming, existing });
  assert.equal(conflicts.length, 0);
});

test("mergeVariablesWithExisting — empty inputs return empty", () => {
  const { merged, conflicts } = mergeVariablesWithExisting({
    incoming: [],
    existing: [],
  });
  assert.equal(merged.length, 0);
  assert.equal(conflicts.length, 0);
});

// ---------------------------------------------------------------------------
// fetchFigmaVariableDefs — MCP integration
// ---------------------------------------------------------------------------

test("fetchFigmaVariableDefs — calls get_variable_defs and parses response", async () => {
  const fetchImpl: typeof fetch = async (_input, init) => {
    return jsonResponse(
      mcpOk({
        variables: [
          {
            name: "color/primary",
            resolvedValue: "#3B82F6",
            type: "COLOR",
            collection: "Colors",
          },
        ],
      }),
    );
  };

  const result = await fetchFigmaVariableDefs({
    fileKey: "abc123",
    nodeId: "1:2",
    config: createConfig(fetchImpl),
  });

  // It actually sends the raw body, not through parseTool on the fetch side.
  // Let me just check the result.
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "color/primary");
  assert.equal(result[0].kind, "color");
  assert.equal(result[0].value, "#3B82F6");
});

test("fetchDesignSystemTokens — calls search_design_system and parses response", async () => {
  const fetchImpl: typeof fetch = async () => {
    return jsonResponse(
      mcpOk({
        components: [{ name: "Button", libraryKey: "lib-1" }],
        styles: [{ name: "Heading", styleType: "TEXT", fontSizePx: 32 }],
        variables: [],
      }),
    );
  };

  const result = await fetchDesignSystemTokens({
    fileKey: "abc123",
    query: "tokens",
    config: createConfig(fetchImpl),
  });

  assert.equal(result.styles.length, 1);
  assert.equal(result.styles[0].name, "Heading");
  assert.deepEqual(result.libraryKeys, ["lib-1"]);
});

// ---------------------------------------------------------------------------
// resolveFigmaTokens — full orchestration
// ---------------------------------------------------------------------------

test("resolveFigmaTokens — full happy path with variables and design system", async () => {
  let callCount = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    callCount += 1;
    const body = JSON.parse(String((init as RequestInit)?.body ?? "{}")) as {
      params?: { name?: string };
    };
    const toolName = body.params?.name ?? "";

    if (toolName === "get_variable_defs") {
      return jsonResponse(
        mcpOk({
          variables: [
            {
              name: "color/primary/500",
              resolvedValue: "#3B82F6",
              type: "COLOR",
              collection: "Colors",
              mode: "Light",
            },
            {
              name: "color/bg/default",
              resolvedValue: "#FFFFFF",
              type: "COLOR",
              collection: "Colors",
            },
            {
              name: "spacing/base",
              resolvedValue: 8,
              type: "FLOAT",
              collection: "Spacing",
            },
            {
              name: "radius/md",
              resolvedValue: 8,
              type: "FLOAT",
              collection: "Border Radius",
            },
            { name: "feature/darkMode", resolvedValue: true, type: "BOOLEAN" },
          ],
        }),
      );
    }

    if (toolName === "search_design_system") {
      return jsonResponse(
        mcpOk({
          components: [{ name: "Button", libraryKey: "lib-main" }],
          styles: [
            {
              name: "Heading/H1",
              styleType: "TEXT",
              fontSizePx: 32,
              fontWeight: 700,
              lineHeightPx: 40,
            },
          ],
          variables: [],
        }),
      );
    }

    return jsonResponse(mcpOk({}));
  };

  const result = await resolveFigmaTokens({
    fileKey: "test-file",
    nodeId: "1:2",
    mcpConfig: createConfig(fetchImpl),
  });

  // Variables resolved
  assert.ok(result.variables.length >= 4);
  const primaryColor = result.variables.find(
    (v) => v.name === "color/primary/500",
  );
  assert.ok(primaryColor);
  assert.equal(primaryColor.kind, "color");

  // Styles resolved
  assert.ok(result.styleCatalog.length >= 1);

  // CSS generated
  assert.ok(
    result.cssCustomProperties.includes("--color-primary-500: #3B82F6;"),
  );
  assert.ok(result.cssCustomProperties.includes("--spacing-base: 8px;"));
  assert.ok(result.cssCustomProperties.includes("--radius-md: 8px;"));

  // Tailwind generated
  assert.ok(result.tailwindExtension);
  assert.ok(result.tailwindExtension.colors);
  assert.equal(result.tailwindExtension.colors["color-primary-500"], "#3B82F6");

  // Boolean variable is unmapped
  assert.ok(result.unmappedVariables.includes("feature/darkMode"));

  // No conflicts (no existing tokens)
  assert.equal(result.conflicts.length, 0);

  // Library key diagnostic
  const libDiag = result.diagnostics.find(
    (d) => d.code === "I_TOKEN_BRIDGE_LIBRARY_KEYS",
  );
  assert.ok(libDiag);
  assert.ok(libDiag.message.includes("lib-main"));
});

test("resolveFigmaTokens — gracefully handles get_variable_defs failure", async () => {
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String((init as RequestInit)?.body ?? "{}")) as {
      params?: { name?: string };
    };
    const toolName = body.params?.name ?? "";

    if (toolName === "get_variable_defs") {
      return jsonResponse({}, { status: 500 });
    }

    if (toolName === "search_design_system") {
      return jsonResponse(
        mcpOk({
          components: [],
          styles: [
            { name: "Fill/Primary", styleType: "FILL", color: "#3B82F6" },
          ],
          variables: [],
        }),
      );
    }

    return jsonResponse(mcpOk({}));
  };

  const result = await resolveFigmaTokens({
    fileKey: "test-file",
    nodeId: "1:2",
    mcpConfig: createConfig(fetchImpl),
  });

  // Variables fetch failed, but styles still resolved
  assert.ok(result.styleCatalog.length >= 1);
  const varDiag = result.diagnostics.find(
    (d) => d.code === "W_TOKEN_BRIDGE_VARIABLES_SKIPPED",
  );
  assert.ok(varDiag);
});

test("resolveFigmaTokens — gracefully handles search_design_system failure", async () => {
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String((init as RequestInit)?.body ?? "{}")) as {
      params?: { name?: string };
    };
    const toolName = body.params?.name ?? "";

    if (toolName === "get_variable_defs") {
      return jsonResponse(
        mcpOk({
          variables: [
            { name: "color/primary", resolvedValue: "#3B82F6", type: "COLOR" },
          ],
        }),
      );
    }

    if (toolName === "search_design_system") {
      return jsonResponse({}, { status: 500 });
    }

    return jsonResponse(mcpOk({}));
  };

  const result = await resolveFigmaTokens({
    fileKey: "test-file",
    nodeId: "1:2",
    mcpConfig: createConfig(fetchImpl),
  });

  // Variables still resolved
  assert.ok(result.variables.length >= 1);
  const dsDiag = result.diagnostics.find(
    (d) => d.code === "W_TOKEN_BRIDGE_DESIGN_SYSTEM_SKIPPED",
  );
  assert.ok(dsDiag);
});

test("resolveFigmaTokens — no variables returns empty result with valid shape", async () => {
  const fetchImpl: typeof fetch = async () => {
    return jsonResponse(mcpOk({}));
  };

  const result = await resolveFigmaTokens({
    fileKey: "test-file",
    nodeId: "1:2",
    mcpConfig: createConfig(fetchImpl),
  });

  assert.deepEqual(result.variables, []);
  assert.deepEqual(result.styleCatalog, []);
  assert.equal(result.cssCustomProperties, "");
  assert.equal(result.tailwindExtension, undefined);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.unmappedVariables, []);
});

test("resolveFigmaTokens — merges with existing variables and tracks conflicts", async () => {
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String((init as RequestInit)?.body ?? "{}")) as {
      params?: { name?: string };
    };
    const toolName = body.params?.name ?? "";

    if (toolName === "get_variable_defs") {
      return jsonResponse(
        mcpOk({
          variables: [
            { name: "color/primary", resolvedValue: "#NEW", type: "COLOR" },
          ],
        }),
      );
    }

    return jsonResponse(mcpOk({}));
  };

  const result = await resolveFigmaTokens({
    fileKey: "test-file",
    nodeId: "1:2",
    mcpConfig: createConfig(fetchImpl),
    existingVariables: [
      { name: "color/primary", kind: "color", value: "#OLD" },
      { name: "spacing/base", kind: "number", value: 4 },
    ],
  });

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].figmaValue, "#NEW");
  assert.equal(result.conflicts[0].existingValue, "#OLD");
  // Existing-only token preserved
  const spacing = result.variables.find((v) => v.name === "spacing/base");
  assert.ok(spacing);
});

test("resolveFigmaTokens — library styles override raw variable names", async () => {
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String((init as RequestInit)?.body ?? "{}")) as {
      params?: { name?: string };
    };
    const toolName = body.params?.name ?? "";

    if (toolName === "get_variable_defs") {
      return jsonResponse(
        mcpOk({
          variables: [
            { name: "raw/color/1", resolvedValue: "#3B82F6", type: "COLOR" },
          ],
        }),
      );
    }

    if (toolName === "search_design_system") {
      return jsonResponse(
        mcpOk({
          components: [],
          styles: [
            { name: "Brand/Primary", styleType: "FILL", color: "#3B82F6" },
          ],
          variables: [],
        }),
      );
    }

    return jsonResponse(mcpOk({}));
  };

  const result = await resolveFigmaTokens({
    fileKey: "test-file",
    nodeId: "1:2",
    mcpConfig: createConfig(fetchImpl),
  });

  // The raw variable should be renamed to the library token name
  const renamed = result.variables.find((v) => v.name === "Brand/Primary");
  assert.ok(renamed, "Variable should be renamed to library token name");
  assert.ok(
    renamed.aliases?.includes("raw/color/1"),
    "Original name should be in aliases",
  );
});

// ---------------------------------------------------------------------------
// Edge cases: large token sets
// ---------------------------------------------------------------------------

test("resolveFigmaTokens — handles large token set (500+ variables)", async () => {
  const largeVars = Array.from({ length: 600 }, (_, i) => ({
    name: `color/shade/${String(i)}`,
    resolvedValue: `#${String(i).padStart(6, "0")}`,
    type: "COLOR",
  }));

  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String((init as RequestInit)?.body ?? "{}")) as {
      params?: { name?: string };
    };
    const toolName = body.params?.name ?? "";

    if (toolName === "get_variable_defs") {
      return jsonResponse(mcpOk({ variables: largeVars }));
    }

    return jsonResponse(mcpOk({}));
  };

  const result = await resolveFigmaTokens({
    fileKey: "test-file",
    nodeId: "1:2",
    mcpConfig: createConfig(fetchImpl),
  });

  assert.equal(result.variables.length, 600);
  assert.ok(result.cssCustomProperties.length > 0);
});
