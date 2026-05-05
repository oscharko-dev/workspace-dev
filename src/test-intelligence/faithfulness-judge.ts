import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

import {
  ALLOWED_FAITHFULNESS_VERDICTS,
  FAITHFULNESS_JUDGE_PROMPT_TEMPLATE_VERSION,
  FAITHFULNESS_VERDICT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type FaithfulnessVerdict,
  type FaithfulnessVerdictLabel,
  type HallucinationFinding,
  type LlmGenerationRequest,
  type LlmGenerationResult,
  type VisualMismatch,
  type VisualSidecarCaptureInput,
  type VisualSidecarFallbackReason,
} from "../contracts/index.js";
import { sanitizeErrorMessage } from "../error-sanitization.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import type { LlmGatewayClientBundle } from "./llm-gateway-bundle.js";

const RESPONSE_SCHEMA_NAME = "workspace-dev-faithfulness-judge-v1" as const;
const MAX_MESSAGE_LENGTH = 240;
const MAX_LABEL_LENGTH = 120;

const SYSTEM_PROMPT = [
  "You are the screenshot faithfulness judge for workspace-dev test-intelligence.",
  "You receive generated test cases plus one or more rendered screenshots as image inputs.",
  "Judge whether each referenced action is visually plausible on the screenshots.",
  "Flag invented controls as hallucinations and label discrepancies as mismatches.",
  "Return only JSON matching the supplied schema.",
].join(" ");

export interface FaithfulnessJudgePromptArtifact {
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
    primaryDeployment: string;
    primaryModelRevision: string;
    primaryGatewayRelease: string;
    fallbackDeployment: string;
    fallbackModelRevision: string;
    fallbackGatewayRelease: string;
  };
}

interface FaithfulnessJudgeCacheKey {
  passKind: "faithfulness_judge";
  imageHashes: readonly string[];
  caseSetHash: string;
  promptHash: string;
  schemaHash: string;
  primaryDeployment: string;
  primaryModelRevision: string;
  primaryGatewayRelease: string;
  fallbackDeployment: string;
  fallbackModelRevision: string;
  fallbackGatewayRelease: string;
}

interface FaithfulnessJudgeCacheEntry {
  key: string;
  storedAt: string;
  verdict: FaithfulnessVerdict;
}

export interface FaithfulnessJudgeReplayCache {
  lookup(
    key: FaithfulnessJudgeCacheKey,
  ): Promise<{ hit: false; key: string } | { hit: true; entry: FaithfulnessJudgeCacheEntry }>;
  store(key: FaithfulnessJudgeCacheKey, verdict: FaithfulnessVerdict): Promise<void>;
}

export interface RunFaithfulnessJudgeInput {
  jobId: string;
  generatedAt: string;
  captures: ReadonlyArray<VisualSidecarCaptureInput>;
  generatedTestCases: unknown;
  bundle: LlmGatewayClientBundle;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxWallClockMs?: number;
  maxRetries?: number;
  cache?: FaithfulnessJudgeReplayCache;
}

export interface FaithfulnessJudgeAttempt {
  role: "visual_primary" | "visual_fallback";
  result: LlmGenerationResult;
}

export interface RunFaithfulnessJudgeResult {
  verdict: FaithfulnessVerdict;
  cacheHit: boolean;
  promptArtifact: FaithfulnessJudgePromptArtifact;
  attempts: readonly FaithfulnessJudgeAttempt[];
}

