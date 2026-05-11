/**
 * Production-runner repair loop (Issue #1900, Story MA-3 #1758,
 * Issue #1928).
 *
 * Orchestrates the bounded-iteration repair loop that drives the
 * generator → judge-panel → repair-planner → re-generator cycle. The
 * loop is invoked AFTER the initial test_generation pass and the first
 * round of judge verdicts have been computed; given those inputs it:
 *
 *   1. Returns immediately with `outcome="accepted"` when both judges
 *      already accept the initial output.
 *   2. Otherwise runs up to `maxRepairIterations` repair iterations
 *      (default 3, bounded by {@link REPAIR_LOOP_MAX_ITERATIONS_HARD_CAP}).
 *      Initial-pass `reject` verdicts also enter the loop (Issue #1928):
 *      live runs showed the Logic-Judge frequently emits `reject` for
 *      recoverable structured-output schema violations from the
 *      generator LLM, and short-circuiting before iteration 1 silently
 *      disabled recovery. Each iteration:
 *        a. Consolidates the union of `repairInstructions` from the
 *           logic-judge plus the synthesized hallucination/mismatch
 *           hints from the faithfulness-judge.
 *        b. Persists `agent-role-runs/repair_planner_iter_K.json`.
 *        c. Re-invokes the generator with the consolidated instructions
 *           via the caller-supplied `regenerate` callback.
 *        d. Persists `agent-role-runs/test_generation_repair_iter_K.json`.
 *        e. Re-runs both judges on the new list.
 *        f. Terminates with `accepted` when the logic-judge accepts
 *           and the faithfulness-judge either accepts or was not run
 *           for this iteration; `rejected` when the logic-judge
 *           rejects, or the faithfulness-judge rejects when it was
 *           run; otherwise continues.
 *      When the cap is exhausted the outcome is `"needs_review"`.
 *
 * The repair_planner is a deterministic consolidator: it does NOT
 * dispatch a third LLM roundtrip. The artifact still records the
 * iteration so the operator can audit the planner's output, and the
 * repair_planner FinOps source label is reserved for future
 * LLM-driven planner upgrades.
 */

import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  type FaithfulnessVerdict,
  type GeneratedTestCaseList,
  type JudgeVerdict,
  type LlmGenerationResult,
  type RepairInstruction,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import {
  INSTRUCTION_LENGTH_LIMITS,
  countTruncatedInstructions,
  truncateInstructionWithAudit,
  truncateWithEllipsis,
} from "./judge-limits.js";

/** Schema version of the repair-loop per-iteration artifacts. */
export const REPAIR_LOOP_SCHEMA_VERSION = "1.0.0" as const;

/** Default cap on repair iterations after the initial pass. */
export const REPAIR_LOOP_DEFAULT_MAX_ITERATIONS = 3 as const;

/** Hard upper bound on repair iterations regardless of caller request. */
export const REPAIR_LOOP_MAX_ITERATIONS_HARD_CAP = 5 as const;

/** Filename prefix for the repair planner per-iteration artifact. */
export const REPAIR_PLANNER_ARTIFACT_PREFIX = "repair_planner_iter_" as const;

/** Filename prefix for the test_generation repair per-iteration artifact. */
export const TEST_GENERATION_REPAIR_ARTIFACT_PREFIX =
  "test_generation_repair_iter_" as const;

/**
 * Filename for the convergence-trace artifact written when the repair
 * loop aborts because two consecutive iterations produced the same
 * verdict signature (Issue #1939).
 */
export const REPAIR_LOOP_TRACE_ARTIFACT_FILENAME =
  "repair-loop-trace.json" as const;

/**
 * Filename for the budget-trace artifact written when the repair loop
 * aborts because the next regeneration would have exceeded the
 * generator's FinOps token / attempt budget (Issue #2016).
 */
export const REPAIR_LOOP_BUDGET_TRACE_ARTIFACT_FILENAME =
  "repair-loop-budget-trace.json" as const;

/**
 * Terminal outcomes of the repair loop.
 *
 * `convergence_stalled` (Issue #1939, sharpened by Issue #2016) is emitted
 * when the verdict signature of iteration K is identical to iteration K-1
 * — i.e., the LLM is producing the same class of error across iterations
 * and burning tokens with no forward progress. The runner treats this as
 * a soft outcome (the latest best-effort case set is still handed to the
 * policy gate).
 *
 * `budget_exhausted` (Issue #2016) is emitted when the loop has caller-
 * supplied generator-attempt or generator-output-token guards configured,
 * and a further regeneration would either exceed `maxGeneratorAttempts`
 * or push the cumulative output beyond `maxGeneratorOutputTokens` (using
 * `expectedNextOutputTokens` as the worst-case projection). The loop
 * stops *before* producing the breaching call so the FinOps report can
 * remain breach-free; the latest best-effort list is still returned for
 * downstream gates.
 */
