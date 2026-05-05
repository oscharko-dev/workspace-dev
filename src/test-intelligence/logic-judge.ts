import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  ALLOWED_LOGIC_JUDGE_FINDING_SEVERITIES,
  ALLOWED_LOGIC_JUDGE_VERDICTS,
  LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION,
  LOGIC_JUDGE_VERDICT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type CoveragePlan,
  type GeneratedTestCaseList,
  type JudgeFinding,
  type JudgeVerdict,
  type LogicJudgeFindingSeverity,
  type LogicJudgeVerdictLabel,
  type RepairInstruction,
  type TestDesignModel,
  type LlmGenerationRequest,
  type LlmGenerationResult,
} from "../contracts/index.js";
import { sanitizeErrorMessage } from "../error-sanitization.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import type { LlmGatewayClient } from "./llm-gateway.js";

const RESPONSE_SCHEMA_NAME = "workspace-dev-logic-judge-v1" as const;
const MAX_MESSAGE_LENGTH = 240;
const MAX_CODE_LENGTH = 64;
const MAX_PATH_LENGTH = 160;
const MAX_INSTRUCTION_LENGTH = 240;

const SYSTEM_PROMPT = [
  "You are the production logic judge for workspace-dev test-intelligence.",
  "You receive a deterministic TestDesignModel, CoveragePlan, and GeneratedTestCaseList as JSON.",
  "Judge only semantic correctness and traceability. Do not rewrite the test cases.",
  "Return exactly one JSON object matching the supplied schema.",
  "If the case set is sound, emit verdict=accept with empty findings and repairInstructions.",
  "If the case set is fixable, emit verdict=repair with concrete findings and repairInstructions.",
  "If the case set is fundamentally unsound or the evidence is insufficient, emit verdict=reject.",
].join(" ");

export interface LogicJudgePromptArtifact {
  jobId: string;
  systemPrompt: string;
  userPrompt: string;
  responseSchemaName: string;
  responseSchema: Record<string, unknown>;
  hashes: {
    promptHash: string;
    schemaHash: string;
    inputHash: string;
    cacheKeyDigest: string;
  };
  modelBinding: {
    deployment: string;
    modelRevision: string;
    gatewayRelease: string;
  };
}

interface LogicJudgeCacheKey {
  passKind: "logic_judge";
  inputHash: string;
  promptHash: string;
  schemaHash: string;
  modelDeployment: string;
  modelRevision: string;
  gatewayRelease: string;
}

interface LogicJudgeCacheEntry {
  key: string;
  storedAt: string;
  verdict: JudgeVerdict;
}

export interface LogicJudgeReplayCache {
  lookup(
    key: LogicJudgeCacheKey,
  ): Promise<{ hit: false; key: string } | { hit: true; entry: LogicJudgeCacheEntry }>;
  store(key: LogicJudgeCacheKey, verdict: JudgeVerdict): Promise<void>;
}

export interface RunLogicJudgeInput {
  jobId: string;
  generatedAt: string;
  testDesignModel: TestDesignModel;
  coveragePlan: CoveragePlan;
  generatedTestCases: GeneratedTestCaseList;
  client: LlmGatewayClient;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxWallClockMs?: number;
  maxRetries?: number;
  cache?: LogicJudgeReplayCache;
}

export interface RunLogicJudgeResult {
  verdict: JudgeVerdict;
  cacheHit: boolean;
  promptArtifact: LogicJudgePromptArtifact;
  gatewayResult?: LlmGenerationResult;
}

export const buildLogicJudgeResponseSchema = (): Record<string, unknown> => ({
  type: "object",
  additionalProperties: false,
  required: ["verdict", "findings", "repairInstructions"],
  properties: {
    verdict: { enum: [...ALLOWED_LOGIC_JUDGE_VERDICTS] },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["testCaseId", "code", "severity", "message"],
        properties: {
          testCaseId: { type: "string", minLength: 1 },
          code: { type: "string", minLength: 1, maxLength: MAX_CODE_LENGTH },
          severity: { enum: [...ALLOWED_LOGIC_JUDGE_FINDING_SEVERITIES] },
          message: { type: "string", minLength: 1, maxLength: MAX_MESSAGE_LENGTH },
        },
      },
    },
    repairInstructions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["testCaseId", "path", "instruction"],
        properties: {
          testCaseId: { type: "string", minLength: 1 },
          path: { type: "string", minLength: 1, maxLength: MAX_PATH_LENGTH },
          instruction: {
            type: "string",
            minLength: 1,
            maxLength: MAX_INSTRUCTION_LENGTH,
          },
        },
      },
    },
  },
});