export const buildFaithfulnessJudgeResponseSchema = (): Record<string, unknown> => ({
  type: "object",
  additionalProperties: false,
  required: ["verdict", "hallucinations", "mismatches"],
  properties: {
    verdict: { enum: [...ALLOWED_FAITHFULNESS_VERDICTS] },
    hallucinations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["testCaseId", "message"],
        properties: {
          testCaseId: { type: "string", minLength: 1 },
          stepIndex: { type: "integer", minimum: 1 },
          message: { type: "string", minLength: 1, maxLength: MAX_MESSAGE_LENGTH },
        },
      },
    },
    mismatches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "testCaseId",
          "expectedLabel",
          "visibleLabel",
          "message",
        ],
        properties: {
          testCaseId: { type: "string", minLength: 1 },
          stepIndex: { type: "integer", minimum: 1 },
          expectedLabel: {
            type: "string",
            minLength: 1,
            maxLength: MAX_LABEL_LENGTH,
          },
          visibleLabel: {
            type: "string",
            minLength: 1,
            maxLength: MAX_LABEL_LENGTH,
          },
          message: { type: "string", minLength: 1, maxLength: MAX_MESSAGE_LENGTH },
        },
      },
    },
  },
});

export const createMemoryFaithfulnessJudgeCache =
  (): FaithfulnessJudgeReplayCache => {
    const entries = new Map<string, FaithfulnessJudgeCacheEntry>();
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

export const createFileSystemFaithfulnessJudgeCache = (
  rootDir: string,
): FaithfulnessJudgeReplayCache => ({
  async lookup(key) {
    const digest = sha256Hex(key);
    const path = join(rootDir, `${digest}.faithfulness-judge.json`);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if (isNotFoundError(error)) return { hit: false, key: digest };
      throw error;
    }
    return { hit: true, entry: JSON.parse(raw) as FaithfulnessJudgeCacheEntry };
  },
  async store(key, verdict) {
    const digest = sha256Hex(key);
    const path = join(rootDir, `${digest}.faithfulness-judge.json`);
    const tmpPath = `${path}.${process.pid}.tmp`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      tmpPath,
      canonicalJson({
        key: digest,
        storedAt: new Date(0).toISOString(),
        verdict,
      } satisfies FaithfulnessJudgeCacheEntry),
      "utf8",
    );
    await rename(tmpPath, path);
  },
});

