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
}

export interface LlmGatewayClientBundleConfigs {
  testGeneration: LlmGatewayClientConfig;
  visualPrimary: LlmGatewayClientConfig;
  visualFallback: LlmGatewayClientConfig;
}

export interface MockLlmGatewayClientBundleInputs {
  testGeneration: CreateMockLlmGatewayClientInput;
  visualPrimary: CreateMockLlmGatewayClientInput;
  visualFallback: CreateMockLlmGatewayClientInput;
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
};

export const createLlmGatewayClientBundle = (
  configs: LlmGatewayClientBundleConfigs,
  runtime: LlmGatewayRuntime = {},
): LlmGatewayClientBundle => {
  const bundle: LlmGatewayClientBundle = {
    testGeneration: createLlmGatewayClient(configs.testGeneration, runtime),
    visualPrimary: createLlmGatewayClient(configs.visualPrimary, runtime),
    visualFallback: createLlmGatewayClient(configs.visualFallback, runtime),
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
  const byRole: Record<LlmGatewayRole, LlmGatewayClient> = {
    test_generation: bundle.testGeneration,
    visual_primary: bundle.visualPrimary,
    visual_fallback: bundle.visualFallback,
  };
  const artifacts: LlmGatewayBundleProbeArtifact[] = [];
  for (const role of ROLE_ORDER) {
    const client = byRole[role];
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
