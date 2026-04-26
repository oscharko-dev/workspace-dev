/**
 * Self-verify rubric pass (Issue #1379).
 *
 * The rubric pass is an OPTIONAL second LLM pass that scores each
 * validated test case against a fixed six-dimension rubric (and four
 * multimodal subscores when a visual sidecar batch is supplied). It
 * sits between `testcase.validate` and `testcase.policy` in the
 * validation pipeline and emits:
 *
 *   - per-case `rubricScore` rows in the persisted rubric report and
 *     `TestCaseQualitySignalRubric[]` projection, keeping the strict
 *     generated-test-case schema and replay-cache identity decoupled,
 *   - a job-level `SelfVerifyRubricReport` persisted under
 *     `<runDir>/testcases/self-verify-rubric.json`,
 *   - a `coverage-report.json#rubricScore` aggregate (via the
 *     existing `computeCoverageReport({ rubricScore })` channel).
 *
 * Determinism + air-gap guarantees:
 *
 *   - Uses the SAME `LlmGatewayClient` that produced the test cases
 *     (role `test_generation`, same `openai_chat` compatibility mode).
 *     The non-goal "no use of a second model different from the
 *     generator" from Issue #1379 is enforced by typing.
 *   - The `test_generation` role refuses image payloads at the
 *     gateway boundary, so the rubric pass never receives screenshot
 *     bytes (`imagePayloadSentToTestGeneration: false` invariant from
 *     #1366 holds across the rubric call too).
 *   - Replay cache key incorporates the rubric prompt + schema hash,
 *     model identity, policy bundle version, redaction policy, and a
 *     `passKind: "self_verify_rubric"` discriminator so the rubric
 *     cache can never collide with the test-generation cache.
 *   - All persisted fields are scores, short rule citations, identity
 *     stamps, and an optional refusal record; raw prompts, raw
 *     responses, and chain-of-thought are NEVER persisted.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS,
  ALLOWED_SELF_VERIFY_RUBRIC_REFUSAL_CODES,
  ALLOWED_SELF_VERIFY_RUBRIC_VISUAL_SUBSCORES,
  REDACTION_POLICY_VERSION,
  SELF_VERIFY_RUBRIC_ARTIFACT_DIRECTORY,
  SELF_VERIFY_RUBRIC_PROMPT_TEMPLATE_VERSION,
  SELF_VERIFY_RUBRIC_REPORT_ARTIFACT_FILENAME,
  SELF_VERIFY_RUBRIC_REPORT_SCHEMA_VERSION,
  SELF_VERIFY_RUBRIC_RESPONSE_SCHEMA_NAME,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type LlmGenerationRequest,
  type LlmGatewayCompatibilityMode,
  type SelfVerifyRubricAggregateScores,
  type SelfVerifyRubricCaseEvaluation,
  type SelfVerifyRubricDimension,
  type SelfVerifyRubricDimensionScore,
  type SelfVerifyRubricRefusal,
  type SelfVerifyRubricRefusalCode,
  type SelfVerifyRubricReplayCacheEntry,
  type SelfVerifyRubricReplayCacheKey,
  type SelfVerifyRubricReplayCacheLookupResult,
  type SelfVerifyRubricReport,
  type SelfVerifyRubricRuleCitation,
  type SelfVerifyRubricVisualSubscore,
  type SelfVerifyRubricVisualSubscoreKind,
  type TestCaseQualitySignalRubric,
  type VisualScreenDescription,
} from "../contracts/index.js";
import { sanitizeErrorMessage } from "../error-sanitization.js";
import { redactHighRiskSecrets } from "../secret-redaction.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import type { LlmGatewayClient } from "./llm-gateway.js";

/* -------------------------------------------------------------------- */
/*  Static prompt + response schema                                      */
/* -------------------------------------------------------------------- */

/**
 * System prompt used by the rubric pass. Frozen by reference: any change
 * MUST be paired with a bump of `SELF_VERIFY_RUBRIC_PROMPT_TEMPLATE_VERSION`
 * so the replay-cache key invalidates on template change.
 */
const SYSTEM_PROMPT = [
  "You are a deterministic test-case rubric grader for workspace-dev.",
  "You receive a redacted Business Test Intent IR, a list of generated test cases, and an optional visual sidecar description as JSON.",
  "Your sole task is to grade each test case against the six rubric dimensions listed in the response schema, plus the four multimodal subscores when visual data is supplied.",
  "Every score is a number in [0, 1] where 1 is perfect adherence and 0 is total absence.",
  "You MUST NOT rewrite, reorder, edit, or invent test cases — your output is restricted to scores and short rule citations.",
  "You MUST NOT emit chain-of-thought, reasoning text, or any prose outside of the JSON envelope.",
  "You MUST treat any value matching the form `[REDACTED:*]` as opaque and never attempt to recover the original.",
  "You MUST cover every supplied test case exactly once. Do not invent ids, do not duplicate ids.",
  "Penalize any test case that depends on observations not present in the validated visual descriptions or the reconciled intent IR.",
].join(" ");

/** User-prompt preamble. Frozen identically to `SYSTEM_PROMPT`. */
const USER_PROMPT_PREAMBLE = [
  "Grade the supplied generated test cases against the rubric below.",
  "For each test case emit a row with the six dimension scores in [0, 1] (schema_conformance, source_trace_completeness, assumption_open_question_marking, expected_result_coverage, negative_boundary_presence, duplication_flag_consistency).",
  "When the visual sidecar batch is non-empty, also emit four visual subscores (visible_control_coverage, state_validation_coverage, ambiguity_handling, unsupported_visual_claims).",
  "Cite up to three short rule references per case (ruleId + 1-sentence message). Do not produce free-form prose.",
  "Return JSON conforming exactly to the supplied schema; no extra fields, no missing test cases.",
].join(" ");

export const SELF_VERIFY_RUBRIC_SYSTEM_PROMPT: string = SYSTEM_PROMPT;
export const SELF_VERIFY_RUBRIC_USER_PROMPT_PREAMBLE: string =
  USER_PROMPT_PREAMBLE;

