import type {
  DesignTokens,
  FigmaMcpEnrichmentDiagnostic,
  FigmaMcpStyleCatalogEntry,
  FigmaMcpVariableDefinition,
  TokenBridgeResult,
  TokenConflict,
} from "../parity/types.js";
import type { FigmaFile } from "../parity/ir-helpers.js";
import { deriveTokens } from "../parity/ir-tokens.js";
import {
  callMcpTool,
  type McpResolverConfig,
  type McpResolverDiagnostic,
} from "./figma-mcp-resolver.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIGMA_TYPE_TO_KIND: Record<string, FigmaMcpVariableDefinition["kind"]> = {
  COLOR: "color",
  FLOAT: "number",
  STRING: "string",
  BOOLEAN: "boolean",
};

const SPACING_COLLECTION_PATTERNS: readonly RegExp[] = [
  /\bspacing\b/i,
  /\bspace\b/i,
  /\bgap\b/i,
];

const RADIUS_COLLECTION_PATTERNS: readonly RegExp[] = [
  /\bradius\b/i,
  /\bcorner\b/i,
  /\bborder[-_\s]?radius\b/i,
];

const TYPOGRAPHY_COLLECTION_PATTERNS: readonly RegExp[] = [
  /\bfont\b/i,
  /\btext\b/i,
  /\btype\b/i,
  /\btypography\b/i,
];

const SIZE_COLLECTION_PATTERNS: readonly RegExp[] = [
  /\bsize\b/i,
  /\bwidth\b/i,
  /\bheight\b/i,
];

const OPACITY_COLLECTION_PATTERNS: readonly RegExp[] = [
  /\bopacity\b/i,
  /\balpha\b/i,
];

const VARIABLE_NAME_PATTERNS = {
  color: [/^colou?r[/\-_]/i, /^fill[/\-_]/i, /^bg[/\-_]/i],
  spacing: [/^spacing[/\-_]/i, /^space[/\-_]/i, /^gap[/\-_]/i],
  radius: [/^radius[/\-_]/i, /^corner[/\-_]/i],
  typography: [/^font[/\-_]/i, /^text[/\-_]/i, /^type[/\-_]/i],
  size: [/^size[/\-_]/i, /^width[/\-_]/i, /^height[/\-_]/i],
  opacity: [/^opacity[/\-_]/i, /^alpha[/\-_]/i],
} as const;

// ---------------------------------------------------------------------------
// MCP response shapes
// ---------------------------------------------------------------------------

interface RawFigmaVariable {
  name?: unknown;
  resolvedValue?: unknown;
  collection?: unknown;
  mode?: unknown;
  type?: unknown;
}

interface RawDesignSystemStyle {
  name?: unknown;
  styleType?: unknown;
  id?: unknown;
  fontSizePx?: unknown;
  fontWeight?: unknown;
  lineHeightPx?: unknown;
  fontFamily?: unknown;
  letterSpacingPx?: unknown;
  color?: unknown;
}

type TokenPrimitive = string | number | boolean;

// ---------------------------------------------------------------------------
// Name normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes a Figma variable name to CSS custom property compatible format.
 * `color/primary/500` → `color-primary-500`
 */
