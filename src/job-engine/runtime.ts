import type { JobEngineRuntime } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BOOTSTRAP_DEPTH = 5;
const DEFAULT_NODE_BATCH_SIZE = 6;
const DEFAULT_MAX_SCREEN_CANDIDATES = 40;
const DEFAULT_SCREEN_ELEMENT_BUDGET = 1_200;

export const resolveRuntimeSettings = ({
  figmaRequestTimeoutMs,
  figmaMaxRetries,
  figmaBootstrapDepth,
  figmaNodeBatchSize,
  figmaMaxScreenCandidates,
  figmaScreenElementBudget,
  enablePreview,
  fetchImpl
}: {
  figmaRequestTimeoutMs?: number;
  figmaMaxRetries?: number;
  figmaBootstrapDepth?: number;
  figmaNodeBatchSize?: number;
  figmaMaxScreenCandidates?: number;
  figmaScreenElementBudget?: number;
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
    figmaBootstrapDepth:
      typeof figmaBootstrapDepth === "number" && Number.isFinite(figmaBootstrapDepth)
        ? Math.max(1, Math.min(10, Math.trunc(figmaBootstrapDepth)))
        : DEFAULT_BOOTSTRAP_DEPTH,
    figmaNodeBatchSize:
      typeof figmaNodeBatchSize === "number" && Number.isFinite(figmaNodeBatchSize)
        ? Math.max(1, Math.min(20, Math.trunc(figmaNodeBatchSize)))
        : DEFAULT_NODE_BATCH_SIZE,
    figmaMaxScreenCandidates:
      typeof figmaMaxScreenCandidates === "number" && Number.isFinite(figmaMaxScreenCandidates)
        ? Math.max(1, Math.min(200, Math.trunc(figmaMaxScreenCandidates)))
        : DEFAULT_MAX_SCREEN_CANDIDATES,
    figmaScreenElementBudget:
      typeof figmaScreenElementBudget === "number" && Number.isFinite(figmaScreenElementBudget)
        ? Math.max(100, Math.min(10_000, Math.trunc(figmaScreenElementBudget)))
        : DEFAULT_SCREEN_ELEMENT_BUDGET,
    previewEnabled: enablePreview !== false,
    fetchImpl: fetchImpl ?? fetch
  };
};