export const createMemoryLogicJudgeCache = (): LogicJudgeReplayCache => {
  const entries = new Map<string, LogicJudgeCacheEntry>();
  return {
    async lookup(key) {
      const digest = sha256Hex(key);
      const entry = entries.get(digest);
      if (entry === undefined) return { hit: false, key: digest };
      return { hit: true, entry: structuredClone(entry) };
    },
    async store(key, verdict) {
      const digest = sha256Hex(key);
      entries.set(digest, {
        key: digest,
        storedAt: new Date(0).toISOString(),
        verdict: structuredClone(verdict),
      });
    },
  };
};

export const createFileSystemLogicJudgeCache = (
  rootDir: string,
): LogicJudgeReplayCache => ({
  async lookup(key) {
    const digest = sha256Hex(key);
    const path = join(rootDir, `${digest}.logic-judge.json`);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if (isNotFoundError(error)) return { hit: false, key: digest };
      throw error;
    }
    const parsed = JSON.parse(raw) as LogicJudgeCacheEntry;
    return { hit: true, entry: parsed };
  },
  async store(key, verdict) {
    const digest = sha256Hex(key);
    const path = join(rootDir, `${digest}.logic-judge.json`);
    const tmpPath = `${path}.${process.pid}.tmp`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      tmpPath,
      canonicalJson({
        key: digest,
        storedAt: new Date(0).toISOString(),
        verdict,
      } satisfies LogicJudgeCacheEntry),
      "utf8",
    );
    await rename(tmpPath, path);
  },
});

export const runLogicJudge = async (
  input: RunLogicJudgeInput,
): Promise<RunLogicJudgeResult> => {
  const responseSchema = buildLogicJudgeResponseSchema();
  const promptHash = sha256Hex({
    systemPrompt: SYSTEM_PROMPT,
    promptTemplateVersion: LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION,
    responseSchemaName: RESPONSE_SCHEMA_NAME,
    responseSchema,
  });
  const schemaHash = sha256Hex(responseSchema);
  const inputHash = sha256Hex({
    testDesignModel: input.testDesignModel,
    coveragePlan: input.coveragePlan,
    generatedTestCases: input.generatedTestCases,
  });
  const cacheKey: LogicJudgeCacheKey = {
    passKind: "logic_judge",
    inputHash,
    promptHash,
    schemaHash,
    modelDeployment: input.client.deployment,
    modelRevision: input.client.modelRevision,
    gatewayRelease: input.client.gatewayRelease,
  };
  const cacheKeyDigest = sha256Hex(cacheKey);
  const promptArtifact: LogicJudgePromptArtifact = {
    jobId: input.jobId,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildLogicJudgeUserPrompt(input),
    responseSchemaName: RESPONSE_SCHEMA_NAME,
    responseSchema,
    hashes: { promptHash, schemaHash, inputHash, cacheKeyDigest },
    modelBinding: {
      deployment: input.client.deployment,
      modelRevision: input.client.modelRevision,
      gatewayRelease: input.client.gatewayRelease,
    },
  };

  if (input.cache !== undefined) {
    const cached = await input.cache.lookup(cacheKey);
    if (cached.hit) {
      return {
        verdict: stampLogicJudgeVerdict(cached.entry.verdict, {
          generatedAt: input.generatedAt,
          jobId: input.jobId,
          cacheHit: true,
          cacheKeyDigest,
          deployment: input.client.deployment,
          modelRevision: input.client.modelRevision,
          gatewayRelease: input.client.gatewayRelease,
        }),
        cacheHit: true,
        promptArtifact,
      };
    }
  }

  let gatewayResult: LlmGenerationResult;
  try {
    gatewayResult = await input.client.generate({
      jobId: input.jobId,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: promptArtifact.userPrompt,
      responseSchema,
      responseSchemaName: RESPONSE_SCHEMA_NAME,
      ...(input.maxInputTokens !== undefined
        ? { maxInputTokens: input.maxInputTokens }
        : {}),
      ...(input.maxOutputTokens !== undefined
        ? { maxOutputTokens: input.maxOutputTokens }
        : {}),
      ...(input.maxWallClockMs !== undefined
        ? { maxWallClockMs: input.maxWallClockMs }
        : {}),
      ...(input.maxRetries !== undefined ? { maxRetries: input.maxRetries } : {}),
    } satisfies LlmGenerationRequest);
  } catch (error) {
    return {
      verdict: buildLogicJudgeRefusal({
        generatedAt: input.generatedAt,
        jobId: input.jobId,
        cacheKeyDigest,
        deployment: input.client.deployment,
        modelRevision: input.client.modelRevision,
        gatewayRelease: input.client.gatewayRelease,
        code: "gateway_failure",
        message: sanitizeShortMessage(
          sanitizeErrorMessage({
            error,
            fallback: "logic judge gateway request failed",
          }),
        ),
      }),
      cacheHit: false,
      promptArtifact,
    };
  }

  if (gatewayResult.outcome === "error") {
    return {
      verdict: buildLogicJudgeRefusal({
        generatedAt: input.generatedAt,
        jobId: input.jobId,
        cacheKeyDigest,
        deployment: input.client.deployment,
        modelRevision: input.client.modelRevision,
        gatewayRelease: input.client.gatewayRelease,
        code: gatewayResult.errorClass,
        message: sanitizeShortMessage(gatewayResult.message),
      }),
      cacheHit: false,
      promptArtifact,
      gatewayResult,
    };
  }

  const validated = validateLogicJudgeResponse(
    gatewayResult.content,
    input.generatedTestCases.testCases.map((testCase) => testCase.id),
  );
  const verdict = validated.ok
    ? buildLogicJudgeVerdict({
        generatedAt: input.generatedAt,
        jobId: input.jobId,
        cacheKeyDigest,
        deployment: input.client.deployment,
        modelRevision: input.client.modelRevision,
        gatewayRelease: input.client.gatewayRelease,
        verdict: validated.verdict,
        findings: validated.findings,
        repairInstructions: validated.repairInstructions,
      })
    : buildLogicJudgeRefusal({
        generatedAt: input.generatedAt,
        jobId: input.jobId,
        cacheKeyDigest,
        deployment: input.client.deployment,
        modelRevision: input.client.modelRevision,
        gatewayRelease: input.client.gatewayRelease,
        code: "schema_invalid_response",
        message: validated.message,
      });

  if (input.cache !== undefined) {
    await input.cache.store(cacheKey, verdict);
  }

  return {
    verdict,
    cacheHit: false,
    promptArtifact,
    gatewayResult,
  };
};

