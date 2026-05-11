import type { JSX, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceImportSessionEvent } from "./import-review-state";
import { useImportSessionEvents } from "./useImportSessionEvents";

function makeEvent(
  overrides: Partial<WorkspaceImportSessionEvent> = {},
): WorkspaceImportSessionEvent {
  return {
    id: "evt-1",
    sessionId: "session-1",
    kind: "imported",
    at: "2026-04-15T10:00:00.000Z",
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

  return function Wrapper({ children }: { children: ReactNode }): JSX.Element {
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

describe("useImportSessionEvents", () => {
  it("does not fetch when sessionId is null", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const { result } = renderHook(() => useImportSessionEvents(null), {
      wrapper: createWrapper(),
    });

    // Allow any microtasks to flush.
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.events).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("GETs /workspace/import-sessions/:id/events and returns events on success", async () => {
    const events = [makeEvent({ id: "a" }), makeEvent({ id: "b" })];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ events }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { result } = renderHook(() => useImportSessionEvents("session-xyz"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.events).toHaveLength(2);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/workspace/import-sessions/session-xyz/events",
      undefined,
    );
    expect(result.current.events[0]?.id).toBe("a");
    expect(result.current.error).toBeNull();
  });

  it("URL-encodes the sessionId segment", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ events: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { result } = renderHook(
      () => useImportSessionEvents("paste import/42"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/workspace/import-sessions/paste%20import%2F42/events",
      undefined,
    );
  });

  it("surfaces a server error message when the response is not ok", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );

    const { result } = renderHook(
      () => useImportSessionEvents("missing-session"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.error).toBe("not found");
    expect(result.current.events).toEqual([]);
  });

  it("surfaces a default error message when the fetch rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useImportSessionEvents("session-err"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.error).toBe("boom");
    expect(result.current.events).toEqual([]);
  });

  it("uses the injected fetchImpl when provided", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ events: [makeEvent()] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { result } = renderHook(
      () => useImportSessionEvents("session-injected", { fetchImpl }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.events).toHaveLength(1);
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("/workspace/import-sessions/session-injected/events");
  });

  it("prefixes the URL with baseUrl when provided", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ events: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { result } = renderHook(
      () =>
        useImportSessionEvents("session-base", {
          fetchImpl,
          baseUrl: "https://audit.example",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const [url] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://audit.example/workspace/import-sessions/session-base/events",
    );
  });

  it("refetch invalidates the query so the next fetch goes out", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ events: [makeEvent({ id: "v1" })] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            events: [makeEvent({ id: "v1" }), makeEvent({ id: "v2" })],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );

    const { result } = renderHook(
      () => useImportSessionEvents("session-refetch", { fetchImpl }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.events).toHaveLength(1);
    });

    result.current.refetch();

    await waitFor(() => {
      expect(result.current.events).toHaveLength(2);
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
