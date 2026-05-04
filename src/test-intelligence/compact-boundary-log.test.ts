import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  COMPACT_BOUNDARY_LOG_ARTIFACT_FILENAME,
  COMPACT_BOUNDARY_LOG_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type CompactBoundaryLogEntry,
} from "../contracts/index.js";
import {
  buildCompactBoundaryLog,
  isCompactBoundaryLogEntry,
  parseCompactBoundaryLog,
  writeCompactBoundaryLog,
} from "./compact-boundary-log.js";

const HASH_A = "3".repeat(64);
const HASH_B = "4".repeat(64);
const SUMMARY_HASH = "5".repeat(64);

const baseEntry = (
  overrides: Partial<CompactBoundaryLogEntry> = {},
): CompactBoundaryLogEntry => ({
  schemaVersion: COMPACT_BOUNDARY_LOG_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId: "job-1",
  ts: "2026-05-04T08:00:00.000Z",
  tier: "task_round",
  summarySha256: SUMMARY_HASH,
  clearedToolResultBytes: 4096,
  parentHash: HASH_A,
  ...overrides,
});

test("buildCompactBoundaryLog sorts deterministically and dedupes", () => {
  const built = buildCompactBoundaryLog({
    entries: [
      baseEntry({ ts: "2026-05-04T08:01:00.000Z", parentHash: HASH_B }),
      baseEntry({ ts: "2026-05-04T08:00:00.000Z", parentHash: HASH_A }),
      baseEntry({ ts: "2026-05-04T08:00:00.000Z", parentHash: HASH_A }),
    ],
  });
  assert.equal(built.entries.length, 2);
  assert.deepEqual(
    built.entries.map((entry) => entry.ts),
    ["2026-05-04T08:00:00.000Z", "2026-05-04T08:01:00.000Z"],
  );
});

test("isCompactBoundaryLogEntry rejects malformed entries", () => {
  assert.equal(isCompactBoundaryLogEntry(baseEntry()), true);
  assert.equal(
    isCompactBoundaryLogEntry({ ...baseEntry(), tier: "unknown" }),
    false,
  );
  assert.equal(
    isCompactBoundaryLogEntry({ ...baseEntry(), summarySha256: "abc" }),
    false,
  );
  assert.equal(
    isCompactBoundaryLogEntry({
      ...baseEntry(),
      clearedToolResultBytes: -1,
    }),
    false,
  );
  assert.equal(
    isCompactBoundaryLogEntry({
      ...baseEntry(),
      schemaVersion: "0.9.0",
    }),
    false,
  );
});

test("writeCompactBoundaryLog persists byte-stably and round-trips", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "ti-compact-log-"));
  try {
    const entries = [
      baseEntry({ tier: "task_round", parentHash: HASH_A }),
      baseEntry({
        ts: "2026-05-04T08:01:00.000Z",
        tier: "post_repair",
        parentHash: HASH_B,
      }),
    ];
    const first = await writeCompactBoundaryLog({ runDir, entries });
    const second = await writeCompactBoundaryLog({ runDir, entries });
    assert.equal(first.serialized, second.serialized);
    assert.ok(
      first.artifactPath.endsWith(COMPACT_BOUNDARY_LOG_ARTIFACT_FILENAME),
    );
    const onDisk = await readFile(first.artifactPath, "utf8");
    assert.equal(onDisk, first.serialized);
    const parsed = parseCompactBoundaryLog(onDisk);
    assert.ok(parsed !== undefined);
    assert.equal(parsed!.length, 2);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("parseCompactBoundaryLog rejects malformed payloads", () => {
  const built = buildCompactBoundaryLog({ entries: [baseEntry()] });
  assert.equal(parseCompactBoundaryLog(built.serialized.slice(0, -1)), undefined);
  assert.equal(parseCompactBoundaryLog("not json\n"), undefined);
  const empty = parseCompactBoundaryLog("");
  assert.ok(empty !== undefined);
  assert.equal(empty!.length, 0);
});

test("compact-boundary-log: golden line for the canonical example", () => {
  const built = buildCompactBoundaryLog({
    entries: [baseEntry()],
  });
  const golden =
    '{"clearedToolResultBytes":4096,"contractVersion":"1.6.0","jobId":"job-1",' +
    '"parentHash":"' +
    HASH_A +
    '","schemaVersion":"1.0.0","summarySha256":"' +
    SUMMARY_HASH +
    '","tier":"task_round","ts":"2026-05-04T08:00:00.000Z"}\n';
  assert.equal(built.serialized, golden);
});
