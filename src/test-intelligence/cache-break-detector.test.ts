/**
 * CacheBreakDetector unit + integration tests (Issue #1778).
 *
 * Covers:
 *   - Heuristic fires only when both thresholds breach
 *     (`cacheReadTokens < 0.05 * expected` AND `cacheCreationTokens > 2_000`).
 *   - First call has no `prevSnapshot` and never fires.
 *   - Suppression APIs (`notifyCompaction` / `notifyCacheDeletion`) consume
 *     the next break for the matching `jobId` without producing event/diff.
 *   - LRU caps at the configured snapshot count.
 *   - AT-031 equivalent: a deliberate `[stable_prefix]` reorder between
 *     two judge iterations triggers a `cache_break` event AND writes a
 *     redacted diff artifact.
 *   - Diff artifact is canonical-JSON, redacts secrets, strips zero-width
 *     prompt-injection chars, never persists raw content for spans that
 *     trip the redaction.
 */

import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CACHE_BREAK_ARTIFACT_DIRECTORY,
  CACHE_BREAK_DIFF_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
} from "../contracts/index.js";
import {
  createCacheBreakDetector,
  type CacheBreakSnapshot,
} from "./cache-break-detector.js";
import {
  createRunnerEventBus,
  type ProductionRunnerEvent,
} from "./production-runner-events.js";

interface Harness {
  readonly runDir: string;
  readonly cleanup: () => Promise<void>;
  readonly captured: ProductionRunnerEvent[];
  readonly clock: { current: number };
  readonly detector: ReturnType<typeof createCacheBreakDetector>;
}

const buildHarness = async (
  overrides: { maxSnapshots?: number } = {},
): Promise<Harness> => {
  const runDir = await mkdtemp(join(tmpdir(), "cache-break-"));
  const bus = createRunnerEventBus();
  const captured: ProductionRunnerEvent[] = [];
  bus.subscribe("job-1", (event) => captured.push(event));
  bus.subscribe("job-2", (event) => captured.push(event));
  const clock = { current: 1_700_000_000_000 };
  const detector = createCacheBreakDetector({
    bus,
    runDir,
    clock: () => {
      clock.current += 1;
      return clock.current;
    },
    ...(overrides.maxSnapshots !== undefined
      ? { maxSnapshots: overrides.maxSnapshots }
      : {}),
  });
  return {
    runDir,
    cleanup: () => rm(runDir, { recursive: true, force: true }),
    captured,
    clock,
    detector,
  };
};

const baseRecord = {
  jobId: "job-1",
  roleStepId: "judge:1",
  toolsHash: "tools-v1",
  ts: 1,
  querySource: "judge-pass-1",
  expectedCacheReadTokens: 10_000,
  parentHash: "parent-A",
};

test("recordPromptState returns no previous on first call for a querySource", async () => {
  const h = await buildHarness();
  try {
    const result = h.detector.recordPromptState({
      ...baseRecord,
      messages: [{ role: "user", content: "hello" }],
      systemPrompt: "you are helpful",
    });
    assert.equal(result.previous, undefined);
    assert.equal(result.snapshot.querySource, "judge-pass-1");
    assert.equal(result.snapshot.parentHash, "parent-A");
    assert.equal(typeof result.snapshot.messagesHash, "string");
    assert.equal(result.snapshot.messagesHash.length, 64);
  } finally {
    await h.cleanup();
  }
});

test("recordPromptState returns previous snapshot on second call for same querySource", async () => {
  const h = await buildHarness();
  try {
    const a = h.detector.recordPromptState({
      ...baseRecord,
      messages: [{ role: "user", content: "first" }],
      systemPrompt: "v1",
    });
    const b = h.detector.recordPromptState({
      ...baseRecord,
      ts: 2,
      messages: [{ role: "user", content: "second" }],
      systemPrompt: "v2",
    });
    assert.deepEqual(b.previous, a.snapshot);
    assert.notEqual(b.snapshot.systemPromptHash, a.snapshot.systemPromptHash);
  } finally {
    await h.cleanup();
  }
});

