/**
 * Logic-Judge — second, independent LLM roundtrip against the generator
 * output (Issue #1898).
 *
 * The Production Runner historically made a single generator LLM call;
 * the "harness" classified that one output (schema-pass / token-limit
 * / refusal) and called it `judgeAccepted`, but the result was
 * deterministic across attempts because no second model was invoked.
 *
 * This module supplies the missing roundtrip:
 *
 *   1. Build a deterministic, redacted judge prompt over the
 *      `BusinessTestIntentIr` + `GeneratedTestCaseList` (cache-stable
 *      hashes derived via canonical-JSON).
 *   2. Dispatch a structured-output LLM call against `gpt-oss-120b`
 *      attributed to the FinOps source label `judge_primary`.
 *   3. Validate the structured response against the closed
 *      `LogicJudgeVerdict` schema (verdict, findings, repair
 *      instructions).
 *   4. Return the validated verdict plus billed token counts so the
 *      runner can persist `agent-role-runs/logic_judge.json`,
 *      `compiled-prompt-judge.json`, and update the harness attempt
 *      result's real `judgeAccepted` flag.
 *
 * Heuristic local validation: the verdict the model returns is
 * cross-checked against the same contract surface the prompt
 * describes — coverage-truth, faithfulness-to-IR, banking
 * four-eyes, trace-completeness — so a model that fabricates an
 * `accept` verdict against a plainly-broken case is downgraded to
 * `repair` deterministically. The check is conservative: it never
 * upgrades a `repair`/`reject` verdict to `accept`.
 */

import { createHash } from "node:crypto";

import {
  ALLOWED_LOGIC_JUDGE_FINDING_CODES,
  ALLOWED_LOGIC_JUDGE_FINDING_SEVERITIES,
  ALLOWED_LOGIC_JUDGE_VERDICTS,
  LOGIC_JUDGE_MAX_FINDINGS,
  LOGIC_JUDGE_MAX_REPAIR_INSTRUCTIONS,
  LOGIC_JUDGE_OUTPUT_SCHEMA_NAME,
  LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION,
  LOGIC_JUDGE_REASON_MAX_CHARS,
  LOGIC_JUDGE_VERDICT_SCHEMA_VERSION,
  type AgentSourceLabel,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type LogicJudgeFinding,
  type LogicJudgeFindingCode,
  type LogicJudgeFindingSeverity,
  type LogicJudgeRepairInstruction,
  type LogicJudgeVerdict,
  type LogicJudgeVerdictKind,
  type LlmGenerationRequest,
  type LlmGenerationResult,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import type { FinOpsUsageRecorder } from "./finops-report.js";
import type { LlmGatewayClient } from "./llm-gateway.js";

/** Stable FinOps source label for every Logic-Judge dispatch. */
export const LOGIC_JUDGE_FINOPS_SOURCE: AgentSourceLabel = "judge_primary";

/** Banking risk categories that require a four-eyes step. */
const BANKING_FOUR_EYES_RISK_CATEGORIES: ReadonlySet<string> = new Set([
  "financial_transaction",
  "payment_initiation",
]);

const FOUR_EYES_KEYWORDS: ReadonlyArray<string> = [
  "vier-augen",
  "vier augen",
  "four-eyes",
  "four eyes",
  "freigabe",
  "approval",
  "approve",
  "authorise",
  "authorize",
];

/** JSON-Schema (draft-2020-12 subset) for {@link LogicJudgeVerdict} responses. */
export const LOGIC_JUDGE_RESPONSE_SCHEMA: Readonly<Record<string, unknown>> =
  Object.freeze({
    $id: LOGIC_JUDGE_OUTPUT_SCHEMA_NAME,
    type: "object",
    additionalProperties: false,
    required: ["verdict", "findings", "repairInstructions", "summary"],
    properties: {
      verdict: { type: "string", enum: [...ALLOWED_LOGIC_JUDGE_VERDICTS] },
      summary: { type: "string", maxLength: LOGIC_JUDGE_REASON_MAX_CHARS },
      findings: {
        type: "array",
        maxItems: LOGIC_JUDGE_MAX_FINDINGS,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["code", "severity", "reason"],
          properties: {
            code: {
              type: "string",
              enum: [...ALLOWED_LOGIC_JUDGE_FINDING_CODES],
            },
            severity: {
              type: "string",
              enum: [...ALLOWED_LOGIC_JUDGE_FINDING_SEVERITIES],
            },
            testCaseId: { type: "string", maxLength: 256 },
            reason: { type: "string", maxLength: LOGIC_JUDGE_REASON_MAX_CHARS },
          },
        },
      },
      repairInstructions: {
        type: "array",
        maxItems: LOGIC_JUDGE_MAX_REPAIR_INSTRUCTIONS,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["testCaseId", "mutationKind", "guidance"],
          properties: {
            testCaseId: { type: "string", maxLength: 256 },
            mutationKind: {
              type: "string",
              enum: [...ALLOWED_LOGIC_JUDGE_FINDING_CODES],
            },
            guidance: { type: "string", maxLength: LOGIC_JUDGE_REASON_MAX_CHARS },
          },
        },
      },
    },
  });

