import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  computePasteIdentityKey,
  createPasteFingerprintStore
} from "./paste-fingerprint-store.js";
import type { PasteFingerprintManifest } from "./paste-fingerprint-store.js";
import { CONTRACT_VERSION } from "../contracts/index.js";

const createTempDir = async (): Promise<string> => {
  return await mkdtemp(path.join(os.tmpdir(), "workspace-dev-paste-fingerprint-"));
};

const createManifest = (overrides: Partial<PasteFingerprintManifest> = {}): PasteFingerprintManifest => {
  const rootNodeIds = overrides.rootNodeIds ?? ["1:2"];
  const figmaFileKey = overrides.figmaFileKey ?? "file-key-1";
  const identityKey = overrides.pasteIdentityKey ?? computePasteIdentityKey({ figmaFileKey, rootNodeIds });
  const base: PasteFingerprintManifest = {
    contractVersion: overrides.contractVersion ?? CONTRACT_VERSION,
    pasteIdentityKey: identityKey,
    createdAt: overrides.createdAt ?? new Date("2026-01-01T00:00:00.000Z").toISOString(),
    rootNodeIds,
    nodes: overrides.nodes ?? [
      { id: "1:2", type: "FRAME", parentId: null, subtreeHash: "abc123", depth: 0 },
      { id: "1:3", type: "TEXT", parentId: "1:2", subtreeHash: "def456", depth: 1 }
    ],
    figmaFileKey
  };
  if (overrides.sourceJobId !== undefined) {
    return { ...base, sourceJobId: overrides.sourceJobId };
  }
  return base;
};

// ── computePasteIdentityKey ────────────────────────────────────────────────

test("computePasteIdentityKey is stable for identical inputs", () => {
  const a = computePasteIdentityKey({ figmaFileKey: "file-a", rootNodeIds: ["1:2", "1:3"] });
  const b = computePasteIdentityKey({ figmaFileKey: "file-a", rootNodeIds: ["1:2", "1:3"] });
  assert.equal(a, b);
  assert.equal(a.length, 32);
  assert.match(a, /^[a-f0-9]{32}$/);
});

test("computePasteIdentityKey is order-independent for rootNodeIds", () => {
  const a = computePasteIdentityKey({ figmaFileKey: "file-a", rootNodeIds: ["1:2", "1:3", "1:4"] });
  const b = computePasteIdentityKey({ figmaFileKey: "file-a", rootNodeIds: ["1:4", "1:2", "1:3"] });
  assert.equal(a, b);
});

test("computePasteIdentityKey deduplicates rootNodeIds", () => {
  const a = computePasteIdentityKey({ figmaFileKey: "file-a", rootNodeIds: ["1:2", "1:3"] });
  const b = computePasteIdentityKey({ figmaFileKey: "file-a", rootNodeIds: ["1:2", "1:3", "1:2"] });
  assert.equal(a, b);
});

test("computePasteIdentityKey throws on empty rootNodeIds", () => {
  assert.throws(
    () => computePasteIdentityKey({ figmaFileKey: "file-a", rootNodeIds: [] }),
    /rootNodeIds cannot be empty/
  );
});

test("computePasteIdentityKey differs when figmaFileKey differs", () => {
  const a = computePasteIdentityKey({ figmaFileKey: "file-a", rootNodeIds: ["1:2"] });
  const b = computePasteIdentityKey({ figmaFileKey: "file-b", rootNodeIds: ["1:2"] });
  assert.notEqual(a, b);
});

test("computePasteIdentityKey differs when figmaFileKey is omitted vs provided", () => {
  const a = computePasteIdentityKey({ figmaFileKey: "file-a", rootNodeIds: ["1:2"] });
  const b = computePasteIdentityKey({ rootNodeIds: ["1:2"] });
  assert.notEqual(a, b);
});

// ── save + load round-trip ─────────────────────────────────────────────────

test("save then load round-trips a manifest", async () => {
  const rootDir = await createTempDir();
  const store = createPasteFingerprintStore({ rootDir });
  const manifest = createManifest();

  await store.save(manifest);
  const loaded = await store.load(manifest.pasteIdentityKey);

  assert.ok(loaded);
  assert.equal(loaded.pasteIdentityKey, manifest.pasteIdentityKey);
  assert.equal(loaded.contractVersion, CONTRACT_VERSION);
  assert.equal(loaded.nodes.length, 2);
  assert.deepEqual(loaded.rootNodeIds, ["1:2"]);
  assert.equal(loaded.figmaFileKey, "file-key-1");
});

test("load returns undefined for missing identity", async () => {
  const rootDir = await createTempDir();
  const store = createPasteFingerprintStore({ rootDir });
  const result = await store.load("ffffffffffffffffffffffffffffffff");
  assert.equal(result, undefined);
});

// ── TTL expiry ─────────────────────────────────────────────────────────────

test("load returns undefined and deletes file for expired entry", async () => {
  const rootDir = await createTempDir();
  let nowMs = 1_000_000;
  const store = createPasteFingerprintStore({
    rootDir,
    ttlMs: 1000,
    now: () => nowMs
  });
  const manifest = createManifest();

  await store.save(manifest);
  assert.equal(await store.size(), 1);

  // Backdate file mtime to simulate a stale entry.
  const filePath = path.join(rootDir, `${manifest.pasteIdentityKey}.json`);
  const staleTime = new Date(nowMs - 10_000);
  await utimes(filePath, staleTime, staleTime);

  const result = await store.load(manifest.pasteIdentityKey);
  assert.equal(result, undefined);

  const entries = (await readdir(rootDir)).filter((name) => name.endsWith(".json"));
  assert.equal(entries.length, 0);
});

// ── Corrupt JSON ───────────────────────────────────────────────────────────