test("checkResponseForCacheBreak does nothing without a previous snapshot", async () => {
  const h = await buildHarness();
  try {
    const a = h.detector.recordPromptState({
      ...baseRecord,
      messages: [{ role: "user", content: "x" }],
      systemPrompt: "p",
    });
    const outcome = await h.detector.checkResponseForCacheBreak({
      cacheReadTokens: 0,
      cacheCreationTokens: 50_000,
      prevSnapshot: a.previous,
      currentSnapshot: a.snapshot,
    });
    assert.equal(outcome.fired, false);
    assert.equal(h.captured.length, 0);
  } finally {
    await h.cleanup();
  }
});

test("checkResponseForCacheBreak does NOT fire when read ratio is healthy", async () => {
  const h = await buildHarness();
  try {
    h.detector.recordPromptState({
      ...baseRecord,
      messages: [{ role: "user", content: "v1" }],
      systemPrompt: "stable",
    });
    const second = h.detector.recordPromptState({
      ...baseRecord,
      ts: 2,
      messages: [{ role: "user", content: "v2" }],
      systemPrompt: "stable",
    });
    const outcome = await h.detector.checkResponseForCacheBreak({
      cacheReadTokens: 9_500, // 95% of expected — healthy.
      cacheCreationTokens: 5_000,
      prevSnapshot: second.previous,
      currentSnapshot: second.snapshot,
    });
    assert.equal(outcome.fired, false);
    assert.equal(h.captured.length, 0);
  } finally {
    await h.cleanup();
  }
});

test("checkResponseForCacheBreak does NOT fire when cacheCreationTokens is below the floor", async () => {
  const h = await buildHarness();
  try {
    h.detector.recordPromptState({
      ...baseRecord,
      messages: [{ role: "user", content: "v1" }],
      systemPrompt: "stable",
    });
    const second = h.detector.recordPromptState({
      ...baseRecord,
      ts: 2,
      messages: [{ role: "user", content: "v2" }],
      systemPrompt: "stable",
    });
    const outcome = await h.detector.checkResponseForCacheBreak({
      cacheReadTokens: 0,
      cacheCreationTokens: 1_500, // below 2_000 floor.
      prevSnapshot: second.previous,
      currentSnapshot: second.snapshot,
    });
    assert.equal(outcome.fired, false);
    assert.equal(h.captured.length, 0);
  } finally {
    await h.cleanup();
  }
});

test("checkResponseForCacheBreak fires when both thresholds breach", async () => {
  const h = await buildHarness();
  try {
    h.detector.recordPromptState({
      ...baseRecord,
      messages: [{ role: "user", content: "v1" }],
      systemPrompt: "stable",
    });
    const second = h.detector.recordPromptState({
      ...baseRecord,
      ts: 2,
      parentHash: "parent-B",
      messages: [{ role: "user", content: "v2" }],
      systemPrompt: "stable but reordered",
    });
    const outcome = await h.detector.checkResponseForCacheBreak({
      cacheReadTokens: 100, // 1% of expected — breach.
      cacheCreationTokens: 50_000, // > 2_000 — breach.
      prevSnapshot: second.previous,
      currentSnapshot: second.snapshot,
    });
    assert.equal(outcome.fired, true);
    assert.equal(h.captured.length, 1);
    const event = h.captured[0]!;
    assert.equal(event.phase, "cache_break");
    assert.equal(event.details?.["jobId"], "job-1");
    assert.equal(event.details?.["parentHash"], "parent-B");
    assert.equal(event.details?.["querySource"], "judge-pass-1");
    assert.ok(typeof outcome.artifactPath === "string");
  } finally {
    await h.cleanup();
  }
});