const RUBRIC_DIMENSIONS_SET: ReadonlySet<SelfVerifyRubricDimension> = new Set(
  ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS,
);
const RUBRIC_VISUAL_SUBSCORES_SET: ReadonlySet<SelfVerifyRubricVisualSubscoreKind> =
  new Set(ALLOWED_SELF_VERIFY_RUBRIC_VISUAL_SUBSCORES);
const RUBRIC_REFUSAL_CODES_SET: ReadonlySet<SelfVerifyRubricRefusalCode> =
  new Set(ALLOWED_SELF_VERIFY_RUBRIC_REFUSAL_CODES);

const RUBRIC_DIMENSIONS_SORTED: readonly SelfVerifyRubricDimension[] = [
  ...ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS,
].sort();

const RUBRIC_VISUAL_SUBSCORES_SORTED: readonly SelfVerifyRubricVisualSubscoreKind[] =
  [...ALLOWED_SELF_VERIFY_RUBRIC_VISUAL_SUBSCORES].sort();

const MAX_CITATION_RULE_ID_LENGTH = 128;
const MAX_CITATION_MESSAGE_LENGTH = 240;
const MAX_REFUSAL_MESSAGE_LENGTH = 240;
const MAX_CITATIONS_PER_CASE = 3;

/**
 * Build the JSON Schema enforced on the rubric response. Hand-rolled per
 * the workspace-dev zero-runtime-deps policy. Strict (`additionalProperties:
 * false`) so the gateway returns no extra fields the parser would silently
 * drop.
 */
export const buildSelfVerifyRubricResponseSchema = (): Record<
  string,
  unknown
> => {
  const dimensionScore: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    required: ["dimension", "score"],
    properties: {
      dimension: { enum: [...ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS] },
      score: { type: "number", minimum: 0, maximum: 1 },
    },
  };
  const visualSubscore: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    required: ["subscore", "score"],
    properties: {
      subscore: { enum: [...ALLOWED_SELF_VERIFY_RUBRIC_VISUAL_SUBSCORES] },
      score: { type: "number", minimum: 0, maximum: 1 },
    },
  };
  const ruleCitation: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    required: ["ruleId", "message"],
    properties: {
      ruleId: {
        type: "string",
        minLength: 1,
        maxLength: MAX_CITATION_RULE_ID_LENGTH,
      },
      message: {
        type: "string",
        minLength: 1,
        maxLength: MAX_CITATION_MESSAGE_LENGTH,
      },
    },
  };
  const caseEvaluation: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    required: ["testCaseId", "dimensions", "citations"],
    properties: {
      testCaseId: { type: "string", minLength: 1 },
      dimensions: {
        type: "array",
        minItems: ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS.length,
        maxItems: ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS.length,
        items: dimensionScore,
      },
      visualSubscores: {
        type: "array",
        minItems: ALLOWED_SELF_VERIFY_RUBRIC_VISUAL_SUBSCORES.length,
        maxItems: ALLOWED_SELF_VERIFY_RUBRIC_VISUAL_SUBSCORES.length,
        items: visualSubscore,
      },
      citations: {
        type: "array",
        maxItems: MAX_CITATIONS_PER_CASE,
        items: ruleCitation,
      },
    },
  };
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: SELF_VERIFY_RUBRIC_RESPONSE_SCHEMA_NAME,
    type: "object",
    additionalProperties: false,
    required: ["caseEvaluations"],
    properties: {
      caseEvaluations: {
        type: "array",
        items: caseEvaluation,
      },
    },
  };
};

/* -------------------------------------------------------------------- */
/*  Hashes + cache key                                                   */
/* -------------------------------------------------------------------- */

/**
 * SHA-256 of the rubric system + user prompt + schema name + schema hash.
 * Pure and deterministic so the same template ↔ schema pair always
 * produces the same digest.
 */
export const computeSelfVerifyRubricPromptHash = (): string => {
  return sha256Hex({
    systemPrompt: SYSTEM_PROMPT,
    userPromptPreamble: USER_PROMPT_PREAMBLE,
    promptTemplateVersion: SELF_VERIFY_RUBRIC_PROMPT_TEMPLATE_VERSION,
    schemaName: SELF_VERIFY_RUBRIC_RESPONSE_SCHEMA_NAME,
    schemaHash: computeSelfVerifyRubricSchemaHash(),
  });
};

/** SHA-256 of the rubric response JSON schema (canonical JSON). */
export const computeSelfVerifyRubricSchemaHash = (): string => {
  return sha256Hex(buildSelfVerifyRubricResponseSchema());
};

/**
 * SHA-256 of the rubric input identity. The hash binds the test cases,
 * the redacted intent IR, and the visual descriptions together so any
 * change to any of them produces a fresh cache key.
 */
export const computeSelfVerifyRubricInputHash = (input: {
  list: GeneratedTestCaseList;
  intent: BusinessTestIntentIr;
  visual?: ReadonlyArray<VisualScreenDescription>;
}): string => {
  return sha256Hex({
    list: input.list,
    intent: input.intent,
    visual: input.visual ?? [],
  });
};

/** Compute the deterministic SHA-256 digest of a rubric replay-cache key. */
export const computeSelfVerifyRubricCacheKeyDigest = (
  key: SelfVerifyRubricReplayCacheKey,
): string => {
  return sha256Hex(key);
};