export const normalizeFigmaVariableName = (name: string): string =>
  name
    .replace(/\s+/g, "-")
    .replace(/[/_]/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

// ---------------------------------------------------------------------------
// Variable classification
// ---------------------------------------------------------------------------

type VariableCategory =
  | "color"
  | "spacing"
  | "radius"
  | "typography"
  | "size"
  | "opacity"
  | "unknown";

const matchesAny = (value: string, patterns: readonly RegExp[]): boolean =>
  patterns.some((p) => p.test(value));

/**
 * Classifies a Figma variable into a token category based on its type,
 * collection name, and variable name.
 */
export const classifyVariable = (
  variable: FigmaMcpVariableDefinition,
): VariableCategory => {
  const { kind, name, collectionName } = variable;
  const nameAndCollection = [name, collectionName ?? ""].join(" ");

  if (kind === "color") {
    return "color";
  }

  if (kind === "number") {
    if (
      matchesAny(nameAndCollection, SPACING_COLLECTION_PATTERNS) ||
      matchesAny(name, VARIABLE_NAME_PATTERNS.spacing)
    ) {
      return "spacing";
    }
    if (
      matchesAny(nameAndCollection, RADIUS_COLLECTION_PATTERNS) ||
      matchesAny(name, VARIABLE_NAME_PATTERNS.radius)
    ) {
      return "radius";
    }
    // Typography must be checked before size because font/size/* should
    // classify as typography, not size.
    if (
      matchesAny(nameAndCollection, TYPOGRAPHY_COLLECTION_PATTERNS) ||
      matchesAny(name, VARIABLE_NAME_PATTERNS.typography)
    ) {
      return "typography";
    }
    if (
      matchesAny(nameAndCollection, SIZE_COLLECTION_PATTERNS) ||
      matchesAny(name, VARIABLE_NAME_PATTERNS.size)
    ) {
      return "size";
    }
    if (
      matchesAny(nameAndCollection, OPACITY_COLLECTION_PATTERNS) ||
      matchesAny(name, VARIABLE_NAME_PATTERNS.opacity)
    ) {
      return "opacity";
    }
  }

  if (kind === "string") {
    if (
      matchesAny(nameAndCollection, TYPOGRAPHY_COLLECTION_PATTERNS) ||
      matchesAny(name, VARIABLE_NAME_PATTERNS.typography)
    ) {
      return "typography";
    }
  }

  return "unknown";
};

// ---------------------------------------------------------------------------
// Parse MCP responses into enrichment types
// ---------------------------------------------------------------------------

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Parses the raw MCP `get_variable_defs` response into typed variable defs.
 */
export const parseVariableDefsResponse = (
  raw: unknown,
): FigmaMcpVariableDefinition[] => {
  if (!raw || typeof raw !== "object") {
    return [];
  }

  // The response may be a flat record { "name": "value" } or an array of objects
  const record = raw as Record<string, unknown>;

  // Case 1: Array of variable objects (structured format)
  const variables = Array.isArray(record.variables)
    ? record.variables
    : Array.isArray(raw)
      ? (raw as unknown[])
      : undefined;

  if (variables) {
    return variables
      .filter(
        (entry): entry is RawFigmaVariable =>
          typeof entry === "object" && entry !== null,
      )
      .filter((entry) => isNonEmptyString(entry.name))
      .map((entry) => {
        const figmaType = isNonEmptyString(entry.type)
          ? entry.type.toUpperCase()
          : undefined;
        const kind = figmaType
          ? (FIGMA_TYPE_TO_KIND[figmaType] ?? "string")
          : inferKind(entry.resolvedValue);

        return {
          name: String(entry.name),
          kind,
          value: coerceValue(entry.resolvedValue, kind),
          ...(isNonEmptyString(entry.collection)
            ? { collectionName: entry.collection }
            : {}),
          ...(isNonEmptyString(entry.mode) ? { modeName: entry.mode } : {}),
        };
      });
  }

  // Case 2: Flat record { "variable/name": "resolved-value" }
  const entries = Object.entries(record).filter(([key]) => key.length > 0);
  if (entries.length === 0) {
    return [];
  }

  return entries.map(([name, value]) => {
    const kind = inferKind(value);
    return {
      name,
      kind,
      value: coerceValue(value, kind),
    };
  });
};

const inferKind = (value: unknown): FigmaMcpVariableDefinition["kind"] => {
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value.trim())) {
    return "color";
  }
  if (typeof value === "string" && /^rgba?\(/.test(value.trim())) {
    return "color";
  }
  return "string";
};

const coerceValue = (
  value: unknown,
  kind: FigmaMcpVariableDefinition["kind"],
): string | number | boolean => {
  if (kind === "boolean") {
    return typeof value === "boolean" ? value : Boolean(value);
  }
  if (kind === "number") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
};

// ---------------------------------------------------------------------------
// Parse search_design_system response
// ---------------------------------------------------------------------------

/**
 * Parses the raw MCP `search_design_system` response into style catalog entries.
 */
