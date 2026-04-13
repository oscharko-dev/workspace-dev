import type { JSX, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
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
  it("→ failed, not retryable", async () => {
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

  it("allows a corrected paste to recover without an explicit retry", async () => {
    let submitCount = 0;

    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        submitCount += 1;
        if (submitCount === 1) {
          return createJsonResponse({
            status: 400,
            ok: false,
            payload: { error: "SCHEMA_MISMATCH" },
          }) as never;
        }

        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-recovered" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-recovered") {
        return createJsonResponse({
          payload: {
            jobId: "job-recovered",
            status: "completed",
            preview: { url: "http://localhost/recovered-preview" },
          },
        }) as never;
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(
      () => useInspectorBootstrap({ pollIntervalMs: 50 }),
      {
        wrapper: makeWrapper(),
      },
    );

    result.current.submit({ figmaJsonPayload: '{"bad":"data"}' });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("failed");
    });

    result.current.submit({ figmaJsonPayload: '{"document":{}}' });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });

    expect(result.current.jobId).toBe("job-recovered");
    expect(result.current.previewUrl).toBe(
      "http://localhost/recovered-preview",
    );
  });
});

describe("useInspectorBootstrap — 400 TOO_LARGE", () => {
  it("→ failed, not retryable", async () => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 400,
          ok: false,
          payload: { error: "TOO_LARGE" },
        }) as never;
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    result.current.submit({ figmaJsonPayload: '{"document":{}}' });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("failed");
    });

    if (result.current.state.kind === "failed") {
      expect(result.current.state.reason).toBe("TOO_LARGE");
      expect(result.current.state.retryable).toBe(false);
    }
  });
});

describe("useInspectorBootstrap — 400 UNSUPPORTED_FORMAT", () => {
  it("→ failed, not retryable", async () => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 400,
          ok: false,
          payload: { error: "UNSUPPORTED_FORMAT" },
        }) as never;
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    result.current.submit({
      figmaJsonPayload: '{"kind":"workspace-dev/figma-selection@99"}',
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("failed");
    });

    if (result.current.state.kind === "failed") {
      expect(result.current.state.reason).toBe("UNSUPPORTED_FORMAT");
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

describe("useInspectorBootstrap — polling failures", () => {
  it("surfaces non-OK polling responses as retryable failures", async () => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-poll-error" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-poll-error") {
        return createJsonResponse({
          status: 500,
          ok: false,
          payload: { error: "INTERNAL_SERVER_ERROR" },
        }) as never;
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(
      () => useInspectorBootstrap({ pollIntervalMs: 50 }),
      {
        wrapper: makeWrapper(),
      },
    );

    result.current.submit({ figmaJsonPayload: '{"document":{}}' });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("failed");
    });

    if (result.current.state.kind === "failed") {
      expect(result.current.state.reason).toBe("INTERNAL_SERVER_ERROR");
      expect(result.current.state.retryable).toBe(true);
    }
  });

  it("surfaces rejected polling requests as retryable failures", async () => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-poll-throws" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-poll-throws") {
        throw new Error("network down");
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(
      () => useInspectorBootstrap({ pollIntervalMs: 50 }),
      {
        wrapper: makeWrapper(),
      },
    );

    result.current.submit({ figmaJsonPayload: '{"document":{}}' });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("failed");
    });

    if (result.current.state.kind === "failed") {
      expect(result.current.state.reason).toBe("POLL_FAILED");
      expect(result.current.state.retryable).toBe(true);
    }
  });

  it("surfaces malformed polling payloads as retryable failures", async () => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-poll-malformed" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-poll-malformed") {
        return createJsonResponse({
          payload: { unexpected: true },
        }) as never;
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(
      () => useInspectorBootstrap({ pollIntervalMs: 50 }),
      {
        wrapper: makeWrapper(),
      },
    );

    result.current.submit({ figmaJsonPayload: '{"document":{}}' });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("failed");
    });

    if (result.current.state.kind === "failed") {
      expect(result.current.state.reason).toBe("POLL_FAILED");
      expect(result.current.state.retryable).toBe(true);
    }
  });
});

