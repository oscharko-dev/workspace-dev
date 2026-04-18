import type { Dirent } from "node:fs";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  FigmaMcpCodeConnectMapping,
  FigmaMcpDesignSystemMapping,
  FigmaMcpEnrichmentDiagnostic,
} from "../parity/types.js";
import type {
  DesignIR,
  ScreenElementIR,
  ElementCodeConnectMappingIR,
} from "../parity/types-ir.js";
import {
  callMcpTool,
  type McpResolverConfig,
  type McpResolverDiagnostic,
} from "./figma-mcp-resolver.js";
import { pathExists } from "./fs-helpers.js";
import type { FigmaFileResponse } from "./types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MappedComponent {
  name: string;
  source: string;
  importPath?: string;
  props?: PropMapping[];
  confidence: "exact" | "design_system" | "suggested" | "heuristic" | "none";
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
  mappings: Map<string, MappedComponent>;
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
  ir?: DesignIR;
  mcpConfig: McpResolverConfig;
  libraryKeys?: string[];
  rawFile?: FigmaFileResponse;
  workspaceRoot?: string;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Persistence types
// ---------------------------------------------------------------------------

interface PersistedMappingEntry {
  name: string;
  source: string;
  importPath?: string;
  confidence: "exact";
  figmaComponentKey?: string;
  nodeId?: string;
}

const PERSISTENCE_FILENAME = "figma-component-map.json";

// ---------------------------------------------------------------------------
// MCP response shapes
// ---------------------------------------------------------------------------

interface RawCodeConnectEntry {
  source?: unknown;
  componentName?: unknown;
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

interface RawCodeConnectSuggestionEntry {
  mainComponentNodeId?: unknown;
  nodeId?: unknown;
  figmaName?: unknown;
  mainComponentName?: unknown;
  name?: unknown;
  componentName?: unknown;
  codeConnectName?: unknown;
  source?: unknown;
  codeConnectSrc?: unknown;
}

interface RawFigmaNode {
  id?: unknown;
  type?: unknown;
  name?: unknown;
  componentId?: unknown;
  componentSetId?: unknown;
  children?: unknown;
}

interface ComponentMappingCandidate {
  nodeId: string;
  figmaName: string;
  figmaComponentKey?: string;
  persistenceKey: string;
  legacyPersistenceKeys: string[];
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
  if (parts.length <= 1) {
    return parts[0] ?? figmaName;
  }
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

const normalizePropName = (figmaProp: string): string =>
  figmaProp
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join("");

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

const asNodeArray = (value: unknown): RawFigmaNode[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is RawFigmaNode => isRecord(entry))
    : [];

const resolveCodeConnectSource = (
  entry: RawCodeConnectEntry,
): string | undefined =>
  isNonEmptyString(entry.source)
    ? entry.source
    : isNonEmptyString(entry.codeConnectSrc)
      ? entry.codeConnectSrc
      : undefined;

const resolveCodeConnectName = (
  entry: RawCodeConnectEntry,
): string | undefined =>
  isNonEmptyString(entry.componentName)
    ? entry.componentName
    : isNonEmptyString(entry.codeConnectName)
      ? entry.codeConnectName
      : undefined;

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
  const record = raw as Record<string, unknown>;
  const entries = isRecord(record.result) ? record.result : record;