/** Compiled judge prompt artifact written to `compiled-prompt-judge.json`. */
export interface CompiledLogicJudgePrompt {
  readonly schemaVersion: typeof LOGIC_JUDGE_VERDICT_SCHEMA_VERSION;
  readonly promptTemplateVersion: typeof LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION;
  readonly outputSchemaName: typeof LOGIC_JUDGE_OUTPUT_SCHEMA_NAME;
  readonly modelBinding: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly responseSchema: Record<string, unknown>;
  readonly hashes: {
    readonly inputHash: string;
    readonly promptHash: string;
    readonly schemaHash: string;
  };
}

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;

const sanitizeLine = (value: string): string =>
  value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();

const safeReason = (value: string): string =>
  truncate(sanitizeLine(value), LOGIC_JUDGE_REASON_MAX_CHARS);

interface JudgeInputProjection {
  readonly jobId: string;
  readonly intent: {
    readonly fieldIds: readonly string[];
    readonly actionIds: readonly string[];
    readonly screenIds: readonly string[];
    readonly bankingScreens: readonly string[];
  };
  readonly testCases: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly riskCategory: string;
    readonly stepActions: readonly string[];
    readonly coveredFieldIds: readonly string[];
    readonly coveredActionIds: readonly string[];
    readonly figmaTraceRefs: ReadonlyArray<{
      readonly screenId: string;
      readonly nodeId: string | undefined;
    }>;
  }>;
}

const projectIntent = (
  intent: BusinessTestIntentIr,
): JudgeInputProjection["intent"] => {
  const fieldIds = intent.detectedFields.map((f) => f.id).sort();
  const actionIds = intent.detectedActions.map((a) => a.id).sort();
  const screenIds = intent.screens.map((s) => s.screenId).sort();
  const bankingScreens = intent.screens
    .filter((s) =>
      /(versicherung|police|schadensfall|risikoprüfung|bonität|antrag|abschluss|auszahlung|kündigung)/i.test(
        s.screenName,
      ),
    )
    .map((s) => s.screenId)
    .sort();
  return { fieldIds, actionIds, screenIds, bankingScreens };
};

const projectTestCase = (
  testCase: GeneratedTestCase,
): JudgeInputProjection["testCases"][number] => ({
  id: testCase.id,
  title: testCase.title,
  riskCategory: testCase.riskCategory,
  stepActions: testCase.steps.map((s) => sanitizeLine(s.action)),
  coveredFieldIds: [...testCase.qualitySignals.coveredFieldIds].sort(),
  coveredActionIds: [...testCase.qualitySignals.coveredActionIds].sort(),
  figmaTraceRefs: testCase.figmaTraceRefs.map((ref) => ({
    screenId: ref.screenId,
    nodeId: ref.nodeId,
  })),
});

const buildJudgeInputProjection = (input: {
  readonly jobId: string;
  readonly intent: BusinessTestIntentIr;
  readonly generatedList: GeneratedTestCaseList;
}): JudgeInputProjection => ({
  jobId: input.jobId,
  intent: projectIntent(input.intent),
  testCases: input.generatedList.testCases
    .map(projectTestCase)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
});