export type RepairLoopOutcome =
  | "accepted"
  | "rejected"
  | "needs_review"
  | "convergence_stalled"
  | "budget_exhausted";

/** Per-iteration record exposed via the loop result for downstream observability. */
export interface RepairLoopIterationRecord {
  /** 0 = initial pass (input from caller); 1..K = repair iterations. */
  readonly iteration: number;
  readonly logicVerdict: JudgeVerdict["verdict"];
  /** "skipped" when the faithfulness judge was not run for this iteration. */
  readonly faithfulnessVerdict: FaithfulnessVerdict["verdict"] | "skipped";
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly generatedCaseCount: number;
  /** sha256 of the canonical-JSON `GeneratedTestCaseList` for this iteration. */
  readonly outputHash: string;
  /**
   * Stable hash of (logic verdict, sorted finding codes, sorted repair
   * instruction kinds) used by the convergence detector (Issue #1939).
   */
  readonly verdictSignature: string;
}

/** Final result returned by {@link runRepairLoop}. */
export interface RepairLoopResult {
  readonly outcome: RepairLoopOutcome;
  readonly finalList: GeneratedTestCaseList;
  readonly finalLogicVerdict: JudgeVerdict;
  readonly finalFaithfulnessVerdict?: FaithfulnessVerdict;
  readonly iterations: readonly RepairLoopIterationRecord[];
  /** Number of repair iterations actually executed (excludes the initial pass). */
  readonly repairIterationCount: number;
  /** Effective cap applied for this run (after clamping). */
  readonly maxRepairIterations: number;
}

/** Inputs handed to the caller-supplied generator-regeneration callback. */
export interface RepairLoopRegenerateInput {
  readonly previousList: GeneratedTestCaseList;
  readonly repairInstructions: readonly RepairInstruction[];
  readonly truncatedInstructionCount: number;
  /** 1-based iteration counter (always >= 1 for repair iterations). */
  readonly iteration: number;
}

/** Outputs expected from the caller-supplied generator-regeneration callback. */
export interface RepairLoopRegenerateResult {
  readonly list: GeneratedTestCaseList;
  readonly llmResult: LlmGenerationResult;
  readonly llmDurationMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly hashes: {
    readonly inputHash: string;
    readonly promptHash: string;
    readonly schemaHash: string;
    readonly cacheKey: string;
  };
}

export type RepairLoopRegenerator = (
  input: RepairLoopRegenerateInput,
) => Promise<RepairLoopRegenerateResult>;

/** Inputs handed to a per-iteration judge-runner callback. */
export interface RepairLoopJudgeRunnerInput {
  readonly list: GeneratedTestCaseList;
  readonly iteration: number;
}

