import assert from "node:assert/strict";
import test from "node:test";

import type { LlmGatewayCapabilities } from "../contracts/index.js";
import { createMockLlmGatewayClientBundle } from "./llm-gateway-bundle.js";
import {
  formatLiveRoleContractSmokeReport,
  remediationHintForFailure,
  runLiveRoleContractSmoke,
} from "./live-role-contract-smoke.js";

const textCapabilities: LlmGatewayCapabilities = {
  structuredOutputs: true,
  seedSupport: false,
  reasoningEffortSupport: false,
  maxOutputTokensSupport: true,
  streamingSupport: false,
  imageInputSupport: false,
};

const visualCapabilities: LlmGatewayCapabilities = {
  ...textCapabilities,
  imageInputSupport: true,
};

const createHappyBundle = () =>
  createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "rev",
      gatewayRelease: "rel",
      declaredCapabilities: textCapabilities,
      responder: (request, attempt) => {
        switch (request.responseSchemaName) {
          case "workspace-dev-live-role-contract-generator-v1":
            return {
              outcome: "success",
              content: {
                schemaVersion: "1.1.0",
                testCases: [
                  {
                    id: "TC-1",
                    title: "Happy path",
                    steps: [
                      {
                        action: "Submit the form",
                        expectedResult: "The submission succeeds",
                      },
                    ],
                  },
                ],
              },
              finishReason: "stop",
              usage: {},
              modelDeployment: "gpt-oss-120b",
              modelRevision: "rev",
              gatewayRelease: "rel",
              attempt,
            };
          case "workspace-dev-logic-judge-v1":
            return {
              outcome: "success",
              content: {
                verdict: "accept",
                findings: [],
                repairInstructions: [],
              },
              finishReason: "stop",
              usage: {},
              modelDeployment: "logic-judge",
              modelRevision: "rev",
              gatewayRelease: "rel",
              attempt,
            };
          case "workspace-dev-live-role-contract-coverage-planner-v1":
            return {
              outcome: "success",
              content: {
                plan: {
                  requirements: [
                    {
                      requirementId: "cov-1",
                      technique: "equivalence_partitioning",
                      reasonCode: "rule_partition",
                      screenId: "screen-1",
                      targetIds: ["field-1"],
                    },
                  ],
                },
              },
              finishReason: "stop",
              usage: {},
              modelDeployment: "coverage-planner",
              modelRevision: "rev",
              gatewayRelease: "rel",
              attempt,
            };
          case "workspace-dev-live-role-contract-risk-ranker-v1":
            return {
              outcome: "success",
              content: {
                rankedElements: [
                  {
                    screenId: "screen-1",
                    elementId: "field-1",
                    riskScore: 0.8,
                    rationale: "baseline",
                  },
                ],
              },
              finishReason: "stop",
              usage: {},
              modelDeployment: "risk-ranker",
              modelRevision: "rev",
              gatewayRelease: "rel",
              attempt,
            };
          default:
            return {
              outcome: "success",
              content:
                request.responseSchemaName === "workspace-dev-a11y-judge-v1"
                  ? {
                      criteria: [
                        {
                          criterionId: "screen-1::perceivable",
                          verdict: "covered_passes",
                          rationale: "Covered by existing checks",
                        },
                      ],
                    }
                  : {
                      screens: [
                        {
                          screenId: "screen-1",
                          sidecarDeployment: "mock-visual",
                          regions: [],
                          confidenceSummary: { min: 1, max: 1, mean: 1 },
                        },
                      ],
                    },
              finishReason: "stop",
              usage: {},
              modelDeployment: "mock",
              modelRevision: "rev",
              gatewayRelease: "rel",
              attempt,
            };
        }
      },
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "llama-4-maverick-vision",
      modelRevision: "rev",
      gatewayRelease: "rel",
      declaredCapabilities: visualCapabilities,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          screens: [
            {
              screenId: "screen-1",
              sidecarDeployment: "mock-visual-primary",
              regions: [],
              confidenceSummary: { min: 1, max: 1, mean: 1 },
            },
          ],
        },
        finishReason: "stop",
        usage: {},
        modelDeployment: "mock-visual-primary",
        modelRevision: "rev",
        gatewayRelease: "rel",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "phi-4-multimodal-poc",
      modelRevision: "rev",
      gatewayRelease: "rel",
      declaredCapabilities: visualCapabilities,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          screens: [
            {
              screenId: "screen-1",
              sidecarDeployment: "mock-visual-fallback",
              regions: [],
              confidenceSummary: { min: 1, max: 1, mean: 1 },
            },
          ],
        },
        finishReason: "stop",
        usage: {},
        modelDeployment: "mock-visual-fallback",
        modelRevision: "rev",
        gatewayRelease: "rel",
        attempt,
      }),
    },
    logicJudge: {
      role: "logic_judge",
      deployment: "gpt-oss-120b",
      modelRevision: "rev",
      gatewayRelease: "rel",
      declaredCapabilities: textCapabilities,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "accept",
          findings: [],
          repairInstructions: [],
        },
        finishReason: "stop",
        usage: {},
        modelDeployment: "logic-judge",
        modelRevision: "rev",
        gatewayRelease: "rel",
        attempt,
      }),
    },
    coveragePlanner: {
      role: "coverage_planner",
      deployment: "mistral-small",
      modelRevision: "rev",
      gatewayRelease: "rel",
      declaredCapabilities: textCapabilities,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          plan: {
            requirements: [
              {
                requirementId: "cov-1",
                technique: "equivalence_partitioning",
                reasonCode: "rule_partition",
                screenId: "screen-1",
                targetIds: ["field-1"],
              },
            ],
          },
        },
        finishReason: "stop",
        usage: {},
        modelDeployment: "coverage-planner",
        modelRevision: "rev",
        gatewayRelease: "rel",
        attempt,
      }),
    },
    riskRanker: {
      role: "risk_ranker",
      deployment: "mistral-small",
      modelRevision: "rev",
      gatewayRelease: "rel",
      declaredCapabilities: textCapabilities,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          rankedElements: [
            {
              screenId: "screen-1",
              elementId: "field-1",
              riskScore: 0.8,
              rationale: "baseline",
            },
          ],
        },
        finishReason: "stop",
        usage: {},
        modelDeployment: "risk-ranker",
        modelRevision: "rev",
        gatewayRelease: "rel",
        attempt,
      }),
    },
    a11yJudge: {
      role: "a11y_judge",
      deployment: "phi-4-multimodal-poc",
      modelRevision: "rev",
      gatewayRelease: "rel",
      declaredCapabilities: visualCapabilities,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          criteria: [
            {
              criterionId: "screen-1::perceivable",
              verdict: "covered_passes",
              rationale: "Covered by existing checks",
            },
          ],
        },
        finishReason: "stop",
        usage: {},
        modelDeployment: "a11y-judge",
        modelRevision: "rev",
        gatewayRelease: "rel",
        attempt,
      }),
    },
  });

