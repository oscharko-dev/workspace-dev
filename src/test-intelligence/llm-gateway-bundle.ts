import path from "node:path";
import {
  type LlmCapabilitiesArtifact,
  type LlmGatewayClientConfig,
  type LlmGatewayRole,
} from "../contracts/index.js";
import {
  LLM_CAPABILITIES_ARTIFACT_FILENAME,
  probeLlmCapabilities,
  writeLlmCapabilitiesArtifact,
} from "./llm-capability-probe.js";
import {
  createLlmGatewayClient,
  type LlmGatewayClient,
  type LlmGatewayRuntime,
} from "./llm-gateway.js";
import {
  createMockLlmGatewayClient,
  type CreateMockLlmGatewayClientInput,
} from "./llm-mock-gateway.js";

export interface LlmGatewayClientBundle {
  testGeneration: LlmGatewayClient;
  visualPrimary: LlmGatewayClient;
  visualFallback: LlmGatewayClient;
  /**
   * Optional dedicated client for the cross-model logic judge (Issue #1932).
   * When set, the production runner sends logic-judge prompts here instead of
   * reusing `testGeneration`, which restores the multi-agent harness's
   * cross-model voting property. The client must declare role
   * `"logic_judge"` and must NOT advertise image-input support — the logic
   * judge consumes structured JSON only.
   *
   * When undefined (the default), callers fall back to `testGeneration` so
   * existing operator configurations keep working unchanged.
   */
  logicJudge?: LlmGatewayClient;
  /**
   * Optional dedicated client for the Coverage-Planner augmentation
   * (Issue #1934). When set, the production runner may ask this smaller model
   * to raise per-screen technique quotas or elevate per-element risk classes
   * on top of the deterministic baseline plan.
   *
   * The client must declare role `"coverage_planner"` and must NOT advertise
   * image-input support because the planner consumes structured JSON only.
   */
  coveragePlanner?: LlmGatewayClient;
}

export interface LlmGatewayClientBundleConfigs {
  testGeneration: LlmGatewayClientConfig;
  visualPrimary: LlmGatewayClientConfig;
  visualFallback: LlmGatewayClientConfig;
  logicJudge?: LlmGatewayClientConfig;
  coveragePlanner?: LlmGatewayClientConfig;
}

export interface MockLlmGatewayClientBundleInputs {
  testGeneration: CreateMockLlmGatewayClientInput;
  visualPrimary: CreateMockLlmGatewayClientInput;
  visualFallback: CreateMockLlmGatewayClientInput;
  logicJudge?: CreateMockLlmGatewayClientInput;
  coveragePlanner?: CreateMockLlmGatewayClientInput;
}

export interface LlmGatewayBundleProbeArtifact {
  role: LlmGatewayRole;
  artifact: LlmCapabilitiesArtifact;
  artifactPath?: string;
}

export interface LlmGatewayBundleProbeResult {
  artifacts: ReadonlyArray<LlmGatewayBundleProbeArtifact>;
}

const ROLE_ORDER = [
  "test_generation",
  "visual_primary",
  "visual_fallback",
  "logic_judge",
  "coverage_planner",
] as const;

const assertRole = ({
  actual,
  expected,
  label,
}: {
  actual: LlmGatewayRole;
  expected: LlmGatewayRole;
  label: string;
}): void => {
  if (actual !== expected) {
    throw new RangeError(
      `LlmGatewayClientBundle: ${label} must use role ${expected}`,
    );
  }
};

