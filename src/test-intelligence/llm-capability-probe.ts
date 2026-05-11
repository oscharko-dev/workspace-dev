/**
 * LLM gateway capability probe (Issue #1363).
 *
 * The probe answers: "for the configured deployment, which of the declared
 * capabilities does the gateway accept end-to-end?". The result is persisted
 * verbatim as `llm-capabilities.json` next to the job's other evidence so a
 * later replay can verify that capability discovery was performed and that
 * the same set of capabilities was honored.
 *
 * The probe is deliberately conservative: it issues at most one minimal
 * request per declared capability, treats every non-success response as an
 * `unsupported`/`probe_failed` row rather than aborting, and never logs
 * tokens, headers, or response bodies.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  LLM_CAPABILITIES_SCHEMA_VERSION,
  LLM_GATEWAY_CONTRACT_VERSION,
  type LlmCapabilitiesArtifact,
  type LlmCapabilityProbeCapability,
  type LlmCapabilityProbeOutcome,
  type LlmCapabilityProbeRecord,
  type LlmGatewayCapabilities,
  type LlmGenerationRequest,
  type LlmGenerationResult,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import type { LlmGatewayClient } from "./llm-gateway.js";

export { LLM_CAPABILITIES_ARTIFACT_FILENAME } from "../contracts/index.js";

export interface LlmCapabilityProbeInput {
  client: LlmGatewayClient;
  jobId: string;
  generatedAt: string;
  /**
   * Override the capability set to probe. Defaults to the client's declared
   * capabilities. Streaming is intentionally never probed: the Wave 1
   * pipeline consumes only the final structured envelope, so it is recorded
   * as untested even when declared.
   */
  capabilitiesUnderTest?: LlmGatewayCapabilities;
  /**
   * Optional probe-prompt override. Useful for fixtures and tests that want
   * to assert request shape. The probe builds a minimal prompt by default.
   */
  probePromptBuilder?: (
    capability: LlmCapabilityProbeCapability,
  ) => Pick<LlmGenerationRequest, "systemPrompt" | "userPrompt">;
}

export interface LlmCapabilityProbeResult {
  artifact: LlmCapabilitiesArtifact;
  records: ReadonlyArray<LlmCapabilityProbeRecord>;
}

/**
 * The order is fixed so the persisted artifact is deterministic. `textChat`
 * is a mandatory baseline probe for every role. Streaming is omitted by
 * design because Wave 1 never consumes streamed chunks.
 */
const NETWORK_PROBED_CAPABILITIES: ReadonlyArray<LlmCapabilityProbeCapability> =
  [
    "textChat",
    "structuredOutputs",
    "seedSupport",
    "reasoningEffortSupport",
    "maxOutputTokensSupport",
    "imageInputSupport",
  ];

const PROBE_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: { ack: { type: "string", enum: ["ok"] } },
  required: ["ack"],
};

const defaultProbePrompt = (
  capability: LlmCapabilityProbeCapability,
): Pick<LlmGenerationRequest, "systemPrompt" | "userPrompt"> => ({
  systemPrompt:
    "You are a capability-probe sentinel. Reply only with the requested JSON object.",
  userPrompt: `Capability under test: ${capability}. Reply with {"ack":"ok"}.`,
});

const buildProbeRequest = ({
  capability,
  jobId,
  prompt,
}: {
  capability: LlmCapabilityProbeCapability;
  jobId: string;
  prompt: Pick<LlmGenerationRequest, "systemPrompt" | "userPrompt">;
}): LlmGenerationRequest => {
  const base: LlmGenerationRequest = {
    jobId,
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
  };
  switch (capability) {
    case "textChat":
      return base;
    case "structuredOutputs":
      base.responseSchema = PROBE_RESPONSE_SCHEMA;
      base.responseSchemaName = "workspace-dev-capability-probe-v1";
      return base;
    case "seedSupport":
      base.seed = 7;
      return base;
    case "reasoningEffortSupport":
      base.reasoningEffort = "low";
      return base;
    case "maxOutputTokensSupport":
      base.maxOutputTokens = 32;
      return base;
    case "imageInputSupport":
      base.imageInputs = [
        {
          mimeType: "image/png",
          // 1×1 transparent PNG fixture; deterministic and contains no PII.
          base64Data:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
        },
      ];
      return base;
    case "streamingSupport":
      return base;
  }
};

