/**
 * Transport-specific constrained-decoding adapter for the
 * `openai_chat` compatibility mode (Issue #2065).
 *
 * The `openai_chat` transport accepts schema-constrained outputs by
 * delegating shape enforcement to the upstream provider via the
 * `response_format: { type: "json_schema", json_schema: {...} }` hook
 * (and equivalently via tool-calling: a single `function` tool whose
 * `parameters` carry the JSON schema, with `tool_choice` pinned). Both
 * Outlines-style (FSM-bound, schema is reified into a token-level
 * automaton inside a co-located runtime) and llguidance-style
 * (provider-bound, schema is forwarded verbatim and the upstream
 * grammar engine enforces it) integrations sit behind this contract.
 *
 * Adapter selection is deterministic given the operator config — there
 * is no runtime probing or branching; the schema source of truth comes
 * from {@link ../contracts/index.js LlmGenerationRequest.responseSchema}
 * which the gateway already derives from {@link ../contracts/index.js}
 * at compile time.
 */

import type {
  LlmConstrainedDecodingAdapterId,
  LlmConstrainedDecodingEnforcement,
  LlmGatewayCompatibilityMode,
  LlmGatewayWireStructuredOutputMode,
} from "../../contracts/index.js";

/**
 * Internal adapter contract. Mirrors the shape carried by the public
 * {@link ../../contracts/index.js LlmConstrainedDecodingMetadata}
 * envelope but is kept as a private interface so adapter authors are
 * free to evolve adapter-internal state without forcing a contract
 * version bump on every refinement.
 */
export interface ConstrainedDecodingAdapter {
  readonly id: LlmConstrainedDecodingAdapterId;
  readonly enforcement: LlmConstrainedDecodingEnforcement;
  readonly defaultWireMode: LlmGatewayWireStructuredOutputMode;
  /**
   * Adapter-internal version pin. Surfaced as
   * {@link LlmConstrainedDecodingMetadata.adapterVersion} on every
   * resolved metadata record when the operator did not supply an
   * explicit override; downstream FinOps and provenance graphs use it
   * to correlate cost/quality shifts with adapter rollouts.
   */
  readonly version: string;
  supports(input: {
    wireMode: LlmGatewayWireStructuredOutputMode;
    compatibilityMode: LlmGatewayCompatibilityMode;
  }): { ok: true } | { ok: false; reason: string };
}

/**
 * Adapter-version pin for the openai_chat-bound llguidance integration.
 * Bump when the binding semantics change (e.g. tool-calling vs.
 * `response_format`, or grammar-engine handshake).
 */
export const OPENAI_CHAT_LLGUIDANCE_ADAPTER_VERSION = "1" as const;

/**
 * Adapter-version pin for the openai_chat-bound Outlines integration.
 */
export const OPENAI_CHAT_OUTLINES_ADAPTER_VERSION = "1" as const;

const OPENAI_CHAT_MODE = "openai_chat";

const isOpenAiChat = (mode: LlmGatewayCompatibilityMode): boolean =>
  (mode as string) === OPENAI_CHAT_MODE;

/**
 * Build the openai_chat-bound llguidance adapter. Schema enforcement
 * is delegated to the upstream provider (`enforcement: "provider"`),
 * which is the on-the-wire posture of every provider-bound grammar
 * engine reachable via an OpenAI-compatible chat endpoint. The adapter
 * is a value, not a class — it carries no per-call state, so callers
 * can cache the result safely.
 */
export const buildOpenAiChatLlguidanceAdapter =
  (): ConstrainedDecodingAdapter => ({
    id: "llguidance",
    enforcement: "provider",
    defaultWireMode: "json_schema",
    version: OPENAI_CHAT_LLGUIDANCE_ADAPTER_VERSION,
    supports: ({ wireMode, compatibilityMode }) => {
      if (!isOpenAiChat(compatibilityMode)) {
        return {
          ok: false,
          reason:
            "llguidance adapter is bound to the openai_chat compatibility mode",
        };
      }
      if (wireMode !== "json_schema") {
        return {
          ok: false,
          reason:
            "llguidance on openai_chat requires wireStructuredOutputMode=json_schema",
        };
      }
      return { ok: true };
    },
  });

/**
 * Build the openai_chat-bound Outlines adapter. The wire posture is
 * identical to the llguidance variant — the schema is forwarded via
 * `response_format=json_schema`. The two adapters are kept distinct
 * so the FinOps / provenance trail records which integration the
 * operator selected, not just that *some* schema-constrained mode
 * was active.
 */
export const buildOpenAiChatOutlinesAdapter =
  (): ConstrainedDecodingAdapter => ({
    id: "outlines",
    enforcement: "provider",
    defaultWireMode: "json_schema",
    version: OPENAI_CHAT_OUTLINES_ADAPTER_VERSION,
    supports: ({ wireMode, compatibilityMode }) => {
      if (!isOpenAiChat(compatibilityMode)) {
        return {
          ok: false,
          reason:
            "outlines adapter is bound to the openai_chat compatibility mode",
        };
      }
      if (wireMode !== "json_schema") {
        return {
          ok: false,
          reason:
            "outlines on openai_chat requires wireStructuredOutputMode=json_schema",
        };
      }
      return { ok: true };
    },
  });

/**
 * Resolve the openai_chat-bound adapter for a constrained-decoding
 * adapter id, or `undefined` when the id has no openai_chat-bound
 * variant. Callers fall back to the legacy registry entry in that
 * case so unknown ids surface a typed `RangeError` at validation
 * time, not a silent miss here.
 */
export const getOpenAiChatAdapter = (
  adapterId: LlmConstrainedDecodingAdapterId,
): ConstrainedDecodingAdapter | undefined => {
  switch (adapterId) {
    case "llguidance":
      return buildOpenAiChatLlguidanceAdapter();
    case "outlines":
      return buildOpenAiChatOutlinesAdapter();
    case "openai_json_schema":
    case "openai_json_object":
    case "prompt_only":
      return undefined;
    default: {
      const exhaustive: never = adapterId;
      void exhaustive;
      return undefined;
    }
  }
};
