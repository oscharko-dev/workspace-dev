import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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

// ---------------------------------------------------------------------------
// Monotonic sequence counter
// ---------------------------------------------------------------------------

test("monotonic sequence: the first appended event gets sequence 0", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const store = createImportSessionEventStore({ rootDir });
    await store.append(makeEvent({ id: "event-first" }));

    const listed = await store.list("session-1");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.sequence, 0);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("monotonic sequence: the second appended event gets sequence 1", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const store = createImportSessionEventStore({ rootDir });
    await store.append(makeEvent({ id: "event-a" }));
    await store.append(
      makeEvent({
        id: "event-b",
        kind: "review_started",
        at: "2026-04-15T10:01:00.000Z",
      }),
    );

    const listed = await store.list("session-1");
    assert.deepEqual(
      listed.map((entry) => entry.sequence),
      [0, 1],
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("monotonic sequence: sequential appends produce strictly increasing sequences", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const store = createImportSessionEventStore({ rootDir });
    const totalAppends = 7;
    for (let index = 0; index < totalAppends; index += 1) {
      await store.append(
        makeEvent({
          id: `event-${index}`,
          kind: "note",
          note: `note-${index}`,
          at: `2026-04-15T10:${String(index).padStart(2, "0")}:00.000Z`,
        }),
      );
    }

    const listed = await store.list("session-1");
    assert.equal(listed.length, totalAppends);
    for (let index = 0; index < listed.length - 1; index += 1) {
      const current = listed[index]?.sequence;
      const next = listed[index + 1]?.sequence;
      assert.ok(
        typeof current === "number" && typeof next === "number",
        `sequences must be numbers, got ${String(current)} and ${String(next)}`,
      );
      assert.ok(
        next > current,
        `expected strictly increasing sequences, got [${current}, ${next}]`,
      );
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("monotonic sequence: persists across store instances over the same rootDir", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const firstStore = createImportSessionEventStore({ rootDir });
    await firstStore.append(makeEvent({ id: "event-a" }));
    await firstStore.append(
      makeEvent({
        id: "event-b",
        kind: "approved",
        at: "2026-04-15T10:01:00.000Z",
      }),
    );

    const secondStore = createImportSessionEventStore({ rootDir });
    await secondStore.append(
      makeEvent({
        id: "event-c",
        kind: "applied",
        at: "2026-04-15T10:02:00.000Z",
      }),
    );

    const listed = await secondStore.list("session-1");
    assert.deepEqual(
      listed.map((entry) => ({ id: entry.id, sequence: entry.sequence })),
      [
        { id: "event-a", sequence: 0 },
        { id: "event-b", sequence: 1 },
        { id: "event-c", sequence: 2 },
      ],
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("monotonic sequence: envelope nextSequence field tracks highest+1 after write", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const store = createImportSessionEventStore({ rootDir });
    await store.append(makeEvent({ id: "event-a" }));
    await store.append(
      makeEvent({
        id: "event-b",
        kind: "review_started",
        at: "2026-04-15T10:01:00.000Z",
      }),
    );

    const raw = await readFile(
      eventFilePath({ rootDir, sessionId: "session-1" }),
      "utf8",
    );
    const envelope = JSON.parse(raw) as { nextSequence: unknown };
    assert.equal(envelope.nextSequence, 2);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Concurrent appends
// ---------------------------------------------------------------------------

test("concurrent append: parallel writes to the same session persist all events", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const store = createImportSessionEventStore({ rootDir });
    const parallelCount = 10;
    const appends = Array.from({ length: parallelCount }, (_, index) =>
      store.append(
        makeEvent({
          id: `parallel-${index}`,
          kind: "note",
          note: `note-${index}`,
          at: "2026-04-15T10:00:00.000Z",
        }),
      ),
    );
    await Promise.all(appends);

    const listed = await store.list("session-1");
    assert.equal(
      listed.length,
      parallelCount,
      "all concurrent appends must be persisted",
    );
    const seenIds = new Set(listed.map((entry) => entry.id));
    for (let index = 0; index < parallelCount; index += 1) {
      assert.ok(
        seenIds.has(`parallel-${index}`),
        `event 'parallel-${index}' was lost during concurrent append`,
      );
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("concurrent append: parallel writes assign unique, contiguous sequences", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const store = createImportSessionEventStore({ rootDir });
    const parallelCount = 12;
    const appends = Array.from({ length: parallelCount }, (_, index) =>
      store.append(
        makeEvent({
          id: `parallel-${index}`,
          kind: "note",
          note: `note-${index}`,
          at: "2026-04-15T10:00:00.000Z",
        }),
      ),
    );
    await Promise.all(appends);

    const listed = await store.list("session-1");
    const sequences = listed
      .map((entry) => entry.sequence)
      .filter((value): value is number => typeof value === "number");
    assert.equal(sequences.length, parallelCount);
    assert.equal(
      new Set(sequences).size,
      parallelCount,
      "each concurrent append must get a unique sequence number",
    );
    const sorted = [...sequences].sort((left, right) => left - right);
    assert.deepEqual(
      sorted,
      Array.from({ length: parallelCount }, (_, index) => index),
      "sequences should be contiguous 0..N-1",
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("concurrent append: listed order is consistent with sequence order after parallel writes", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const store = createImportSessionEventStore({ rootDir });
    const parallelCount = 8;
    await Promise.all(
      Array.from({ length: parallelCount }, (_, index) =>
        store.append(
          makeEvent({
            id: `parallel-${index}`,
            kind: "note",
            note: `note-${index}`,
            at: "2026-04-15T10:00:00.000Z",
          }),
        ),
      ),
    );

    const listed = await store.list("session-1");
    for (let index = 0; index < listed.length - 1; index += 1) {
      const current = listed[index]?.sequence;
      const next = listed[index + 1]?.sequence;
      assert.ok(
        typeof current === "number" && typeof next === "number",
        "concurrent events must carry numeric sequences",
      );
      assert.ok(
        current < next,
        `listed order must follow sequence order, got [${current}, ${next}] at index ${index}`,
      );
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("concurrent append: parallel writes to different sessions do not interfere", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const store = createImportSessionEventStore({ rootDir });
    const perSession = 6;
    const sessionIds = ["alpha", "beta", "gamma"];
    const tasks: Promise<void>[] = [];
    for (const sessionId of sessionIds) {
      for (let index = 0; index < perSession; index += 1) {
        tasks.push(
          store.append(
            makeEvent({
              id: `${sessionId}-${index}`,
              sessionId,
              kind: "note",
              note: `note-${index}`,
              at: "2026-04-15T10:00:00.000Z",
            }),
          ),
        );
      }
    }
    await Promise.all(tasks);

    for (const sessionId of sessionIds) {
      const listed = await store.list(sessionId);
      assert.equal(
        listed.length,
        perSession,
        `session '${sessionId}' should contain exactly ${perSession} events`,
      );
      const sequences = listed
        .map((entry) => entry.sequence)
        .filter((value): value is number => typeof value === "number");
      assert.deepEqual(
        [...sequences].sort((left, right) => left - right),
        Array.from({ length: perSession }, (_, index) => index),
        `each session must have its own contiguous 0..${perSession - 1} sequence space`,
      );
      for (const entry of listed) {
        assert.equal(
          entry.sessionId,
          sessionId,
          `events listed for '${sessionId}' must only belong to that session`,
        );
      }
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Trimming preserves order
// ---------------------------------------------------------------------------

test("trim ordering: after retention trim, sequences are strictly increasing", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const store = createImportSessionEventStore({
      rootDir,
      maxEventsPerSession: 4,
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
        note: "n1",
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
        id: "event-note-2",
        kind: "note",
        note: "n2",
        at: "2026-04-15T10:03:00.000Z",
      }),
    );
    await store.append(
      makeEvent({
        id: "event-applied",
        kind: "applied",
        at: "2026-04-15T10:04:00.000Z",
      }),
    );

    const listed = await store.list("session-1");
    assert.equal(listed.length, 4, "retention cap must be enforced");
    for (let index = 0; index < listed.length - 1; index += 1) {
      const current = listed[index]?.sequence;
      const next = listed[index + 1]?.sequence;
      assert.ok(
        typeof current === "number" && typeof next === "number",
        "trimmed events must retain their numeric sequences",
      );
      assert.ok(
        current < next,
        `trim must preserve sequence order, got [${current}, ${next}]`,
      );
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("trim ordering: newest notes are retained but still sorted by sequence", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const store = createImportSessionEventStore({
      rootDir,
      maxEventsPerSession: 4,
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
        id: "event-note-old",
        kind: "note",
        note: "old",
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
        id: "event-note-new",
        kind: "note",
        note: "new",
        at: "2026-04-15T10:03:00.000Z",
      }),
    );
    await store.append(
      makeEvent({
        id: "event-applied",
        kind: "applied",
        at: "2026-04-15T10:04:00.000Z",
      }),
    );

    const listed = await store.list("session-1");
    assert.deepEqual(
      listed.map((entry) => entry.id),
      ["event-imported", "event-approved", "event-note-new", "event-applied"],
    );
    assert.deepEqual(
      listed.map((entry) => entry.sequence),
      [0, 2, 3, 4],
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("trim ordering: legacy events without sequence sort to the front without reordering sequenced events", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const sessionId = "session-legacy";
    const filePath = eventFilePath({ rootDir, sessionId });
    await mkdir(path.dirname(filePath), { recursive: true });
    const envelope = {
      contractVersion: CONTRACT_VERSION,
      sessionId,
      events: [
        {
          id: "seq-5",
          sessionId,
          kind: "approved",
          at: "2026-04-15T10:00:00.000Z",
          sequence: 5,
        },
        {
          id: "legacy-a",
          sessionId,
          kind: "imported",
          at: "2026-04-15T09:00:00.000Z",
        },
        {
          id: "seq-7",
          sessionId,
          kind: "applied",
          at: "2026-04-15T10:02:00.000Z",
          sequence: 7,
        },
        {
          id: "legacy-b",
          sessionId,
          kind: "note",
          note: "legacy-note",
          at: "2026-04-15T09:30:00.000Z",
        },
      ],
      nextSequence: 8,
    };
    await writeFile(filePath, JSON.stringify(envelope, null, 2), "utf8");

    const store = createImportSessionEventStore({
      rootDir,
      maxEventsPerSession: 4,
    });
    await store.append(
      makeEvent({
        id: "seq-8",
        sessionId,
        kind: "note",
        note: "fresh",
        at: "2026-04-15T10:05:00.000Z",
      }),
    );

    const listed = await store.list(sessionId);
    assert.deepEqual(
      listed.map((entry) => entry.id),
      ["legacy-a", "seq-5", "seq-7", "seq-8"],
    );

    const sequencedOnly = listed.filter(
      (entry): entry is WorkspaceImportSessionEvent & { sequence: number } =>
        typeof entry.sequence === "number",
    );
    for (let index = 0; index < sequencedOnly.length - 1; index += 1) {
      assert.ok(
        (sequencedOnly[index]?.sequence ?? -1) <
          (sequencedOnly[index + 1]?.sequence ?? -1),
        "sequenced events retain strictly increasing order even when interleaved with legacy events",
      );
    }
    const firstSequencedIndex = listed.findIndex(
      (entry) => typeof entry.sequence === "number",
    );
    const lastLegacyIndex = listed
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => typeof entry.sequence !== "number")
      .pop()?.index;
    if (lastLegacyIndex !== undefined) {
      assert.ok(
        lastLegacyIndex < firstSequencedIndex,
        "legacy events (sequence=undefined) sort to the front",
      );
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Backward compatibility with pre-sequence envelopes
// ---------------------------------------------------------------------------

test("backward compat: a legacy file without nextSequence is readable via list", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const sessionId = "session-1";
    const filePath = eventFilePath({ rootDir, sessionId });
    await mkdir(path.dirname(filePath), { recursive: true });
    const legacyEnvelope = {
      contractVersion: CONTRACT_VERSION,
      sessionId,
      events: [
        {
          id: "legacy-a",
          sessionId,
          kind: "imported",
          at: "2026-04-15T10:00:00.000Z",
        },
        {
          id: "legacy-b",
          sessionId,
          kind: "approved",
          at: "2026-04-15T10:01:00.000Z",
        },
      ],
    };
    await writeFile(filePath, JSON.stringify(legacyEnvelope, null, 2), "utf8");

    const store = createImportSessionEventStore({ rootDir });
    const listed = await store.list(sessionId);
    assert.deepEqual(
      listed.map((entry) => entry.id),
      ["legacy-a", "legacy-b"],
    );
    for (const entry of listed) {
      assert.equal(entry.sequence, undefined);
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("backward compat: appending to a legacy file derives nextSequence from event sequences", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const sessionId = "session-1";
    const filePath = eventFilePath({ rootDir, sessionId });
    await mkdir(path.dirname(filePath), { recursive: true });
    const envelope = {
      contractVersion: CONTRACT_VERSION,
      sessionId,
      events: [
        {
          id: "partial-a",
          sessionId,
          kind: "imported",
          at: "2026-04-15T10:00:00.000Z",
          sequence: 3,
        },
        {
          id: "partial-b",
          sessionId,
          kind: "review_started",
          at: "2026-04-15T10:01:00.000Z",
          sequence: 4,
        },
      ],
    };
    await writeFile(filePath, JSON.stringify(envelope, null, 2), "utf8");

    const store = createImportSessionEventStore({ rootDir });
    await store.append(
      makeEvent({
        id: "fresh",
        kind: "approved",
        at: "2026-04-15T10:02:00.000Z",
      }),
    );

    const listed = await store.list(sessionId);
    const fresh = listed.find((entry) => entry.id === "fresh");
    assert.equal(
      fresh?.sequence,
      5,
      "nextSequence must be derived as max(event.sequence) + 1 when absent from envelope",
    );

    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { nextSequence: unknown };
    assert.equal(
      parsed.nextSequence,
      6,
      "envelope.nextSequence must be persisted and advanced after the append",
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("backward compat: appending to a fully-legacy file (no sequences anywhere) starts at sequence 0", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const sessionId = "session-1";
    const filePath = eventFilePath({ rootDir, sessionId });
    await mkdir(path.dirname(filePath), { recursive: true });
    const legacyEnvelope = {
      contractVersion: CONTRACT_VERSION,
      sessionId,
      events: [
        {
          id: "legacy-a",
          sessionId,
          kind: "imported",
          at: "2026-04-15T10:00:00.000Z",
        },
        {
          id: "legacy-b",
          sessionId,
          kind: "approved",
          at: "2026-04-15T10:01:00.000Z",
        },
      ],
    };
    await writeFile(filePath, JSON.stringify(legacyEnvelope, null, 2), "utf8");

    const store = createImportSessionEventStore({ rootDir });
    await store.append(
      makeEvent({
        id: "fresh",
        kind: "applied",
        at: "2026-04-15T10:02:00.000Z",
      }),
    );

    const listed = await store.list(sessionId);
    const fresh = listed.find((entry) => entry.id === "fresh");
    assert.equal(
      fresh?.sequence,
      0,
      "with no sequences anywhere, the derived nextSequence starts at 0",
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("backward compat: replay order by sequence disambiguates events with identical timestamps", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const store = createImportSessionEventStore({ rootDir });
    const sameTimestamp = "2026-04-15T10:00:00.000Z";
    await store.append(
      makeEvent({
        id: "event-first",
        kind: "imported",
        at: sameTimestamp,
      }),
    );
    await store.append(
      makeEvent({
        id: "event-second",
        kind: "review_started",
        at: sameTimestamp,
      }),
    );
    await store.append(
      makeEvent({
        id: "event-third",
        kind: "approved",
        at: sameTimestamp,
      }),
    );

    const listed = await store.list("session-1");
    assert.deepEqual(
      listed.map((entry) => entry.id),
      ["event-first", "event-second", "event-third"],
    );
    assert.deepEqual(
      listed.map((entry) => entry.sequence),
      [0, 1, 2],
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("backward compat: non-finite envelope nextSequence falls back to the derived value", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const sessionId = "session-1";
    const filePath = eventFilePath({ rootDir, sessionId });
    await mkdir(path.dirname(filePath), { recursive: true });
    const envelope = {
      contractVersion: CONTRACT_VERSION,
      sessionId,
      events: [
        {
          id: "seq-3",
          sessionId,
          kind: "imported",
          at: "2026-04-15T10:00:00.000Z",
          sequence: 3,
        },
      ],
      nextSequence: "not-a-number",
    };
    await writeFile(filePath, JSON.stringify(envelope), "utf8");

    const store = createImportSessionEventStore({ rootDir });
    await store.append(
      makeEvent({
        id: "fresh",
        kind: "approved",
        at: "2026-04-15T10:01:00.000Z",
      }),
    );

    const listed = await store.list(sessionId);
    const fresh = listed.find((entry) => entry.id === "fresh");
    assert.equal(
      fresh?.sequence,
      4,
      "invalid nextSequence must fall back to max(event.sequence) + 1",
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("concurrent append with retention: all sequences remain strictly increasing after trim", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-import-session-events-"),
  );
  try {
    const store = createImportSessionEventStore({
      rootDir,
      maxEventsPerSession: 5,
    });
    const parallelCount = 12;
    await Promise.all(
      Array.from({ length: parallelCount }, (_, index) =>
        store.append(
          makeEvent({
            id: `parallel-${index}`,
            kind: "note",
            note: `note-${index}`,
            at: "2026-04-15T10:00:00.000Z",
          }),
        ),
      ),
    );

    const listed = await store.list("session-1");
    assert.equal(
      listed.length,
      5,
      "retention cap must be enforced during concurrent appends",
    );
    const sequences = listed
      .map((entry) => entry.sequence)
      .filter((value): value is number => typeof value === "number");
    assert.equal(
      sequences.length,
      listed.length,
      "every retained event must carry a numeric sequence",
    );
    for (let index = 0; index < sequences.length - 1; index += 1) {
      const current = sequences[index];
      const next = sequences[index + 1];
      assert.ok(
        typeof current === "number" && typeof next === "number",
        "sequences must be numeric",
      );
      assert.ok(
        current < next,
        `concurrent-retention path must preserve strictly increasing sequences, got [${current}, ${next}]`,
      );
    }
    assert.deepEqual(
      sequences,
      [7, 8, 9, 10, 11],
      "concurrent retention must keep the newest events by sequence",
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