const outcomeFromResult = (
  declared: boolean,
  result: LlmGenerationResult,
): { outcome: LlmCapabilityProbeOutcome; detail?: string } => {
  if (!declared) {
    return { outcome: "untested", detail: "capability not declared" };
  }
  if (result.outcome === "success") return { outcome: "supported" };
  if (
    result.errorClass === "image_payload_rejected" ||
    result.errorClass === "schema_invalid" ||
    result.errorClass === "refusal" ||
    result.errorClass === "incomplete" ||
    result.errorClass === "input_budget_exceeded" ||
    result.errorClass === "response_too_large"
  ) {
    return {
      outcome: "unsupported",
      detail: `gateway rejected probe: ${result.errorClass}`,
    };
  }
  return {
    outcome: "probe_failed",
    detail: `transport-class failure: ${result.errorClass}`,
  };
};

/**
 * Run the probe. Always resolves; per-capability failures become
 * `probe_failed`/`unsupported` rows rather than thrown errors.
 */
export const probeLlmCapabilities = async (
  input: LlmCapabilityProbeInput,
): Promise<LlmCapabilityProbeResult> => {
  const declared = input.capabilitiesUnderTest ?? {
    ...input.client.declaredCapabilities,
  };
  const buildPrompt = input.probePromptBuilder ?? defaultProbePrompt;

  const records: LlmCapabilityProbeRecord[] = [];

  for (const capability of NETWORK_PROBED_CAPABILITIES) {
    const isDeclared = capability === "textChat" ? true : declared[capability];
    if (!isDeclared) {
      records.push({
        capability,
        declared: false,
        outcome: "untested",
        detail: "capability not declared",
      });
      continue;
    }
    if (
      capability === "imageInputSupport" &&
      input.client.role === "test_generation"
    ) {
      records.push({
        capability,
        declared: true,
        outcome: "unsupported",
        detail:
          "test_generation role rejects image payloads by policy; probe skipped",
      });
      continue;
    }
    const request = buildProbeRequest({
      capability,
      jobId: input.jobId,
      prompt: buildPrompt(capability),
    });
    const result = await input.client.generate(request);
    const { outcome, detail } = outcomeFromResult(true, result);
    records.push({
      capability,
      declared: true,
      outcome,
      ...(detail !== undefined ? { detail } : {}),
    });
  }

  // Streaming row is recorded but never network-probed. Do not mark support
  // without observed evidence.
  records.push({
    capability: "streamingSupport",
    declared: declared.streamingSupport,
    outcome: "untested",
    detail: declared.streamingSupport
      ? "declared; streaming is opt-in and not network-probed by Wave 1"
      : "capability not declared",
  });

  records.sort((a, b) =>
    a.capability < b.capability ? -1 : a.capability > b.capability ? 1 : 0,
  );

  const artifact: LlmCapabilitiesArtifact = {
    schemaVersion: LLM_CAPABILITIES_SCHEMA_VERSION,
    contractVersion: LLM_GATEWAY_CONTRACT_VERSION,
    generatedAt: input.generatedAt,
    jobId: input.jobId,
    role: input.client.role,
    compatibilityMode: input.client.compatibilityMode,
    deployment: input.client.deployment,
    modelRevision: input.client.modelRevision,
    gatewayRelease: input.client.gatewayRelease,
    ...(input.client.modelWeightsSha256 !== undefined
      ? { modelWeightsSha256: input.client.modelWeightsSha256 }
      : {}),
    capabilities: { ...declared },
    probes: records,
  };

  return { artifact, records };
};

/**
 * Serialize the artifact deterministically. The result is the exact bytes
 * persisted to disk and hashed into evidence manifests.
 */
export const serializeLlmCapabilitiesArtifact = (
  artifact: LlmCapabilitiesArtifact,
): string => canonicalJson(artifact);

/**
 * Persist the artifact to the supplied directory using the canonical
 * filename (`llm-capabilities.json`). Writes are atomic: a tmp file is
 * written first and renamed into place so a crashed write never publishes
 * a partial artifact.
 */
export const writeLlmCapabilitiesArtifact = async ({
  artifact,
  destinationPath,
}: {
  artifact: LlmCapabilitiesArtifact;
  destinationPath: string;
}): Promise<void> => {
  const serialized = serializeLlmCapabilitiesArtifact(artifact);
  await mkdir(dirname(destinationPath), { recursive: true });
  const tmpPath = `${destinationPath}.${process.pid}.tmp`;
  await writeFile(tmpPath, serialized, "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(tmpPath, destinationPath);
};