const buildCacheKey = (input: {
  list: GeneratedTestCaseList;
  intent: BusinessTestIntentIr;
  visual?: ReadonlyArray<VisualScreenDescription>;
  modelDeployment: string;
  compatibilityMode: LlmGatewayCompatibilityMode;
  modelRevision: string;
  gatewayRelease: string;
  policyBundleVersion: string;
  seed?: number;
}): SelfVerifyRubricReplayCacheKey => {
  const inputHash = computeSelfVerifyRubricInputHash({
    list: input.list,
    intent: input.intent,
    ...(input.visual !== undefined ? { visual: input.visual } : {}),
  });
  const promptHash = computeSelfVerifyRubricPromptHash();
  const schemaHash = computeSelfVerifyRubricSchemaHash();
  const key: SelfVerifyRubricReplayCacheKey = {
    passKind: "self_verify_rubric",
    inputHash,
    promptHash,
    schemaHash,
    modelDeployment: input.modelDeployment,
    compatibilityMode: input.compatibilityMode,
    modelRevision: input.modelRevision,
    gatewayRelease: input.gatewayRelease,
    policyBundleVersion: input.policyBundleVersion,
    redactionPolicyVersion: REDACTION_POLICY_VERSION,
    promptTemplateVersion: SELF_VERIFY_RUBRIC_PROMPT_TEMPLATE_VERSION,
    rubricSchemaVersion: SELF_VERIFY_RUBRIC_REPORT_SCHEMA_VERSION,
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
  };
  return key;
};

/* -------------------------------------------------------------------- */
/*  Replay cache (memory + filesystem implementations)                   */
/* -------------------------------------------------------------------- */

/** Persisted-rubric replay cache surface. */
export interface SelfVerifyRubricReplayCache {
  readonly kind: "memory" | "filesystem";
  computeKey(key: SelfVerifyRubricReplayCacheKey): string;
  lookup(
    key: SelfVerifyRubricReplayCacheKey,
  ): Promise<SelfVerifyRubricReplayCacheLookupResult>;
  store(
    key: SelfVerifyRubricReplayCacheKey,
    report: SelfVerifyRubricReport,
  ): Promise<void>;
}

/** In-memory rubric replay cache. Returned entries are deep-cloned. */
export const createMemorySelfVerifyRubricReplayCache =
  (): SelfVerifyRubricReplayCache => {
    const store = new Map<string, SelfVerifyRubricReplayCacheEntry>();
    return {
      kind: "memory",
      computeKey: computeSelfVerifyRubricCacheKeyDigest,
      lookup: (key) => {
        const digest = computeSelfVerifyRubricCacheKeyDigest(key);
        const found = store.get(digest);
        if (!found) return Promise.resolve({ hit: false, key: digest });
        return Promise.resolve({ hit: true, entry: cloneEntry(found) });
      },
      store: (key, report) => {
        const digest = computeSelfVerifyRubricCacheKeyDigest(key);
        const entry: SelfVerifyRubricReplayCacheEntry = {
          key: digest,
          storedAt: new Date(0).toISOString(),
          report,
        };
        store.set(digest, cloneEntry(entry));
        return Promise.resolve();
      },
    };
  };

/** Filesystem rubric replay cache. Atomic writes via tmp + rename. */
export const createFileSystemSelfVerifyRubricReplayCache = (
  rootDir: string,
): SelfVerifyRubricReplayCache => {
  const fileFor = (digest: string): string =>
    join(rootDir, `${digest}.rubric.json`);
  return {
    kind: "filesystem",
    computeKey: computeSelfVerifyRubricCacheKeyDigest,
    lookup: async (key) => {
      const digest = computeSelfVerifyRubricCacheKeyDigest(key);
      const path = fileFor(digest);
      let raw: string;
      try {
        raw = await readFile(path, "utf8");
      } catch (err) {
        if (isNotFoundError(err)) {
          return { hit: false, key: digest };
        }
        throw err;
      }
      const parsed = JSON.parse(raw) as unknown;
      const entry = decodeEntry(digest, parsed);
      return { hit: true, entry };
    },
    store: async (key, report) => {
      const digest = computeSelfVerifyRubricCacheKeyDigest(key);
      const entry: SelfVerifyRubricReplayCacheEntry = {
        key: digest,
        storedAt: new Date(0).toISOString(),
        report,
      };
      const path = fileFor(digest);
      await mkdir(dirname(path), { recursive: true });
      const tmpPath = `${path}.${process.pid}.tmp`;
      await writeFile(tmpPath, canonicalJson(entry), "utf8");
      await rename(tmpPath, path);
    },
  };
};

const cloneEntry = (
  entry: SelfVerifyRubricReplayCacheEntry,
): SelfVerifyRubricReplayCacheEntry => {
  return JSON.parse(JSON.stringify(entry)) as SelfVerifyRubricReplayCacheEntry;
};

const decodeEntry = (
  digest: string,
  parsed: unknown,
): SelfVerifyRubricReplayCacheEntry => {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new RangeError(
      `self-verify rubric cache entry ${digest} is not an object`,
    );
  }
  const candidate = parsed as Record<string, unknown>;
  if (candidate["key"] !== digest) {
    throw new RangeError(
      `self-verify rubric cache entry ${digest} key mismatch`,
    );
  }
  if (typeof candidate["storedAt"] !== "string") {
    throw new RangeError(
      `self-verify rubric cache entry ${digest} missing storedAt`,
    );
  }
  if (typeof candidate["report"] !== "object" || candidate["report"] === null) {
    throw new RangeError(
      `self-verify rubric cache entry ${digest} missing report`,
    );
  }
  return {
    key: candidate["key"],
    storedAt: candidate["storedAt"],
    report: candidate["report"] as SelfVerifyRubricReport,
  };
};

const isNotFoundError = (err: unknown): boolean => {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "ENOENT";
};

/* -------------------------------------------------------------------- */
/*  Prompt rendering                                                     */
/* -------------------------------------------------------------------- */

const TEST_CASE_RUBRIC_FIELDS: readonly (keyof GeneratedTestCase)[] = [
  "id",
  "title",
  "objective",
  "type",
  "priority",
  "riskCategory",
  "technique",
  "preconditions",
  "testData",
  "steps",
  "expectedResults",
  "figmaTraceRefs",
  "assumptions",
  "openQuestions",
  "qcMappingPreview",
  "qualitySignals",
];

/** Project the test case to the redacted subset the rubric prompt sees. */
const projectTestCaseForRubric = (
  testCase: GeneratedTestCase,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of TEST_CASE_RUBRIC_FIELDS) {
    out[key] = testCase[key];
  }
  return out;
};

const redactPromptJson = (value: unknown): string =>
  redactHighRiskSecrets(canonicalJson(value), "[REDACTED]");

