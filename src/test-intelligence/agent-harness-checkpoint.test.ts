import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalJson } from "./content-hash.js";
import {
  AGENT_HARNESS_CHECKPOINT_BREAK_REASONS,
  AGENT_HARNESS_CHECKPOINT_DIRECTORY,
  AGENT_HARNESS_CHECKPOINT_ROOT_PARENT_HASH,
  AGENT_HARNESS_CHECKPOINT_SCHEMA_VERSION,
  AGENT_HARNESS_CHECKPOINT_STATUSES,
  appendAgentHarnessCheckpoint,
  assertAgentHarnessCheckpointInvariants,
  computeAgentHarnessCheckpointHash,
  isAgentHarnessCheckpointStatus,
  readAgentHarnessCheckpointChain,
  summarizeAgentHarnessCheckpointChain,
  verifyAgentHarnessCheckpointChain,
  verifyAgentHarnessCheckpointChainFromDisk,
  writeAgentHarnessCheckpoint,
  type AgentHarnessCheckpoint,
} from "./agent-harness-checkpoint.js";

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_C = "c".repeat(64);
const HEX_D = "d".repeat(64);
const HEX_OUT = "f".repeat(64);

const ISO_T0 = "2026-05-03T12:00:00.000Z";
const ISO_T1 = "2026-05-03T12:00:01.000Z";
const ISO_T2 = "2026-05-03T12:00:02.000Z";
const ISO_T3 = "2026-05-03T12:00:03.000Z";

const sha256Hex = (value: unknown): string =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");

const buildThreeStepChain = (
  jobId = "wd-job-merkle-1785",
): readonly AgentHarnessCheckpoint[] => {
  const root = appendAgentHarnessCheckpoint(null, {
    jobId,
    roleStepId: `${jobId}-generator-1`,
    attempt: 1,
    status: "started",
    inputHash: HEX_A,
    nextRoleStepIds: [`${jobId}-judge-1`, `${jobId}-judge-2`],
    startedAt: ISO_T0,
  });
  const middle = appendAgentHarnessCheckpoint(root, {
    jobId,
    roleStepId: `${jobId}-generator-1`,
    attempt: 1,
    status: "completed",
    inputHash: HEX_A,
    outputHash: HEX_OUT,
    nextRoleStepIds: [`${jobId}-judge-1`, `${jobId}-judge-2`],
    startedAt: ISO_T0,
    completedAt: ISO_T1,
  });
  const tail = appendAgentHarnessCheckpoint(middle, {
    jobId,
    roleStepId: `${jobId}-judge-1`,
    attempt: 1,
    status: "completed",
    inputHash: HEX_B,
    outputHash: HEX_C,
    nextRoleStepIds: [],
    startedAt: ISO_T2,
    completedAt: ISO_T3,
    errorClass: "none",
  });
  return Object.freeze([root, middle, tail]);
};