export const runFaithfulnessJudge = async (
  input: RunFaithfulnessJudgeInput,
): Promise<RunFaithfulnessJudgeResult> => {
  const responseSchema = buildFaithfulnessJudgeResponseSchema();
  const promptHash = sha256Hex({
    systemPrompt: SYSTEM_PROMPT,
    promptTemplateVersion: FAITHFULNESS_JUDGE_PROMPT_TEMPLATE_VERSION,
    responseSchemaName: RESPONSE_SCHEMA_NAME,
    responseSchema,
  });
  const schemaHash = sha256Hex(responseSchema);
  const imageHashes = input.captures.map((capture) =>
    createHash("sha256")
      .update(Buffer.from(capture.base64Data, "base64"))
      .digest("hex"),
  );
  const caseSetHash = sha256Hex(input.generatedTestCases);
  const cacheKey: FaithfulnessJudgeCacheKey = {
    passKind: "faithfulness_judge",
    imageHashes,
    caseSetHash,
    promptHash,
    schemaHash,
    primaryDeployment: input.bundle.visualPrimary.deployment,
    primaryModelRevision: input.bundle.visualPrimary.modelRevision,
    primaryGatewayRelease: input.bundle.visualPrimary.gatewayRelease,
    fallbackDeployment: input.bundle.visualFallback.deployment,
    fallbackModelRevision: input.bundle.visualFallback.modelRevision,
    fallbackGatewayRelease: input.bundle.visualFallback.gatewayRelease,
  };
  const cacheKeyDigest = sha256Hex(cacheKey);
  const promptArtifact: FaithfulnessJudgePromptArtifact = {
    jobId: input.jobId,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildFaithfulnessJudgeUserPrompt(input),
    responseSchemaName: RESPONSE_SCHEMA_NAME,
    responseSchema,
    hashes: {
      promptHash,
      schemaHash,
      inputHash: sha256Hex({ imageHashes, caseSetHash }),
      cacheKeyDigest,
    },
    modelBinding: {
      primaryDeployment: input.bundle.visualPrimary.deployment,
      primaryModelRevision: input.bundle.visualPrimary.modelRevision,
      primaryGatewayRelease: input.bundle.visualPrimary.gatewayRelease,
      fallbackDeployment: input.bundle.visualFallback.deployment,
      fallbackModelRevision: input.bundle.visualFallback.modelRevision,
      fallbackGatewayRelease: input.bundle.visualFallback.gatewayRelease,
    },
  };

  if (input.cache !== undefined) {
    const cached = await input.cache.lookup(cacheKey);
    if (cached.hit) {
      const verdict = stampFaithfulnessVerdict(cached.entry.verdict, {
        generatedAt: input.generatedAt,
        jobId: input.jobId,
        cacheHit: true,
        cacheKeyDigest,
      });
      return { verdict, cacheHit: true, promptArtifact, attempts: [] };
    }
  }

  const attempts: FaithfulnessJudgeAttempt[] = [];
  const primary = await runJudgeAttempt({
    client: input.bundle.visualPrimary,
    input,
    responseSchema,
    userPrompt: promptArtifact.userPrompt,
  });
  attempts.push({ role: "visual_primary", result: primary });
  if (primary.outcome === "success") {
    const validated = validateFaithfulnessResponse(primary.content);
    if (validated.ok) {
      const verdict = buildFaithfulnessVerdict({
        generatedAt: input.generatedAt,
        jobId: input.jobId,
        cacheKeyDigest,
        deployment: input.bundle.visualPrimary.deployment,
        modelRevision: input.bundle.visualPrimary.modelRevision,
        gatewayRelease: input.bundle.visualPrimary.gatewayRelease,
        fallbackReason: "none",
        verdict: validated.verdict,
        hallucinations: validated.hallucinations,
        mismatches: validated.mismatches,
      });
      if (input.cache !== undefined) await input.cache.store(cacheKey, verdict);
      return { verdict, cacheHit: false, promptArtifact, attempts };
    }
  }

  const fallback = await runJudgeAttempt({
    client: input.bundle.visualFallback,
    input,
    responseSchema,
    userPrompt: promptArtifact.userPrompt,
  });
  attempts.push({ role: "visual_fallback", result: fallback });
  if (fallback.outcome === "success") {
    const validated = validateFaithfulnessResponse(fallback.content);
    if (validated.ok) {
      const verdict = buildFaithfulnessVerdict({
        generatedAt: input.generatedAt,
        jobId: input.jobId,
        cacheKeyDigest,
        deployment: input.bundle.visualFallback.deployment,
        modelRevision: input.bundle.visualFallback.modelRevision,
        gatewayRelease: input.bundle.visualFallback.gatewayRelease,
        fallbackReason: "primary_unavailable",
        verdict: validated.verdict,
        hallucinations: validated.hallucinations,
        mismatches: validated.mismatches,
      });
      if (input.cache !== undefined) await input.cache.store(cacheKey, verdict);
      return { verdict, cacheHit: false, promptArtifact, attempts };
    }
  }

  const terminalAttempt = attempts[attempts.length - 1]?.result;
  const failureMessage =
    terminalAttempt?.outcome === "error"
      ? terminalAttempt.message
      : "faithfulness judge response did not match schema";
  return {
    verdict: buildFaithfulnessRefusal({
      generatedAt: input.generatedAt,
      jobId: input.jobId,
      cacheKeyDigest,
      deployment: input.bundle.visualFallback.deployment,
      modelRevision: input.bundle.visualFallback.modelRevision,
      gatewayRelease: input.bundle.visualFallback.gatewayRelease,
      fallbackReason: "primary_unavailable",
      code:
        terminalAttempt?.outcome === "error"
          ? terminalAttempt.errorClass
          : "schema_invalid_response",
      message: sanitizeShortMessage(failureMessage),
    }),
    cacheHit: false,
    promptArtifact,
    attempts,
  };
};

