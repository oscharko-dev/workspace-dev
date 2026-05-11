import os from "node:os";
import { fetchFigmaFile } from "../job-engine/figma-source.js";

interface ParityFigmaFileRequest {
  accessToken: string;
  fileKey: string;
}

const LIVE_FIGMA_CACHE_TTL_MS = 15 * 60_000;
const cachedFigmaFiles = new Map<string, Promise<unknown>>();

export const fetchParityFigmaFileOnce = async ({
  accessToken,
  fileKey
}: ParityFigmaFileRequest): Promise<unknown> => {
  const cacheKey = `${fileKey}:${accessToken}`;
  const cachedFile = cachedFigmaFiles.get(cacheKey);
  if (cachedFile) {
    return await cachedFile;
  }

  const pendingFile = (async (): Promise<unknown> => {
    const result = await fetchFigmaFile({
      fileKey,
      accessToken,
      timeoutMs: 45_000,
      maxRetries: 5,
      fetchImpl: fetch,
      onLog: () => {},
      bootstrapDepth: 5,
      nodeBatchSize: 1,
      nodeFetchConcurrency: 1,
      adaptiveBatchingEnabled: false,
      maxScreenCandidates: 1,
      cacheEnabled: true,
      cacheTtlMs: LIVE_FIGMA_CACHE_TTL_MS,
      cacheDir: os.tmpdir()
    });
    return result.file;
  })();

  cachedFigmaFiles.set(cacheKey, pendingFile);

  try {
    return await pendingFile;
  } catch (error) {
    cachedFigmaFiles.delete(cacheKey);
    throw error;
  }
};
