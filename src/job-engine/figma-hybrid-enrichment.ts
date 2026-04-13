import type { FigmaMcpEnrichment } from "../parity/types.js";
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
import type { FigmaMcpEnrichmentLoaderInput } from "./types.js";

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
    nodeHints: [],
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
    figmaAccessToken,
    rawFile,
    fetchImpl,
  }: FigmaMcpEnrichmentLoaderInput): Promise<FigmaMcpEnrichment> => {
    const authoritativeSubtrees = await fetchAuthoritativeFigmaSubtrees({
      fileKey: figmaFileKey,
      accessToken: figmaAccessToken,
      file: rawFile,
      timeoutMs,
      maxRetries,
      fetchImpl,
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
          serverUrl: DEFAULT_MCP_SERVER_URL,
          accessToken: figmaAccessToken,
          authMode: "desktop",
          fetchImpl,
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
        const bridgeConfig: TokenBridgeConfig = {
          fileKey: figmaFileKey,
          nodeId: primaryNodeId,
          mcpConfig: {
            serverUrl: DEFAULT_MCP_SERVER_URL,
            accessToken: figmaAccessToken,
            authMode: "desktop",
            fetchImpl,
            timeoutMs,
            maxRetries,
            onLog: () => {},
          },
        };

        const bridgeResult = await resolveFigmaTokens(bridgeConfig);

        if (bridgeResult.variables.length > 0) {
          enrichment.variables = bridgeResult.variables;
        }
        if (bridgeResult.styleCatalog.length > 0) {
          enrichment.styleCatalog = bridgeResult.styleCatalog;
        }

        const bridgeToolNames: string[] = [];
        if (bridgeResult.variables.length > 0) {
          bridgeToolNames.push("get_variable_defs");
        }
        if (bridgeResult.styleCatalog.length > 0) {
          bridgeToolNames.push("search_design_system");
        }
        if (bridgeToolNames.length > 0) {
          enrichment.toolNames = [...enrichment.toolNames, ...bridgeToolNames];
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
