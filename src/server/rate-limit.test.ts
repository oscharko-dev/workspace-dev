import assert from "node:assert/strict";
import test from "node:test";
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

test("rate limiter allows requests up to the configured window budget", () => {
  let nowMs = 0;
  const limiter = createIpRateLimiter({
    limitPerWindow: 2,
    now: () => nowMs
  });

  assert.deepEqual(limiter.consume("127.0.0.1"), { allowed: true });
  nowMs = 250;
  assert.deepEqual(limiter.consume("127.0.0.1"), { allowed: true });
});

test("rate limiter blocks the next request and returns the retry-after delay", () => {
  let nowMs = 0;
  const limiter = createIpRateLimiter({
    limitPerWindow: 1,
    now: () => nowMs
  });

  assert.deepEqual(limiter.consume("127.0.0.1"), { allowed: true });

  nowMs = 1;
  const denied = limiter.consume("127.0.0.1");
  assert.equal(denied.allowed, false);
  if (denied.allowed) {
    assert.fail("Expected rate limiter to reject the second request.");
  }
  assert.equal(denied.retryAfterMs, 59_999);
  assert.equal(denied.retryAfterSeconds, 60);
});

test("rate limiter expires requests after the rolling window elapses", () => {
  let nowMs = 0;
  const limiter = createIpRateLimiter({
    limitPerWindow: 1,
    now: () => nowMs
  });

  assert.deepEqual(limiter.consume("127.0.0.1"), { allowed: true });

  nowMs = 60_000;
  assert.deepEqual(limiter.consume("127.0.0.1"), { allowed: true });
});

test("rate limiter shares the same client budget across multiple submission routes", () => {
  let nowMs = 0;
  const limiter = createIpRateLimiter({
    limitPerWindow: 1,
    now: () => nowMs
  });

  assert.deepEqual(limiter.consume("127.0.0.1"), { allowed: true });

  nowMs = 100;
  const denied = limiter.consume("127.0.0.1");
  assert.equal(denied.allowed, false);
});

test("rate limiter isolates different client IPs", () => {
  const limiter = createIpRateLimiter({
    limitPerWindow: 1,
    now: () => 0
  });

  assert.deepEqual(limiter.consume("127.0.0.1"), { allowed: true });
  assert.deepEqual(limiter.consume("127.0.0.2"), { allowed: true });
});

test("rate limiter can be disabled with a zero limit", () => {
  const limiter = createIpRateLimiter({
    limitPerWindow: 0,
    now: () => 0
  });

  assert.deepEqual(limiter.consume("127.0.0.1"), { allowed: true });
  assert.deepEqual(limiter.consume("127.0.0.1"), { allowed: true });
  assert.deepEqual(limiter.consume("127.0.0.1"), { allowed: true });
});

test("rate limiter opportunistically cleans up stale client buckets", () => {
  let nowMs = 0;
  const limiter = createIpRateLimiter({
    limitPerWindow: 1,
    now: () => nowMs
  });

  limiter.consume("127.0.0.1");
  limiter.consume("127.0.0.2");
  assert.equal(limiter.getTrackedClientCount(), 2);

  nowMs = 61_000;
  limiter.consume("127.0.0.3");
  assert.equal(limiter.getTrackedClientCount(), 1);
});