const SYSTEM_PROMPT = [
  "You are Logic-Judge, an independent quality reviewer for an automated test-case",
  "generation pipeline. You are not the generator. You receive the immutable Business",
  "Test Intent IR (the source of truth) and the generator's GeneratedTestCaseList,",
  "and you emit a structured verdict against a closed JSON schema.",
  "",
  "You evaluate exactly five contract dimensions:",
  "  1. Coverage truth — every test case must populate qualitySignals.coveredFieldIds",
  "     and qualitySignals.coveredActionIds with IR ids that exist in the IR. Empty",
  "     coverage arrays for non-trivial cases are a finding.",
  "  2. Faithfulness — coveredFieldIds / coveredActionIds must be subsets of the IR's",
  "     detectedFields[].id and detectedActions[].id. Inventing ids is a finding.",
  "  3. Schema strictness — required fields must be semantically meaningful, not just",
  "     >= 1 character. Blank-but-present strings are a finding.",
  "  4. Banking four-eyes — any case with riskCategory in {financial_transaction,",
  "     payment_initiation} must include at least one step naming an approval /",
  "     four-eyes / Freigabe / authorise gate.",
  "  5. Trace completeness — every step's figmaTraceRefs entry must include a nodeId,",
  "     not just a screenId.",
  "",
  "Verdict mapping:",
  "  - accept  — no blocker / major findings.",
  "  - repair  — at least one major finding; the case set is salvageable with",
  "              targeted mutations described in repairInstructions.",
  "  - reject  — at least one blocker finding; the case set must be regenerated.",
  "",
  "Output rules:",
  "  - Emit JSON only, matching the supplied response schema exactly.",
  "  - Findings are code-tagged from the closed enum; no free-text codes.",
  "  - Reasons and guidance are <= 480 characters, never carry chain of thought,",
  "    raw prompts, secrets, or model self-reflection.",
  "  - When verdict is not 'repair', repairInstructions MUST be empty.",
].join("\n");

const buildUserPrompt = (projection: JudgeInputProjection): string => {
  const lines: string[] = [];
  lines.push(`# Job: ${projection.jobId}`);
  lines.push("");
  lines.push("## Intent IR (source of truth)");
  lines.push(`- screenIds: ${JSON.stringify(projection.intent.screenIds)}`);
  lines.push(`- detectedFieldIds: ${JSON.stringify(projection.intent.fieldIds)}`);
  lines.push(
    `- detectedActionIds: ${JSON.stringify(projection.intent.actionIds)}`,
  );
  lines.push(
    `- bankingScreens: ${JSON.stringify(projection.intent.bankingScreens)}`,
  );
  lines.push("");
  lines.push("## Generated test cases");
  for (const testCase of projection.testCases) {
    lines.push(`### ${testCase.id}`);
    lines.push(`- title: ${testCase.title}`);
    lines.push(`- riskCategory: ${testCase.riskCategory}`);
    lines.push(
      `- coveredFieldIds: ${JSON.stringify(testCase.coveredFieldIds)}`,
    );
    lines.push(
      `- coveredActionIds: ${JSON.stringify(testCase.coveredActionIds)}`,
    );
    lines.push(`- stepActions: ${JSON.stringify(testCase.stepActions)}`);
    lines.push(
      `- figmaTraceRefs: ${JSON.stringify(testCase.figmaTraceRefs)}`,
    );
    lines.push("");
  }
  lines.push("Emit a single JSON document matching the response schema.");
  return lines.join("\n");
};

/**
 * Build the deterministic compiled judge prompt. Two calls with
 * structurally-identical inputs yield byte-identical hashes — the
 * caching discipline matches the generator's prompt compiler.
 */
export const buildCompiledLogicJudgePrompt = (input: {
  readonly jobId: string;
  readonly intent: BusinessTestIntentIr;
  readonly generatedList: GeneratedTestCaseList;
  readonly modelBinding: string;
}): CompiledLogicJudgePrompt => {
  const projection = buildJudgeInputProjection({
    jobId: input.jobId,
    intent: input.intent,
    generatedList: input.generatedList,
  });
  const userPrompt = buildUserPrompt(projection);
  const inputHash = sha256Hex(canonicalJson(projection));
  const promptHash = sha256Hex(
    canonicalJson({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      promptTemplateVersion: LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION,
    }),
  );
  const schemaHash = sha256Hex(canonicalJson(LOGIC_JUDGE_RESPONSE_SCHEMA));
  return {
    schemaVersion: LOGIC_JUDGE_VERDICT_SCHEMA_VERSION,
    promptTemplateVersion: LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION,
    outputSchemaName: LOGIC_JUDGE_OUTPUT_SCHEMA_NAME,
    modelBinding: input.modelBinding,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    responseSchema: LOGIC_JUDGE_RESPONSE_SCHEMA as Record<string, unknown>,
    hashes: { inputHash, promptHash, schemaHash },
  };
};

