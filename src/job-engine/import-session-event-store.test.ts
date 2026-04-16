import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CONTRACT_VERSION,
  type WorkspaceImportSessionEvent,
} from "../contracts/index.js";
import { createImportSessionEventStore } from "./import-session-event-store.js";

const makeEvent = (
  overrides: Partial<WorkspaceImportSessionEvent> = {},
): WorkspaceImportSessionEvent => ({
  id: "event-1",
  sessionId: "session-1",
  kind: "imported",
  at: "2026-04-15T10:00:00.000Z",
  ...overrides,
});

const eventFilePath = ({
  rootDir,
  sessionId,
}: {
  rootDir: string;
  sessionId: string;
}): string => path.join(rootDir, "import-session-events", `${sessionId}.json`);

test("import-session-event-store appends events in order and lists oldest-first", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const store = createImportSessionEventStore({ rootDir });
    await store.append(
      makeEvent({ id: "event-a", at: "2026-04-15T10:00:00.000Z" }),
    );
    await store.append(
      makeEvent({
        id: "event-b",
        kind: "review_started",
        at: "2026-04-15T10:05:00.000Z",
      }),
    );
    await store.append(
      makeEvent({
        id: "event-c",
        kind: "approved",
        at: "2026-04-15T10:10:00.000Z",
      }),
    );

    const listed = await store.list("session-1");
    assert.deepEqual(
      listed.map((entry) => entry.id),
      ["event-a", "event-b", "event-c"],
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("import-session-event-store returns empty list when contractVersion mismatches", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const store = createImportSessionEventStore({ rootDir });
    const filePath = eventFilePath({ rootDir, sessionId: "session-1" });
    await store.append(makeEvent());

    const raw = await readFile(filePath, "utf8");
    const rewritten = raw.replace(CONTRACT_VERSION, "0.0.0-legacy");
    await writeFile(filePath, rewritten, "utf8");

    assert.deepEqual(await store.list("session-1"), []);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("import-session-event-store returns empty list when JSON is invalid", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const store = createImportSessionEventStore({ rootDir });
    const filePath = eventFilePath({ rootDir, sessionId: "session-1" });
    await store.append(makeEvent());
    await writeFile(filePath, "{not-json", "utf8");

    assert.deepEqual(await store.list("session-1"), []);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("import-session-event-store filters out individually invalid events", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const store = createImportSessionEventStore({ rootDir });
    const filePath = eventFilePath({ rootDir, sessionId: "session-1" });
    await store.append(
      makeEvent({ id: "event-valid", at: "2026-04-15T10:00:00.000Z" }),
    );

    const envelope = {
      contractVersion: CONTRACT_VERSION,
      sessionId: "session-1",
      events: [
        {
          id: "event-valid",
          sessionId: "session-1",
          kind: "imported",
          at: "2026-04-15T10:00:00.000Z",
        },
        {
          id: "event-missing-kind",
          sessionId: "session-1",
          at: "2026-04-15T10:01:00.000Z",
        },
        {
          id: "event-bad-kind",
          sessionId: "session-1",
          kind: "unknown",
          at: "2026-04-15T10:02:00.000Z",
        },
        {
          id: "event-wrong-session",
          sessionId: "other",
          kind: "imported",
          at: "2026-04-15T10:03:00.000Z",
        },
        {
          id: "event-nested-metadata",
          sessionId: "session-1",
          kind: "imported",
          at: "2026-04-15T10:04:00.000Z",
          metadata: { nested: { inner: true } },
        },
      ],
    };
    await writeFile(filePath, JSON.stringify(envelope), "utf8");

    const listed = await store.list("session-1");
    assert.deepEqual(
      listed.map((entry) => entry.id),
      ["event-valid"],
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("import-session-event-store evicts notes before governance events when the cap is exceeded", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const store = createImportSessionEventStore({
      rootDir,
      maxEventsPerSession: 5,
    });
    await store.append(
      makeEvent({
        id: "event-imported",
        kind: "imported",
        at: "2026-04-15T10:00:00.000Z",
      }),
    );
    await store.append(
      makeEvent({
        id: "event-note-1",
        kind: "note",
        at: "2026-04-15T10:01:00.000Z",
        note: "first note",
      }),
    );
    await store.append(
      makeEvent({
        id: "event-approved",
        kind: "approved",
        at: "2026-04-15T10:02:00.000Z",
      }),
    );
    await store.append(
      makeEvent({
        id: "event-note-2",
        kind: "note",
        at: "2026-04-15T10:03:00.000Z",
        note: "second note",
      }),
    );
    await store.append(
      makeEvent({
        id: "event-applied",
        kind: "applied",
        at: "2026-04-15T10:04:00.000Z",
      }),
    );
    await store.append(
      makeEvent({
        id: "event-note-3",
        kind: "note",
        at: "2026-04-15T10:05:00.000Z",
        note: "third note",
      }),
    );
    await store.append(
      makeEvent({
        id: "event-note-4",
        kind: "note",
        at: "2026-04-15T10:06:00.000Z",
        note: "fourth note",
      }),
    );

    const listed = await store.list("session-1");
    assert.deepEqual(
      listed.map((entry) => entry.id),
      [
        "event-imported",
        "event-approved",
        "event-applied",
        "event-note-3",
        "event-note-4",
      ],
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("import-session-event-store keeps the newest material events when they alone exceed the cap", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const store = createImportSessionEventStore({
      rootDir,
      maxEventsPerSession: 3,
    });
    await store.append(
      makeEvent({
        id: "event-imported",
        kind: "imported",
        at: "2026-04-15T10:00:00.000Z",
      }),
    );
    await store.append(
      makeEvent({
        id: "event-review-started",
        kind: "review_started",
        at: "2026-04-15T10:01:00.000Z",
      }),
    );
    await store.append(
      makeEvent({
        id: "event-approved",
        kind: "approved",
        at: "2026-04-15T10:02:00.000Z",
      }),
    );
    await store.append(
      makeEvent({
        id: "event-applied",
        kind: "applied",
        at: "2026-04-15T10:03:00.000Z",
      }),
    );

    const listed = await store.list("session-1");
    assert.deepEqual(
      listed.map((entry) => entry.id),
      ["event-review-started", "event-approved", "event-applied"],
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("import-session-event-store deleteAllForSession removes the file", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const store = createImportSessionEventStore({ rootDir });
    await store.append(makeEvent());

    const filePath = eventFilePath({ rootDir, sessionId: "session-1" });
    await stat(filePath);

    await store.deleteAllForSession("session-1");
    await assert.rejects(() => stat(filePath));
    assert.deepEqual(await store.list("session-1"), []);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("import-session-event-store rejects sessionIds that attempt path traversal", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const store = createImportSessionEventStore({ rootDir });
    await assert.rejects(() => store.list("../evil"), /forbidden characters/);
    await assert.rejects(() => store.list("a/b"), /forbidden characters/);
    await assert.rejects(
      () => store.append(makeEvent({ sessionId: "\0bad" })),
      /forbidden characters/,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("import-session-event-store truncates notes longer than 1024 characters on write", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const store = createImportSessionEventStore({ rootDir });
    const longNote = "x".repeat(2000);
    await store.append(makeEvent({ note: longNote }));

    const listed = await store.list("session-1");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.note?.length, 1024);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
