import {
  CONTEXT_BUDGET_ESTIMATOR_BYTES_PER_TOKEN,
  DEFAULT_LLM_IMAGE_TOKEN_STRATEGY,
  LLM_IMAGE_LLAMA_BASE_TOKENS,
  LLM_IMAGE_LLAMA_TILE_SIZE_PX,
  LLM_IMAGE_LLAMA_TOKENS_PER_TILE,
  LLM_IMAGE_OPENAI_BASE_TOKENS,
  LLM_IMAGE_OPENAI_TILE_SIZE_PX,
  LLM_IMAGE_OPENAI_TOKENS_PER_TILE,
  type LlmGenerationRequest,
  type LlmImageInput,
  type LlmImageTokenStrategy,
} from "../contracts/index.js";

/**
 * Shared, allocation-light token estimator for prompt-size budgeting.
 *
 * Text bytes are counted with the legacy `bytes / 4` heuristic. Image inputs
 * are estimated per a configurable strategy (Issue #1930): the OpenAI- and
 * Llama-aligned tile defaults preserve the production FinOps envelope for
 * realistic Visual-Sidecar screenshots, and a `raw_bytes` fallback is kept
 * for callers that cannot supply pixel dimensions.
 *
 * The mock gateway, real gateway, and context-budget analyzer all route
 * through these helpers so the budget checks stay aligned across call sites.
 */
export interface LlmTokenEstimationOptions {
  /**
   * Per-modality strategy applied to {@link LlmGenerationRequest.imageInputs}.
   * Defaults to {@link DEFAULT_LLM_IMAGE_TOKEN_STRATEGY}. Any image whose
   * `widthPx`/`heightPx` is missing or non-positive falls back to the
   * `raw_bytes` formula for that single image, regardless of the selected
   * strategy — this preserves back-compat for callers that have not yet
   * plumbed pixel dimensions through.
   */
  imageTokenStrategy?: LlmImageTokenStrategy;
}

const hasUsableDimensions = (image: LlmImageInput): boolean =>
  typeof image.widthPx === "number" &&
  Number.isFinite(image.widthPx) &&
  image.widthPx > 0 &&
  typeof image.heightPx === "number" &&
  Number.isFinite(image.heightPx) &&
  image.heightPx > 0;

/**
 * Tokens charged for a single image under {@link strategy}. Falls back to
 * the `raw_bytes` formula when the image lacks usable pixel dimensions.
 */
export const estimateImageInputTokens = (
  image: LlmImageInput,
  strategy: LlmImageTokenStrategy = DEFAULT_LLM_IMAGE_TOKEN_STRATEGY,
): number => {
  if (strategy === "raw_bytes" || !hasUsableDimensions(image)) {
    return Math.ceil(
      image.base64Data.length / CONTEXT_BUDGET_ESTIMATOR_BYTES_PER_TOKEN,
    );
  }
  const widthPx = image.widthPx as number;
  const heightPx = image.heightPx as number;
  switch (strategy) {
    case "openai_tiles": {
      const tileArea =
        LLM_IMAGE_OPENAI_TILE_SIZE_PX * LLM_IMAGE_OPENAI_TILE_SIZE_PX;
      const tiles = Math.ceil((widthPx * heightPx) / tileArea);
      return tiles * LLM_IMAGE_OPENAI_TOKENS_PER_TILE +
        LLM_IMAGE_OPENAI_BASE_TOKENS;
    }
    case "llama_tiles": {
      const tileArea =
        LLM_IMAGE_LLAMA_TILE_SIZE_PX * LLM_IMAGE_LLAMA_TILE_SIZE_PX;
      const tiles = Math.ceil((widthPx * heightPx) / tileArea);
      return tiles * LLM_IMAGE_LLAMA_TOKENS_PER_TILE +
        LLM_IMAGE_LLAMA_BASE_TOKENS;
    }
    default: {
      const exhaustiveCheck: never = strategy;
      throw new RangeError(
        `Unsupported imageTokenStrategy: ${String(exhaustiveCheck)}`,
      );
    }
  }
};

/**
 * Text-only payload size in UTF-8 bytes. Image inputs are NOT included —
 * use {@link estimateLlmInputTokens} for the full token estimate.
 */
export const estimateLlmInputBytes = (
  request: Pick<
    LlmGenerationRequest,
    "systemPrompt" | "userPrompt" | "responseSchema"
  >,
): number => {
  let bytes =
    Buffer.byteLength(request.systemPrompt, "utf8") +
    Buffer.byteLength(request.userPrompt, "utf8");
  if (request.responseSchema !== undefined) {
    bytes += Buffer.byteLength(JSON.stringify(request.responseSchema), "utf8");
  }
  return bytes;
};

/** Estimate tokens for a single UTF-8 text block using the shared heuristic. */
export const estimateTextTokens = (text: string): number =>
  Math.ceil(
    Buffer.byteLength(text, "utf8") / CONTEXT_BUDGET_ESTIMATOR_BYTES_PER_TOKEN,
  );

/**
 * Estimate the total prompt size in tokens. Text payload uses the shared
 * `bytes / 4` heuristic; image inputs use {@link estimateImageInputTokens}
 * under {@link LlmTokenEstimationOptions.imageTokenStrategy} (default
 * {@link DEFAULT_LLM_IMAGE_TOKEN_STRATEGY}).
 */
export const estimateLlmInputTokens = (
  request: Pick<
    LlmGenerationRequest,
    "systemPrompt" | "userPrompt" | "responseSchema" | "imageInputs"
  >,
  options: LlmTokenEstimationOptions = {},
): number => {
  const strategy =
    options.imageTokenStrategy ?? DEFAULT_LLM_IMAGE_TOKEN_STRATEGY;
  const textTokens = Math.ceil(
    estimateLlmInputBytes(request) / CONTEXT_BUDGET_ESTIMATOR_BYTES_PER_TOKEN,
  );
  let imageTokens = 0;
  for (const image of request.imageInputs ?? []) {
    imageTokens += estimateImageInputTokens(image, strategy);
  }
  return textTokens + imageTokens;
};