/** Result of {@link parseLogicJudgeResponse}. */
export type ParseLogicJudgeResponseResult =
  | {
      readonly ok: true;
      readonly verdict: LogicJudgeVerdictKind;
      readonly summary: string;
      readonly findings: readonly LogicJudgeFinding[];
      readonly repairInstructions: readonly LogicJudgeRepairInstruction[];
    }
  | { readonly ok: false; readonly message: string };

const isFindingCode = (value: unknown): value is LogicJudgeFindingCode =>
  typeof value === "string" &&
  (ALLOWED_LOGIC_JUDGE_FINDING_CODES as readonly string[]).includes(value);

const isFindingSeverity = (
  value: unknown,
): value is LogicJudgeFindingSeverity =>
  typeof value === "string" &&
  (ALLOWED_LOGIC_JUDGE_FINDING_SEVERITIES as readonly string[]).includes(value);

const isVerdictKind = (value: unknown): value is LogicJudgeVerdictKind =>
  typeof value === "string" &&
  (ALLOWED_LOGIC_JUDGE_VERDICTS as readonly string[]).includes(value);

const sortFindings = (
  findings: readonly LogicJudgeFinding[],
): readonly LogicJudgeFinding[] =>
  [...findings].sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    const aId = a.testCaseId ?? "";
    const bId = b.testCaseId ?? "";
    if (aId !== bId) return aId < bId ? -1 : 1;
    if (a.reason !== b.reason) return a.reason < b.reason ? -1 : 1;
    return 0;
  });

const sortRepairs = (
  repairs: readonly LogicJudgeRepairInstruction[],
): readonly LogicJudgeRepairInstruction[] =>
  [...repairs].sort((a, b) => {
    if (a.testCaseId !== b.testCaseId)
      return a.testCaseId < b.testCaseId ? -1 : 1;
    if (a.mutationKind !== b.mutationKind)
      return a.mutationKind < b.mutationKind ? -1 : 1;
    return 0;
  });

/**
 * Parse and validate a raw LLM response into a Logic-Judge verdict.
 * Returns `{ ok: false }` (with a redacted message) on any structural
 * mismatch — the caller routes that to a `ProductionRunnerError`
 * with `failureClass: "LLM_RESPONSE_INVALID"`.
 */
export const parseLogicJudgeResponse = (
  rawContent: unknown,
): ParseLogicJudgeResponseResult => {
  let parsed: unknown = rawContent;
  if (typeof rawContent === "string") {
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      return { ok: false, message: "judge response is not valid JSON" };
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: "judge response is not a JSON object" };
  }
  const obj = parsed as Record<string, unknown>;
  if (!isVerdictKind(obj["verdict"])) {
    return { ok: false, message: "judge response missing verdict literal" };
  }
  if (typeof obj["summary"] !== "string") {
    return { ok: false, message: "judge response missing summary string" };
  }
  if (!Array.isArray(obj["findings"])) {
    return { ok: false, message: "judge response findings is not an array" };
  }
  if (!Array.isArray(obj["repairInstructions"])) {
    return {
      ok: false,
      message: "judge response repairInstructions is not an array",
    };
  }
  const findings: LogicJudgeFinding[] = [];
  for (const raw of obj["findings"] as unknown[]) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, message: "judge finding is not an object" };
    }
    const entry = raw as Record<string, unknown>;
    if (!isFindingCode(entry["code"])) {
      return { ok: false, message: "judge finding has invalid code" };
    }
    if (!isFindingSeverity(entry["severity"])) {
      return { ok: false, message: "judge finding has invalid severity" };
    }
    if (typeof entry["reason"] !== "string") {
      return { ok: false, message: "judge finding reason is not a string" };
    }
    const finding: LogicJudgeFinding = {
      code: entry["code"],
      severity: entry["severity"],
      reason: safeReason(entry["reason"]),
      ...(typeof entry["testCaseId"] === "string" &&
      entry["testCaseId"].length > 0
        ? { testCaseId: entry["testCaseId"] }
        : {}),
    };
    findings.push(finding);
  }
  if (findings.length > LOGIC_JUDGE_MAX_FINDINGS) {
    return { ok: false, message: "judge response exceeds findings cap" };
  }
  const repairInstructions: LogicJudgeRepairInstruction[] = [];
  for (const raw of obj["repairInstructions"] as unknown[]) {
    if (typeof raw !== "object" || raw === null) {
      return {
        ok: false,
        message: "judge repair instruction is not an object",
      };
    }
    const entry = raw as Record<string, unknown>;
    if (typeof entry["testCaseId"] !== "string" || entry["testCaseId"].length === 0) {
      return {
        ok: false,
        message: "judge repair instruction missing testCaseId",
      };
    }
    if (!isFindingCode(entry["mutationKind"])) {
      return {
        ok: false,
        message: "judge repair instruction has invalid mutationKind",
      };
    }
    if (typeof entry["guidance"] !== "string") {
      return {
        ok: false,
        message: "judge repair instruction guidance is not a string",
      };
    }
    repairInstructions.push({
      testCaseId: entry["testCaseId"],
      mutationKind: entry["mutationKind"],
      guidance: safeReason(entry["guidance"]),
    });
  }
  if (repairInstructions.length > LOGIC_JUDGE_MAX_REPAIR_INSTRUCTIONS) {
    return {
      ok: false,
      message: "judge response exceeds repairInstructions cap",
    };
  }
  if (obj["verdict"] !== "repair" && repairInstructions.length > 0) {
    return {
      ok: false,
      message:
        "judge response carries repairInstructions for a non-'repair' verdict",
    };
  }
  return {
    ok: true,
    verdict: obj["verdict"],
    summary: safeReason(obj["summary"]),
    findings: sortFindings(findings),
    repairInstructions: sortRepairs(repairInstructions),
  };
};

