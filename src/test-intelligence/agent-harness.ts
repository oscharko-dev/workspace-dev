/**
 * Multi-agent harness state machine (Issue #1780, Story MA-3 #1758).
 *
 * Bounded-iteration state machine that drives a single agent role step
 * to one of five terminal `AgentHarnessOutcome` values. The outcomes
 * are an INTERNAL field — they map onto the existing
 * {@link WorkspaceJobRuntimeStatus} vocabulary so no second global
 * runtime status surface is introduced. Issue #1780's acceptance
 * criteria are enforced here:
 *
 *   - `accepted`         → job runtime status `completed`
 *   - `needs_review`     → job runtime status `partial`
 *   - `blocked`          → job runtime status `partial`
 *   - `failed_retryable` → job runtime status `failed`
 *   - `failed_permanent` → job runtime status `failed`
 *
 * Iteration budgeting:
 *
 *   - Default: 2 repair iterations after the initial attempt
 *     (3 total attempts at most).
 *   - `testDepth = "exhaustive"`: 3 repair iterations
 *     (4 total attempts at most).
 *   - The effective attempt cap is also bounded by the static
 *     {@link AgentRoleProfile.maxAttempts} budget for the role; the
 *     final cap is `min(profile.maxAttempts, repairBudget + 1)`.
 *
 * Persistence: each step writes a per-step artifact at
 * `<runDir>/agent-role-runs/<roleStepId>.json` containing only hashes,
 * the terminal outcome, the mapped job status, the error class, and a
 * cost rollup. Per-attempt prompt-run records produced by
 * {@link writeAgentRoleRunArtifact} use `<roleRunId>.json` and live as
 * siblings; the harness assigns `roleRunId` values that differ from
 * `roleStepId` (`<roleStepId>-a<attempt>`) so the namespaces never
 * collide. No raw prompts, no chain-of-thought, no secrets are ever
 * persisted — the artifact is a hash-only metadata anchor.
 *
 * Acceptance criterion enforcement:
 *
 *   - Max-iterations exhaustion produces `needs_review`, never
 *     `accepted` / "completed". This is asserted directly in the
 *     decision tree at the bottom of the run loop and is covered by
 *     `agent-harness.test.ts`.
 */

import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  AGENT_HARNESS_ROLES,
  AGENT_ROLE_RUN_ARTIFACT_DIRECTORY,
  type AgentHarnessRole,
  type AgentRoleProfile,
  type WorkspaceJobRuntimeStatus,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import { getAgentRoleProfile } from "./agent-role-profile.js";

// ---------------------------------------------------------------------------
// Outcome vocabulary
// ---------------------------------------------------------------------------

/**
 * Closed list of terminal outcomes the harness may return.
 *
 * Order is alphabetical so that the canonical-JSON serialisation of any
 * structure embedding this constant is byte-stable.
 */
export const AGENT_HARNESS_OUTCOMES = [
  "accepted",
  "blocked",
  "failed_permanent",
  "failed_retryable",
  "needs_review",
] as const;

/** Terminal outcome of one harness step. */
export type AgentHarnessOutcome = (typeof AGENT_HARNESS_OUTCOMES)[number];

/** Job runtime statuses producible by mapping an `AgentHarnessOutcome`. */
export type AgentHarnessMappedJobStatus = Extract<
  WorkspaceJobRuntimeStatus,
  "completed" | "partial" | "failed"
>;

/** Frozen mapping from harness outcome to job runtime status. */
export const AGENT_HARNESS_OUTCOME_TO_JOB_STATUS: Readonly<
  Record<AgentHarnessOutcome, AgentHarnessMappedJobStatus>
> = Object.freeze({
  accepted: "completed",
  blocked: "partial",
  failed_permanent: "failed",
  failed_retryable: "failed",
  needs_review: "partial",
});

/** Map an `AgentHarnessOutcome` onto the existing job runtime status set. */
export const mapAgentHarnessOutcomeToJobStatus = (
  outcome: AgentHarnessOutcome,
): AgentHarnessMappedJobStatus => AGENT_HARNESS_OUTCOME_TO_JOB_STATUS[outcome];

