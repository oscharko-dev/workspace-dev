import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CACHE_BREAK_EVENTS_LOG_ARTIFACT_FILENAME,
  CACHE_BREAK_EVENTS_LOG_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type CacheBreakEventLogEntry,
} from "../contracts/index.js";
import {
  buildCacheBreakEventsLog,
  isCacheBreakEventLogEntry,
  parseCacheBreakEventsLog,
  writeCacheBreakEventsLog,
} from "./cache-break-events-log.js";

const HASH_A = "1".repeat(64);
const HASH_B = "2".repeat(64);

const baseEntry = (
  overrides: Partial<CacheBreakEventLogEntry> = {},
): CacheBreakEventLogEntry => ({
  schemaVersion: CACHE_BREAK_EVENTS_LOG_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId: "job-1",
  roleStepId: "test_generation",
  querySource: "judge_primary",
  ts: "2026-05-04T08:00:00.000Z",
  parentHash: HASH_A,
  cacheReadTokens: 12,
  cacheCreationTokens: 200,
  ...overrides,
});

test("buildCacheBreakEventsLog sorts deterministically and dedupes", () => {
  const built = buildCacheBreakEventsLog({
    entries: [
      baseEntry({ ts: "2026-05-04T08:01:00.000Z", parentHash: HASH_B }),
      baseEntry({ ts: "2026-05-04T08:00:00.000Z", parentHash: HASH_A }),
      baseEntry({ ts: "2026-05-04T08:00:00.000Z", parentHash: HASH_A }),
      baseEntry({
        ts: "2026-05-04T08:02:00.000Z",
        parentHash: HASH_A,
        diffArtifactBasename: "0.diff.json",
        suppressionReason: "compaction",
      }),
    ],
  });
  assert.equal(built.entries.length, 3);
  assert.deepEqual(
    built.entries.map((entry) => entry.ts),
    [
      "2026-05-04T08:00:00.000Z",
      "2026-05-04T08:01:00.000Z",
      "2026-05-04T08:02:00.000Z",
    ],
  );
  assert.ok(built.serialized.endsWith("\n"));
  assert.equal(built.serialized.split("\n").length, 4);
});

test("buildCacheBreakEventsLog emits empty payload for empty input", () => {
  const built = buildCacheBreakEventsLog({ entries: [] });
  assert.equal(built.entries.length, 0);
  assert.equal(built.serialized, "");
});

test("isCacheBreakEventLogEntry rejects malformed entries", () => {
  assert.equal(isCacheBreakEventLogEntry(baseEntry()), true);
  assert.equal(
    isCacheBreakEventLogEntry({ ...baseEntry(), schemaVersion: "0.9.0" }),
    false,
  );
  assert.equal(
    isCacheBreakEventLogEntry({ ...baseEntry(), parentHash: "abc" }),
    false,
  );
  assert.equal(
    isCacheBreakEventLogEntry({ ...baseEntry(), cacheReadTokens: -1 }),
    false,
  );
  assert.equal(
    isCacheBreakEventLogEntry({
      ...baseEntry(),
      diffArtifactBasename: "../etc/passwd",
    }),
    false,
  );
  assert.equal(
    isCacheBreakEventLogEntry({
      ...baseEntry(),
      suppressionReason: "not-a-real-reason",
    }),
    false,
  );
});

test("buildCacheBreakEventsLog rejects invalid entries up front", () => {
  assert.throws(
    () =>
      buildCacheBreakEventsLog({
        entries: [{ ...baseEntry(), parentHash: "abc" }],
      }),
    /invalid CacheBreakEventLogEntry/,
  );
});

test("writeCacheBreakEventsLog persists byte-stably and round-trips", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "ti-cache-break-log-"));
  try {
    const entries = [
      baseEntry({ ts: "2026-05-04T08:00:00.000Z", parentHash: HASH_A }),
      baseEntry({ ts: "2026-05-04T08:01:00.000Z", parentHash: HASH_B }),
    ];
    const first = await writeCacheBreakEventsLog({ runDir, entries });
    const second = await writeCacheBreakEventsLog({ runDir, entries });
    assert.equal(first.serialized, second.serialized);
    assert.ok(
      first.artifactPath.endsWith(CACHE_BREAK_EVENTS_LOG_ARTIFACT_FILENAME),
    );
    const onDisk = await readFile(first.artifactPath, "utf8");
    assert.equal(onDisk, first.serialized);
    const parsed = parseCacheBreakEventsLog(onDisk);
    assert.ok(parsed !== undefined);
    assert.equal(parsed!.length, 2);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("parseCacheBreakEventsLog rejects non-trailing-newline payloads", () => {
  const built = buildCacheBreakEventsLog({ entries: [baseEntry()] });
  const trimmed = built.serialized.slice(0, -1);
  assert.equal(parseCacheBreakEventsLog(trimmed), undefined);
});

test("parseCacheBreakEventsLog accepts the empty payload", () => {
  const result = parseCacheBreakEventsLog("");
  assert.ok(result !== undefined);
  assert.equal(result!.length, 0);
});

test("cache-break-events-log: golden line for the canonical example", () => {
  const built = buildCacheBreakEventsLog({
    entries: [
      baseEntry({
        ts: "2026-05-04T08:00:00.000Z",
        parentHash: HASH_A,
        diffArtifactBasename: "0.diff.json",
      }),
    ],
  });
  const golden =
    '{"cacheCreationTokens":200,"cacheReadTokens":12,"contractVersion":"1.6.0",' +
    '"diffArtifactBasename":"0.diff.json","jobId":"job-1","parentHash":"' +
    HASH_A +
    '","querySource":"judge_primary","roleStepId":"test_generation","schemaVersion":"1.0.0",' +
    '"ts":"2026-05-04T08:00:00.000Z"}\n';
  assert.equal(built.serialized, golden);
});