const runJudgeAttempt = async (input: {
  client: LlmGatewayClientBundle["visualPrimary"];
  responseSchema: Record<string, unknown>;
  userPrompt: string;
  input: RunFaithfulnessJudgeInput;
}): Promise<LlmGenerationResult> => {
  try {
    return await input.client.generate({
      jobId: input.input.jobId,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: input.userPrompt,
      responseSchema: input.responseSchema,
      responseSchemaName: RESPONSE_SCHEMA_NAME,
      imageInputs: input.input.captures.map((capture) => ({
        mimeType: capture.mimeType,
        base64Data: capture.base64Data,
      })),
      ...(input.input.maxInputTokens !== undefined
        ? { maxInputTokens: input.input.maxInputTokens }
        : {}),
      ...(input.input.maxOutputTokens !== undefined
        ? { maxOutputTokens: input.input.maxOutputTokens }
        : {}),
      ...(input.input.maxWallClockMs !== undefined
        ? { maxWallClockMs: input.input.maxWallClockMs }
        : {}),
      ...(input.input.maxRetries !== undefined
        ? { maxRetries: input.input.maxRetries }
        : {}),
    } satisfies LlmGenerationRequest);
  } catch (error) {
    return {
      outcome: "error",
      errorClass: "transport",
      message: sanitizeShortMessage(
        sanitizeErrorMessage({
          error,
          fallback: "faithfulness judge gateway request failed",
        }),
      ),
      retryable: false,
      attempt: 0,
    };
  }
};

const buildFaithfulnessJudgeUserPrompt = (
  input: RunFaithfulnessJudgeInput,
): string =>
  [
    "Evaluate the generated test cases against the attached screenshots.",
    "Flag invented controls as hallucinations and visible-label mismatches as mismatches.",
    canonicalJson(input.generatedTestCases),
  ].join("\n");

const validateFaithfulnessResponse = (
  value: unknown,
):
  | {
      ok: true;
      verdict: FaithfulnessVerdictLabel;
      hallucinations: readonly HallucinationFinding[];
      mismatches: readonly VisualMismatch[];
    }
  | { ok: false } => {
  if (!isRecord(value)) return { ok: false };
  const verdict = value["verdict"];
  if (!isFaithfulnessVerdictLabel(verdict)) return { ok: false };
  const hallucinationsRaw = value["hallucinations"];
  const mismatchesRaw = value["mismatches"];
  if (!Array.isArray(hallucinationsRaw) || !Array.isArray(mismatchesRaw)) {
    return { ok: false };
  }
  const hallucinations: HallucinationFinding[] = [];
  for (const entry of hallucinationsRaw) {
    if (!isRecord(entry)) return { ok: false };
    const testCaseId = entry["testCaseId"];
    const stepIndex = entry["stepIndex"];
    const message = entry["message"];
    if (typeof testCaseId !== "string" || testCaseId.length === 0) {
      return { ok: false };
    }
    if (
      stepIndex !== undefined &&
      (!Number.isInteger(stepIndex) || (stepIndex as number) < 1)
    ) {
      return { ok: false };
    }
    if (
      typeof message !== "string" ||
      message.length === 0 ||
      message.length > MAX_MESSAGE_LENGTH
    ) {
      return { ok: false };
    }
    hallucinations.push({
      testCaseId,
      ...(stepIndex !== undefined ? { stepIndex: stepIndex as number } : {}),
      message,
    });
  }
  const mismatches: VisualMismatch[] = [];
  for (const entry of mismatchesRaw) {
    if (!isRecord(entry)) return { ok: false };
    const testCaseId = entry["testCaseId"];
    const stepIndex = entry["stepIndex"];
    const expectedLabel = entry["expectedLabel"];
    const visibleLabel = entry["visibleLabel"];
    const message = entry["message"];
    if (typeof testCaseId !== "string" || testCaseId.length === 0) {
      return { ok: false };
    }
    if (
      stepIndex !== undefined &&
      (!Number.isInteger(stepIndex) || (stepIndex as number) < 1)
    ) {
      return { ok: false };
    }
    if (
      typeof expectedLabel !== "string" ||
      expectedLabel.length === 0 ||
      expectedLabel.length > MAX_LABEL_LENGTH
    ) {
      return { ok: false };
    }
    if (
      typeof visibleLabel !== "string" ||
      visibleLabel.length === 0 ||
      visibleLabel.length > MAX_LABEL_LENGTH
    ) {
      return { ok: false };
    }
    if (
      typeof message !== "string" ||
      message.length === 0 ||
      message.length > MAX_MESSAGE_LENGTH
    ) {
      return { ok: false };
    }
    mismatches.push({
      testCaseId,
      ...(stepIndex !== undefined ? { stepIndex: stepIndex as number } : {}),
      expectedLabel,
      visibleLabel,
      message,
    });
  }
  return { ok: true, verdict, hallucinations, mismatches };
};

