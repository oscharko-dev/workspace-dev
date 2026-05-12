import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  ALLOWED_A11Y_CRITERION_VERDICTS,
  ALLOWED_A11Y_VERDICTS,
  A11Y_JUDGE_OUTPUT_SCHEMA_NAME,
  A11Y_JUDGE_PROMPT_TEMPLATE_VERSION,
  A11Y_JUDGE_VERDICT_ARTIFACT_FILENAME,
  A11Y_VERDICT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type A11yCriterionVerdict,
  type A11yCriterionVerdictLabel,
  type A11yFinding,
  type A11yVerdict,
  type BusinessTestIntentIr,
  type GeneratedTestCaseList,
  type LlmGenerationRequest,
  type LlmGenerationResult,
  type RepairInstruction,
  type TenantScope,
  type VisualSidecarCaptureInput,
} from "../contracts/index.js";
import {
  A11Y_WCAG_22_AA_PILLARS,
  computeA11yCoverage,
  type A11yWcag22AaPillarId,
} from "./a11y-coverage-eval.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import {
  INSTRUCTION_LENGTH_LIMITS,
  countTruncatedInstructions,
  truncateInstructionWithAudit,
  truncateWithEllipsis,
} from "./judge-limits.js";
import { generateWithLocalWallClockGuard } from "./llm-generation-guard.js";
import { resolveTenantScopeSegments } from "./replay-cache.js";
import type { LlmGatewayClientBundle } from "./llm-gateway-bundle.js";

const SYSTEM_PROMPT = [
  "You are the screenshot accessibility coverage judge for workspace-dev test-intelligence.",
  "You receive rendered screenshots, generated accessibility-oriented test cases, and a WCAG 2.2 AA criterion list.",
  "Judge whether the existing test cases would actually catch real accessibility defects visible or implied by the UI.",
  "Return only JSON matching the supplied schema.",
  "Use covered_passes only when the case set clearly and explicitly verifies the criterion.",
  "Use covered_weakly when a case gestures at the criterion but would likely miss real regressions; provide a concise repairInstruction.",
  "Use not_covered when no existing case would meaningfully detect the defect.",
].join(" ");

interface A11yJudgeCriterion {
  readonly criterionId: string;
  readonly screenId: string;
  readonly screenName: string;
  readonly pillarId: A11yWcag22AaPillarId;
  readonly title: string;
  readonly successCriterion: string;
  readonly description: string;
}

interface A11yJudgeResponseRow {
  readonly criterionId: string;
  readonly verdict: A11yCriterionVerdictLabel;
  readonly rationale: string;
  readonly repairInstruction?: string;
}

export interface A11yJudgePromptArtifact {
  readonly jobId: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly responseSchemaName: string;
  readonly responseSchema: Record<string, unknown>;
  readonly hashes: {
    readonly promptHash: string;
    readonly schemaHash: string;
    readonly inputHash: string;
    readonly cacheKeyDigest: string;
  };
  readonly modelBinding: {
    readonly deployment: string;
    readonly modelRevision: string;
    readonly gatewayRelease: string;
  };
}

interface A11yJudgeCacheKey {
  readonly passKind: "a11y_judge";
  readonly imageHashes: readonly string[];
  readonly caseSetHash: string;
  readonly criteriaHash: string;
  readonly promptHash: string;
  readonly schemaHash: string;
  readonly deployment: string;
  readonly modelRevision: string;
  readonly gatewayRelease: string;
}

interface A11yJudgeCacheEntry {
  readonly key: string;
  readonly storedAt: string;
  readonly verdict: A11yVerdict;
}

export interface A11yJudgeReplayCache {
  lookup(
    key: A11yJudgeCacheKey,
  ): Promise<{ hit: false; key: string } | { hit: true; entry: A11yJudgeCacheEntry }>;
  store(key: A11yJudgeCacheKey, verdict: A11yVerdict): Promise<void>;
}

export interface RunA11yJudgeInput {
  readonly jobId: string;
  readonly generatedAt: string;
  readonly intent: BusinessTestIntentIr;
  readonly captures: ReadonlyArray<VisualSidecarCaptureInput>;
  readonly generatedTestCases: GeneratedTestCaseList;
  readonly bundle: LlmGatewayClientBundle;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly maxWallClockMs?: number;
  readonly maxRetries?: number;
  readonly abortSignal?: AbortSignal;
  readonly cache?: A11yJudgeReplayCache;
}