/** Compose the user-prompt body. Pure and deterministic. */
export const buildSelfVerifyRubricUserPrompt = (input: {
  list: GeneratedTestCaseList;
  intent: BusinessTestIntentIr;
  visual?: ReadonlyArray<VisualScreenDescription>;
}): string => {
  const projectedCases = input.list.testCases.map(projectTestCaseForRubric);
  const sections = [
    USER_PROMPT_PREAMBLE,
    `Prompt template version: ${SELF_VERIFY_RUBRIC_PROMPT_TEMPLATE_VERSION}.`,
    `Rubric report schema version: ${SELF_VERIFY_RUBRIC_REPORT_SCHEMA_VERSION}.`,
    `Redaction policy version: ${REDACTION_POLICY_VERSION}.`,
    `Visual sidecar batch present: ${input.visual !== undefined && input.visual.length > 0 ? "true" : "false"}.`,
    "Business Test Intent IR (canonical JSON):",
    redactPromptJson(input.intent),
    "Generated test cases (canonical JSON; project to required fields only):",
    redactPromptJson(projectedCases),
    "Visual sidecar batch (canonical JSON):",
    redactPromptJson(input.visual ?? []),
  ];
  return sections.join("\n");
};

/* -------------------------------------------------------------------- */
/*  Response validation                                                  */
/* -------------------------------------------------------------------- */

interface ValidationFailure {
  code: SelfVerifyRubricRefusalCode;
  message: string;
}

const truncate = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength);
};

const sanitizeShortMessage = (value: string, maxLength: number): string => {
  return truncate(redactHighRiskSecrets(value, "[REDACTED]"), maxLength);
};

/**
 * Validate the parsed rubric response. Returns the strongly-typed,
 * normalized caseEvaluations or a refusal record. Validation is strict:
 * unknown dimensions, scores out of `[0, 1]`, missing or duplicate test
 * case ids all yield refusals.
 */
export const validateSelfVerifyRubricResponse = (
  parsed: unknown,
  expectedCaseIds: ReadonlyArray<string>,
  visualPresent: boolean,
):
  | { ok: true; caseEvaluations: SelfVerifyRubricCaseEvaluation[] }
  | { ok: false; refusal: ValidationFailure } => {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      refusal: {
        code: "schema_invalid_response",
        message: "rubric response is not a JSON object",
      },
    };
  }
  const root = parsed as Record<string, unknown>;
  const caseEvaluationsRaw = root["caseEvaluations"];
  if (!Array.isArray(caseEvaluationsRaw)) {
    return {
      ok: false,
      refusal: {
        code: "schema_invalid_response",
        message: "rubric response missing `caseEvaluations` array",
      },
    };
  }

  const expectedIdSet = new Set(expectedCaseIds);
  const seenIds = new Set<string>();
  const evaluations: SelfVerifyRubricCaseEvaluation[] = [];

  for (const rawCase of caseEvaluationsRaw) {
    const result = parseCaseEvaluation(rawCase, visualPresent);
    if (!result.ok) {
      return { ok: false, refusal: result.refusal };
    }
    const evaluation = result.evaluation;
    if (!expectedIdSet.has(evaluation.testCaseId)) {
      return {
        ok: false,
        refusal: {
          code: "extra_test_case_score",
          message: `rubric response contains unexpected testCaseId "${truncate(
            evaluation.testCaseId,
            64,
          )}"`,
        },
      };
    }
    if (seenIds.has(evaluation.testCaseId)) {
      return {
        ok: false,
        refusal: {
          code: "duplicate_test_case_score",
          message: `rubric response duplicates testCaseId "${truncate(
            evaluation.testCaseId,
            64,
          )}"`,
        },
      };
    }
    seenIds.add(evaluation.testCaseId);
    evaluations.push(evaluation);
  }

  for (const id of expectedCaseIds) {
    if (!seenIds.has(id)) {
      return {
        ok: false,
        refusal: {
          code: "missing_test_case_score",
          message: `rubric response missing testCaseId "${truncate(id, 64)}"`,
        },
      };
    }
  }

  evaluations.sort((a, b) =>
    a.testCaseId < b.testCaseId ? -1 : a.testCaseId > b.testCaseId ? 1 : 0,
  );
  return { ok: true, caseEvaluations: evaluations };
};

