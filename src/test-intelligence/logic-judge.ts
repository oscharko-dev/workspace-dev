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

interface CoverageHardGateInput {
  testDesignModel: TestDesignModel;
  generatedTestCases: GeneratedTestCaseList;
  knownNavigationIds?: readonly string[];
  coverageThresholds?: LogicJudgeCoverageThresholds;
}

interface IrIdSets {
  fieldIds: ReadonlySet<string>;
  actionIds: ReadonlySet<string>;
  validationIds: ReadonlySet<string>;
  navigationIds: ReadonlySet<string>;
}

// Defensive read for test-only stub fixtures (e.g. SAMPLE_TEST_DESIGN_MODEL
// in logic-judge.test.ts) that cast to `TestDesignModel` while omitting
// sub-arrays. The contract guarantees the array is present on production
// traffic; this helper preserves that guarantee at runtime so the hard-gate
// observes an empty IR for the missing kind instead of throwing.
const safeArray = <T>(value: ReadonlyArray<T> | undefined): ReadonlyArray<T> =>
  Array.isArray(value) ? (value as ReadonlyArray<T>) : [];

const collectIrIdSets = (
  testDesignModel: TestDesignModel,
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
 * Augments the LLM-produced verdict with four finding codes:
 * - `empty_coverage_signals` (severity: error) — all four coveredXxxIds empty
 * - `hallucinated_id` (severity: error) — covered id absent from the IR
 * - `insufficient_coverage_breadth` (severity: error) — job-level ratios below policy
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
  const ir = collectIrIdSets(input.testDesignModel, input.knownNavigationIds);
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
