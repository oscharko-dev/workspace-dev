import type { JSX, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PasteImportSession } from "./paste-import-history";
import { useImportHistory } from "./useImportHistory";

function makeSession(
  overrides: Partial<PasteImportSession> = {},
): PasteImportSession {
  return {
    id: "session-1",
    fileKey: "file-key-1",
    nodeId: "1:2",
    nodeName: "HomePage",
    importedAt: "2026-04-15T10:00:00.000Z",
    nodeCount: 42,
    fileCount: 7,
    selectedNodes: [],
    scope: "all",
    componentMappings: 3,
    pasteIdentityKey: null,
    jobId: "job-1",
    replayable: true,
    ...overrides,
  };
}

function createWrapper(): ({
  children,
}: {
  children: ReactNode;
}) => JSX.Element {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({
    children,
  }: {
    children: ReactNode;
  }): JSX.Element {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useImportHistory", () => {
  it("loads server-backed import history", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          sessions: [makeSession()],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const { result } = renderHook(() => useImportHistory(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.history.entries).toHaveLength(1);
    });

    expect(fetchMock).toHaveBeenCalledWith("/workspace/import-sessions", undefined);
    expect(result.current.warning).toBeNull();
  });

  it("findPrevious matches newest server-backed sessions", async () => {
    const older = makeSession({
      id: "older",
      importedAt: "2026-04-15T09:00:00.000Z",
      pasteIdentityKey: "ident-1",
    });
    const newer = makeSession({
      id: "newer",
      importedAt: "2026-04-15T11:00:00.000Z",
      pasteIdentityKey: "ident-1",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ sessions: [older, newer] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { result } = renderHook(() => useImportHistory(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.history.entries).toHaveLength(2);
    });

    expect(
      result.current.findPrevious({ pasteIdentityKey: "ident-1" })?.id,
    ).toBe("newer");
  });

  it("deletes server-backed history entries and refetches", async () => {
    const sessions = [makeSession()];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessions }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessionId: "session-1", deleted: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessions: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const { result } = renderHook(() => useImportHistory(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.history.entries).toHaveLength(1);
    });

    await result.current.removeSession("session-1");

    await waitFor(() => {
      expect(result.current.history.entries).toHaveLength(0);
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/workspace/import-sessions/session-1",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });

  it("reimports server-backed history entries through the canonical endpoint", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessions: [makeSession()] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sessionId: "session-1",
            jobId: "job-reimport",
            sourceJobId: "job-previous",
            pipelineId: "rocket",
            pipelineMetadata: {
              pipelineId: "rocket",
              pipelineDisplayName: "Rocket",
              templateBundleId: "react-mui-app",
              buildProfile: "default,rocket",
              deterministic: true,
            },
          }),
          {
            status: 202,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessions: [makeSession()] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const { result } = renderHook(() => useImportHistory(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.history.entries).toHaveLength(1);
    });

    await expect(result.current.reimportSession("session-1")).resolves.toEqual({
      sessionId: "session-1",
      jobId: "job-reimport",
      sourceJobId: "job-previous",
      pipelineId: "rocket",
      pipelineMetadata: {
        pipelineId: "rocket",
        pipelineDisplayName: "Rocket",
        templateBundleId: "react-mui-app",
        buildProfile: "default,rocket",
        deterministic: true,
      },
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/workspace/import-sessions/session-1/reimport",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });
});
