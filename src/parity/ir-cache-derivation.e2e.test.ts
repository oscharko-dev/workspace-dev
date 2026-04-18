/**
 * E2E test for content-addressed IR derivation caching.
 *
 * Validates that:
 * 1. IR derivation produces the same result when run twice on the same Figma source
 * 2. Cache hit returns identical IR to fresh derivation
 * 3. Different derivation options produce cache misses
 * 4. Cache correctly expires after TTL
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/315
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { figmaToDesignIrWithOptions } from "./ir.js";
import { fetchParityFigmaFileOnce } from "./live-figma-file.js";
import {
  computeContentHash,
  computeOptionsHash,
  loadCachedIr,
  saveCachedIr
} from "../job-engine/ir-cache.js";

const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "xZkvYk9KOezMsi9LmPEFGX";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";

const skipReason =
  FIGMA_ACCESS_TOKEN.length === 0
    ? "FIGMA_ACCESS_TOKEN not set – skipping IR cache E2E tests"
    : undefined;

const fetchFigmaFileOnce = async (): Promise<unknown> => {
  return await fetchParityFigmaFileOnce({
    fileKey: FIGMA_FILE_KEY,
    accessToken: FIGMA_ACCESS_TOKEN
  });
};

const createTempCacheDir = async (): Promise<string> => {
  return await mkdtemp(path.join(os.tmpdir(), "workspace-dev-ir-cache-e2e-"));
};

// ── Determinism: same input → same IR ───────────────────────────────────────

test("E2E: IR derivation is deterministic for the same Figma source", { skip: skipReason, timeout: 120_000 }, async () => {
  const figmaFile = await fetchFigmaFileOnce();

  const ir1 = figmaToDesignIrWithOptions(figmaFile);
  const ir2 = figmaToDesignIrWithOptions(figmaFile);

  assert.equal(ir1.screens.length, ir2.screens.length, "Screen count must be identical");
  assert.deepStrictEqual(ir1.tokens, ir2.tokens, "Tokens must be identical");
  assert.equal(
    JSON.stringify(ir1.screens),
    JSON.stringify(ir2.screens),
    "Screen JSON must be identical for deterministic derivation"
  );
});

// ── Content hash determinism ────────────────────────────────────────────────

test("E2E: content hash is deterministic for the same Figma source", { skip: skipReason, timeout: 120_000 }, async () => {
  const figmaFile = await fetchFigmaFileOnce();

  const hash1 = computeContentHash(figmaFile);
  const hash2 = computeContentHash(figmaFile);

  assert.equal(hash1, hash2, "Content hash must be deterministic");
  assert.equal(hash1.length, 64);
});

// ── Cache round-trip with real Figma data ───────────────────────────────────

test("E2E: save + load IR cache produces identical IR", { skip: skipReason, timeout: 120_000 }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const cacheDir = await createTempCacheDir();
  const logs: string[] = [];
  const onLog = (msg: string): void => { logs.push(msg); };

  const ir = figmaToDesignIrWithOptions(figmaFile);
  const contentHash = computeContentHash(figmaFile);
  const optionsHash = computeOptionsHash({ screenElementBudget: 1200, screenElementMaxDepth: 14, brandTheme: "derived" });

  await saveCachedIr({ cacheDir, contentHash, optionsHash, ttlMs: 60_000, ir, onLog });
  assert.ok(logs.some((l) => l.includes("cache write completed")), "Expected cache write log");

  const loaded = await loadCachedIr({ cacheDir, contentHash, optionsHash, ttlMs: 60_000, onLog });
  assert.ok(loaded, "Expected cache hit");
  assert.equal(loaded.screens.length, ir.screens.length, "Screen count must match");
  assert.deepStrictEqual(loaded.tokens, ir.tokens, "Tokens must match");
  assert.equal(
    JSON.stringify(loaded.screens),
    JSON.stringify(ir.screens),
    "Cached screen JSON must match original"
  );
});

// ── Cache miss on different options ─────────────────────────────────────────

test("E2E: different derivation options produce cache miss", { skip: skipReason, timeout: 120_000 }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const cacheDir = await createTempCacheDir();
  const onLog = (): void => {};

  const ir = figmaToDesignIrWithOptions(figmaFile);
  const contentHash = computeContentHash(figmaFile);
  const optionsHash1 = computeOptionsHash({ screenElementBudget: 1200, brandTheme: "derived" });
  const optionsHash2 = computeOptionsHash({ screenElementBudget: 500, brandTheme: "sparkasse" });

  await saveCachedIr({ cacheDir, contentHash, optionsHash: optionsHash1, ttlMs: 60_000, ir, onLog });

  const loaded = await loadCachedIr({ cacheDir, contentHash, optionsHash: optionsHash2, ttlMs: 60_000, onLog });
  assert.equal(loaded, undefined, "Expected cache miss for different options");
});

test("E2E: different Sparkasse token sources produce cache miss", { skip: skipReason, timeout: 120_000 }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const cacheDir = await createTempCacheDir();
  const onLog = (): void => {};

  const ir = figmaToDesignIrWithOptions(figmaFile);
  const contentHash = computeContentHash(figmaFile);
  const optionsHash1 = computeOptionsHash({
    screenElementBudget: 1200,
    brandTheme: "sparkasse",
    sparkasseTokensFilePath: "/tmp/sparkasse-a.json"
  });
  const optionsHash2 = computeOptionsHash({
    screenElementBudget: 1200,
    brandTheme: "sparkasse",
    sparkasseTokensFilePath: "/tmp/sparkasse-b.json"
  });

  await saveCachedIr({ cacheDir, contentHash, optionsHash: optionsHash1, ttlMs: 60_000, ir, onLog });

  const loaded = await loadCachedIr({ cacheDir, contentHash, optionsHash: optionsHash2, ttlMs: 60_000, onLog });
  assert.equal(loaded, undefined, "Expected cache miss for different Sparkasse token sources");
});

// ── Cache expiry ────────────────────────────────────────────────────────────

test("E2E: expired cache entry is not returned", { skip: skipReason, timeout: 120_000 }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const cacheDir = await createTempCacheDir();
  const onLog = (): void => {};

  const ir = figmaToDesignIrWithOptions(figmaFile);
  const contentHash = computeContentHash(figmaFile);
  const optionsHash = computeOptionsHash({ screenElementBudget: 1200, brandTheme: "derived" });

  // Save with a very short TTL that has already expired
  await saveCachedIr({ cacheDir, contentHash, optionsHash, ttlMs: 1, ir, onLog });

  // Wait a tiny bit to ensure expiry
  await new Promise((resolve) => setTimeout(resolve, 10));

  const loaded = await loadCachedIr({ cacheDir, contentHash, optionsHash, ttlMs: 1, onLog });
  assert.equal(loaded, undefined, "Expected cache miss for expired entry");
});

// ── Performance: cache hit is faster than fresh derivation ──────────────────

test("E2E: cache hit skips derivation and is faster", { skip: skipReason, timeout: 120_000 }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const cacheDir = await createTempCacheDir();
  const onLog = (): void => {};

  // Time fresh derivation
  const t0 = performance.now();
  const ir = figmaToDesignIrWithOptions(figmaFile);
  const derivationMs = performance.now() - t0;

  const contentHash = computeContentHash(figmaFile);
  const optionsHash = computeOptionsHash({ screenElementBudget: 1200, brandTheme: "derived" });
  await saveCachedIr({ cacheDir, contentHash, optionsHash, ttlMs: 60_000, ir, onLog });

  // Time cache load
  const t1 = performance.now();
  const loaded = await loadCachedIr({ cacheDir, contentHash, optionsHash, ttlMs: 60_000, onLog });
  const cacheMs = performance.now() - t1;

  assert.ok(loaded, "Expected cache hit");
  assert.ok(
    cacheMs < derivationMs,
    `Cache load (${Math.round(cacheMs)}ms) should be faster than derivation (${Math.round(derivationMs)}ms)`
  );
});
