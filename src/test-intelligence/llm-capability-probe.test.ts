import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  LLM_CAPABILITIES_ARTIFACT_FILENAME,
  LLM_CAPABILITIES_SCHEMA_VERSION,
  LLM_GATEWAY_CONTRACT_VERSION,
  type LlmCapabilitiesArtifact,
  type LlmGatewayCapabilities,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  probeLlmCapabilities,
  serializeLlmCapabilitiesArtifact,
  writeLlmCapabilitiesArtifact,
} from "./llm-capability-probe.js";
import { createMockLlmGatewayClient } from "./llm-mock-gateway.js";

const fullCapabilities: LlmGatewayCapabilities = {
  structuredOutputs: true,
  seedSupport: true,
  reasoningEffortSupport: true,
  maxOutputTokensSupport: true,
  streamingSupport: true,
  imageInputSupport: false,
};

test("probe: declared capabilities marked supported when responder always succeeds", async () => {
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    modelRevision: "rev",
    gatewayRelease: "rel",
    declaredCapabilities: fullCapabilities,
  });
  const { artifact, records } = await probeLlmCapabilities({
    client,
    jobId: "job-probe-1",
    generatedAt: "2026-04-25T00:00:00Z",
    capabilitiesUnderTest: fullCapabilities,
  });
  assert.equal(artifact.schemaVersion, LLM_CAPABILITIES_SCHEMA_VERSION);
  assert.equal(artifact.contractVersion, LLM_GATEWAY_CONTRACT_VERSION);
  assert.equal(artifact.role, "test_generation");
  assert.equal(artifact.deployment, "gpt-oss-120b");
  // imageInputSupport is false in fullCapabilities, so it is untested.
  // streamingSupport is recorded as declared but never network-probed.
  for (const record of records) {
    if (record.capability === "imageInputSupport") {
      assert.equal(record.outcome, "untested");
    } else if (record.capability === "streamingSupport") {
      assert.equal(record.outcome, "supported");
    } else {
      assert.equal(record.outcome, "supported");
    }
  }
});

test("probe: probes are sorted alphabetically and deterministic", async () => {
  const client = createMockLlmGatewayClient({
    role: "visual_primary",
    deployment: "llama-4-maverick-vision",
    modelRevision: "rev",
    gatewayRelease: "rel",
    declaredCapabilities: { ...fullCapabilities, imageInputSupport: true },
  });
  const { records } = await probeLlmCapabilities({
    client,
    jobId: "job-probe-2",
    generatedAt: "2026-04-25T00:00:00Z",
    capabilitiesUnderTest: { ...fullCapabilities, imageInputSupport: true },
  });
  const capabilities = records.map((r) => r.capability);
  const sorted = capabilities.slice().sort();
  assert.deepEqual(capabilities, sorted);
  // every keyof LlmGatewayCapabilities must be represented exactly once
  const expectedKeys: ReadonlyArray<keyof LlmGatewayCapabilities> = [
    "imageInputSupport",
    "maxOutputTokensSupport",
    "reasoningEffortSupport",
    "seedSupport",
    "streamingSupport",
    "structuredOutputs",
  ];
  assert.deepEqual(capabilities, expectedKeys);
});

test("probe: undeclared capability is recorded as untested without invoking client", async () => {
  let calls = 0;
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    modelRevision: "rev",
    gatewayRelease: "rel",
    declaredCapabilities: {
      structuredOutputs: false,
      seedSupport: false,
      reasoningEffortSupport: false,
      maxOutputTokensSupport: false,
      streamingSupport: false,
      imageInputSupport: false,
    },
    responder: (_req, attempt) => {
      calls += 1;
      return {
        outcome: "success",
        content: {},
        finishReason: "stop",
        usage: {},
        modelDeployment: "gpt-oss-120b",
        modelRevision: "rev",
        gatewayRelease: "rel",
        attempt,
      };
    },
  });
  const { records } = await probeLlmCapabilities({
    client,
    jobId: "j",
    generatedAt: "2026-04-25T00:00:00Z",
  });
  assert.equal(calls, 0);
  for (const record of records) {
    assert.equal(record.declared, false);
    assert.equal(record.outcome, "untested");
  }
});