const assertBundle = (bundle: LlmGatewayClientBundle): void => {
  assertRole({
    actual: bundle.testGeneration.role,
    expected: "test_generation",
    label: "testGeneration",
  });
  assertRole({
    actual: bundle.visualPrimary.role,
    expected: "visual_primary",
    label: "visualPrimary",
  });
  assertRole({
    actual: bundle.visualFallback.role,
    expected: "visual_fallback",
    label: "visualFallback",
  });
  if (bundle.testGeneration.declaredCapabilities.imageInputSupport) {
    throw new RangeError(
      "LlmGatewayClientBundle: testGeneration must not declare image input support",
    );
  }
  if (!bundle.visualPrimary.declaredCapabilities.imageInputSupport) {
    throw new RangeError(
      "LlmGatewayClientBundle: visualPrimary must declare image input support",
    );
  }
  if (!bundle.visualFallback.declaredCapabilities.imageInputSupport) {
    throw new RangeError(
      "LlmGatewayClientBundle: visualFallback must declare image input support",
    );
  }
  if (bundle.logicJudge !== undefined) {
    assertRole({
      actual: bundle.logicJudge.role,
      expected: "logic_judge",
      label: "logicJudge",
    });
    if (bundle.logicJudge.declaredCapabilities.imageInputSupport) {
      throw new RangeError(
        "LlmGatewayClientBundle: logicJudge must not declare image input support",
      );
    }
  }
  if (bundle.coveragePlanner !== undefined) {
    assertRole({
      actual: bundle.coveragePlanner.role,
      expected: "coverage_planner",
      label: "coveragePlanner",
    });
    if (bundle.coveragePlanner.declaredCapabilities.imageInputSupport) {
      throw new RangeError(
        "LlmGatewayClientBundle: coveragePlanner must not declare image input support",
      );
    }
  }
};

export const createLlmGatewayClientBundle = (
  configs: LlmGatewayClientBundleConfigs,
  runtime: LlmGatewayRuntime = {},
): LlmGatewayClientBundle => {
  const bundle: LlmGatewayClientBundle = {
    testGeneration: createLlmGatewayClient(configs.testGeneration, runtime),
    visualPrimary: createLlmGatewayClient(configs.visualPrimary, runtime),
    visualFallback: createLlmGatewayClient(configs.visualFallback, runtime),
    ...(configs.logicJudge !== undefined
      ? { logicJudge: createLlmGatewayClient(configs.logicJudge, runtime) }
      : {}),
    ...(configs.coveragePlanner !== undefined
      ? {
          coveragePlanner: createLlmGatewayClient(
            configs.coveragePlanner,
            runtime,
          ),
        }
      : {}),
  };
  assertBundle(bundle);
  return bundle;
};

export const createMockLlmGatewayClientBundle = (
  inputs: MockLlmGatewayClientBundleInputs,
): LlmGatewayClientBundle => {
  const bundle: LlmGatewayClientBundle = {
    testGeneration: createMockLlmGatewayClient(inputs.testGeneration),
    visualPrimary: createMockLlmGatewayClient(inputs.visualPrimary),
    visualFallback: createMockLlmGatewayClient(inputs.visualFallback),
    ...(inputs.logicJudge !== undefined
      ? { logicJudge: createMockLlmGatewayClient(inputs.logicJudge) }
      : {}),
    ...(inputs.coveragePlanner !== undefined
      ? { coveragePlanner: createMockLlmGatewayClient(inputs.coveragePlanner) }
      : {}),
  };
  assertBundle(bundle);
  return bundle;
};

export const probeLlmGatewayClientBundle = async ({
  bundle,
  jobId,
  generatedAt,
  destinationDir,
}: {
  bundle: LlmGatewayClientBundle;
  jobId: string;
  generatedAt: string;
  destinationDir?: string;
}): Promise<LlmGatewayBundleProbeResult> => {
  assertBundle(bundle);
  const byRole: Partial<Record<LlmGatewayRole, LlmGatewayClient>> = {
    test_generation: bundle.testGeneration,
    visual_primary: bundle.visualPrimary,
    visual_fallback: bundle.visualFallback,
    ...(bundle.logicJudge !== undefined
      ? { logic_judge: bundle.logicJudge }
      : {}),
    ...(bundle.coveragePlanner !== undefined
      ? { coverage_planner: bundle.coveragePlanner }
      : {}),
  };
  const artifacts: LlmGatewayBundleProbeArtifact[] = [];
  for (const role of ROLE_ORDER) {
    const client = byRole[role];
    if (client === undefined) continue;
    const { artifact } = await probeLlmCapabilities({
      client,
      jobId,
      generatedAt,
    });
    const artifactPath =
      destinationDir === undefined
        ? undefined
        : path.join(
            destinationDir,
            "evidence",
            "llm",
            role,
            LLM_CAPABILITIES_ARTIFACT_FILENAME,
          );
    if (artifactPath !== undefined) {
      await writeLlmCapabilitiesArtifact({
        artifact,
        destinationPath: artifactPath,
      });
    }
    artifacts.push({
      role,
      artifact,
      ...(artifactPath !== undefined ? { artifactPath } : {}),
    });
  }
  return { artifacts };
};
