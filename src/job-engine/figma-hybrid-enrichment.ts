import { access } from "node:fs/promises";
import { join } from "node:path";
import type { FigmaMcpEnrichment, FigmaMcpNodeHint } from "../parity/types.js";
import { fetchAuthoritativeFigmaSubtrees } from "./figma-source.js";
import {
  DEFAULT_MCP_SERVER_URL,
  resolveFigmaDesignContext,
  type FigmaDesignContext,
} from "./figma-mcp-resolver.js";
import {
  resolveFigmaTokens,
  type TokenBridgeConfig,
} from "./figma-token-bridge.js";
import {
  resolveComponentMappings,
  type ComponentMapperConfig,
} from "./figma-component-mapper.js";
import type { FigmaMcpEnrichmentLoaderInput } from "./types.js";

const TOKEN_BRIDGE_VARIABLES_SKIPPED_CODE = "W_TOKEN_BRIDGE_VARIABLES_SKIPPED";
const TOKEN_BRIDGE_DESIGN_SYSTEM_SKIPPED_CODE =
  "W_TOKEN_BRIDGE_DESIGN_SYSTEM_SKIPPED";

/**
 * Test/dev override for the MCP server URL. Production behavior is unchanged
 * when this is unset — consumers fall back to `DEFAULT_MCP_SERVER_URL`. The
 * resolver itself enforces HTTPS unless `WORKSPACE_ALLOW_INSECURE_MCP=true`,
 * so pointing this at an http://127.0.0.1 mock also requires that opt-in.
 */
const MCP_SERVER_URL_OVERRIDE_ENV = "WORKSPACE_DEV_MCP_SERVER_URL";

const resolveMcpServerUrl = (): string => {
  const override = process.env[MCP_SERVER_URL_OVERRIDE_ENV]?.trim();
  return override && override.length > 0 ? override : DEFAULT_MCP_SERVER_URL;
};

const TAILWIND_CONFIG_NAMES = [
  "tailwind.config.js",
  "tailwind.config.ts",
  "tailwind.config.cjs",
  "tailwind.config.mjs",
];

const detectTailwindWorkspace = async (
  workspaceRoot: string | undefined,
): Promise<boolean> => {
  if (!workspaceRoot) return false;
  for (const name of TAILWIND_CONFIG_NAMES) {
    try {
      await access(join(workspaceRoot, name));
      return true;
    } catch {
      // config file not present
    }
  }
  return false;
};

type RawFigmaNode = {
  id?: unknown;
  type?: unknown;
  name?: unknown;
  children?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asNodeArray = (value: unknown): RawFigmaNode[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is RawFigmaNode => isRecord(entry))
    : [];

const isPrimaryMcpNodeType = (value: unknown): boolean =>
  value === "FRAME" ||
  value === "COMPONENT" ||
  value === "COMPONENT_SET" ||
  value === "SECTION" ||
  value === "GROUP";

const resolvePrimaryNodeId = ({
  file,
  authoritativeSubtrees,
}: {
  file: FigmaMcpEnrichmentLoaderInput["rawFile"];
  authoritativeSubtrees: Array<{ nodeId: string; document: unknown }>;
}): string | undefined => {
  if (authoritativeSubtrees[0]?.nodeId) {
    return authoritativeSubtrees[0].nodeId;
  }

  const root = isRecord(file.document)
    ? (file.document as RawFigmaNode)
    : undefined;
  if (!root) {
    return undefined;
  }

  const queue: RawFigmaNode[] = [...asNodeArray(root.children)];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    if (
      typeof current.id === "string" &&
      current.id.trim().length > 0 &&
      isPrimaryMcpNodeType(current.type)
    ) {
      return current.id.trim();
    }
    queue.push(...asNodeArray(current.children));
  }

  return typeof root.id === "string" && root.id.trim().length > 0
    ? root.id.trim()
    : undefined;
};

