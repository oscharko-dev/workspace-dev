import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_IMPORT_HISTORY_ENTRIES,
  PASTE_IMPORT_HISTORY_VERSION,
  addImportSession,
  createEmptyImportHistory,
  findPreviousImport,
  generateImportSessionId,
  type PasteImportSession,
  persistImportHistory,
  removeImportSession,
  restoreImportHistory,
  toPasteImportHistoryStorageKey,
} from "./paste-import-history";

function makeSession(
  overrides: Partial<PasteImportSession> = {},
): PasteImportSession {
  return {
    id: "paste-import-1000",
    fileKey: "file-key-1",
    nodeId: "1:2",
    nodeName: "HomePage",
    importedAt: "2026-04-15T10:00:00.000Z",
    nodeCount: 42,
    fileCount: 7,
    selectedNodes: [],
    scope: "all",
    componentMappings: 3,
    version: "1234567890",
    pasteIdentityKey: null,
    jobId: "job-1",
    ...overrides,
  };
}

afterEach(() => {
  window.localStorage.clear();
});

describe("createEmptyImportHistory", () => {
  it("returns an empty entries array", () => {
    expect(createEmptyImportHistory()).toEqual({ entries: [] });
  });
});

describe("generateImportSessionId", () => {
  it("formats a stable id from the injected clock", () => {
    expect(generateImportSessionId(() => 1_700_000_000_000)).toBe(
      "paste-import-1700000000000",
    );
  });

  it("uses Date.now by default", () => {
    const id = generateImportSessionId();
    expect(id).toMatch(/^paste-import-\d+$/);
  });
});

describe("addImportSession", () => {
  it("appends a session to an empty history", () => {
    const session = makeSession();
    const next = addImportSession(createEmptyImportHistory(), session);
    expect(next.entries).toEqual([session]);
  });

  it("appends new sessions to the end (most recent last)", () => {
    const a = makeSession({ id: "paste-import-1" });
    const b = makeSession({ id: "paste-import-2" });
    const next = addImportSession(
      addImportSession(createEmptyImportHistory(), a),
      b,
    );
    expect(next.entries.map((entry) => entry.id)).toEqual([
      "paste-import-1",
      "paste-import-2",
    ]);
  });

  it("replaces an existing entry by id and moves it to the end", () => {
    const a = makeSession({ id: "paste-import-1", nodeName: "Original" });
    const b = makeSession({ id: "paste-import-2", nodeName: "Other" });
    const replacement = makeSession({
      id: "paste-import-1",
      nodeName: "Updated",
    });

    let history = addImportSession(createEmptyImportHistory(), a);
    history = addImportSession(history, b);
    history = addImportSession(history, replacement);

    expect(history.entries).toHaveLength(2);
    expect(history.entries.map((entry) => entry.id)).toEqual([
      "paste-import-2",
      "paste-import-1",
    ]);
    expect(history.entries[1]?.nodeName).toBe("Updated");
  });

  it("trims oldest entries when over the cap (FIFO)", () => {
    let history = createEmptyImportHistory();
    for (let index = 0; index < MAX_IMPORT_HISTORY_ENTRIES + 5; index += 1) {
      history = addImportSession(
        history,
        makeSession({ id: `paste-import-${String(index)}` }),
      );
    }
    expect(history.entries).toHaveLength(MAX_IMPORT_HISTORY_ENTRIES);
    // Oldest entries (index 0..4) trimmed; first remaining is index 5.
    expect(history.entries[0]?.id).toBe("paste-import-5");
    expect(history.entries[history.entries.length - 1]?.id).toBe(
      `paste-import-${String(MAX_IMPORT_HISTORY_ENTRIES + 4)}`,
    );
  });

  it("does not mutate the input history", () => {
    const initial = createEmptyImportHistory();
    addImportSession(initial, makeSession());
    expect(initial.entries).toHaveLength(0);
  });
});

