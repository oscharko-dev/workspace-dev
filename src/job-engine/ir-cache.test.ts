import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile, mkdir, rm, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  computeContentHash,
  computeOptionsHash,
  loadCachedIr,
  saveCachedIr
} from "./ir-cache.js";
import type { IrCacheEntry } from "./ir-cache.js";
import type { DesignIR } from "../parity/types.js";

const createTempDir = async (): Promise<string> => {
  return await mkdtemp(path.join(os.tmpdir(), "workspace-dev-ir-cache-"));
};

const createMinimalIr = (screenCount = 1): DesignIR => {
  const screens = Array.from({ length: screenCount }, (_, index) => ({
    id: `screen-${index}`,
    name: `Screen ${index}`,
    layoutMode: "VERTICAL" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: []
  }));
  return {
    sourceName: "Test File",
    screens,
    tokens: {
      palette: {
        primary: "#1976d2",
        secondary: "#9c27b0",
        background: "#ffffff",
        surface: "#f5f5f5",
        text: "#212121",
        success: "#4caf50",
        warning: "#ff9800",
        error: "#f44336",
        info: "#2196f3"
      },
      borderRadius: 4,
      spacingBase: 8,
      fontFamily: "Roboto, sans-serif",
      headingSize: 24,
      bodySize: 14,
      typography: {}
    }
  } as DesignIR;
};

const logs: string[] = [];
const onLog = (message: string): void => {
  logs.push(message);
};
const clearLogs = (): void => {
  logs.length = 0;
};

// ── computeContentHash ──────────────────────────────────────────────────────

test("computeContentHash returns deterministic hex string", () => {
  const input = { name: "Test", document: { id: "0:0", type: "DOCUMENT" } };
  const hash1 = computeContentHash(input);
  const hash2 = computeContentHash(input);
  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 64);
  assert.match(hash1, /^[a-f0-9]{64}$/);
});

test("computeContentHash is key-order independent", () => {
  const a = { name: "Test", document: { id: "0:0", type: "DOCUMENT" } };
  const b = { document: { type: "DOCUMENT", id: "0:0" }, name: "Test" };
  assert.equal(computeContentHash(a), computeContentHash(b));
});

test("computeContentHash differs for different content", () => {
  const a = { name: "File A" };
  const b = { name: "File B" };
  assert.notEqual(computeContentHash(a), computeContentHash(b));
});

// ── computeOptionsHash ──────────────────────────────────────────────────────

test("computeOptionsHash returns deterministic hex string", () => {
  const hash = computeOptionsHash({ screenElementBudget: 1200, screenElementMaxDepth: 14, brandTheme: "derived" });
  assert.equal(hash.length, 64);
  assert.match(hash, /^[a-f0-9]{64}$/);
});

test("computeOptionsHash differs for different options", () => {
  const a = computeOptionsHash({ screenElementBudget: 1200, brandTheme: "derived" });
  const b = computeOptionsHash({ screenElementBudget: 500, brandTheme: "sparkasse" });
  assert.notEqual(a, b);
});

test("computeOptionsHash differs for different Sparkasse token sources", () => {
  const a = computeOptionsHash({
    screenElementBudget: 1200,
    brandTheme: "sparkasse",
    sparkasseTokensFilePath: "/tmp/sparkasse-a.json"
  });
  const b = computeOptionsHash({
    screenElementBudget: 1200,
    brandTheme: "sparkasse",
    sparkasseTokensFilePath: "/tmp/sparkasse-b.json"
  });
  assert.notEqual(a, b);
});

// ── loadCachedIr ────────────────────────────────────────────────────────────

test("loadCachedIr returns undefined for missing cache file", async () => {
  clearLogs();
  const cacheDir = await createTempDir();
  const result = await loadCachedIr({
    cacheDir,
    contentHash: "abc123".padEnd(64, "0"),
    optionsHash: "def456".padEnd(64, "0"),
    ttlMs: 60_000,
    onLog
  });
  assert.equal(result, undefined);
  assert.ok(logs.some((log) => log.includes("operation=loadCachedIr.read")));
});