interface DerivedFinding {
  readonly finding: LogicJudgeFinding;
  readonly downgradeTo: LogicJudgeVerdictKind;
}

/**
 * Locally derive findings from the IR + generated-test-case projection.
 * Used to (1) seed the prompt with concrete examples and (2) downgrade
 * a fabricated `accept` verdict when the generator output is plainly
 * broken. Conservative: never upgrades a `repair`/`reject` verdict.
 */
const deriveLocalFindings = (
  intent: BusinessTestIntentIr,
  generatedList: GeneratedTestCaseList,
): readonly DerivedFinding[] => {
  const fieldIds = new Set(intent.detectedFields.map((f) => f.id));
  const actionIds = new Set(intent.detectedActions.map((a) => a.id));
  const out: DerivedFinding[] = [];
  for (const testCase of generatedList.testCases) {
    const isTrivial =
      testCase.steps.length <= 1 && testCase.preconditions.length === 0;
    if (
      !isTrivial &&
      testCase.qualitySignals.coveredFieldIds.length === 0 &&
      testCase.qualitySignals.coveredActionIds.length === 0
    ) {
      out.push({
        finding: {
          code: "coverage_fields_missing",
          severity: "major",
          testCaseId: testCase.id,
          reason:
            "qualitySignals.coveredFieldIds and coveredActionIds are both empty",
        },
        downgradeTo: "repair",
      });
    }
    for (const fieldId of testCase.qualitySignals.coveredFieldIds) {
      if (!fieldIds.has(fieldId)) {
        out.push({
          finding: {
            code: "faithfulness_unknown_field",
            severity: "blocker",
            testCaseId: testCase.id,
            reason: `coveredFieldIds names "${fieldId}" which is not in the IR`,
          },
          downgradeTo: "reject",
        });
      }
    }
    for (const actionId of testCase.qualitySignals.coveredActionIds) {
      if (!actionIds.has(actionId)) {
        out.push({
          finding: {
            code: "faithfulness_unknown_action",
            severity: "blocker",
            testCaseId: testCase.id,
            reason: `coveredActionIds names "${actionId}" which is not in the IR`,
          },
          downgradeTo: "reject",
        });
      }
    }
    if (BANKING_FOUR_EYES_RISK_CATEGORIES.has(testCase.riskCategory)) {
      const stepCorpus = testCase.steps
        .map((s) =>
          [s.action, s.expected ?? "", s.data ?? ""].join(" ").toLowerCase(),
        )
        .join(" ");
      const hasFourEyes = FOUR_EYES_KEYWORDS.some((kw) =>
        stepCorpus.includes(kw),
      );
      if (!hasFourEyes) {
        out.push({
          finding: {
            code: "banking_four_eyes_missing",
            severity: "major",
            testCaseId: testCase.id,
            reason: `riskCategory ${testCase.riskCategory} requires a four-eyes / Freigabe step`,
          },
          downgradeTo: "repair",
        });
      }
    }
    for (const step of testCase.steps) {
      const traceForScreen = testCase.figmaTraceRefs.find(
        (ref) => ref.nodeId !== undefined && ref.nodeId.length > 0,
      );
      if (traceForScreen === undefined) {
        out.push({
          finding: {
            code: "trace_node_id_missing",
            severity: "major",
            testCaseId: testCase.id,
            reason: `step ${step.index} has no figmaTraceRefs entry with a nodeId`,
          },
          downgradeTo: "repair",
        });
        break;
      }
    }
  }
  return out;
};