const inferAssetKind = (source: string): "image" | "svg" | "icon" => {
  if (/\.svg(?:[?#]|$)/i.test(source)) {
    return "svg";
  }
  if (/(?:^|\/)(?:icon|icons)(?:\/|$)/i.test(source)) {
    return "icon";
  }
  return "image";
};

const mapResolverDiagnostics = ({
  diagnostics,
}: {
  diagnostics: NonNullable<FigmaDesignContext["diagnostics"]> | undefined;
}): FigmaMcpEnrichment["diagnostics"] => {
  if (!diagnostics || diagnostics.length === 0) {
    return undefined;
  }
  return diagnostics.map((entry) => ({
    code: entry.code,
    message: entry.message,
    severity: entry.severity,
    source: entry.code.includes("SCREENSHOT")
      ? "screenshots"
      : entry.code.includes("ASSET")
        ? "assets"
        : entry.code.includes("METADATA")
          ? "metadata"
          : "loader",
  }));
};

const collectNodeHints = ({
  node,
  hints,
}: {
  node: Record<string, unknown>;
  hints: FigmaMcpNodeHint[];
}): void => {
  const id = typeof node["id"] === "string" ? node["id"] : undefined;
  const type = typeof node["type"] === "string" ? node["type"] : undefined;
  const name = typeof node["name"] === "string" ? node["name"] : undefined;
  if (id && type) {
    hints.push({
      nodeId: id,
      semanticName: name ?? id,
      semanticType: type,
      sourceTools: ["figma-rest-authoritative-subtrees"],
    });
  }
  const children = node["children"];
  if (Array.isArray(children)) {
    for (const child of children) {
      if (isRecord(child)) {
        collectNodeHints({ node: child, hints });
      }
    }
  }
};

const buildNodeHintsFromSubtrees = ({
  authoritativeSubtrees,
}: {
  authoritativeSubtrees: Array<{ nodeId: string; document: unknown }>;
}): FigmaMcpNodeHint[] => {
  const hints: FigmaMcpNodeHint[] = [];
  for (const subtree of authoritativeSubtrees) {
    if (!isRecord(subtree.document)) continue;
    collectNodeHints({ node: subtree.document, hints });
  }
  return hints;
};

const buildEnrichmentFromDesignContext = ({
  context,
  authoritativeSubtrees,
}: {
  context: FigmaDesignContext;
  authoritativeSubtrees: Array<{ nodeId: string; document: unknown }>;
}): FigmaMcpEnrichment => {
  const diagnostics = mapResolverDiagnostics({
    diagnostics: context.diagnostics,
  });
  const toolNames = [
    "get_design_context",
    ...(context.metadata ? ["get_metadata"] : []),
    ...(context.screenshot ? ["get_screenshot"] : []),
    ...(authoritativeSubtrees.length > 0
      ? ["figma-rest-authoritative-subtrees"]
      : []),
  ];

  return {
    sourceMode: "hybrid",
    nodeHints: buildNodeHintsFromSubtrees({ authoritativeSubtrees }),
    ...(context.metadata
      ? {
          metadataHints: [
            {
              nodeId: context.nodeId,
              layerName: context.metadata.rootNodeName,
              layerType: context.metadata.rootNodeType,
              sourceTools: ["get_metadata"],
            },
          ],
        }
      : {}),
    ...(authoritativeSubtrees.length > 0 ? { authoritativeSubtrees } : {}),
    ...(Object.keys(context.assets).length > 0
      ? {
          assets: Object.entries(context.assets).map(([nodeId, source]) => ({
            nodeId,
            source,
            kind: inferAssetKind(source),
            purpose: "render" as const,
          })),
        }
      : {}),
    ...(context.screenshot
      ? {
          screenshots: [
            {
              nodeId: context.nodeId,
              url: context.screenshot,
              purpose: "context",
            },
          ],
        }
      : {}),
    ...(diagnostics ? { diagnostics } : {}),
    toolNames,
  };
};

const mergeToolNames = ({
  existing,
  incoming,
}: {
  existing: string[];
  incoming: string[];
}): string[] => {
  const merged = new Set(existing);
  for (const toolName of incoming) {
    merged.add(toolName);
  }
  return [...merged];
};

const resolveOverrideMcpServerUrl = (): URL | undefined => {
  const override = process.env[MCP_SERVER_URL_OVERRIDE_ENV]?.trim();
  if (!override || override.length === 0) {
    return undefined;
  }
  try {
    return new URL(override);
  } catch {
    return undefined;
  }
};

const isOverrideMcpRequest = (url: URL): boolean => {
  const overrideUrl = resolveOverrideMcpServerUrl();
  if (!overrideUrl) {
    return false;
  }
  return url.origin === overrideUrl.origin && url.pathname === overrideUrl.pathname;
};

const createTrustedFigmaLoaderFetch = ({
  figmaRestFetch,
  figmaMcpFetch,
}: {
  figmaRestFetch: typeof fetch;
  figmaMcpFetch: typeof fetch;
}): typeof fetch => {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === "api.figma.com") {
      return await figmaRestFetch(request);
    }
    if (url.hostname === "mcp.figma.com") {
      return await figmaMcpFetch(request);
    }
    // When WORKSPACE_DEV_MCP_SERVER_URL is set, allow its hostname too so the
    // in-process mock server can serve MCP traffic. Production leaves this
    // unset and the wrapper remains restricted to api/mcp.figma.com.
    if (isOverrideMcpRequest(url)) {
      return await figmaMcpFetch(request);
    }
    throw new Error(
      `Default hybrid loader fetch is restricted to Figma hosts; received '${url.hostname}'.`,
    );
  };
};

