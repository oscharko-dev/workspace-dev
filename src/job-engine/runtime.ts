import type { JobEngineRuntime } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;

export const resolveRuntimeSettings = ({
  figmaRequestTimeoutMs,
  figmaMaxRetries,
  enablePreview,
  fetchImpl
}: {
  figmaRequestTimeoutMs?: number;
  figmaMaxRetries?: number;
  enablePreview?: boolean;
  fetchImpl?: typeof fetch;
}): JobEngineRuntime => {
  return {
    figmaTimeoutMs:
      typeof figmaRequestTimeoutMs === "number" && Number.isFinite(figmaRequestTimeoutMs)
        ? Math.max(1_000, Math.trunc(figmaRequestTimeoutMs))
        : DEFAULT_TIMEOUT_MS,
    figmaMaxRetries:
      typeof figmaMaxRetries === "number" && Number.isFinite(figmaMaxRetries)
        ? Math.max(1, Math.min(10, Math.trunc(figmaMaxRetries)))
        : DEFAULT_MAX_RETRIES,
    previewEnabled: enablePreview !== false,
    fetchImpl: fetchImpl ?? fetch
  };
};