test("probe: gateway returning schema_invalid produces unsupported outcome", async () => {
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    modelRevision: "rev",
    gatewayRelease: "rel",
    declaredCapabilities: { ...fullCapabilities, imageInputSupport: false },
    responder: (_req, attempt) => ({
      outcome: "error",
      errorClass: "schema_invalid",
      message: "no",
      retryable: false,
      attempt,
    }),
  });
  const { records } = await probeLlmCapabilities({
    client,
    jobId: "j",
    generatedAt: "2026-04-25T00:00:00Z",
    capabilitiesUnderTest: { ...fullCapabilities, imageInputSupport: false },
  });
  for (const record of records) {
    if (record.capability === "streamingSupport") continue;
    if (record.capability === "imageInputSupport") continue;
    assert.equal(record.outcome, "unsupported");
  }
});

test("probe: transient failure produces probe_failed outcome", async () => {
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    modelRevision: "rev",
    gatewayRelease: "rel",
    declaredCapabilities: fullCapabilities,
    responder: (_req, attempt) => ({
      outcome: "error",
      errorClass: "timeout",
      message: "slow",
      retryable: true,
      attempt,
    }),
  });
  const { records } = await probeLlmCapabilities({
    client,
    jobId: "j",
    generatedAt: "2026-04-25T00:00:00Z",
  });
  const probeFailed = records.filter((r) => r.outcome === "probe_failed");
  assert.ok(probeFailed.length >= 1);
});

test("probe: serializes deterministically via canonicalJson", async () => {
  const artifact: LlmCapabilitiesArtifact = {
    schemaVersion: LLM_CAPABILITIES_SCHEMA_VERSION,
    contractVersion: LLM_GATEWAY_CONTRACT_VERSION,
    generatedAt: "2026-04-25T00:00:00Z",
    jobId: "j",
    role: "test_generation",
    compatibilityMode: "openai_chat",
    deployment: "gpt-oss-120b",
    modelRevision: "rev",
    gatewayRelease: "rel",
    capabilities: {
      structuredOutputs: true,
      seedSupport: false,
      reasoningEffortSupport: false,
      maxOutputTokensSupport: false,
      streamingSupport: false,
      imageInputSupport: false,
    },
    probes: [],
  };
  const serialized = serializeLlmCapabilitiesArtifact(artifact);
  assert.equal(serialized, canonicalJson(artifact));
  // round-trip equivalence
  const reparsed = JSON.parse(serialized) as LlmCapabilitiesArtifact;
  assert.equal(reparsed.role, "test_generation");
});

test("probe: writeLlmCapabilitiesArtifact persists exact bytes atomically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "llm-cap-"));
  try {
    const artifact: LlmCapabilitiesArtifact = {
      schemaVersion: LLM_CAPABILITIES_SCHEMA_VERSION,
      contractVersion: LLM_GATEWAY_CONTRACT_VERSION,
      generatedAt: "2026-04-25T00:00:00Z",
      jobId: "j",
      role: "visual_primary",
      compatibilityMode: "openai_chat",
      deployment: "llama-4-maverick-vision",
      modelRevision: "rev",
      gatewayRelease: "rel",
      modelWeightsSha256: "a".repeat(64),
      capabilities: {
        structuredOutputs: true,
        seedSupport: false,
        reasoningEffortSupport: false,
        maxOutputTokensSupport: true,
        streamingSupport: false,
        imageInputSupport: true,
      },
      probes: [],
    };
    const destination = join(dir, LLM_CAPABILITIES_ARTIFACT_FILENAME);
    await writeLlmCapabilitiesArtifact({
      artifact,
      destinationPath: destination,
    });
    const content = await readFile(destination, "utf8");
    assert.equal(content, serializeLlmCapabilitiesArtifact(artifact));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("probe: persisted artifact never contains api keys or auth headers", async () => {
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    modelRevision: "rev",
    gatewayRelease: "rel",
    declaredCapabilities: fullCapabilities,
  });
  const { artifact } = await probeLlmCapabilities({
    client,
    jobId: "j",
    generatedAt: "2026-04-25T00:00:00Z",
    capabilitiesUnderTest: fullCapabilities,
  });
  const serialized = serializeLlmCapabilitiesArtifact(artifact);
  assert.equal(/authorization/i.test(serialized), false);
  assert.equal(/api[-_]key/i.test(serialized), false);
  assert.equal(/bearer/i.test(serialized), false);
});