/** Type guard for `AgentHarnessOutcome`. */
export const isAgentHarnessOutcome = (
  value: unknown,
): value is AgentHarnessOutcome =>
  typeof value === "string" &&
  (AGENT_HARNESS_OUTCOMES as readonly string[]).includes(value);

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Closed taxonomy of error classes the harness records on each attempt
 * and on the per-step rollup. Order is alphabetical for canonical JSON.
 */
export const AGENT_HARNESS_ERROR_CLASSES = [
  "budget_exhausted",
  "gateway_error",
  "internal_error",
  "iteration_exhausted",
  "judge_rejection",
  "none",
  "policy_refusal",
  "schema_validation",
  "timeout",
] as const;

export type AgentHarnessErrorClass =
  (typeof AGENT_HARNESS_ERROR_CLASSES)[number];

/** Type guard for `AgentHarnessErrorClass`. */
export const isAgentHarnessErrorClass = (
  value: unknown,
): value is AgentHarnessErrorClass =>
  typeof value === "string" &&
  (AGENT_HARNESS_ERROR_CLASSES as readonly string[]).includes(value);

// ---------------------------------------------------------------------------
// Iteration budgeting
// ---------------------------------------------------------------------------

/** Test depth tags consumed by the harness for iteration budgeting. */
export type AgentHarnessTestDepth = "standard" | "exhaustive";

/** Default number of repair iterations on top of the initial attempt. */
export const DEFAULT_REPAIR_ITERATIONS = 2 as const;

/** Repair iterations granted when `testDepth === "exhaustive"`. */
export const EXHAUSTIVE_REPAIR_ITERATIONS = 3 as const;

/**
 * Resolve how many *repair* iterations the harness may run after the
 * initial attempt. Total attempt cap is `1 + repairIterations`.
 */
export const resolveMaxRepairIterations = (
  testDepth: AgentHarnessTestDepth,
): typeof DEFAULT_REPAIR_ITERATIONS | typeof EXHAUSTIVE_REPAIR_ITERATIONS =>
  testDepth === "exhaustive"
    ? EXHAUSTIVE_REPAIR_ITERATIONS
    : DEFAULT_REPAIR_ITERATIONS;

// ---------------------------------------------------------------------------
// Step artifact schema (internal — lives entirely under test-intelligence)
// ---------------------------------------------------------------------------

/** Schema version for {@link AgentHarnessStepArtifact}. */
export const AGENT_HARNESS_STEP_SCHEMA_VERSION = "1.0.0" as const;

/** Per-attempt slice persisted inside the per-step artifact. */
export interface AgentHarnessStepAttemptRecord {
  readonly attempt: number;
  readonly roleRunId: string;
  readonly inputHash: string;
  readonly promptHash: string;
  readonly schemaHash: string;
  readonly cacheKeyDigest: string;
  readonly cacheablePrefixHash: string;
  readonly judgeAccepted: boolean;
  readonly errorClass: AgentHarnessErrorClass;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
}

/** Cost rollup across attempts. */
export interface AgentHarnessStepCostRollup {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalLatencyMs: number;
}

/** Persisted per-step harness rollup artifact. */
export interface AgentHarnessStepArtifact {
  readonly schemaVersion: typeof AGENT_HARNESS_STEP_SCHEMA_VERSION;
  readonly jobId: string;
  readonly roleStepId: string;
  readonly role: AgentHarnessRole;
  readonly outcome: AgentHarnessOutcome;
  readonly errorClass: AgentHarnessErrorClass;
  readonly mappedJobStatus: AgentHarnessMappedJobStatus;
  readonly testDepth: AgentHarnessTestDepth;
  readonly maxAttemptsAllowed: number;
  readonly attemptsConsumed: number;
  readonly attempts: readonly AgentHarnessStepAttemptRecord[];
  readonly costsRollup: AgentHarnessStepCostRollup;
  readonly rawPromptsIncluded: false;
}

// ---------------------------------------------------------------------------
// Attempt callback contract
// ---------------------------------------------------------------------------

/**
 * Caller-provided result of one attempt. Crucially the harness only
 * sees hashes + lightweight error metadata — never raw prompts, never
 * chain-of-thought, never secrets. The attempt callback is responsible
 * for redacting before it returns.
 */
