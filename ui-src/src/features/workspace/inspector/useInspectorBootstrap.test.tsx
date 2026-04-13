import type { JSX, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJson, type JsonResponse } from "../../../lib/http";
import { useInspectorBootstrap } from "./useInspectorBootstrap";

vi.mock("../../../lib/http", () => ({
  fetchJson: vi.fn(),
}));

const fetchJsonMock = vi.mocked(fetchJson);

function createJsonResponse<TPayload>({
  status = 200,
  ok = true,
  payload,
}: {
  status?: number;
  ok?: boolean;
  payload: TPayload;
}): JsonResponse<TPayload> {
  return { status, ok, payload };
}

function makeWrapper(): ({ children }: { children: ReactNode }) => JSX.Element {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useInspectorBootstrap — happy path", () => {
  beforeEach(() => {
    let pollCount = 0;

    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-happy" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-happy") {
        pollCount += 1;
        if (pollCount === 1) {
          return createJsonResponse({
            payload: { jobId: "job-happy", status: "queued" },
          }) as never;
        }
        if (pollCount === 2) {
          return createJsonResponse({
            payload: { jobId: "job-happy", status: "running" },
          }) as never;
        }
        return createJsonResponse({
          payload: {
            jobId: "job-happy",
            status: "completed",
            preview: { url: "http://localhost/preview" },
          },
        }) as never;
      }

      throw new Error(`Unexpected url: ${url}`);
    });
  });

  it("idle → pasting → queued → processing → ready", async () => {
    const { result } = renderHook(
      () => useInspectorBootstrap({ pollIntervalMs: 50 }),
      { wrapper: makeWrapper() },
    );

    // Initial state
    expect(result.current.state.kind).toBe("idle");
    expect(result.current.jobId).toBeNull();
    expect(result.current.previewUrl).toBeNull();

    result.current.submit({ figmaJsonPayload: '{"figma":"data"}' });

    // Wait for the full happy-path sequence to complete
    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });

    expect(result.current.previewUrl).toBe("http://localhost/preview");
    expect(result.current.jobId).toBe("job-happy");
  });
});

describe("useInspectorBootstrap — 400 SCHEMA_MISMATCH", () => {
  beforeEach(() => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 400,
          ok: false,
          payload: { error: "SCHEMA_MISMATCH" },
        }) as never;
      }
      throw new Error(`Unexpected url: ${url}`);
    });
  });

  it("→ failed, not retryable", async () => {
    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    result.current.submit({ figmaJsonPayload: '{"bad":"data"}' });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("failed");
    });

    if (result.current.state.kind === "failed") {
      expect(result.current.state.reason).toBe("SCHEMA_MISMATCH");
      expect(result.current.state.retryable).toBe(false);
    }
  });
});

describe("useInspectorBootstrap — 500 server error", () => {
  beforeEach(() => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 500,
          ok: false,
          payload: { error: "INTERNAL_SERVER_ERROR" },
        }) as never;
      }
      throw new Error(`Unexpected url: ${url}`);
    });
  });

  it("→ failed, retryable; retry() returns to idle", async () => {
    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    result.current.submit({ figmaJsonPayload: '{"some":"data"}' });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("failed");
    });

    if (result.current.state.kind === "failed") {
      expect(result.current.state.retryable).toBe(true);
    }

    result.current.retry();

    await waitFor(() => {
      expect(result.current.state.kind).toBe("idle");
    });
  });
});

describe("useInspectorBootstrap — reset", () => {
  beforeEach(() => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-reset" },
        }) as never;
      }
      if (url === "/workspace/jobs/job-reset") {
        return createJsonResponse({
          payload: { jobId: "job-reset", status: "queued" },
        }) as never;
      }
      throw new Error(`Unexpected url: ${url}`);
    });
  });

  it("reset() returns to idle from queued state", async () => {
    const { result } = renderHook(
      () => useInspectorBootstrap({ pollIntervalMs: 50 }),
      { wrapper: makeWrapper() },
    );

    result.current.submit({ figmaJsonPayload: '{"figma":"data"}' });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("queued");
    });

    result.current.reset();

    await waitFor(() => {
      expect(result.current.state.kind).toBe("idle");
    });

    expect(result.current.jobId).toBeNull();
    expect(result.current.previewUrl).toBeNull();
  });

  it("reset() works from idle state", () => {
    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.state.kind).toBe("idle");
    result.current.reset();
    expect(result.current.state.kind).toBe("idle");
  });
});
