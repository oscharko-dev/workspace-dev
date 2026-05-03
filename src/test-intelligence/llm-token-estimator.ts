import {
  CONTEXT_BUDGET_ESTIMATOR_BYTES_PER_TOKEN,
  type LlmGenerationRequest,
} from "../contracts/index.js";

/**
 * Shared, allocation-light token estimator for prompt-size budgeting.
 *
 * The estimator intentionally mirrors the same byte-counting heuristic used
 * by the gateway and mock gateway so the budget checks stay aligned across
 * all call sites.
 */
export const estimateLlmInputBytes = (
  request: Pick<
    LlmGenerationRequest,
    "systemPrompt" | "userPrompt" | "responseSchema" | "imageInputs"
  >,
): number => {
  let bytes =
    Buffer.byteLength(request.systemPrompt, "utf8") +
    Buffer.byteLength(request.userPrompt, "utf8");
  if (request.responseSchema !== undefined) {
    bytes += Buffer.byteLength(JSON.stringify(request.responseSchema), "utf8");
  }
  for (const image of request.imageInputs ?? []) {
    bytes += image.base64Data.length;
  }
  return bytes;
};

/** Estimate tokens for a single UTF-8 text block using the shared heuristic. */
export const estimateTextTokens = (text: string): number =>
  Math.ceil(
    Buffer.byteLength(text, "utf8") / CONTEXT_BUDGET_ESTIMATOR_BYTES_PER_TOKEN,
  );

/** Estimate the total prompt size in tokens using the shared heuristic. */
export const estimateLlmInputTokens = (
  request: Pick<
    LlmGenerationRequest,
    "systemPrompt" | "userPrompt" | "responseSchema" | "imageInputs"
  >,
): number => {
  return Math.ceil(
    estimateLlmInputBytes(request) /
      CONTEXT_BUDGET_ESTIMATOR_BYTES_PER_TOKEN,
  );
};