/** Outputs expected from a per-iteration logic-judge callback. */
export interface RepairLoopLogicJudgeResult {
  readonly verdict: JudgeVerdict;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Outputs expected from a per-iteration faithfulness-judge callback. */
export interface RepairLoopFaithfulnessJudgeResult {
  readonly verdict: FaithfulnessVerdict;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export type RepairLoopLogicJudgeRunner = (
  input: RepairLoopJudgeRunnerInput,
) => Promise<RepairLoopLogicJudgeResult>;

export type RepairLoopFaithfulnessJudgeRunner = (
  input: RepairLoopJudgeRunnerInput,
) => Promise<RepairLoopFaithfulnessJudgeResult>;

/**
 * Generator-side budget guard inputs (Issue #2016).
 *
 * The repair loop accumulates generator-only output tokens and attempts as
 * iterations execute. When this guard is supplied, the loop refuses to start
 * the next regeneration if doing so would push the *projected* cumulative
 * over either limit, returning `budget_exhausted` instead. The point of
 * stopping early — versus running and recording a FinOps breach — is to
 * keep `finops.breaches=[]` for runs that were merely going to exhaust
 * the loop budget by design.
 *
 * `initialGeneratorOutputTokens` and `initialGeneratorAttempts` describe
 * the spend booked by the *initial* (pre-loop) generator pass; the loop
 * adds its own per-iteration generator spend on top.
 */
export interface RepairLoopBudgetGuard {
  /** Output tokens already produced by the initial-pass generator. */
  readonly initialGeneratorOutputTokens?: number;
  /**
   * Maximum total generator output tokens permitted across the initial
   * pass plus all repair iterations. Inclusive — equality is allowed.
   */
  readonly maxGeneratorOutputTokens?: number;
  /**
   * Worst-case projected output tokens for the next regeneration call.
   * Defaults to `maxGeneratorOutputTokens / 2` when unset, falling back
   * to a conservative `4096` if neither is supplied.
   */
  readonly expectedNextOutputTokens?: number;
  /** Generator attempts already counted from the initial pass (typically 1). */
  readonly initialGeneratorAttempts?: number;
  /**
   * Maximum total generator attempts permitted across the initial pass plus
   * all repair iterations. Inclusive.
   */
  readonly maxGeneratorAttempts?: number;
}

/** Inputs to {@link runRepairLoop}. */
export interface RunRepairLoopInput {
  readonly jobId: string;
  /** Run directory under which `agent-role-runs/...` artifacts live. */
  readonly runDir: string;
  readonly initialList: GeneratedTestCaseList;
  readonly initialLogicVerdict: JudgeVerdict;
  readonly initialFaithfulnessVerdict?: FaithfulnessVerdict;
  /** Defaults to {@link REPAIR_LOOP_DEFAULT_MAX_ITERATIONS}. */
  readonly maxRepairIterations?: number;
  readonly regenerate: RepairLoopRegenerator;
  readonly runLogicJudge: RepairLoopLogicJudgeRunner;
  readonly runFaithfulnessJudge?: RepairLoopFaithfulnessJudgeRunner;
  /**
   * When true, the loop recovers from unexpected generator / judge failures
   * by returning `needs_review` with the current list instead of throwing.
   */
  readonly softFailOnIterationError?: boolean;
  /** Notification fired once per iteration record (including iteration 0). */
  readonly onIterationComplete?: (record: RepairLoopIterationRecord) => void;
  /**
   * Optional FinOps-side budget guard (Issue #2016). When supplied, the
   * loop refuses to start the next regeneration if doing so would breach
   * the cumulative generator-output-token or attempt budget. See
   * {@link RepairLoopBudgetGuard}.
   */
  readonly budget?: RepairLoopBudgetGuard;
}

/** Persisted shape of the repair_planner_iter_K artifact. */
export interface RepairPlannerIterationArtifact {
  readonly schemaVersion: typeof REPAIR_LOOP_SCHEMA_VERSION;
  readonly jobId: string;
  readonly iteration: number;
  readonly source: "deterministic_consolidator";
  readonly inputs: {
    readonly logicVerdictHash: string;
    readonly faithfulnessVerdictHash?: string;
    readonly previousListHash: string;
  };
  readonly outputs: {
    readonly repairInstructions: readonly RepairInstruction[];
    readonly repairInstructionCount: number;
    readonly truncatedInstructionCount: number;
  };
}

/**
 * Persisted shape of the convergence-trace artifact (Issue #1939).
 *
 * Written exactly once per loop, only when the loop terminates with
 * `convergence_stalled`. Captures the full per-iteration verdict-signature
 * history so operators can audit which class of error the LLM was unable
 * to make progress against.
 */
export interface RepairLoopTraceArtifact {
  readonly schemaVersion: typeof REPAIR_LOOP_SCHEMA_VERSION;
  readonly jobId: string;
  readonly outcome: "convergence_stalled";
  /** Iteration K at which `signature[K] == signature[K-1]` was detected. */
  readonly stallDetectedAtIteration: number;
  /** Hash that was stable across iterations K-1 and K. */
  readonly stallSignature: string;
  readonly iterations: readonly {
    readonly iteration: number;
    readonly logicVerdict: JudgeVerdict["verdict"];
    readonly faithfulnessVerdict: FaithfulnessVerdict["verdict"] | "skipped";
    readonly verdictSignature: string;
  }[];
}

/**
 * Persisted shape of the budget-trace artifact (Issue #2016).
 *
 * Written exactly once per loop, only when the loop terminates with
 * `budget_exhausted`. Captures the cumulative generator spend (output
 * tokens and attempts) at the moment the guard fired plus the operator-
 * configured limits, so an operator can audit whether the budget was
 * sized correctly for the dataset.
 */
export interface RepairLoopBudgetTraceArtifact {
  readonly schemaVersion: typeof REPAIR_LOOP_SCHEMA_VERSION;
  readonly jobId: string;
  readonly outcome: "budget_exhausted";
  /**
   * Iteration K *that would have been started* when the guard fired. K=1
   * means the guard tripped before any repair iteration ran; K=N+1 means
   * the guard tripped after iteration N completed successfully.
   */
  readonly stoppedBeforeIteration: number;
  readonly trigger: "max_generator_output_tokens" | "max_generator_attempts";
  readonly cumulativeGeneratorOutputTokens: number;
  readonly cumulativeGeneratorAttempts: number;
  readonly maxGeneratorOutputTokens?: number;
  readonly maxGeneratorAttempts?: number;
  readonly expectedNextOutputTokens: number;
}

/** Persisted shape of the test_generation_repair_iter_K artifact. */
export interface TestGenerationRepairIterationArtifact {
  readonly schemaVersion: typeof REPAIR_LOOP_SCHEMA_VERSION;
  readonly jobId: string;
  readonly iteration: number;
  readonly inputs: {
    readonly previousListHash: string;
    readonly repairInstructionsHash: string;
    readonly repairInstructionCount: number;
    readonly truncatedInstructionCount: number;
  };
  readonly outputs: {
    readonly listHash: string;
    readonly testCaseCount: number;
  };
  readonly llmGateway: {
    readonly outcome: "success" | "error";
    readonly errorClass?: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly durationMs: number;
    readonly modelDeployment: string;
  };
  readonly hashes: {
    readonly inputHash: string;
    readonly promptHash: string;
    readonly schemaHash: string;
    readonly cacheKey: string;
  };
}

const truncatePath = (value: string): string =>
  truncateWithEllipsis(value, INSTRUCTION_LENGTH_LIMITS.path).value;

const truncateMessage = (value: string): string =>
  truncateWithEllipsis(value, INSTRUCTION_LENGTH_LIMITS.message).value;

const truncateInstruction = (value: string) =>
  truncateInstructionWithAudit(value);

const compareInstruction = (
  left: RepairInstruction,
  right: RepairInstruction,
): number =>
  (left.kind ?? "").localeCompare(right.kind ?? "") ||
  (left.message ?? "").localeCompare(right.message ?? "") ||
  left.testCaseId.localeCompare(right.testCaseId) ||
  left.path.localeCompare(right.path) ||
  left.instruction.localeCompare(right.instruction);

/**
 * Deterministically union the logic-judge `repairInstructions` with hints
 * synthesised from the faithfulness-judge's hallucinations and mismatches.
 * Result is deduplicated and sorted so two callers receiving the same input
 * always produce byte-identical artifacts.
 */
export const consolidateRepairInstructions = (input: {
  readonly logic: JudgeVerdict;
  readonly faithfulness?: FaithfulnessVerdict;
}): {
  readonly repairInstructions: readonly RepairInstruction[];
  readonly truncatedInstructionCount: number;
} => {
  const collected: RepairInstruction[] = [];
  for (const ri of input.logic.repairInstructions) {
    const instruction = truncateInstruction(ri.instruction);
    collected.push({
      testCaseId: ri.testCaseId,
      path: truncatePath(ri.path),
      instruction: instruction.value,
      ...(ri.instructionTruncated === true || instruction.truncated
        ? { instructionTruncated: true }
        : {}),
      ...(ri.kind !== undefined ? { kind: ri.kind } : {}),
      ...(ri.message !== undefined
        ? { message: truncateMessage(ri.message) }
        : {}),
    });
  }
  if (input.faithfulness !== undefined) {
    for (const hallucination of input.faithfulness.hallucinations) {
      const path =
        hallucination.stepIndex !== undefined
          ? `steps[${hallucination.stepIndex}]`
          : "$case";
      const instruction = truncateInstruction(
        `Faithfulness hallucination: ${hallucination.message}`,
      );
      collected.push({
        testCaseId: hallucination.testCaseId,
        path: truncatePath(path),
        instruction: instruction.value,
        ...(instruction.truncated ? { instructionTruncated: true } : {}),
      });
    }
    for (const mismatch of input.faithfulness.mismatches) {
      const path =
        mismatch.stepIndex !== undefined
          ? `steps[${mismatch.stepIndex}].expected`
          : "expectedResults";
      const instruction = truncateInstruction(
        `Faithfulness mismatch (expected="${mismatch.expectedLabel}", visible="${mismatch.visibleLabel}"): ${mismatch.message}`,
      );
      collected.push({
        testCaseId: mismatch.testCaseId,
        path: truncatePath(path),
        instruction: instruction.value,
        ...(instruction.truncated ? { instructionTruncated: true } : {}),
      });
    }
  }
  const dedup = new Map<string, RepairInstruction>();
  for (const entry of collected) {
    const key = [
      entry.kind ?? "",
      entry.message ?? "",
      entry.testCaseId,
      entry.path,
      entry.instruction,
    ].join("\0");
    if (!dedup.has(key)) {
      dedup.set(key, entry);
    }
  }
  const repairInstructions = [...dedup.values()].sort(compareInstruction);
  return {
    repairInstructions,
    truncatedInstructionCount: countTruncatedInstructions(repairInstructions),
  };
};

/**
 * Stable hash of (logic verdict, sorted finding codes, sorted repair
 * instruction kinds) used by the convergence detector (Issue #1939).
 *
 * The signature deliberately ignores free-form fields like `message` and
 * `instruction` so that two iterations whose LLM output differs only
 * cosmetically are still classified as the same error class. The faithfulness
 * verdict is intentionally excluded: the detector targets the dominant
 * source of futile iterations (logic-judge findings repeating with no
 * structural change).
 */
export const computeVerdictSignature = (logic: JudgeVerdict): string => {
  const findingCodes = logic.findings.map((f) => f.code).sort();
  const repairInstructionKinds = logic.repairInstructions
    .map((ri) => ri.kind ?? "")
    .sort();
  return sha256Hex({
    verdict: logic.verdict,
    findingCodes,
    repairInstructionKinds,
  });
};

const writeAtomicJson = async (
  filePath: string,
  payload: unknown,
): Promise<void> => {
  await mkdir(dirname(filePath), { recursive: true });
  const serialized = `${canonicalJson(payload)}\n`;
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, serialized, "utf8");
  await rename(tmp, filePath);
};

const judgePanelAccepted = (
  logic: JudgeVerdict,
  faithfulness: FaithfulnessVerdict | undefined,
): boolean =>
  logic.verdict === "accept" &&
  (faithfulness === undefined || faithfulness.verdict === "accept");

const judgePanelRejected = (
  logic: JudgeVerdict,
  faithfulness: FaithfulnessVerdict | undefined,
): boolean =>
  logic.verdict === "reject" ||
  (faithfulness !== undefined && faithfulness.verdict === "reject");

const resolveMaxRepairIterations = (requested: number | undefined): number => {
  const value = requested ?? REPAIR_LOOP_DEFAULT_MAX_ITERATIONS;
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `runRepairLoop: maxRepairIterations must be a non-negative integer; got ${String(value)}`,
    );
  }
  return Math.min(value, REPAIR_LOOP_MAX_ITERATIONS_HARD_CAP);
};

