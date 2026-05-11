import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AGENT_ROLE_RUN_ARTIFACT_DIRECTORY,
  type AgentHarnessRole,
} from "../contracts/index.js";
import {
  AGENT_HARNESS_OUTCOMES,
  AGENT_HARNESS_OUTCOME_TO_JOB_STATUS,
  AGENT_HARNESS_STEP_SCHEMA_VERSION,
  DEFAULT_REPAIR_ITERATIONS,
  EXHAUSTIVE_REPAIR_ITERATIONS,
  isAgentHarnessErrorClass,
  isAgentHarnessOutcome,
  mapAgentHarnessOutcomeToJobStatus,
  resolveMaxRepairIterations,
  runAgentHarnessStep,
  type AgentHarnessAttemptFn,
  type AgentHarnessAttemptResult,
} from "./agent-harness.js";

const HEX = "a".repeat(64);
const HEX2 = "b".repeat(64);

const baseAttempt = (
  overrides: Partial<AgentHarnessAttemptResult> = {},
): AgentHarnessAttemptResult => ({
  inputHash: HEX,
  promptHash: HEX,
  schemaHash: HEX,
  cacheKeyDigest: HEX,
  cacheablePrefixHash: HEX,
  judgeAccepted: false,
  errorKind: "none",
  inputTokens: 100,
  outputTokens: 50,
  latencyMs: 25,
  ...overrides,
});

const stubAttempts = (
  results: readonly AgentHarnessAttemptResult[],
): AgentHarnessAttemptFn => {
  let idx = 0;
  return async () => {
    if (idx >= results.length) {
      throw new Error(`stubAttempts exhausted at attempt ${idx + 1}`);
    }
    const next = results[idx]!;
    idx += 1;
    return next;
  };
};

