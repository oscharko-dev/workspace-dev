/**
 * Token-estimator regression tests (Issue #1930).
 *
 * Validates that:
 *   - text-only payloads still use the legacy `bytes / 4` rule;
 *   - image inputs default to OpenAI-aligned tile estimation when pixel
 *     dimensions are supplied, dramatically reducing the per-screenshot
 *     token charge that previously drove Visual-Sidecar pre-flight to
 *     reject realistic 1280×720 PNG payloads;
 *   - the Llama-aligned strategy applies the configured tile/base
 *     constants from contracts;
 *   - the `raw_bytes` strategy preserves the legacy behaviour;
 *   - any image missing pixel dimensions falls back to `raw_bytes`
 *     regardless of the requested strategy (back-compat for callers that
 *     have not plumbed dimensions through);
 *   - the gateway pre-flight no longer rejects a realistic Banking-Form
 *     screenshot under `visual_primary.maxInputTokensPerRequest = 40_000`.
 */

import assert from "node:assert/strict";
import test from "node:test";

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
} from "../contracts/index.js";

import {
  estimateImageInputTokens,
  estimateLlmInputBytes,
  estimateLlmInputTokens,
  estimateTextTokens,
} from "./llm-token-estimator.js";

const VISUAL_PRIMARY_MAX_INPUT_TOKENS_PER_REQUEST = 40_000;

const buildRequest = (
  overrides: Partial<LlmGenerationRequest> = {},
): LlmGenerationRequest => ({
  jobId: "job-test-1930",
  systemPrompt: "",
  userPrompt: "",
  ...overrides,
});

const buildImage = (overrides: Partial<LlmImageInput> = {}): LlmImageInput => ({
  mimeType: "image/png",
  base64Data: "",
  ...overrides,
});

const expectedOpenAiTokens = (widthPx: number, heightPx: number): number => {
  const tileArea = LLM_IMAGE_OPENAI_TILE_SIZE_PX * LLM_IMAGE_OPENAI_TILE_SIZE_PX;
  const tiles = Math.ceil((widthPx * heightPx) / tileArea);
  return tiles * LLM_IMAGE_OPENAI_TOKENS_PER_TILE +
    LLM_IMAGE_OPENAI_BASE_TOKENS;
};

const expectedLlamaTokens = (widthPx: number, heightPx: number): number => {
  const tileArea = LLM_IMAGE_LLAMA_TILE_SIZE_PX * LLM_IMAGE_LLAMA_TILE_SIZE_PX;
  const tiles = Math.ceil((widthPx * heightPx) / tileArea);
  return tiles * LLM_IMAGE_LLAMA_TOKENS_PER_TILE +
    LLM_IMAGE_LLAMA_BASE_TOKENS;
};

test("default image strategy is the OpenAI-aligned tile formula", () => {
  assert.equal(DEFAULT_LLM_IMAGE_TOKEN_STRATEGY, "openai_tiles");
});

test("estimateLlmInputBytes counts only text payload (system + user + schema)", () => {
  const request = buildRequest({
    systemPrompt: "system",
    userPrompt: "user",
    responseSchema: { kind: "object" },
    imageInputs: [
      buildImage({
        base64Data: "A".repeat(1024 * 1024),
        widthPx: 1280,
        heightPx: 720,
      }),
    ],
  });
  const expected =
    Buffer.byteLength("system", "utf8") +
    Buffer.byteLength("user", "utf8") +
    Buffer.byteLength(JSON.stringify({ kind: "object" }), "utf8");
  assert.equal(estimateLlmInputBytes(request), expected);
});

test("estimateTextTokens uses the shared bytes-per-token heuristic", () => {
  const text = "A".repeat(17);
  assert.equal(
    estimateTextTokens(text),
    Math.ceil(17 / CONTEXT_BUDGET_ESTIMATOR_BYTES_PER_TOKEN),
  );
});

test("text-only request matches the legacy `bytes / 4` heuristic", () => {
  const request = buildRequest({
    systemPrompt: "A".repeat(1000),
    userPrompt: "B".repeat(2000),
  });
  // 3000 bytes of ASCII text → ceil(3000 / 4) = 750 tokens.
  assert.equal(estimateLlmInputTokens(request), 750);
});

test("openai_tiles: 1280×720 screenshot estimates ≤ 1000 tokens (Issue #1930 AC)", () => {
  const widthPx = 1280;
  const heightPx = 720;
  // A 119 KiB screenshot encoded as base64 ≈ 162 KiB string. Under the
  // legacy `raw_bytes` path that alone charges ~40605 tokens, exceeding
  // `visual_primary.maxInputTokensPerRequest = 40_000`.
  const base64Bytes = Math.ceil((119 * 1024 * 4) / 3);
  const request = buildRequest({
    imageInputs: [
      buildImage({
        base64Data: "A".repeat(base64Bytes),
        widthPx,
        heightPx,
      }),
    ],
  });
  const tokens = estimateLlmInputTokens(request);
  // ceil(1280*720 / 512^2) = ceil(3.516) = 4 tiles → 4*85 + 85 = 425 tokens.
  assert.equal(tokens, expectedOpenAiTokens(widthPx, heightPx));
  assert.ok(
    tokens <= 1000,
    `expected ≤ 1000 tokens for a 1280×720 screenshot under openai_tiles, got ${tokens}`,
  );
  assert.ok(
    tokens < VISUAL_PRIMARY_MAX_INPUT_TOKENS_PER_REQUEST,
    `expected estimate to fit under visual_primary.maxInputTokensPerRequest, got ${tokens}`,
  );
});