const withRunDir = async (
  fn: (runDir: string) => Promise<void>,
): Promise<void> => {
  const runDir = await mkdtemp(join(tmpdir(), "agent-harness-checkpoint-"));
  try {
    await fn(runDir);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
};

// ---------------------------------------------------------------------------
// Schema constants
// ---------------------------------------------------------------------------

test("schema constants are pinned", () => {
  assert.equal(AGENT_HARNESS_CHECKPOINT_SCHEMA_VERSION, "1.0.0");
  assert.equal(AGENT_HARNESS_CHECKPOINT_DIRECTORY, "agent-harness-checkpoints");
  assert.equal(AGENT_HARNESS_CHECKPOINT_ROOT_PARENT_HASH, "0".repeat(64));
  assert.deepEqual(
    [...AGENT_HARNESS_CHECKPOINT_STATUSES],
    ["canceled", "completed", "failed", "skipped", "started"],
  );
  for (const reason of AGENT_HARNESS_CHECKPOINT_BREAK_REASONS) {
    assert.equal(typeof reason, "string");
  }
});

test("isAgentHarnessCheckpointStatus accepts only the closed list", () => {
  for (const s of AGENT_HARNESS_CHECKPOINT_STATUSES) {
    assert.equal(isAgentHarnessCheckpointStatus(s), true);
  }
  for (const s of ["", "running", "ok", null, 7, undefined]) {
    assert.equal(isAgentHarnessCheckpointStatus(s as unknown), false);
  }
});

// ---------------------------------------------------------------------------
// Builder + structural invariants
// ---------------------------------------------------------------------------

test("appendAgentHarnessCheckpoint derives parentHash + chainIndex", () => {
  const [root, middle, tail] = buildThreeStepChain();
  assert.ok(root && middle && tail);
  assert.equal(root.chainIndex, 0);
  assert.equal(middle.chainIndex, 1);
  assert.equal(tail.chainIndex, 2);
  assert.equal(root.parentHash, AGENT_HARNESS_CHECKPOINT_ROOT_PARENT_HASH);
  assert.equal(middle.parentHash, sha256Hex(root));
  assert.equal(tail.parentHash, sha256Hex(middle));
});

test("appendAgentHarnessCheckpoint is byte-stable for byte-identical input", () => {
  const a = buildThreeStepChain("wd-byte-stability");
  const b = buildThreeStepChain("wd-byte-stability");
  for (let i = 0; i < a.length; i++) {
    assert.equal(canonicalJson(a[i]), canonicalJson(b[i]));
    assert.equal(
      computeAgentHarnessCheckpointHash(a[i] as AgentHarnessCheckpoint),
      computeAgentHarnessCheckpointHash(b[i] as AgentHarnessCheckpoint),
    );
  }
});

test("appendAgentHarnessCheckpoint sorts nextRoleStepIds and rejects duplicates", () => {
  const root = appendAgentHarnessCheckpoint(null, {
    jobId: "wd-sort",
    roleStepId: "wd-sort-step-1",
    attempt: 1,
    status: "started",
    inputHash: HEX_A,
    nextRoleStepIds: ["zeta", "alpha", "mu"],
    startedAt: ISO_T0,
  });
  assert.deepEqual([...root.nextRoleStepIds], ["alpha", "mu", "zeta"]);

  assert.throws(() =>
    appendAgentHarnessCheckpoint(null, {
      jobId: "wd-sort",
      roleStepId: "wd-sort-step-1",
      attempt: 1,
      status: "started",
      inputHash: HEX_A,
      nextRoleStepIds: ["alpha", "alpha"],
      startedAt: ISO_T0,
    }),
  RangeError);
});

test("appendAgentHarnessCheckpoint rejects jobId mismatch with predecessor", () => {
  const [root] = buildThreeStepChain("wd-job-A");
  assert.ok(root);
  assert.throws(
    () =>
      appendAgentHarnessCheckpoint(root, {
        jobId: "wd-job-B",
        roleStepId: "wd-job-B-1",
        attempt: 1,
        status: "started",
        inputHash: HEX_B,
        startedAt: ISO_T1,
      }),
    RangeError,
  );
});

test("assertAgentHarnessCheckpointInvariants rejects bad fields", () => {
  const [root] = buildThreeStepChain();
  assert.ok(root);

  // bad inputHash
  assert.throws(() =>
    assertAgentHarnessCheckpointInvariants({ ...root, inputHash: "abc" }),
  );
  // bad attempt
  assert.throws(() =>
    assertAgentHarnessCheckpointInvariants({ ...root, attempt: 0 }),
  );
  // bad status
  assert.throws(() =>
    assertAgentHarnessCheckpointInvariants({
      ...root,
      status: "running" as unknown as AgentHarnessCheckpoint["status"],
    }),
  );
  // bad startedAt
  assert.throws(() =>
    assertAgentHarnessCheckpointInvariants({ ...root, startedAt: "yesterday" }),
  );
  // root with non-zero parentHash
  assert.throws(() =>
    assertAgentHarnessCheckpointInvariants({ ...root, parentHash: HEX_D }),
  );
  // negative chainIndex
  assert.throws(() =>
    assertAgentHarnessCheckpointInvariants({ ...root, chainIndex: -1 }),
  );
  // schemaVersion drift
  assert.throws(() =>
    assertAgentHarnessCheckpointInvariants({
      ...root,
      schemaVersion:
        "2.0.0" as unknown as AgentHarnessCheckpoint["schemaVersion"],
    }),
  );
});

// ---------------------------------------------------------------------------
// Verifier — happy path
// ---------------------------------------------------------------------------

test("verifyAgentHarnessCheckpointChain accepts a clean chain and reports head + length", () => {
  const chain = buildThreeStepChain();
  const result = verifyAgentHarnessCheckpointChain(chain);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.chainLength, 3);
    assert.equal(
      result.headOfChainHash,
      computeAgentHarnessCheckpointHash(
        chain[2] as AgentHarnessCheckpoint,
      ),
    );
  }
});