test("live role contract smoke passes every configured role when mocks return valid shapes", async () => {
  const report = await runLiveRoleContractSmoke(createHappyBundle());
  assert.equal(report.ok, true);
  assert.equal(
    report.results.every((entry) => entry.status === "ok"),
    true,
  );
});

test("live role contract smoke classifies gateway failures with remediation hints", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "rev",
      gatewayRelease: "rel",
      declaredCapabilities: textCapabilities,
      responder: (_request, attempt) => ({
        outcome: "error",
        errorClass: "timeout",
        message: "provider timed out while contacting https://example.invalid",
        retryable: true,
        attempt,
      }),
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
  const report = await runLiveRoleContractSmoke(bundle);
  const generator = report.results.find((entry) => entry.role === "generator");
  assert.ok(generator);
  assert.equal(generator?.status, "error");
  assert.equal(generator?.failureClass, "timeout");
  assert.match(generator?.remediationHint ?? "", /endpoint health, quota/);
  assert.doesNotMatch(generator?.detail ?? "", /https:\/\/example\.invalid/);
});

test("live role contract smoke reports protocol failures for incompatible visual deployments", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "rev",
      gatewayRelease: "rel",
      declaredCapabilities: textCapabilities,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          schemaVersion: "1.1.0",
          testCases: [
            {
              id: "TC-1",
              title: "Happy path",
              steps: [
                {
                  action: "Submit",
                  expectedResult: "Success",
                },
              ],
            },
          ],
        },
        finishReason: "stop",
        usage: {},
        modelDeployment: "gpt-oss-120b",
        modelRevision: "rev",
        gatewayRelease: "rel",
        attempt,
      }),
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "rev",
      gatewayRelease: "rel",
      declaredCapabilities: visualCapabilities,
      responder: (_request, attempt) => ({
        outcome: "error",
        errorClass: "protocol",
        message: "chat-completion protocol mismatch",
        retryable: false,
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "phi-4-multimodal-poc",
      modelRevision: "rev",
      gatewayRelease: "rel",
      declaredCapabilities: visualCapabilities,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          screens: [
            {
              screenId: "screen-1",
              sidecarDeployment: "mock-visual-fallback",
              regions: [],
              confidenceSummary: { min: 1, max: 1, mean: 1 },
            },
          ],
        },
        finishReason: "stop",
        usage: {},
        modelDeployment: "mock-visual-fallback",
        modelRevision: "rev",
        gatewayRelease: "rel",
        attempt,
      }),
    },
  });

  const report = await runLiveRoleContractSmoke(bundle);
  const visualPrimary = report.results.find(
    (entry) => entry.role === "visual_primary",
  );
  assert.ok(visualPrimary);
  assert.equal(visualPrimary?.status, "error");
  assert.equal(visualPrimary?.failureClass, "protocol");
  assert.equal(visualPrimary?.deployment, "mistral-document-ai-2512");
  assert.match(
    visualPrimary?.remediationHint ?? "",
    /chat-completion style JSON responses/,
  );
});