const parseCaseEvaluation = (
  raw: unknown,
  visualPresent: boolean,
):
  | { ok: true; evaluation: SelfVerifyRubricCaseEvaluation }
  | { ok: false; refusal: ValidationFailure } => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      refusal: {
        code: "schema_invalid_response",
        message: "rubric case evaluation is not an object",
      },
    };
  }
  const candidate = raw as Record<string, unknown>;
  const testCaseId = candidate["testCaseId"];
  if (typeof testCaseId !== "string" || testCaseId.length === 0) {
    return {
      ok: false,
      refusal: {
        code: "schema_invalid_response",
        message: "rubric case evaluation missing testCaseId",
      },
    };
  }
  const dimsRaw = candidate["dimensions"];
  if (!Array.isArray(dimsRaw)) {
    return {
      ok: false,
      refusal: {
        code: "schema_invalid_response",
        message: `rubric case evaluation for "${truncate(testCaseId, 64)}" missing dimensions array`,
      },
    };
  }
  const dimensions: SelfVerifyRubricDimensionScore[] = [];
  const dimSeen = new Set<SelfVerifyRubricDimension>();
  for (const dimRaw of dimsRaw) {
    if (
      typeof dimRaw !== "object" ||
      dimRaw === null ||
      Array.isArray(dimRaw)
    ) {
      return {
        ok: false,
        refusal: {
          code: "schema_invalid_response",
          message: `rubric dimension entry is not an object for "${truncate(testCaseId, 64)}"`,
        },
      };
    }
    const dimC = dimRaw as Record<string, unknown>;
    const dim = dimC["dimension"];
    const score = dimC["score"];
    if (
      typeof dim !== "string" ||
      !RUBRIC_DIMENSIONS_SET.has(dim as SelfVerifyRubricDimension)
    ) {
      return {
        ok: false,
        refusal: {
          code: "schema_invalid_response",
          message: `rubric dimension name unknown for "${truncate(testCaseId, 64)}"`,
        },
      };
    }
    if (typeof score !== "number" || !Number.isFinite(score)) {
      return {
        ok: false,
        refusal: {
          code: "schema_invalid_response",
          message: `rubric dimension score is not a number for "${truncate(testCaseId, 64)}"`,
        },
      };
    }
    if (score < 0 || score > 1) {
      return {
        ok: false,
        refusal: {
          code: "score_out_of_range",
          message: `rubric dimension score ${score} out of range [0, 1] for "${truncate(testCaseId, 64)}"`,
        },
      };
    }
    const dimEnum = dim as SelfVerifyRubricDimension;
    if (dimSeen.has(dimEnum)) {
      return {
        ok: false,
        refusal: {
          code: "schema_invalid_response",
          message: `rubric dimension "${dimEnum}" repeated for "${truncate(testCaseId, 64)}"`,
        },
      };
    }
    dimSeen.add(dimEnum);
    dimensions.push({ dimension: dimEnum, score: roundTo(score, 6) });
  }
  for (const required of RUBRIC_DIMENSIONS_SORTED) {
    if (!dimSeen.has(required)) {
      return {
        ok: false,
        refusal: {
          code: "schema_invalid_response",
          message: `rubric dimension "${required}" missing for "${truncate(testCaseId, 64)}"`,
        },
      };
    }
  }
  dimensions.sort((a, b) =>
    a.dimension < b.dimension ? -1 : a.dimension > b.dimension ? 1 : 0,
  );

  let visualSubscores: SelfVerifyRubricVisualSubscore[] | undefined;
  const visualRaw = candidate["visualSubscores"];
  if (visualPresent) {
    if (!Array.isArray(visualRaw)) {
      return {
        ok: false,
        refusal: {
          code: "schema_invalid_response",
          message: `rubric visualSubscores missing for "${truncate(testCaseId, 64)}"`,
        },
      };
    }
    const subscores: SelfVerifyRubricVisualSubscore[] = [];
    const seenSubs = new Set<SelfVerifyRubricVisualSubscoreKind>();
    for (const subRaw of visualRaw) {
      if (
        typeof subRaw !== "object" ||
        subRaw === null ||
        Array.isArray(subRaw)
      ) {
        return {
          ok: false,
          refusal: {
            code: "schema_invalid_response",
            message: `rubric visual subscore entry is not an object for "${truncate(testCaseId, 64)}"`,
          },
        };
      }
      const subC = subRaw as Record<string, unknown>;
      const subscoreName = subC["subscore"];
      const score = subC["score"];
      if (
        typeof subscoreName !== "string" ||
        !RUBRIC_VISUAL_SUBSCORES_SET.has(
          subscoreName as SelfVerifyRubricVisualSubscoreKind,
        )
      ) {
        return {
          ok: false,
          refusal: {
            code: "schema_invalid_response",
            message: `rubric visual subscore name unknown for "${truncate(testCaseId, 64)}"`,
          },
        };
      }
      if (typeof score !== "number" || !Number.isFinite(score)) {
        return {
          ok: false,
          refusal: {
            code: "schema_invalid_response",
            message: `rubric visual subscore score is not a number for "${truncate(testCaseId, 64)}"`,
          },
        };
      }
      if (score < 0 || score > 1) {
        return {
          ok: false,
          refusal: {
            code: "score_out_of_range",
            message: `rubric visual subscore ${score} out of range [0, 1] for "${truncate(testCaseId, 64)}"`,
          },
        };
      }
      const subscoreKind = subscoreName as SelfVerifyRubricVisualSubscoreKind;
      if (seenSubs.has(subscoreKind)) {
        return {
          ok: false,
          refusal: {
            code: "schema_invalid_response",
            message: `rubric visual subscore "${subscoreKind}" repeated for "${truncate(testCaseId, 64)}"`,
          },
        };
      }
      seenSubs.add(subscoreKind);
      subscores.push({ subscore: subscoreKind, score: roundTo(score, 6) });
    }
    for (const required of RUBRIC_VISUAL_SUBSCORES_SORTED) {
      if (!seenSubs.has(required)) {
        return {
          ok: false,
          refusal: {
            code: "schema_invalid_response",
            message: `rubric visual subscore "${required}" missing for "${truncate(testCaseId, 64)}"`,
          },
        };
      }
    }
    subscores.sort((a, b) =>
      a.subscore < b.subscore ? -1 : a.subscore > b.subscore ? 1 : 0,
    );
    visualSubscores = subscores;
  } else if (visualRaw !== undefined) {
    return {
      ok: false,
      refusal: {
        code: "schema_invalid_response",
        message: `rubric visualSubscores supplied but no visual sidecar batch was provided`,
      },
    };
  }

  const citationsRaw = candidate["citations"];
  const citations: SelfVerifyRubricRuleCitation[] = [];
  if (citationsRaw !== undefined) {
    if (!Array.isArray(citationsRaw)) {
      return {
        ok: false,
        refusal: {
          code: "schema_invalid_response",
          message: `rubric citations is not an array for "${truncate(testCaseId, 64)}"`,
        },
      };
    }
    if (citationsRaw.length > MAX_CITATIONS_PER_CASE) {
      return {
        ok: false,
        refusal: {
          code: "schema_invalid_response",
          message: `rubric citations exceeds ${MAX_CITATIONS_PER_CASE} entries for "${truncate(testCaseId, 64)}"`,
        },
      };
    }
    for (const cRaw of citationsRaw) {
      if (typeof cRaw !== "object" || cRaw === null || Array.isArray(cRaw)) {
        return {
          ok: false,
          refusal: {
            code: "schema_invalid_response",
            message: `rubric citation entry is not an object for "${truncate(testCaseId, 64)}"`,
          },
        };
      }
      const cC = cRaw as Record<string, unknown>;
      const ruleId = cC["ruleId"];
      const message = cC["message"];
      if (
        typeof ruleId !== "string" ||
        ruleId.length === 0 ||
        ruleId.length > MAX_CITATION_RULE_ID_LENGTH
      ) {
        return {
          ok: false,
          refusal: {
            code: "schema_invalid_response",
            message: `rubric citation ruleId invalid for "${truncate(testCaseId, 64)}"`,
          },
        };
      }
      if (
        typeof message !== "string" ||
        message.length === 0 ||
        message.length > MAX_CITATION_MESSAGE_LENGTH
      ) {
        return {
          ok: false,
          refusal: {
            code: "schema_invalid_response",
            message: `rubric citation message invalid for "${truncate(testCaseId, 64)}"`,
          },
        };
      }
      citations.push({
        ruleId: sanitizeShortMessage(ruleId, MAX_CITATION_RULE_ID_LENGTH),
        message: sanitizeShortMessage(message, MAX_CITATION_MESSAGE_LENGTH),
      });
    }
  }
  citations.sort((a, b) =>
    a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0,
  );

  const rubricScore = computeCaseRubricScore(dimensions, visualSubscores);
  const evaluation: SelfVerifyRubricCaseEvaluation = {
    testCaseId,
    dimensions,
    citations,
    rubricScore,
  };
  if (visualSubscores !== undefined) {
    evaluation.visualSubscores = visualSubscores;
  }
  return { ok: true, evaluation };
};

