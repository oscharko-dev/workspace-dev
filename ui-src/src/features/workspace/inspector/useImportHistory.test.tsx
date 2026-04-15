import type { JSX, ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_IMPORT_HISTORY_ENTRIES,
  PASTE_IMPORT_HISTORY_VERSION,
  restoreImportHistory,
  toPasteImportHistoryStorageKey,
  type PasteImportSession,
} from "./paste-import-history";
import { useImportHistory } from "./useImportHistory";

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
    componentMappings: 3,
    version: "1234567890",
    pasteIdentityKey: null,
    jobId: "job-1",
    ...overrides,
  };
}

function Wrapper({ children }: { children: ReactNode }): JSX.Element {
  return <>{children}</>;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("useImportHistory", () => {
  it("mounts with empty history and no warning when localStorage is empty", async () => {
    const { result } = renderHook(() => useImportHistory(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.history.entries).toEqual([]);
    });
    expect(result.current.warning).toBeNull();
  });

  it("seeds state from pre-populated localStorage on mount", async () => {
    const seeded = makeSession({ id: "paste-import-seed" });
    window.localStorage.setItem(
      toPasteImportHistoryStorageKey(),
      JSON.stringify({
        version: PASTE_IMPORT_HISTORY_VERSION,
        entries: [seeded],
      }),
    );

    const { result } = renderHook(() => useImportHistory(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.history.entries).toEqual([seeded]);
    });
    expect(result.current.warning).toBeNull();
  });

  it("surfaces a warning when stored JSON is invalid", async () => {
    window.localStorage.setItem(toPasteImportHistoryStorageKey(), "not-json");

    const { result } = renderHook(() => useImportHistory(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.warning).toContain("invalid JSON");
    });
    expect(result.current.history.entries).toEqual([]);
  });

  it("addSession updates state and persists to localStorage", async () => {
    const { result } = renderHook(() => useImportHistory(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.history.entries).toEqual([]);
    });

    const session = makeSession({ id: "paste-import-added" });
    act(() => {
      result.current.addSession(session);
    });

    expect(result.current.history.entries).toEqual([session]);
    expect(result.current.warning).toBeNull();

    const restored = restoreImportHistory();
    expect(restored.history.entries).toEqual([session]);
  });

  it("removeSession removes the entry and persists", async () => {
    const a = makeSession({ id: "paste-import-a" });
    const b = makeSession({ id: "paste-import-b" });
    const { result } = renderHook(() => useImportHistory(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.history.entries).toEqual([]);
    });

    act(() => {
      result.current.addSession(a);
      result.current.addSession(b);
    });
    expect(result.current.history.entries.map((entry) => entry.id)).toEqual([
      "paste-import-a",
      "paste-import-b",
    ]);

    act(() => {
      result.current.removeSession("paste-import-a");
    });

    expect(result.current.history.entries.map((entry) => entry.id)).toEqual([
      "paste-import-b",
    ]);
    expect(
      restoreImportHistory().history.entries.map((entry) => entry.id),
    ).toEqual(["paste-import-b"]);
  });

  it("findPrevious returns the matching entry and null when not found", async () => {
    const session = makeSession({
      id: "paste-import-find",
      pasteIdentityKey: "ident-find",
      fileKey: "file-key-find",
      nodeId: "5:5",
    });
    const { result } = renderHook(() => useImportHistory(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.history.entries).toEqual([]);
    });

    act(() => {
      result.current.addSession(session);
    });

    expect(
      result.current.findPrevious({ pasteIdentityKey: "ident-find" })?.id,
    ).toBe("paste-import-find");
    expect(
      result.current.findPrevious({
        fileKey: "file-key-find",
        nodeId: "5:5",
      })?.id,
    ).toBe("paste-import-find");
    expect(
      result.current.findPrevious({ pasteIdentityKey: "ident-missing" }),
    ).toBeNull();
  });

  it("trims oldest entries (FIFO) beyond MAX_IMPORT_HISTORY_ENTRIES", async () => {
    const { result } = renderHook(() => useImportHistory(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.history.entries).toEqual([]);
    });

    act(() => {
      for (let index = 0; index < MAX_IMPORT_HISTORY_ENTRIES + 5; index += 1) {
        result.current.addSession(
          makeSession({ id: `paste-import-${String(index)}` }),
        );
      }
    });

    expect(result.current.history.entries).toHaveLength(
      MAX_IMPORT_HISTORY_ENTRIES,
    );
    expect(result.current.history.entries[0]?.id).toBe("paste-import-5");
    expect(
      result.current.history.entries[result.current.history.entries.length - 1]
        ?.id,
    ).toBe(`paste-import-${String(MAX_IMPORT_HISTORY_ENTRIES + 4)}`);
  });

  it("sets warning but still updates in-memory history when setItem throws", async () => {
    const { result } = renderHook(() => useImportHistory(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.history.entries).toEqual([]);
    });

    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });

    const session = makeSession({ id: "paste-import-unpersisted" });
    act(() => {
      result.current.addSession(session);
    });

    expect(result.current.history.entries).toEqual([session]);
    expect(result.current.warning).not.toBeNull();
    expect(result.current.warning).toContain("In-memory history");
  });

  it("is callable inside a React component and returns stable callbacks across re-renders when no new state", async () => {
    const { result, rerender } = renderHook(() => useImportHistory(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.history.entries).toEqual([]);
    });

    const firstAdd = result.current.addSession;
    const firstRemove = result.current.removeSession;
    const firstFind = result.current.findPrevious;

    rerender();

    expect(result.current.addSession).toBe(firstAdd);
    expect(result.current.removeSession).toBe(firstRemove);
    expect(result.current.findPrevious).toBe(firstFind);
  });
});
