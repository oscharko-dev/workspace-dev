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
  mcpConfig: McpResolverConfig;
  libraryKeys?: string[];
  workspaceRoot?: string;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Persistence types
// ---------------------------------------------------------------------------

interface PersistedComponentMap {
  version: 1;
  updatedAt: string;
  entries: Record<string, PersistedMappingEntry>;
}

interface PersistedMappingEntry {
  name: string;
  source: string;
  importPath?: string;
  confidence: MappedComponent["confidence"];
  figmaComponentKey?: string;
  approvedAt: string;
}

const PERSISTENCE_FILENAME = "figma-component-map.json";

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

  return parseCodeConnectMapResponse(result);
};

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

/**
 * Loads persisted component mappings from the workspace config file.
 * Validates that referenced source files still exist (stale mapping check).
 */
export const loadPersistedMappings = async ({
  workspaceRoot,
}: {
  workspaceRoot: string;
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

  if (!isRecord(parsed) || parsed.version !== 1) {
    return result;
  }

  const entries = parsed.entries;
  if (!isRecord(entries)) {
    return result;
  }

  for (const [figmaKey, value] of Object.entries(entries)) {
    if (!isRecord(value)) continue;
    if (!isNonEmptyString(value.name)) continue;
    if (!isNonEmptyString(value.source)) continue;

    const confidence = value.confidence;
    if (
      confidence !== "exact" &&
      confidence !== "suggested" &&
      confidence !== "heuristic" &&
      confidence !== "none"
    ) {
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

  const entries: Record<string, PersistedMappingEntry> = {};
  for (const [figmaKey, mapping] of mappings) {
    entries[figmaKey] = {
      name: mapping.name,
      source: mapping.source,
      confidence: mapping.confidence,
      ...(mapping.importPath ? { importPath: mapping.importPath } : {}),
      approvedAt: new Date().toISOString(),
    };
  }

  const persisted: PersistedComponentMap = {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries,
  };

  await writeFile(filePath, JSON.stringify(persisted, null, 2) + "\n", "utf8");
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

  const ccByName = new Map<string, FigmaMcpCodeConnectMapping>();
  for (const mapping of codeConnectMappings) {
    ccByName.set(normalizeComponentName(mapping.componentName), mapping);
  }

  const dsByName = new Map<string, FigmaMcpDesignSystemMapping>();
  for (const mapping of designSystemMappings) {
    dsByName.set(normalizeComponentName(mapping.componentName), mapping);
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
        // Step 2: Check Code Connect by normalized name
        const normalizedName = normalizeComponentName(node.name);
        const baseName = normalizeComponentName(
          extractBaseComponentName(node.name),
        );

        // For COMPONENT_SET variants, resolve to the base component
        const setInfo = componentSets.get(baseName);
        const lookupName = setInfo
          ? normalizeComponentName(setInfo.baseName)
          : normalizedName;

        const ccByNameMatch =
          ccByName.get(lookupName) ?? ccByName.get(baseName);
        if (ccByNameMatch) {
          const mapping: ElementCodeConnectMappingIR = {
            origin: "code_connect",
            componentName: ccByNameMatch.componentName,
            source: ccByNameMatch.source,
            ...(ccByNameMatch.label ? { label: ccByNameMatch.label } : {}),
            ...(ccByNameMatch.propContract
              ? { propContract: ccByNameMatch.propContract }
              : {}),
          };
          (node as { codeConnect?: ElementCodeConnectMappingIR }).codeConnect =
            mapping;
          annotated++;
        } else {
          // Step 3: Check design system by name
          const dsMatch = dsByName.get(lookupName) ?? dsByName.get(baseName);
          if (dsMatch) {
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
            // Step 4: Check heuristic workspace match
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
  const { fileKey, nodeId, mcpConfig, libraryKeys, workspaceRoot, signal } =
    mapperConfig;
  const diagnostics: FigmaMcpEnrichmentDiagnostic[] = [];
  const codeConnectMappings: FigmaMcpCodeConnectMapping[] = [];
  const designSystemMappings: FigmaMcpDesignSystemMapping[] = [];
  const unmapped: UnmappedComponent[] = [];
  const mappedNodeIds = new Set<string>();
  const resultMappings = new Map<string, MappedComponent>();
  let heuristicCount = 0;

  // ---- Step 0: Load persisted mappings ----
  let persistedMappings = new Map<string, MappedComponent>();
  if (workspaceRoot) {
    try {
      persistedMappings = await loadPersistedMappings({ workspaceRoot });
      if (persistedMappings.size > 0) {
        mcpConfig.onLog?.(
          `Loaded ${String(persistedMappings.size)} persisted mapping(s)`,
        );
        for (const [key, mapping] of persistedMappings) {
          resultMappings.set(key, mapping);
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
  let dsComponents: Array<{
    name: string;
    key?: string;
    libraryKey?: string;
  }> = [];

  try {
    const searchQuery = buildComponentSearchQuery({ codeConnectMappings });
    if (searchQuery.length > 0) {
      dsComponents = await searchDesignSystemComponents({
        fileKey,
        query: searchQuery,
        config: mcpConfig,
        ...(libraryKeys ? { libraryKeys } : {}),
        ...(signal ? { signal } : {}),
      });

      for (const dsComp of dsComponents) {
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

  // ---- Step 3: AI suggestions ----
  try {
    const suggestions = await fetchCodeConnectSuggestions({
      fileKey,
      nodeId,
      config: mcpConfig,
      ...(signal ? { signal } : {}),
    });

    for (const suggestion of suggestions) {
      if (mappedNodeIds.has(suggestion.nodeId)) {
        continue;
      }
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

        // For each unmapped component, try heuristic matching
        const remainingUnmapped: UnmappedComponent[] = [];
        for (const entry of unmapped) {
          const heuristicMatch = findHeuristicMatch({
            figmaName: entry.figmaName,
            workspaceComponents,
          });
          if (heuristicMatch) {
            resultMappings.set(entry.irNodeId, heuristicMatch);
            heuristicCount++;
          } else {
            remainingUnmapped.push(entry);
          }
        }
        unmapped.length = 0;
        unmapped.push(...remainingUnmapped);
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

  // ---- Build stats ----
  const stats = {
    exact: codeConnectMappings.length,
    designSystem: designSystemMappings.length,
    suggested: unmapped.filter((entry) => (entry.suggestions?.length ?? 0) > 0)
      .length,
    heuristic: heuristicCount,
    unmapped: unmapped.filter((entry) => (entry.suggestions?.length ?? 0) === 0)
      .length,
  };

  if (
    codeConnectMappings.length > 0 ||
    designSystemMappings.length > 0 ||
    heuristicCount > 0
  ) {
    diagnostics.push({
      code: "I_COMPONENT_MAPPER_RESOLVED",
      message: `Component mapping resolved: ${String(stats.exact)} exact, ${String(stats.designSystem)} design system, ${String(stats.heuristic)} heuristic, ${String(stats.suggested)} suggested, ${String(stats.unmapped)} unmapped`,
      severity: "info",
      source: "code_connect",
    });
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
  });

  // Consolidate COMPONENT_SET variants across all screens
  const allNodes: ScreenElementIR[] = [];
  for (const screen of ir.screens) {
    allNodes.push(...screen.children);
  }
  const componentSets = consolidateComponentSetVariants({ irNodes: allNodes });

  // Build heuristic mapping lookup
  const heuristicMappings = new Map<string, MappedComponent>();
  for (const [key, mapping] of result.mappings) {
    if (mapping.confidence === "heuristic") {
      heuristicMappings.set(normalizeComponentName(key), mapping);
      heuristicMappings.set(normalizeComponentName(mapping.name), mapping);
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

  // Save approved (non-suggested) mappings for persistence
  if (config.workspaceRoot) {
    const approvedMappings = new Map<string, MappedComponent>();
    for (const [key, mapping] of result.mappings) {
      if (mapping.confidence !== "none") {
        approvedMappings.set(key, mapping);
      }
    }
    if (approvedMappings.size > 0) {
      try {
        await savePersistedMappings({
          workspaceRoot: config.workspaceRoot,
          mappings: approvedMappings,
        });
      } catch {
        // Non-critical — mapping works without persistence
      }
    }
  }

  return result;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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

  for (const mapping of codeConnectMappings) {
    const base = extractBaseComponentName(mapping.componentName);
    pushFragment(base);
    if (fragments.length >= 6) {
      break;
    }
  }

  if (fragments.length === 0) {
    return "button input card";
  }

  return fragments.join(" ");
};