/* -------------------------------------------------------------------- */
/*  Aggregation + apply                                                  */
/* -------------------------------------------------------------------- */

const computeCaseRubricScore = (
  dimensions: ReadonlyArray<SelfVerifyRubricDimensionScore>,
  visual?: ReadonlyArray<SelfVerifyRubricVisualSubscore>,
): number => {
  let total = 0;
  let count = 0;
  for (const d of dimensions) {
    total += d.score;
    count += 1;
  }
  if (visual !== undefined) {
    for (const v of visual) {
      total += v.score;
      count += 1;
    }
  }
  if (count === 0) return 0;
  return roundTo(total / count, 6);
};

/**
 * Aggregate per-case rubric evaluations into the job-level scores. Pure
 * and deterministic; all arrays in the result are sorted by name.
 */
export const aggregateSelfVerifyRubricScores = (
  caseEvaluations: ReadonlyArray<SelfVerifyRubricCaseEvaluation>,
): SelfVerifyRubricAggregateScores => {
  if (caseEvaluations.length === 0) {
    return {
      jobLevelRubricScore: 0,
      dimensionScores: RUBRIC_DIMENSIONS_SORTED.map((d) => ({
        dimension: d,
        score: 0,
      })),
    };
  }

  const dimSums = new Map<SelfVerifyRubricDimension, number>();
  const dimCounts = new Map<SelfVerifyRubricDimension, number>();
  const visualSums = new Map<SelfVerifyRubricVisualSubscoreKind, number>();
  const visualCounts = new Map<SelfVerifyRubricVisualSubscoreKind, number>();
  let perCaseSum = 0;

  for (const ev of caseEvaluations) {
    perCaseSum += ev.rubricScore;
    for (const d of ev.dimensions) {
      dimSums.set(d.dimension, (dimSums.get(d.dimension) ?? 0) + d.score);
      dimCounts.set(d.dimension, (dimCounts.get(d.dimension) ?? 0) + 1);
    }
    if (ev.visualSubscores !== undefined) {
      for (const v of ev.visualSubscores) {
        visualSums.set(v.subscore, (visualSums.get(v.subscore) ?? 0) + v.score);
        visualCounts.set(v.subscore, (visualCounts.get(v.subscore) ?? 0) + 1);
      }
    }
  }

  const dimensionScores: SelfVerifyRubricDimensionScore[] =
    RUBRIC_DIMENSIONS_SORTED.map((dim) => ({
      dimension: dim,
      score: roundTo(
        (dimSums.get(dim) ?? 0) / Math.max(dimCounts.get(dim) ?? 0, 1),
        6,
      ),
    }));

  let visualSubscores: SelfVerifyRubricVisualSubscore[] | undefined;
  if (visualCounts.size > 0) {
    visualSubscores = RUBRIC_VISUAL_SUBSCORES_SORTED.map((sub) => ({
      subscore: sub,
      score: roundTo(
        (visualSums.get(sub) ?? 0) / Math.max(visualCounts.get(sub) ?? 0, 1),
        6,
      ),
    }));
  }

  const aggregate: SelfVerifyRubricAggregateScores = {
    jobLevelRubricScore: roundTo(perCaseSum / caseEvaluations.length, 6),
    dimensionScores,
  };
  if (visualSubscores !== undefined) {
    aggregate.visualSubscores = visualSubscores;
  }
  return aggregate;
};

/**
 * Project the rubric per-case evaluations into the canonical
 * `TestCaseQualitySignalRubric[]` shape. The persisted rubric report
 * is the source of truth for per-case scores; this projection is
 * exposed for callers (e.g. the inspector) that want a flat list of
 * test-case quality signals without the surrounding dimension and
 * citation detail. The result is sorted by `testCaseId` for byte
 * stability.
 */
export const projectSelfVerifyRubricToTestCaseQualitySignals = (
  caseEvaluations: ReadonlyArray<SelfVerifyRubricCaseEvaluation>,
): TestCaseQualitySignalRubric[] => {
  return [...caseEvaluations]
    .sort((a, b) =>
      a.testCaseId < b.testCaseId ? -1 : a.testCaseId > b.testCaseId ? 1 : 0,
    )
    .map((ev) => ({
      testCaseId: ev.testCaseId,
      rubricScore: roundTo(ev.rubricScore, 6),
    }));
};

/* -------------------------------------------------------------------- */
/*  Run + persist                                                        */
/* -------------------------------------------------------------------- */

