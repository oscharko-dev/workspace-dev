import type {
  FigmaMcpCodeConnectMapping,
  FigmaMcpDesignSystemMapping,
  FigmaMcpEnrichmentDiagnostic,
} from "../parity/types.js";
import {
  callMcpTool,
  type McpResolverConfig,
  type McpResolverDiagnostic,
} from "./figma-mcp-resolver.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MappedComponent {
  name: string;
  source: string;
  importPath?: string;
  props?: PropMapping[];
  confidence: "exact" | "suggested" | "heuristic" | "none";
}

export interface PropMapping {
  figmaProp: string;
  reactProp: string;
  transform?: string;
  defaultValue?: string;
}

export interface UnmappedComponent {
  irNodeId: string;
  figmaName: string;
  figmaComponentKey?: string;
  suggestions?: MappedComponent[];
}

export interface ComponentMappingResult {
  codeConnectMappings: FigmaMcpCodeConnectMapping[];
  designSystemMappings: FigmaMcpDesignSystemMapping[];
  unmapped: UnmappedComponent[];
  stats: {
    exact: number;
    designSystem: number;
    suggested: number;
    heuristic: number;
    unmapped: number;
  };
  diagnostics: FigmaMcpEnrichmentDiagnostic[];
}

export interface ComponentMapperConfig {
  fileKey: string;
  nodeId: string;
  mcpConfig: McpResolverConfig;
  libraryKeys?: string[];
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// MCP response shapes
// ---------------------------------------------------------------------------

interface RawCodeConnectEntry {
  codeConnectSrc?: unknown;
  codeConnectName?: unknown;
  label?: unknown;
  propContract?: unknown;
}

interface RawDesignSystemComponent {
  name?: unknown;
  key?: unknown;
  libraryKey?: unknown;
  description?: unknown;
}

// ---------------------------------------------------------------------------
// Name normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes a Figma component name for comparison.
 *
 * `Button/Primary` → `button-primary`
 * `Input / Default` → `input-default`
 * `_Card__Elevated` → `card-elevated`
 */
export const normalizeComponentName = (name: string): string =>
  name
    .replace(/\s+/g, "-")
    .replace(/[/_\\]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

/**
 * Extracts the base component name from a Figma path.
 * `Button/Primary` → `Button`
 * `Form/Input/Default` → `Input`
 */
export const extractBaseComponentName = (figmaName: string): string => {
  const parts = figmaName.split("/").map((part) => part.trim());
  // For paths with variants, the parent is the component, the leaf is the variant
  // For single-segment names, use the name directly
  if (parts.length <= 1) {
    return parts[0] ?? figmaName;
  }
  // "Button/Primary" → "Button", "Form/Input/Default" → "Input" (second to last)
  return parts[parts.length - 2] ?? parts[0] ?? figmaName;
};

/**
 * Extracts variant info from a Figma component path.
 * `Button/Primary` → `{ variant: "Primary" }`
 * `Button` → `undefined`
 */
export const extractVariantFromPath = (
  figmaName: string,
): { variant: string } | undefined => {
  const parts = figmaName.split("/").map((part) => part.trim());
  if (parts.length <= 1) {
    return undefined;
  }
  const variant = parts[parts.length - 1];
  return variant ? { variant } : undefined;
};

// ---------------------------------------------------------------------------
// Prop mapping helpers
// ---------------------------------------------------------------------------

/**
 * Maps Figma component properties to React prop mappings.
 * Handles variant, boolean, text, and instance swap properties.
 */
export const mapFigmaPropsToReact = (
  propContract: Record<string, unknown>,
): PropMapping[] => {
  const mappings: PropMapping[] = [];

  for (const [figmaProp, descriptor] of Object.entries(propContract)) {
    const reactProp = normalizePropName(figmaProp);

    if (isVariantDescriptor(descriptor)) {
      mappings.push({
        figmaProp,
        reactProp,
        transform: "enum",
        ...(typeof descriptor.defaultValue === "string"
          ? { defaultValue: descriptor.defaultValue }
          : {}),
      });
    } else if (isBooleanDescriptor(descriptor)) {
      mappings.push({
        figmaProp,
        reactProp,
        transform: "boolean",
        ...(typeof descriptor.defaultValue === "boolean"
          ? { defaultValue: String(descriptor.defaultValue) }
          : {}),
      });
    } else if (isTextDescriptor(descriptor)) {
      // Text properties map to children or string props
      const isLikelyChildren = /^(label|text|title|content|children)$/i.test(
        figmaProp,
      );
      mappings.push({
        figmaProp,
        reactProp: isLikelyChildren ? "children" : reactProp,
        transform: "text",
      });
    } else if (isInstanceSwapDescriptor(descriptor)) {
      mappings.push({
        figmaProp,
        reactProp,
        transform: "component",
      });
    }
  }

  return mappings;
};

const normalizePropName = (figmaProp: string): string => {
  // Convert Figma prop names to camelCase React props
  // "Has icon" → "hasIcon", "Show label" → "showLabel", "Size" → "size"
  return figmaProp
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join("");
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isVariantDescriptor = (
  descriptor: unknown,
): descriptor is { type: "VARIANT"; defaultValue?: string } =>
  isRecord(descriptor) && descriptor.type === "VARIANT";

const isBooleanDescriptor = (
  descriptor: unknown,
): descriptor is { type: "BOOLEAN"; defaultValue?: boolean } =>
  isRecord(descriptor) && descriptor.type === "BOOLEAN";

const isTextDescriptor = (
  descriptor: unknown,
): descriptor is { type: "TEXT" } =>
  isRecord(descriptor) && descriptor.type === "TEXT";

const isInstanceSwapDescriptor = (
  descriptor: unknown,
): descriptor is { type: "INSTANCE_SWAP" } =>
  isRecord(descriptor) && descriptor.type === "INSTANCE_SWAP";

// ---------------------------------------------------------------------------
// MCP response parsers
// ---------------------------------------------------------------------------

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Parses the raw MCP `get_code_connect_map` response into typed Code Connect
 * mappings.
 *
 * Expected shape: `{ [nodeId]: { codeConnectSrc, codeConnectName, label?, propContract? } }`
 */
export const parseCodeConnectMapResponse = (
  raw: unknown,
): FigmaMcpCodeConnectMapping[] => {
  if (!raw || typeof raw !== "object") {
    return [];
  }

  const mappings: FigmaMcpCodeConnectMapping[] = [];

  // Handle both direct object and wrapped { result: { ... } } forms
  const record = raw as Record<string, unknown>;
  const entries = isRecord(record.result) ? record.result : record;

  for (const [nodeId, value] of Object.entries(entries)) {
    if (!isRecord(value)) {
      continue;
    }
    const entry = value as unknown as RawCodeConnectEntry;

    if (!isNonEmptyString(entry.codeConnectSrc)) {
      continue;
    }
    if (!isNonEmptyString(entry.codeConnectName)) {
      continue;
    }

    const propContract = isRecord(entry.propContract)
      ? entry.propContract
      : undefined;

    mappings.push({
      nodeId,
      componentName: entry.codeConnectName,
      source: entry.codeConnectSrc,
      ...(isNonEmptyString(entry.label) ? { label: entry.label } : {}),
      ...(propContract ? { propContract } : {}),
    });
  }

  return mappings;
};

/**
 * Parses the `search_design_system` response for component matches.
 */
export const parseDesignSystemComponentsResponse = (
  raw: unknown,
): Array<{
  name: string;
  key?: string;
  libraryKey?: string;
}> => {
  if (!raw || typeof raw !== "object") {
    return [];
  }

  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.components)) {
    return [];
  }

  return record.components
    .filter(
      (comp): comp is RawDesignSystemComponent =>
        typeof comp === "object" && comp !== null,
    )
    .filter((comp) => isNonEmptyString(comp.name))
    .map((comp) => ({
      name: comp.name as string,
      ...(isNonEmptyString(comp.key) ? { key: comp.key } : {}),
      ...(isNonEmptyString(comp.libraryKey)
        ? { libraryKey: comp.libraryKey }
        : {}),
    }));
};

// ---------------------------------------------------------------------------
// MCP fetch helpers
// ---------------------------------------------------------------------------

/**
 * Fetches Code Connect mappings from the Figma MCP `get_code_connect_map` tool.
 */
export const fetchCodeConnectMap = async ({
  fileKey,
  nodeId,
  config,
  signal,
}: {
  fileKey: string;
  nodeId: string;
  config: McpResolverConfig;
  signal?: AbortSignal;
}): Promise<FigmaMcpCodeConnectMapping[]> => {
  const diagnostics: McpResolverDiagnostic[] = [];

  const result = await callMcpTool({
    toolName: "get_code_connect_map",
    args: { fileKey, nodeId },
    config,
    ...(signal ? { signal } : {}),
    diagnostics,
  });

  return parseCodeConnectMapResponse(result);
};

/**
 * Searches the design system for components matching a given query.
 */
export const searchDesignSystemComponents = async ({
  fileKey,
  query,
  config,
  libraryKeys,
  signal,
}: {
  fileKey: string;
  query: string;
  config: McpResolverConfig;
  libraryKeys?: string[];
  signal?: AbortSignal;
}): Promise<
  Array<{
    name: string;
    key?: string;
    libraryKey?: string;
  }>
> => {
  const diagnostics: McpResolverDiagnostic[] = [];

  const result = await callMcpTool({
    toolName: "search_design_system",
    args: {
      fileKey,
      query,
      includeComponents: true,
      includeStyles: false,
      includeVariables: false,
      ...(libraryKeys && libraryKeys.length > 0
        ? { includeLibraryKeys: libraryKeys }
        : {}),
    },
    config,
    ...(signal ? { signal } : {}),
    diagnostics,
  });

  return parseDesignSystemComponentsResponse(result);
};

/**
 * Fetches AI-suggested Code Connect mappings for unmapped components.
 */
export const fetchCodeConnectSuggestions = async ({
  fileKey,
  nodeId,
  config,
  signal,
}: {
  fileKey: string;
  nodeId: string;
  config: McpResolverConfig;
  signal?: AbortSignal;
}): Promise<FigmaMcpCodeConnectMapping[]> => {
  const diagnostics: McpResolverDiagnostic[] = [];

  const result = await callMcpTool({
    toolName: "get_code_connect_suggestions",
    args: { fileKey, nodeId, excludeMappingPrompt: true },
    config,
    ...(signal ? { signal } : {}),
    diagnostics,
  });

  // Suggestions come back in a similar shape to Code Connect map entries
  return parseCodeConnectMapResponse(result);
};

// ---------------------------------------------------------------------------
// Heuristic matching helpers
// ---------------------------------------------------------------------------

/**
 * Attempts to find a design system component that matches a Figma component
 * name using name normalization and fuzzy matching.
 */
export const findDesignSystemMatch = ({
  figmaName,
  dsComponents,
}: {
  figmaName: string;
  dsComponents: ReadonlyArray<{
    name: string;
    key?: string;
    libraryKey?: string;
  }>;
}):
  | {
      name: string;
      key?: string;
      libraryKey?: string;
    }
  | undefined => {
  const normalizedFigma = normalizeComponentName(figmaName);
  const baseName = normalizeComponentName(extractBaseComponentName(figmaName));

  // Exact normalized match
  for (const comp of dsComponents) {
    if (normalizeComponentName(comp.name) === normalizedFigma) {
      return comp;
    }
  }

  // Base name match (ignoring variant path)
  for (const comp of dsComponents) {
    if (normalizeComponentName(comp.name) === baseName) {
      return comp;
    }
  }

  // Contains match — design system component name contains the Figma base name
  if (baseName.length >= 3) {
    for (const comp of dsComponents) {
      const normalizedDs = normalizeComponentName(comp.name);
      if (normalizedDs.includes(baseName) || baseName.includes(normalizedDs)) {
        return comp;
      }
    }
  }

  return undefined;
};

// ---------------------------------------------------------------------------
// Main entry point: resolveComponentMappings
// ---------------------------------------------------------------------------

/**
 * Resolves Figma components to codebase component references via multiple
 * strategies:
 *
 * 1. **Code Connect lookup** — explicit MCP mappings (confidence: exact)
 * 2. **Design system search** — library component matching (confidence: heuristic)
 * 3. **AI suggestions** — MCP suggestions, stored but never auto-applied
 *    (confidence: suggested)
 *
 * This is the main orchestrator for Issue #1003.
 */
export const resolveComponentMappings = async (
  mapperConfig: ComponentMapperConfig,
): Promise<ComponentMappingResult> => {
  const { fileKey, nodeId, mcpConfig, libraryKeys, signal } = mapperConfig;
  const diagnostics: FigmaMcpEnrichmentDiagnostic[] = [];
  const codeConnectMappings: FigmaMcpCodeConnectMapping[] = [];
  const designSystemMappings: FigmaMcpDesignSystemMapping[] = [];
  const unmapped: UnmappedComponent[] = [];
  const mappedNodeIds = new Set<string>();

  // ---- Step 1: Code Connect lookup ----
  try {
    const ccMappings = await fetchCodeConnectMap({
      fileKey,
      nodeId,
      config: mcpConfig,
      ...(signal ? { signal } : {}),
    });

    for (const mapping of ccMappings) {
      codeConnectMappings.push(mapping);
      mappedNodeIds.add(mapping.nodeId);
    }

    mcpConfig.onLog?.(
      `Code Connect: ${String(ccMappings.length)} exact mapping(s) resolved`,
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error fetching Code Connect map";
    diagnostics.push({
      code: "W_COMPONENT_MAPPER_CODE_CONNECT_SKIPPED",
      message: `Code Connect lookup failed, proceeding with fallback strategies: ${message}`,
      severity: "warning",
      source: "code_connect",
    });
    mcpConfig.onLog?.(`get_code_connect_map failed: ${message}`);
  }

  // ---- Step 2: Design system search for unmapped component names ----
  // Build search queries from Code Connect mapping names to find additional
  // design system components that may not have direct Code Connect mappings
  let dsComponents: Array<{
    name: string;
    key?: string;
    libraryKey?: string;
  }> = [];

  try {
    // Search for common UI component patterns
    const searchQuery = buildComponentSearchQuery({ codeConnectMappings });
    if (searchQuery.length > 0) {
      dsComponents = await searchDesignSystemComponents({
        fileKey,
        query: searchQuery,
        config: mcpConfig,
        ...(libraryKeys ? { libraryKeys } : {}),
        ...(signal ? { signal } : {}),
      });

      // For each design system component that isn't already in Code Connect,
      // create a design system mapping
      for (const dsComp of dsComponents) {
        // Check if already mapped by Code Connect
        const alreadyMapped = codeConnectMappings.some(
          (cc) =>
            normalizeComponentName(cc.componentName) ===
            normalizeComponentName(dsComp.name),
        );
        if (!alreadyMapped) {
          designSystemMappings.push({
            nodeId,
            componentName: dsComp.name,
            source: dsComp.key ?? dsComp.name,
            ...(dsComp.libraryKey ? { libraryKey: dsComp.libraryKey } : {}),
          });
        }
      }

      mcpConfig.onLog?.(
        `Design system: ${String(dsComponents.length)} component(s) found, ${String(designSystemMappings.length)} new mapping(s)`,
      );
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error searching design system";
    diagnostics.push({
      code: "W_COMPONENT_MAPPER_DESIGN_SYSTEM_SKIPPED",
      message: `Design system search failed, proceeding without: ${message}`,
      severity: "warning",
      source: "design_system",
    });
    mcpConfig.onLog?.(`search_design_system (components) failed: ${message}`);
  }

  // ---- Step 3: AI suggestions for remaining unmapped nodes ----
  try {
    const suggestions = await fetchCodeConnectSuggestions({
      fileKey,
      nodeId,
      config: mcpConfig,
      ...(signal ? { signal } : {}),
    });

    // Store AI suggestions but never auto-apply them
    for (const suggestion of suggestions) {
      if (mappedNodeIds.has(suggestion.nodeId)) {
        continue;
      }
      // Record as unmapped with suggestions — user must confirm
      unmapped.push({
        irNodeId: suggestion.nodeId,
        figmaName: suggestion.componentName,
        suggestions: [
          {
            name: suggestion.componentName,
            source: suggestion.source,
            confidence: "suggested",
            ...(suggestion.propContract
              ? { props: mapFigmaPropsToReact(suggestion.propContract) }
              : {}),
          },
        ],
      });
    }

    if (suggestions.length > 0) {
      mcpConfig.onLog?.(
        `AI suggestions: ${String(suggestions.length)} suggestion(s) stored for user confirmation`,
      );
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error fetching suggestions";
    diagnostics.push({
      code: "W_COMPONENT_MAPPER_SUGGESTIONS_SKIPPED",
      message: `AI suggestion fetch failed (non-critical): ${message}`,
      severity: "info",
      source: "code_connect",
    });
    mcpConfig.onLog?.(
      `get_code_connect_suggestions failed (non-critical): ${message}`,
    );
  }

  // ---- Step 4: Enrich Code Connect mappings with prop mappings ----
  for (const mapping of codeConnectMappings) {
    if (mapping.propContract && Object.keys(mapping.propContract).length > 0) {
      // propContract is already stored on the mapping; downstream code
      // can use mapFigmaPropsToReact() to convert it to PropMapping[]
      mcpConfig.onLog?.(
        `Props: ${mapping.componentName} has ${String(Object.keys(mapping.propContract).length)} prop(s)`,
      );
    }
  }

  // ---- Build stats ----
  const stats = {
    exact: codeConnectMappings.length,
    designSystem: designSystemMappings.length,
    suggested: unmapped.filter((entry) => (entry.suggestions?.length ?? 0) > 0)
      .length,
    heuristic: 0,
    unmapped: unmapped.filter((entry) => (entry.suggestions?.length ?? 0) === 0)
      .length,
  };

  if (codeConnectMappings.length > 0 || designSystemMappings.length > 0) {
    diagnostics.push({
      code: "I_COMPONENT_MAPPER_RESOLVED",
      message: `Component mapping resolved: ${String(stats.exact)} exact, ${String(stats.designSystem)} design system, ${String(stats.suggested)} suggested, ${String(stats.unmapped)} unmapped`,
      severity: "info",
      source: "code_connect",
    });
  }

  return {
    codeConnectMappings,
    designSystemMappings,
    unmapped,
    stats,
    diagnostics,
  };
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds a search query for design system components based on the names
 * found in Code Connect mappings and common UI patterns.
 */
const buildComponentSearchQuery = ({
  codeConnectMappings,
}: {
  codeConnectMappings: readonly FigmaMcpCodeConnectMapping[];
}): string => {
  const fragments: string[] = [];
  const pushFragment = (value: string): void => {
    const normalized = value.trim().toLowerCase();
    if (normalized.length > 0 && !fragments.includes(normalized)) {
      fragments.push(normalized);
    }
  };

  // Extract meaningful fragments from Code Connect component names
  for (const mapping of codeConnectMappings) {
    const base = extractBaseComponentName(mapping.componentName);
    pushFragment(base);
    if (fragments.length >= 6) {
      break;
    }
  }

  // If no Code Connect mappings, use common UI component search terms
  if (fragments.length === 0) {
    return "button input card";
  }

  return fragments.join(" ");
};
