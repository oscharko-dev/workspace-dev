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

test("bundle: optional logicJudge slot accepts a logic_judge client and rejects miswired roles (Issue #1932)", () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "mistral-large-3",
      modelRevision: "rev",
      gatewayRelease: "rel",
      declaredCapabilities: testGenerationCapabilities,
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "llama-4-maverick-vision",
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
    logicJudge: {
      role: "logic_judge",
      deployment: "gpt-oss-120b",
      modelRevision: "rev",
      gatewayRelease: "rel",
      declaredCapabilities: testGenerationCapabilities,
    },
  });
  assert.equal(bundle.logicJudge?.role, "logic_judge");
  assert.equal(bundle.logicJudge?.deployment, "gpt-oss-120b");
  assert.notEqual(
    bundle.logicJudge?.deployment,
    bundle.testGeneration.deployment,
    "cross-model topology requires distinct judge deployment",
  );

  assert.throws(
    () =>
      createMockLlmGatewayClientBundle({
        testGeneration: {
          role: "test_generation",
          deployment: "mistral-large-3",
          modelRevision: "rev",
          gatewayRelease: "rel",
          declaredCapabilities: testGenerationCapabilities,
        },
        visualPrimary: {
          role: "visual_primary",
          deployment: "llama-4-maverick-vision",
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
        logicJudge: {
          role: "test_generation",
          deployment: "gpt-oss-120b",
          modelRevision: "rev",
          gatewayRelease: "rel",
          declaredCapabilities: testGenerationCapabilities,
        },
      }),
    /logicJudge must use role logic_judge/,
  );

  assert.throws(
    () =>
      createMockLlmGatewayClientBundle({
        testGeneration: {
          role: "test_generation",
          deployment: "mistral-large-3",
          modelRevision: "rev",
          gatewayRelease: "rel",
          declaredCapabilities: testGenerationCapabilities,
        },
        visualPrimary: {
          role: "visual_primary",
          deployment: "llama-4-maverick-vision",
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
        logicJudge: {
          role: "logic_judge",
          deployment: "gpt-oss-120b",
          modelRevision: "rev",
          gatewayRelease: "rel",
          declaredCapabilities: visualCapabilities,
        },
      }),
    /logicJudge must not declare image input support/,
  );
});

test("bundle: optional testGenerationSecondary slot accepts a second text-only generator client (Issue #2125)", () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "mistral-large-3",
      modelRevision: "rev",
      gatewayRelease: "rel",
      declaredCapabilities: testGenerationCapabilities,
    },
    testGenerationSecondary: {
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
      declaredCapabilities: visualCapabilities,
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "phi-4-multimodal-poc",
      modelRevision: "rev",
      gatewayRelease: "rel",
      declaredCapabilities: visualCapabilities,
    },
  });
  assert.equal(bundle.testGenerationSecondary?.role, "test_generation");
  assert.equal(bundle.testGenerationSecondary?.deployment, "gpt-oss-120b");

  assert.throws(
    () =>
      createMockLlmGatewayClientBundle({
        testGeneration: {
          role: "test_generation",
          deployment: "mistral-large-3",
          modelRevision: "rev",
          gatewayRelease: "rel",
          declaredCapabilities: testGenerationCapabilities,
        },
        testGenerationSecondary: {
          role: "visual_primary",
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
    /testGenerationSecondary must use role test_generation/,
  );
});

test("bundle: optional a11yJudge slot accepts an image-capable a11y_judge client and rejects non-visual configs (Issue #1940)", () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "mistral-large-3",
      modelRevision: "rev",
      gatewayRelease: "rel",
      declaredCapabilities: testGenerationCapabilities,
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "llama-4-maverick-vision",
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
    a11yJudge: {
      role: "a11y_judge",
      deployment: "phi-4-multimodal-instruct",
      modelRevision: "rev",
      gatewayRelease: "rel",
      declaredCapabilities: visualCapabilities,
    },
  });
  assert.equal(bundle.a11yJudge?.role, "a11y_judge");
  assert.equal(bundle.a11yJudge?.deployment, "phi-4-multimodal-instruct");

  assert.throws(
    () =>
      createMockLlmGatewayClientBundle({
        testGeneration: {
          role: "test_generation",
          deployment: "mistral-large-3",
          modelRevision: "rev",
          gatewayRelease: "rel",
          declaredCapabilities: testGenerationCapabilities,
        },
        visualPrimary: {
          role: "visual_primary",
          deployment: "llama-4-maverick-vision",
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
        a11yJudge: {
          role: "logic_judge",
          deployment: "phi-4-multimodal-instruct",
          modelRevision: "rev",
          gatewayRelease: "rel",
          declaredCapabilities: visualCapabilities,
        },
      }),
    /a11yJudge must use role a11y_judge/,
  );

  assert.throws(
    () =>
      createMockLlmGatewayClientBundle({
        testGeneration: {
          role: "test_generation",
          deployment: "mistral-large-3",
          modelRevision: "rev",
          gatewayRelease: "rel",
          declaredCapabilities: testGenerationCapabilities,
        },
        visualPrimary: {
          role: "visual_primary",
          deployment: "llama-4-maverick-vision",
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
        a11yJudge: {
          role: "a11y_judge",
          deployment: "phi-4-multimodal-instruct",
          modelRevision: "rev",
          gatewayRelease: "rel",
          declaredCapabilities: testGenerationCapabilities,
        },
      }),
    /a11yJudge must declare image input support/,
  );
});