export const parseDesignSystemResponse = (
  raw: unknown,
): { styles: FigmaMcpStyleCatalogEntry[]; libraryKeys: string[] } => {
  if (!raw || typeof raw !== "object") {
    return { styles: [], libraryKeys: [] };
  }

  const record = raw as Record<string, unknown>;
  const libraryKeys: string[] = [];

  // Extract library keys for Code Connect (#1003)
  if (Array.isArray(record.components)) {
    for (const comp of record.components) {
      if (typeof comp === "object" && comp !== null) {
        const compRecord = comp as Record<string, unknown>;
        if (
          isNonEmptyString(compRecord.libraryKey) &&
          !libraryKeys.includes(compRecord.libraryKey)
        ) {
          libraryKeys.push(compRecord.libraryKey);
        }
      }
    }
  }

  const rawStyles = Array.isArray(record.styles) ? record.styles : [];

  const styles: FigmaMcpStyleCatalogEntry[] = rawStyles
    .filter(
      (entry): entry is RawDesignSystemStyle =>
        typeof entry === "object" && entry !== null,
    )
    .filter((entry) => isNonEmptyString(entry.name))
    .map((entry) => ({
      name: entry.name as string,
      styleType: isNonEmptyString(entry.styleType) ? entry.styleType : "FILL",
      ...(isNonEmptyString(entry.id) ? { id: entry.id } : {}),
      ...(isFiniteNumber(entry.fontSizePx)
        ? { fontSizePx: entry.fontSizePx }
        : {}),
      ...(isFiniteNumber(entry.fontWeight)
        ? { fontWeight: entry.fontWeight }
        : {}),
      ...(isFiniteNumber(entry.lineHeightPx)
        ? { lineHeightPx: entry.lineHeightPx }
        : {}),
      ...(isNonEmptyString(entry.fontFamily)
        ? { fontFamily: entry.fontFamily }
        : {}),
      ...(isFiniteNumber(entry.letterSpacingPx)
        ? { letterSpacingPx: entry.letterSpacingPx }
        : {}),
      ...(isNonEmptyString(entry.color) ? { color: entry.color } : {}),
    }));

  // Also parse variables from design system into style entries (colors as FILL styles)
  if (Array.isArray(record.variables)) {
    for (const variable of record.variables) {
      if (typeof variable !== "object" || variable === null) {
        continue;
      }
      const varRecord = variable as Record<string, unknown>;
      if (!isNonEmptyString(varRecord.name)) {
        continue;
      }
      if (
        isNonEmptyString(varRecord.resolvedValue) &&
        /^#[0-9a-f]{3,8}$/i.test(varRecord.resolvedValue.trim())
      ) {
        styles.push({
          name: varRecord.name,
          styleType: "FILL",
          color: varRecord.resolvedValue.trim(),
        });
      }
    }
  }

  return { styles, libraryKeys };
};

const EMPTY_FIGMA_FILE: FigmaFile = {
  name: "Figma token bridge",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [],
  },
};

// ---------------------------------------------------------------------------
// CSS custom properties generation
// ---------------------------------------------------------------------------

const getPreferredModeOrder = (
  variable: FigmaMcpVariableDefinition,
): number => {
  const mode = variable.modeName?.trim();
  if (!mode) {
    return -1;
  }
  const index = MODE_PREFERENCE_PATTERNS.findIndex((pattern) =>
    pattern.test(mode),
  );
  return index === -1 ? MODE_PREFERENCE_PATTERNS.length : index;
};

const selectCanonicalVariablesForOutput = (
  variables: readonly FigmaMcpVariableDefinition[],
  {
    canEmit,
  }: {
    canEmit: (variable: FigmaMcpVariableDefinition) => boolean;
  },
): FigmaMcpVariableDefinition[] => {
  const canonicalVariables = new Map<string, FigmaMcpVariableDefinition>();

  for (const variable of variables) {
    const key = normalizeFigmaVariableName(variable.name);
    if (key.length === 0) {
      continue;
    }

    const existing = canonicalVariables.get(key);
    if (!existing) {
      canonicalVariables.set(key, variable);
      continue;
    }

    const existingCanEmit = canEmit(existing);
    const variableCanEmit = canEmit(variable);
    if (existingCanEmit !== variableCanEmit) {
      if (variableCanEmit) {
        canonicalVariables.set(key, variable);
      }
      continue;
    }

    if (getPreferredModeOrder(variable) < getPreferredModeOrder(existing)) {
      canonicalVariables.set(key, variable);
    }
  }

  return [...canonicalVariables.values()];
};

const canEmitCssCustomProperty = (
  variable: FigmaMcpVariableDefinition,
): boolean => classifyVariable(variable) !== "unknown";

const canEmitTailwindToken = (
  variable: FigmaMcpVariableDefinition,
): boolean => {
  const category = classifyVariable(variable);
  return (
    category === "color" ||
    category === "spacing" ||
    category === "radius" ||
    category === "opacity" ||
    (category === "typography" && variable.kind === "number")
  );
};

/**
 * Generates a CSS custom properties block from resolved variables.
 */
export const generateCssCustomProperties = (
  variables: readonly FigmaMcpVariableDefinition[],
): string => {
  if (variables.length === 0) {
    return "";
  }

  const lines: string[] = [];

  for (const variable of selectCanonicalVariablesForOutput(variables, {
    canEmit: canEmitCssCustomProperty,
  })) {
    const category = classifyVariable(variable);
    if (category === "unknown") {
      continue;
    }

    const cssName = normalizeFigmaVariableName(variable.name);
    if (cssName.length === 0) {
      continue;
    }

    const cssValue = formatCssValue(variable, category);
    lines.push(`  --${cssName}: ${cssValue};`);
  }

  if (lines.length === 0) {
    return "";
  }

  return `:root {\n${lines.join("\n")}\n}`;
};