describe("useInspectorBootstrap — submitPaste secure context", () => {
  it.each(["drop", "upload"] as const)(
    "submitPaste with source='%s' does NOT short-circuit even when isSecureContext is false",
    async (source) => {
      // Simulate insecure context
      const originalIsSecureContext = window.isSecureContext;
      Object.defineProperty(window, "isSecureContext", {
        value: false,
        configurable: true,
      });

      fetchJsonMock.mockImplementation(async ({ url }) => {
        if (url === "/workspace/submit") {
          return createJsonResponse({
            status: 202,
            payload: { jobId: `job-${source}` },
          }) as never;
        }
        if (url === `/workspace/jobs/job-${source}`) {
          return createJsonResponse({
            payload: { jobId: `job-${source}`, status: "queued" },
          }) as never;
        }
        throw new Error(`Unexpected url: ${url}`);
      });

      const { result } = renderHook(
        () => useInspectorBootstrap({ pollIntervalMs: 50 }),
        { wrapper: makeWrapper() },
      );

      result.current.submitPaste('{"document":{}}', { source });

      // submitPaste now dispatches intent_detected first; confirm to proceed
      await waitFor(() => {
        expect(result.current.state.kind).toBe("detected");
      });

      await act(async () => {
        result.current.confirmIntent("FIGMA_JSON_DOC");
      });

      await waitFor(() => {
        expect(result.current.state.kind).toBe("queued");
      });

      // Restore
      Object.defineProperty(window, "isSecureContext", {
        value: originalIsSecureContext,
        configurable: true,
      });
    },
  );

  it("submitPaste with source='clipboard-api' short-circuits to failed when isSecureContext is false", async () => {
    const originalIsSecureContext = window.isSecureContext;
    Object.defineProperty(window, "isSecureContext", {
      value: false,
      configurable: true,
    });

    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      result.current.submitPaste('{"document":{}}', {
        source: "clipboard-api",
      });
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("failed");
    });

    if (result.current.state.kind === "failed") {
      expect(result.current.state.reason).toBe("SECURE_CONTEXT_MISSING");
      expect(result.current.state.retryable).toBe(false);
    }

    Object.defineProperty(window, "isSecureContext", {
      value: originalIsSecureContext,
      configurable: true,
    });
  });
});