describe("removeImportSession", () => {
  it("removes the entry with the given id", () => {
    const a = makeSession({ id: "paste-import-1" });
    const b = makeSession({ id: "paste-import-2" });
    const history = addImportSession(
      addImportSession(createEmptyImportHistory(), a),
      b,
    );

    const next = removeImportSession(history, "paste-import-1");
    expect(next.entries.map((entry) => entry.id)).toEqual(["paste-import-2"]);
  });

  it("returns the same reference when id is missing", () => {
    const history = addImportSession(createEmptyImportHistory(), makeSession());
    const next = removeImportSession(history, "paste-import-missing");
    expect(next).toBe(history);
  });
});

describe("findPreviousImport", () => {
  it("matches by pasteIdentityKey first", () => {
    const a = makeSession({
      id: "paste-import-1",
      fileKey: "file-x",
      nodeId: "1:1",
      pasteIdentityKey: "ident-A",
    });
    const b = makeSession({
      id: "paste-import-2",
      fileKey: "file-y",
      nodeId: "2:2",
      pasteIdentityKey: "ident-B",
    });
    const history = addImportSession(
      addImportSession(createEmptyImportHistory(), a),
      b,
    );

    expect(
      findPreviousImport(history, { pasteIdentityKey: "ident-A" })?.id,
    ).toBe("paste-import-1");
    expect(
      findPreviousImport(history, { pasteIdentityKey: "ident-B" })?.id,
    ).toBe("paste-import-2");
  });

  it("falls back to (fileKey,nodeId) when both are non-empty", () => {
    const session = makeSession({
      id: "paste-import-1",
      fileKey: "file-key-9",
      nodeId: "9:9",
      pasteIdentityKey: null,
    });
    const history = addImportSession(createEmptyImportHistory(), session);

    expect(
      findPreviousImport(history, { fileKey: "file-key-9", nodeId: "9:9" })?.id,
    ).toBe("paste-import-1");
  });

  it("ignores empty fileKey or nodeId in the query", () => {
    const session = makeSession({
      id: "paste-import-1",
      fileKey: "",
      nodeId: "",
      pasteIdentityKey: null,
    });
    const history = addImportSession(createEmptyImportHistory(), session);

    expect(findPreviousImport(history, { fileKey: "", nodeId: "" })).toBeNull();
    expect(
      findPreviousImport(history, { fileKey: "anything", nodeId: "" }),
    ).toBeNull();
    expect(
      findPreviousImport(history, { fileKey: "", nodeId: "1:2" }),
    ).toBeNull();
  });

  it("ignores empty pasteIdentityKey in the query", () => {
    const session = makeSession({
      id: "paste-import-1",
      pasteIdentityKey: "",
    });
    const history = addImportSession(createEmptyImportHistory(), session);

    // Empty query key should not match an empty stored identity key.
    expect(findPreviousImport(history, { pasteIdentityKey: "" })).toBeNull();
    expect(findPreviousImport(history, { pasteIdentityKey: null })).toBeNull();
  });

  it("returns the most recent matching entry when multiple match", () => {
    const older = makeSession({
      id: "paste-import-1",
      pasteIdentityKey: "ident-A",
      nodeName: "Older",
    });
    const newer = makeSession({
      id: "paste-import-2",
      pasteIdentityKey: "ident-A",
      nodeName: "Newer",
    });
    const history = addImportSession(
      addImportSession(createEmptyImportHistory(), older),
      newer,
    );

    expect(
      findPreviousImport(history, { pasteIdentityKey: "ident-A" })?.id,
    ).toBe("paste-import-2");
  });

  it("returns null when no entry matches", () => {
    const session = makeSession({
      id: "paste-import-1",
      fileKey: "file-key-1",
      nodeId: "1:2",
      pasteIdentityKey: "ident-A",
    });
    const history = addImportSession(createEmptyImportHistory(), session);

    expect(
      findPreviousImport(history, {
        pasteIdentityKey: "ident-X",
        fileKey: "file-key-Z",
        nodeId: "9:9",
      }),
    ).toBeNull();
  });
});

describe("toPasteImportHistoryStorageKey", () => {
  it("returns the versioned storage key", () => {
    expect(toPasteImportHistoryStorageKey()).toBe(
      "workspace-dev:paste-import-history:v1",
    );
  });
});

