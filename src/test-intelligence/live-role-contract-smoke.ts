import type {
  LlmGenerationRequest,
  LlmGatewayErrorClass,
} from "../contracts/index.js";
import { redactHighRiskSecrets } from "../secret-redaction.js";
import { buildA11yJudgeResponseSchema } from "./a11y-judge.js";
import type { LlmGatewayClient } from "./llm-gateway.js";
import type { LlmGatewayClientBundle } from "./llm-gateway-bundle.js";
import { buildLogicJudgeResponseSchema } from "./logic-judge.js";
import {
  buildVisualSidecarResponseSchema,
  VISUAL_SIDECAR_RESPONSE_SCHEMA_NAME,
} from "./visual-sidecar-client.js";

export type LiveRoleContractSmokeRole =
  | "generator"
  | "logic_judge"
  | "coverage_planner"
  | "risk_ranker"
  | "visual_primary"
  | "visual_fallback"
  | "a11y_judge";

export type LiveRoleContractSmokeFailureClass =
  | LlmGatewayErrorClass
  | "schema_invalid_response";

export interface LiveRoleContractSmokeRoleResult {
  readonly role: LiveRoleContractSmokeRole;
  readonly deployment: string;
  readonly status: "ok" | "error" | "skipped";
  readonly failureClass?: LiveRoleContractSmokeFailureClass;
  readonly remediationHint?: string;
  readonly detail?: string;
}

export interface LiveRoleContractSmokeReport {
  readonly ok: boolean;
  readonly results: readonly LiveRoleContractSmokeRoleResult[];
}

interface ProbeDescriptor {
  readonly role: LiveRoleContractSmokeRole;
  readonly client: LlmGatewayClient;
  readonly request: LlmGenerationRequest;
  readonly validateContent: (content: unknown) => string | undefined;
}

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";