const formatCssValue = (
  variable: FigmaMcpVariableDefinition,
  category: VariableCategory,
): string => {
  if (category === "color") {
    return String(variable.value);
  }
  if (
    category === "spacing" ||
    category === "radius" ||
    category === "size" ||
    (category === "typography" && variable.kind === "number")
  ) {
    return `${String(variable.value)}px`;
  }
  if (category === "opacity") {
    return String(variable.value);
  }
  return String(variable.value);
};

// ---------------------------------------------------------------------------
// Tailwind config extension generation
// ---------------------------------------------------------------------------

/**
 * Generates a Tailwind `theme.extend` config object from resolved variables.
 */
export const generateTailwindExtension = (
  variables: readonly FigmaMcpVariableDefinition[],
): Record<string, Record<string, string>> | undefined => {
  if (variables.length === 0) {
    return undefined;
  }

  const colors: Record<string, string> = {};
  const spacing: Record<string, string> = {};
  const borderRadius: Record<string, string> = {};
  const fontSize: Record<string, string> = {};
  const opacity: Record<string, string> = {};

  for (const variable of selectCanonicalVariablesForOutput(variables, {
    canEmit: canEmitTailwindToken,
  })) {
    const category = classifyVariable(variable);
    const key = normalizeFigmaVariableName(variable.name);
    if (key.length === 0 || category === "unknown") {
      continue;
    }

    switch (category) {
      case "color":
        colors[key] = String(variable.value);
        break;
      case "spacing":
        spacing[key] = `${String(variable.value)}px`;
        break;
      case "radius":
        borderRadius[key] = `${String(variable.value)}px`;
        break;
      case "typography":
        if (variable.kind === "number") {
          fontSize[key] = `${String(variable.value)}px`;
        }
        break;
      case "opacity":
        opacity[key] = String(variable.value);
        break;
      // size variables don't map to a standard Tailwind key cleanly
    }
  }

  const extension: Record<string, Record<string, string>> = {};

  if (Object.keys(colors).length > 0) {
    extension.colors = colors;
  }
  if (Object.keys(spacing).length > 0) {
    extension.spacing = spacing;
  }
  if (Object.keys(borderRadius).length > 0) {
    extension.borderRadius = borderRadius;
  }
  if (Object.keys(fontSize).length > 0) {
    extension.fontSize = fontSize;
  }
  if (Object.keys(opacity).length > 0) {
    extension.opacity = opacity;
  }

  return Object.keys(extension).length > 0 ? extension : undefined;
};

// ---------------------------------------------------------------------------
// Merge with conflict tracking
// ---------------------------------------------------------------------------

/**
 * Merges newly resolved Figma variables with existing ones.
 * Figma tokens take precedence for matching names; workspace-only tokens are preserved.
 */
export const mergeVariablesWithExisting = ({
  incoming,
  existing,
  onLog,
}: {
  incoming: readonly FigmaMcpVariableDefinition[];
  existing: readonly FigmaMcpVariableDefinition[];
  onLog?: (message: string) => void;
}): { merged: FigmaMcpVariableDefinition[]; conflicts: TokenConflict[] } => {
  const conflicts: TokenConflict[] = [];
  const merged = new Map<string, FigmaMcpVariableDefinition>();
  const toVariableKey = (variable: FigmaMcpVariableDefinition): string => {
    const nameKey = normalizeFigmaVariableName(variable.name);
    const modeKey = variable.modeName?.trim().toLowerCase() || "default";
    return `${nameKey}::${modeKey}`;
  };
  const toConflictName = (variable: FigmaMcpVariableDefinition): string => {
    const key = normalizeFigmaVariableName(variable.name);
    return variable.modeName?.trim()
      ? `${key} [${variable.modeName.trim()}]`
      : key;
  };

  // Seed with existing
  for (const variable of existing) {
    merged.set(toVariableKey(variable), variable);
  }

  // Overlay with incoming (Figma takes precedence)
  for (const variable of incoming) {
    const key = toVariableKey(variable);
    const prev = merged.get(key);
    if (prev !== undefined) {
      const prevValue = String(prev.value);
      const newValue = String(variable.value);
      if (prevValue !== newValue) {
        const conflictName = toConflictName(variable);
        conflicts.push({
          kind: "value_override",
          name: conflictName,
          figmaValue: newValue,
          existingValue: prevValue,
          resolution: "figma",
        });
        onLog?.(
          `Token conflict: "${conflictName}" — Figma "${newValue}" overrides existing "${prevValue}"`,
        );
      }
    }
    merged.set(key, variable);
  }

  return { merged: [...merged.values()], conflicts };
};

