#!/usr/bin/env tsx

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  buildJudgeMetricObservations,
  appendDriftBaselineRecord,
  computeDriftCanaryMetrics,
  createFileDriftAlertSink,
  DRIFT_CANARY_CANARY_SET_ID,
  DRIFT_CANARY_HOLDOUT_FIXTURE_IDS,
  familyForDeployment,
  type CanaryFixtureRun,
  loadDriftBaselineState,
  PROVIDER_FINGERPRINT_PROMPTS,
  runProviderFingerprintCanary,
  writeDriftBaselineState,
  writeDriftReport,
  evaluateDriftReport,
} from "../src/test-intelligence/drift-canary.js";
import { loadBaselineArchetypeFixture } from "../src/test-intelligence/baseline-fixtures.js";
import {
  buildJudgeCalibrationEvalArtifact,
  loadAllJudgeCalibrationFixtures,
} from "../src/test-intelligence/judge-calibration-eval.js";
import type {
  FigmaRestFileSnapshot,
  FigmaRestNode,
} from "../src/test-intelligence/figma-rest-adapter.js";
import type { IntentDerivationFigmaInput } from "../src/test-intelligence/intent-derivation.js";
import {
  buildProductionRoleClientConfig,
  createProductionRoleClient,
  createProductionTopologyClientBundle,
} from "../src/test-intelligence/production-topology-clients.js";
import { runFigmaToQcTestCases } from "../src/test-intelligence/production-runner.js";
import { runFaithfulnessJudge } from "../src/test-intelligence/faithfulness-judge.js";
import { runLogicJudge } from "../src/test-intelligence/logic-judge.js";
import type { LlmGatewayRuntime } from "../src/test-intelligence/llm-gateway.js";

const DEFAULT_OUTPUT_ROOT = "artifacts/testing/drift-canary";
const DEFAULT_RUNTIME_ROOT = ".workspace-dev";
const DEFAULT_GENERATOR_DEPLOYMENT = "mistral-large-3";
const DEFAULT_CROSS_FAMILY_DEPLOYMENT = "gpt-oss-120b";
const DEFAULT_GATEWAY_RELEASE = "azure-ai-foundry-drift-canary";
const DEFAULT_MODEL_REVISION_SUFFIX = "drift-canary";
const DEFAULT_POLICY_PROFILE_ID = "eu-banking-default";
const DEFAULT_TENANT_ID = "default";

const readRequiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const readOptionalEnv = (name: string, fallback: string): string => {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
};

const parseArgs = (
  argv: ReadonlyArray<string>,
): { outputRoot: string; runtimeRoot: string } => {
  let outputRoot = DEFAULT_OUTPUT_ROOT;
  let runtimeRoot = DEFAULT_RUNTIME_ROOT;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output-root") {
      outputRoot = argv[index + 1] ?? outputRoot;
      index += 1;
      continue;
    }
    if (arg === "--runtime-root") {
      runtimeRoot = argv[index + 1] ?? runtimeRoot;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--output-root=")) {
      outputRoot = arg.slice("--output-root=".length);
      continue;
    }
    if (arg?.startsWith("--runtime-root=")) {
      runtimeRoot = arg.slice("--runtime-root=".length);
    }
  }
  return { outputRoot, runtimeRoot };
};

const inferFaithfulnessFindingCodes = (
  fixtureId: string,
  verdict: Awaited<ReturnType<typeof runFaithfulnessJudge>>["verdict"],
): readonly string[] => {
  if (verdict.hallucinations.length === 0 && verdict.mismatches.length === 0) {
    return [];
  }
  if (fixtureId.includes("phantom-button")) {
    return ["hallucination_invented_button"];
  }
  if (fixtureId.includes("invented-screen")) {
    return ["hallucination_invented_screen"];
  }
  if (fixtureId.includes("label-mismatch")) {
    return ["mismatch_label_text"];
  }
  if (fixtureId.includes("cropped-control")) {
    return ["mismatch_cropped_control"];
  }
  if (fixtureId.includes("numeric-format")) {
    return ["mismatch_numeric_format"];
  }
  if (fixtureId.includes("low-contrast")) {
    return ["mismatch_visual_contrast"];
  }
  return [
    ...new Set([
      ...verdict.hallucinations.map(() => "hallucination"),
      ...verdict.mismatches.map(() => "mismatch"),
    ]),
  ].sort((left, right) => left.localeCompare(right));
};