export interface AgentHarnessAttemptResult {
  readonly inputHash: string;
  readonly promptHash: string;
  readonly schemaHash: string;
  readonly cacheKeyDigest: string;
  readonly cacheablePrefixHash: string;
  /** True when the judge panel accepted this attempt's output. */
  readonly judgeAccepted: boolean;
  /**
   * Error kind classification:
   *
   *   - `none`        — judge ran cleanly (may have rejected).
   *   - `retryable`   — transient error (gateway 5xx, timeout). The
   *     harness will run another iteration if budget remains; if the
   *     budget is exhausted with retryable errors but no judge
   *     rejections, the outcome is `failed_retryable`.
   *   - `permanent`   — structural error (schema invalid, contract
   *     violation). Terminal: outcome `failed_permanent`.
   *   - `policy_block` — policy or guard refused. Terminal: outcome
   *     `blocked`.
   */
  readonly errorKind: "none" | "retryable" | "permanent" | "policy_block";
  /** Optional explicit error class. Defaulted from `errorKind` when omitted. */
  readonly errorClass?: AgentHarnessErrorClass;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly latencyMs?: number;
}

/** Attempt callback signature. */
export type AgentHarnessAttemptFn = (input: {
  readonly attempt: number;
  readonly roleRunId: string;
}) => Promise<AgentHarnessAttemptResult>;

// ---------------------------------------------------------------------------
// runAgentHarnessStep
// ---------------------------------------------------------------------------

export interface RunAgentHarnessStepInput {
  readonly runDir: string;
  readonly jobId: string;
  readonly role: AgentHarnessRole;
  readonly roleStepId: string;
  readonly testDepth?: AgentHarnessTestDepth;
  readonly profile?: AgentRoleProfile;
  readonly executeAttempt: AgentHarnessAttemptFn;
}

export interface RunAgentHarnessStepResult {
  readonly outcome: AgentHarnessOutcome;
  readonly mappedJobStatus: AgentHarnessMappedJobStatus;
  readonly artifact: AgentHarnessStepArtifact;
  readonly artifactPath: string;
}

const HEX_64 = /^[0-9a-f]{64}$/u;

const validateAttemptHashes = (
  result: AgentHarnessAttemptResult,
  attempt: number,
): void => {
  for (const [name, value] of [
    ["inputHash", result.inputHash],
    ["promptHash", result.promptHash],
    ["schemaHash", result.schemaHash],
    ["cacheKeyDigest", result.cacheKeyDigest],
    ["cacheablePrefixHash", result.cacheablePrefixHash],
  ] as const) {
    if (typeof value !== "string" || !HEX_64.test(value)) {
      throw new TypeError(
        `runAgentHarnessStep: attempt ${attempt} ${name} must be a 64-char lowercase hex digest`,
      );
    }
  }
};

const defaultErrorClassFor = (
  errorKind: AgentHarnessAttemptResult["errorKind"],
  judgeAccepted: boolean,
): AgentHarnessErrorClass => {
  switch (errorKind) {
    case "none":
      return judgeAccepted ? "none" : "judge_rejection";
    case "retryable":
      return "gateway_error";
    case "permanent":
      return "schema_validation";
    case "policy_block":
      return "policy_refusal";
  }
};

/**
 * Run one agent harness step. The state machine drives the
 * `executeAttempt` callback up to its budget cap, classifies the
 * terminal outcome, persists a per-step artifact, and returns the
 * outcome plus its mapped job runtime status.
 */