test("loadCachedIr returns undefined for corrupt JSON", async () => {
  clearLogs();
  const cacheDir = await createTempDir();
  const contentHash = "a".repeat(64);
  const optionsHash = "b".repeat(64);
  const filePath = path.join(cacheDir, `ir-${contentHash.slice(0, 16)}-${optionsHash.slice(0, 8)}.json`);
  await writeFile(filePath, "not json", "utf8");

  const result = await loadCachedIr({ cacheDir, contentHash, optionsHash, ttlMs: 60_000, onLog });
  assert.equal(result, undefined);
  assert.ok(logs.some((log) => log.includes("corrupt")));
});

test("loadCachedIr returns undefined for expired entry", async () => {
  clearLogs();
  const cacheDir = await createTempDir();
  const contentHash = "c".repeat(64);
  const optionsHash = "d".repeat(64);
  const filePath = path.join(cacheDir, `ir-${contentHash.slice(0, 16)}-${optionsHash.slice(0, 8)}.json`);
  const entry: IrCacheEntry = {
    version: 1,
    contentHash,
    cachedAt: Date.now() - 120_000,
    ttlMs: 60_000,
    optionsHash,
    ir: createMinimalIr()
  };
  await writeFile(filePath, JSON.stringify(entry), "utf8");

  const result = await loadCachedIr({ cacheDir, contentHash, optionsHash, ttlMs: 60_000, onLog });
  assert.equal(result, undefined);
  assert.ok(logs.some((log) => log.includes("expired")));
});

test("loadCachedIr returns undefined for version mismatch", async () => {
  clearLogs();
  const cacheDir = await createTempDir();
  const contentHash = "e".repeat(64);
  const optionsHash = "f".repeat(64);
  const filePath = path.join(cacheDir, `ir-${contentHash.slice(0, 16)}-${optionsHash.slice(0, 8)}.json`);
  const entry = {
    version: 999,
    contentHash,
    cachedAt: Date.now(),
    ttlMs: 60_000,
    optionsHash,
    ir: createMinimalIr()
  };
  await writeFile(filePath, JSON.stringify(entry), "utf8");

  const result = await loadCachedIr({ cacheDir, contentHash, optionsHash, ttlMs: 60_000, onLog });
  assert.equal(result, undefined);
  assert.ok(logs.some((log) => log.includes("version mismatch")));
});

test("loadCachedIr rejects invalid entry structures and mismatched hashes", async () => {
  clearLogs();
  const cacheDir = await createTempDir();
  const contentHash = "7".repeat(64);
  const optionsHash = "8".repeat(64);
  const cacheFilePath = path.join(cacheDir, `ir-${contentHash.slice(0, 16)}-${optionsHash.slice(0, 8)}.json`);

  await writeFile(cacheFilePath, JSON.stringify({ version: 1, contentHash, cachedAt: Date.now() }), "utf8");
  assert.equal(await loadCachedIr({ cacheDir, contentHash, optionsHash, ttlMs: 60_000, onLog }), undefined);
  assert.ok(logs.some((log) => log.includes("invalid entry structure")));

  clearLogs();
  await writeFile(
    cacheFilePath,
    JSON.stringify({
      version: 1,
      contentHash: "9".repeat(64),
      cachedAt: Date.now(),
      ttlMs: 60_000,
      optionsHash,
      ir: createMinimalIr()
    }),
    "utf8"
  );
  assert.equal(await loadCachedIr({ cacheDir, contentHash, optionsHash, ttlMs: 60_000, onLog }), undefined);
  assert.ok(logs.some((log) => log.includes("content hash mismatch")));

  clearLogs();
  await writeFile(
    cacheFilePath,
    JSON.stringify({
      version: 1,
      contentHash,
      cachedAt: Date.now(),
      ttlMs: 60_000,
      optionsHash: "a".repeat(64),
      ir: createMinimalIr()
    }),
    "utf8"
  );
  assert.equal(await loadCachedIr({ cacheDir, contentHash, optionsHash, ttlMs: 60_000, onLog }), undefined);
  assert.ok(logs.some((log) => log.includes("options hash mismatch")));
});