const buildSyntheticScreenNode = (
  screen: IntentDerivationFigmaInput["screens"][number],
): FigmaRestNode => {
  const children: FigmaRestNode[] = screen.nodes.map((node, index) => {
    const y = 48 + index * 88;
    const bbox = {
      x: 40,
      y,
      width: 960,
      height: node.nodeType === "BUTTON" ? 56 : 40,
    };
    const text = node.text?.trim() || node.nodeName;
    switch (node.nodeType) {
      case "BUTTON":
        return {
          id: node.nodeId,
          name: `${text} button`,
          type: "INSTANCE",
          characters: text,
          absoluteBoundingBox: bbox,
          children: [],
        };
      case "TEXT_INPUT":
        return {
          id: node.nodeId,
          name: `${text} input`,
          type: "INSTANCE",
          characters: text,
          absoluteBoundingBox: bbox,
          children: [],
        };
      case "RADIO_OPTION":
        return {
          id: node.nodeId,
          name: `${text} radio option`,
          type: "INSTANCE",
          characters: text,
          absoluteBoundingBox: bbox,
          children: [],
        };
      case "SELECT_FIELD":
        return {
          id: node.nodeId,
          name: `${text} select field`,
          type: "INSTANCE",
          characters: text,
          absoluteBoundingBox: bbox,
          children: [],
        };
      case "RESULT_DISPLAY":
        return {
          id: node.nodeId,
          name: `${text} result`,
          type: "TEXT",
          characters: text,
          absoluteBoundingBox: bbox,
        };
      case "INFORMATIVE_LABEL":
        return {
          id: node.nodeId,
          name: `${text} label`,
          type: "TEXT",
          characters: text,
          absoluteBoundingBox: bbox,
        };
      default:
        return {
          id: node.nodeId,
          name: node.nodeName,
          type: "TEXT",
          characters: text,
          absoluteBoundingBox: bbox,
        };
    }
  });
  return {
    id: screen.screenId,
    name: screen.screenName,
    type: "FRAME",
    absoluteBoundingBox: {
      x: 0,
      y: 0,
      width: 1080,
      height: Math.max(640, 120 + children.length * 88),
    },
    children,
  };
};

const buildSyntheticRestSnapshot = (input: {
  fixtureId: string;
  fixture: IntentDerivationFigmaInput;
  name: string;
}): FigmaRestFileSnapshot => ({
  name: input.name,
  fileKey: input.fixtureId,
  document: {
    id: input.fixtureId,
    name: input.name,
    type: "DOCUMENT",
    children: input.fixture.screens.map(buildSyntheticScreenNode),
  },
});