test("notifyCompaction suppresses exactly one subsequent break for the same jobId", async () => {
  const h = await buildHarness();
  try {
    h.detector.recordPromptState({
      ...baseRecord,
      messages: [{ role: "user", content: "v1" }],
      systemPrompt: "stable",
    });
    const second = h.detector.recordPromptState({
      ...baseRecord,
      ts: 2,
      messages: [{ role: "user", content: "v2" }],
      systemPrompt: "stable",
    });
    h.detector.notifyCompaction("job-1", "context-window-90pct");
    const outcome = await h.detector.checkResponseForCacheBreak({
      cacheReadTokens: 0,
      cacheCreationTokens: 50_000,
      prevSnapshot: second.previous,
      currentSnapshot: second.snapshot,
    });
    assert.equal(outcome.fired, false);
    assert.deepEqual(outcome.suppressed, { reason: "compaction" });
    assert.equal(h.captured.length, 0);
    // Artifact dir must not exist when suppressed.
    await assert.rejects(
      readdir(join(h.runDir, CACHE_BREAK_ARTIFACT_DIRECTORY)),
    );
  } finally {
    await h.cleanup();
  }
});

test("notifyCacheDeletion suppression is one-shot — next break fires normally", async () => {
  const h = await buildHarness();
  try {
    h.detector.recordPromptState({
      ...baseRecord,
      messages: [{ role: "user", content: "v1" }],
      systemPrompt: "stable",
    });
    const second = h.detector.recordPromptState({
      ...baseRecord,
      ts: 2,
      messages: [{ role: "user", content: "v2" }],
      systemPrompt: "stable",
    });
    h.detector.notifyCacheDeletion("job-1", "operator-reset");
    const suppressed = await h.detector.checkResponseForCacheBreak({
      cacheReadTokens: 0,
      cacheCreationTokens: 50_000,
      prevSnapshot: second.previous,
      currentSnapshot: second.snapshot,
    });
    assert.equal(suppressed.fired, false);
    assert.deepEqual(suppressed.suppressed, { reason: "cache_deletion" });

    // Record a third turn and verify the next break is NOT suppressed.
    const third = h.detector.recordPromptState({
      ...baseRecord,
      ts: 3,
      messages: [{ role: "user", content: "v3" }],
      systemPrompt: "stable",
    });
    const fired = await h.detector.checkResponseForCacheBreak({
      cacheReadTokens: 0,
      cacheCreationTokens: 50_000,
      prevSnapshot: third.previous,
      currentSnapshot: third.snapshot,
    });
    assert.equal(fired.fired, true);
    assert.equal(h.captured.length, 1);
  } finally {
    await h.cleanup();
  }
});

test("LRU caps at the configured snapshot count", async () => {
  const h = await buildHarness({ maxSnapshots: 3 });
  try {
    for (let i = 0; i < 5; i += 1) {
      h.detector.recordPromptState({
        ...baseRecord,
        querySource: `q-${i}`,
        ts: i,
        messages: [{ role: "user", content: `m-${i}` }],
        systemPrompt: "p",
      });
    }
    assert.equal(h.detector.snapshotCount(), 3);
  } finally {
    await h.cleanup();
  }
});

test("recording the same querySource twice keeps LRU size at 1", async () => {
  const h = await buildHarness({ maxSnapshots: 2 });
  try {
    h.detector.recordPromptState({
      ...baseRecord,
      messages: [{ role: "user", content: "v1" }],
      systemPrompt: "p",
    });
    h.detector.recordPromptState({
      ...baseRecord,
      ts: 2,
      messages: [{ role: "user", content: "v2" }],
      systemPrompt: "p",
    });
    assert.equal(h.detector.snapshotCount(), 1);
  } finally {
    await h.cleanup();
  }
});

