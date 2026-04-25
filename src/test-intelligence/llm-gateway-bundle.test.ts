import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  LLM_CAPABILITIES_ARTIFACT_FILENAME,
  type LlmGatewayCapabilities,
} from "../contracts/index.js";
import {
  createMockLlmGatewayClientBundle,
  probeLlmGatewayClientBundle,
} from "./llm-gateway-bundle.js";

const testGenerationCapabilities: LlmGatewayCapabilities = {
  structuredOutputs: true,
  seedSupport: true,
  reasoningEffortSupport: false,
  maxOutputTokensSupport: true,
  streamingSupport: false,
  imageInputSupport: false,
};

const visualCapabilities: LlmGatewayCapabilities = {
  ...testGenerationCapabilities,
  imageInputSupport: true,
};

const createBundle = () =>
  createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@2026-04-25",
      gatewayRelease: "mock@2026.04",
      declaredCapabilities: testGenerationCapabilities,
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@2026-04-25",
      gatewayRelease: "mock@2026.04",
      declaredCapabilities: visualCapabilities,
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "phi-4-multimodal-poc",
      modelRevision: "phi-4-multimodal-poc@2026-04-25",
      gatewayRelease: "mock@2026.04",
      declaredCapabilities: visualCapabilities,
    },
  });

test("bundle: rejects swapped or under-capable role clients", () => {
  assert.throws(
    () =>
      createMockLlmGatewayClientBundle({
        testGeneration: {
          role: "test_generation",
          deployment: "gpt-oss-120b",
          modelRevision: "rev",
          gatewayRelease: "rel",
          declaredCapabilities: testGenerationCapabilities,
        },
        visualPrimary: {
          role: "visual_fallback",
          deployment: "phi-4-multimodal-poc",
          modelRevision: "rev",
          gatewayRelease: "rel",
          declaredCapabilities: visualCapabilities,
        },
        visualFallback: {
          role: "visual_fallback",
          deployment: "phi-4-multimodal-poc",
          modelRevision: "rev",
          gatewayRelease: "rel",
          declaredCapabilities: visualCapabilities,
        },
      }),
    /visualPrimary must use role visual_primary/,
  );

  assert.throws(
    () =>
      createMockLlmGatewayClientBundle({
        testGeneration: {
          role: "test_generation",
          deployment: "gpt-oss-120b",
          modelRevision: "rev",
          gatewayRelease: "rel",
          declaredCapabilities: testGenerationCapabilities,
        },
        visualPrimary: {
          role: "visual_primary",
          deployment: "llama-4-maverick-vision",
          modelRevision: "rev",
          gatewayRelease: "rel",
          declaredCapabilities: testGenerationCapabilities,
        },
        visualFallback: {
          role: "visual_fallback",
          deployment: "phi-4-multimodal-poc",
          modelRevision: "rev",
          gatewayRelease: "rel",
          declaredCapabilities: visualCapabilities,
        },
      }),
    /visualPrimary must declare image input support/,
  );
});

test("bundle: probes all roles and persists per-role capability evidence", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "llm-bundle-"));
  try {
    const result = await probeLlmGatewayClientBundle({
      bundle: createBundle(),
      jobId: "job-bundle-1",
      generatedAt: "2026-04-25T00:00:00Z",
      destinationDir: dir,
    });

    assert.deepEqual(
      result.artifacts.map((artifact) => artifact.role),
      ["test_generation", "visual_primary", "visual_fallback"],
    );

    for (const entry of result.artifacts) {
      const expectedPath = path.join(
        dir,
        "evidence",
        "llm",
        entry.role,
        LLM_CAPABILITIES_ARTIFACT_FILENAME,
      );
      assert.equal(entry.artifactPath, expectedPath);
      const serialized = await readFile(expectedPath, "utf8");
      assert.equal(serialized.includes("authorization"), false);
      assert.equal(serialized.includes("api-key"), false);
      assert.equal(
        entry.artifact.probes.some(
          (probe) =>
            probe.capability === "textChat" &&
            probe.declared &&
            probe.outcome === "supported",
        ),
        true,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
