#!/usr/bin/env tsx

/**
 * Merkle-chain round-trip self-test for the release pipeline
 * (Issue #1803, gate `release_merkle_roundtrip`).
 *
 * Builds a small synthetic agent-harness checkpoint chain in-memory using
 * {@link appendAgentHarnessCheckpoint}, persists each checkpoint atomically
 * via {@link writeAgentHarnessCheckpoint}, then re-reads the on-disk
 * artifacts via {@link verifyAgentHarnessCheckpointChainFromDisk}.
 *
 * The script enforces:
 * - The persisted chain verifies (hash propagation intact, no break).
 * - The recomputed `headOfChainHash` matches the in-memory expectation.
 * - A deliberately tampered copy (one byte flipped on the tail) is
 *   rejected with the `parent_hash_mismatch` break reason — proving the
 *   verifier cannot be silently bypassed by a hand-edited chain.
 *
 * Exits non-zero on any deviation so the readiness orchestrator attributes
 * the breakage to this gate with a clear log link.
 *
 * Usage:
 *   tsx scripts/release-merkle-roundtrip.ts \
 *     [--run-dir <path>] \
 *     [--job-id <safe-id>]
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AGENT_HARNESS_CHECKPOINT_DIRECTORY,
  appendAgentHarnessCheckpoint,
  computeAgentHarnessCheckpointHash,
  verifyAgentHarnessCheckpointChain,
  verifyAgentHarnessCheckpointChainFromDisk,
  writeAgentHarnessCheckpoint,
  type AgentHarnessCheckpoint,
} from "../src/test-intelligence/agent-harness-checkpoint.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const SAFE_JOB_ID = /^[A-Za-z0-9._-]+$/u;

const DEFAULT_JOB_ID = "release-merkle-roundtrip-job";

interface CliOptions {
  readonly runDir: string | null;
  readonly jobId: string;
}

const resolveWithinRepo = (flag: string, value: string): string => {
  const resolved = path.resolve(repoRoot, value);
  if (resolved !== repoRoot && !resolved.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error(
      `${flag}: path must resolve inside the repo root (${repoRoot}); got ${resolved}`,
    );
  }
  return resolved;
};

const parseArgs = (argv: readonly string[]): CliOptions => {
  let runDir: string | null = null;
  let jobId = DEFAULT_JOB_ID;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--run-dir") {
      if (typeof value !== "string" || value.length === 0) {
        throw new Error("--run-dir requires a path argument");
      }
      runDir = resolveWithinRepo("--run-dir", value);
      index += 1;
      continue;
    }
    if (flag === "--job-id") {
      if (
        typeof value !== "string" ||
        value.length === 0 ||
        !SAFE_JOB_ID.test(value)
      ) {
        throw new Error(`--job-id must match ${SAFE_JOB_ID}; got ${String(value)}`);
      }
      jobId = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${String(flag)}`);
  }
  return { runDir, jobId };
};

interface SyntheticCheckpointStep {
  readonly roleStepId: string;
  readonly status: "completed";
  readonly inputHash: string;
  readonly outputHash: string;
  readonly nextRoleStepIds: readonly string[];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly runId: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

const SYNTHETIC_STEPS: readonly SyntheticCheckpointStep[] = [
  {
    roleStepId: "intent_derivation",
    status: "completed",
    inputHash:
      "1111111111111111111111111111111111111111111111111111111111111111",
    outputHash:
      "2222222222222222222222222222222222222222222222222222222222222222",
    nextRoleStepIds: ["coverage_planner"],
    startedAt: "2026-05-04T08:00:00.000Z",
    completedAt: "2026-05-04T08:00:01.000Z",
    runId: "11111111-1111-4111-8111-111111111111",
    promptTokens: 0,
    completionTokens: 0,
  },
  {
    roleStepId: "coverage_planner",
    status: "completed",
    inputHash:
      "3333333333333333333333333333333333333333333333333333333333333333",
    outputHash:
      "4444444444444444444444444444444444444444444444444444444444444444",
    nextRoleStepIds: ["test_designer"],
    startedAt: "2026-05-04T08:00:02.000Z",
    completedAt: "2026-05-04T08:00:03.000Z",
    runId: "22222222-2222-4222-8222-222222222222",
    promptTokens: 1024,
    completionTokens: 256,
  },
  {
    roleStepId: "test_designer",
    status: "completed",
    inputHash:
      "5555555555555555555555555555555555555555555555555555555555555555",
    outputHash:
      "6666666666666666666666666666666666666666666666666666666666666666",
    nextRoleStepIds: [],
    startedAt: "2026-05-04T08:00:04.000Z",
    completedAt: "2026-05-04T08:00:05.000Z",
    runId: "33333333-3333-4333-8333-333333333333",
    promptTokens: 2048,
    completionTokens: 512,
  },
];

const buildSyntheticChain = (
  jobId: string,
): readonly AgentHarnessCheckpoint[] => {
  const chain: AgentHarnessCheckpoint[] = [];
  let previous: AgentHarnessCheckpoint | null = null;
  for (let index = 0; index < SYNTHETIC_STEPS.length; index += 1) {
    const step = SYNTHETIC_STEPS[index];
    if (!step) continue;
    const checkpoint = appendAgentHarnessCheckpoint(previous, {
      jobId,
      roleStepId: step.roleStepId,
      attempt: 1,
      status: step.status,
      inputHash: step.inputHash,
      outputHash: step.outputHash,
      nextRoleStepIds: step.nextRoleStepIds,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      runId: step.runId,
      parentRunId:
        previous === null ? null : (previous.runId as string | null),
      promptTokens: step.promptTokens,
      completionTokens: step.completionTokens,
    });
    chain.push(checkpoint);
    previous = checkpoint;
  }
  return Object.freeze(chain);
};

const main = async (): Promise<number> => {
  const options = parseArgs(process.argv.slice(2));

  // Use an OS tempdir by default — the round-trip is a sealed self-test
  // and must not pollute repo evidence with throwaway checkpoints.
  let runDir = options.runDir;
  let cleanup = false;
  if (runDir === null) {
    runDir = await mkdtemp(path.join(tmpdir(), "release-merkle-roundtrip-"));
    cleanup = true;
  } else {
    await mkdir(runDir, { recursive: true });
  }

  try {
    // 1. Build the in-memory chain.
    const chain = buildSyntheticChain(options.jobId);
    const inMemoryVerify = verifyAgentHarnessCheckpointChain(chain);
    if (!inMemoryVerify.ok) {
      throw new Error(
        `attribution=in_memory_chain_break in_memory chain failed verification: ${inMemoryVerify.reason} ${inMemoryVerify.detail}`,
      );
    }

    // 2. Persist atomically.
    for (const checkpoint of chain) {
      await writeAgentHarnessCheckpoint({ runDir, checkpoint });
    }

    // 3. Re-read and verify from disk.
    const onDisk = await verifyAgentHarnessCheckpointChainFromDisk({
      runDir,
      jobId: options.jobId,
    });
    if (!onDisk.ok) {
      throw new Error(
        `attribution=on_disk_chain_break disk chain failed verification: ${onDisk.reason} ${onDisk.detail}`,
      );
    }
    if (onDisk.headOfChainHash !== inMemoryVerify.headOfChainHash) {
      throw new Error(
        `attribution=head_hash_mismatch headOfChainHash mismatch (memory=${inMemoryVerify.headOfChainHash}, disk=${onDisk.headOfChainHash})`,
      );
    }
    if (onDisk.chainLength !== inMemoryVerify.chainLength) {
      throw new Error(
        `attribution=chain_length_mismatch chainLength mismatch (memory=${inMemoryVerify.chainLength}, disk=${onDisk.chainLength})`,
      );
    }

    // 4. Tamper-detection self-test: rewrite the tail with a flipped
    //    inputHash and confirm the verifier rejects it.
    const tamperDir = await mkdtemp(
      path.join(tmpdir(), "release-merkle-tamper-"),
    );
    try {
      for (let index = 0; index < chain.length - 1; index += 1) {
        await writeAgentHarnessCheckpoint({
          runDir: tamperDir,
          checkpoint: chain[index]!,
        });
      }
      const tail = chain[chain.length - 1]!;
      const tamperedTail: AgentHarnessCheckpoint = {
        ...tail,
        // Flip a byte in the parentHash so the rule
        // `parentHash === sha256(canonicalJson(prev))` fires.
        parentHash:
          tail.parentHash.slice(0, 63) +
          (tail.parentHash.endsWith("0") ? "1" : "0"),
      };
      const tailDir = path.join(
        tamperDir,
        AGENT_HARNESS_CHECKPOINT_DIRECTORY,
        options.jobId,
      );
      await mkdir(tailDir, { recursive: true });
      const tailPath = path.join(
        tailDir,
        `${String(tamperedTail.chainIndex).padStart(8, "0")}.json`,
      );
      // The tail's parentHash is now wrong, but its structural invariants
      // still hold — the verifier is the only safeguard. Persisting the
      // tampered file directly (no atomic helper, since the helper would
      // re-validate via its writer) confirms the on-disk verifier is the
      // gate, not the writer.
      await writeFile(
        tailPath,
        `${JSON.stringify(tamperedTail, null, 0)}\n`,
        "utf8",
      );
      // Sanity check the file landed.
      await readFile(tailPath, "utf8");

      const tampered = await verifyAgentHarnessCheckpointChainFromDisk({
        runDir: tamperDir,
        jobId: options.jobId,
      });
      if (tampered.ok) {
        throw new Error(
          "attribution=tamper_undetected tampered chain unexpectedly verified — round-trip integrity broken",
        );
      }
      if (tampered.reason !== "parent_hash_mismatch") {
        throw new Error(
          `attribution=wrong_break_reason expected parent_hash_mismatch, got ${tampered.reason}`,
        );
      }
    } finally {
      await rm(tamperDir, { recursive: true, force: true });
    }

    // 5. Cross-check that the in-memory tail hash matches the recomputed
    //    chain head — closing the round-trip explicitly.
    const recomputedHead = computeAgentHarnessCheckpointHash(
      chain[chain.length - 1]!,
    );
    if (recomputedHead !== inMemoryVerify.headOfChainHash) {
      throw new Error(
        `attribution=recompute_mismatch recomputed head hash differs from chain summary`,
      );
    }

    console.log(
      `[release-merkle-roundtrip] job-id=${options.jobId} chain-length=${onDisk.chainLength} head-hash=${onDisk.headOfChainHash}`,
    );
    console.log(
      "[release-merkle-roundtrip] tamper-detection: parent_hash_mismatch surfaced as expected",
    );
    return 0;
  } finally {
    if (cleanup && runDir !== null) {
      await rm(runDir, { recursive: true, force: true });
    }
  }
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[release-merkle-roundtrip] Failed: ${message}`);
      process.exit(1);
    });
}
