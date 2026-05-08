import {
  ALLOWED_LLM_CONSTRAINED_DECODING_ADAPTER_IDS,
  type LlmConstrainedDecodingAdapterId,
  type LlmConstrainedDecodingEnforcement,
  type LlmConstrainedDecodingMetadata,
  type LlmGatewayClientConfig,
  type LlmGatewayWireStructuredOutputMode,
} from "../contracts/index.js";

const DEFAULT_ADAPTER_VERSION = "1" as const;

interface ConstrainedDecodingAdapter {
  readonly id: LlmConstrainedDecodingAdapterId;
  readonly enforcement: LlmConstrainedDecodingEnforcement;
  readonly defaultWireMode: LlmGatewayWireStructuredOutputMode;
  supports(input: {
    wireMode: LlmGatewayWireStructuredOutputMode;
  }): { ok: true } | { ok: false; reason: string };
}

const ADAPTERS: Readonly<Record<LlmConstrainedDecodingAdapterId, ConstrainedDecodingAdapter>> =
  {
    openai_json_schema: {
      id: "openai_json_schema",
      enforcement: "provider",
      defaultWireMode: "json_schema",
      supports: ({ wireMode }) =>
        wireMode === "json_schema"
          ? { ok: true }
          : { ok: false, reason: "openai_json_schema requires wire mode json_schema" },
    },
    openai_json_object: {
      id: "openai_json_object",
      enforcement: "provider",
      defaultWireMode: "json_object",
      supports: ({ wireMode }) =>
        wireMode === "json_object"
          ? { ok: true }
          : { ok: false, reason: "openai_json_object requires wire mode json_object" },
    },
    prompt_only: {
      id: "prompt_only",
      enforcement: "prompt_only",
      defaultWireMode: "none",
      supports: () => ({ ok: true }),
    },
    outlines: {
      id: "outlines",
      enforcement: "sampler",
      defaultWireMode: "json_schema",
      supports: ({ wireMode }) =>
        wireMode === "json_schema"
          ? { ok: true }
          : { ok: false, reason: "outlines adapter currently requires wire mode json_schema" },
    },
    llguidance: {
      id: "llguidance",
      enforcement: "sampler",
      defaultWireMode: "none",
      supports: () => ({
        ok: false,
        reason:
          "llguidance adapter is not yet available on the openai_chat transport; falling back to prompt-only generation",
      }),
    },
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
  const wireMode =
    config.wireStructuredOutputMode ?? DEFAULT_WIRE_MODE;
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
  const preferred = ADAPTERS[resolved.preferredAdapterId];
  const supported = preferred.supports({
    wireMode: resolved.wireMode,
  });
  if (supported.ok) {
    return {
      requested: true,
      adapterId: preferred.id,
      enforcement: preferred.enforcement,
      wireMode: resolved.wireMode,
      fallback: false,
      ...(resolved.adapterVersion !== undefined
        ? { adapterVersion: resolved.adapterVersion }
        : {}),
    };
  }
  const fallback = ADAPTERS[resolved.fallbackAdapterId];
  return {
    requested: true,
    adapterId: fallback.id,
    enforcement: fallback.enforcement,
    wireMode: fallback.defaultWireMode,
    fallback: true,
    fallbackReason: supported.reason,
    ...(resolved.adapterVersion !== undefined
      ? { adapterVersion: resolved.adapterVersion }
      : { adapterVersion: DEFAULT_ADAPTER_VERSION }),
  };
};

export const isKnownConstrainedDecodingAdapterId = (
  value: string,
): value is LlmConstrainedDecodingAdapterId =>
  (ALLOWED_LLM_CONSTRAINED_DECODING_ADAPTER_IDS as readonly string[]).includes(
    value,
  );