test("loadCachedIr rejects entries whose cached IR is structurally invalid", async () => {
  clearLogs();
  const cacheDir = await createTempDir();
  const contentHash = "b".repeat(64);
  const optionsHash = "c".repeat(64);
  const filePath = path.join(cacheDir, `ir-${contentHash.slice(0, 16)}-${optionsHash.slice(0, 8)}.json`);

  await writeFile(
    filePath,
    JSON.stringify({
      version: 1,
      contentHash,
      cachedAt: Date.now(),
      ttlMs: 60_000,
      optionsHash,
      ir: { sourceName: "Broken", screens: [] }
    }),
    "utf8"
  );

  const result = await loadCachedIr({ cacheDir, contentHash, optionsHash, ttlMs: 60_000, onLog });
  assert.equal(result, undefined);
  assert.ok(logs.some((log) => log.includes("invalid structure")));
});

test("loadCachedIr returns cached IR on valid hit", async () => {
  clearLogs();
  const cacheDir = await createTempDir();
  const contentHash = "1".repeat(64);
  const optionsHash = "2".repeat(64);
  const filePath = path.join(cacheDir, `ir-${contentHash.slice(0, 16)}-${optionsHash.slice(0, 8)}.json`);
  const ir = createMinimalIr(3);
  const entry: IrCacheEntry = {
    version: 1,
    contentHash,
    cachedAt: Date.now() - 5_000,
    ttlMs: 60_000,
    optionsHash,
    ir
  };
  await writeFile(filePath, JSON.stringify(entry), "utf8");

  const result = await loadCachedIr({ cacheDir, contentHash, optionsHash, ttlMs: 60_000, onLog });
  assert.ok(result);
  assert.equal(result.screens.length, 3);
  assert.equal(result.sourceName, "Test File");
  assert.ok(logs.some((log) => log.includes("cache hit")));
});

// ── saveCachedIr ────────────────────────────────────────────────────────────

test("saveCachedIr writes cache entry that can be loaded back", async () => {
  clearLogs();
  const cacheDir = await createTempDir();
  const figmaJson = { name: "Test Save", document: { id: "0:0", type: "DOCUMENT" } };
  const contentHash = computeContentHash(figmaJson);
  const options = { screenElementBudget: 1200, screenElementMaxDepth: 14, brandTheme: "derived" };
  const optionsHash = computeOptionsHash(options);
  const ir = createMinimalIr(2);
  const ttlMs = 60_000;

  await saveCachedIr({ cacheDir, contentHash, optionsHash, ttlMs, ir, onLog });
  assert.ok(logs.some((log) => log.includes("cache write completed")));

  clearLogs();
  const loaded = await loadCachedIr({ cacheDir, contentHash, optionsHash, ttlMs, onLog });
  assert.ok(loaded);
  assert.equal(loaded.screens.length, 2);
  assert.ok(logs.some((log) => log.includes("cache hit")));
});

test("saveCachedIr leaves no .tmp file after successful write", async () => {
  clearLogs();
  const cacheDir = await createTempDir();
  const contentHash = computeContentHash({ name: "Atomic" });
  const optionsHash = computeOptionsHash({ screenElementBudget: 800, brandTheme: "derived" });
  const ir = createMinimalIr();

  await saveCachedIr({ cacheDir, contentHash, optionsHash, ttlMs: 60_000, ir, onLog });

  const entries = await readdir(cacheDir);
  assert.equal(entries.some((name) => name.endsWith(".tmp")), false);
  assert.ok(entries.some((name) => name.endsWith(".json")));
});

test("saveCachedIr creates cache directory if missing", async () => {
  clearLogs();
  const tmpDir = await createTempDir();
  const cacheDir = path.join(tmpDir, "nested", "ir-cache");
  const contentHash = "3".repeat(64);
  const optionsHash = "4".repeat(64);
  const ir = createMinimalIr();

  await saveCachedIr({ cacheDir, contentHash, optionsHash, ttlMs: 60_000, ir, onLog });
  const entries = await readdir(cacheDir);
  assert.ok(entries.length > 0);
});