test("load returns undefined for corrupt JSON on disk", async () => {
  const rootDir = await createTempDir();
  const store = createPasteFingerprintStore({ rootDir });
  const identityKey = "00000000000000000000000000000001";
  const filePath = path.join(rootDir, `${identityKey}.json`);
  await writeFile(filePath, "{ this is not valid json", "utf8");

  const result = await store.load(identityKey);
  assert.equal(result, undefined);
});

test("load returns undefined for structurally invalid manifest", async () => {
  const rootDir = await createTempDir();
  const store = createPasteFingerprintStore({ rootDir });
  const identityKey = "00000000000000000000000000000002";
  const filePath = path.join(rootDir, `${identityKey}.json`);
  await writeFile(filePath, JSON.stringify({ unexpected: "shape" }), "utf8");

  const result = await store.load(identityKey);
  assert.equal(result, undefined);
});

test("load returns undefined for contract version mismatch", async () => {
  const rootDir = await createTempDir();
  const store = createPasteFingerprintStore({ rootDir });
  const manifest = createManifest({ contractVersion: "0.0.0-mismatch" });
  const filePath = path.join(rootDir, `${manifest.pasteIdentityKey}.json`);
  await writeFile(filePath, JSON.stringify(manifest), "utf8");

  const result = await store.load(manifest.pasteIdentityKey);
  assert.equal(result, undefined);
});

// ── maxEntries eviction ────────────────────────────────────────────────────

test("save enforces maxEntries by deleting oldest-mtime entries", async () => {
  const rootDir = await createTempDir();
  const store = createPasteFingerprintStore({ rootDir, maxEntries: 2 });

  const m1 = createManifest({ rootNodeIds: ["1:2"], figmaFileKey: "file-1" });
  await store.save(m1);
  // Backdate first entry so it is clearly the oldest.
  const f1 = path.join(rootDir, `${m1.pasteIdentityKey}.json`);
  const oldTime = new Date(Date.now() - 60_000);
  await utimes(f1, oldTime, oldTime);

  const m2 = createManifest({ rootNodeIds: ["1:3"], figmaFileKey: "file-2" });
  await store.save(m2);
  const f2 = path.join(rootDir, `${m2.pasteIdentityKey}.json`);
  const midTime = new Date(Date.now() - 30_000);
  await utimes(f2, midTime, midTime);

  const m3 = createManifest({ rootNodeIds: ["1:4"], figmaFileKey: "file-3" });
  await store.save(m3);

  const entries = (await readdir(rootDir)).filter((name) => name.endsWith(".json"));
  assert.equal(entries.length, 2);
  assert.ok(!entries.includes(`${m1.pasteIdentityKey}.json`));
  assert.ok(entries.includes(`${m2.pasteIdentityKey}.json`));
  assert.ok(entries.includes(`${m3.pasteIdentityKey}.json`));
});

// ── delete ─────────────────────────────────────────────────────────────────

test("delete removes file and is idempotent when called again", async () => {
  const rootDir = await createTempDir();
  const store = createPasteFingerprintStore({ rootDir });
  const manifest = createManifest();

  await store.save(manifest);
  assert.equal(await store.size(), 1);

  await store.delete(manifest.pasteIdentityKey);
  assert.equal(await store.size(), 0);

  // Calling again must not throw.
  await store.delete(manifest.pasteIdentityKey);
  assert.equal(await store.size(), 0);
});

// ── LRU touch on access ────────────────────────────────────────────────────

test("load updates mtime to now on hit", async () => {
  const rootDir = await createTempDir();
  let nowMs = 2_000_000_000_000;
  const store = createPasteFingerprintStore({
    rootDir,
    ttlMs: 1_000_000,
    now: () => nowMs
  });
  const manifest = createManifest();
  await store.save(manifest);

  const filePath = path.join(rootDir, `${manifest.pasteIdentityKey}.json`);
  // Backdate mtime but keep it within TTL.
  const backdated = new Date(nowMs - 100_000);
  await utimes(filePath, backdated, backdated);
  const mtimeBefore = (await stat(filePath)).mtimeMs;

  // Advance the injected clock so "now" is clearly later than the backdated mtime.
  nowMs += 50_000;
  const loaded = await store.load(manifest.pasteIdentityKey);
  assert.ok(loaded);

  const mtimeAfter = (await stat(filePath)).mtimeMs;
  assert.ok(
    mtimeAfter > mtimeBefore,
    `expected mtime to advance after load (before=${mtimeBefore}, after=${mtimeAfter})`
  );
});

// ── Re-save replaces existing file contents ────────────────────────────────

test("re-saving replaces existing file contents fully", async () => {
  const rootDir = await createTempDir();
  const store = createPasteFingerprintStore({ rootDir });
  const first = createManifest({
    nodes: [{ id: "1:2", type: "FRAME", parentId: null, subtreeHash: "hash-original", depth: 0 }]
  });
  await store.save(first);

  const filePath = path.join(rootDir, `${first.pasteIdentityKey}.json`);
  const initialContent = await readFile(filePath, "utf8");
  assert.match(initialContent, /hash-original/);

  const replacement: PasteFingerprintManifest = {
    ...first,
    nodes: [{ id: "1:2", type: "FRAME", parentId: null, subtreeHash: "hash-replaced", depth: 0 }]
  };
  await store.save(replacement);

  const finalContent = await readFile(filePath, "utf8");
  assert.doesNotMatch(finalContent, /hash-original/);
  assert.match(finalContent, /hash-replaced/);

  const loaded = await store.load(first.pasteIdentityKey);
  assert.ok(loaded);
  assert.equal(loaded.nodes.length, 1);
  assert.equal(loaded.nodes[0]?.subtreeHash, "hash-replaced");
});