/** Conservative downgrade: never upgrades, only weakens an `accept`. */
const reconcileVerdict = (
  modelVerdict: LogicJudgeVerdictKind,
  derivedDowngrade: LogicJudgeVerdictKind | "accept",
): LogicJudgeVerdictKind => {
  if (modelVerdict === "reject") return "reject";
  if (modelVerdict === "repair") return "repair";
  // modelVerdict === "accept"
  if (derivedDowngrade === "reject") return "reject";
  if (derivedDowngrade === "repair") return "repair";
  return "accept";
};

/** Result returned to the Production Runner. */
export interface RunLogicJudgeResult {
  readonly verdict: LogicJudgeVerdict;
  readonly compiledPrompt: CompiledLogicJudgePrompt;
  readonly llmResult: LlmGenerationResult;
  readonly judgeAccepted: boolean;
}

export interface RunLogicJudgeInput {
  readonly jobId: string;
  readonly intent: BusinessTestIntentIr;
  readonly generatedList: GeneratedTestCaseList;
  readonly llmClient: LlmGatewayClient;
  readonly finopsRecorder: FinOpsUsageRecorder;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly maxWallClockMs?: number;
  readonly abortSignal?: AbortSignal;
}

/** Sentinel error class for judge-side failures. */
export class LogicJudgeError extends Error {
  readonly retryable: boolean;
  readonly errorClass:
    | "judge_response_invalid"
    | "judge_gateway_failed"
    | "judge_refusal";
  constructor(input: {
    message: string;
    retryable: boolean;
    errorClass:
      | "judge_response_invalid"
      | "judge_gateway_failed"
      | "judge_refusal";
    cause?: unknown;
  }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "LogicJudgeError";
    this.retryable = input.retryable;
    this.errorClass = input.errorClass;
  }
}

const buildLlmRequest = (input: {
  readonly jobId: string;
  readonly compiled: CompiledLogicJudgePrompt;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly maxWallClockMs?: number;
  readonly abortSignal?: AbortSignal;
  readonly modelBinding: string;
  readonly policyProfileHash: string;
}): LlmGenerationRequest => ({
  jobId: input.jobId,
  systemPrompt: input.compiled.systemPrompt,
  userPrompt: input.compiled.userPrompt,
  responseSchema: input.compiled.responseSchema,
  responseSchemaName: input.compiled.outputSchemaName,
  ...(input.maxInputTokens !== undefined
    ? { maxInputTokens: input.maxInputTokens }
    : {}),
  ...(input.maxOutputTokens !== undefined
    ? { maxOutputTokens: input.maxOutputTokens }
    : {}),
  ...(input.maxWallClockMs !== undefined
    ? { maxWallClockMs: input.maxWallClockMs }
    : {}),
  ...(input.abortSignal !== undefined
    ? { abortSignal: input.abortSignal }
    : {}),
  inFlightDedup: {
    source: LOGIC_JUDGE_FINOPS_SOURCE,
    inputHash: input.compiled.hashes.inputHash,
    promptHash: input.compiled.hashes.promptHash,
    modelBinding: input.modelBinding,
    schemaHash: input.compiled.hashes.schemaHash,
    policyProfileHash: input.policyProfileHash,
  },
});

/**
 * Dispatch the second LLM roundtrip and return the validated verdict.
 *
 * On a structured error (gateway failure, schema-invalid response,
 * refusal) the function throws {@link LogicJudgeError}; the caller
 * maps it onto the harness attempt-result error class.
 */