export const createDefaultFigmaMcpEnrichmentLoader = ({
  timeoutMs,
  maxRetries,
  maxScreenCandidates,
  screenNamePattern,
}: {
  timeoutMs: number;
  maxRetries: number;
  maxScreenCandidates: number;
  screenNamePattern?: string;
}): ((
  input: FigmaMcpEnrichmentLoaderInput,
) => Promise<FigmaMcpEnrichment | undefined>) => {
  return async ({
    figmaFileKey,
    rawFile,
    figmaRestFetch,
    figmaMcpFetch,
    workspaceRoot,
  }: FigmaMcpEnrichmentLoaderInput): Promise<FigmaMcpEnrichment> => {
    const trustedFigmaFetch = createTrustedFigmaLoaderFetch({
      figmaRestFetch,
      figmaMcpFetch,
    });
    const authoritativeSubtrees = await fetchAuthoritativeFigmaSubtrees({
      fileKey: figmaFileKey,
      file: rawFile,
      timeoutMs,
      maxRetries,
      fetchImpl: figmaRestFetch,
      onLog: () => {},
      maxScreenCandidates,
      ...(screenNamePattern !== undefined ? { screenNamePattern } : {}),
    });

    const primaryNodeId = resolvePrimaryNodeId({
      file: rawFile,
      authoritativeSubtrees,
    });
    if (!primaryNodeId) {
      return {
        sourceMode: "hybrid",
        nodeHints: [],
        ...(authoritativeSubtrees.length > 0 ? { authoritativeSubtrees } : {}),
        diagnostics: [
          {
            code: "W_MCP_ENRICHMENT_SKIPPED",
            message:
              "No primary node ID could be resolved from the Figma source file for MCP enrichment.",
            severity: "warning",
            source: "loader",
          },
        ],
        toolNames:
          authoritativeSubtrees.length > 0
            ? ["figma-rest-authoritative-subtrees"]
            : [],
      };
    }

    try {
      const context = await resolveFigmaDesignContext(
        {
          fileKey: figmaFileKey,
          nodeId: primaryNodeId,
          ...(typeof rawFile.lastModified === "string" &&
          rawFile.lastModified.trim().length > 0
            ? { version: rawFile.lastModified.trim() }
            : {}),
        },
        {
          serverUrl: resolveMcpServerUrl(),
          authMode: "desktop",
          fetchImpl: trustedFigmaFetch,
          timeoutMs,
          maxRetries,
          onLog: () => {},
        },
      );

      const enrichment = buildEnrichmentFromDesignContext({
        context,
        authoritativeSubtrees,
      });

      // --- Token bridge: resolve Figma variables & design system tokens ---
      try {
        const tailwindDetected = await detectTailwindWorkspace(workspaceRoot);
        const bridgeConfig: TokenBridgeConfig = {
          fileKey: figmaFileKey,
          nodeId: primaryNodeId,
          mcpConfig: {
            serverUrl: resolveMcpServerUrl(),
            authMode: "desktop",
            fetchImpl: figmaMcpFetch,
            timeoutMs,
            maxRetries,
            onLog: () => {},
          },
          tailwindDetected,
        };

        const bridgeResult = await resolveFigmaTokens(bridgeConfig);

        if (bridgeResult.variables.length > 0) {
          enrichment.variables = bridgeResult.variables;
        }
        if (bridgeResult.styleCatalog.length > 0) {
          enrichment.styleCatalog = bridgeResult.styleCatalog;
        }
        enrichment.cssCustomProperties = bridgeResult.cssCustomProperties;
        enrichment.libraryKeys = bridgeResult.libraryKeys;
        enrichment.modeAlternatives = bridgeResult.modeAlternatives;
        enrichment.conflicts = bridgeResult.conflicts;
        enrichment.unmappedVariables = bridgeResult.unmappedVariables;
        if (bridgeResult.tailwindExtension) {
          enrichment.tailwindExtension = bridgeResult.tailwindExtension;
        }

        const bridgeToolNames: string[] = [];
        if (
          !bridgeResult.diagnostics.some(
            (entry) => entry.code === TOKEN_BRIDGE_VARIABLES_SKIPPED_CODE,
          )
        ) {
          bridgeToolNames.push("get_variable_defs");
        }
        if (
          !bridgeResult.diagnostics.some(
            (entry) => entry.code === TOKEN_BRIDGE_DESIGN_SYSTEM_SKIPPED_CODE,
          )
        ) {
          bridgeToolNames.push("search_design_system");
        }
        if (bridgeToolNames.length > 0) {
          enrichment.toolNames = mergeToolNames({
            existing: enrichment.toolNames,
            incoming: bridgeToolNames,
          });
        }

        if (bridgeResult.diagnostics.length > 0) {
          enrichment.diagnostics = [
            ...(enrichment.diagnostics ?? []),
            ...bridgeResult.diagnostics,
          ];
        }
      } catch {
        enrichment.diagnostics = [
          ...(enrichment.diagnostics ?? []),
          {
            code: "W_TOKEN_BRIDGE_SKIPPED",
            message:
              "Token bridge failed; enrichment proceeds without variable/style data.",
            severity: "warning",
            source: "variables",
          },
        ];
      }

      // --- Component mapper: resolve Figma components to codebase refs ---
      try {
        const mapperConfig: ComponentMapperConfig = {
          fileKey: figmaFileKey,
          nodeId: primaryNodeId,
          mcpConfig: {
            serverUrl: resolveMcpServerUrl(),
            authMode: "desktop",
            fetchImpl: figmaMcpFetch,
            timeoutMs,
            maxRetries,
            onLog: () => {},
          },
          ...(enrichment.libraryKeys && enrichment.libraryKeys.length > 0
            ? { libraryKeys: enrichment.libraryKeys }
            : {}),
          rawFile,
          ...(workspaceRoot ? { workspaceRoot } : {}),
        };

        const mapperResult = await resolveComponentMappings(mapperConfig);

        const exactMappings = Array.from(mapperResult.mappings.entries())
          .filter(([, mapping]) => mapping.confidence === "exact")
          .map(([nodeId, mapping]) => ({
            nodeId,
            componentName: mapping.name,
            source: mapping.source,
          }));
        const codeConnectMappings = [
          ...mapperResult.codeConnectMappings,
          ...exactMappings.filter(
            (candidate) =>
              !mapperResult.codeConnectMappings.some(
                (mapping) =>
                  mapping.nodeId === candidate.nodeId &&
                  mapping.componentName === candidate.componentName &&
                  mapping.source === candidate.source,
              ),
          ),
        ];
        if (codeConnectMappings.length > 0) {
          enrichment.codeConnectMappings = codeConnectMappings;
        }
        if (mapperResult.designSystemMappings.length > 0) {
          enrichment.designSystemMappings = mapperResult.designSystemMappings;
        }

        // Flow heuristic matches into enrichment so ir-derive can annotate
        if (mapperResult.stats.heuristic > 0) {
          const heuristicEntries: typeof enrichment.heuristicComponentMappings =
            [];
          for (const [irNodeId, mapping] of mapperResult.mappings) {
            if (mapping.confidence === "heuristic") {
              heuristicEntries.push({
                nodeId: irNodeId,
                componentName: mapping.name,
                source: mapping.source,
              });
            }
          }
          if (heuristicEntries.length > 0) {
            enrichment.heuristicComponentMappings = heuristicEntries;
          }
        }

        const mapperToolNames: string[] = [];
        if (
          !mapperResult.diagnostics.some(
            (entry) => entry.code === "W_COMPONENT_MAPPER_CODE_CONNECT_SKIPPED",
          )
        ) {
          mapperToolNames.push("get_code_connect_map");
        }
        if (
          !mapperResult.diagnostics.some(
            (entry) => entry.code === "W_COMPONENT_MAPPER_SUGGESTIONS_SKIPPED",
          )
        ) {
          mapperToolNames.push("get_code_connect_suggestions");
        }
        if (mapperToolNames.length > 0) {
          enrichment.toolNames = mergeToolNames({
            existing: enrichment.toolNames,
            incoming: mapperToolNames,
          });
        }

        if (mapperResult.diagnostics.length > 0) {
          enrichment.diagnostics = [
            ...(enrichment.diagnostics ?? []),
            ...mapperResult.diagnostics,
          ];
        }
      } catch {
        enrichment.diagnostics = [
          ...(enrichment.diagnostics ?? []),
          {
            code: "W_COMPONENT_MAPPER_SKIPPED",
            message:
              "Component mapper failed; enrichment proceeds without component mappings.",
            severity: "warning",
            source: "code_connect",
          },
        ];
      }

      return enrichment;
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Unknown MCP enrichment failure.";
      return {
        sourceMode: "hybrid",
        nodeHints: [],
        ...(authoritativeSubtrees.length > 0 ? { authoritativeSubtrees } : {}),
        diagnostics: [
          {
            code: "W_MCP_ENRICHMENT_SKIPPED",
            message: `Default MCP enrichment loader fell back to REST-only enrichment: ${message}`,
            severity: "warning",
            source: "loader",
          },
        ],
        toolNames:
          authoritativeSubtrees.length > 0
            ? ["figma-rest-authoritative-subtrees"]
            : [],
      };
    }
  };
};