const buildFaithfulnessVerdict = (input: {
  generatedAt: string;
  jobId: string;
  cacheKeyDigest: string;
  deployment: string;
  modelRevision: string;
  gatewayRelease: string;
  fallbackReason: VisualSidecarFallbackReason;
  verdict: FaithfulnessVerdictLabel;
  hallucinations: readonly HallucinationFinding[];
  mismatches: readonly VisualMismatch[];
}): FaithfulnessVerdict => ({
  schemaVersion: FAITHFULNESS_VERDICT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  promptTemplateVersion: FAITHFULNESS_JUDGE_PROMPT_TEMPLATE_VERSION,
  generatedAt: input.generatedAt,
  jobId: input.jobId,
  cacheHit: false,
  cacheKeyDigest: input.cacheKeyDigest,
  modelDeployment: input.deployment,
  modelRevision: input.modelRevision,
  gatewayRelease: input.gatewayRelease,
  fallbackReason: input.fallbackReason,
  verdict: input.verdict,
  hallucinations: [...input.hallucinations],
  mismatches: [...input.mismatches],
});

const buildFaithfulnessRefusal = (input: {
  generatedAt: string;
  jobId: string;
  cacheKeyDigest: string;
  deployment: string;
  modelRevision: string;
  gatewayRelease: string;
  fallbackReason: VisualSidecarFallbackReason;
  code: string;
  message: string;
}): FaithfulnessVerdict => ({
  schemaVersion: FAITHFULNESS_VERDICT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  promptTemplateVersion: FAITHFULNESS_JUDGE_PROMPT_TEMPLATE_VERSION,
  generatedAt: input.generatedAt,
  jobId: input.jobId,
  cacheHit: false,
  cacheKeyDigest: input.cacheKeyDigest,
  modelDeployment: input.deployment,
  modelRevision: input.modelRevision,
  gatewayRelease: input.gatewayRelease,
  fallbackReason: input.fallbackReason,
  verdict: "reject",
  hallucinations: [
    {
      testCaseId: "$job",
      message: sanitizeShortMessage(input.message),
    },
  ],
  mismatches: [],
  refusal: {
    code: input.code,
    message: sanitizeShortMessage(input.message),
  },
});

const stampFaithfulnessVerdict = (
  verdict: FaithfulnessVerdict,
  stamps: {
    generatedAt: string;
    jobId: string;
    cacheHit: boolean;
    cacheKeyDigest: string;
  },
): FaithfulnessVerdict => ({
  ...verdict,
  generatedAt: stamps.generatedAt,
  jobId: stamps.jobId,
  cacheHit: stamps.cacheHit,
  cacheKeyDigest: stamps.cacheKeyDigest,
});

const isFaithfulnessVerdictLabel = (
  value: unknown,
): value is FaithfulnessVerdictLabel =>
  typeof value === "string" &&
  (ALLOWED_FAITHFULNESS_VERDICTS as readonly string[]).includes(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sanitizeShortMessage = (value: string): string =>
  value.length <= MAX_MESSAGE_LENGTH
    ? value
    : `${value.slice(0, MAX_MESSAGE_LENGTH)}...`;

const isNotFoundError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === "ENOENT";