export const runLogicJudge = async (
  input: RunLogicJudgeInput,
): Promise<RunLogicJudgeResult> => {
  const startedAt = Date.now();
  const compiled = buildCompiledLogicJudgePrompt({
    jobId: input.jobId,
    intent: input.intent,
    generatedList: input.generatedList,
    modelBinding: input.llmClient.modelRevision,
  });
  const request = buildLlmRequest({
    jobId: input.jobId,
    compiled,
    ...(input.maxInputTokens !== undefined
      ? { maxInputTokens: input.maxInputTokens }
      : {}),
    ...(input.maxOutputTokens !== undefined
      ? { maxOutputTokens: input.maxOutputTokens }
      : {}),
    ...(input.maxWallClockMs !== undefined
      ? { maxWallClockMs: input.maxWallClockMs }
      : {}),
    ...(input.abortSignal !== undefined
      ? { abortSignal: input.abortSignal }
      : {}),
    modelBinding: input.llmClient.modelRevision,
    policyProfileHash: sha256Hex(
      `${LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION}|${LOGIC_JUDGE_OUTPUT_SCHEMA_NAME}`,
    ),
  });

  const llmResult = await input.llmClient.generate(request);
  const durationMs = Date.now() - startedAt;
  input.finopsRecorder.recordAttempt({
    role: "test_generation",
    source: LOGIC_JUDGE_FINOPS_SOURCE,
    deployment: input.llmClient.deployment,
    durationMs,
    result: llmResult,
    liveSmoke: false,
    fallback: false,
  });
  if (llmResult.outcome !== "success") {
    if (llmResult.errorClass === "refusal") {
      throw new LogicJudgeError({
        message: `Logic-Judge refused to produce a verdict: ${llmResult.message}`,
        retryable: false,
        errorClass: "judge_refusal",
      });
    }
    throw new LogicJudgeError({
      message: `Logic-Judge gateway returned ${llmResult.errorClass}: ${llmResult.message}`,
      retryable: llmResult.retryable,
      errorClass: "judge_gateway_failed",
    });
  }
  const parsed = parseLogicJudgeResponse(llmResult.content);
  if (!parsed.ok) {
    throw new LogicJudgeError({
      message: `Logic-Judge response did not match the expected schema: ${parsed.message}`,
      retryable: false,
      errorClass: "judge_response_invalid",
    });
  }
  const localDerived = deriveLocalFindings(input.intent, input.generatedList);
  const localDowngrade: LogicJudgeVerdictKind | "accept" = localDerived.some(
    (d) => d.downgradeTo === "reject",
  )
    ? "reject"
    : localDerived.length > 0
      ? "repair"
      : "accept";
  const reconciled = reconcileVerdict(parsed.verdict, localDowngrade);
  const mergedFindings: LogicJudgeFinding[] = [...parsed.findings];
  for (const derived of localDerived) {
    const alreadyPresent = mergedFindings.some(
      (f) =>
        f.code === derived.finding.code &&
        f.testCaseId === derived.finding.testCaseId,
    );
    if (!alreadyPresent) mergedFindings.push(derived.finding);
  }
  if (mergedFindings.length > LOGIC_JUDGE_MAX_FINDINGS) {
    mergedFindings.length = LOGIC_JUDGE_MAX_FINDINGS;
  }
  const repairInstructions =
    reconciled === "repair" ? parsed.repairInstructions : [];
  const verdict: LogicJudgeVerdict = {
    schemaVersion: LOGIC_JUDGE_VERDICT_SCHEMA_VERSION,
    jobId: input.jobId,
    verdict: reconciled,
    modelBinding: input.llmClient.modelRevision,
    promptTemplateVersion: LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION,
    promptHash: compiled.hashes.promptHash,
    schemaHash: compiled.hashes.schemaHash,
    inputHash: compiled.hashes.inputHash,
    findings: sortFindings(mergedFindings),
    repairInstructions,
    summary: parsed.summary,
    ...(llmResult.usage.inputTokens !== undefined
      ? { inputTokens: llmResult.usage.inputTokens }
      : {}),
    ...(llmResult.usage.outputTokens !== undefined
      ? { outputTokens: llmResult.usage.outputTokens }
      : {}),
  };
  return {
    verdict,
    compiledPrompt: compiled,
    llmResult,
    judgeAccepted: reconciled === "accept",
  };
};