test("AT-031: stable-prefix reorder between two iterations triggers cache_break + redacted diff artifact", async () => {
  const h = await buildHarness();
  try {
    // Iteration 1 — judge sees rules in canonical order.
    const first = h.detector.recordPromptState({
      jobId: "job-1",
      roleStepId: "judge:1",
      toolsHash: "tools-v1",
      ts: 1,
      querySource: "judge-rubric",
      expectedCacheReadTokens: 12_000,
      parentHash: "parent-iter-1",
      systemPrompt:
        "[stable_prefix]\n- rule-a: prefer specificity\n- rule-b: cite evidence\n- rule-c: refuse on ambiguity",
      messages: [
        { role: "user", content: "score test case T-1 against the rubric" },
      ],
    });
    assert.equal(first.previous, undefined);

    // Iteration 2 — same content, but the stable-prefix rules were
    // reordered between calls (rule-b now first), busting the cache.
    const second = h.detector.recordPromptState({
      jobId: "job-1",
      roleStepId: "judge:2",
      toolsHash: "tools-v1",
      ts: 2,
      querySource: "judge-rubric",
      expectedCacheReadTokens: 12_000,
      parentHash: "parent-iter-2",
      systemPrompt:
        "[stable_prefix]\n- rule-b: cite evidence\n- rule-a: prefer specificity\n- rule-c: refuse on ambiguity",
      messages: [
        { role: "user", content: "score test case T-1 against the rubric" },
      ],
    });

    const outcome = await h.detector.checkResponseForCacheBreak({
      cacheReadTokens: 0, // observed read collapsed.
      cacheCreationTokens: 11_500, // observed creation took the hit.
      prevSnapshot: second.previous,
      currentSnapshot: second.snapshot,
    });

    assert.equal(outcome.fired, true);
    assert.equal(h.captured.length, 1);
    const event = h.captured[0]!;
    assert.equal(event.phase, "cache_break");
    assert.equal(event.details?.["jobId"], "job-1");
    assert.equal(event.details?.["roleStepId"], "judge:2");
    assert.equal(event.details?.["parentHash"], "parent-iter-2");
    assert.equal(event.details?.["querySource"], "judge-rubric");

    // Artifact: canonical-JSON, schema versions present, and crucially
    // the `redactedDiff.systemPrompt.{previous,current}` show that the
    // ONLY change between the two iterations is the rule reordering —
    // and the unchanged rule (`rule-c`) text is present verbatim
    // (because nothing in the body matches a secret pattern; secrets
    // are only redacted, content is not stripped).
    assert.ok(typeof outcome.artifactPath === "string");
    const raw = await readFile(outcome.artifactPath!, "utf8");
    const artifact = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(artifact["schemaVersion"], CACHE_BREAK_DIFF_SCHEMA_VERSION);
    assert.equal(
      artifact["contractVersion"],
      TEST_INTELLIGENCE_CONTRACT_VERSION,
    );
    assert.equal(artifact["jobId"], "job-1");
    assert.equal(artifact["parentHash"], "parent-iter-2");
    const redacted = artifact["redactedDiff"] as Record<string, unknown>;
    const sp = redacted["systemPrompt"] as Record<string, unknown>;
    assert.match(String(sp["previous"]), /rule-a: prefer specificity/);
    assert.match(String(sp["current"]), /rule-b: cite evidence/);
    // Trailing newline preserved by canonicalJson + writer.
    assert.equal(raw.endsWith("\n"), true);
  } finally {
    await h.cleanup();
  }
});

