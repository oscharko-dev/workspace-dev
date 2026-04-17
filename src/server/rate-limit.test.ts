import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFileBackedRateLimitStore } from "./rate-limit-store.js";
import {
  RATE_LIMIT_FALLBACK_CLIENT_KEY,
  createIpRateLimiter,
  normalizeRateLimitClientKey
} from "./rate-limit.js";

test("rate limiter normalizes IPv4-mapped IPv6 addresses and missing client keys", () => {
  assert.equal(normalizeRateLimitClientKey("::ffff:127.0.0.1"), "127.0.0.1");
  assert.equal(normalizeRateLimitClientKey(" 2001:db8::1 "), "2001:db8::1");
  assert.equal(normalizeRateLimitClientKey(undefined), RATE_LIMIT_FALLBACK_CLIENT_KEY);
});

test("rate limiter allows requests up to the configured window budget", async () => {
  let nowMs = 0;
  const limiter = createIpRateLimiter({
    limitPerWindow: 2,
    now: () => nowMs
  });

  assert.deepEqual(await limiter.consume("127.0.0.1"), { allowed: true });
  nowMs = 250;
  assert.deepEqual(await limiter.consume("127.0.0.1"), { allowed: true });
});

test("rate limiter blocks the next request and returns the retry-after delay", async () => {
  let nowMs = 0;
  const limiter = createIpRateLimiter({
    limitPerWindow: 1,
    now: () => nowMs
  });

  assert.deepEqual(await limiter.consume("127.0.0.1"), { allowed: true });

  nowMs = 1;
  const denied = await limiter.consume("127.0.0.1");
  assert.equal(denied.allowed, false);
  if (denied.allowed) {
    assert.fail("Expected rate limiter to reject the second request.");
  }
  assert.equal(denied.retryAfterMs, 59_999);
  assert.equal(denied.retryAfterSeconds, 60);
});

test("rate limiter expires requests after the rolling window elapses", async () => {
  let nowMs = 0;
  const limiter = createIpRateLimiter({
    limitPerWindow: 1,
    now: () => nowMs
  });

  assert.deepEqual(await limiter.consume("127.0.0.1"), { allowed: true });

  nowMs = 60_000;
  assert.deepEqual(await limiter.consume("127.0.0.1"), { allowed: true });
});

test("rate limiter shares the same client budget across multiple submission routes", async () => {
  let nowMs = 0;
  const limiter = createIpRateLimiter({
    limitPerWindow: 1,
    now: () => nowMs
  });

  assert.deepEqual(await limiter.consume("127.0.0.1"), { allowed: true });

  nowMs = 100;
  const denied = await limiter.consume("127.0.0.1");
  assert.equal(denied.allowed, false);
});

test("rate limiter isolates different client IPs", async () => {
  const limiter = createIpRateLimiter({
    limitPerWindow: 1,
    now: () => 0
  });

  assert.deepEqual(await limiter.consume("127.0.0.1"), { allowed: true });
  assert.deepEqual(await limiter.consume("127.0.0.2"), { allowed: true });
});

test("rate limiter isolates scoped budgets for the same client IP", async () => {
  const limiter = createIpRateLimiter({
    limitPerWindow: 1,
    now: () => 0
  });

  assert.deepEqual(await limiter.consume("127.0.0.1", "session-1"), { allowed: true });
  assert.deepEqual(await limiter.consume("127.0.0.1", "session-2"), { allowed: true });
  const denied = await limiter.consume("127.0.0.1", "session-1");
  assert.equal(denied.allowed, false);
});

test("rate limiter can be disabled with a zero limit", async () => {
  const limiter = createIpRateLimiter({
    limitPerWindow: 0,
    now: () => 0
  });

  assert.deepEqual(await limiter.consume("127.0.0.1"), { allowed: true });
  assert.deepEqual(await limiter.consume("127.0.0.1"), { allowed: true });
  assert.deepEqual(await limiter.consume("127.0.0.1"), { allowed: true });
});

test("rate limiter opportunistically cleans up stale client buckets", async () => {
  let nowMs = 0;
  const limiter = createIpRateLimiter({
    limitPerWindow: 1,
    now: () => nowMs
  });

  await limiter.consume("127.0.0.1");
  await limiter.consume("127.0.0.2");
  assert.equal(await limiter.getTrackedClientCount(), 2);

  nowMs = 61_000;
  await limiter.consume("127.0.0.3");
  assert.equal(await limiter.getTrackedClientCount(), 1);
});

test("rate limiter persists active buckets with a file-backed store", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-rate-limit-"));
  let nowMs = 0;

  try {
    const filePath = path.join(rootDir, "rate-limits.json");
    const firstLimiter = createIpRateLimiter({
      limitPerWindow: 1,
      now: () => nowMs,
      store: createFileBackedRateLimitStore({ filePath })
    });

    assert.deepEqual(await firstLimiter.consume("127.0.0.1", "session-1"), { allowed: true });

    nowMs = 1;
    const recreatedLimiter = createIpRateLimiter({
      limitPerWindow: 1,
      now: () => nowMs,
      store: createFileBackedRateLimitStore({ filePath })
    });

    const denied = await recreatedLimiter.consume("127.0.0.1", "session-1");
    assert.equal(denied.allowed, false);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("rate limiter does not reopen budget when persisted buckets are corrupt", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-rate-limit-"));

  try {
    const filePath = path.join(rootDir, "rate-limits.json");
    await writeFile(filePath, "{not-json", "utf8");

    const limiter = createIpRateLimiter({
      limitPerWindow: 1,
      now: () => 0,
      store: createFileBackedRateLimitStore({ filePath })
    });

    await assert.rejects(
      limiter.consume("127.0.0.1", "session-1"),
      /Rate limit store .* unreadable or incompatible: JSON parse failed/
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("rate limiter safely resets persisted buckets when the store schema version changes", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-rate-limit-"));

  try {
    const filePath = path.join(rootDir, "rate-limits.json");
    await writeFile(
      filePath,
      `${JSON.stringify(
        {
          schemaVersion: 999,
          buckets: [
            {
              key: JSON.stringify(["session-1", "127.0.0.1"]),
              timestamps: [0],
              lastSeenAt: 0
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const limiter = createIpRateLimiter({
      limitPerWindow: 1,
      now: () => 1,
      store: createFileBackedRateLimitStore({ filePath })
    });

    assert.deepEqual(await limiter.consume("127.0.0.1", "session-1"), { allowed: true });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("rate limiter does not reopen budget when a persisted bucket entry is malformed", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-rate-limit-"));

  try {
    const filePath = path.join(rootDir, "rate-limits.json");
    await writeFile(
      filePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          buckets: [
            {
              key: JSON.stringify(["session-1", "127.0.0.1"]),
              timestamps: [0],
              lastSeenAt: 0
            },
            {
              key: JSON.stringify(["session-2", "127.0.0.1"]),
              timestamps: ["bad-timestamp"],
              lastSeenAt: 0
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const limiter = createIpRateLimiter({
      limitPerWindow: 1,
      now: () => 1,
      store: createFileBackedRateLimitStore({ filePath })
    });

    await assert.rejects(
      limiter.consume("127.0.0.1", "session-1"),
      /Rate limit store .* unreadable or incompatible: bucket entry at index 1 is invalid/
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