test("saveCachedIr logs write failures without throwing", async () => {
  clearLogs();
  const tempRoot = await createTempDir();
  const blockedPath = path.join(tempRoot, "blocked");
  await writeFile(blockedPath, "not a directory\n", "utf8");

  try {
    await saveCachedIr({
      cacheDir: path.join(blockedPath, "nested"),
      contentHash: "d".repeat(64),
      optionsHash: "e".repeat(64),
      ttlMs: 60_000,
      ir: createMinimalIr(),
      onLog
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  assert.ok(logs.some((log) => log.includes("IR cache write failed")));
});

test("saveCachedIr evicts stale entries once the cache exceeds the max size", async () => {
  clearLogs();
  const cacheDir = await createTempDir();
  const staleTime = new Date(Date.now() - 2 * 60_000);

  try {
    for (let index = 0; index < 55; index += 1) {
      const contentHash = `${index.toString(16).padStart(2, "0")}`.repeat(32);
      const optionsHash = `${(index + 100).toString(16).padStart(2, "0")}`.repeat(32);
      const filePath = path.join(cacheDir, `ir-${contentHash.slice(0, 16)}-${optionsHash.slice(0, 8)}.json`);
      await writeFile(
        filePath,
        JSON.stringify({
          version: 1,
          contentHash,
          cachedAt: staleTime.getTime(),
          ttlMs: 1_000,
          optionsHash,
          ir: createMinimalIr()
        }),
        "utf8"
      );
      await utimes(filePath, staleTime, staleTime);
    }

    await saveCachedIr({
      cacheDir,
      contentHash: "f".repeat(64),
      optionsHash: "0".repeat(64),
      ttlMs: 1_000,
      ir: createMinimalIr(),
      onLog
    });

    const entries = (await readdir(cacheDir)).filter((entry) => entry.endsWith(".json"));
    assert.equal(entries.length <= 50, true);
    assert.ok(logs.some((log) => log.includes("IR cache eviction: removed")));
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

// ── Round-trip: save + load ─────────────────────────────────────────────────

test("round-trip: changed content hash produces cache miss", async () => {
  clearLogs();
  const cacheDir = await createTempDir();
  const optionsHash = "5".repeat(64);
  const ir = createMinimalIr();

  const hash1 = computeContentHash({ name: "Original" });
  await saveCachedIr({ cacheDir, contentHash: hash1, optionsHash, ttlMs: 60_000, ir, onLog });

  clearLogs();
  const hash2 = computeContentHash({ name: "Modified" });
  const loaded = await loadCachedIr({ cacheDir, contentHash: hash2, optionsHash, ttlMs: 60_000, onLog });
  assert.equal(loaded, undefined);
});

test("round-trip: changed options hash produces cache miss", async () => {
  clearLogs();
  const cacheDir = await createTempDir();
  const contentHash = "6".repeat(64);
  const ir = createMinimalIr();

  const opts1 = computeOptionsHash({ screenElementBudget: 1200, brandTheme: "derived" });
  await saveCachedIr({ cacheDir, contentHash, optionsHash: opts1, ttlMs: 60_000, ir, onLog });

  clearLogs();
  const opts2 = computeOptionsHash({ screenElementBudget: 500, brandTheme: "sparkasse" });
  const loaded = await loadCachedIr({ cacheDir, contentHash, optionsHash: opts2, ttlMs: 60_000, onLog });
  assert.equal(loaded, undefined);
});

// ── Runtime settings ────────────────────────────────────────────────────────

test("resolveRuntimeSettings includes IR cache defaults", async () => {
  const { resolveRuntimeSettings } = await import("./runtime.js");
  const runtime = resolveRuntimeSettings({});
  assert.equal(runtime.irCacheEnabled, true);
  assert.equal(runtime.irCacheTtlMs, 60 * 60_000);
});

test("resolveRuntimeSettings allows disabling IR cache", async () => {
  const { resolveRuntimeSettings } = await import("./runtime.js");
  const runtime = resolveRuntimeSettings({ irCacheEnabled: false, irCacheTtlMs: 5_000 });
  assert.equal(runtime.irCacheEnabled, false);
  assert.equal(runtime.irCacheTtlMs, 5_000);
});

test("resolveRuntimeSettings clamps IR cache TTL", async () => {
  const { resolveRuntimeSettings } = await import("./runtime.js");
  const runtime = resolveRuntimeSettings({ irCacheTtlMs: 999_999_999 });
  assert.equal(runtime.irCacheTtlMs, 24 * 60 * 60_000);
});