const fetchFigmaVariablePayload = async ({
  fileKey,
  nodeId,
  config,
  signal,
}: {
  fileKey: string;
  nodeId: string;
  config: McpResolverConfig;
  signal?: AbortSignal;
}): Promise<unknown> => {
  const diagnostics: McpResolverDiagnostic[] = [];

  return await callMcpTool({
    toolName: "get_variable_defs",
    args: { fileKey, nodeId },
    config,
    ...(signal ? { signal } : {}),
    diagnostics,
  });
};

// ---------------------------------------------------------------------------
// MCP fetch helpers
// ---------------------------------------------------------------------------

/**
 * Fetches variable definitions from the Figma MCP `get_variable_defs` tool.
 */
export const fetchFigmaVariableDefs = async ({
  fileKey,
  nodeId,
  config,
  signal,
}: {
  fileKey: string;
  nodeId: string;
  config: McpResolverConfig;
  signal?: AbortSignal;
}): Promise<FigmaMcpVariableDefinition[]> => {
  return parseVariableDefsResponse(
    await fetchFigmaVariablePayload({
      fileKey,
      nodeId,
      config,
      ...(signal ? { signal } : {}),
    }),
  );
};

/**
 * Fetches design system data from the Figma MCP `search_design_system` tool.
 */
export const fetchDesignSystemTokens = async ({
  fileKey,
  query,
  config,
  signal,
}: {
  fileKey: string;
  query: string;
  config: McpResolverConfig;
  signal?: AbortSignal;
}): Promise<{ styles: FigmaMcpStyleCatalogEntry[]; libraryKeys: string[] }> => {
  const diagnostics: McpResolverDiagnostic[] = [];

  const result = await callMcpTool({
    toolName: "search_design_system",
    args: {
      fileKey,
      query,
      includeComponents: true,
      includeVariables: true,
      includeStyles: true,
    },
    config,
    ...(signal ? { signal } : {}),
    diagnostics,
  });

  return parseDesignSystemResponse(result);
};

// ---------------------------------------------------------------------------
// Main entry point: resolveFigmaTokens
// ---------------------------------------------------------------------------

export interface TokenBridgeConfig {
  fileKey: string;
  nodeId: string;
  mcpConfig: McpResolverConfig;
  signal?: AbortSignal;
  existingVariables?: readonly FigmaMcpVariableDefinition[];
  existingStyles?: readonly FigmaMcpStyleCatalogEntry[];
}

const MODE_PREFERENCE_PATTERNS = [/^default$/i, /^base$/i, /^light$/i];

const buildDesignSystemSearchQuery = ({
  variables,
  styles,
}: {
  variables: readonly FigmaMcpVariableDefinition[];
  styles: readonly FigmaMcpStyleCatalogEntry[];
}): string => {
  const fragments: string[] = [];
  const pushFragment = (value: string): void => {
    if (!fragments.includes(value)) {
      fragments.push(value);
    }
  };

  const registerLookupValue = (value: string): void => {
    if (/\b(background|surface|paper)\b/i.test(value)) {
      pushFragment("background");
    }
    if (/\b(primary|brand)\b/i.test(value)) {
      pushFragment("primary");
    }
    if (/\bsecondary|accent\b/i.test(value)) {
      pushFragment("secondary");
    }
    if (/\b(space|spacing|gap)\b/i.test(value)) {
      pushFragment("space");
    }
    if (/\b(radius|corner|rounded)\b/i.test(value)) {
      pushFragment("radius");
    }
    if (/\b(font|text|type|typography)\b/i.test(value)) {
      pushFragment("font");
    }
  };

  for (const variable of variables) {
    registerLookupValue(variable.name);
    if (variable.collectionName) {
      registerLookupValue(variable.collectionName);
    }
    if (fragments.length >= 4) {
      break;
    }
  }

  for (const style of styles) {
    registerLookupValue(style.name);
    if (fragments.length >= 4) {
      break;
    }
  }

  return fragments.length > 0
    ? fragments.join(" ")
    : "background space radius font";
};