export interface RunA11yJudgeResult {
  readonly verdict: A11yVerdict;
  readonly cacheHit: boolean;
  readonly promptArtifact: A11yJudgePromptArtifact;
  readonly gatewayResult?: LlmGenerationResult;
}

export const createMemoryA11yJudgeCache = (): A11yJudgeReplayCache => {
  const entries = new Map<string, A11yJudgeCacheEntry>();
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
 * Filesystem A11y-Judge cache (Issue #1944, tenant-scoped).
 *
 * Files are stored under
 * `<rootDir>/<tenantId>/<environmentId>/<projectId>/<sha256-digest>.a11y-judge.json`.
 * The cache instance is bound to exactly one `tenantScope` at construction
 * time; cross-tenant reads are denied at the loader level.
 */
export const createFileSystemA11yJudgeCache = (
  rootDir: string,
  options: { tenantScope: TenantScope },
): A11yJudgeReplayCache => {
  const segments = resolveTenantScopeSegments(options.tenantScope);
  const scopeDir = join(rootDir, ...segments);
  const fileFor = (digest: string): string =>
    join(scopeDir, `${digest}.a11y-judge.json`);

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
      return { hit: true, entry: JSON.parse(raw) as A11yJudgeCacheEntry };
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
        } satisfies A11yJudgeCacheEntry),
        "utf8",
      );
      await rename(tmpPath, path);
    },
  };
};

export const buildA11yJudgeCriteria = (input: {
  readonly intent: BusinessTestIntentIr;
  readonly generatedTestCases: GeneratedTestCaseList;
}): readonly A11yJudgeCriterion[] => {
  const computation = computeA11yCoverage({
    intent: input.intent,
    generatedList: input.generatedTestCases,
  });
  const criteria: A11yJudgeCriterion[] = [];
  for (const screen of computation.perScreen) {
    for (const pillarId of screen.expectedPillars) {
      const pillar = A11Y_WCAG_22_AA_PILLARS[pillarId];
      criteria.push({
        criterionId: `${screen.screenId}::${pillarId}`,
        screenId: screen.screenId,
        screenName: screen.screenName,
        pillarId,
        title: pillar.title,
        successCriterion: pillar.successCriterion,
        description: pillar.description,
      });
    }
  }
  return criteria;
};

export const buildA11yJudgeResponseSchema = (): Record<string, unknown> => ({
  type: "object",
  additionalProperties: false,
  required: ["criteria"],
  properties: {
    criteria: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["criterionId", "verdict", "rationale"],
        properties: {
          criterionId: { type: "string", minLength: 1 },
          verdict: { enum: [...ALLOWED_A11Y_CRITERION_VERDICTS] },
          rationale: {
            type: "string",
            minLength: 1,
            maxLength: INSTRUCTION_LENGTH_LIMITS.message,
          },
          repairInstruction: {
            type: "string",
            minLength: 1,
            maxLength: INSTRUCTION_LENGTH_LIMITS.instruction,
          },
        },
      },
    },
  },
});

