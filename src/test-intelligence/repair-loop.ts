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

/** Schema version of the repair-loop per-iteration artifacts. */
export const REPAIR_LOOP_SCHEMA_VERSION = "1.0.0" as const;

/** Default cap on repair iterations after the initial pass. */
export const REPAIR_LOOP_DEFAULT_MAX_ITERATIONS = 3 as const;

/** Hard upper bound on repair iterations regardless of caller request. */
export const REPAIR_LOOP_MAX_ITERATIONS_HARD_CAP = 5 as const;

/** Filename prefix for the repair planner per-iteration artifact. */
export const REPAIR_PLANNER_ARTIFACT_PREFIX =
  "repair_planner_iter_" as const;

/** Filename prefix for the test_generation repair per-iteration artifact. */
export const TEST_GENERATION_REPAIR_ARTIFACT_PREFIX =
  "test_generation_repair_iter_" as const;

/** Maximum length of a single RepairInstruction.instruction field. Mirrors logic-judge contract. */
const MAX_INSTRUCTION_LENGTH = 240 as const;

/** Maximum length of a single RepairInstruction.path field. Mirrors logic-judge contract. */
const MAX_PATH_LENGTH = 160 as const;

/** Terminal outcomes of the repair loop. */
export type RepairLoopOutcome = "accepted" | "rejected" | "needs_review";

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
  /** Notification fired once per iteration record (including iteration 0). */
  readonly onIterationComplete?: (record: RepairLoopIterationRecord) => void;
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
  };
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

const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;

const compareInstruction = (
  left: RepairInstruction,
  right: RepairInstruction,
): number =>
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
}): readonly RepairInstruction[] => {
  const collected: RepairInstruction[] = [];
  for (const ri of input.logic.repairInstructions) {
    collected.push({
      testCaseId: ri.testCaseId,
      path: truncate(ri.path, MAX_PATH_LENGTH),
      instruction: truncate(ri.instruction, MAX_INSTRUCTION_LENGTH),
    });
  }
  if (input.faithfulness !== undefined) {
    for (const hallucination of input.faithfulness.hallucinations) {
      const path =
        hallucination.stepIndex !== undefined
          ? `steps[${hallucination.stepIndex}]`
          : "$case";
      collected.push({
        testCaseId: hallucination.testCaseId,
        path: truncate(path, MAX_PATH_LENGTH),
        instruction: truncate(
          `Faithfulness hallucination: ${hallucination.message}`,
          MAX_INSTRUCTION_LENGTH,
        ),
      });
    }
    for (const mismatch of input.faithfulness.mismatches) {
      const path =
        mismatch.stepIndex !== undefined
          ? `steps[${mismatch.stepIndex}].expected`
          : "expectedResults";
      collected.push({
        testCaseId: mismatch.testCaseId,
        path: truncate(path, MAX_PATH_LENGTH),
        instruction: truncate(
          `Faithfulness mismatch (expected="${mismatch.expectedLabel}", visible="${mismatch.visibleLabel}"): ${mismatch.message}`,
          MAX_INSTRUCTION_LENGTH,
        ),
      });
    }
  }
  const dedup = new Map<string, RepairInstruction>();
  for (const entry of collected) {
    const key = `${entry.testCaseId}\0${entry.path}\0${entry.instruction}`;
    if (!dedup.has(key)) {
      dedup.set(key, entry);
    }
  }
  return [...dedup.values()].sort(compareInstruction);
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

const resolveMaxRepairIterations = (
  requested: number | undefined,
): number => {
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
    faithfulnessVerdict:
      input.initialFaithfulnessVerdict?.verdict ?? "skipped",
    inputTokens: 0,
    outputTokens: 0,
    generatedCaseCount: input.initialList.testCases.length,
    outputHash: sha256Hex(input.initialList),
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

  for (let k = 1; k <= max; k++) {
    const repairInstructions = consolidateRepairInstructions({
      logic: currentLogic,
      ...(currentFaith !== undefined ? { faithfulness: currentFaith } : {}),
    });

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

    const regen = await input.regenerate({
      previousList: currentList,
      repairInstructions,
      iteration: k,
    });

    const newListHash = sha256Hex(regen.list);
    const generatorArtifact: TestGenerationRepairIterationArtifact = {
      schemaVersion: REPAIR_LOOP_SCHEMA_VERSION,
      jobId: input.jobId,
      iteration: k,
      inputs: {
        previousListHash,
        repairInstructionsHash: sha256Hex(repairInstructions),
        repairInstructionCount: repairInstructions.length,
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

    const logicResult = await input.runLogicJudge({
      list: currentList,
      iteration: k,
    });
    currentLogic = logicResult.verdict;

    let faithInputTokens = 0;
    let faithOutputTokens = 0;
    if (
      input.runFaithfulnessJudge !== undefined &&
      currentLogic.verdict === "accept"
    ) {
      const faithResult = await input.runFaithfulnessJudge({
        list: currentList,
        iteration: k,
      });
      currentFaith = faithResult.verdict;
      faithInputTokens = faithResult.inputTokens;
      faithOutputTokens = faithResult.outputTokens;
    } else if (input.runFaithfulnessJudge === undefined) {
      currentFaith = undefined;
    } else {
      currentFaith = undefined;
    }

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
    };
    iterations.push(iterationRecord);
    input.onIterationComplete?.(iterationRecord);

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