const collectModeAlternatives = ({
  variables,
}: {
  variables: readonly FigmaMcpVariableDefinition[];
}): Record<string, Record<string, TokenPrimitive>> => {
  const grouped = new Map<string, Record<string, TokenPrimitive>>();

  for (const variable of variables) {
    const key = normalizeFigmaVariableName(variable.name);
    const modeKey = variable.modeName?.trim() || "default";
    const entry = grouped.get(key) ?? {};
    entry[modeKey] = variable.value;
    grouped.set(key, entry);
  }

  return [...grouped.entries()].reduce<
    Record<string, Record<string, TokenPrimitive>>
  >((acc, [key, value]) => {
    if (Object.keys(value).length > 1) {
      acc[key] = value;
    }
    return acc;
  }, {});
};

const buildCanonicalDesignTokens = ({
  variables,
  styleCatalog,
}: {
  variables: readonly FigmaMcpVariableDefinition[];
  styleCatalog: readonly FigmaMcpStyleCatalogEntry[];
}): DesignTokens =>
  deriveTokens(EMPTY_FIGMA_FILE, {
    sourceMode: "hybrid",
    toolNames: [],
    nodeHints: [],
    variables: [...variables],
    styleCatalog: [...styleCatalog],
  });

/**
 * Resolves Figma variables and design system tokens via MCP, maps them
 * into enrichment-ready types, and produces CSS/Tailwind side-outputs.
 *
 * This is the main orchestrator for Issue #1001.
 */