const buildLogicJudgeUserPrompt = (input: RunLogicJudgeInput): string =>
  [
    "[1] TestDesignModel",
    canonicalJson(input.testDesignModel),
    "[2] CoveragePlan",
    canonicalJson(input.coveragePlan),
    "[3] GeneratedTestCaseList",
    canonicalJson(input.generatedTestCases),
  ].join("\n");

const validateLogicJudgeResponse = (
  value: unknown,
  testCaseIds: readonly string[],
):
  | {
      ok: true;
      verdict: LogicJudgeVerdictLabel;
      findings: readonly JudgeFinding[];
      repairInstructions: readonly RepairInstruction[];
    }
  | { ok: false; message: string } => {
  if (!isRecord(value)) {
    return { ok: false, message: "logic judge response is not an object" };
  }
  const verdict = value["verdict"];
  if (!isLogicJudgeVerdictLabel(verdict)) {
    return { ok: false, message: "logic judge response verdict is invalid" };
  }
  const findingsRaw = value["findings"];
  if (!Array.isArray(findingsRaw)) {
    return { ok: false, message: "logic judge response findings is not an array" };
  }
  const findings: JudgeFinding[] = [];
  for (const entry of findingsRaw) {
    if (!isRecord(entry)) {
      return { ok: false, message: "logic judge finding is not an object" };
    }
    const testCaseId = entry["testCaseId"];
    const code = entry["code"];
    const severity = entry["severity"];
    const message = entry["message"];
    if (typeof testCaseId !== "string" || testCaseId.length === 0) {
      return { ok: false, message: "logic judge finding testCaseId is invalid" };
    }
    if (testCaseId !== "$job" && !testCaseIds.includes(testCaseId)) {
      return { ok: false, message: `logic judge finding references unknown testCaseId "${testCaseId}"` };
    }
    if (typeof code !== "string" || code.length === 0 || code.length > MAX_CODE_LENGTH) {
      return { ok: false, message: "logic judge finding code is invalid" };
    }
    if (!isLogicJudgeFindingSeverity(severity)) {
      return { ok: false, message: "logic judge finding severity is invalid" };
    }
    if (typeof message !== "string" || message.length === 0 || message.length > MAX_MESSAGE_LENGTH) {
      return { ok: false, message: "logic judge finding message is invalid" };
    }
    findings.push({ testCaseId, code, severity, message });
  }

  const repairInstructionsRaw = value["repairInstructions"];
  if (!Array.isArray(repairInstructionsRaw)) {
    return {
      ok: false,
      message: "logic judge response repairInstructions is not an array",
    };
  }
  const repairInstructions: RepairInstruction[] = [];
  for (const entry of repairInstructionsRaw) {
    if (!isRecord(entry)) {
      return { ok: false, message: "logic judge repair instruction is not an object" };
    }
    const testCaseId = entry["testCaseId"];
    const path = entry["path"];
    const instruction = entry["instruction"];
    if (typeof testCaseId !== "string" || testCaseId.length === 0) {
      return { ok: false, message: "logic judge repair instruction testCaseId is invalid" };
    }
    if (testCaseId !== "$job" && !testCaseIds.includes(testCaseId)) {
      return {
        ok: false,
        message: `logic judge repair instruction references unknown testCaseId "${testCaseId}"`,
      };
    }
    if (typeof path !== "string" || path.length === 0 || path.length > MAX_PATH_LENGTH) {
      return { ok: false, message: "logic judge repair instruction path is invalid" };
    }
    if (
      typeof instruction !== "string" ||
      instruction.length === 0 ||
      instruction.length > MAX_INSTRUCTION_LENGTH
    ) {
      return { ok: false, message: "logic judge repair instruction is invalid" };
    }
    repairInstructions.push({ testCaseId, path, instruction });
  }
  return { ok: true, verdict, findings, repairInstructions };
};