describe("useInspectorBootstrap — submitPaste classifier fast-reject", () => {
  it("empty string short-circuits to EMPTY_INPUT without calling fetchJson", async () => {
    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      result.current.submitPaste("");
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("failed");
    });

    if (result.current.state.kind === "failed") {
      expect(result.current.state.reason).toBe("EMPTY_INPUT");
      expect(result.current.state.retryable).toBe(true);
    }
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("non-JSON text dispatches intent_detected with RAW_CODE_OR_TEXT without calling fetchJson", async () => {
    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      result.current.submitPaste("hello");
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("detected");
    });

    if (result.current.state.kind === "detected") {
      expect(result.current.state.intent).toBe("RAW_CODE_OR_TEXT");
    }
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("malformed JSON dispatches intent_detected with RAW_CODE_OR_TEXT without calling fetchJson", async () => {
    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      result.current.submitPaste("{ not valid json }");
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("detected");
    });

    if (result.current.state.kind === "detected") {
      expect(result.current.state.intent).toBe("RAW_CODE_OR_TEXT");
    }
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("valid JSON dispatches intent_detected then calls fetchJson after confirmIntent", async () => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-classifier" },
        }) as never;
      }
      if (url === "/workspace/jobs/job-classifier") {
        return createJsonResponse({
          payload: { jobId: "job-classifier", status: "queued" },
        }) as never;
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(
      () => useInspectorBootstrap({ pollIntervalMs: 50 }),
      { wrapper: makeWrapper() },
    );

    result.current.submitPaste('{"document":{}}');

    // submitPaste dispatches intent_detected; fetchJson should not be called yet
    await waitFor(() => {
      expect(result.current.state.kind).toBe("detected");
    });
    expect(fetchJsonMock).not.toHaveBeenCalled();

    // Confirm to proceed with submission
    await act(async () => {
      result.current.confirmIntent("FIGMA_JSON_DOC");
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("queued");
    });

    expect(fetchJsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: "/workspace/submit" }),
    );
  });

  it("a second paste while detected replaces the pending payload before confirm", async () => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-second-detect" },
        }) as never;
      }
      if (url === "/workspace/jobs/job-second-detect") {
        return createJsonResponse({
          payload: { jobId: "job-second-detect", status: "queued" },
        }) as never;
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(
      () => useInspectorBootstrap({ pollIntervalMs: 50 }),
      { wrapper: makeWrapper() },
    );

    await act(async () => {
      result.current.submitPaste("hello");
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("detected");
    });

    if (result.current.state.kind === "detected") {
      expect(result.current.state.intent).toBe("RAW_CODE_OR_TEXT");
      expect(result.current.state.rawText).toBe("hello");
    }

    await act(async () => {
      result.current.submitPaste('{"document":{}}');
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("detected");
    });

    if (result.current.state.kind === "detected") {
      expect(result.current.state.intent).toBe("FIGMA_JSON_DOC");
      expect(result.current.state.rawText).toBe('{"document":{}}');
    }

    await act(async () => {
      result.current.confirmIntent("FIGMA_JSON_DOC");
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("queued");
    });

    const submitCall = fetchJsonMock.mock.calls.find(
      ([request]) => request.url === "/workspace/submit",
    );
    expect(submitCall).toBeDefined();
    const submitRequest = submitCall?.[0];
    expect(typeof submitRequest?.init?.body).toBe("string");
    const submitBody = JSON.parse(
      submitRequest?.init?.body as string,
    ) as Record<string, unknown>;
    expect(submitBody).toMatchObject({
      figmaJsonPayload: '{"document":{}}',
      figmaSourceMode: "figma_paste",
      importIntent: "FIGMA_JSON_DOC",
      originalIntent: "FIGMA_JSON_DOC",
      intentCorrected: false,
    });
  });

  it("confirming RAW_CODE_OR_TEXT shows guidance instead of submitting to figma_paste", async () => {
    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      result.current.submitPaste("hello world");
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("detected");
    });

    await act(async () => {
      result.current.confirmIntent("RAW_CODE_OR_TEXT");
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("failed");
    });

    if (result.current.state.kind === "failed") {
      expect(result.current.state.reason).toBe("UNSUPPORTED_TEXT_PASTE");
      expect(result.current.state.retryable).toBe(false);
    }
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("confirming FIGMA_PLUGIN_ENVELOPE submits figma_plugin", async () => {
    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      result.current.submitPaste(
        '{"kind":"workspace-dev/figma-selection@1","pluginVersion":"0.1.0","copiedAt":"2026-04-12T18:00:00.000Z","selections":[{"document":{"id":"1:2","type":"FRAME","name":"Card"},"components":{},"componentSets":{},"styles":{}}]}',
      );
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("detected");
    });

    if (result.current.state.kind === "detected") {
      expect(result.current.state.intent).toBe("FIGMA_PLUGIN_ENVELOPE");
    }

    await act(async () => {
      result.current.confirmIntent("FIGMA_PLUGIN_ENVELOPE");
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("queued");
    });

    const submitCall = fetchJsonMock.mock.calls.find(
      ([request]) => request.url === "/workspace/submit",
    );
    expect(submitCall).toBeDefined();
    const submitRequest = submitCall?.[0];
    expect(typeof submitRequest?.init?.body).toBe("string");
    const submitBody = JSON.parse(
      submitRequest?.init?.body as string,
    ) as Record<string, unknown>;
    expect(submitBody).toMatchObject({
      figmaSourceMode: "figma_plugin",
      importIntent: "FIGMA_PLUGIN_ENVELOPE",
      originalIntent: "FIGMA_PLUGIN_ENVELOPE",
      intentCorrected: false,
    });
  });

  it("confirming an uncorrected plugin export shows guidance instead of submitting to figma_paste", async () => {
    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      result.current.submitPaste('{"type":"PLUGIN_EXPORT","nodes":[]}');
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("detected");
    });

    await act(async () => {
      result.current.confirmIntent("FIGMA_JSON_NODE_BATCH");
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("failed");
    });

    if (result.current.state.kind === "failed") {
      expect(result.current.state.reason).toBe("UNSUPPORTED_PLUGIN_EXPORT");
      expect(result.current.state.retryable).toBe(false);
    }
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});

describe("useInspectorBootstrap — reportInputError", () => {
  it("reportInputError('UNSUPPORTED_FILE') transitions to failed with retryable=true", async () => {
    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.state.kind).toBe("idle");

    await act(async () => {
      result.current.reportInputError("UNSUPPORTED_FILE");
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("failed");
    });

    if (result.current.state.kind === "failed") {
      expect(result.current.state.reason).toBe("UNSUPPORTED_FILE");
      expect(result.current.state.retryable).toBe(true);
    }
  });
});
