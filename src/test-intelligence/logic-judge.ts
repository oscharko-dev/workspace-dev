import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  ALLOWED_LOGIC_JUDGE_FINDING_SEVERITIES,
  ALLOWED_LOGIC_JUDGE_VERDICTS,
  LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION,
  LOGIC_JUDGE_VERDICT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type CoveragePlan,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type JudgeFinding,
  type JudgeVerdict,
  type LogicJudgeFindingSeverity,
  type LogicJudgeVerdictLabel,
  type RepairInstruction,
  type TenantScope,
  type TestDesignModel,
  type LlmGenerationRequest,
  type LlmGenerationResult,
} from "../contracts/index.js";
import { sanitizeErrorMessage } from "../error-sanitization.js";
import { GENERATOR_FORM_SCREEN_A11Y_REPAIR_INSTRUCTION } from "./agent-role-profile.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import type { LlmGatewayClient } from "./llm-gateway.js";
import { resolveTenantScopeSegments } from "./replay-cache.js";
import { collectTechniqueQuotaDeficits } from "./technique-quota.js";
import { detectUnsupportedExactValidationClaim } from "./unresolved-validation-rules.js";
import { detectCalculationConstraintViolation } from "./calculation-constraints.js";

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
  "Recoverable structured-output schema failures are never reject-worthy; return verdict=repair and include deterministic repairInstructions that point at the broken schema fields.",
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
  constrainedDecodingAdapterId?: string;
  constrainedDecodingAdapterVersion?: string;
  constrainedDecodingFallbackReason?: string;
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

/**
 * Issue #1901 — coverage hard-gate finding codes emitted deterministically
 * by {@link applyCoverageHardGate}. These augment the LLM verdict and
 * upgrade an `accept` to `repair` when any error-severity finding fires.
 */
export const LOGIC_JUDGE_COVERAGE_HARD_GATE_FINDING_CODES = {
  emptyCoverageSignals: "empty_coverage_signals",
  hallucinatedId: "hallucinated_id",
  insufficientCoverageBreadth: "insufficient_coverage_breadth",
  weakTrace: "weak_trace",
  /**
   * Issue #1905 — fired when a TestDesignModel screen carries input
   * elements but the candidate list is missing a `type=accessibility`
   * test case anchored to that screen via `figmaTraceRefs[].screenId`.
   * Severity: error — upgrades an `accept` verdict to `repair` so the
   * existing repair loop drives regeneration with the canonical
   * accessibility instruction.
   */
  missingFormScreenA11yCase: "missing_form_screen_a11y_case",
  /**
   * Issue #1942 — fired when the generated case list fails to satisfy one
   * of the per-screen `CoveragePlan.techniqueQuotas` minimums.
   */
  techniqueQuotaBreach: "technique_quota_breach",
  /**
   * Issue #1987 — fired when a generated case materialises exact validation
   * details even though the source marks the validation behavior as unresolved.
   */
  unsupportedUnresolvedValidationDetail:
    "unsupported_unresolved_validation_detail",
  /**
   * Issue #1986 — fired when a generated financial result contradicts a
   * structured calculation constraint, such as "VAT is not part of the
   * financing need".
   */
  financialCalculationConstraintBreach:
    "financial_calculation_constraint_breach",
} as const;

/**
 * Issue #1901 — tunable coverage-ratio thresholds for the hard-gate.
 * Both fields are optional: when omitted the corresponding breadth check
 * is skipped. Resolved from
 * {@link TestCasePolicyProfileRules.fieldCoverageRatioMin} and
 * {@link TestCasePolicyProfileRules.actionCoverageRatioMin} in production.
 */
export interface LogicJudgeCoverageThresholds {
  fieldCoverageRatioMin?: number;
  actionCoverageRatioMin?: number;
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
  /**
   * Issue #1901 — navigation IR ids known to the upstream Business Test
   * Intent IR. Navigation is not part of {@link TestDesignModel}, so it
   * must be supplied separately for the hard-gate to verify
   * `qualitySignals.coveredNavigationIds` against real IR ids. When
   * omitted, navigation-id existence is not enforced (other hard-gate
   * checks still run).
   */
  knownNavigationIds?: readonly string[];
  /**
   * Issue #1901 — coverage-ratio thresholds for the deterministic
   * post-LLM hard-gate. Pulled from the active policy profile in the
   * production runner; tests may pass an override directly.
   */
  coverageThresholds?: LogicJudgeCoverageThresholds;
}

export interface RunLogicJudgeResult {
  verdict: JudgeVerdict;
  cacheHit: boolean;
  promptArtifact: LogicJudgePromptArtifact;
  gatewayResult?: LlmGenerationResult;
}