describe("storage roundtrip", () => {
  it("persists and restores the same entries", () => {
    const session = makeSession({
      id: "paste-import-roundtrip",
      pasteIdentityKey: "ident-roundtrip",
      selectedNodes: ["1:2", "3:4"],
      scope: "all",
    });
    const history = addImportSession(createEmptyImportHistory(), session);

    const persisted = persistImportHistory(history);
    expect(persisted.ok).toBe(true);
    expect(persisted.error).toBeNull();

    const restored = restoreImportHistory();
    expect(restored.warning).toBeNull();
    expect(restored.history.entries).toEqual([session]);
  });

  it("returns empty history without warning when nothing is stored", () => {
    const restored = restoreImportHistory();
    expect(restored.history.entries).toEqual([]);
    expect(restored.warning).toBeNull();
  });

  it("returns empty history with a warning when stored JSON is invalid", () => {
    window.localStorage.setItem(toPasteImportHistoryStorageKey(), "not-json");
    const restored = restoreImportHistory();
    expect(restored.history.entries).toEqual([]);
    expect(restored.warning).toContain("invalid JSON");
  });

  it("returns empty history with a warning when stored version is unknown", () => {
    window.localStorage.setItem(
      toPasteImportHistoryStorageKey(),
      JSON.stringify({
        version: PASTE_IMPORT_HISTORY_VERSION + 1,
        entries: [],
      }),
    );
    const restored = restoreImportHistory();
    expect(restored.history.entries).toEqual([]);
    expect(restored.warning).toContain("unsupported");
  });

  it("returns empty history with a warning when payload is not an object", () => {
    window.localStorage.setItem(
      toPasteImportHistoryStorageKey(),
      JSON.stringify([]),
    );
    const restored = restoreImportHistory();
    expect(restored.history.entries).toEqual([]);
    expect(restored.warning).toContain("incompatible");
  });

  it("drops malformed entries silently and keeps valid ones", () => {
    const valid = makeSession({ id: "paste-import-keep" });
    window.localStorage.setItem(
      toPasteImportHistoryStorageKey(),
      JSON.stringify({
        version: PASTE_IMPORT_HISTORY_VERSION,
        entries: [
          valid,
          { id: 123, fileKey: "x" }, // wrong types
          null,
          "string",
          {
            ...valid,
            id: "paste-import-bad-counts",
            nodeCount: -1, // negative not allowed
          },
          {
            ...valid,
            id: "paste-import-bad-key",
            pasteIdentityKey: 42, // wrong type
          },
        ],
      }),
    );

    const restored = restoreImportHistory();
    expect(restored.warning).toBeNull();
    expect(restored.history.entries).toEqual([valid]);
  });
});

describe("storage exception handling", () => {
  it("persistImportHistory returns ok:false with an error on setItem failure", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });

    const result = persistImportHistory(
      addImportSession(createEmptyImportHistory(), makeSession()),
    );

    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error).toContain("In-memory history");

    setItemSpy.mockRestore();
  });

  it("restoreImportHistory returns empty history with a warning when getItem throws", () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });

    const restored = restoreImportHistory();

    expect(restored.history.entries).toEqual([]);
    expect(restored.warning).toContain("unavailable");

    getItemSpy.mockRestore();
  });
});

describe("SSR safety", () => {
  it("persistImportHistory returns ok:true when window is undefined", () => {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: undefined,
    });
    try {
      const result = persistImportHistory(createEmptyImportHistory());
      expect(result).toEqual({ ok: true, error: null });
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  it("restoreImportHistory returns empty history without warning when window is undefined", () => {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: undefined,
    });
    try {
      const restored = restoreImportHistory();
      expect(restored).toEqual({ history: { entries: [] }, warning: null });
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  it("re-import 'Update' flow stays at length 1 when the caller reuses the prior session id (regression for M3)", () => {
    let history = createEmptyImportHistory();
    const baseSession = makeSession({ id: "paste-import-A" });
    history = addImportSession(history, baseSession);
    expect(history.entries.length).toBe(1);

    const updated = makeSession({
      id: baseSession.id,
      jobId: "job-2",
      nodeCount: 99,
    });
    history = addImportSession(history, updated);
    expect(history.entries.length).toBe(1);
    expect(history.entries[0]?.jobId).toBe("job-2");
    expect(history.entries[0]?.nodeCount).toBe(99);
  });
});