test("verifyAgentHarnessCheckpointChain returns zero-hash + length 0 for empty chain", () => {
  const result = verifyAgentHarnessCheckpointChain([]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.chainLength, 0);
    assert.equal(
      result.headOfChainHash,
      AGENT_HARNESS_CHECKPOINT_ROOT_PARENT_HASH,
    );
  }
});

test("summarizeAgentHarnessCheckpointChain returns headOfChainHash + chainLength", () => {
  const chain = buildThreeStepChain();
  const summary = summarizeAgentHarnessCheckpointChain(chain);
  assert.equal(summary.chainLength, 3);
  assert.equal(
    summary.headOfChainHash,
    computeAgentHarnessCheckpointHash(chain[2] as AgentHarnessCheckpoint),
  );
});

test("summarizeAgentHarnessCheckpointChain throws on tampered chain", () => {
  const chain = buildThreeStepChain();
  const tampered = [
    chain[0] as AgentHarnessCheckpoint,
    { ...(chain[1] as AgentHarnessCheckpoint), inputHash: HEX_D },
    chain[2] as AgentHarnessCheckpoint,
  ];
  assert.throws(() => summarizeAgentHarnessCheckpointChain(tampered), /chain_break/);
});

// ---------------------------------------------------------------------------
// Verifier — tamper detection (AT-027 equivalent)
// ---------------------------------------------------------------------------

test("AT-027: tampering with a middle checkpoint reports chain_break at the first breaking chainIndex", () => {
  const chain = buildThreeStepChain();
  // Mutate the middle checkpoint's outputHash (a hashed field that is
  // covered by canonical-JSON of the predecessor → next.parentHash
  // mismatch). The mutation is at chainIndex 1, so the verifier MUST
  // detect a chain_break at index 1 (the tail's parentHash references
  // the *original* middle hash, not the mutated one).
  const mutated: readonly AgentHarnessCheckpoint[] = [
    chain[0] as AgentHarnessCheckpoint,
    {
      ...(chain[1] as AgentHarnessCheckpoint),
      outputHash: HEX_D,
    },
    chain[2] as AgentHarnessCheckpoint,
  ];

  // The mutation breaks the link from middle → tail because
  // tail.parentHash was computed from the *original* middle.
  const result = verifyAgentHarnessCheckpointChain(mutated);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "chain_break");
    // The tail's parentHash references the unmutated middle, so the
    // first breaking chainIndex is 2 (where the mismatch is observed).
    assert.equal(result.firstBreakIndex, 2);
    assert.equal(result.reason, "parent_hash_mismatch");
  }
});

test("verifier reports missing_root when the root carries a non-zero parentHash", () => {
  const chain = buildThreeStepChain();
  const corrupted: readonly AgentHarnessCheckpoint[] = [
    { ...(chain[0] as AgentHarnessCheckpoint), parentHash: HEX_D },
    chain[1] as AgentHarnessCheckpoint,
    chain[2] as AgentHarnessCheckpoint,
  ];
  // Note: this is rejected by the structural invariants (root must be
  // zero-hash sentinel) before the parent-hash propagation rule fires.
  const result = verifyAgentHarnessCheckpointChain(corrupted);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "chain_break");
    assert.equal(result.firstBreakIndex, 0);
    assert.equal(result.reason, "schema_invalid");
  }
});