export const runA11yJudge = async (
  input: RunA11yJudgeInput,
): Promise<RunA11yJudgeResult> => {
  const client = input.bundle.a11yJudge;
  const responseSchema = buildA11yJudgeResponseSchema();
  const criteria = buildA11yJudgeCriteria({
    intent: input.intent,
    generatedTestCases: input.generatedTestCases,
  });
  const criteriaHash = sha256Hex(criteria);
  const imageHashes = input.captures.map((capture) =>
    createHash("sha256")
      .update(Buffer.from(capture.base64Data, "base64"))
      .digest("hex"),
  );
  const caseSetHash = sha256Hex(input.generatedTestCases);
  const promptHash = sha256Hex({
    systemPrompt: SYSTEM_PROMPT,
    promptTemplateVersion: A11Y_JUDGE_PROMPT_TEMPLATE_VERSION,
    responseSchemaName: A11Y_JUDGE_OUTPUT_SCHEMA_NAME,
    responseSchema,
  });
  const schemaHash = sha256Hex(responseSchema);
  const cacheKey: A11yJudgeCacheKey = {
    passKind: "a11y_judge",
    imageHashes,
    caseSetHash,
    criteriaHash,
    promptHash,
    schemaHash,
    deployment: client?.deployment ?? "a11y-judge-unconfigured",
    modelRevision: client?.modelRevision ?? "a11y-judge-unconfigured",
    gatewayRelease: client?.gatewayRelease ?? "a11y-judge-unconfigured",
  };
  const cacheKeyDigest = sha256Hex(cacheKey);
  const promptArtifact: A11yJudgePromptArtifact = {
    jobId: input.jobId,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildA11yJudgeUserPrompt({
      criteria,
      generatedTestCases: input.generatedTestCases,
    }),
    responseSchemaName: A11Y_JUDGE_OUTPUT_SCHEMA_NAME,
    responseSchema,
    hashes: {
      promptHash,
      schemaHash,
      inputHash: sha256Hex({ imageHashes, caseSetHash, criteriaHash }),
      cacheKeyDigest,
    },
    modelBinding: {
      deployment: client?.deployment ?? "a11y-judge-unconfigured",
      modelRevision: client?.modelRevision ?? "a11y-judge-unconfigured",
      gatewayRelease: client?.gatewayRelease ?? "a11y-judge-unconfigured",
    },
  };

  if (criteria.length === 0) {
    return {
      verdict: buildSkippedVerdict({
        generatedAt: input.generatedAt,
        jobId: input.jobId,
        cacheKeyDigest,
        client,
        code: "no_form_screen_criteria",
        message: "No form-screen accessibility criteria were derived for this run.",
      }),
      cacheHit: false,
      promptArtifact,
    };
  }

  if (client === undefined) {
    return {
      verdict: buildSkippedVerdict({
        generatedAt: input.generatedAt,
        jobId: input.jobId,
        cacheKeyDigest,
        client,
        code: "a11y_judge_unconfigured",
        message: "Accessibility judge deployment is not configured for this run.",
      }),
      cacheHit: false,
      promptArtifact,
    };
  }

  if (input.cache !== undefined) {
    const cached = await input.cache.lookup(cacheKey);
    if (cached.hit) {
      return {
        verdict: stampCachedVerdict(cached.entry.verdict, {
          generatedAt: input.generatedAt,
          jobId: input.jobId,
          cacheKeyDigest,
        }),
        cacheHit: true,
        promptArtifact,
      };
    }
  }

  const gatewayResult = await runJudgeAttempt({
    client,
    responseSchema,
    userPrompt: promptArtifact.userPrompt,
    input,
  });
  if (gatewayResult.outcome !== "success") {
    return {
      verdict: buildSkippedVerdict({
        generatedAt: input.generatedAt,
        jobId: input.jobId,
        cacheKeyDigest,
        client,
        code: gatewayResult.errorClass,
        message: sanitizeShortMessage(gatewayResult.message),
      }),
      cacheHit: false,
      promptArtifact,
      gatewayResult,
    };
  }

  const validated = validateA11yJudgeResponse(gatewayResult.content, criteria);
  if (!validated.ok) {
    return {
      verdict: buildSkippedVerdict({
        generatedAt: input.generatedAt,
        jobId: input.jobId,
        cacheKeyDigest,
        client,
        code: "schema_invalid_response",
        message: validated.message,
      }),
      cacheHit: false,
      promptArtifact,
      gatewayResult,
    };
  }

  const verdict = buildA11yVerdict({
    generatedAt: input.generatedAt,
    jobId: input.jobId,
    cacheKeyDigest,
    client,
    criteria,
    responseRows: validated.rows,
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

const runJudgeAttempt = async (input: {
  readonly client: NonNullable<LlmGatewayClientBundle["a11yJudge"]>;
  readonly responseSchema: Record<string, unknown>;
  readonly userPrompt: string;
  readonly input: RunA11yJudgeInput;
}): Promise<LlmGenerationResult> => {
  return await generateWithLocalWallClockGuard({
    client: input.client,
    operationLabel: "a11y judge gateway request",
    request: {
      jobId: input.input.jobId,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: input.userPrompt,
      responseSchema: input.responseSchema,
      responseSchemaName: A11Y_JUDGE_OUTPUT_SCHEMA_NAME,
      imageInputs: input.input.captures.map((capture) => ({
        mimeType: capture.mimeType,
        base64Data: capture.base64Data,
        ...(capture.widthPx !== undefined
          ? { widthPx: capture.widthPx }
          : {}),
        ...(capture.heightPx !== undefined
          ? { heightPx: capture.heightPx }
          : {}),
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
      ...(input.input.abortSignal !== undefined
        ? { abortSignal: input.input.abortSignal }
        : {}),
    } satisfies LlmGenerationRequest,
  });
};

const buildA11yJudgeUserPrompt = (input: {
  readonly criteria: readonly A11yJudgeCriterion[];
  readonly generatedTestCases: GeneratedTestCaseList;
}): string => {
  const accessibilityCases = input.generatedTestCases.testCases.filter(
    (testCase) => testCase.type === "accessibility",
  );
  return [
    "Evaluate whether the existing accessibility cases would catch real defects for each criterion.",
    "Treat weakly worded or overly generic cases as covered_weakly, not covered_passes.",
    "Criteria:",
    canonicalJson(input.criteria),
    "AccessibilityCases:",
    canonicalJson({
      schemaVersion: input.generatedTestCases.schemaVersion,
      jobId: input.generatedTestCases.jobId,
      testCases: accessibilityCases,
    }),
  ].join("\n");
};

const validateA11yJudgeResponse = (
  value: unknown,
  criteria: readonly A11yJudgeCriterion[],
):
  | { ok: true; rows: readonly A11yJudgeResponseRow[] }
  | { ok: false; message: string } => {
  if (typeof value !== "object" || value === null) {
    return { ok: false, message: "response must be an object" };
  }
  const rows = (value as { criteria?: unknown }).criteria;
  if (!Array.isArray(rows)) {
    return { ok: false, message: "criteria must be an array" };
  }
  const expectedIds = new Set(criteria.map((criterion) => criterion.criterionId));
  const seen = new Set<string>();
  const normalized: A11yJudgeResponseRow[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) {
      return { ok: false, message: "criteria entries must be objects" };
    }
    const criterionId = readNonEmptyString(row, "criterionId");
    const verdict = readNonEmptyString(row, "verdict");
    const rationale = readNonEmptyString(row, "rationale");
    if (criterionId === undefined || verdict === undefined || rationale === undefined) {
      return {
        ok: false,
        message: "criteria entries must include non-empty criterionId, verdict, and rationale fields",
      };
    }
    if (!expectedIds.has(criterionId)) {
      return { ok: false, message: `unknown criterionId "${criterionId}"` };
    }
    if (!ALLOWED_A11Y_CRITERION_VERDICTS.includes(verdict as A11yCriterionVerdictLabel)) {
      return { ok: false, message: `invalid verdict "${verdict}"` };
    }
    if (seen.has(criterionId)) {
      return { ok: false, message: `duplicate criterionId "${criterionId}"` };
    }
    seen.add(criterionId);
    const repairInstruction = readOptionalNonEmptyString(row, "repairInstruction");
    normalized.push({
      criterionId,
      verdict: verdict as A11yCriterionVerdictLabel,
      rationale: sanitizeShortMessage(rationale),
      ...(repairInstruction !== undefined
        ? { repairInstruction: sanitizeShortInstruction(repairInstruction) }
        : {}),
    });
  }
  if (normalized.length !== criteria.length) {
    return {
      ok: false,
      message: `expected ${criteria.length} criteria verdicts, received ${normalized.length}`,
    };
  }
  for (const criterion of criteria) {
    if (!seen.has(criterion.criterionId)) {
      return {
        ok: false,
        message: `missing criterionId "${criterion.criterionId}"`,
      };
    }
  }
  return { ok: true, rows: normalized };
};

const buildA11yVerdict = (input: {
  readonly generatedAt: string;
  readonly jobId: string;
  readonly cacheKeyDigest: string;
  readonly client: NonNullable<LlmGatewayClientBundle["a11yJudge"]>;
  readonly criteria: readonly A11yJudgeCriterion[];
  readonly responseRows: readonly A11yJudgeResponseRow[];
}): A11yVerdict => {
  const byId = new Map(input.criteria.map((criterion) => [criterion.criterionId, criterion]));
  const criteria: A11yCriterionVerdict[] = [];
  const findings: A11yFinding[] = [];
  const repairInstructions: RepairInstruction[] = [];
  for (const row of input.responseRows) {
    const criterion = byId.get(row.criterionId)!;
    criteria.push({
      criterionId: criterion.criterionId,
      screenId: criterion.screenId,
      screenName: criterion.screenName,
      pillarId: criterion.pillarId,
      successCriterion: criterion.successCriterion,
      verdict: row.verdict,
      rationale: row.rationale,
    });
    if (row.verdict === "covered_passes") {
      continue;
    }
    const weak = row.verdict === "covered_weakly";
    findings.push({
      criterionId: criterion.criterionId,
      testCaseId: "$job",
      code: weak
        ? `criterion_covered_weakly:${criterion.criterionId}`
        : `criterion_not_covered:${criterion.criterionId}`,
      severity: weak ? "warning" : "error",
      message: sanitizeShortMessage(
        `${criterion.screenName}: ${criterion.title} is ${weak ? "only weakly covered" : "not covered"} - ${row.rationale}`,
      ),
    });
    repairInstructions.push({
      testCaseId: "$job",
      path: truncatePath(`$job.a11yCoverage[${criterion.criterionId}]`),
      ...(weak
        ? buildTruncatedInstruction(
            row.repairInstruction ??
              `Strengthen the accessibility case(s) for "${criterion.screenName}" so they explicitly verify ${criterion.title} (${criterion.successCriterion}).`,
          )
        : buildTruncatedInstruction(
            `Add or rewrite an accessibility case for "${criterion.screenName}" that explicitly verifies ${criterion.title} (${criterion.successCriterion}).`,
          )),
    });
  }
  criteria.sort((left, right) => left.criterionId.localeCompare(right.criterionId));
  findings.sort(
    (left, right) =>
      left.criterionId.localeCompare(right.criterionId) ||
      left.code.localeCompare(right.code),
  );
  repairInstructions.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.instruction.localeCompare(right.instruction),
  );
  return {
    schemaVersion: A11Y_VERDICT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    promptTemplateVersion: A11Y_JUDGE_PROMPT_TEMPLATE_VERSION,
    generatedAt: input.generatedAt,
    jobId: input.jobId,
    cacheHit: false,
    cacheKeyDigest: input.cacheKeyDigest,
    modelDeployment: input.client.deployment,
    modelRevision: input.client.modelRevision,
    gatewayRelease: input.client.gatewayRelease,
    verdict: findings.length === 0 ? ALLOWED_A11Y_VERDICTS[0] : ALLOWED_A11Y_VERDICTS[1],
    criteria,
    findings,
    repairInstructions,
    truncatedInstructionCount: countTruncatedInstructions(repairInstructions),
  };
};

const buildSkippedVerdict = (input: {
  readonly generatedAt: string;
  readonly jobId: string;
  readonly cacheKeyDigest: string;
  readonly client: LlmGatewayClientBundle["a11yJudge"];
  readonly code: string;
  readonly message: string;
}): A11yVerdict => ({
  schemaVersion: A11Y_VERDICT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  promptTemplateVersion: A11Y_JUDGE_PROMPT_TEMPLATE_VERSION,
  generatedAt: input.generatedAt,
  jobId: input.jobId,
  cacheHit: false,
  cacheKeyDigest: input.cacheKeyDigest,
  modelDeployment: input.client?.deployment ?? "a11y-judge-unconfigured",
  modelRevision: input.client?.modelRevision ?? "a11y-judge-unconfigured",
  gatewayRelease: input.client?.gatewayRelease ?? "a11y-judge-unconfigured",
  verdict: "accept",
  criteria: [],
  findings: [],
  repairInstructions: [],
  truncatedInstructionCount: 0,
  refusal: {
    code: input.code,
    message: sanitizeShortMessage(input.message),
  },
});

const stampCachedVerdict = (
  verdict: A11yVerdict,
  input: { readonly generatedAt: string; readonly jobId: string; readonly cacheKeyDigest: string },
): A11yVerdict => ({
  ...structuredClone(verdict),
  generatedAt: input.generatedAt,
  jobId: input.jobId,
  cacheHit: true,
  cacheKeyDigest: input.cacheKeyDigest,
  truncatedInstructionCount:
    verdict.truncatedInstructionCount ??
    countTruncatedInstructions(verdict.repairInstructions),
});

const readNonEmptyString = (
  value: unknown,
  key: string,
): string | undefined => {
  const raw = (value as Record<string, unknown>)[key];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const readOptionalNonEmptyString = (
  value: unknown,
  key: string,
): string | undefined => {
  const raw = (value as Record<string, unknown>)[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const sanitizeShortMessage = (value: string): string =>
  truncateWithEllipsis(
    value.replace(/\s+/gu, " ").trim(),
    INSTRUCTION_LENGTH_LIMITS.message,
  ).value;

const sanitizeShortInstruction = (value: string): string =>
  truncateInstructionWithAudit(value.replace(/\s+/gu, " ").trim()).value;

const truncatePath = (value: string): string =>
  truncateWithEllipsis(value, INSTRUCTION_LENGTH_LIMITS.path).value;

const buildTruncatedInstruction = (
  value: string,
): Pick<RepairInstruction, "instruction" | "instructionTruncated"> => {
  const truncated = truncateInstructionWithAudit(
    value.replace(/\s+/gu, " ").trim(),
  );
  return {
    instruction: truncated.value,
    ...(truncated.truncated ? { instructionTruncated: true } : {}),
  };
};

const isNotFoundError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "ENOENT";

export { A11Y_JUDGE_VERDICT_ARTIFACT_FILENAME };
