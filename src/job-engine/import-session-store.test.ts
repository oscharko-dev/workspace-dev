import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import type { WorkspaceImportSession } from "../contracts/index.js";
import { createImportSessionStore } from "./import-session-store.js";

const makeSession = (
  overrides: Partial<WorkspaceImportSession> = {},
): WorkspaceImportSession => ({
  id: "session-1",
  jobId: "job-1",
  sourceMode: "figma_url",
  fileKey: "FILE",
  nodeId: "1:2",
  nodeName: "Home",
  importedAt: "2026-04-15T10:00:00.000Z",
  nodeCount: 5,
  fileCount: 2,
  selectedNodes: [],
  scope: "all",
  componentMappings: 1,
  pasteIdentityKey: null,
  replayable: true,
  ...overrides,
});

test("import-session-store saves newest-first and enforces FIFO retention", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-sessions-"),
  );
  try {
    const store = createImportSessionStore({ rootDir, maxEntries: 2 });
    await store.save(
      makeSession({
        id: "session-older",
        importedAt: "2026-04-15T09:00:00.000Z",
      }),
    );
    await store.save(
      makeSession({
        id: "session-middle",
        importedAt: "2026-04-15T10:00:00.000Z",
      }),
    );
    await store.save(
      makeSession({
        id: "session-newest",
        importedAt: "2026-04-15T11:00:00.000Z",
      }),
    );

    assert.deepEqual(
      (await store.list()).map((session) => session.id),
      ["session-newest", "session-middle"],
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("import-session-store matches by paste identity key, then locator, then file key", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-sessions-"),
  );
  try {
    const store = createImportSessionStore({ rootDir });
    await store.save(
      makeSession({
        id: "session-file-only",
        fileKey: "FILE-ONLY",
        nodeId: "",
        pasteIdentityKey: null,
      }),
    );
    await store.save(
      makeSession({
        id: "session-locator",
        fileKey: "FILE",
        nodeId: "1:2",
        pasteIdentityKey: null,
      }),
    );
    await store.save(
      makeSession({
        id: "session-paste",
        fileKey: "FILE",
        nodeId: "1:2",
        pasteIdentityKey: "paste-123",
      }),
    );

    assert.equal(
      (
        await store.findMatching({
          pasteIdentityKey: "paste-123",
          fileKey: "FILE",
          nodeId: "1:2",
        })
      )?.id,
      "session-paste",
    );
    assert.equal(
      (
        await store.findMatching({
          fileKey: "FILE",
          nodeId: "1:2",
        })
      )?.id,
      "session-paste",
    );
    assert.equal(
      (
        await store.findMatching({
          fileKey: "FILE-ONLY",
        })
      )?.id,
      "session-file-only",
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("import-session-store keeps legacy sessions without governance fields and round-trips new ones", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-sessions-"),
  );
  try {
    const store = createImportSessionStore({ rootDir });
    const legacy = makeSession({ id: "session-legacy" });
    await store.save(legacy);

    const reloaded = await store.list();
    assert.equal(reloaded.length, 1);
    assert.equal(reloaded[0]?.qualityScore, undefined);
    assert.equal(reloaded[0]?.status, undefined);
    assert.equal(reloaded[0]?.reviewRequired, undefined);

    const reviewed = makeSession({
      id: "session-reviewed",
      importedAt: "2026-04-15T11:00:00.000Z",
      qualityScore: 87,
      status: "reviewing",
      reviewRequired: true,
    });
    await store.save(reviewed);

    const after = await store.list();
    const found = after.find((entry) => entry.id === "session-reviewed");
    assert.equal(found?.qualityScore, 87);
    assert.equal(found?.status, "reviewing");
    assert.equal(found?.reviewRequired, true);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("import-session-store rejects sessions with invalid governance fields", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-sessions-"),
  );
  try {
    const store = createImportSessionStore({ rootDir });
    const invalid = {
      ...makeSession({ id: "session-bad-score" }),
      qualityScore: 105,
    } as WorkspaceImportSession;
    await store.save(invalid);

    assert.deepEqual(await store.list(), []);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("import-session-store deletes stored sessions and returns the removed entry", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-sessions-"),
  );
  try {
    const store = createImportSessionStore({ rootDir });
    await store.save(makeSession());

    const removed = await store.delete("session-1");
    assert.equal(removed?.id, "session-1");
    assert.deepEqual(await store.list(), []);
    assert.equal(await store.delete("missing-session"), undefined);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