const buildLogicJudgeVerdict = (input: {
  generatedAt: string;
  jobId: string;
  cacheKeyDigest: string;
  deployment: string;
  modelRevision: string;
  gatewayRelease: string;
  verdict: LogicJudgeVerdictLabel;
  findings: readonly JudgeFinding[];
  repairInstructions: readonly RepairInstruction[];
}): JudgeVerdict => ({
  schemaVersion: LOGIC_JUDGE_VERDICT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  promptTemplateVersion: LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION,
  generatedAt: input.generatedAt,
  jobId: input.jobId,
  cacheHit: false,
  cacheKeyDigest: input.cacheKeyDigest,
  modelDeployment: input.deployment,
  modelRevision: input.modelRevision,
  gatewayRelease: input.gatewayRelease,
  verdict: input.verdict,
  findings: [...input.findings],
  repairInstructions: [...input.repairInstructions],
});

const buildLogicJudgeRefusal = (input: {
  generatedAt: string;
  jobId: string;
  cacheKeyDigest: string;
  deployment: string;
  modelRevision: string;
  gatewayRelease: string;
  code: string;
  message: string;
}): JudgeVerdict => ({
  schemaVersion: LOGIC_JUDGE_VERDICT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  promptTemplateVersion: LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION,
  generatedAt: input.generatedAt,
  jobId: input.jobId,
  cacheHit: false,
  cacheKeyDigest: input.cacheKeyDigest,
  modelDeployment: input.deployment,
  modelRevision: input.modelRevision,
  gatewayRelease: input.gatewayRelease,
  verdict: "reject",
  findings: [
    {
      testCaseId: "$job",
      code: sanitizeShortCode(input.code),
      severity: "error",
      message: sanitizeShortMessage(input.message),
    },
  ],
  repairInstructions: [],
  refusal: {
    code: sanitizeShortCode(input.code),
    message: sanitizeShortMessage(input.message),
  },
});

const stampLogicJudgeVerdict = (
  verdict: JudgeVerdict,
  stamps: {
    generatedAt: string;
    jobId: string;
    cacheHit: boolean;
    cacheKeyDigest: string;
    deployment: string;
    modelRevision: string;
    gatewayRelease: string;
  },
): JudgeVerdict => ({
  ...verdict,
  generatedAt: stamps.generatedAt,
  jobId: stamps.jobId,
  cacheHit: stamps.cacheHit,
  cacheKeyDigest: stamps.cacheKeyDigest,
  modelDeployment: stamps.deployment,
  modelRevision: stamps.modelRevision,
  gatewayRelease: stamps.gatewayRelease,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isLogicJudgeVerdictLabel = (
  value: unknown,
): value is LogicJudgeVerdictLabel =>
  typeof value === "string" &&
  (ALLOWED_LOGIC_JUDGE_VERDICTS as readonly string[]).includes(value);

const isLogicJudgeFindingSeverity = (
  value: unknown,
): value is LogicJudgeFindingSeverity =>
  typeof value === "string" &&
  (ALLOWED_LOGIC_JUDGE_FINDING_SEVERITIES as readonly string[]).includes(value);

const sanitizeShortCode = (value: string): string =>
  value.slice(0, MAX_CODE_LENGTH) || "judge_error";

const sanitizeShortMessage = (value: string): string =>
  value.length <= MAX_MESSAGE_LENGTH
    ? value
    : `${value.slice(0, MAX_MESSAGE_LENGTH)}...`;

const isNotFoundError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === "ENOENT";
