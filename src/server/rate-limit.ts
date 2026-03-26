import type { IncomingMessage } from "node:http";
import { DEFAULT_RATE_LIMIT_PER_MINUTE, RATE_LIMIT_WINDOW_MS } from "./constants.js";

export const RATE_LIMIT_FALLBACK_CLIENT_KEY = "unknown-client";

interface RateLimitBucket {
  timestamps: number[];
  lastSeenAt: number;
}

interface RateLimitAllowed {
  allowed: true;
}

interface RateLimitDenied {
  allowed: false;
  retryAfterMs: number;
  retryAfterSeconds: number;
}

export type RateLimitResult = RateLimitAllowed | RateLimitDenied;

export interface IpRateLimiter {
  consume: (clientKey: string) => RateLimitResult;
  getTrackedClientCount: () => number;
}

const pruneExpiredTimestamps = ({
  timestamps,
  nowMs,
  windowMs
}: {
  timestamps: number[];
  nowMs: number;
  windowMs: number;
}): number[] => {
  return timestamps.filter((timestamp) => nowMs - timestamp < windowMs);
};

export const normalizeRateLimitClientKey = (remoteAddress: string | undefined): string => {
  if (!remoteAddress || remoteAddress.trim().length === 0) {
    return RATE_LIMIT_FALLBACK_CLIENT_KEY;
  }

  const normalized = remoteAddress.trim().toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return normalized.slice("::ffff:".length);
  }

  return normalized;
};

export const resolveRateLimitClientKey = (request: IncomingMessage): string => {
  return normalizeRateLimitClientKey(request.socket.remoteAddress);
};

export const createIpRateLimiter = ({
  limitPerWindow = DEFAULT_RATE_LIMIT_PER_MINUTE,
  windowMs = RATE_LIMIT_WINDOW_MS,
  now = () => Date.now()
}: {
  limitPerWindow?: number;
  windowMs?: number;
  now?: () => number;
} = {}): IpRateLimiter => {
  const buckets = new Map<string, RateLimitBucket>();

  const cleanupExpiredBuckets = (nowMs: number): void => {
    for (const [clientKey, bucket] of buckets) {
      const activeTimestamps = pruneExpiredTimestamps({
        timestamps: bucket.timestamps,
        nowMs,
        windowMs
      });

      if (activeTimestamps.length === 0 && nowMs - bucket.lastSeenAt >= windowMs) {
        buckets.delete(clientKey);
        continue;
      }

      if (activeTimestamps.length !== bucket.timestamps.length) {
        buckets.set(clientKey, {
          timestamps: activeTimestamps,
          lastSeenAt: bucket.lastSeenAt
        });
      }
    }
  };

  return {
    consume: (clientKey: string): RateLimitResult => {
      if (limitPerWindow <= 0) {
        return { allowed: true };
      }

      const nowMs = now();
      const normalizedClientKey = normalizeRateLimitClientKey(clientKey);
      cleanupExpiredBuckets(nowMs);

      const bucket = buckets.get(normalizedClientKey);
      const activeTimestamps = pruneExpiredTimestamps({
        timestamps: bucket?.timestamps ?? [],
        nowMs,
        windowMs
      });

      if (activeTimestamps.length >= limitPerWindow) {
        const oldestTimestamp = activeTimestamps[0] ?? nowMs;
        const retryAfterMs = Math.max(1, windowMs - (nowMs - oldestTimestamp));

        buckets.set(normalizedClientKey, {
          timestamps: activeTimestamps,
          lastSeenAt: nowMs
        });

        return {
          allowed: false,
          retryAfterMs,
          retryAfterSeconds: Math.ceil(retryAfterMs / 1000)
        };
      }

      activeTimestamps.push(nowMs);
      buckets.set(normalizedClientKey, {
        timestamps: activeTimestamps,
        lastSeenAt: nowMs
      });

      return { allowed: true };
    },
    getTrackedClientCount: (): number => {
      return buckets.size;
    }
  };
};