test("bundle: optional coveragePlanner slot accepts a coverage_planner client and rejects image-capable planners (Issue #1934)", () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "mistral-large-3",
      modelRevision: "rev",
      gatewayRelease: "rel",
      declaredCapabilities: testGenerationCapabilities,
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "llama-4-maverick-vision",
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
    coveragePlanner: {
      role: "coverage_planner",
      deployment: "phi-4-mini-instruct",
      modelRevision: "rev",
      gatewayRelease: "rel",
      declaredCapabilities: testGenerationCapabilities,
    },
  });
  assert.equal(bundle.coveragePlanner?.role, "coverage_planner");
  assert.equal(bundle.coveragePlanner?.deployment, "phi-4-mini-instruct");

  assert.throws(
    () =>
      createMockLlmGatewayClientBundle({
        testGeneration: {
          role: "test_generation",
          deployment: "mistral-large-3",
          modelRevision: "rev",
          gatewayRelease: "rel",
          declaredCapabilities: testGenerationCapabilities,
        },
        visualPrimary: {
          role: "visual_primary",
          deployment: "llama-4-maverick-vision",
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
        coveragePlanner: {
          role: "coverage_planner",
          deployment: "phi-4-mini-instruct",
          modelRevision: "rev",
          gatewayRelease: "rel",
          declaredCapabilities: visualCapabilities,
        },
      }),
    /coveragePlanner must not declare image input support/,
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
      "default bundle (no logicJudge slot) probes only the three required roles",
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

test("bundle: probes the logic_judge slot when wired (Issue #1932)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "llm-bundle-judge-"));
  try {
    const bundle = createMockLlmGatewayClientBundle({
      testGeneration: {
        role: "test_generation",
        deployment: "mistral-large-3",
        modelRevision: "mistral-large-3@2026-04-25",
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
      logicJudge: {
        role: "logic_judge",
        deployment: "gpt-oss-120b",
        modelRevision: "gpt-oss-120b@2026-04-25",
        gatewayRelease: "mock@2026.04",
        declaredCapabilities: testGenerationCapabilities,
      },
    });
    const result = await probeLlmGatewayClientBundle({
      bundle,
      jobId: "job-bundle-judge",
      generatedAt: "2026-04-25T00:00:00Z",
      destinationDir: dir,
    });
    assert.deepEqual(
      result.artifacts.map((artifact) => artifact.role),
      ["test_generation", "visual_primary", "visual_fallback", "logic_judge"],
      "cross-model bundle probes the dedicated logic_judge slot",
    );
    const judgeArtifact = result.artifacts.find(
      (artifact) => artifact.role === "logic_judge",
    );
    assert.ok(judgeArtifact !== undefined);
    assert.equal(judgeArtifact.artifact.deployment, "gpt-oss-120b");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bundle: probes the a11y_judge slot when wired (Issue #1940)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "llm-bundle-a11y-"));
  try {
    const bundle = createMockLlmGatewayClientBundle({
      testGeneration: {
        role: "test_generation",
        deployment: "mistral-large-3",
        modelRevision: "mistral-large-3@2026-04-25",
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
      a11yJudge: {
        role: "a11y_judge",
        deployment: "phi-4-multimodal-instruct",
        modelRevision: "phi-4-multimodal-instruct@2026-04-25",
        gatewayRelease: "mock@2026.04",
        declaredCapabilities: visualCapabilities,
      },
    });
    const result = await probeLlmGatewayClientBundle({
      bundle,
      jobId: "job-bundle-a11y",
      generatedAt: "2026-04-25T00:00:00Z",
      destinationDir: dir,
    });
    assert.deepEqual(
      result.artifacts.map((artifact) => artifact.role),
      ["test_generation", "visual_primary", "visual_fallback", "a11y_judge"],
    );
    const judgeArtifact = result.artifacts.find(
      (artifact) => artifact.role === "a11y_judge",
    );
    assert.ok(judgeArtifact !== undefined);
    assert.equal(
      judgeArtifact.artifact.deployment,
      "phi-4-multimodal-instruct",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