export const resolveFigmaTokens = async (
  bridgeConfig: TokenBridgeConfig,
): Promise<TokenBridgeResult> => {
  const {
    fileKey,
    nodeId,
    mcpConfig,
    signal,
    existingVariables = [],
    existingStyles = [],
  } = bridgeConfig;
  const diagnostics: FigmaMcpEnrichmentDiagnostic[] = [];
  const unmappedVariables: string[] = [];
  let selectionStyles: FigmaMcpStyleCatalogEntry[] = [];

  // ----- Step 1: Fetch variable definitions -----
  let rawVariables: FigmaMcpVariableDefinition[] = [];

  try {
    const rawPayload = await fetchFigmaVariablePayload({
      fileKey,
      nodeId,
      config: mcpConfig,
      ...(signal ? { signal } : {}),
    });
    rawVariables = parseVariableDefsResponse(rawPayload);
    selectionStyles = parseDesignSystemResponse(rawPayload).styles;
    mcpConfig.onLog?.(
      `Fetched ${String(rawVariables.length)} variable defs and ${String(selectionStyles.length)} selection styles from MCP`,
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error fetching variable defs";
    diagnostics.push({
      code: "W_TOKEN_BRIDGE_VARIABLES_SKIPPED",
      message: `Variable defs fetch failed, proceeding without: ${message}`,
      severity: "warning",
      source: "variables",
    });
    mcpConfig.onLog?.(`get_variable_defs failed: ${message}`);
  }

  // ----- Step 2: Fetch design system styles -----
  let designSystemStyles: FigmaMcpStyleCatalogEntry[] = [];
  let libraryKeys: string[] = [];

  try {
    const dsResult = await fetchDesignSystemTokens({
      fileKey,
      query: buildDesignSystemSearchQuery({
        variables: rawVariables,
        styles: selectionStyles,
      }),
      config: mcpConfig,
      ...(signal ? { signal } : {}),
    });
    designSystemStyles = dsResult.styles;
    libraryKeys = dsResult.libraryKeys;
    mcpConfig.onLog?.(
      `Fetched ${String(designSystemStyles.length)} styles, ${String(libraryKeys.length)} library keys from design system`,
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error fetching design system";
    diagnostics.push({
      code: "W_TOKEN_BRIDGE_DESIGN_SYSTEM_SKIPPED",
      message: `Design system fetch failed, proceeding without: ${message}`,
      severity: "warning",
      source: "styles",
    });
    mcpConfig.onLog?.(`search_design_system failed: ${message}`);
  }

  const modeAlternatives = collectModeAlternatives({ variables: rawVariables });

  rawVariables = [...rawVariables].sort((left, right) => {
    const leftModeOrder = getPreferredModeOrder(left);
    const rightModeOrder = getPreferredModeOrder(right);
    if (leftModeOrder !== rightModeOrder) {
      return leftModeOrder - rightModeOrder;
    }
    return left.name.localeCompare(right.name);
  });

  // ----- Step 3: Prefer library token names over raw values -----
  let aliasConflicts: TokenConflict[] = [];
  if (designSystemStyles.length > 0 && rawVariables.length > 0) {
    const libraryResult = preferLibraryTokenNames({
      variables: rawVariables,
      libraryStyles: designSystemStyles,
    });
    rawVariables = libraryResult.variables;
    aliasConflicts = libraryResult.conflicts;
  }

  // ----- Step 4: Merge with existing variables -----
  const { merged: mergedVariables, conflicts: mergeConflicts } =
    mergeVariablesWithExisting({
      incoming: rawVariables,
      existing: [...existingVariables],
      ...(mcpConfig.onLog ? { onLog: mcpConfig.onLog } : {}),
    });
  // Alias-collision conflicts represent pre-existing data issues in Figma;
  // value-override conflicts arise during merge. Surface the pre-existing
  // ones first so consumers see them before merge-time resolutions.
  const conflicts: TokenConflict[] = [...aliasConflicts, ...mergeConflicts];

  // ----- Step 5: Merge style catalogs -----
  const mergedStyles = mergeStyleCatalogs({
    incoming: [...selectionStyles, ...designSystemStyles],
    existing: [...existingStyles],
  });

  // ----- Step 6: Classify and track unmapped -----
  for (const variable of mergedVariables) {
    if (classifyVariable(variable) === "unknown") {
      unmappedVariables.push(variable.name);
    }
  }

  if (unmappedVariables.length > 0) {
    diagnostics.push({
      code: "I_TOKEN_BRIDGE_UNMAPPED_VARIABLES",
      message: `${String(unmappedVariables.length)} variable(s) could not be categorized: ${unmappedVariables.slice(0, 5).join(", ")}${unmappedVariables.length > 5 ? "…" : ""}`,
      severity: "info",
      source: "variables",
    });
  }

  // ----- Step 7: Generate CSS & Tailwind -----
  const cssCustomProperties = generateCssCustomProperties(mergedVariables);
  const tailwindExtension = generateTailwindExtension(mergedVariables);
  const designTokens = buildCanonicalDesignTokens({
    variables: mergedVariables,
    styleCatalog: mergedStyles,
  });

  if (libraryKeys.length > 0) {
    diagnostics.push({
      code: "I_TOKEN_BRIDGE_LIBRARY_KEYS",
      message: `Discovered ${String(libraryKeys.length)} library key(s) for Code Connect mapping: ${libraryKeys.join(", ")}`,
      severity: "info",
      source: "design_system",
    });
  }

  return {
    variables: mergedVariables,
    styleCatalog: mergedStyles,
    designTokens,
    cssCustomProperties,
    ...(tailwindExtension ? { tailwindExtension } : {}),
    libraryKeys,
    modeAlternatives,
    conflicts,
    unmappedVariables,
    diagnostics,
  };
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type CollidingVariable = {
  name: string;
  value: string;
  modeName?: string;
};

type ClaimantGroup = { libraryName: string; indices: number[] };

const groupClaimantsByPostRenameMergeKey = ({
  variables,
  candidates,
}: {
  variables: readonly FigmaMcpVariableDefinition[];
  candidates: ReadonlyArray<string | null>;
}): Map<string, ClaimantGroup> => {
  // Group by the post-rename merge key used by `mergeVariablesWithExisting`
  // (`normalizeFigmaVariableName(libraryName)::modeName`). Two candidates only
  // collide when the rename would produce the SAME merge key — entries with
  // the same library name in different modes have distinct merge keys and are
  // safe to rename.
  const groups = new Map<string, ClaimantGroup>();
  const seenSourceKeysByMergeKey = new Map<string, Set<string>>();
  candidates.forEach((libraryName, index) => {
    if (libraryName === null) {
      return;
    }
    const variable = variables[index];
    if (!variable) {
      return;
    }
    const modeKey = variable.modeName?.trim().toLowerCase() || "default";
    const mergeKey = `${normalizeFigmaVariableName(libraryName)}::${modeKey}`;
    // Dedup by `(name, modeName)` so a duplicated input variable is not
    // counted twice as a claimant for the same merge key.
    const sourceKey = `${variable.name}::${variable.modeName?.trim() ?? ""}`;
    const seen = seenSourceKeysByMergeKey.get(mergeKey) ?? new Set<string>();
    if (seen.has(sourceKey)) {
      return;
    }
    seen.add(sourceKey);
    seenSourceKeysByMergeKey.set(mergeKey, seen);
    const group = groups.get(mergeKey) ?? { libraryName, indices: [] };
    group.indices.push(index);
    groups.set(mergeKey, group);
  });
  return groups;
};

const buildAliasCollisionConflict = ({
  libraryName,
  indices,
  variables,
}: {
  libraryName: string;
  indices: readonly number[];
  variables: readonly FigmaMcpVariableDefinition[];
}): TokenConflict => {
  const collidingVariables: CollidingVariable[] = indices
    .map((index): CollidingVariable | null => {
      const variable = variables[index];
      if (!variable) {
        return null;
      }
      const modeName = variable.modeName?.trim();
      return {
        name: variable.name,
        value: String(variable.value),
        ...(modeName ? { modeName } : {}),
      };
    })
    .filter((entry): entry is CollidingVariable => entry !== null)
    .sort((left, right) => {
      const nameCompare = left.name.localeCompare(right.name);
      if (nameCompare !== 0) {
        return nameCompare;
      }
      return (left.modeName ?? "").localeCompare(right.modeName ?? "");
    });
  return {
    kind: "library_alias_collision",
    libraryName,
    collidingVariables,
    resolution: "preserve_original",
  };
};

/**
 * When library styles are available, prefer their token names over raw variable names.
 * Matches by resolved color value.
 *
 * If two or more distinct variables (different `(name, modeName)` keys) match
 * the same library style, renaming both would collapse them to the same key in
 * `mergeVariablesWithExisting` and silently drop one. To preserve identity:
 *   - we keep their original names (so dedup keys stay distinct)
 *   - we still attach the library name as an alias on each claimant
 *   - we emit a single `library_alias_collision` conflict listing all claimants
 */
const preferLibraryTokenNames = ({
  variables,
  libraryStyles,
}: {
  variables: FigmaMcpVariableDefinition[];
  libraryStyles: readonly FigmaMcpStyleCatalogEntry[];
}): {
  variables: FigmaMcpVariableDefinition[];
  conflicts: TokenConflict[];
} => {
  const colorStylesByValue = new Map<string, string>();
  for (const style of libraryStyles) {
    if (style.color) {
      colorStylesByValue.set(style.color.toLowerCase(), style.name);
    }
  }

  // First pass: compute candidate library name for each variable index.
  const candidates: Array<string | null> = variables.map((variable) => {
    if (variable.kind !== "color" || typeof variable.value !== "string") {
      return null;
    }
    const libraryName = colorStylesByValue.get(variable.value.toLowerCase());
    if (!libraryName || libraryName === variable.name) {
      return null;
    }
    return libraryName;
  });

  const claimantGroups = groupClaimantsByPostRenameMergeKey({
    variables,
    candidates,
  });

  const collidingIndices = new Set<number>();
  const collisionGroups: ClaimantGroup[] = [];
  for (const group of claimantGroups.values()) {
    if (group.indices.length > 1) {
      collisionGroups.push(group);
      for (const index of group.indices) {
        collidingIndices.add(index);
      }
    }
  }

  const nextVariables = variables.map((variable, index) => {
    const libraryName = candidates[index];
    if (libraryName === null || libraryName === undefined) {
      return variable;
    }
    if (collidingIndices.has(index)) {
      // Preserve original name; expose library name as an alias only.
      return {
        ...variable,
        aliases: [...(variable.aliases ?? []), libraryName],
      };
    }
    // Sole claimant for this merge key — rename as before.
    return {
      ...variable,
      aliases: [...(variable.aliases ?? []), variable.name],
      name: libraryName,
    };
  });

  const conflicts: TokenConflict[] = collisionGroups
    .map(({ libraryName, indices }) =>
      buildAliasCollisionConflict({ libraryName, indices, variables }),
    )
    .sort((left, right) => {
      if (
        left.kind !== "library_alias_collision" ||
        right.kind !== "library_alias_collision"
      ) {
        return 0;
      }
      const nameCompare = left.libraryName.localeCompare(right.libraryName);
      if (nameCompare !== 0) {
        return nameCompare;
      }
      const leftMode = left.collidingVariables[0]?.modeName ?? "";
      const rightMode = right.collidingVariables[0]?.modeName ?? "";
      return leftMode.localeCompare(rightMode);
    });

  return { variables: nextVariables, conflicts };
};

/**
 * Merges incoming styles with existing ones. Incoming styles override by name.
 */
const mergeStyleCatalogs = ({
  incoming,
  existing,
}: {
  incoming: readonly FigmaMcpStyleCatalogEntry[];
  existing: readonly FigmaMcpStyleCatalogEntry[];
}): FigmaMcpStyleCatalogEntry[] => {
  const merged = new Map<string, FigmaMcpStyleCatalogEntry>();
  const toStyleKey = (style: FigmaMcpStyleCatalogEntry): string =>
    `${style.name.toLowerCase()}::${style.styleType.toUpperCase()}`;

  for (const style of existing) {
    merged.set(toStyleKey(style), style);
  }
  for (const style of incoming) {
    merged.set(toStyleKey(style), style);
  }

  return [...merged.values()];
};
