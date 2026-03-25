import type { FigmaMcpEnrichment } from "../parity/types.js";
import { fetchAuthoritativeFigmaSubtrees } from "./figma-source.js";
import type { FigmaMcpEnrichmentLoaderInput } from "./types.js";

export const createDefaultFigmaMcpEnrichmentLoader = ({
  timeoutMs,
  maxRetries,
  maxScreenCandidates,
  screenNamePattern
}: {
  timeoutMs: number;
  maxRetries: number;
  maxScreenCandidates: number;
  screenNamePattern?: string;
}): ((input: FigmaMcpEnrichmentLoaderInput) => Promise<FigmaMcpEnrichment | undefined>) => {
  return async ({
    figmaFileKey,
    figmaAccessToken,
    rawFile,
    fetchImpl
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
      ...(screenNamePattern !== undefined ? { screenNamePattern } : {})
    });

    return {
      sourceMode: "hybrid",
      nodeHints: [],
      authoritativeSubtrees,
      toolNames: ["figma-rest-authoritative-subtrees"]
    };
  };
};
