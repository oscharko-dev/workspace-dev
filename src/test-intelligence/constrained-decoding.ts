import {
  ALLOWED_LLM_CONSTRAINED_DECODING_ADAPTER_IDS,
  type LlmConstrainedDecodingAdapterId,
  type LlmConstrainedDecodingMetadata,
  type LlmGatewayClientConfig,
  type LlmGatewayCompatibilityMode,
  type LlmGatewayWireStructuredOutputMode,
} from "../contracts/index.js";
import {
  type ConstrainedDecodingAdapter,
  getOpenAiChatAdapter,
} from "./constrained-decoding/openai-chat-adapter.js";

/**
 * Default adapter-version pin used when the resolved adapter does not
 * surface its own. Kept as a stable string so historical FinOps
 * artifacts referencing `"1"` continue to round-trip without churn.
 */
const DEFAULT_ADAPTER_VERSION = "1" as const;

const LEGACY_ADAPTERS: Readonly<
  Record<LlmConstrainedDecodingAdapterId, ConstrainedDecodingAdapter>
> = {
  openai_json_schema: {
    id: "openai_json_schema",
    enforcement: "provider",
    defaultWireMode: "json_schema",
    version: DEFAULT_ADAPTER_VERSION,
    supports: ({ wireMode }) =>
      wireMode === "json_schema"
        ? { ok: true }
        : {
            ok: false,
            reason: "openai_json_schema requires wire mode json_schema",
          },
  },
  openai_json_object: {
    id: "openai_json_object",
    enforcement: "provider",
    defaultWireMode: "json_object",
    version: DEFAULT_ADAPTER_VERSION,
    supports: ({ wireMode }) =>
      wireMode === "json_object"
        ? { ok: true }
        : {
            ok: false,
            reason: "openai_json_object requires wire mode json_object",
          },
  },
  prompt_only: {
    id: "prompt_only",
    enforcement: "prompt_only",
    defaultWireMode: "none",
    version: DEFAULT_ADAPTER_VERSION,
    supports: () => ({ ok: true }),
  },
  outlines: {
    id: "outlines",
    enforcement: "sampler",
    defaultWireMode: "json_schema",
    version: DEFAULT_ADAPTER_VERSION,
    supports: ({ wireMode }) =>
      wireMode === "json_schema"
        ? { ok: true }
        : {
            ok: false,
            reason: "outlines adapter currently requires wire mode json_schema",
          },
  },
  llguidance: {
    id: "llguidance",
    enforcement: "sampler",
    defaultWireMode: "json_schema",
    version: DEFAULT_ADAPTER_VERSION,
    supports: ({ compatibilityMode }) => ({
      ok: false,
      reason: `llguidance adapter has no binding for compatibility mode ${compatibilityMode}`,
    }),
  },
};

/**
 * Resolve the adapter implementation for an id under a given transport.
 * The openai_chat-bound implementations live in
 * {@link ./constrained-decoding/openai-chat-adapter.js} and supersede
 * the legacy registry entries when the deployment is reachable via the
 * `openai_chat` compatibility mode (Issue #2065).
 */
const resolveAdapter = (
  adapterId: LlmConstrainedDecodingAdapterId,
  compatibilityMode: LlmGatewayCompatibilityMode,
): ConstrainedDecodingAdapter => {
  if ((compatibilityMode as string) === "openai_chat") {
    const transportBound = getOpenAiChatAdapter(adapterId);
    if (transportBound !== undefined) return transportBound;
  }
  return LEGACY_ADAPTERS[adapterId];
};

const DEFAULT_WIRE_MODE: LlmGatewayWireStructuredOutputMode = "json_schema";

const resolveLegacyAdapterId = (
  wireMode: LlmGatewayWireStructuredOutputMode,
): LlmConstrainedDecodingAdapterId => {
  if (wireMode === "json_object") return "openai_json_object";
  if (wireMode === "none") return "prompt_only";
  return "openai_json_schema";
};

export const resolveConfiguredConstrainedDecoding = (
  config: LlmGatewayClientConfig,
): {
  preferredAdapterId: LlmConstrainedDecodingAdapterId;
  fallbackAdapterId: LlmConstrainedDecodingAdapterId;
  adapterVersion?: string;
  wireMode: LlmGatewayWireStructuredOutputMode;
} => {
  const wireMode = config.wireStructuredOutputMode ?? DEFAULT_WIRE_MODE;
  const constrained = config.constrainedDecoding;
  if (constrained === undefined) {
    return {
      preferredAdapterId: resolveLegacyAdapterId(wireMode),
      fallbackAdapterId: "prompt_only",
      wireMode,
    };
  }
  return {
    preferredAdapterId: constrained.preferredAdapter,
    fallbackAdapterId: constrained.fallbackAdapter ?? "prompt_only",
    ...(constrained.adapterVersion !== undefined
      ? { adapterVersion: constrained.adapterVersion }
      : {}),
    wireMode,
  };
};

export const resolveConstrainedDecodingMetadata = (input: {
  config: LlmGatewayClientConfig;
  requestHasSchema: boolean;
}): LlmConstrainedDecodingMetadata | undefined => {
  if (!input.requestHasSchema) return undefined;
  const resolved = resolveConfiguredConstrainedDecoding(input.config);
  const compatibilityMode = input.config.compatibilityMode;
  const preferred = resolveAdapter(
    resolved.preferredAdapterId,
    compatibilityMode,
  );
  const supported = preferred.supports({
    wireMode: resolved.wireMode,
    compatibilityMode,
  });
  if (supported.ok) {
    return {
      requested: true,
      adapterId: preferred.id,
      enforcement: preferred.enforcement,
      wireMode: resolved.wireMode,
      fallback: false,
      adapterVersion: resolved.adapterVersion ?? preferred.version,
    };
  }
  const fallback = resolveAdapter(
    resolved.fallbackAdapterId,
    compatibilityMode,
  );
  return {
    requested: true,
    adapterId: fallback.id,
    enforcement: fallback.enforcement,
    wireMode: fallback.defaultWireMode,
    fallback: true,
    fallbackReason: supported.reason,
    adapterVersion: resolved.adapterVersion ?? fallback.version,
  };
};

export const isKnownConstrainedDecodingAdapterId = (
  value: string,
): value is LlmConstrainedDecodingAdapterId =>
  (ALLOWED_LLM_CONSTRAINED_DECODING_ADAPTER_IDS as readonly string[]).includes(
    value,
  );