test("diff artifact redacts high-risk secrets pasted into a prompt body", async () => {
  const h = await buildHarness();
  try {
    h.detector.recordPromptState({
      ...baseRecord,
      messages: [{ role: "user", content: "before paste" }],
      systemPrompt: "stable",
    });
    const second = h.detector.recordPromptState({
      ...baseRecord,
      ts: 2,
      messages: [
        {
          role: "user",
          content:
            "after paste — Authorization: Bearer ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA tail",
        },
      ],
      systemPrompt: "stable",
    });
    const outcome = await h.detector.checkResponseForCacheBreak({
      cacheReadTokens: 0,
      cacheCreationTokens: 50_000,
      prevSnapshot: second.previous,
      currentSnapshot: second.snapshot,
    });
    assert.equal(outcome.fired, true);
    const raw = await readFile(outcome.artifactPath!, "utf8");
    assert.equal(
      raw.includes("ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
      false,
    );
    assert.ok(raw.includes("[REDACTED:SECRET]"));
  } finally {
    await h.cleanup();
  }
});

test("diff artifact strips zero-width prompt-injection chars before persistence", async () => {
  const h = await buildHarness();
  try {
    h.detector.recordPromptState({
      ...baseRecord,
      messages: [{ role: "user", content: "first" }],
      systemPrompt: "stable",
    });
    const ZWSP = "​";
    const second = h.detector.recordPromptState({
      ...baseRecord,
      ts: 2,
      messages: [
        { role: "user", content: `payload${ZWSP}with${ZWSP}zero-width chars` },
      ],
      systemPrompt: "stable",
    });
    const outcome = await h.detector.checkResponseForCacheBreak({
      cacheReadTokens: 0,
      cacheCreationTokens: 50_000,
      prevSnapshot: second.previous,
      currentSnapshot: second.snapshot,
    });
    assert.equal(outcome.fired, true);
    const raw = await readFile(outcome.artifactPath!, "utf8");
    assert.equal(raw.includes(ZWSP), false);
    assert.match(raw, /payloadwithzero-width chars/);
  } finally {
    await h.cleanup();
  }
});

test("diff artifact filename uses the detector clock's millisecond timestamp", async () => {
  const h = await buildHarness();
  try {
    h.detector.recordPromptState({
      ...baseRecord,
      messages: [{ role: "user", content: "v1" }],
      systemPrompt: "stable",
    });
    const second = h.detector.recordPromptState({
      ...baseRecord,
      ts: 2,
      messages: [{ role: "user", content: "v2" }],
      systemPrompt: "stable",
    });
    const outcome = await h.detector.checkResponseForCacheBreak({
      cacheReadTokens: 0,
      cacheCreationTokens: 50_000,
      prevSnapshot: second.previous,
      currentSnapshot: second.snapshot,
    });
    assert.ok(outcome.artifactPath);
    const dir = join(h.runDir, CACHE_BREAK_ARTIFACT_DIRECTORY);
    const entries = await readdir(dir);
    assert.equal(entries.length, 1);
    assert.match(entries[0]!, /^\d+\.diff\.json$/);
  } finally {
    await h.cleanup();
  }
});

test("`cache_break` is in PRODUCTION_RUNNER_EVENT_PHASES", async () => {
  const mod = await import("./production-runner-events.js");
  assert.ok(
    (mod.PRODUCTION_RUNNER_EVENT_PHASES as readonly string[]).includes(
      "cache_break",
    ),
  );
});

test("recordPromptState validates required string + numeric fields", async () => {
  const h = await buildHarness();
  try {
    const bad: Partial<Parameters<typeof h.detector.recordPromptState>[0]> = {
      ...baseRecord,
      messages: [],
      systemPrompt: "p",
    };
    assert.throws(() =>
      h.detector.recordPromptState({
        ...(bad as Parameters<typeof h.detector.recordPromptState>[0]),
        jobId: "",
      }),
    );
    assert.throws(() =>
      h.detector.recordPromptState({
        ...(bad as Parameters<typeof h.detector.recordPromptState>[0]),
        parentHash: "",
      }),
    );
    assert.throws(() =>
      h.detector.recordPromptState({
        ...(bad as Parameters<typeof h.detector.recordPromptState>[0]),
        expectedCacheReadTokens: -1,
      }),
    );
  } finally {
    await h.cleanup();
  }
});

test("checkResponseForCacheBreak rejects non-finite or negative token counts", async () => {
  const h = await buildHarness();
  try {
    const a = h.detector.recordPromptState({
      ...baseRecord,
      messages: [{ role: "user", content: "x" }],
      systemPrompt: "p",
    });
    const stub: CacheBreakSnapshot = a.snapshot;
    await assert.rejects(
      h.detector.checkResponseForCacheBreak({
        cacheReadTokens: Number.NaN,
        cacheCreationTokens: 1,
        prevSnapshot: stub,
        currentSnapshot: stub,
      }),
    );
    await assert.rejects(
      h.detector.checkResponseForCacheBreak({
        cacheReadTokens: 1,
        cacheCreationTokens: -1,
        prevSnapshot: stub,
        currentSnapshot: stub,
      }),
    );
  } finally {
    await h.cleanup();
  }
});