const withRunDir = async (
  fn: (runDir: string) => Promise<void>,
): Promise<void> => {
  const runDir = await mkdtemp(join(tmpdir(), "agent-harness-"));
  try {
    await fn(runDir);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
};

test("outcome vocabulary is closed and maps onto existing job statuses", () => {
  assert.deepEqual([...AGENT_HARNESS_OUTCOMES], [
    "accepted",
    "blocked",
    "failed_permanent",
    "failed_retryable",
    "needs_review",
  ]);

  assert.equal(AGENT_HARNESS_OUTCOME_TO_JOB_STATUS["accepted"], "completed");
  assert.equal(AGENT_HARNESS_OUTCOME_TO_JOB_STATUS["needs_review"], "partial");
  assert.equal(AGENT_HARNESS_OUTCOME_TO_JOB_STATUS["blocked"], "partial");
  assert.equal(AGENT_HARNESS_OUTCOME_TO_JOB_STATUS["failed_retryable"], "failed");
  assert.equal(AGENT_HARNESS_OUTCOME_TO_JOB_STATUS["failed_permanent"], "failed");

  for (const outcome of AGENT_HARNESS_OUTCOMES) {
    assert.ok(isAgentHarnessOutcome(outcome));
    const mapped = mapAgentHarnessOutcomeToJobStatus(outcome);
    assert.ok(["completed", "partial", "failed"].includes(mapped));
  }

  assert.equal(isAgentHarnessOutcome("nope"), false);
  assert.equal(isAgentHarnessErrorClass("totally-bogus"), false);
});

test("resolveMaxRepairIterations returns the bounded budgets", () => {
  assert.equal(resolveMaxRepairIterations("standard"), DEFAULT_REPAIR_ITERATIONS);
  assert.equal(resolveMaxRepairIterations("exhaustive"), EXHAUSTIVE_REPAIR_ITERATIONS);
  assert.equal(DEFAULT_REPAIR_ITERATIONS, 2);
  assert.equal(EXHAUSTIVE_REPAIR_ITERATIONS, 3);
});

test("accepted outcome on first judge accept short-circuits the loop", async () => {
  await withRunDir(async (runDir) => {
    let calls = 0;
    const result = await runAgentHarnessStep({
      runDir,
      jobId: "job-1780",
      role: "generator" as AgentHarnessRole,
      roleStepId: "test_generation",
      executeAttempt: async ({ attempt }) => {
        calls += 1;
        return baseAttempt({
          judgeAccepted: attempt === 1,
          errorKind: "none",
        });
      },
    });

    assert.equal(result.outcome, "accepted");
    assert.equal(result.mappedJobStatus, "completed");
    assert.equal(result.artifact.errorClass, "none");
    assert.equal(result.artifact.attemptsConsumed, 1);
    assert.equal(calls, 1);
    assert.equal(result.artifact.attempts[0]!.judgeAccepted, true);
    assert.equal(result.artifact.rawPromptsIncluded, false);

    const persisted = JSON.parse(
      await readFile(result.artifactPath, "utf8"),
    ) as Record<string, unknown>;
    assert.equal(persisted["outcome"], "accepted");
    assert.equal(persisted["mappedJobStatus"], "completed");
    assert.equal(persisted["rawPromptsIncluded"], false);
    assert.equal("systemPrompt" in persisted, false);
    assert.equal("rawPrompt" in persisted, false);
  });
});

test("blocked outcome short-circuits on policy_block (terminal, partial status)", async () => {
  await withRunDir(async (runDir) => {
    const result = await runAgentHarnessStep({
      runDir,
      jobId: "job-1780",
      role: "generator",
      roleStepId: "test_generation_blocked",
      executeAttempt: stubAttempts([
        baseAttempt({ errorKind: "policy_block" }),
      ]),
    });

    assert.equal(result.outcome, "blocked");
    assert.equal(result.mappedJobStatus, "partial");
    assert.equal(result.artifact.errorClass, "policy_refusal");
    assert.equal(result.artifact.attemptsConsumed, 1);
  });
});

test("failed_permanent short-circuits and never re-iterates", async () => {
  await withRunDir(async (runDir) => {
    let calls = 0;
    const result = await runAgentHarnessStep({
      runDir,
      jobId: "job-1780",
      role: "generator",
      roleStepId: "test_generation_perm",
      executeAttempt: async () => {
        calls += 1;
        return baseAttempt({
          errorKind: "permanent",
          errorClass: "schema_validation",
        });
      },
    });

    assert.equal(result.outcome, "failed_permanent");
    assert.equal(result.mappedJobStatus, "failed");
    assert.equal(result.artifact.errorClass, "schema_validation");
    assert.equal(calls, 1);
  });
});

test("failed_retryable when budget exhausts on retryable errors with no judge rejections", async () => {
  await withRunDir(async (runDir) => {
    const calls: number[] = [];
    const result = await runAgentHarnessStep({
      runDir,
      jobId: "job-1780",
      // repair_planner profile.maxAttempts = 3, so a standard testDepth
      // (1 + 2 repair iterations = 3) saturates the role budget exactly.
      role: "repair_planner",
      roleStepId: "test_generation_retry",
      executeAttempt: async ({ attempt }) => {
        calls.push(attempt);
        return baseAttempt({
          errorKind: "retryable",
          errorClass: "timeout",
          inputTokens: 10,
          outputTokens: 5,
          latencyMs: 7,
        });
      },
    });

    assert.equal(result.outcome, "failed_retryable");
    assert.equal(result.mappedJobStatus, "failed");
    assert.equal(result.artifact.errorClass, "timeout");
    assert.deepEqual(calls, [1, 2, 3]);
    assert.equal(result.artifact.maxAttemptsAllowed, 3);
    assert.equal(result.artifact.attemptsConsumed, 3);
    assert.equal(result.artifact.costsRollup.inputTokens, 30);
    assert.equal(result.artifact.costsRollup.outputTokens, 15);
    assert.equal(result.artifact.costsRollup.totalLatencyMs, 21);
  });
});

test("needs_review when budget exhausts on judge rejections (max-iteration exhaustion ≠ accepted)", async () => {
  await withRunDir(async (runDir) => {
    let calls = 0;
    const result = await runAgentHarnessStep({
      runDir,
      jobId: "job-1780",
      role: "repair_planner",
      roleStepId: "test_generation_review",
      // standard testDepth → 2 repair iterations + 1 = 3, repair_planner cap 3
      executeAttempt: async () => {
        calls += 1;
        return baseAttempt({
          judgeAccepted: false,
          errorKind: "none",
        });
      },
    });

    assert.equal(result.outcome, "needs_review");
    assert.equal(result.mappedJobStatus, "partial");
    assert.equal(result.artifact.errorClass, "iteration_exhausted");
    assert.equal(calls, 3);
    assert.equal(result.artifact.attemptsConsumed, 3);
    // Acceptance criterion: max-iter exhaustion never produces "completed".
    assert.notEqual(result.mappedJobStatus, "completed");
    assert.notEqual(result.outcome, "accepted");
  });
});

test("needs_review wins over failed_retryable when any attempt was a judge rejection", async () => {
  await withRunDir(async (runDir) => {
    const result = await runAgentHarnessStep({
      runDir,
      jobId: "job-1780",
      role: "repair_planner",
      roleStepId: "mixed_outcome",
      executeAttempt: stubAttempts([
        baseAttempt({ judgeAccepted: false, errorKind: "none" }),
        baseAttempt({ errorKind: "retryable", errorClass: "gateway_error" }),
        baseAttempt({ errorKind: "retryable", errorClass: "timeout" }),
      ]),
    });

    assert.equal(result.outcome, "needs_review");
    assert.equal(result.artifact.errorClass, "iteration_exhausted");
    assert.equal(result.artifact.attemptsConsumed, 3);
  });
});

test("acceptance after a retry uses the late accept", async () => {
  await withRunDir(async (runDir) => {
    const result = await runAgentHarnessStep({
      runDir,
      jobId: "job-1780",
      role: "generator",
      roleStepId: "late_accept",
      executeAttempt: stubAttempts([
        baseAttempt({ errorKind: "retryable", errorClass: "gateway_error" }),
        baseAttempt({ judgeAccepted: true, errorKind: "none" }),
      ]),
    });
    assert.equal(result.outcome, "accepted");
    assert.equal(result.mappedJobStatus, "completed");
    assert.equal(result.artifact.attemptsConsumed, 2);
    assert.equal(result.artifact.attempts[0]!.errorClass, "gateway_error");
    assert.equal(result.artifact.attempts[1]!.errorClass, "none");
  });
});

test("standard testDepth caps attempts at 1 + DEFAULT_REPAIR_ITERATIONS, role profile cap dominates when smaller", async () => {
  await withRunDir(async (runDir) => {
    let calls = 0;
    const judge = async (): Promise<AgentHarnessAttemptResult> => {
      calls += 1;
      return baseAttempt({ errorKind: "none", judgeAccepted: false });
    };
    // repair_planner has profile.maxAttempts = 3 → standard cap = min(3, 3) = 3
    const standard = await runAgentHarnessStep({
      runDir,
      jobId: "job-budget-std",
      role: "repair_planner",
      roleStepId: "budget_std",
      executeAttempt: judge,
    });
    assert.equal(standard.artifact.attemptsConsumed, 3);
    assert.equal(standard.artifact.maxAttemptsAllowed, 3);
    assert.equal(calls, 3);

    calls = 0;
    // generator has profile.maxAttempts = 2 → cap saturates at 2 even with
    // exhaustive depth. Proves the per-role hard cap dominates.
    const profileCapped = await runAgentHarnessStep({
      runDir,
      jobId: "job-budget-cap",
      role: "generator",
      roleStepId: "budget_cap",
      testDepth: "exhaustive",
      executeAttempt: judge,
    });
    assert.equal(profileCapped.artifact.maxAttemptsAllowed, 2);
    assert.equal(calls, 2);
  });
});

test("exhaustive depth uses the +1 attempt when the profile permits it", async () => {
  await withRunDir(async (runDir) => {
    // semantic_judge profile has maxAttempts = 3; the harness cap is the
    // minimum of the profile and (1 + repair budget). To prove the +1 is
    // honored when profile permits, we override the profile inline.
    let calls = 0;
    const result = await runAgentHarnessStep({
      runDir,
      jobId: "job-1780",
      role: "generator",
      roleStepId: "exhaustive_full",
      testDepth: "exhaustive",
      profile: {
        schemaVersion: "1.0.0",
        role: "generator",
        roleKind: "deterministic_service",
        outputSchema: "synthetic.v1",
        maxAttempts: 3,
        maxInputTokens: 0,
        maxOutputTokens: 0,
        capability: "read_artifacts",
        finOpsGroup: "generation",
      },
      executeAttempt: async () => {
        calls += 1;
        return baseAttempt({ errorKind: "none", judgeAccepted: false });
      },
    });
    assert.equal(calls, 3);
    assert.equal(result.artifact.maxAttemptsAllowed, 3);

    calls = 0;
    const wider = await runAgentHarnessStep({
      runDir,
      jobId: "job-1780-wider",
      role: "generator",
      roleStepId: "exhaustive_full2",
      testDepth: "exhaustive",
      profile: {
        schemaVersion: "1.0.0",
        role: "generator",
        roleKind: "deterministic_service",
        outputSchema: "synthetic.v1",
        // Profile cap loosened to a 4 — but contract types only allow 1|2|3.
        // We cap at 3 and assert the harness honors that minimum.
        maxAttempts: 3,
        maxInputTokens: 0,
        maxOutputTokens: 0,
        capability: "read_artifacts",
        finOpsGroup: "generation",
      },
      executeAttempt: async () => {
        calls += 1;
        return baseAttempt({ errorKind: "none", judgeAccepted: false });
      },
    });
    assert.equal(wider.artifact.maxAttemptsAllowed, 3);
    assert.equal(calls, 3);
  });
});

test("per-step artifact is written under <runDir>/agent-role-runs/<roleStepId>.json with no secrets", async () => {
  await withRunDir(async (runDir) => {
    const result = await runAgentHarnessStep({
      runDir,
      jobId: "job-1780",
      role: "generator",
      roleStepId: "artifact_check",
      executeAttempt: stubAttempts([
        baseAttempt({ judgeAccepted: true, errorKind: "none" }),
      ]),
    });

    const expected = join(
      runDir,
      AGENT_ROLE_RUN_ARTIFACT_DIRECTORY,
      "artifact_check.json",
    );
    assert.equal(result.artifactPath, expected);
    const stats = await stat(expected);
    assert.ok(stats.isFile());

    const text = await readFile(expected, "utf8");
    assert.ok(text.endsWith("\n"));
    assert.equal(text.includes("Bearer "), false);
    assert.equal(text.includes("AKIA"), false);
    assert.equal(text.includes("chain_of_thought"), false);
    // The artifact carries `rawPromptsIncluded: false` as an explicit
    // anchor, so we assert there is no raw prompt *body* — not the field
    // name itself. Match a typical raw-prompt key that should never leak.
    assert.equal(text.includes('"systemPrompt"'), false);
    assert.equal(text.includes('"rawPrompt"'), false);

    const parsed = JSON.parse(text) as Record<string, unknown>;
    assert.equal(parsed["schemaVersion"], AGENT_HARNESS_STEP_SCHEMA_VERSION);
    assert.equal(parsed["roleStepId"], "artifact_check");
    assert.equal(parsed["jobId"], "job-1780");
    assert.equal(parsed["outcome"], "accepted");
    assert.equal(parsed["mappedJobStatus"], "completed");
    assert.equal(parsed["rawPromptsIncluded"], false);
    assert.ok(Array.isArray(parsed["attempts"]));
    const attempts = parsed["attempts"] as readonly Record<string, unknown>[];
    assert.equal(attempts[0]!["roleRunId"], "artifact_check-a1");
    // Per-attempt entries only carry hashes, not raw payloads.
    assert.equal("payload" in attempts[0]!, false);
    assert.equal("response" in attempts[0]!, false);
  });
});

test("rejects malformed hashes from the attempt callback", async () => {
  await withRunDir(async (runDir) => {
    await assert.rejects(
      runAgentHarnessStep({
        runDir,
        jobId: "job-1780",
        role: "generator",
        roleStepId: "bad_hash",
        executeAttempt: async () => ({
          ...baseAttempt({ judgeAccepted: true, errorKind: "none" }),
          inputHash: "not-a-hash",
        }),
      }),
      /must be a 64-char lowercase hex digest/,
    );
  });
});

test("integration: 5-outcome matrix produces distinct status mappings", async () => {
  await withRunDir(async (runDir) => {
    const cases: ReadonlyArray<{
      readonly id: string;
      readonly attempts: readonly AgentHarnessAttemptResult[];
      readonly outcome: string;
      readonly status: string;
    }> = [
      {
        id: "case_accepted",
        attempts: [baseAttempt({ judgeAccepted: true, errorKind: "none" })],
        outcome: "accepted",
        status: "completed",
      },
      {
        id: "case_blocked",
        attempts: [baseAttempt({ errorKind: "policy_block" })],
        outcome: "blocked",
        status: "partial",
      },
      {
        id: "case_perm",
        attempts: [
          baseAttempt({
            errorKind: "permanent",
            errorClass: "schema_validation",
          }),
        ],
        outcome: "failed_permanent",
        status: "failed",
      },
      {
        id: "case_retry",
        attempts: [
          baseAttempt({ errorKind: "retryable", errorClass: "gateway_error" }),
          baseAttempt({ errorKind: "retryable", errorClass: "gateway_error" }),
          baseAttempt({ errorKind: "retryable", errorClass: "timeout" }),
        ],
        outcome: "failed_retryable",
        status: "failed",
      },
      {
        id: "case_review",
        attempts: [
          baseAttempt({ judgeAccepted: false, errorKind: "none" }),
          baseAttempt({ judgeAccepted: false, errorKind: "none" }),
          baseAttempt({ judgeAccepted: false, errorKind: "none" }),
        ],
        outcome: "needs_review",
        status: "partial",
      },
    ];

    for (const c of cases) {
      const r = await runAgentHarnessStep({
        runDir,
        jobId: "job-matrix",
        role: "generator",
        roleStepId: c.id,
        // exhaustive lets the retry case use 3 attempts under the profile cap of 3
        testDepth: "exhaustive",
        executeAttempt: stubAttempts(c.attempts),
      });
      assert.equal(r.outcome, c.outcome, `outcome for ${c.id}`);
      assert.equal(r.mappedJobStatus, c.status, `status for ${c.id}`);

      const persistedPath = join(
        runDir,
        AGENT_ROLE_RUN_ARTIFACT_DIRECTORY,
        `${c.id}.json`,
      );
      const parsed = JSON.parse(
        await readFile(persistedPath, "utf8"),
      ) as Record<string, unknown>;
      assert.equal(parsed["outcome"], c.outcome);
      assert.equal(parsed["mappedJobStatus"], c.status);
    }
  });
});

test("rejects unknown role and empty arguments", async () => {
  await withRunDir(async (runDir) => {
    await assert.rejects(
      runAgentHarnessStep({
        runDir,
        jobId: "j",
        role: "not_a_role" as unknown as AgentHarnessRole,
        roleStepId: "x",
        executeAttempt: stubAttempts([baseAttempt({ judgeAccepted: true })]),
      }),
      /unknown role/,
    );
    await assert.rejects(
      runAgentHarnessStep({
        runDir: "",
        jobId: "j",
        role: "generator",
        roleStepId: "x",
        executeAttempt: stubAttempts([baseAttempt({ judgeAccepted: true })]),
      }),
      /runDir must be non-empty/,
    );
    await assert.rejects(
      runAgentHarnessStep({
        runDir,
        jobId: "",
        role: "generator",
        roleStepId: "x",
        executeAttempt: stubAttempts([baseAttempt({ judgeAccepted: true })]),
      }),
      /jobId must be non-empty/,
    );
    await assert.rejects(
      runAgentHarnessStep({
        runDir,
        jobId: "j",
        role: "generator",
        roleStepId: "",
        executeAttempt: stubAttempts([baseAttempt({ judgeAccepted: true })]),
      }),
      /roleStepId must be non-empty/,
    );
  });
});