/**
 * Driver of the bounded repair loop. See module doc-comment for the
 * full state machine.
 */
export const runRepairLoop = async (
  input: RunRepairLoopInput,
): Promise<RepairLoopResult> => {
  if (input.jobId.trim().length === 0) {
    throw new TypeError("runRepairLoop: jobId must be non-empty");
  }
  if (input.runDir.trim().length === 0) {
    throw new TypeError("runRepairLoop: runDir must be non-empty");
  }
  const max = resolveMaxRepairIterations(input.maxRepairIterations);

  const initialIteration: RepairLoopIterationRecord = {
    iteration: 0,
    logicVerdict: input.initialLogicVerdict.verdict,
    faithfulnessVerdict: input.initialFaithfulnessVerdict?.verdict ?? "skipped",
    inputTokens: 0,
    outputTokens: 0,
    generatedCaseCount: input.initialList.testCases.length,
    outputHash: sha256Hex(input.initialList),
    verdictSignature: computeVerdictSignature(input.initialLogicVerdict),
  };
  const iterations: RepairLoopIterationRecord[] = [initialIteration];
  input.onIterationComplete?.(initialIteration);

  // Issue #1928: initial-pass `reject` verdicts no longer short-circuit
  // the loop; recoverable schema violations need the iteration loop to
  // exercise the repair-instruction → regenerate cycle.
  if (
    judgePanelAccepted(
      input.initialLogicVerdict,
      input.initialFaithfulnessVerdict,
    )
  ) {
    return {
      outcome: "accepted",
      finalList: input.initialList,
      finalLogicVerdict: input.initialLogicVerdict,
      ...(input.initialFaithfulnessVerdict !== undefined
        ? { finalFaithfulnessVerdict: input.initialFaithfulnessVerdict }
        : {}),
      iterations,
      repairIterationCount: 0,
      maxRepairIterations: max,
    };
  }

  let currentList = input.initialList;
  let currentLogic = input.initialLogicVerdict;
  let currentFaith: FaithfulnessVerdict | undefined =
    input.initialFaithfulnessVerdict;

  // Issue #2016: track cumulative generator-only spend for the budget
  // guard. The initial pass is booked outside the loop; the caller hands
  // its accounting in via `input.budget.initialGeneratorOutputTokens` /
  // `initialGeneratorAttempts`.
  const guard = input.budget;
  const sanitizeGuardCount = (value: number | undefined): number =>
    Number.isFinite(value) && (value as number) >= 0
      ? Math.floor(value as number)
      : 0;
  let cumulativeGeneratorOutputTokens = sanitizeGuardCount(
    guard?.initialGeneratorOutputTokens,
  );
  let cumulativeGeneratorAttempts = sanitizeGuardCount(
    guard?.initialGeneratorAttempts,
  );
  const expectedNextOutputTokens = ((): number => {
    if (
      guard?.expectedNextOutputTokens !== undefined &&
      Number.isFinite(guard.expectedNextOutputTokens) &&
      guard.expectedNextOutputTokens > 0
    ) {
      return Math.floor(guard.expectedNextOutputTokens);
    }
    if (
      guard?.maxGeneratorOutputTokens !== undefined &&
      Number.isFinite(guard.maxGeneratorOutputTokens) &&
      guard.maxGeneratorOutputTokens > 0
    ) {
      return Math.max(1, Math.floor(guard.maxGeneratorOutputTokens / 2));
    }
    return 4096;
  })();

  const writeBudgetTrace = async (
    stoppedBeforeIteration: number,
    trigger: RepairLoopBudgetTraceArtifact["trigger"],
  ): Promise<void> => {
    if (guard === undefined) return;
    const trace: RepairLoopBudgetTraceArtifact = {
      schemaVersion: REPAIR_LOOP_SCHEMA_VERSION,
      jobId: input.jobId,
      outcome: "budget_exhausted",
      stoppedBeforeIteration,
      trigger,
      cumulativeGeneratorOutputTokens,
      cumulativeGeneratorAttempts,
      ...(guard.maxGeneratorOutputTokens !== undefined
        ? { maxGeneratorOutputTokens: guard.maxGeneratorOutputTokens }
        : {}),
      ...(guard.maxGeneratorAttempts !== undefined
        ? { maxGeneratorAttempts: guard.maxGeneratorAttempts }
        : {}),
      expectedNextOutputTokens,
    };
    await writeAtomicJson(
      join(input.runDir, REPAIR_LOOP_BUDGET_TRACE_ARTIFACT_FILENAME),
      trace,
    );
  };

  /**
   * Returns the trigger reason if starting another regeneration would
   * push the cumulative generator spend past the configured guard, else
   * `undefined`. The check is *projective* — it uses the guard's
   * `expectedNextOutputTokens` as a worst-case estimate so the loop
   * never books an attempt that turns into a FinOps breach.
   */
  const projectedBudgetTrigger = ():
    | RepairLoopBudgetTraceArtifact["trigger"]
    | undefined => {
    if (guard === undefined) return undefined;
    if (guard.maxGeneratorAttempts !== undefined) {
      const projectedAttempts = cumulativeGeneratorAttempts + 1;
      if (projectedAttempts > guard.maxGeneratorAttempts) {
        return "max_generator_attempts";
      }
    }
    if (guard.maxGeneratorOutputTokens !== undefined) {
      const projectedOutput =
        cumulativeGeneratorOutputTokens + expectedNextOutputTokens;
      if (projectedOutput > guard.maxGeneratorOutputTokens) {
        return "max_generator_output_tokens";
      }
    }
    return undefined;
  };

  const buildBudgetExhaustedResult = (): RepairLoopResult => ({
    outcome: "budget_exhausted",
    finalList: currentList,
    finalLogicVerdict: currentLogic,
    ...(currentFaith !== undefined
      ? { finalFaithfulnessVerdict: currentFaith }
      : {}),
    iterations,
    repairIterationCount: iterations.length - 1,
    maxRepairIterations: max,
  });

  const softFailIfEnabled = (
    iteration: number,
    error: unknown,
    context: string,
  ): RepairLoopResult => {
    if (input.softFailOnIterationError !== true) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`${context}: ${String(error)}`);
    }

    return {
      outcome: "needs_review",
      finalList: currentList,
      finalLogicVerdict: currentLogic,
      ...(currentFaith !== undefined
        ? { finalFaithfulnessVerdict: currentFaith }
        : {}),
      iterations,
      repairIterationCount: Math.max(iteration - 1, 0),
      maxRepairIterations: max,
    };
  };

  for (let k = 1; k <= max; k++) {
    // Issue #2016: refuse to start the next regeneration when the
    // generator-side budget guard projects a breach. The check happens
    // before any planner / generator artifact is written so a stopped
    // run leaves no spurious iteration trace on disk.
    const trigger = projectedBudgetTrigger();
    if (trigger !== undefined) {
      await writeBudgetTrace(k, trigger);
      return buildBudgetExhaustedResult();
    }

    const repairPlan = consolidateRepairInstructions({
      logic: currentLogic,
      ...(currentFaith !== undefined ? { faithfulness: currentFaith } : {}),
    });
    const repairInstructions = repairPlan.repairInstructions;

    const previousListHash = sha256Hex(currentList);
    const plannerArtifact: RepairPlannerIterationArtifact = {
      schemaVersion: REPAIR_LOOP_SCHEMA_VERSION,
      jobId: input.jobId,
      iteration: k,
      source: "deterministic_consolidator",
      inputs: {
        logicVerdictHash: sha256Hex(currentLogic),
        ...(currentFaith !== undefined
          ? { faithfulnessVerdictHash: sha256Hex(currentFaith) }
          : {}),
        previousListHash,
      },
      outputs: {
        repairInstructions,
        repairInstructionCount: repairInstructions.length,
        truncatedInstructionCount: repairPlan.truncatedInstructionCount,
      },
    };
    await writeAtomicJson(
      join(
        input.runDir,
        "agent-role-runs",
        `${REPAIR_PLANNER_ARTIFACT_PREFIX}${k}.json`,
      ),
      plannerArtifact,
    );

    let regen: Awaited<ReturnType<RepairLoopRegenerator>>;
    try {
      regen = await input.regenerate({
        previousList: currentList,
        repairInstructions,
        truncatedInstructionCount: repairPlan.truncatedInstructionCount,
        iteration: k,
      });
    } catch (error) {
      return softFailIfEnabled(k, error, `regenerate iteration ${k}`);
    }
    cumulativeGeneratorOutputTokens += sanitizeGuardCount(regen.outputTokens);
    cumulativeGeneratorAttempts += 1;

    const newListHash = sha256Hex(regen.list);
    const generatorArtifact: TestGenerationRepairIterationArtifact = {
      schemaVersion: REPAIR_LOOP_SCHEMA_VERSION,
      jobId: input.jobId,
      iteration: k,
      inputs: {
        previousListHash,
        repairInstructionsHash: sha256Hex(repairInstructions),
        repairInstructionCount: repairInstructions.length,
        truncatedInstructionCount: repairPlan.truncatedInstructionCount,
      },
      outputs: {
        listHash: newListHash,
        testCaseCount: regen.list.testCases.length,
      },
      llmGateway: {
        outcome: regen.llmResult.outcome,
        ...(regen.llmResult.outcome === "error"
          ? { errorClass: regen.llmResult.errorClass }
          : {}),
        inputTokens: regen.inputTokens,
        outputTokens: regen.outputTokens,
        durationMs: regen.llmDurationMs,
        modelDeployment:
          regen.llmResult.outcome === "success"
            ? regen.llmResult.modelDeployment
            : "unknown",
      },
      hashes: regen.hashes,
    };
    await writeAtomicJson(
      join(
        input.runDir,
        "agent-role-runs",
        `${TEST_GENERATION_REPAIR_ARTIFACT_PREFIX}${k}.json`,
      ),
      generatorArtifact,
    );

    currentList = regen.list;

    let logicResult: Awaited<ReturnType<RepairLoopLogicJudgeRunner>>;
    try {
      logicResult = await input.runLogicJudge({
        list: currentList,
        iteration: k,
      });
    } catch (error) {
      return softFailIfEnabled(k, error, `logic judge iteration ${k}`);
    }
    currentLogic = logicResult.verdict;

    let faithInputTokens = 0;
    let faithOutputTokens = 0;
    if (
      input.runFaithfulnessJudge !== undefined &&
      currentLogic.verdict === "accept"
    ) {
      let faithResult: Awaited<ReturnType<RepairLoopFaithfulnessJudgeRunner>>;
      try {
        faithResult = await input.runFaithfulnessJudge({
          list: currentList,
          iteration: k,
        });
      } catch (error) {
        return softFailIfEnabled(k, error, `faithfulness judge iteration ${k}`);
      }
      currentFaith = faithResult.verdict;
      faithInputTokens = faithResult.inputTokens;
      faithOutputTokens = faithResult.outputTokens;
    } else if (input.runFaithfulnessJudge === undefined) {
      currentFaith = undefined;
    } else {
      currentFaith = undefined;
    }

    const iterationSignature = computeVerdictSignature(currentLogic);
    const iterationRecord: RepairLoopIterationRecord = {
      iteration: k,
      logicVerdict: currentLogic.verdict,
      faithfulnessVerdict: currentFaith?.verdict ?? "skipped",
      inputTokens:
        regen.inputTokens + logicResult.inputTokens + faithInputTokens,
      outputTokens:
        regen.outputTokens + logicResult.outputTokens + faithOutputTokens,
      generatedCaseCount: currentList.testCases.length,
      outputHash: newListHash,
      verdictSignature: iterationSignature,
    };
    iterations.push(iterationRecord);
    input.onIterationComplete?.(iterationRecord);

    // Terminal-verdict checks win over convergence detection: an
    // accept/reject from the panel is unambiguous regardless of whether
    // the signature happens to be stable across iterations.
    if (judgePanelAccepted(currentLogic, currentFaith)) {
      return {
        outcome: "accepted",
        finalList: currentList,
        finalLogicVerdict: currentLogic,
        ...(currentFaith !== undefined
          ? { finalFaithfulnessVerdict: currentFaith }
          : {}),
        iterations,
        repairIterationCount: k,
        maxRepairIterations: max,
      };
    }
    if (judgePanelRejected(currentLogic, currentFaith)) {
      return {
        outcome: "rejected",
        finalList: currentList,
        finalLogicVerdict: currentLogic,
        ...(currentFaith !== undefined
          ? { finalFaithfulnessVerdict: currentFaith }
          : {}),
        iterations,
        repairIterationCount: k,
        maxRepairIterations: max,
      };
    }

    // Issue #1939 + Issue #2016: convergence detection. When two
    // consecutive iterations produce the same verdict signature the LLM
    // is reproducing the same class of finding and additional iterations
    // only burn tokens.
    //
    // Issue #1939 originally required the comparison window to live
    // entirely inside the repair phase (stall fires earliest at k=2,
    // comparing iter[2] to iter[1]) on the rationale that the LLM
    // deserved one honest chance to incorporate repair instructions
    // before being declared stalled.
    //
    // Issue #2016 sharpens this: when iter[1] arrives with a verdict
    // signature byte-identical to iter[0], the first regeneration
    // already had access to the consolidated repair instructions and
    // failed to change *any* finding code. Continuing into iter[2]
    // costs a full additional generator response (~one
    // `maxOutputTokensPerRequest` worth) for no expected progress. The
    // updated detector therefore fires at k=1 as well, comparing
    // iter[1] to iter[0], so a no-progress repair stops the loop one
    // iteration sooner.
    const previousIteration = iterations[iterations.length - 2];
    if (
      k >= 1 &&
      previousIteration !== undefined &&
      previousIteration.verdictSignature === iterationSignature
    ) {
      const trace: RepairLoopTraceArtifact = {
        schemaVersion: REPAIR_LOOP_SCHEMA_VERSION,
        jobId: input.jobId,
        outcome: "convergence_stalled",
        stallDetectedAtIteration: k,
        stallSignature: iterationSignature,
        iterations: iterations.map((entry) => ({
          iteration: entry.iteration,
          logicVerdict: entry.logicVerdict,
          faithfulnessVerdict: entry.faithfulnessVerdict,
          verdictSignature: entry.verdictSignature,
        })),
      };
      await writeAtomicJson(
        join(input.runDir, REPAIR_LOOP_TRACE_ARTIFACT_FILENAME),
        trace,
      );
      return {
        outcome: "convergence_stalled",
        finalList: currentList,
        finalLogicVerdict: currentLogic,
        ...(currentFaith !== undefined
          ? { finalFaithfulnessVerdict: currentFaith }
          : {}),
        iterations,
        repairIterationCount: k,
        maxRepairIterations: max,
      };
    }
  }

  return {
    outcome: "needs_review",
    finalList: currentList,
    finalLogicVerdict: currentLogic,
    ...(currentFaith !== undefined
      ? { finalFaithfulnessVerdict: currentFaith }
      : {}),
    iterations,
    repairIterationCount: max,
    maxRepairIterations: max,
  };
};