export const buildLogicJudgeResponseSchema = (): Record<string, unknown> => ({
  description:
    "Strict logic-judge response envelope. Recoverable schema violations must be repaired with deterministic repairInstructions instead of being rejected.",
  type: "object",
  additionalProperties: false,
  required: ["verdict", "findings", "repairInstructions"],
  properties: {
    verdict: {
      description:
        "Final judge verdict. Use repair for recoverable schema violations so the repair loop can retry deterministically.",
      enum: [...ALLOWED_LOGIC_JUDGE_VERDICTS],
    },
    findings: {
      description:
        "Structured findings anchored to generated test cases or $job. Emit an array even when empty.",
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["testCaseId", "code", "severity", "message"],
        properties: {
          testCaseId: {
            description: "Generated testCaseId or $job.",
            type: "string",
            minLength: 1,
          },
          code: {
            description: "Short machine-readable finding code.",
            type: "string",
            minLength: 1,
            maxLength: MAX_CODE_LENGTH,
          },
          severity: {
            description: "warning or error.",
            enum: [...ALLOWED_LOGIC_JUDGE_FINDING_SEVERITIES],
          },
          message: { type: "string", minLength: 1, maxLength: MAX_MESSAGE_LENGTH },
        },
      },
    },
    repairInstructions: {
      description:
        "Deterministic repair hints. Include schema-field repairs when the response violates this schema; keep entries short and specific.",
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["testCaseId", "path", "instruction"],
        properties: {
          testCaseId: {
            description: "Generated testCaseId or $job.",
            type: "string",
            minLength: 1,
          },
          path: {
            description: "Path to the field that must be changed.",
            type: "string",
            minLength: 1,
            maxLength: MAX_PATH_LENGTH,
          },
          instruction: {
            description: "Short imperative repair instruction.",
            type: "string",
            minLength: 1,
            maxLength: MAX_INSTRUCTION_LENGTH,
          },
          kind: {
            description:
              "Optional structured repair kind. Use schema_violation for deterministic wrapper-schema fixes.",
            enum: ["schema_violation"],
          },
          message: {
            description:
              "Optional redacted schema-diagnostic paired with kind=schema_violation.",
            type: "string",
            minLength: 1,
            maxLength: MAX_MESSAGE_LENGTH,
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

/**
 * Filesystem Logic-Judge cache (Issue #1944, tenant-scoped).
 *
 * Files are stored under
 * `<rootDir>/<tenantId>/<environmentId>/<projectId>/<sha256-digest>.logic-judge.json`.
 * The cache instance is bound to exactly one `tenantScope` at construction
 * time; cross-tenant reads are denied at the loader level because the cache
 * exposes no API to address paths outside its scope directory.
 */
export const createFileSystemLogicJudgeCache = (
  rootDir: string,
  options: { tenantScope: TenantScope },
): LogicJudgeReplayCache => {
  const segments = resolveTenantScopeSegments(options.tenantScope);
  const scopeDir = join(rootDir, ...segments);
  const fileFor = (digest: string): string =>
    join(scopeDir, `${digest}.logic-judge.json`);

  return {
    async lookup(key) {
      const digest = sha256Hex(key);
      const path = fileFor(digest);
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
      const path = fileFor(digest);
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
  };
};

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
    ...(input.client.constrainedDecoding !== undefined
      ? {
          constrainedDecodingAdapterId:
            input.client.constrainedDecoding.adapterId,
        }
      : {}),
    ...(input.client.constrainedDecoding?.adapterVersion !== undefined
      ? {
          constrainedDecodingAdapterVersion:
            input.client.constrainedDecoding.adapterVersion,
        }
      : {}),
    ...(input.client.constrainedDecoding?.fallbackReason !== undefined
      ? {
          constrainedDecodingFallbackReason:
            input.client.constrainedDecoding.fallbackReason,
        }
      : {}),
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
        verdict: applyCoverageHardGate(
          stampLogicJudgeVerdict(cached.entry.verdict, {
            generatedAt: input.generatedAt,
            jobId: input.jobId,
            cacheHit: true,
            cacheKeyDigest,
            deployment: input.client.deployment,
            modelRevision: input.client.modelRevision,
            gatewayRelease: input.client.gatewayRelease,
          }),
          input,
        ),
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
    const recoverableSchemaRepair = buildRecoverableSchemaRepair({
      generatedAt: input.generatedAt,
      jobId: input.jobId,
      cacheKeyDigest,
      deployment: input.client.deployment,
      modelRevision: input.client.modelRevision,
      gatewayRelease: input.client.gatewayRelease,
      code: gatewayResult.errorClass,
      message: gatewayResult.message,
    });
    if (recoverableSchemaRepair !== undefined) {
      return {
        verdict: recoverableSchemaRepair,
        cacheHit: false,
        promptArtifact,
        gatewayResult,
      };
    }
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
    : buildLogicJudgeSchemaRepair({
        generatedAt: input.generatedAt,
        jobId: input.jobId,
        cacheKeyDigest,
        deployment: input.client.deployment,
        modelRevision: input.client.modelRevision,
        gatewayRelease: input.client.gatewayRelease,
        code: "schema_invalid_response",
        message: validated.message,
        repairInstructions: validated.repairInstructions,
      });

  if (input.cache !== undefined) {
    await input.cache.store(cacheKey, verdict);
  }

  return {
    verdict: applyCoverageHardGate(verdict, input),
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
  | { ok: false; message: string; repairInstructions: readonly RepairInstruction[] } => {
  const normalizedValue = normalizeMissingJobLevelTestCaseIds(value);
  const schemaViolation = validateJsonSchemaSubset(
    normalizedValue,
    buildLogicJudgeResponseSchema(),
  );
  if (schemaViolation !== undefined) {
    const message = `logic judge response schema violation: ${schemaViolation}`;
    return {
      ok: false,
      message,
      repairInstructions: [
        buildSchemaViolationRepairInstruction({
          path: extractSchemaViolationPath(schemaViolation),
          message,
        }),
      ],
    };
  }
  const record = normalizedValue as Record<string, unknown>;
  const verdict = record["verdict"] as LogicJudgeVerdictLabel;
  const findingsRaw = record["findings"] as ReadonlyArray<Record<string, unknown>>;
  const repairInstructionsRaw = record[
    "repairInstructions"
  ] as ReadonlyArray<Record<string, unknown>>;
  const findings: JudgeFinding[] = [];
  for (let index = 0; index < findingsRaw.length; index += 1) {
    const entry = findingsRaw[index]!;
    const testCaseId = entry["testCaseId"] as string;
    if (testCaseId !== "$job" && !testCaseIds.includes(testCaseId)) {
      const path = `$.findings[${index}].testCaseId`;
      const message = `logic judge response schema violation: ${path} references unknown testCaseId "${testCaseId}"`;
      return {
        ok: false,
        message,
        repairInstructions: [
          buildSchemaViolationRepairInstruction({
            path,
            message,
          }),
        ],
      };
    }
    findings.push({
      testCaseId,
      code: entry["code"] as string,
      severity: entry["severity"] as LogicJudgeFindingSeverity,
      message: entry["message"] as string,
    });
  }
  const repairInstructions: RepairInstruction[] = [];
  for (let index = 0; index < repairInstructionsRaw.length; index += 1) {
    const entry = repairInstructionsRaw[index]!;
    const testCaseId = entry["testCaseId"] as string;
    if (testCaseId !== "$job" && !testCaseIds.includes(testCaseId)) {
      const path = `$.repairInstructions[${index}].testCaseId`;
      const message = `logic judge response schema violation: ${path} references unknown testCaseId "${testCaseId}"`;
      return {
        ok: false,
        message,
        repairInstructions: [
          buildSchemaViolationRepairInstruction({
            path,
            message,
          }),
        ],
      };
    }
    const kind = entry["kind"];
    const message = entry["message"];
    repairInstructions.push({
      testCaseId,
      path: entry["path"] as string,
      instruction: entry["instruction"] as string,
      ...(kind === "schema_violation" ? { kind } : {}),
      ...(typeof message === "string" ? { message } : {}),
    });
  }
  return { ok: true, verdict, findings, repairInstructions };
};

const normalizeMissingJobLevelTestCaseIds = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const normalizeEntry = (entry: unknown): unknown =>
    typeof entry === "object" &&
    entry !== null &&
    !Array.isArray(entry) &&
    (entry as Record<string, unknown>)["testCaseId"] === undefined
      ? { ...(entry as Record<string, unknown>), testCaseId: "$job" }
      : entry;
  return {
    ...record,
    ...(Array.isArray(record["findings"])
      ? {
          findings: (record["findings"] as readonly unknown[]).map(
            normalizeEntry,
          ),
        }
      : {}),
    ...(Array.isArray(record["repairInstructions"])
      ? {
          repairInstructions: (
            record["repairInstructions"] as readonly unknown[]
          ).map(normalizeEntry),
        }
      : {}),
  };
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

const buildLogicJudgeSchemaRepair = (input: {
  generatedAt: string;
  jobId: string;
  cacheKeyDigest: string;
  deployment: string;
  modelRevision: string;
  gatewayRelease: string;
  code: string;
  message: string;
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
  verdict: "repair",
  findings: [
    {
      testCaseId: "$job",
      code: sanitizeShortCode(input.code),
      severity: "error",
      message: sanitizeShortMessage(input.message),
    },
  ],
  repairInstructions: [...input.repairInstructions],
});

const buildRecoverableSchemaRepair = (input: {
  generatedAt: string;
  jobId: string;
  cacheKeyDigest: string;
  deployment: string;
  modelRevision: string;
  gatewayRelease: string;
  code: string;
  message: string;
}): JudgeVerdict | undefined => {
  if (
    input.code !== "schema_invalid" ||
    !input.message.startsWith("structured-output content ")
  ) {
    return undefined;
  }
  const rawSchemaMessage = input.message.startsWith(
    "structured-output content violates response schema: ",
  )
    ? input.message.slice(
        "structured-output content violates response schema: ".length,
      )
    : input.message;
  return buildLogicJudgeSchemaRepair({
    generatedAt: input.generatedAt,
    jobId: input.jobId,
    cacheKeyDigest: input.cacheKeyDigest,
    deployment: input.deployment,
    modelRevision: input.modelRevision,
    gatewayRelease: input.gatewayRelease,
    code: input.code,
    message: sanitizeShortMessage(input.message),
    repairInstructions: [
      buildSchemaViolationRepairInstruction({
        path: extractSchemaViolationPath(rawSchemaMessage),
        message: sanitizeShortMessage(input.message),
      }),
    ],
  });
};

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

const sanitizeShortCode = (value: string): string =>
  value.slice(0, MAX_CODE_LENGTH) || "judge_error";

const sanitizeShortMessage = (value: string): string =>
  value.length <= MAX_MESSAGE_LENGTH
    ? value
    : `${value.slice(0, MAX_MESSAGE_LENGTH)}...`;

const buildSchemaViolationRepairInstruction = (input: {
  path: string;
  message: string;
}): RepairInstruction => ({
  testCaseId: "$job",
  kind: "schema_violation",
  path: truncate(input.path, MAX_PATH_LENGTH),
  message: sanitizeShortMessage(input.message),
  instruction: truncate(
    `Regenerate the logic-judge response so ${input.path} satisfies the response schema: ${sanitizeShortMessage(
      input.message,
    )}`,
    MAX_INSTRUCTION_LENGTH,
  ),
});

const extractSchemaViolationPath = (message: string): string => {
  const match = message.match(/^(\$[^\s]*)\s+/u);
  return match?.[1] ?? "$";
};

const validateJsonSchemaSubset = (
  value: unknown,
  schema: Record<string, unknown>,
  path: string = "$",
): string | undefined => {
  const constValue = schema["const"];
  if (constValue !== undefined && !Object.is(value, constValue)) {
    return `${path} must equal ${JSON.stringify(constValue)}`;
  }
  const enumValues = schema["enum"];
  if (
    Array.isArray(enumValues) &&
    !enumValues.some((item) => Object.is(item, value))
  ) {
    return `${path} must be one of the allowed enum values`;
  }
  const type = schema["type"];
  if (typeof type === "string") {
    const typeError = validateJsonSchemaType(value, type, path);
    if (typeError !== undefined) return typeError;
  }
  if (type === "object") {
    const record =
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
    if (record === undefined) return `${path} must be an object`;
    const required = schema["required"];
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key === "string" && !(key in record)) {
          return `${path}.${key} is required`;
        }
      }
    }
    const properties = schema["properties"];
    if (
      typeof properties === "object" &&
      properties !== null &&
      !Array.isArray(properties)
    ) {
      const propertySchemas = properties as Record<string, unknown>;
      for (const [key, propertySchema] of Object.entries(propertySchemas)) {
        if (
          key in record &&
          typeof propertySchema === "object" &&
          propertySchema !== null &&
          !Array.isArray(propertySchema)
        ) {
          const nested = validateJsonSchemaSubset(
            record[key],
            propertySchema as Record<string, unknown>,
            `${path}.${key}`,
          );
          if (nested !== undefined) return nested;
        }
      }
    }
    if (schema["additionalProperties"] === false) {
      const allowed = new Set(
        typeof properties === "object" &&
          properties !== null &&
          !Array.isArray(properties)
          ? Object.keys(properties)
          : [],
      );
      for (const key of Object.keys(record)) {
        if (!allowed.has(key)) return `${path}.${key} is not allowed`;
      }
    }
  }
  if (type === "array") {
    if (!Array.isArray(value)) return `${path} must be an array`;
    const items = schema["items"];
    if (typeof items === "object" && items !== null && !Array.isArray(items)) {
      for (let index = 0; index < value.length; index += 1) {
        const nested = validateJsonSchemaSubset(
          value[index],
          items as Record<string, unknown>,
          `${path}[${index}]`,
        );
        if (nested !== undefined) return nested;
      }
    }
  }
  if (typeof value === "string") {
    const minLength = schema["minLength"];
    if (typeof minLength === "number" && value.length < minLength) {
      return `${path} must be at least ${minLength} characters`;
    }
    const maxLength = schema["maxLength"];
    if (typeof maxLength === "number" && value.length > maxLength) {
      return `${path} must be at most ${maxLength} characters`;
    }
  }
  return undefined;
};

const validateJsonSchemaType = (
  value: unknown,
  type: string,
  path: string,
): string | undefined => {
  switch (type) {
    case "object":
      return typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
        ? undefined
        : `${path} must be an object`;
    case "array":
      return Array.isArray(value) ? undefined : `${path} must be an array`;
    case "string":
      return typeof value === "string" ? undefined : `${path} must be a string`;
    default:
      return undefined;
  }
};

const isNotFoundError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === "ENOENT";

interface CoverageHardGateInput {
  testDesignModel: TestDesignModel;
  generatedTestCases: GeneratedTestCaseList;
  coveragePlan?: CoveragePlan;
  knownNavigationIds?: readonly string[];
  coverageThresholds?: LogicJudgeCoverageThresholds;
}

interface IrIdSets {
  fieldIds: ReadonlySet<string>;
  actionIds: ReadonlySet<string>;
  validationIds: ReadonlySet<string>;
  navigationIds: ReadonlySet<string>;
}

const WORKFLOW_ACTION_ID_PATTERN = /^ACT-\d{3}$/u;

// Defensive read for test-only stub fixtures (e.g. SAMPLE_TEST_DESIGN_MODEL
// in logic-judge.test.ts) that cast to `TestDesignModel` while omitting
// sub-arrays. The contract guarantees the array is present on production
// traffic; this helper preserves that guarantee at runtime so the hard-gate
// observes an empty IR for the missing kind instead of throwing.
const safeArray = <T>(value: ReadonlyArray<T> | undefined): ReadonlyArray<T> =>
  Array.isArray(value) ? (value as ReadonlyArray<T>) : [];

const collectIrIdSets = (
  testDesignModel: TestDesignModel,
  coveragePlan: CoveragePlan | undefined,
  knownNavigationIds: readonly string[] | undefined,
): IrIdSets => {
  const fieldIds = new Set<string>();
  const actionIds = new Set<string>();
  const validationIds = new Set<string>();
  for (const screen of safeArray(testDesignModel.screens)) {
    for (const element of safeArray(screen.elements)) {
      fieldIds.add(element.elementId);
    }
    for (const action of safeArray(screen.actions)) {
      actionIds.add(action.actionId);
    }
    for (const validation of safeArray(screen.validations)) {
      validationIds.add(validation.validationId);
    }
  }
  for (const requirement of coveragePlan?.minimumCases ?? []) {
    for (const targetId of requirement.targetIds) {
      if (WORKFLOW_ACTION_ID_PATTERN.test(targetId)) {
        actionIds.add(targetId);
      }
    }
  }
  for (const requirement of coveragePlan?.recommendedCases ?? []) {
    for (const targetId of requirement.targetIds) {
      if (WORKFLOW_ACTION_ID_PATTERN.test(targetId)) {
        actionIds.add(targetId);
      }
    }
  }
  return {
    fieldIds,
    actionIds,
    validationIds,
    navigationIds: new Set<string>(knownNavigationIds ?? []),
  };
};

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, Math.max(0, max - 3))}...`;

interface HardGateAccumulator {
  findings: JudgeFinding[];
  repairInstructions: RepairInstruction[];
  hasNewError: boolean;
}

const pushFinding = (
  acc: HardGateAccumulator,
  finding: JudgeFinding,
  repair: RepairInstruction,
): void => {
  acc.findings.push({
    testCaseId: finding.testCaseId,
    code: truncate(finding.code, MAX_CODE_LENGTH),
    severity: finding.severity,
    message: truncate(finding.message, MAX_MESSAGE_LENGTH),
  });
  acc.repairInstructions.push({
    testCaseId: repair.testCaseId,
    path: truncate(repair.path, MAX_PATH_LENGTH),
    instruction: truncate(repair.instruction, MAX_INSTRUCTION_LENGTH),
  });
  if (finding.severity === "error") {
    acc.hasNewError = true;
  }
};

const evaluateEmptyCoverageSignals = (
  acc: HardGateAccumulator,
  testCase: GeneratedTestCase,
  irHasAnyCoverable: boolean,
): void => {
  if (!irHasAnyCoverable) return;
  const signals = testCase.qualitySignals;
  const allEmpty =
    signals.coveredFieldIds.length === 0 &&
    signals.coveredActionIds.length === 0 &&
    signals.coveredValidationIds.length === 0 &&
    signals.coveredNavigationIds.length === 0;
  if (!allEmpty) return;
  pushFinding(
    acc,
    {
      testCaseId: testCase.id,
      code: LOGIC_JUDGE_COVERAGE_HARD_GATE_FINDING_CODES.emptyCoverageSignals,
      severity: "error",
      message:
        "qualitySignals.coveredFieldIds/coveredActionIds/coveredValidationIds/coveredNavigationIds are all empty",
    },
    {
      testCaseId: testCase.id,
      path: "qualitySignals.coveredFieldIds",
      instruction:
        "Populate qualitySignals.coveredFieldIds with the IR field ids you cite in steps; cite at least one per step.",
    },
  );
};

const findFirstHallucinatedId = (
  testCase: GeneratedTestCase,
  ir: IrIdSets,
): { kind: "field" | "action" | "validation" | "navigation"; id: string } | undefined => {
  for (const id of testCase.qualitySignals.coveredFieldIds) {
    if (!ir.fieldIds.has(id)) return { kind: "field", id };
  }
  for (const id of testCase.qualitySignals.coveredActionIds) {
    if (!ir.actionIds.has(id)) return { kind: "action", id };
  }
  for (const id of testCase.qualitySignals.coveredValidationIds) {
    if (!ir.validationIds.has(id)) return { kind: "validation", id };
  }
  for (const id of testCase.qualitySignals.coveredNavigationIds) {
    // Skip navigation existence check when the caller has not supplied an
    // authoritative navigation id set — the hard-gate would otherwise flag
    // every covered navigation id as hallucinated.
    if (ir.navigationIds.size === 0) continue;
    if (!ir.navigationIds.has(id)) return { kind: "navigation", id };
  }
  return undefined;
};

const evaluateHallucinatedId = (
  acc: HardGateAccumulator,
  testCase: GeneratedTestCase,
  ir: IrIdSets,
): void => {
  const hallucinated = findFirstHallucinatedId(testCase, ir);
  if (hallucinated === undefined) return;
  const pathByKind = {
    field: "qualitySignals.coveredFieldIds",
    action: "qualitySignals.coveredActionIds",
    validation: "qualitySignals.coveredValidationIds",
    navigation: "qualitySignals.coveredNavigationIds",
  } as const;
  pushFinding(
    acc,
    {
      testCaseId: testCase.id,
      code: LOGIC_JUDGE_COVERAGE_HARD_GATE_FINDING_CODES.hallucinatedId,
      severity: "error",
      message: `qualitySignals.${pathByKind[hallucinated.kind]
        .split(".")
        .pop()} contains id "${hallucinated.id}" that is not present in the TestDesignModel IR`,
    },
    {
      testCaseId: testCase.id,
      path: pathByKind[hallucinated.kind],
      instruction: `Replace fabricated id "${hallucinated.id}" with one of the IR ids attached as evidence.`,
    },
  );
};

const evaluateWeakTrace = (
  acc: HardGateAccumulator,
  testCase: GeneratedTestCase,
): void => {
  const weakRef = testCase.figmaTraceRefs.find(
    (ref) => ref.nodeId === undefined || ref.nodeId.length === 0,
  );
  if (weakRef === undefined) return;
  pushFinding(
    acc,
    {
      testCaseId: testCase.id,
      code: LOGIC_JUDGE_COVERAGE_HARD_GATE_FINDING_CODES.weakTrace,
      severity: "warning",
      message: `figmaTraceRefs entry for screen "${weakRef.screenId}" is missing nodeId — trace is screen-only`,
    },
    {
      testCaseId: testCase.id,
      path: "figmaTraceRefs",
      instruction:
        "Populate figmaTraceRefs[].nodeId for every entry; cite the specific Figma node, not just the screenId.",
    },
  );
};

interface CoverageRatios {
  fieldRatio: number;
  actionRatio: number;
  fieldHasUniverse: boolean;
  actionHasUniverse: boolean;
}

const computeCoverageRatios = (
  cases: ReadonlyArray<GeneratedTestCase>,
  ir: IrIdSets,
): CoverageRatios => {
  const coveredFields = new Set<string>();
  const coveredActions = new Set<string>();
  for (const testCase of cases) {
    for (const id of testCase.qualitySignals.coveredFieldIds) {
      if (ir.fieldIds.has(id)) coveredFields.add(id);
    }
    for (const id of testCase.qualitySignals.coveredActionIds) {
      if (ir.actionIds.has(id)) coveredActions.add(id);
    }
  }
  return {
    fieldRatio: ir.fieldIds.size === 0 ? 1 : coveredFields.size / ir.fieldIds.size,
    actionRatio:
      ir.actionIds.size === 0 ? 1 : coveredActions.size / ir.actionIds.size,
    fieldHasUniverse: ir.fieldIds.size > 0,
    actionHasUniverse: ir.actionIds.size > 0,
  };
};

const evaluateMissingFormScreenA11yCase = (
  acc: HardGateAccumulator,
  cases: ReadonlyArray<GeneratedTestCase>,
  testDesignModel: TestDesignModel,
): void => {
  const formScreenIds = new Set<string>();
  for (const screen of safeArray(testDesignModel.screens)) {
    if (safeArray(screen.elements).length > 0) {
      formScreenIds.add(screen.screenId);
    }
  }
  if (formScreenIds.size === 0) return;
  const coveredScreenIds = new Set<string>();
  for (const testCase of cases) {
    if (testCase.type !== "accessibility") continue;
    for (const traceRef of safeArray(testCase.figmaTraceRefs)) {
      if (formScreenIds.has(traceRef.screenId)) {
        coveredScreenIds.add(traceRef.screenId);
      }
    }
  }
  const missing = [...formScreenIds].filter((id) => !coveredScreenIds.has(id));
  if (missing.length === 0) return;
  for (const screenId of missing.sort()) {
    pushFinding(
      acc,
      {
        testCaseId: "$job",
        code: LOGIC_JUDGE_COVERAGE_HARD_GATE_FINDING_CODES.missingFormScreenA11yCase,
        severity: "error",
        message: `screen "${screenId}" carries form fields but the list has no accessibility test case anchored to it`,
      },
      {
        testCaseId: "$job",
        path: "qualitySignals.coveredScreenIds",
        // Render the canonical template from agent-role-profile.ts so the
        // logic-judge instruction stays byte-identical with the
        // `buildA11yCoverageRepairInstruction` helper used by the eval +
        // operator tooling.
        instruction: GENERATOR_FORM_SCREEN_A11Y_REPAIR_INSTRUCTION.replace(
          "{screenId}",
          screenId,
        ),
      },
    );
  }
};

const evaluateTechniqueQuotaMinimums = (
  acc: HardGateAccumulator,
  cases: ReadonlyArray<GeneratedTestCase>,
  coveragePlan: CoveragePlan | undefined,
): void => {
  for (const deficit of collectTechniqueQuotaDeficits(cases, coveragePlan)) {
    pushFinding(
      acc,
      {
        testCaseId: "$job",
        code: LOGIC_JUDGE_COVERAGE_HARD_GATE_FINDING_CODES.techniqueQuotaBreach,
        severity: "error",
        message:
          `screen "${deficit.screenId}" requires at least ${deficit.minCount} ` +
          `"${deficit.technique}" case(s) but only ${deficit.actual} are anchored to that screen`,
      },
      {
        testCaseId: "$job",
        path: "testCases",
        instruction:
          `Add ${deficit.missing} more "${deficit.technique}" case(s) anchored to screen ` +
          `${deficit.screenId} so CoveragePlan.techniqueQuotas is satisfied.`,
      },
    );
  }
};

const evaluateUnsupportedUnresolvedValidationDetails = (
  acc: HardGateAccumulator,
  cases: ReadonlyArray<GeneratedTestCase>,
  testDesignModel: TestDesignModel,
): void => {
  for (const testCase of cases) {
    const claim = detectUnsupportedExactValidationClaim({
      testCase,
      model: testDesignModel,
    });
    if (claim === undefined) continue;
    pushFinding(
      acc,
      {
        testCaseId: testCase.id,
        code:
          LOGIC_JUDGE_COVERAGE_HARD_GATE_FINDING_CODES.unsupportedUnresolvedValidationDetail,
        severity: "error",
        message: claim.message,
      },
      {
        testCaseId: testCase.id,
        path: claim.path,
        instruction:
          "Remove exact validation text, thresholds, and boundary assumptions; keep the expected result generic and preserve the gap in openQuestions.",
      },
    );
  }
};

const evaluateCalculationConstraints = (
  acc: HardGateAccumulator,
  cases: ReadonlyArray<GeneratedTestCase>,
  testDesignModel: TestDesignModel,
): void => {
  for (const testCase of cases) {
    const violation = detectCalculationConstraintViolation({
      model: testDesignModel,
      testCase,
    });
    if (violation === undefined) continue;
    pushFinding(
      acc,
      {
        testCaseId: testCase.id,
        code:
          LOGIC_JUDGE_COVERAGE_HARD_GATE_FINDING_CODES.financialCalculationConstraintBreach,
        severity: "error",
        message: violation.message,
      },
      {
        testCaseId: testCase.id,
        path: violation.path,
        instruction: violation.instruction,
      },
    );
  }
};

const evaluateInsufficientBreadth = (
  acc: HardGateAccumulator,
  cases: ReadonlyArray<GeneratedTestCase>,
  ir: IrIdSets,
  thresholds: LogicJudgeCoverageThresholds,
): void => {
  if (cases.length === 0) return;
  const ratios = computeCoverageRatios(cases, ir);
  const breaches: string[] = [];
  if (
    thresholds.fieldCoverageRatioMin !== undefined &&
    ratios.fieldHasUniverse &&
    ratios.fieldRatio < thresholds.fieldCoverageRatioMin
  ) {
    breaches.push(
      `fieldCoverage.ratio=${ratios.fieldRatio.toFixed(3)} < ${thresholds.fieldCoverageRatioMin}`,
    );
  }
  if (
    thresholds.actionCoverageRatioMin !== undefined &&
    ratios.actionHasUniverse &&
    ratios.actionRatio < thresholds.actionCoverageRatioMin
  ) {
    breaches.push(
      `actionCoverage.ratio=${ratios.actionRatio.toFixed(3)} < ${thresholds.actionCoverageRatioMin}`,
    );
  }
  if (breaches.length === 0) return;
  pushFinding(
    acc,
    {
      testCaseId: "$job",
      code: LOGIC_JUDGE_COVERAGE_HARD_GATE_FINDING_CODES.insufficientCoverageBreadth,
      severity: "error",
      message: `Job-level coverage below policy thresholds: ${breaches.join(", ")}`,
    },
    {
      testCaseId: "$job",
      path: "qualitySignals.coveredFieldIds",
      instruction:
        "Generate additional test cases that cover the unbedeckte critical IR fields/actions until policy thresholds are met.",
    },
  );
};

/**
 * Issue #1901 — deterministic post-LLM coverage hard-gate.
 *
 * Augments the LLM-produced verdict with five finding codes:
 * - `empty_coverage_signals` (severity: error) — all four coveredXxxIds empty
 * - `hallucinated_id` (severity: error) — covered id absent from the IR
 * - `insufficient_coverage_breadth` (severity: error) — job-level ratios below policy
 * - `missing_form_screen_a11y_case` (severity: error, Issue #1905) — a screen
 *   carries input elements but the list has no anchored accessibility case
 * - `technique_quota_breach` (severity: error, Issue #1942) — the case list
 *   fails a per-screen `CoveragePlan.techniqueQuotas` minimum
 * - `financial_calculation_constraint_breach` (severity: error, Issue #1986)
 *   — a generated financing result contradicts bounded arithmetic/domain
 *   constraints such as VAT exclusions
 * - `weak_trace` (severity: warning) — figmaTraceRefs entry without nodeId
 *
 * Error-severity findings upgrade an `accept` verdict to `repair` so the
 * existing repair-loop drives regeneration. A `reject` verdict is left
 * untouched (terminal). The function is pure and synchronous: no LLM
 * call, no I/O, no replay-cache mutation. It is exported so tests and
 * callers that want to apply the gate to a stored verdict can invoke it
 * directly.
 */
export const applyCoverageHardGate = (
  verdict: JudgeVerdict,
  input: CoverageHardGateInput,
): JudgeVerdict => {
  // Skip augmentation when the verdict is a gateway-failure refusal: it
  // is already terminal and the model never inspected the test cases.
  if (verdict.refusal !== undefined) {
    return verdict;
  }
  const ir = collectIrIdSets(
    input.testDesignModel,
    input.coveragePlan,
    input.knownNavigationIds,
  );
  const irHasAnyCoverable =
    ir.fieldIds.size > 0 ||
    ir.actionIds.size > 0 ||
    ir.validationIds.size > 0 ||
    ir.navigationIds.size > 0;
  const acc: HardGateAccumulator = {
    findings: [],
    repairInstructions: [],
    hasNewError: false,
  };
  // The runtime cast accommodates test-only stub fixtures that omit
  // GeneratedTestCase sub-fields while satisfying the contract via
  // `as unknown as` casts. On production traffic every field is present;
  // the helpers below short-circuit gracefully on `undefined`.
  const cases: ReadonlyArray<GeneratedTestCase> = safeArray(
    input.generatedTestCases.testCases,
  );
  for (const testCase of cases) {
    if (
      (testCase.qualitySignals as unknown) === undefined ||
      (testCase.figmaTraceRefs as unknown) === undefined
    ) {
      continue;
    }
    evaluateEmptyCoverageSignals(acc, testCase, irHasAnyCoverable);
    evaluateHallucinatedId(acc, testCase, ir);
    evaluateWeakTrace(acc, testCase);
  }
  evaluateInsufficientBreadth(
    acc,
    cases.filter(
      (testCase) => (testCase.qualitySignals as unknown) !== undefined,
    ),
    ir,
    input.coverageThresholds ?? {},
  );
  evaluateMissingFormScreenA11yCase(acc, cases, input.testDesignModel);
  evaluateTechniqueQuotaMinimums(acc, cases, input.coveragePlan);
  evaluateUnsupportedUnresolvedValidationDetails(
    acc,
    cases,
    input.testDesignModel,
  );
  evaluateCalculationConstraints(acc, cases, input.testDesignModel);

  if (acc.findings.length === 0) {
    return verdict;
  }

  const upgradedVerdict: LogicJudgeVerdictLabel =
    verdict.verdict === "accept" && acc.hasNewError ? "repair" : verdict.verdict;

  return {
    ...verdict,
    verdict: upgradedVerdict,
    findings: [...verdict.findings, ...acc.findings],
    repairInstructions: [...verdict.repairInstructions, ...acc.repairInstructions],
  };
};
