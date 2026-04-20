import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { createIpRateLimiter } from "./rate-limit.js";

interface GeneratedRateLimitEvent {
  deltaMs: number;
  scopeKey?: string;
}

const scopeKeyArb = fc.constantFrom<string | undefined>(
  undefined,
  "session-1",
  "session-2",
);

const rateLimitCaseArb = fc.record({
  limitPerWindow: fc.integer({ min: 1, max: 5 }),
  windowMs: fc.integer({ min: 1, max: 500 }),
  events: fc.array(
    fc.record({
      deltaMs: fc.integer({ min: 0, max: 500 }),
      scopeKey: scopeKeyArb,
    }),
    { minLength: 1, maxLength: 40 },
  ),
});

const pruneExpiredTimestamps = ({
  timestamps,
  nowMs,
  windowMs,
}: {
  timestamps: number[];
  nowMs: number;
  windowMs: number;
}): number[] => {
  return timestamps.filter((timestamp) => nowMs - timestamp < windowMs);
};

test("fuzz: rate limiter matches the rolling-window budget model for arbitrary arrival patterns", async () => {
  await fc.assert(
    fc.asyncProperty(rateLimitCaseArb, async ({ limitPerWindow, windowMs, events }) => {
      let nowMs = 0;
      const limiter = createIpRateLimiter({
        limitPerWindow,
        windowMs,
        now: () => nowMs,
      });
      const allowedTimestampsByScope = new Map<string, number[]>();

      for (const event of events as GeneratedRateLimitEvent[]) {
        nowMs += event.deltaMs;

        const scopeId = event.scopeKey ?? "__default__";
        const activeTimestamps = pruneExpiredTimestamps({
          timestamps: allowedTimestampsByScope.get(scopeId) ?? [],
          nowMs,
          windowMs,
        });
        const result = await limiter.consume("127.0.0.1", event.scopeKey);

        if (activeTimestamps.length >= limitPerWindow) {
          assert.equal(
            result.allowed,
            false,
            `Expected request at ${nowMs}ms to be denied for scope ${scopeId}`,
          );
          if (result.allowed) {
            continue;
          }

          const oldestTimestamp = activeTimestamps[0] ?? nowMs;
          const expectedRetryAfterMs = Math.max(
            1,
            windowMs - (nowMs - oldestTimestamp),
          );

          assert.equal(result.retryAfterMs, expectedRetryAfterMs);
          assert.equal(
            result.retryAfterSeconds,
            Math.ceil(expectedRetryAfterMs / 1000),
          );
          allowedTimestampsByScope.set(scopeId, activeTimestamps);
          continue;
        }

        assert.deepEqual(
          result,
          { allowed: true },
          `Expected request at ${nowMs}ms to be allowed for scope ${scopeId}`,
        );
        activeTimestamps.push(nowMs);
        assert.ok(activeTimestamps.length <= limitPerWindow);
        allowedTimestampsByScope.set(scopeId, activeTimestamps);
      }
    }),
    { numRuns: 100 },
  );
});