export const runAgentHarnessStep = async (
  input: RunAgentHarnessStepInput,
): Promise<RunAgentHarnessStepResult> => {
  if (input.runDir.trim().length === 0) {
    throw new TypeError("runAgentHarnessStep: runDir must be non-empty");
  }
  if (input.jobId.trim().length === 0) {
    throw new TypeError("runAgentHarnessStep: jobId must be non-empty");
  }
  if (input.roleStepId.trim().length === 0) {
    throw new TypeError("runAgentHarnessStep: roleStepId must be non-empty");
  }
  if (!(AGENT_HARNESS_ROLES as readonly string[]).includes(input.role)) {
    throw new RangeError(
      `runAgentHarnessStep: unknown role "${input.role as string}"`,
    );
  }
  if (typeof input.executeAttempt !== "function") {
    throw new TypeError(
      "runAgentHarnessStep: executeAttempt must be a function",
    );
  }

  const profile = input.profile ?? getAgentRoleProfile(input.role);
  if (profile.role !== input.role) {
    throw new RangeError(
      `runAgentHarnessStep: profile.role "${profile.role}" does not match input.role "${input.role}"`,
    );
  }
  const testDepth: AgentHarnessTestDepth = input.testDepth ?? "standard";
  const repairBudget = resolveMaxRepairIterations(testDepth);
  const maxAttemptsAllowed = Math.min(profile.maxAttempts, 1 + repairBudget);

  const attempts: AgentHarnessStepAttemptRecord[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalLatencyMs = 0;

  let outcome: AgentHarnessOutcome | null = null;
  let outcomeErrorClass: AgentHarnessErrorClass | null = null;
  let lastRetryableError: AgentHarnessErrorClass | null = null;
  let sawJudgeRejection = false;

  for (let attempt = 1; attempt <= maxAttemptsAllowed; attempt++) {
    const roleRunId = `${input.roleStepId}-a${attempt}`;
    const result = await input.executeAttempt({ attempt, roleRunId });
    validateAttemptHashes(result, attempt);

    const errorClass: AgentHarnessErrorClass =
      result.errorClass !== undefined && isAgentHarnessErrorClass(result.errorClass)
        ? result.errorClass
        : defaultErrorClassFor(result.errorKind, result.judgeAccepted);

    const inputTokens = Math.max(0, Math.trunc(result.inputTokens ?? 0));
    const outputTokens = Math.max(0, Math.trunc(result.outputTokens ?? 0));
    const latencyMs = Math.max(0, Math.trunc(result.latencyMs ?? 0));
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    totalLatencyMs += latencyMs;

    attempts.push({
      attempt,
      roleRunId,
      inputHash: result.inputHash,
      promptHash: result.promptHash,
      schemaHash: result.schemaHash,
      cacheKeyDigest: result.cacheKeyDigest,
      cacheablePrefixHash: result.cacheablePrefixHash,
      judgeAccepted: result.judgeAccepted,
      errorClass,
      inputTokens,
      outputTokens,
      latencyMs,
    });

    if (result.judgeAccepted && result.errorKind === "none") {
      outcome = "accepted";
      outcomeErrorClass = "none";
      break;
    }
    if (result.errorKind === "policy_block") {
      outcome = "blocked";
      outcomeErrorClass = errorClass;
      break;
    }
    if (result.errorKind === "permanent") {
      outcome = "failed_permanent";
      outcomeErrorClass = errorClass;
      break;
    }
    if (result.errorKind === "retryable") {
      lastRetryableError = errorClass;
      continue;
    }
    sawJudgeRejection = true;
  }

  if (outcome === null) {
    if (lastRetryableError !== null && !sawJudgeRejection) {
      outcome = "failed_retryable";
      outcomeErrorClass = lastRetryableError;
    } else {
      outcome = "needs_review";
      outcomeErrorClass = "iteration_exhausted";
    }
  }

  const artifact: AgentHarnessStepArtifact = {
    schemaVersion: AGENT_HARNESS_STEP_SCHEMA_VERSION,
    jobId: input.jobId,
    roleStepId: input.roleStepId,
    role: input.role,
    outcome,
    errorClass: outcomeErrorClass ?? "none",
    mappedJobStatus: mapAgentHarnessOutcomeToJobStatus(outcome),
    testDepth,
    maxAttemptsAllowed,
    attemptsConsumed: attempts.length,
    attempts,
    costsRollup: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalLatencyMs,
    },
    rawPromptsIncluded: false,
  };

  const artifactPath = await persistStepArtifact(input.runDir, artifact);

  return {
    outcome,
    mappedJobStatus: artifact.mappedJobStatus,
    artifact,
    artifactPath,
  };
};

const persistStepArtifact = async (
  runDir: string,
  artifact: AgentHarnessStepArtifact,
): Promise<string> => {
  const dir = join(runDir, AGENT_ROLE_RUN_ARTIFACT_DIRECTORY);
  const finalPath = join(dir, `${artifact.roleStepId}.json`);
  const tmpPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dir, { recursive: true });
  const serialized = `${canonicalJson(artifact)}\n`;
  await writeFile(tmpPath, serialized, "utf8");
  await rename(tmpPath, finalPath);
  return finalPath;
};