const main = async (): Promise<void> => {
  const { outputRoot, runtimeRoot } = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const runDir = resolve(outputRoot, generatedAt.replace(/[:.]/g, "-"));
  await mkdir(runDir, { recursive: true });

  const apiKey = readRequiredEnv("WORKSPACE_TEST_SPACE_LLM_API_KEY");
  const endpoint = readRequiredEnv("WORKSPACE_TEST_SPACE_MODEL_ENDPOINT");
  const visualEndpoint = readRequiredEnv(
    "WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT",
  );
  const generatorDeployment = readOptionalEnv(
    "WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT",
    DEFAULT_GENERATOR_DEPLOYMENT,
  );
  const logicJudgeDeployment = readOptionalEnv(
    "WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT",
    generatorDeployment,
  );
  const crossFamilyDeployment = readOptionalEnv(
    "WORKSPACE_TEST_SPACE_DRIFT_CANARY_CROSS_FAMILY_DEPLOYMENT",
    DEFAULT_CROSS_FAMILY_DEPLOYMENT,
  );
  const visualPrimaryDeployment = readRequiredEnv(
    "WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT",
  );
  const visualFallbackDeployment = readRequiredEnv(
    "WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT",
  );

  const runtime: LlmGatewayRuntime = {
    apiKeyProvider: () => apiKey,
  };

  const generatorDeployments = [
    generatorDeployment,
    ...(crossFamilyDeployment === generatorDeployment
      ? []
      : [crossFamilyDeployment]),
  ];

  const canaryRuns: CanaryFixtureRun[] = [];
  for (const deployment of generatorDeployments) {
    for (const fixtureId of DRIFT_CANARY_HOLDOUT_FIXTURE_IDS) {
      const fixture = await loadBaselineArchetypeFixture(fixtureId);
      const client = createProductionRoleClient(
        buildProductionRoleClientConfig({
          role: "test_generation",
          endpoint,
          deployment,
          modelRevisionSuffix: DEFAULT_MODEL_REVISION_SUFFIX,
          gatewayRelease: DEFAULT_GATEWAY_RELEASE,
        }),
        runtime,
      );
      const result = await runFigmaToQcTestCases({
        jobId: `drift-canary-${deployment}-${fixtureId}`,
        generatedAt,
        outputRoot: runDir,
        source: {
          kind: "figma_rest_file",
          file: buildSyntheticRestSnapshot({
            fixtureId,
            fixture: fixture.figma,
            name: fixture.summary.archetype,
          }),
        },
        llm: {
          client,
          maxOutputTokens: 8_192,
        },
      });
      canaryRuns.push({
        deployment,
        fixtureId,
        fixture: fixture.figma,
        result,
      });
    }
  }

  const runByDeployment = new Map<string, CanaryFixtureRun[]>();
  for (const run of canaryRuns) {
    const bucket = runByDeployment.get(run.deployment) ?? [];
    bucket.push(run);
    runByDeployment.set(run.deployment, bucket);
  }

  const observations = [
    ...[...runByDeployment.entries()].flatMap(([deployment, runs]) =>
      computeDriftCanaryMetrics({ deployment, runs }),
    ),
  ];

  const logicJudgeClient = createProductionRoleClient(
    buildProductionRoleClientConfig({
      role: "logic_judge",
      endpoint,
      deployment: logicJudgeDeployment,
      modelRevisionSuffix: DEFAULT_MODEL_REVISION_SUFFIX,
      gatewayRelease: DEFAULT_GATEWAY_RELEASE,
    }),
    runtime,
  );
  const visualBundle = createProductionTopologyClientBundle(
    {
      endpoint,
      visualEndpoint,
      deployment: generatorDeployment,
      visualPrimaryDeployment,
      visualFallbackDeployment,
      modelRevisionSuffix: DEFAULT_MODEL_REVISION_SUFFIX,
      gatewayRelease: DEFAULT_GATEWAY_RELEASE,
      logicJudgeDeployment,
    },
    runtime,
  );

  const calibrationFixtures = await loadAllJudgeCalibrationFixtures();
  const logicSamples = [];
  const faithfulnessSamples = [];
  for (const fixture of calibrationFixtures) {
    if (fixture.judge === "logic") {
      const input = fixture.input.input as {
        testDesignModel: Parameters<typeof runLogicJudge>[0]["testDesignModel"];
        coveragePlan: Parameters<typeof runLogicJudge>[0]["coveragePlan"];
        generatedTestCases: Parameters<typeof runLogicJudge>[0]["generatedTestCases"];
      };
      const result = await runLogicJudge({
        jobId: `drift-canary-logic-${fixture.id}`,
        generatedAt,
        testDesignModel: input.testDesignModel,
        coveragePlan: input.coveragePlan,
        generatedTestCases: input.generatedTestCases,
        client: logicJudgeClient,
        maxRetries: 0,
      });
      logicSamples.push({
        fixtureId: fixture.id,
        judge: fixture.judge,
        scenarioKind: fixture.gold.scenarioKind,
        humanVerdict: fixture.gold.humanVerdict,
        humanFindingCodes: fixture.gold.humanFindingCodes,
        predictedVerdict: result.verdict.verdict,
        predictedFindingCodes: [
          ...new Set(result.verdict.findings.map((finding) => finding.code)),
        ].sort((left, right) => left.localeCompare(right)),
      });
      continue;
    }

    const input = fixture.input.input as {
      captures: Parameters<typeof runFaithfulnessJudge>[0]["captures"];
      generatedTestCases: Parameters<typeof runFaithfulnessJudge>[0]["generatedTestCases"];
    };
    const result = await runFaithfulnessJudge({
      jobId: `drift-canary-faithfulness-${fixture.id}`,
      generatedAt,
      captures: input.captures,
      generatedTestCases: input.generatedTestCases,
      bundle: visualBundle,
      maxRetries: 0,
    });
    faithfulnessSamples.push({
      fixtureId: fixture.id,
      judge: fixture.judge,
      scenarioKind: fixture.gold.scenarioKind,
      humanVerdict: fixture.gold.humanVerdict,
      humanFindingCodes: fixture.gold.humanFindingCodes,
      predictedVerdict: result.verdict.refusal ? "reject" : result.verdict.verdict,
      predictedFindingCodes: inferFaithfulnessFindingCodes(
        fixture.id,
        result.verdict,
      ),
    });
  }

  const logicArtifact = buildJudgeCalibrationEvalArtifact({
    judge: "logic",
    samples: logicSamples,
    generatedAt,
  });
  const faithfulnessArtifact = buildJudgeCalibrationEvalArtifact({
    judge: "faithfulness",
    samples: faithfulnessSamples,
    generatedAt,
  });

  observations.push(
    ...buildJudgeMetricObservations(logicArtifact).map((observation) => ({
      ...observation,
      deployment: logicJudgeDeployment,
      family: familyForDeployment(logicJudgeDeployment),
    })),
    ...buildJudgeMetricObservations(faithfulnessArtifact).map(
      (observation) => ({
        ...observation,
        deployment: visualPrimaryDeployment,
        family: familyForDeployment(visualPrimaryDeployment),
      }),
    ),
  );

  const providerFingerprints = [
    ...(await Promise.all(
      generatorDeployments.map((deployment) =>
        runProviderFingerprintCanary({
          deployment,
          family: familyForDeployment(deployment),
          role: "test_generation",
          client: createProductionRoleClient(
            buildProductionRoleClientConfig({
              role: "test_generation",
              endpoint,
              deployment,
              modelRevisionSuffix: DEFAULT_MODEL_REVISION_SUFFIX,
              gatewayRelease: DEFAULT_GATEWAY_RELEASE,
            }),
            runtime,
          ),
          prompts: PROVIDER_FINGERPRINT_PROMPTS,
        }),
      ),
    )).then((entries) => entries.flat()),
    ...(await runProviderFingerprintCanary({
      deployment: logicJudgeDeployment,
      family: familyForDeployment(logicJudgeDeployment),
      role: "logic_judge",
      client: logicJudgeClient,
      prompts: PROVIDER_FINGERPRINT_PROMPTS,
    })),
    ...(await runProviderFingerprintCanary({
      deployment: visualPrimaryDeployment,
      family: familyForDeployment(visualPrimaryDeployment),
      role: "visual_primary",
      client: visualBundle.visualPrimary,
      prompts: PROVIDER_FINGERPRINT_PROMPTS,
    })),
    ...(await runProviderFingerprintCanary({
      deployment: visualFallbackDeployment,
      family: familyForDeployment(visualFallbackDeployment),
      role: "visual_fallback",
      client: visualBundle.visualFallback,
      prompts: PROVIDER_FINGERPRINT_PROMPTS,
    })),
  ];

  const baseline = await loadDriftBaselineState({
    runtimeRoot: resolve(runtimeRoot),
    tenantId: DEFAULT_TENANT_ID,
    policyProfileId: DEFAULT_POLICY_PROFILE_ID,
    canarySetId: DRIFT_CANARY_CANARY_SET_ID,
  });
  const evaluation = evaluateDriftReport({
    baseline,
    observations,
    providerFingerprints,
  });
  const report = {
    schemaVersion: "1.0.0" as const,
    generatedAt,
    canarySetId: DRIFT_CANARY_CANARY_SET_ID,
    holdoutFixtureIds: DRIFT_CANARY_HOLDOUT_FIXTURE_IDS,
    observations,
    providerFingerprints,
    findings: evaluation.findings,
    baselineStatus: evaluation.baselineStatus,
  };

  await writeDriftReport({ runDir, report });
  const sink = createFileDriftAlertSink(runDir);
  await sink.publish({
    schemaVersion: "1.0.0" as const,
    generatedAt,
    canarySetId: DRIFT_CANARY_CANARY_SET_ID,
    alerts: evaluation.findings,
  });
  const nextBaseline = appendDriftBaselineRecord(baseline, {
    recordedAt: generatedAt,
    observations,
    providerFingerprints,
  });
  await writeDriftBaselineState({
    runtimeRoot: resolve(runtimeRoot),
    tenantId: DEFAULT_TENANT_ID,
    policyProfileId: DEFAULT_POLICY_PROFILE_ID,
    canarySetId: DRIFT_CANARY_CANARY_SET_ID,
    state: nextBaseline,
  });

  if (evaluation.findings.length > 0) {
    process.stderr.write(
      `drift-canary: ${evaluation.findings.length} alert(s) detected; see ${join(
        runDir,
        "drift-alerts.json",
      )}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `drift-canary: no drift alerts; report written to ${join(
      runDir,
      "drift-report.json",
    )}\n`,
  );
};

main().catch((error) => {
  process.stderr.write(
    `drift-canary failed: ${
      error instanceof Error ? error.stack ?? error.message : String(error)
    }\n`,
  );
  process.exit(1);
});