const sanitizeDetail = (value: string): string => {
  const redacted = redactHighRiskSecrets(value, "[redacted-secret]").replace(
    /\bhttps?:\/\/\S+/gu,
    "[redacted-url]",
  );
  return redacted.length <= 240 ? redacted : `${redacted.slice(0, 237)}...`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const validateGeneratedTestCaseList = (content: unknown): string | undefined => {
  if (!isRecord(content)) return "expected object root";
  if (content["schemaVersion"] !== "1.1.0") {
    return 'schemaVersion must equal "1.1.0"';
  }
  const testCasesRaw = content["testCases"];
  if (!Array.isArray(testCasesRaw) || testCasesRaw.length === 0) {
    return "testCases must contain at least one entry";
  }
  const testCases: readonly unknown[] = testCasesRaw;
  const [first] = testCases;
  if (!isRecord(first)) return "testCases[0] must be an object";
  if (!isNonEmptyString(first["id"])) return "testCases[0].id must be non-empty";
  if (!isNonEmptyString(first["title"])) {
    return "testCases[0].title must be non-empty";
  }
  if (!Array.isArray(first["steps"]) || first["steps"].length === 0) {
    return "testCases[0].steps must contain at least one entry";
  }
  return undefined;
};

const validateLogicJudgeContent = (content: unknown): string | undefined => {
  if (!isRecord(content)) return "expected object root";
  const verdict = content["verdict"];
  if (
    verdict !== "accept" &&
    verdict !== "repair" &&
    verdict !== "reject"
  ) {
    return "verdict must be accept, repair, or reject";
  }
  if (!Array.isArray(content["findings"])) return "findings must be an array";
  if (!Array.isArray(content["repairInstructions"])) {
    return "repairInstructions must be an array";
  }
  return undefined;
};

const validateCoveragePlannerContent = (content: unknown): string | undefined => {
  if (!isRecord(content)) return "expected object root";
  const plan = content["plan"];
  if (!isRecord(plan)) return "plan must be an object";
  const requirementsRaw = plan["requirements"];
  if (!Array.isArray(requirementsRaw) || requirementsRaw.length === 0) {
    return "plan.requirements must contain at least one entry";
  }
  const requirements: readonly unknown[] = requirementsRaw;
  const [first] = requirements;
  if (!isRecord(first)) return "plan.requirements[0] must be an object";
  if (!isNonEmptyString(first["requirementId"])) {
    return "plan.requirements[0].requirementId must be non-empty";
  }
  if (!Array.isArray(first["targetIds"]) || first["targetIds"].length === 0) {
    return "plan.requirements[0].targetIds must contain at least one entry";
  }
  return undefined;
};

const validateRiskRankerContent = (content: unknown): string | undefined => {
  if (!isRecord(content)) return "expected object root";
  const rankedElementsRaw = content["rankedElements"];
  if (!Array.isArray(rankedElementsRaw) || rankedElementsRaw.length === 0) {
    return "rankedElements must contain at least one entry";
  }
  const rankedElements: readonly unknown[] = rankedElementsRaw;
  const [first] = rankedElements;
  if (!isRecord(first)) return "rankedElements[0] must be an object";
  if (!isNonEmptyString(first["screenId"])) {
    return "rankedElements[0].screenId must be non-empty";
  }
  if (!isNonEmptyString(first["elementId"])) {
    return "rankedElements[0].elementId must be non-empty";
  }
  if (!isFiniteNumber(first["riskScore"])) {
    return "rankedElements[0].riskScore must be numeric";
  }
  return undefined;
};

const validateVisualContent = (content: unknown): string | undefined => {
  if (!isRecord(content)) return "expected object root";
  const screensRaw = content["screens"];
  if (!Array.isArray(screensRaw) || screensRaw.length === 0) {
    return "screens must contain at least one entry";
  }
  const screens: readonly unknown[] = screensRaw;
  const [first] = screens;
  if (!isRecord(first)) return "screens[0] must be an object";
  if (!isNonEmptyString(first["screenId"])) {
    return "screens[0].screenId must be non-empty";
  }
  if (!Array.isArray(first["regions"])) return "screens[0].regions must be an array";
  const summary = first["confidenceSummary"];
  if (!isRecord(summary)) return "screens[0].confidenceSummary must be an object";
  for (const key of ["min", "max", "mean"] as const) {
    if (!isFiniteNumber(summary[key])) {
      return `screens[0].confidenceSummary.${key} must be numeric`;
    }
  }
  return undefined;
};

const validateA11yContent = (content: unknown): string | undefined => {
  if (!isRecord(content)) return "expected object root";
  const criteriaRaw = content["criteria"];
  if (!Array.isArray(criteriaRaw) || criteriaRaw.length === 0) {
    return "criteria must contain at least one entry";
  }
  const criteria: readonly unknown[] = criteriaRaw;
  const [first] = criteria;
  if (!isRecord(first)) return "criteria[0] must be an object";
  if (!isNonEmptyString(first["criterionId"])) {
    return "criteria[0].criterionId must be non-empty";
  }
  if (
    first["verdict"] !== "covered_passes" &&
    first["verdict"] !== "covered_weakly" &&
    first["verdict"] !== "not_covered"
  ) {
    return "criteria[0].verdict must be a valid a11y verdict";
  }
  if (!isNonEmptyString(first["rationale"])) {
    return "criteria[0].rationale must be non-empty";
  }
  return undefined;
};

const buildRoleDescriptors = (
  bundle: LlmGatewayClientBundle,
): readonly ProbeDescriptor[] => {
  const descriptors: ProbeDescriptor[] = [
    {
      role: "generator",
      client: bundle.testGeneration,
      request: {
        jobId: "live-role-contract-generator",
        systemPrompt:
          "You are a production generator role smoke probe. Return only JSON that matches the supplied schema.",
        userPrompt:
          "Return exactly one minimal test-case list with one test case and one step.",
        responseSchema: {
          type: "object",
          additionalProperties: false,
          required: ["schemaVersion", "testCases"],
          properties: {
            schemaVersion: { type: "string", const: "1.1.0" },
            testCases: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "title", "steps"],
                properties: {
                  id: { type: "string", minLength: 1 },
                  title: { type: "string", minLength: 1 },
                  steps: {
                    type: "array",
                    minItems: 1,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["action", "expectedResult"],
                      properties: {
                        action: { type: "string", minLength: 1 },
                        expectedResult: { type: "string", minLength: 1 },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responseSchemaName: "workspace-dev-live-role-contract-generator-v1",
      },
      validateContent: validateGeneratedTestCaseList,
    },
    {
      role: "visual_primary",
      client: bundle.visualPrimary,
      request: {
        jobId: "live-role-contract-visual-primary",
        systemPrompt:
          "You are a visual-primary role smoke probe. Return only JSON that matches the supplied schema.",
        userPrompt:
          "Inspect the image and return exactly one screen with screenId screen-1, an empty regions array, and a numeric confidenceSummary.",
        responseSchema: buildVisualSidecarResponseSchema(),
        responseSchemaName: VISUAL_SIDECAR_RESPONSE_SCHEMA_NAME,
        imageInputs: [{ mimeType: "image/png", base64Data: TINY_PNG_BASE64 }],
      },
      validateContent: validateVisualContent,
    },
    {
      role: "visual_fallback",
      client: bundle.visualFallback,
      request: {
        jobId: "live-role-contract-visual-fallback",
        systemPrompt:
          "You are a visual-fallback role smoke probe. Return only JSON that matches the supplied schema.",
        userPrompt:
          "Inspect the image and return exactly one screen with screenId screen-1, an empty regions array, and a numeric confidenceSummary.",
        responseSchema: buildVisualSidecarResponseSchema(),
        responseSchemaName: VISUAL_SIDECAR_RESPONSE_SCHEMA_NAME,
        imageInputs: [{ mimeType: "image/png", base64Data: TINY_PNG_BASE64 }],
      },
      validateContent: validateVisualContent,
    },
  ];

  if (bundle.logicJudge !== undefined) {
    descriptors.push({
      role: "logic_judge",
      client: bundle.logicJudge,
      request: {
        jobId: "live-role-contract-logic-judge",
        systemPrompt:
          "You are a logic-judge role smoke probe. Return only JSON that matches the supplied schema.",
        userPrompt:
          "Return verdict accept with empty findings and empty repairInstructions.",
        responseSchema: buildLogicJudgeResponseSchema(),
        responseSchemaName: "workspace-dev-logic-judge-v1",
      },
      validateContent: validateLogicJudgeContent,
    });
  }

  if (bundle.coveragePlanner !== undefined) {
    descriptors.push({
      role: "coverage_planner",
      client: bundle.coveragePlanner,
      request: {
        jobId: "live-role-contract-coverage-planner",
        systemPrompt:
          "You are a coverage-planner role smoke probe. Return only JSON that matches the supplied schema.",
        userPrompt:
          "Return exactly one minimal plan requirement for screen-1 and field-1.",
        responseSchema: {
          type: "object",
          additionalProperties: false,
          required: ["plan"],
          properties: {
            plan: {
              type: "object",
              additionalProperties: false,
              required: ["requirements"],
              properties: {
                requirements: {
                  type: "array",
                  minItems: 1,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: [
                      "requirementId",
                      "technique",
                      "reasonCode",
                      "targetIds",
                    ],
                    properties: {
                      requirementId: { type: "string", minLength: 1 },
                      technique: { type: "string", enum: ["equivalence_partitioning"] },
                      reasonCode: { type: "string", enum: ["rule_partition"] },
                      screenId: { type: "string", minLength: 1 },
                      targetIds: {
                        type: "array",
                        items: { type: "string", minLength: 1 },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responseSchemaName: "workspace-dev-live-role-contract-coverage-planner-v1",
      },
      validateContent: validateCoveragePlannerContent,
    });
  }

  if (bundle.riskRanker !== undefined) {
    descriptors.push({
      role: "risk_ranker",
      client: bundle.riskRanker,
      request: {
        jobId: "live-role-contract-risk-ranker",
        systemPrompt:
          "You are a risk-ranker role smoke probe. Return only JSON that matches the supplied schema.",
        userPrompt:
          "Return exactly one ranked element for screen-1 and field-1 with a riskScore between 0 and 1.",
        responseSchema: {
          type: "object",
          additionalProperties: false,
          required: ["rankedElements"],
          properties: {
            rankedElements: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["screenId", "elementId", "riskScore", "rationale"],
                properties: {
                  screenId: { type: "string", minLength: 1 },
                  elementId: { type: "string", minLength: 1 },
                  riskScore: { type: "number", minimum: 0, maximum: 1 },
                  rationale: { type: "string", enum: ["baseline"] },
                },
              },
            },
          },
        },
        responseSchemaName: "workspace-dev-live-role-contract-risk-ranker-v1",
      },
      validateContent: validateRiskRankerContent,
    });
  }

  if (bundle.a11yJudge !== undefined) {
    descriptors.push({
      role: "a11y_judge",
      client: bundle.a11yJudge,
      request: {
        jobId: "live-role-contract-a11y-judge",
        systemPrompt:
          "You are an a11y-judge role smoke probe. Return only JSON that matches the supplied schema.",
        userPrompt:
          "Inspect the image and return exactly one criterion with criterionId screen-1::perceivable, verdict covered_passes, and a short rationale.",
        responseSchema: buildA11yJudgeResponseSchema(),
        responseSchemaName: "workspace-dev-a11y-judge-v1",
        imageInputs: [{ mimeType: "image/png", base64Data: TINY_PNG_BASE64 }],
      },
      validateContent: validateA11yContent,
    });
  }

  return descriptors;
};

export const remediationHintForFailure = (input: {
  role: LiveRoleContractSmokeRole;
  failureClass: LiveRoleContractSmokeFailureClass;
}): string => {
  switch (input.failureClass) {
    case "image_payload_rejected":
      return `${input.role} must use a multimodal chat-completion deployment that accepts image inputs.`;
    case "protocol":
      return `${input.role} must use a deployment compatible with chat-completion style JSON responses.`;
    case "schema_invalid":
    case "schema_invalid_response":
      return `${input.role} must return strict JSON that matches the role contract; replace or repair deployments that emit invalid envelopes.`;
    case "refusal":
      return `${input.role} refused the probe; verify provider policy settings and prompt compatibility for this role.`;
    case "timeout":
    case "transport":
    case "rate_limited":
      return `${input.role} could not complete the probe reliably; verify endpoint health, quota, and retry after the transient condition clears.`;
    case "input_budget_exceeded":
    case "response_too_large":
      return `${input.role} exceeded the smoke budget; keep the probe prompt minimal or repair the deployment's token accounting.`;
    case "incomplete":
      return `${input.role} returned an incomplete response; verify the deployment supports strict JSON output for this role.`;
    case "canceled":
      return `${input.role} was canceled before completing the probe; re-run once the caller-side interruption is cleared.`;
  }
};

export const runLiveRoleContractSmoke = async (
  bundle: LlmGatewayClientBundle,
): Promise<LiveRoleContractSmokeReport> => {
  const results: LiveRoleContractSmokeRoleResult[] = [];
  for (const descriptor of buildRoleDescriptors(bundle)) {
    const response = await descriptor.client.generate(descriptor.request);
    if (response.outcome !== "success") {
      results.push({
        role: descriptor.role,
        deployment: descriptor.client.deployment,
        status: "error",
        failureClass: response.errorClass,
        remediationHint: remediationHintForFailure({
          role: descriptor.role,
          failureClass: response.errorClass,
        }),
        detail: sanitizeDetail(response.message),
      });
      continue;
    }
    const parseError = descriptor.validateContent(response.content);
    if (parseError !== undefined) {
      results.push({
        role: descriptor.role,
        deployment: descriptor.client.deployment,
        status: "error",
        failureClass: "schema_invalid_response",
        remediationHint: remediationHintForFailure({
          role: descriptor.role,
          failureClass: "schema_invalid_response",
        }),
        detail: parseError,
      });
      continue;
    }
    results.push({
      role: descriptor.role,
      deployment: descriptor.client.deployment,
      status: "ok",
    });
  }
  return {
    ok: results.every((entry) => entry.status === "ok"),
    results,
  };
};

export const formatLiveRoleContractSmokeReport = (
  report: LiveRoleContractSmokeReport,
): string =>
  report.results
    .map((entry) => {
      if (entry.status === "ok") {
        return `[ti-live-contract] ${entry.role}: ok (${entry.deployment})`;
      }
      const parts = [
        `[ti-live-contract] ${entry.role}: error (${entry.deployment})`,
        `failureClass=${entry.failureClass ?? "unknown"}`,
      ];
      if (entry.remediationHint !== undefined) {
        parts.push(`hint=${entry.remediationHint}`);
      }
      if (entry.detail !== undefined) {
        parts.push(`detail=${entry.detail}`);
      }
      return parts.join(" | ");
    })
    .join("\n");