/** Pipeline-level options consumed by `runValidationPipelineWithSelfVerify`. */
export interface SelfVerifyRubricPipelineOptions {
  enabled: true;
  /**
   * Gateway client used to grade test cases. MUST carry role
   * `test_generation` per Issue #1379 ("no use of a second model
   * different from the generator"). The role assertion is also
   * enforced at the gateway boundary, which refuses image inputs.
   */
  client: LlmGatewayClient;
  /**
   * Identity stamps stored on the rubric report and on the rubric
   * cache key. The rubric pass never inspects the gateway client to
   * derive these — callers pass them explicitly so the cache identity
   * is decoupled from the live gateway runtime.
   */
  modelBinding: {
    deployment: string;
    modelRevision: string;
    gatewayRelease: string;
    seed?: number;
  };
  /** Stamped onto the rubric report for joinability with other artifacts. */
  policyBundleVersion: string;
  /** Optional rubric replay cache. When omitted, every call hits the gateway. */
  cache?: SelfVerifyRubricReplayCache;
  /** Forwarded to `LlmGenerationRequest.maxOutputTokens`. */
  maxOutputTokens?: number;
  /** Forwarded to `LlmGenerationRequest.maxWallClockMs` (FinOps fail-closed). */
  maxWallClockMs?: number;
  /** Forwarded to `LlmGenerationRequest.maxRetries`. */
  maxRetries?: number;
  /** Forwarded to `LlmGenerationRequest.maxInputTokens`. */
  maxInputTokens?: number;
}

/** Inputs for `runSelfVerifyRubricPass`. */
export interface RunSelfVerifyRubricPassInput {
  jobId: string;
  generatedAt: string;
  list: GeneratedTestCaseList;
  intent: BusinessTestIntentIr;
  visual?: ReadonlyArray<VisualScreenDescription>;
  policyProfileId: string;
  policyBundleVersion: string;
  client: LlmGatewayClient;
  modelBinding: {
    deployment: string;
    modelRevision: string;
    gatewayRelease: string;
    seed?: number;
  };
  cache?: SelfVerifyRubricReplayCache;
  maxOutputTokens?: number;
  maxWallClockMs?: number;
  maxRetries?: number;
  maxInputTokens?: number;
}

/** Outputs for `runSelfVerifyRubricPass`. */
export interface RunSelfVerifyRubricPassResult {
  report: SelfVerifyRubricReport;
  /**
   * Per-case rubric quality signals projected from the report. Empty
   * when the rubric pass produced a refusal. The persisted
   * `self-verify-rubric.json` artifact remains the source of truth;
   * this projection is provided for downstream callers (inspector,
   * eval gate) that want a flat list of test-case scores without the
   * dimension + citation detail.
   */
  caseQualitySignals: TestCaseQualitySignalRubric[];
  /** True when the rubric replay cache served the result; the LLM was NOT called. */
  cacheHit: boolean;
}

/** Run the self-verify rubric pass end-to-end. */
export const runSelfVerifyRubricPass = async (
  input: RunSelfVerifyRubricPassInput,
): Promise<RunSelfVerifyRubricPassResult> => {
  const cacheKey = buildCacheKey({
    list: input.list,
    intent: input.intent,
    ...(input.visual !== undefined ? { visual: input.visual } : {}),
    modelDeployment: input.modelBinding.deployment,
    compatibilityMode: input.client.compatibilityMode,
    modelRevision: input.modelBinding.modelRevision,
    gatewayRelease: input.modelBinding.gatewayRelease,
    policyBundleVersion: input.policyBundleVersion,
    ...(input.modelBinding.seed !== undefined
      ? { seed: input.modelBinding.seed }
      : {}),
  });
  const cacheKeyDigest = computeSelfVerifyRubricCacheKeyDigest(cacheKey);

  if (input.client.role !== "test_generation") {
    return refusalResult({
      input,
      cacheKeyDigest,
      refusal: {
        code: "image_payload_attempted",
        message:
          "self-verify rubric pass refuses to use a non-test_generation gateway role",
      },
    });
  }
  const bindingMismatch = validateClientModelBinding(input);
  if (bindingMismatch !== undefined) {
    return refusalResult({
      input,
      cacheKeyDigest,
      refusal: {
        code: "model_binding_mismatch",
        message: bindingMismatch,
      },
    });
  }

  if (input.cache !== undefined) {
    const cached = await input.cache.lookup(cacheKey);
    if (cached.hit) {
      const report = stampReportIdentity(cached.entry.report, {
        cacheHit: true,
        cacheKeyDigest,
        generatedAt: input.generatedAt,
        jobId: input.jobId,
        policyProfileId: input.policyProfileId,
        modelBinding: input.modelBinding,
      });
      const caseQualitySignals =
        report.refusal === undefined
          ? projectSelfVerifyRubricToTestCaseQualitySignals(
              report.caseEvaluations,
            )
          : [];
      return { report, caseQualitySignals, cacheHit: true };
    }
  }

  const visualPresent = input.visual !== undefined && input.visual.length > 0;
  const userPrompt = buildSelfVerifyRubricUserPrompt({
    list: input.list,
    intent: input.intent,
    ...(input.visual !== undefined ? { visual: input.visual } : {}),
  });
  const request: LlmGenerationRequest = {
    jobId: input.jobId,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    responseSchema: buildSelfVerifyRubricResponseSchema(),
    responseSchemaName: SELF_VERIFY_RUBRIC_RESPONSE_SCHEMA_NAME,
    ...(input.modelBinding.seed !== undefined
      ? { seed: input.modelBinding.seed }
      : {}),
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
  };

  let llmOutcome: Awaited<ReturnType<LlmGatewayClient["generate"]>>;
  try {
    llmOutcome = await input.client.generate(request);
  } catch (err) {
    return refusalResult({
      input,
      cacheKeyDigest,
      refusal: {
        code: "gateway_failure",
        message: sanitizeShortMessage(
          sanitizeErrorMessage({
            error: err,
            fallback: "rubric gateway request raised",
          }),
          MAX_REFUSAL_MESSAGE_LENGTH,
        ),
      },
    });
  }

  if (llmOutcome.outcome === "error") {
    return refusalResult({
      input,
      cacheKeyDigest,
      refusal: {
        code:
          llmOutcome.errorClass === "image_payload_rejected"
            ? "image_payload_attempted"
            : "gateway_failure",
        message: sanitizeShortMessage(
          llmOutcome.message,
          MAX_REFUSAL_MESSAGE_LENGTH,
        ),
      },
    });
  }

  const expectedIds = input.list.testCases.map((c) => c.id);
  const validation = validateSelfVerifyRubricResponse(
    llmOutcome.content,
    expectedIds,
    visualPresent,
  );
  if (!validation.ok) {
    return refusalResult({
      input,
      cacheKeyDigest,
      refusal: validation.refusal,
    });
  }

  const aggregate = aggregateSelfVerifyRubricScores(validation.caseEvaluations);
  const report: SelfVerifyRubricReport = {
    schemaVersion: SELF_VERIFY_RUBRIC_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    promptTemplateVersion: SELF_VERIFY_RUBRIC_PROMPT_TEMPLATE_VERSION,
    generatedAt: input.generatedAt,
    jobId: input.jobId,
    policyProfileId: input.policyProfileId,
    cacheHit: false,
    cacheKeyDigest,
    modelDeployment: input.modelBinding.deployment,
    modelRevision: input.modelBinding.modelRevision,
    gatewayRelease: input.modelBinding.gatewayRelease,
    caseEvaluations: validation.caseEvaluations,
    aggregate,
  };

  if (input.cache !== undefined) {
    await input.cache.store(cacheKey, report);
  }

  const caseQualitySignals = projectSelfVerifyRubricToTestCaseQualitySignals(
    validation.caseEvaluations,
  );
  return { report, caseQualitySignals, cacheHit: false };
};

