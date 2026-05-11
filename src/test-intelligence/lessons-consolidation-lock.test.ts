import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CONSOLIDATION_LOCK_EVENTS_DIRECTORY,
  CONSOLIDATION_LOCK_FILENAME,
  CONSOLIDATION_LOCK_HOLDER_TIMEOUT_MS,
  inspectConsolidationLock,
  readConsolidationLockEventChain,
  readLastConsolidatedAtMs,
  releaseConsolidationLock,
  rollbackConsolidationLock,
  tryAcquireConsolidationLock,
  verifyConsolidationLockEventChain,
} from "./lessons-consolidation-lock.js";

const NOW = Date.parse("2026-05-04T12:00:00.000Z");

const withLessonsDir = async (
  fn: (dir: string) => Promise<void>,
): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), "wd-lock-test-1789-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const aliveAlways = (): boolean => true;
const deadAlways = (): boolean => false;

// ---------------------------------------------------------------------------
// Acquire / release happy path
// ---------------------------------------------------------------------------

test("first acquire creates the lock and emits a chain root event", async () => {
  await withLessonsDir(async (dir) => {
    const result = await tryAcquireConsolidationLock({
      lessonsDir: dir,
      holderId: "holder-1",
      nowMs: NOW,
      isHolderProcessAlive: aliveAlways,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.tookOver, false);
    assert.equal(result.takeoverEvent, undefined);
    assert.equal(result.acquireEvent.eventType, "lock_acquired");
    assert.equal(result.acquireEvent.chainIndex, 0);

    const inspected = await inspectConsolidationLock(dir);
    assert.ok(inspected !== null);
    assert.equal(inspected?.holderId, "holder-1");
    assert.equal(inspected?.state, "held");
  });
});

test("release advances lastConsolidatedAt mtime", async () => {
  await withLessonsDir(async (dir) => {
    const acquire = await tryAcquireConsolidationLock({
      lessonsDir: dir,
      holderId: "h",
      nowMs: NOW,
      isHolderProcessAlive: aliveAlways,
    });
    assert.equal(acquire.ok, true);
    const release = await releaseConsolidationLock({
      lessonsDir: dir,
      holderId: "h",
      nowMs: NOW + 60_000,
    });
    assert.equal(release.released, true);
    const last = await readLastConsolidatedAtMs(dir);
    assert.ok(last !== null);
    assert.ok(Math.abs((last ?? 0) - (NOW + 60_000)) < 1000);
    const inspected = await inspectConsolidationLock(dir);
    assert.equal(inspected?.state, "released");
  });
});

test("release refuses when the holderId does not match", async () => {
  await withLessonsDir(async (dir) => {
    const acquire = await tryAcquireConsolidationLock({
      lessonsDir: dir,
      holderId: "h-correct",
      nowMs: NOW,
      isHolderProcessAlive: aliveAlways,
    });
    assert.equal(acquire.ok, true);
    const release = await releaseConsolidationLock({
      lessonsDir: dir,
      holderId: "h-other",
      nowMs: NOW + 100,
    });
    assert.equal(release.released, false);
  });
});

// ---------------------------------------------------------------------------
// Concurrent acquirers
// ---------------------------------------------------------------------------

test("second acquire while held by live holder is refused", async () => {
  await withLessonsDir(async (dir) => {
    const first = await tryAcquireConsolidationLock({
      lessonsDir: dir,
      holderId: "first",
      nowMs: NOW,
      isHolderProcessAlive: aliveAlways,
    });
    assert.equal(first.ok, true);
    const second = await tryAcquireConsolidationLock({
      lessonsDir: dir,
      holderId: "second",
      nowMs: NOW + 60_000,
      isHolderProcessAlive: aliveAlways,
    });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "lock_held_by_other");
    assert.equal(second.holderId, "first");
  });
});

// ---------------------------------------------------------------------------
// AT-034 — stale-takeover audit
// ---------------------------------------------------------------------------