  for (const [nodeId, value] of Object.entries(entries)) {
    if (!isRecord(value)) {
      continue;
    }
    const entry = value as unknown as RawCodeConnectEntry;
    const source = resolveCodeConnectSource(entry);
    const componentName = resolveCodeConnectName(entry);

    if (!source) {
      continue;
    }
    if (!componentName) {
      continue;
    }

    const propContract = isRecord(entry.propContract)
      ? entry.propContract
      : undefined;

    mappings.push({
      nodeId,
      componentName,
      source,
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

export const parseCodeConnectSuggestionsResponse = (
  raw: unknown,
): Array<{
  nodeId?: string;
  mainComponentNodeId?: string;
  figmaName?: string;
  componentName?: string;
  source?: string;
}> => {
  if (!raw || typeof raw !== "object") {
    return [];
  }

  const record = raw as Record<string, unknown>;
  const payload = isRecord(record.result) ? record.result : record;

  if (typeof payload === "string") {
    return [];
  }

  const parseEntry = (
    entry: RawCodeConnectSuggestionEntry,
    fallbackNodeId?: string,
  ):
    | {
        nodeId?: string;
        mainComponentNodeId?: string;
        figmaName?: string;
        componentName?: string;
        source?: string;
      }
    | undefined => {
    const figmaName = isNonEmptyString(entry.figmaName)
      ? entry.figmaName
      : isNonEmptyString(entry.mainComponentName)
        ? entry.mainComponentName
        : isNonEmptyString(entry.name)
          ? entry.name
          : undefined;
    const componentName = isNonEmptyString(entry.componentName)
      ? entry.componentName
      : isNonEmptyString(entry.codeConnectName)
        ? entry.codeConnectName
        : figmaName;
    const source = isNonEmptyString(entry.source)
      ? entry.source
      : isNonEmptyString(entry.codeConnectSrc)
        ? entry.codeConnectSrc
        : isNonEmptyString(entry.mainComponentNodeId)
          ? `figma-node:${entry.mainComponentNodeId}`
          : isNonEmptyString(entry.nodeId)
            ? `figma-node:${entry.nodeId}`
            : fallbackNodeId
              ? `figma-node:${fallbackNodeId}`
              : undefined;
    const nodeId = isNonEmptyString(entry.nodeId)
      ? entry.nodeId
      : fallbackNodeId;
    const mainComponentNodeId = isNonEmptyString(entry.mainComponentNodeId)
      ? entry.mainComponentNodeId
      : undefined;
    if (!componentName && !mainComponentNodeId && !nodeId) {
      if (!figmaName) {
        return undefined;
      }
    }
    if (!componentName && !mainComponentNodeId && !nodeId && !figmaName) {
      return undefined;
    }
    return {
      ...(nodeId ? { nodeId } : {}),
      ...(mainComponentNodeId ? { mainComponentNodeId } : {}),
      ...(figmaName ? { figmaName } : {}),
      ...(componentName ? { componentName } : {}),
      ...(source ? { source } : {}),
    };
  };

  if (Array.isArray(payload)) {
    return payload
      .filter((entry): entry is RawCodeConnectSuggestionEntry =>
        isRecord(entry),
      )
      .map((entry) => parseEntry(entry))
      .filter(
        (
          entry,
        ): entry is {
          nodeId?: string;
          mainComponentNodeId?: string;
          figmaName?: string;
          componentName?: string;
          source?: string;
        } => Boolean(entry),
      );
  }

  const parsed: Array<{
    nodeId?: string;
    mainComponentNodeId?: string;
    figmaName?: string;
    componentName?: string;
    source?: string;
  }> = [];
  for (const [fallbackNodeId, value] of Object.entries(payload)) {
    if (!isRecord(value)) {
      continue;
    }
    const entry = parseEntry(
      value as unknown as RawCodeConnectSuggestionEntry,
      fallbackNodeId,
    );
    if (entry) {
      parsed.push(entry);
    }
  }
  return parsed;
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
}): Promise<
  Array<{
    nodeId?: string;
    mainComponentNodeId?: string;
    componentName?: string;
    source?: string;
  }>
> => {
  const diagnostics: McpResolverDiagnostic[] = [];

  const result = await callMcpTool({
    toolName: "get_code_connect_suggestions",
    args: { fileKey, nodeId, excludeMappingPrompt: true },
    config,
    ...(signal ? { signal } : {}),
    diagnostics,
  });

  return parseCodeConnectSuggestionsResponse(result);
};

const resolvePersistenceKey = ({
  fileKey,
  nodeId,
  figmaComponentKey,
}: {
  fileKey: string;
  nodeId: string;
  figmaComponentKey?: string;
}): string => {
  if (figmaComponentKey) {
    return `${fileKey}::component::${figmaComponentKey}`;
  }
  return `${fileKey}::node::${nodeId}`;
};

const buildLegacyPersistenceKey = (figmaName: string): string | undefined => {
  const normalizedName = normalizeComponentName(figmaName);
  return normalizedName.length > 0 ? normalizedName : undefined;
};

const buildScopedLegacyPersistenceKey = ({
  fileKey,
  figmaName,
}: {
  fileKey: string;
  figmaName: string;
}): string | undefined => {
  const normalizedName = normalizeComponentName(figmaName);
  return normalizedName.length > 0
    ? `${fileKey}::name::${normalizedName}`
    : undefined;
};

const getLooseStringField = (
  value: unknown,
  fieldNames: readonly string[],
): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  for (const fieldName of fieldNames) {
    const candidate = value[fieldName];
    if (isNonEmptyString(candidate)) {
      return candidate;
    }
  }
  return undefined;
};

const isComponentLikeNodeType = (nodeType: string): boolean => {
  const normalizedType = nodeType.toUpperCase();
  return (
    normalizedType === "COMPONENT" ||
    normalizedType === "INSTANCE" ||
    normalizedType === "COMPONENT_SET"
  );
};

const resolveComponentKeyFromNode = ({
  node,
  rawFile,
}: {
  node: RawFigmaNode;
  rawFile?: FigmaFileResponse;
}): string | undefined => {
  if (!rawFile) {
    return undefined;
  }
  const nodeId = isNonEmptyString(node.id) ? node.id : undefined;
  const componentId = isNonEmptyString(node.componentId)
    ? node.componentId
    : undefined;
  const componentSetId = isNonEmptyString(node.componentSetId)
    ? node.componentSetId
    : undefined;

  const componentCatalog = rawFile.components ?? {};
  const componentSetCatalog = rawFile.componentSets ?? {};

  const componentEntry =
    (componentId ? componentCatalog[componentId] : undefined) ??
    (nodeId ? componentCatalog[nodeId] : undefined);
  if (
    componentEntry &&
    typeof componentEntry === "object" &&
    isNonEmptyString(componentEntry.key)
  ) {
    return componentEntry.key;
  }

  const componentSetEntry =
    (componentSetId ? componentSetCatalog[componentSetId] : undefined) ??
    (nodeId ? componentSetCatalog[nodeId] : undefined);
  if (
    componentSetEntry &&
    typeof componentSetEntry === "object" &&
    isNonEmptyString(componentSetEntry.key)
  ) {
    return componentSetEntry.key;
  }

  return undefined;
};

const findSelectionRoot = ({
  root,
  nodeId,
}: {
  root?: RawFigmaNode;
  nodeId: string;
}): RawFigmaNode | undefined => {
  if (!root) {
    return undefined;
  }
  const queue: RawFigmaNode[] = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    if (current.id === nodeId) {
      return current;
    }
    queue.push(...asNodeArray(current.children));
  }
  return root;
};

const collectComponentCandidates = ({
  fileKey,
  ir,
  nodeId,
  rawFile,
}: {
  fileKey: string;
  ir?: DesignIR;
  nodeId: string;
  rawFile?: FigmaFileResponse;
}): ComponentMappingCandidate[] => {
  const candidates: ComponentMappingCandidate[] = [];
  const seenNodeIds = new Set<string>();
  const pushCandidate = ({
    candidateNodeId,
    figmaName,
    figmaComponentKey,
  }: {
    candidateNodeId: string;
    figmaName: string;
    figmaComponentKey?: string;
  }): void => {
    if (seenNodeIds.has(candidateNodeId)) {
      return;
    }
    seenNodeIds.add(candidateNodeId);
    candidates.push({
      nodeId: candidateNodeId,
      figmaName,
      ...(figmaComponentKey ? { figmaComponentKey } : {}),
      persistenceKey: resolvePersistenceKey({
        fileKey,
        nodeId: candidateNodeId,
        ...(figmaComponentKey ? { figmaComponentKey } : {}),
      }),
      legacyPersistenceKeys: [
        buildScopedLegacyPersistenceKey({ fileKey, figmaName }),
        buildLegacyPersistenceKey(figmaName),
      ].filter((key): key is string => Boolean(key)),
    });
  };

  if (ir) {
    const walkNodes = (nodes: readonly ScreenElementIR[]): void => {
      for (const node of nodes) {
        if (isComponentLikeNodeType(node.nodeType)) {
          const figmaComponentKey = getLooseStringField(node, [
            "figmaComponentKey",
            "componentKey",
            "componentId",
            "mainComponentNodeId",
          ]);
          pushCandidate({
            candidateNodeId: node.id,
            figmaName: node.name,
            ...(figmaComponentKey ? { figmaComponentKey } : {}),
          });
        }
        if (node.children) {
          walkNodes(node.children);
        }
      }
    };

    for (const screen of ir.screens) {
      walkNodes(screen.children);
    }
  }

  const root = isRecord(rawFile?.document)
    ? (rawFile.document as RawFigmaNode)
    : undefined;
  const selectionRoot = root ? findSelectionRoot({ root, nodeId }) : undefined;
  if (!selectionRoot) {
    return candidates;
  }

  const queue: RawFigmaNode[] = [selectionRoot];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    queue.push(...asNodeArray(current.children));

    if (!isNonEmptyString(current.id) || !isNonEmptyString(current.name)) {
      continue;
    }

    const nodeType = isNonEmptyString(current.type) ? current.type : "";
    if (!isComponentLikeNodeType(nodeType)) {
      continue;
    }

    const figmaComponentKey = rawFile
      ? resolveComponentKeyFromNode({
          node: current,
          rawFile,
        })
      : resolveComponentKeyFromNode({
          node: current,
        });
    pushCandidate({
      candidateNodeId: current.id,
      figmaName: current.name,
      ...(figmaComponentKey ? { figmaComponentKey } : {}),
    });
  }

