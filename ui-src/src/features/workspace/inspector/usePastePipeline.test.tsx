import type { JSX, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJson, type JsonResponse } from "../../../lib/http";
import { usePastePipeline } from "./paste-pipeline";

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

function buildFigmaClipboardHtml(): string {
  const meta = { fileKey: "abc123XYZ", pasteID: 42, dataType: "scene" };
  const encoded = btoa(JSON.stringify(meta));
  return [
    `<meta charset="utf-8">`,
    `<div>`,
    `  <span data-metadata="<!--(figmeta)${encoded}(/figmeta)-->"></span>`,
    `  <span data-buffer="<!--(figma)ZmlnLi4u(/figma)-->"></span>`,
    `</div>`,
  ].join("\n");
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("usePastePipeline — non-Figma clipboard", () => {
  it("silently returns to idle without calling fetchJson", async () => {
    const { result } = renderHook(() => usePastePipeline(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      result.current.start("<div>not figma</div>");
    });

    await waitFor(() => {
      expect(result.current.state.stage).toBe("idle");
    });

    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});

describe("usePastePipeline — submit failures", () => {
  it("transitions to error with canRetry=true on 500", async () => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 500,
          ok: false,
          payload: { error: "SERVER_ERROR" },
        }) as never;
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() => usePastePipeline(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      result.current.start(buildFigmaClipboardHtml());
    });

    await waitFor(() => {
      expect(result.current.state.stage).toBe("error");
    });

    expect(result.current.state.canRetry).toBe(true);
    expect(result.current.state.canCancel).toBe(false);
    expect(result.current.state.errors).toHaveLength(1);
  });

  it("transitions to error with canRetry=true and not retryable on 400", async () => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 400,
          ok: false,
          payload: { error: "INVALID_PAYLOAD" },
        }) as never;
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() => usePastePipeline(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      result.current.start(buildFigmaClipboardHtml());
    });

    await waitFor(() => {
      expect(result.current.state.stage).toBe("error");
    });

    const error = result.current.state.errors[0];
    expect(error?.retryable).toBe(false);
    expect(error?.code).toBe("INVALID_PAYLOAD");
  });
});

describe("usePastePipeline — happy path through stages", () => {
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
            payload: {
              jobId: "job-happy",
              status: "running",
              stages: [{ name: "figma.source", status: "running" }],
            },
          }) as never;
        }
        if (pollCount === 2) {
          return createJsonResponse({
            payload: {
              jobId: "job-happy",
              status: "running",
              stages: [
                { name: "figma.source", status: "completed" },
                { name: "ir.derive", status: "running" },
              ],
            },
          }) as never;
        }
        return createJsonResponse({
          payload: {
            jobId: "job-happy",
            status: "completed",
            stages: [
              { name: "figma.source", status: "completed" },
              { name: "ir.derive", status: "completed" },
              { name: "figma.enrich", status: "completed" },
              { name: "codegen", status: "completed" },
            ],
          },
        }) as never;
      }
      if (
        url.startsWith("/workspace/jobs/job-happy/design-ir") ||
        url.startsWith("/workspace/jobs/job-happy/component-manifest") ||
        url.startsWith("/workspace/jobs/job-happy/files")
      ) {
        return createJsonResponse({ payload: {} }) as never;
      }
      throw new Error(`Unexpected url: ${url}`);
    });
  });

  it("accepts the job, polls, and reaches the ready stage", async () => {
    const { result } = renderHook(() => usePastePipeline(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      result.current.start(buildFigmaClipboardHtml());
    });

    await waitFor(
      () => {
        expect(result.current.state.stage).toBe("ready");
      },
      { timeout: 5000 },
    );

    expect(result.current.state.jobId).toBe("job-happy");
    expect(result.current.state.progress).toBe(100);
    expect(result.current.state.canCancel).toBe(false);
    expect(result.current.state.canRetry).toBe(false);
  });
});

describe("usePastePipeline — cancel", () => {
  it("cancel() returns state to idle even mid-flight", async () => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-cancel" },
        }) as never;
      }
      if (url === "/workspace/jobs/job-cancel") {
        return createJsonResponse({
          payload: { jobId: "job-cancel", status: "running", stages: [] },
        }) as never;
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() => usePastePipeline(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      result.current.start(buildFigmaClipboardHtml());
    });

    await waitFor(() => {
      expect(result.current.state.jobId).toBe("job-cancel");
    });

    await act(async () => {
      result.current.cancel();
    });

    expect(result.current.state.stage).toBe("idle");
    expect(result.current.state.jobId).toBeUndefined();
  });
});