const refusalResult = (input: {
  input: RunSelfVerifyRubricPassInput;
  cacheKeyDigest: string;
  refusal: SelfVerifyRubricRefusal;
}): RunSelfVerifyRubricPassResult => {
  const refusalCode = RUBRIC_REFUSAL_CODES_SET.has(input.refusal.code)
    ? input.refusal.code
    : "schema_invalid_response";
  const aggregate = aggregateSelfVerifyRubricScores([]);
  const report: SelfVerifyRubricReport = {
    schemaVersion: SELF_VERIFY_RUBRIC_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    promptTemplateVersion: SELF_VERIFY_RUBRIC_PROMPT_TEMPLATE_VERSION,
    generatedAt: input.input.generatedAt,
    jobId: input.input.jobId,
    policyProfileId: input.input.policyProfileId,
    cacheHit: false,
    cacheKeyDigest: input.cacheKeyDigest,
    modelDeployment: input.input.modelBinding.deployment,
    modelRevision: input.input.modelBinding.modelRevision,
    gatewayRelease: input.input.modelBinding.gatewayRelease,
    refusal: {
      code: refusalCode,
      message: sanitizeShortMessage(
        input.refusal.message,
        MAX_REFUSAL_MESSAGE_LENGTH,
      ),
    },
    caseEvaluations: [],
    aggregate,
  };
  return { report, caseQualitySignals: [], cacheHit: false };
};

const validateClientModelBinding = (
  input: RunSelfVerifyRubricPassInput,
): string | undefined => {
  const compatibilityMode: string = input.client.compatibilityMode;
  if (compatibilityMode !== "openai_chat") {
    return "self-verify rubric pass requires openai_chat compatibility mode";
  }
  if (
    input.client.deployment !== input.modelBinding.deployment ||
    input.client.modelRevision !== input.modelBinding.modelRevision ||
    input.client.gatewayRelease !== input.modelBinding.gatewayRelease
  ) {
    return "self-verify rubric modelBinding must match the gateway client identity";
  }
  return undefined;
};

const stampReportIdentity = (
  report: SelfVerifyRubricReport,
  stamps: {
    cacheHit: boolean;
    cacheKeyDigest: string;
    generatedAt: string;
    jobId: string;
    policyProfileId: string;
    modelBinding: {
      deployment: string;
      modelRevision: string;
      gatewayRelease: string;
    };
  },
): SelfVerifyRubricReport => {
  return {
    ...report,
    cacheHit: stamps.cacheHit,
    cacheKeyDigest: stamps.cacheKeyDigest,
    generatedAt: stamps.generatedAt,
    jobId: stamps.jobId,
    policyProfileId: stamps.policyProfileId,
    modelDeployment: stamps.modelBinding.deployment,
    modelRevision: stamps.modelBinding.modelRevision,
    gatewayRelease: stamps.modelBinding.gatewayRelease,
  };
};

/* -------------------------------------------------------------------- */
/*  Persistence                                                          */
/* -------------------------------------------------------------------- */

export interface WriteSelfVerifyRubricReportArtifactInput {
  report: SelfVerifyRubricReport;
  /** Run-dir root. The report is written under `<runDir>/testcases/...`. */
  runDir: string;
}

export interface WriteSelfVerifyRubricReportArtifactResult {
  artifactPath: string;
  bytes: number;
}

/** Persist the rubric report under `<runDir>/testcases/self-verify-rubric.json`. */
export const writeSelfVerifyRubricReportArtifact = async (
  input: WriteSelfVerifyRubricReportArtifactInput,
): Promise<WriteSelfVerifyRubricReportArtifactResult> => {
  const directory = join(input.runDir, SELF_VERIFY_RUBRIC_ARTIFACT_DIRECTORY);
  await mkdir(directory, { recursive: true });
  const artifactPath = join(
    directory,
    SELF_VERIFY_RUBRIC_REPORT_ARTIFACT_FILENAME,
  );
  const serialized = canonicalJson(input.report);
  const bytes = Buffer.byteLength(serialized, "utf8");
  const tmpPath = `${artifactPath}.${process.pid}.tmp`;
  await writeFile(tmpPath, serialized, "utf8");
  await rename(tmpPath, artifactPath);
  return { artifactPath, bytes };
};

/* -------------------------------------------------------------------- */
/*  Helpers                                                              */
/* -------------------------------------------------------------------- */

const roundTo = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