  return candidates;
};

const isLikelyCodeReference = (value: string): boolean =>
  /[/.@]/.test(value) || /\.(?:[mc]?[jt]sx?)$/i.test(value);

// ---------------------------------------------------------------------------
// Heuristic matching — workspace file scanning
// ---------------------------------------------------------------------------

const COMPONENT_DECLARATION_PATTERN =
  /(?:export\s+(?:default\s+)?(?:function|const|class)\s+|export\s*\{\s*)(\w+)/g;

/**
 * Scans workspace files (tsx/jsx) for component declarations and returns
 * a map of normalized component name → file path.
 */
export const scanWorkspaceComponents = async ({
  workspaceRoot,
}: {
  workspaceRoot: string;
}): Promise<Map<string, { name: string; filePath: string }>> => {
  const componentMap = new Map<string, { name: string; filePath: string }>();

  const scanDir = async (dir: string, depth: number): Promise<void> => {
    if (depth > 5) return; // avoid deep recursion
    let dirEntries: Dirent[];
    try {
      dirEntries = await readdir(dir, {
        withFileTypes: true,
        encoding: "utf8",
      });
    } catch {
      return;
    }
    for (const entry of dirEntries) {
      const entryName = entry.name;
      const fullPath = path.join(dir, entryName);
      if (entry.isDirectory()) {
        // Skip node_modules, .git, dist, build, etc.
        if (
          /^(node_modules|\.git|dist|build|\.next|\.cache)$/.test(entryName)
        ) {
          continue;
        }
        await scanDir(fullPath, depth + 1);
      } else if (/\.(tsx|jsx)$/.test(entryName)) {
        try {
          const content = await readFile(fullPath, "utf8");
          // Only scan the first 2000 chars for performance
          const head = content.slice(0, 2000);
          let match: RegExpExecArray | null;
          COMPONENT_DECLARATION_PATTERN.lastIndex = 0;
          while ((match = COMPONENT_DECLARATION_PATTERN.exec(head)) !== null) {
            const name = match[1];
            if (name && /^[A-Z]/.test(name)) {
              const normalized = normalizeComponentName(name);
              if (!componentMap.has(normalized)) {
                componentMap.set(normalized, {
                  name,
                  filePath: path.relative(workspaceRoot, fullPath),
                });
              }
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  };

  // Scan common source directories
  for (const srcDir of ["src", "components", "lib", "app"]) {
    const candidatePath = path.join(workspaceRoot, srcDir);
    if (await pathExists(candidatePath)) {
      await scanDir(candidatePath, 0);
    }
  }

  return componentMap;
};

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

/**
 * Attempts heuristic matching of a Figma component name against
 * workspace component declarations.
 */
export const findHeuristicMatch = ({
  figmaName,
  workspaceComponents,
}: {
  figmaName: string;
  workspaceComponents: ReadonlyMap<string, { name: string; filePath: string }>;
}): MappedComponent | undefined => {
  const baseName = extractBaseComponentName(figmaName);
  const normalizedBase = normalizeComponentName(baseName);

  // Direct match by normalized base name
  const directMatch = workspaceComponents.get(normalizedBase);
  if (directMatch) {
    return {
      name: directMatch.name,
      source: directMatch.filePath,
      confidence: "heuristic",
    };
  }

  // Try the full normalized name
  const fullNormalized = normalizeComponentName(figmaName);
  const fullMatch = workspaceComponents.get(fullNormalized);
  if (fullMatch) {
    return {
      name: fullMatch.name,
      source: fullMatch.filePath,
      confidence: "heuristic",
    };
  }

  // Substring match for sufficiently long names
  if (normalizedBase.length >= 4) {
    for (const [key, entry] of workspaceComponents) {
      if (key.includes(normalizedBase) || normalizedBase.includes(key)) {
        return {
          name: entry.name,
          source: entry.filePath,
          confidence: "heuristic",
        };
      }
    }
  }

  return undefined;
};

// ---------------------------------------------------------------------------
// COMPONENT_SET variant consolidation
// ---------------------------------------------------------------------------

/**
 * Consolidates COMPONENT_SET nodes with their variant children into a single
 * component mapping. Multiple variant instances (Button/Primary,
 * Button/Secondary) map to one React component with variant props.
 */
export const consolidateComponentSetVariants = ({
  irNodes,
}: {
  irNodes: readonly ScreenElementIR[];
}): Map<string, { baseName: string; variants: string[] }> => {
  const componentSets = new Map<
    string,
    { baseName: string; variants: string[] }
  >();

  const walkNodes = (nodes: readonly ScreenElementIR[]): void => {
    for (const node of nodes) {
      if (
        node.nodeType === "COMPONENT_SET" ||
        node.nodeType === "component_set"
      ) {
        const baseName = extractBaseComponentName(node.name);
        const normalizedKey = normalizeComponentName(baseName);
        const existing = componentSets.get(normalizedKey);
        if (existing) {
          // Collect variants from children
          if (node.children) {
            for (const child of node.children) {
              const variantInfo = extractVariantFromPath(child.name);
              if (
                variantInfo &&
                !existing.variants.includes(variantInfo.variant)
              ) {
                existing.variants.push(variantInfo.variant);
              }
            }
          }
        } else {
          const variants: string[] = [];
          if (node.children) {
            for (const child of node.children) {
              const variantInfo = extractVariantFromPath(child.name);
              if (variantInfo) {
                variants.push(variantInfo.variant);
              }
            }
          }
          componentSets.set(normalizedKey, { baseName, variants });
        }
      }
      if (node.children) {
        walkNodes(node.children);
      }
    }
  };

  walkNodes(irNodes);
  return componentSets;
};

// ---------------------------------------------------------------------------
// Persistence: load / save / validate
// ---------------------------------------------------------------------------

const getPersistencePath = (workspaceRoot: string): string =>
  path.join(workspaceRoot, ".workspace-dev", PERSISTENCE_FILENAME);

const isPersistedMappingConfidence = (
  confidence: unknown,
): confidence is "exact" => confidence === "exact";

/**
 * Loads persisted component mappings from the workspace config file.
 * Validates that referenced source files still exist (stale mapping check).
 */
export const loadPersistedMappings = async ({
  workspaceRoot,
  fileKey,
}: {
  workspaceRoot: string;
  fileKey?: string;
}): Promise<Map<string, MappedComponent>> => {
  const filePath = getPersistencePath(workspaceRoot);
  const result = new Map<string, MappedComponent>();

  if (!(await pathExists(filePath))) {
    return result;
  }

  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return result;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return result;
  }

  if (!isRecord(parsed)) {
    return result;
  }

  const entries = isRecord(parsed.entries) ? parsed.entries : parsed;

  for (const [figmaKey, value] of Object.entries(entries)) {
    if (!isRecord(value)) continue;
    if (!isNonEmptyString(value.name)) continue;
    if (!isNonEmptyString(value.source)) continue;
    if (fileKey && !figmaKey.startsWith(`${fileKey}::`)) {
      continue;
    }

    const confidence = value.confidence;
    if (!isPersistedMappingConfidence(confidence)) {
      continue;
    }

    // Stale mapping check: validate the source file still exists
    const sourcePath = path.resolve(workspaceRoot, value.source);
    if (!(await pathExists(sourcePath))) {
      continue; // Skip stale mappings
    }

    result.set(figmaKey, {
      name: value.name,
      source: value.source,
      confidence,
      ...(isNonEmptyString(value.importPath)
        ? { importPath: value.importPath }
        : {}),
    });
  }

  return result;
};

/**
 * Saves approved component mappings to the workspace config file.
 */
export const savePersistedMappings = async ({
  workspaceRoot,
  mappings,
}: {
  workspaceRoot: string;
  mappings: ReadonlyMap<string, MappedComponent>;
}): Promise<void> => {
  const filePath = getPersistencePath(workspaceRoot);
  await mkdir(path.dirname(filePath), { recursive: true });

  const existingMappings = await loadPersistedMappings({ workspaceRoot });
  const entries: Record<string, PersistedMappingEntry> = {};
  for (const [figmaKey, mapping] of existingMappings) {
    if (!isPersistedMappingConfidence(mapping.confidence)) {
      continue;
    }
    entries[figmaKey] = {
      name: mapping.name,
      source: mapping.source,
      confidence: mapping.confidence,
      ...(mapping.importPath ? { importPath: mapping.importPath } : {}),
    };
  }
  for (const [figmaKey, mapping] of mappings) {
    if (!isPersistedMappingConfidence(mapping.confidence)) {
      continue;
    }
    entries[figmaKey] = {
      name: mapping.name,
      source: mapping.source,
      confidence: mapping.confidence,
      ...(mapping.importPath ? { importPath: mapping.importPath } : {}),
    };
  }
  await writeFile(filePath, JSON.stringify(entries, null, 2) + "\n", "utf8");
};

// ---------------------------------------------------------------------------
// IR enrichment: walk IR tree and annotate nodes
// ---------------------------------------------------------------------------

/**
 * Walks the DesignIR tree and annotates component/instance nodes with
 * Code Connect mappings. Each node is resolved independently, including
 * nested instances.
 */
export const annotateIrWithMappings = ({
  ir,
  codeConnectMappings,
  designSystemMappings,
  heuristicMappings,
  componentSets,
}: {
  ir: DesignIR;
  codeConnectMappings: readonly FigmaMcpCodeConnectMapping[];
  designSystemMappings: readonly FigmaMcpDesignSystemMapping[];
  heuristicMappings: ReadonlyMap<string, MappedComponent>;
  componentSets: ReadonlyMap<string, { baseName: string; variants: string[] }>;
}): { annotated: number } => {
  let annotated = 0;

  // Build lookup maps
  const ccByNodeId = new Map<string, FigmaMcpCodeConnectMapping>();
  for (const mapping of codeConnectMappings) {
    ccByNodeId.set(mapping.nodeId, mapping);
  }

  const dsByNodeId = new Map<string, FigmaMcpDesignSystemMapping>();
  for (const mapping of designSystemMappings) {
    dsByNodeId.set(mapping.nodeId, mapping);
  }

  const annotateNode = (node: ScreenElementIR): void => {
    // Only annotate component/instance nodes
    const isComponentNode =
      node.nodeType === "COMPONENT" ||
      node.nodeType === "INSTANCE" ||
      node.nodeType === "COMPONENT_SET" ||
      node.nodeType === "component" ||
      node.nodeType === "instance" ||
      node.nodeType === "component_set";

    if (isComponentNode && !node.codeConnect) {
      // Step 1: Check Code Connect by node ID (exact match)
      const ccById = ccByNodeId.get(node.id);
      if (ccById) {
        const mapping: ElementCodeConnectMappingIR = {
          origin: "code_connect",
          componentName: ccById.componentName,
          source: ccById.source,
          ...(ccById.label ? { label: ccById.label } : {}),
          ...(ccById.propContract ? { propContract: ccById.propContract } : {}),
        };
        (node as { codeConnect?: ElementCodeConnectMappingIR }).codeConnect =
          mapping;
        annotated++;
      } else {
        const normalizedName = normalizeComponentName(node.name);
        const baseName = normalizeComponentName(
          extractBaseComponentName(node.name),
        );

        // For COMPONENT_SET variants, resolve to the base component
        const setInfo = componentSets.get(baseName);
        const lookupName = setInfo
          ? normalizeComponentName(setInfo.baseName)
          : normalizedName;

        const heuristicByNodeId = heuristicMappings.get(node.id);
        if (heuristicByNodeId) {
          const mapping: ElementCodeConnectMappingIR = {
            origin: "code_connect",
            componentName: heuristicByNodeId.name,
            source: heuristicByNodeId.source,
          };
          (node as { codeConnect?: ElementCodeConnectMappingIR }).codeConnect =
            mapping;
          annotated++;
        } else {
          // Step 2: Check design system by name, but only apply directly when
          // the "source" looks like an actual code reference rather than a
          // design-system component key.
          const dsMatch = dsByNodeId.get(node.id);
          if (dsMatch && isLikelyCodeReference(dsMatch.source)) {
            const mapping: ElementCodeConnectMappingIR = {
              origin: "design_system",
              componentName: dsMatch.componentName,
              source: dsMatch.source,
              ...(dsMatch.label ? { label: dsMatch.label } : {}),
            };
            (
              node as { codeConnect?: ElementCodeConnectMappingIR }
            ).codeConnect = mapping;
            annotated++;
          } else {
            // Step 3: Check heuristic workspace match
            const heuristicMatch =
              heuristicMappings.get(lookupName) ??
              heuristicMappings.get(baseName);
            if (heuristicMatch) {
              const mapping: ElementCodeConnectMappingIR = {
                origin: "code_connect",
                componentName: heuristicMatch.name,
                source: heuristicMatch.source,
              };
              (
                node as { codeConnect?: ElementCodeConnectMappingIR }
              ).codeConnect = mapping;
              annotated++;
            }
          }
        }
      }
    }

    // Recurse into children — resolve nested instances independently
    if (node.children) {
      for (const child of node.children) {
        annotateNode(child);
      }
    }
  };

  for (const screen of ir.screens) {
    for (const child of screen.children) {
      annotateNode(child);
    }
  }

  return { annotated };
};

// ---------------------------------------------------------------------------
// Main entry point: resolveComponentMappings
// ---------------------------------------------------------------------------

/**
 * Resolves Figma components to codebase component references via multiple
 * strategies:
 *
 * 1. **Code Connect lookup** — explicit MCP mappings (confidence: exact)
 * 2. **Design system search** — library component matching
 *    (confidence: design_system; may be upgraded to heuristic by Step 4)
 * 3. **AI suggestions** — MCP suggestions, stored but never auto-applied
 *    (confidence: suggested)
 * 4. **Heuristic matching** — name-based matching against workspace components
 *    (confidence: heuristic)
 *
 * This is the main orchestrator for Issue #1003.
 */
export const resolveComponentMappings = async (
  mapperConfig: ComponentMapperConfig,
): Promise<ComponentMappingResult> => {
  const {
    fileKey,
    nodeId,
    ir,
    mcpConfig,
    libraryKeys,
    workspaceRoot,
    signal,
    rawFile,
  } = mapperConfig;
  const diagnostics: FigmaMcpEnrichmentDiagnostic[] = [];
  const codeConnectMappings: FigmaMcpCodeConnectMapping[] = [];
  const designSystemMappings: FigmaMcpDesignSystemMapping[] = [];
  const unmapped: UnmappedComponent[] = [];
  const candidates = collectComponentCandidates({
    fileKey,
    ...(ir ? { ir } : {}),
    nodeId,
    ...(rawFile ? { rawFile } : {}),
  });
  const mappedNodeIds = new Set<string>();
  const resultMappings = new Map<string, MappedComponent>();
  const designSystemMatchesByNodeId = new Map<
    string,
    { name: string; key?: string; libraryKey?: string }
  >();
  const suggestionMatchesByNodeId = new Map<string, MappedComponent[]>();
  const suggestionMatchesByName = new Map<string, MappedComponent[]>();

  // ---- Step 0: Load persisted mappings ----
  let persistedMappings = new Map<string, MappedComponent>();
  if (workspaceRoot) {
    try {
      persistedMappings = await loadPersistedMappings({
        workspaceRoot,
        fileKey,
      });
      if (persistedMappings.size > 0) {
        mcpConfig.onLog?.(
          `Loaded ${String(persistedMappings.size)} persisted mapping(s)`,
        );
        for (const candidate of candidates) {
          const persisted = findPersistedMappingForCandidate({
            candidate,
            persistedMappings,
          });
          if (!persisted) {
            continue;
          }
          resultMappings.set(candidate.nodeId, persisted);
          mappedNodeIds.add(candidate.nodeId);
        }
      }
    } catch {
      // Non-critical — proceed without persisted mappings
    }
  }

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
      resultMappings.set(mapping.nodeId, {
        name: mapping.componentName,
        source: mapping.source,
        confidence: "exact",
        ...(mapping.propContract
          ? { props: mapFigmaPropsToReact(mapping.propContract) }
          : {}),
      });
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

  // ---- Step 2: Design system search ----
  try {
    const searchCache = new Map<
      string,
      Array<{ name: string; key?: string; libraryKey?: string }>
    >();
    const unresolvedCandidates = candidates.filter(
      (candidate) => !mappedNodeIds.has(candidate.nodeId),
    );
    for (const candidate of unresolvedCandidates) {
      const queries = [
        candidate.figmaName,
        extractBaseComponentName(candidate.figmaName),
      ].filter(
        (value, index, array) =>
          value.length > 0 && array.indexOf(value) === index,
      );

      let match:
        | {
            name: string;
            key?: string;
            libraryKey?: string;
          }
        | undefined;
      for (const query of queries) {
        let dsComponents = searchCache.get(query);
        if (!dsComponents) {
          dsComponents = await searchDesignSystemComponents({
            fileKey,
            query,
            config: mcpConfig,
            ...(libraryKeys ? { libraryKeys } : {}),
            ...(signal ? { signal } : {}),
          });
          searchCache.set(query, dsComponents);
        }
        match = findDesignSystemMatch({
          figmaName: candidate.figmaName,
          dsComponents,
        });
        if (match) {
          break;
        }
      }

      if (!match) {
        continue;
      }

      designSystemMatchesByNodeId.set(candidate.nodeId, match);
      designSystemMappings.push({
        nodeId: candidate.nodeId,
        componentName: match.name,
        source: match.key ?? match.name,
        ...(match.libraryKey ? { libraryKey: match.libraryKey } : {}),
      });
      resultMappings.set(candidate.nodeId, {
        name: match.name,
        source: match.key ?? match.name,
        confidence: "design_system",
      });
      mappedNodeIds.add(candidate.nodeId);
    }

    if (designSystemMappings.length > 0) {
      mcpConfig.onLog?.(
        `Design system: ${String(designSystemMappings.length)} candidate mapping(s) found`,
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

  // ---- Step 3: AI suggestions ----
  try {
    const suggestions = await fetchCodeConnectSuggestions({
      fileKey,
      nodeId,
      config: mcpConfig,
      ...(signal ? { signal } : {}),
    });

    for (const suggestion of suggestions) {
      const matchedCandidate =
        findSuggestionCandidate({
          suggestion,
          candidates,
        }) ??
        (suggestion.nodeId
          ? candidates.find(
              (candidate) => candidate.nodeId === suggestion.nodeId,
            )
          : undefined);
      if (!matchedCandidate) {
        continue;
      }

      const byNodeId = matchedCandidate.nodeId;
      if (suggestion.componentName && suggestion.source) {
        const suggestionMapping: MappedComponent = {
          name: suggestion.componentName,
          source: suggestion.source,
          confidence: "suggested",
        };
        const current = suggestionMatchesByNodeId.get(byNodeId) ?? [];
        current.push(suggestionMapping);
        suggestionMatchesByNodeId.set(byNodeId, current);
      }

      if (suggestion.componentName && suggestion.source) {
        const nameKeys = [
          normalizeComponentName(suggestion.componentName),
          normalizeComponentName(
            extractBaseComponentName(suggestion.componentName),
          ),
        ];
        for (const nameKey of nameKeys) {
          if (nameKey.length === 0) {
            continue;
          }
          const current = suggestionMatchesByName.get(nameKey) ?? [];
          current.push({
            name: suggestion.componentName,
            source: suggestion.source,
            confidence: "suggested",
          });
          suggestionMatchesByName.set(nameKey, current);
        }
      }
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

  // ---- Step 4: Heuristic matching against workspace components ----
  if (workspaceRoot) {
    try {
      const workspaceComponents = await scanWorkspaceComponents({
        workspaceRoot,
      });
      if (workspaceComponents.size > 0) {
        mcpConfig.onLog?.(
          `Workspace scan: ${String(workspaceComponents.size)} component declaration(s) found`,
        );

        for (const candidate of candidates) {
          const existingMapping = resultMappings.get(candidate.nodeId);
          if (
            existingMapping &&
            existingMapping.confidence !== "design_system"
          ) {
            continue;
          }

          const heuristicMatch =
            findHeuristicMatch({
              figmaName: candidate.figmaName,
              workspaceComponents,
            }) ??
            (() => {
              const dsMatch = designSystemMatchesByNodeId.get(candidate.nodeId);
              if (!dsMatch) {
                return undefined;
              }
              return findHeuristicMatch({
                figmaName: dsMatch.name,
                workspaceComponents,
              });
            })();
          if (!heuristicMatch) {
            continue;
          }
          resultMappings.set(candidate.nodeId, heuristicMatch);
          mappedNodeIds.add(candidate.nodeId);
        }
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown error scanning workspace";
      diagnostics.push({
        code: "W_COMPONENT_MAPPER_HEURISTIC_SKIPPED",
        message: `Workspace heuristic scan failed (non-critical): ${message}`,
        severity: "info",
        source: "code_connect",
      });
    }
  }

  for (const candidate of candidates) {
    if (mappedNodeIds.has(candidate.nodeId)) {
      continue;
    }
    const normalizedName = normalizeComponentName(candidate.figmaName);
    const baseName = normalizeComponentName(
      extractBaseComponentName(candidate.figmaName),
    );
    const suggestions = [
      ...(suggestionMatchesByNodeId.get(candidate.nodeId) ?? []),
      ...(suggestionMatchesByName.get(normalizedName) ?? []),
      ...(suggestionMatchesByName.get(baseName) ?? []),
    ].filter(
      (entry, index, array) =>
        array.findIndex(
          (candidateEntry) =>
            candidateEntry.name === entry.name &&
            candidateEntry.source === entry.source,
        ) === index,
    );

    unmapped.push({
      irNodeId: candidate.nodeId,
      figmaName: candidate.figmaName,
      ...(candidate.figmaComponentKey
        ? { figmaComponentKey: candidate.figmaComponentKey }
        : {}),
      ...(suggestions.length > 0 ? { suggestions } : {}),
    });
  }

  // ---- Build stats ----
  const stats = {
    exact: [...resultMappings.values()].filter(
      (mapping) => mapping.confidence === "exact",
    ).length,
    designSystem: [...resultMappings.values()].filter(
      (mapping) => mapping.confidence === "design_system",
    ).length,
    suggested: unmapped.filter((entry) => (entry.suggestions?.length ?? 0) > 0)
      .length,
    heuristic: [...resultMappings.values()].filter(
      (mapping) => mapping.confidence === "heuristic",
    ).length,
    unmapped: unmapped.filter((entry) => (entry.suggestions?.length ?? 0) === 0)
      .length,
  };

  if (
    stats.exact > 0 ||
    designSystemMappings.length > 0 ||
    stats.heuristic > 0 ||
    stats.suggested > 0
  ) {
    diagnostics.push({
      code: "I_COMPONENT_MAPPER_RESOLVED",
      message: `Component mapping resolved: ${String(stats.exact)} exact, ${String(stats.designSystem)} design system, ${String(stats.heuristic)} heuristic, ${String(stats.suggested)} suggested, ${String(stats.unmapped)} unmapped`,
      severity: "info",
      source: "code_connect",
    });
  }

  if (workspaceRoot && candidates.length > 0) {
    const approvedMappings = new Map<string, MappedComponent>();
    for (const candidate of candidates) {
      const mapping = resultMappings.get(candidate.nodeId);
      if (!mapping || !isPersistedMappingConfidence(mapping.confidence)) {
        continue;
      }
      approvedMappings.set(candidate.persistenceKey, mapping);
    }
    if (approvedMappings.size > 0) {
      try {
        await savePersistedMappings({
          workspaceRoot,
          mappings: approvedMappings,
        });
      } catch {
        // Non-critical — proceed without persistence updates
      }
    }
  }

  return {
    mappings: resultMappings,
    codeConnectMappings,
    designSystemMappings,
    unmapped,
    stats,
    diagnostics,
  };
};

// ---------------------------------------------------------------------------
// Public API: mapFigmaComponents
// ---------------------------------------------------------------------------

/**
 * Maps Figma components to codebase references and enriches the DesignIR.
 *
 * This is the main entry point for Issue #1003, matching the signature
 * specified in the acceptance criteria.
 */
export const mapFigmaComponents = async (
  fileKey: string,
  nodeId: string,
  ir: DesignIR,
  config: Omit<ComponentMapperConfig, "fileKey" | "nodeId">,
): Promise<ComponentMappingResult> => {
  const result = await resolveComponentMappings({
    ...config,
    fileKey,
    nodeId,
    ir,
  });

  // Consolidate COMPONENT_SET variants across all screens
  const allNodes: ScreenElementIR[] = [];
  for (const screen of ir.screens) {
    allNodes.push(...screen.children);
  }
  const componentSets = consolidateComponentSetVariants({ irNodes: allNodes });

  // Build heuristic mapping lookup. Design-system matches are handled via
  // designSystemMappings in annotateIrWithMappings and must not be treated
  // as code_connect by the heuristic path.
  const heuristicMappings = new Map<string, MappedComponent>();
  for (const [irNodeId, mapping] of result.mappings) {
    if (mapping.confidence === "design_system") {
      continue;
    }
    heuristicMappings.set(irNodeId, mapping);
    if (mapping.confidence === "heuristic") {
      heuristicMappings.set(normalizeComponentName(mapping.name), mapping);
      heuristicMappings.set(
        normalizeComponentName(extractBaseComponentName(mapping.name)),
        mapping,
      );
    }
  }

  // Annotate IR nodes with resolved mappings
  const { annotated } = annotateIrWithMappings({
    ir,
    codeConnectMappings: result.codeConnectMappings,
    designSystemMappings: result.designSystemMappings,
    heuristicMappings,
    componentSets,
  });

  if (annotated > 0) {
    config.mcpConfig.onLog?.(
      `IR annotated: ${String(annotated)} node(s) enriched with component mappings`,
    );
  }

  return result;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const findPersistedMappingForCandidate = ({
  candidate,
  persistedMappings,
}: {
  candidate: ComponentMappingCandidate;
  persistedMappings: ReadonlyMap<string, MappedComponent>;
}): MappedComponent | undefined => {
  const lookupKeys = [
    candidate.persistenceKey,
    ...candidate.legacyPersistenceKeys,
  ];
  for (const lookupKey of lookupKeys) {
    const mapping = persistedMappings.get(lookupKey);
    if (mapping) {
      return mapping;
    }
  }
  return undefined;
};

const findSuggestionCandidate = ({
  suggestion,
  candidates,
}: {
  suggestion: {
    nodeId?: string;
    mainComponentNodeId?: string;
    figmaName?: string;
    componentName?: string;
    source?: string;
  };
  candidates: readonly ComponentMappingCandidate[];
}): ComponentMappingCandidate | undefined => {
  const byNodeId = suggestion.nodeId ?? suggestion.mainComponentNodeId;
  if (byNodeId) {
    const nodeMatch = candidates.find(
      (candidate) => candidate.nodeId === byNodeId,
    );
    if (nodeMatch) {
      return nodeMatch;
    }
  }

  const nameCandidates = [
    suggestion.figmaName,
    suggestion.componentName,
  ].filter((value): value is string => isNonEmptyString(value));

  if (nameCandidates.length === 0) {
    return undefined;
  }

  const normalizedNameCandidates = new Set<string>();
  for (const value of nameCandidates) {
    normalizedNameCandidates.add(normalizeComponentName(value));
    normalizedNameCandidates.add(
      normalizeComponentName(extractBaseComponentName(value)),
    );
  }

  return candidates.find((candidate) => {
    const candidateKeys = [
      normalizeComponentName(candidate.figmaName),
      normalizeComponentName(extractBaseComponentName(candidate.figmaName)),
    ];
    return candidateKeys.some((key) => normalizedNameCandidates.has(key));
  });
};