test("live role contract smoke classifies success payload drift as schema_invalid_response", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "rev",
      gatewayRelease: "rel",
      declaredCapabilities: textCapabilities,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          schemaVersion: "1.1.0",
          testCases: [
            {
              id: "TC-1",
              title: "Happy path",
              steps: [
                {
                  action: "Submit",
                  expectedResult: "Success",
                },
              ],
            },
          ],
        },
        finishReason: "stop",
        usage: {},
        modelDeployment: "gpt-oss-120b",
        modelRevision: "rev",
        gatewayRelease: "rel",
        attempt,
      }),
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "llama-4-maverick-vision",
      modelRevision: "rev",
      gatewayRelease: "rel",
      declaredCapabilities: visualCapabilities,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          screens: [
            {
              screenId: "screen-1",
              sidecarDeployment: "mock-visual-primary",
              regions: [],
              confidenceSummary: { min: 1, max: 1, mean: 1 },
            },
          ],
        },
        finishReason: "stop",
        usage: {},
        modelDeployment: "mock-visual-primary",
        modelRevision: "rev",
        gatewayRelease: "rel",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "phi-4-multimodal-poc",
      modelRevision: "rev",
      gatewayRelease: "rel",
      declaredCapabilities: visualCapabilities,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          screens: [
            {
              screenId: "screen-1",
              sidecarDeployment: "mock-visual-fallback",
              regions: [],
              confidenceSummary: { min: 1, max: 1, mean: 1 },
            },
          ],
        },
        finishReason: "stop",
        usage: {},
        modelDeployment: "mock-visual-fallback",
        modelRevision: "rev",
        gatewayRelease: "rel",
        attempt,
      }),
    },
    coveragePlanner: {
      role: "coverage_planner",
      deployment: "mistral-small",
      modelRevision: "rev",
      gatewayRelease: "rel",
      declaredCapabilities: textCapabilities,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          plan: {
            requirements: [
              {
                requirementId: "cov-1",
                technique: "equivalence_partitioning",
                reasonCode: "rule_partition",
                screenId: "screen-1",
                targetIds: [],
              },
            ],
          },
        },
        finishReason: "stop",
        usage: {},
        modelDeployment: "coverage-planner",
        modelRevision: "rev",
        gatewayRelease: "rel",
        attempt,
      }),
    },
  });
  const report = await runLiveRoleContractSmoke(bundle);
  const coveragePlanner = report.results.find(
    (entry) => entry.role === "coverage_planner",
  );
  assert.ok(coveragePlanner);
  assert.equal(coveragePlanner?.failureClass, "schema_invalid_response");
  assert.match(
    coveragePlanner?.detail ?? "",
    /targetIds must contain at least one entry/,
  );
});

test("formatLiveRoleContractSmokeReport emits role, deployment, failure class, and hint", () => {
  const report = {
    ok: false,
    results: [
      {
        role: "visual_primary",
        deployment: "mistral-document-ai-2512",
        status: "error" as const,
        failureClass: "protocol" as const,
        remediationHint: remediationHintForFailure({
          role: "visual_primary",
          failureClass: "protocol",
        }),
        detail: "chat-completion protocol mismatch",
      },
    ],
  };
  const formatted = formatLiveRoleContractSmokeReport(report);
  assert.match(formatted, /visual_primary: error/);
  assert.match(formatted, /mistral-document-ai-2512/);
  assert.match(formatted, /failureClass=protocol/);
  assert.match(formatted, /hint=/);
});