test("openai_tiles: small 256×256 thumbnail collapses to a single tile", () => {
  const widthPx = 256;
  const heightPx = 256;
  const tokens = estimateLlmInputTokens(
    buildRequest({
      imageInputs: [
        buildImage({
          base64Data: "A".repeat(256),
          widthPx,
          heightPx,
        }),
      ],
    }),
    { imageTokenStrategy: "openai_tiles" },
  );
  // ceil(256*256 / 512^2) = 1 tile → 1*85 + 85 = 170 tokens.
  assert.equal(tokens, 170);
  assert.equal(tokens, expectedOpenAiTokens(widthPx, heightPx));
});

test("openai_tiles: oversized 4K screenshot scales linearly in tile count", () => {
  const widthPx = 3840;
  const heightPx = 2160;
  const tokens = estimateLlmInputTokens(
    buildRequest({
      imageInputs: [
        buildImage({
          base64Data: "A".repeat(1024),
          widthPx,
          heightPx,
        }),
      ],
    }),
    { imageTokenStrategy: "openai_tiles" },
  );
  // ceil(3840*2160 / 512^2) = ceil(31.64) = 32 tiles → 32*85 + 85 = 2805.
  assert.equal(tokens, expectedOpenAiTokens(widthPx, heightPx));
  assert.equal(tokens, 2805);
});

test("llama_tiles: 1280×720 screenshot uses the Llama tile/base constants", () => {
  const widthPx = 1280;
  const heightPx = 720;
  const tokens = estimateLlmInputTokens(
    buildRequest({
      imageInputs: [
        buildImage({
          base64Data: "A".repeat(2048),
          widthPx,
          heightPx,
        }),
      ],
    }),
    { imageTokenStrategy: "llama_tiles" },
  );
  // ceil(1280*720 / 560^2) = ceil(2.94) = 3 tiles → 3*1601 + 1 = 4804.
  assert.equal(tokens, expectedLlamaTokens(widthPx, heightPx));
  assert.equal(tokens, 4804);
});

test("raw_bytes: explicit override falls back to the legacy byte-based rule", () => {
  const base64Data = "A".repeat(4 * 1024);
  const tokens = estimateLlmInputTokens(
    buildRequest({
      imageInputs: [
        buildImage({
          base64Data,
          widthPx: 1280,
          heightPx: 720,
        }),
      ],
    }),
    { imageTokenStrategy: "raw_bytes" },
  );
  assert.equal(
    tokens,
    Math.ceil(base64Data.length / CONTEXT_BUDGET_ESTIMATOR_BYTES_PER_TOKEN),
  );
});

test("missing pixel dimensions force raw_bytes fallback even with a tile strategy", () => {
  const base64Data = "A".repeat(8 * 1024);
  const tokens = estimateLlmInputTokens(
    buildRequest({
      imageInputs: [
        buildImage({
          base64Data,
        }),
      ],
    }),
    { imageTokenStrategy: "openai_tiles" },
  );
  assert.equal(
    tokens,
    Math.ceil(base64Data.length / CONTEXT_BUDGET_ESTIMATOR_BYTES_PER_TOKEN),
  );
});

test("non-positive pixel dimensions fall back to raw_bytes", () => {
  const base64Data = "A".repeat(2048);
  const tokens = estimateLlmInputTokens(
    buildRequest({
      imageInputs: [
        buildImage({ base64Data, widthPx: 0, heightPx: 720 }),
        buildImage({ base64Data, widthPx: 1280, heightPx: -1 }),
      ],
    }),
    { imageTokenStrategy: "openai_tiles" },
  );
  const perImage = Math.ceil(
    base64Data.length / CONTEXT_BUDGET_ESTIMATOR_BYTES_PER_TOKEN,
  );
  assert.equal(tokens, perImage * 2);
});

test("mixed payload sums text tokens + per-image tile tokens", () => {
  const systemPrompt = "S".repeat(400);
  const userPrompt = "U".repeat(400);
  const tokens = estimateLlmInputTokens(
    buildRequest({
      systemPrompt,
      userPrompt,
      imageInputs: [
        buildImage({
          base64Data: "A".repeat(512),
          widthPx: 800,
          heightPx: 600,
        }),
        buildImage({
          base64Data: "A".repeat(512),
          widthPx: 1024,
          heightPx: 1024,
        }),
      ],
    }),
  );
  const expectedTextTokens = Math.ceil(
    (Buffer.byteLength(systemPrompt, "utf8") +
      Buffer.byteLength(userPrompt, "utf8")) /
      CONTEXT_BUDGET_ESTIMATOR_BYTES_PER_TOKEN,
  );
  const expectedImageTokens =
    expectedOpenAiTokens(800, 600) + expectedOpenAiTokens(1024, 1024);
  assert.equal(tokens, expectedTextTokens + expectedImageTokens);
});

test("estimateImageInputTokens helper matches the request-level estimate per image", () => {
  const image = buildImage({
    base64Data: "A".repeat(256),
    widthPx: 1280,
    heightPx: 720,
  });
  const helperTokens = estimateImageInputTokens(image, "openai_tiles");
  const requestTokens = estimateLlmInputTokens(
    buildRequest({ imageInputs: [image] }),
    { imageTokenStrategy: "openai_tiles" },
  );
  // Request adds ceil(0/4) = 0 text tokens for empty system/user prompts.
  assert.equal(helperTokens, requestTokens);
  assert.equal(helperTokens, expectedOpenAiTokens(1280, 720));
});

test("default strategy applies when options are omitted entirely", () => {
  const widthPx = 1024;
  const heightPx = 768;
  const tokens = estimateLlmInputTokens(
    buildRequest({
      imageInputs: [
        buildImage({
          base64Data: "A".repeat(2048),
          widthPx,
          heightPx,
        }),
      ],
    }),
  );
  assert.equal(tokens, expectedOpenAiTokens(widthPx, heightPx));
});