test("verifier reports chain_index_mismatch when checkpoints are reordered", () => {
  const chain = buildThreeStepChain();
  const reordered: readonly AgentHarnessCheckpoint[] = [
    chain[0] as AgentHarnessCheckpoint,
    chain[2] as AgentHarnessCheckpoint, // <-- swapped
    chain[1] as AgentHarnessCheckpoint,
  ];
  const result = verifyAgentHarnessCheckpointChain(reordered);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.firstBreakIndex, 1);
    assert.equal(result.reason, "chain_index_mismatch");
  }
});

test("verifier reports duplicate_chain_index when the same index appears twice", () => {
  const chain = buildThreeStepChain();
  const dup: readonly AgentHarnessCheckpoint[] = [
    chain[0] as AgentHarnessCheckpoint,
    chain[1] as AgentHarnessCheckpoint,
    {
      ...(chain[2] as AgentHarnessCheckpoint),
      chainIndex: 1,
    },
  ];
  const result = verifyAgentHarnessCheckpointChain(dup);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "duplicate_chain_index");
    assert.equal(result.firstBreakIndex, 1);
  }
});

test("verifier reports schema_invalid for a structurally bad checkpoint", () => {
  const chain = buildThreeStepChain();
  const bad: readonly AgentHarnessCheckpoint[] = [
    chain[0] as AgentHarnessCheckpoint,
    {
      ...(chain[1] as AgentHarnessCheckpoint),
      attempt: 0, // invalid
    },
    chain[2] as AgentHarnessCheckpoint,
  ];
  const result = verifyAgentHarnessCheckpointChain(bad);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "schema_invalid");
    assert.equal(result.firstBreakIndex, 1);
  }
});

// ---------------------------------------------------------------------------
// On-disk round-trip
// ---------------------------------------------------------------------------

test("write + read round-trips a chain on disk and yields byte-stable artifacts", async () => {
  await withRunDir(async (runDir) => {
    const jobId = "wd-roundtrip-1785";
    const chain = buildThreeStepChain(jobId);

    const writes = [];
    for (const cp of chain) {
      writes.push(await writeAgentHarnessCheckpoint({ runDir, checkpoint: cp }));
    }
    assert.equal(writes.length, 3);

    // Files exist on disk under the expected directory layout.
    const dir = join(runDir, AGENT_HARNESS_CHECKPOINT_DIRECTORY, jobId);
    const files = (await readdir(dir)).sort();
    assert.deepEqual(files, [
      "00000000.json",
      "00000001.json",
      "00000002.json",
    ]);

    // Bytes on disk are exactly the canonical-JSON of the in-memory
    // checkpoint, with a trailing newline. This is what makes
    // headOfChainHash byte-stable across machines.
    for (let i = 0; i < chain.length; i++) {
      const onDisk = await readFile(join(dir, files[i] as string), "utf8");
      assert.equal(
        onDisk,
        `${canonicalJson(chain[i] as AgentHarnessCheckpoint)}\n`,
      );
    }

    // Read back and verify.
    const readBack = await readAgentHarnessCheckpointChain({ runDir, jobId });
    assert.equal(readBack.length, 3);
    for (let i = 0; i < chain.length; i++) {
      assert.deepEqual(readBack[i], chain[i]);
    }
    const verified = verifyAgentHarnessCheckpointChain(readBack);
    assert.equal(verified.ok, true);

    const fromDisk = await verifyAgentHarnessCheckpointChainFromDisk({
      runDir,
      jobId,
    });
    assert.equal(fromDisk.ok, true);
  });
});

test("readAgentHarnessCheckpointChain returns [] when no chain exists", async () => {
  await withRunDir(async (runDir) => {
    const result = await readAgentHarnessCheckpointChain({
      runDir,
      jobId: "wd-empty",
    });
    assert.equal(result.length, 0);
    const verified = verifyAgentHarnessCheckpointChainFromDisk({
      runDir,
      jobId: "wd-empty",
    });
    assert.equal((await verified).ok, true);
  });
});