test("AT-034: stale-by-age takeover emits a Merkle-chained lock_takeover event", async () => {
  await withLessonsDir(async (dir) => {
    const first = await tryAcquireConsolidationLock({
      lessonsDir: dir,
      holderId: "stale-holder",
      holderPid: 99999,
      holderHost: "host-a",
      nowMs: NOW,
      isHolderProcessAlive: aliveAlways,
    });
    assert.equal(first.ok, true);
    const ageBeyondTimeout = CONSOLIDATION_LOCK_HOLDER_TIMEOUT_MS + 60_000;
    const second = await tryAcquireConsolidationLock({
      lessonsDir: dir,
      holderId: "fresh-holder",
      holderPid: 12345,
      holderHost: "host-b",
      nowMs: NOW + ageBeyondTimeout,
      isHolderProcessAlive: aliveAlways,
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.tookOver, true);
    assert.ok(second.takeoverEvent !== undefined);
    assert.equal(second.takeoverEvent?.eventType, "lock_takeover");
    assert.equal(second.takeoverEvent?.priorHolderId, "stale-holder");
    assert.equal(second.takeoverEvent?.priorHolderPid, 99999);
    assert.equal(second.takeoverEvent?.priorHolderHost, "host-a");

    // The chain has root takeover + acquire = 2 events at indices 1 and 2,
    // preceded by the original acquire at index 0.
    const chain = await readConsolidationLockEventChain(dir);
    assert.deepEqual(
      chain.map((e) => e.eventType),
      ["lock_acquired", "lock_takeover", "lock_acquired"],
    );
    const verify = verifyConsolidationLockEventChain(chain);
    assert.equal(verify.ok, true);
  });
});

test("dead-PID takeover succeeds even within the holder timeout", async () => {
  await withLessonsDir(async (dir) => {
    const first = await tryAcquireConsolidationLock({
      lessonsDir: dir,
      holderId: "dead-holder",
      holderPid: 1,
      holderHost: "host-a",
      nowMs: NOW,
      isHolderProcessAlive: aliveAlways,
    });
    assert.equal(first.ok, true);
    const second = await tryAcquireConsolidationLock({
      lessonsDir: dir,
      holderId: "fresh",
      nowMs: NOW + 1000,
      isHolderProcessAlive: deadAlways,
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.tookOver, true);
    assert.equal(second.takeoverEvent?.eventType, "lock_takeover");
  });
});

test("takeover preserves prior lastConsolidatedAt mtime", async () => {
  await withLessonsDir(async (dir) => {
    const first = await tryAcquireConsolidationLock({
      lessonsDir: dir,
      holderId: "h1",
      nowMs: NOW,
      isHolderProcessAlive: aliveAlways,
    });
    assert.equal(first.ok, true);
    const release = await releaseConsolidationLock({
      lessonsDir: dir,
      holderId: "h1",
      nowMs: NOW + 60_000,
    });
    assert.equal(release.released, true);
    const lastAfterFirst = await readLastConsolidatedAtMs(dir);
    // Now h2 acquires; mtime should be preserved, not advanced.
    await tryAcquireConsolidationLock({
      lessonsDir: dir,
      holderId: "h2",
      nowMs: NOW + 120_000,
      isHolderProcessAlive: aliveAlways,
    });
    const lastAfterReacquire = await readLastConsolidatedAtMs(dir);
    assert.ok(lastAfterFirst !== null);
    assert.ok(lastAfterReacquire !== null);
    assert.ok(
      Math.abs((lastAfterReacquire ?? 0) - (lastAfterFirst ?? 0)) < 1000,
    );
  });
});

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

test("rollback restores the prior mtime and does not advance lastConsolidatedAt", async () => {
  await withLessonsDir(async (dir) => {
    const first = await tryAcquireConsolidationLock({
      lessonsDir: dir,
      holderId: "h1",
      nowMs: NOW,
      isHolderProcessAlive: aliveAlways,
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const release = await releaseConsolidationLock({
      lessonsDir: dir,
      holderId: "h1",
      nowMs: NOW + 60_000,
    });
    assert.equal(release.released, true);
    const consolidatedAtMs = await readLastConsolidatedAtMs(dir);
    assert.ok(consolidatedAtMs !== null);

    const second = await tryAcquireConsolidationLock({
      lessonsDir: dir,
      holderId: "h2",
      nowMs: NOW + 120_000,
      isHolderProcessAlive: aliveAlways,
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    const rollback = await rollbackConsolidationLock({
      lessonsDir: dir,
      holderId: "h2",
      priorMtimeMs: consolidatedAtMs ?? 0,
      nowMs: NOW + 180_000,
    });
    assert.equal(rollback.rolledBack, true);
    const lastAfterRollback = await readLastConsolidatedAtMs(dir);
    assert.ok(lastAfterRollback !== null);
    assert.ok(
      Math.abs((lastAfterRollback ?? 0) - (consolidatedAtMs ?? 0)) < 1000,
    );
    const inspected = await inspectConsolidationLock(dir);
    assert.equal(inspected?.state, "released");
  });
});

// ---------------------------------------------------------------------------
// Crash-replay simulation
// ---------------------------------------------------------------------------

test("crash-replay: a held lock persists, and a fresh acquirer waits for staleness", async () => {
  await withLessonsDir(async (dir) => {
    // Simulate process A acquiring the lock, then crashing without
    // releasing. The lock body persists on disk and the second
    // process evaluates staleness.
    const acquireA = await tryAcquireConsolidationLock({
      lessonsDir: dir,
      holderId: "crashed",
      nowMs: NOW,
      isHolderProcessAlive: aliveAlways,
    });
    assert.equal(acquireA.ok, true);

    // Replay: process B starts and PID-probe shows "crashed" PID gone.
    const acquireB = await tryAcquireConsolidationLock({
      lessonsDir: dir,
      holderId: "replay",
      nowMs: NOW + 1000,
      isHolderProcessAlive: deadAlways,
    });
    assert.equal(acquireB.ok, true);
    if (!acquireB.ok) return;
    assert.equal(acquireB.tookOver, true);
    const chain = await readConsolidationLockEventChain(dir);
    assert.deepEqual(
      chain.map((e) => e.eventType),
      ["lock_acquired", "lock_takeover", "lock_acquired"],
    );
  });
});

// ---------------------------------------------------------------------------
// Chain tamper detection
// ---------------------------------------------------------------------------

test("mutating a middle lock event surfaces chain_break at the affected index", async () => {
  await withLessonsDir(async (dir) => {
    await tryAcquireConsolidationLock({
      lessonsDir: dir,
      holderId: "h1",
      nowMs: NOW,
      isHolderProcessAlive: aliveAlways,
    });
    await releaseConsolidationLock({
      lessonsDir: dir,
      holderId: "h1",
      nowMs: NOW + 1000,
    });
    await tryAcquireConsolidationLock({
      lessonsDir: dir,
      holderId: "h2",
      nowMs: NOW + 2000,
      isHolderProcessAlive: aliveAlways,
    });
    const eventsDir = join(dir, CONSOLIDATION_LOCK_EVENTS_DIRECTORY);
    // Mutate the middle event.
    const middlePath = join(eventsDir, "00000001.json");
    const original = await readFile(middlePath, "utf8");
    const parsed = JSON.parse(original) as Record<string, unknown>;
    parsed["holderId"] = "tampered";
    await writeFile(middlePath, `${JSON.stringify(parsed)}\n`, "utf8");
    const chain = await readConsolidationLockEventChain(dir);
    const verify = verifyConsolidationLockEventChain(chain);
    assert.equal(verify.ok, false);
    if (verify.ok) return;
    assert.equal(verify.code, "chain_break");
    assert.equal(verify.firstBreakIndex, 2);
    assert.equal(verify.reason, "parent_hash_mismatch");
  });
});

test("verifier accepts an empty chain", () => {
  const result = verifyConsolidationLockEventChain([]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.chainLength, 0);
});

// ---------------------------------------------------------------------------
// Lock file location
// ---------------------------------------------------------------------------

test("lock file lives at <lessonsDir>/.consolidate-lock", async () => {
  await withLessonsDir(async (dir) => {
    await tryAcquireConsolidationLock({
      lessonsDir: dir,
      holderId: "h",
      nowMs: NOW,
      isHolderProcessAlive: aliveAlways,
    });
    const lockPath = join(dir, CONSOLIDATION_LOCK_FILENAME);
    const s = await stat(lockPath);
    assert.ok(s.size > 0);
  });
});