test("AT-027 disk round-trip: mutating a middle checkpoint on disk fails verification at the first breaking chainIndex", async () => {
  await withRunDir(async (runDir) => {
    const jobId = "wd-tamper-1785";
    const chain = buildThreeStepChain(jobId);
    for (const cp of chain) {
      await writeAgentHarnessCheckpoint({ runDir, checkpoint: cp });
    }

    const dir = join(runDir, AGENT_HARNESS_CHECKPOINT_DIRECTORY, jobId);
    const middlePath = join(dir, "00000001.json");
    const original = JSON.parse(
      await readFile(middlePath, "utf8"),
    ) as AgentHarnessCheckpoint;

    // Tamper: bump the outputHash on the middle file. parentHash and
    // chainIndex are left intact, so the structural invariants pass —
    // but `tail.parentHash` referenced the *original* middle, so the
    // verifier must surface chain_break at the tail.
    const tampered = { ...original, outputHash: HEX_D };
    await writeFile(middlePath, `${canonicalJson(tampered)}\n`, "utf8");

    const result = await verifyAgentHarnessCheckpointChainFromDisk({
      runDir,
      jobId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "chain_break");
      assert.equal(result.firstBreakIndex, 2);
      assert.equal(result.reason, "parent_hash_mismatch");
    }
  });
});

test("disk round-trip: deleting a middle checkpoint surfaces chain_index_mismatch", async () => {
  await withRunDir(async (runDir) => {
    const jobId = "wd-delete-1785";
    const chain = buildThreeStepChain(jobId);
    for (const cp of chain) {
      await writeAgentHarnessCheckpoint({ runDir, checkpoint: cp });
    }

    const dir = join(runDir, AGENT_HARNESS_CHECKPOINT_DIRECTORY, jobId);
    await rm(join(dir, "00000001.json"));

    const result = await verifyAgentHarnessCheckpointChainFromDisk({
      runDir,
      jobId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.firstBreakIndex, 1);
      assert.equal(result.reason, "chain_index_mismatch");
    }
  });
});

test("writeAgentHarnessCheckpoint rejects unsafe jobIds for path traversal protection", async () => {
  await withRunDir(async (runDir) => {
    const root = appendAgentHarnessCheckpoint(null, {
      jobId: "../../etc/passwd",
      roleStepId: "x",
      attempt: 1,
      status: "started",
      inputHash: HEX_A,
      startedAt: ISO_T0,
    });
    await assert.rejects(
      writeAgentHarnessCheckpoint({ runDir, checkpoint: root }),
      /unsafe characters/,
    );
  });
});

test("writeAgentHarnessCheckpoint never persists raw prompts or secrets", async () => {
  await withRunDir(async (runDir) => {
    const jobId = "wd-purity-1785";
    const chain = buildThreeStepChain(jobId);
    for (const cp of chain) {
      await writeAgentHarnessCheckpoint({ runDir, checkpoint: cp });
    }
    const dir = join(runDir, AGENT_HARNESS_CHECKPOINT_DIRECTORY, jobId);
    for (const name of await readdir(dir)) {
      const raw = await readFile(join(dir, name), "utf8");
      // The schema does not include any of these fields, and the
      // canonical-JSON serialiser only ever writes the keys present
      // on the typed object. A lexical check guarantees we never
      // accidentally start persisting them.
      const banned = [
        "prompt",
        "promptBody",
        "rawPrompt",
        "systemPrompt",
        "userPrompt",
        "completion",
        "outputBody",
        "secret",
        "apiKey",
        "authorization",
        "bearer",
        "chainOfThought",
      ];
      for (const term of banned) {
        assert.equal(
          raw.toLowerCase().includes(term.toLowerCase()),
          false,
          `${name} unexpectedly contains banned term "${term}"`,
        );
      }
    }
  });
});
