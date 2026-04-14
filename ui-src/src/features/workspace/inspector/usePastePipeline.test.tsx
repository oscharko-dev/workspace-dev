import type { JSX, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson, type JsonResponse } from "../../../lib/http";
import { startPastePipeline, usePastePipeline } from "./paste-pipeline";

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

function buildDirectJsonPayload(): string {
  return JSON.stringify({
    document: {
      id: "0:0",
      type: "DOCUMENT",
      name: "Document",
      children: [],
    },
  });
}

function buildPluginEnvelopePayload(): string {
  return JSON.stringify({
    kind: "workspace-dev/figma-selection@1",
    pluginVersion: "0.1.0",
    copiedAt: "2026-04-14T08:00:00.000Z",
    selections: [
      {
        document: { id: "1:2", type: "FRAME", name: "Card" },
        components: {},
        componentSets: {},
        styles: {},
      },
    ],
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("usePastePipeline", () => {
  it("rejects invalid JSON before submitting", async () => {
    const { result } = renderHook(() => usePastePipeline(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      result.current.start("not-json");
    });

    await waitFor(() => {
      expect(result.current.state.stage).toBe("error");
    });

    expect(fetchJsonMock).not.toHaveBeenCalled();
    expect(result.current.state.errors[0]?.code).toBe("SCHEMA_MISMATCH");
    expect(result.current.state.canRetry).toBe(false);
  });

  it("submits supported payloads and reaches ready on canonical backend stages", async () => {
    let pollCount = 0;
    const callOrder: string[] = [];

    fetchJsonMock.mockImplementation(async ({ url, init }) => {
      callOrder.push(url);
      if (url === "/workspace/submit") {
        expect(init?.body).toBe(
          JSON.stringify({
            figmaSourceMode: "figma_paste",
            figmaJsonPayload: buildDirectJsonPayload(),
            enableGitPr: false,
            llmCodegenMode: "deterministic",
          }),
        );
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
              status: "queued",
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
                { name: "ir.derive", status: "completed" },
                { name: "template.prepare", status: "completed" },
                { name: "codegen.generate", status: "completed" },
                { name: "validate.project", status: "running" },
              ],
            },
          }) as never;
        }

        return createJsonResponse({
          payload: {
            jobId: "job-happy",
            status: "completed",
            preview: { url: "http://127.0.0.1:1983/preview" },
            stages: [
              { name: "figma.source", status: "completed" },
              { name: "ir.derive", status: "completed" },
              { name: "template.prepare", status: "completed" },
              { name: "codegen.generate", status: "completed" },
              { name: "validate.project", status: "completed" },
            ],
          },
        }) as never;
      }

      if (url === "/workspace/jobs/job-happy/design-ir") {
        return createJsonResponse({
          payload: {
            jobId: "job-happy",
            screens: [],
          },
        }) as never;
      }

      if (url === "/workspace/jobs/job-happy/figma-analysis") {
        return createJsonResponse({
          payload: {
            jobId: "job-happy",
            diagnostics: [],
            layoutGraph: { pages: [], frames: [] },
          },
        }) as never;
      }

      if (url === "/workspace/jobs/job-happy/component-manifest") {
        return createJsonResponse({
          payload: {
            jobId: "job-happy",
            screens: [],
          },
        }) as never;
      }

      if (url === "/workspace/jobs/job-happy/files") {
        return createJsonResponse({
          payload: {
            files: [{ path: "src/App.tsx", sizeBytes: 128 }],
          },
        }) as never;
      }

      if (url === "/workspace/jobs/job-happy/screenshot") {
        return createJsonResponse({
          status: 404,
          ok: false,
          payload: {},
        }) as never;
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() => usePastePipeline(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      result.current.start(buildDirectJsonPayload(), {
        sourceMode: "figma_paste",
      });
    });

    await waitFor(
      () => {
        expect(result.current.state.stage).toBe("ready");
      },
      { timeout: 5000 },
    );

    expect(result.current.state.previewUrl).toBe(
      "http://127.0.0.1:1983/preview",
    );
    expect(result.current.state.designIR?.jobId).toBe("job-happy");
    expect(result.current.state.figmaAnalysis?.jobId).toBe("job-happy");
    expect(result.current.state.componentManifest?.jobId).toBe("job-happy");
    expect(result.current.state.generatedFiles).toEqual([
      { path: "src/App.tsx", sizeBytes: 128 },
    ]);

    const secondPollIndex = callOrder.indexOf("/workspace/jobs/job-happy");
    const runningPollIndex = callOrder.indexOf(
      "/workspace/jobs/job-happy",
      secondPollIndex + 1,
    );
    const completedPollIndex = callOrder.lastIndexOf(
      "/workspace/jobs/job-happy",
    );
    const designIrIndex = callOrder.indexOf(
      "/workspace/jobs/job-happy/design-ir",
    );
    const figmaAnalysisIndex = callOrder.indexOf(
      "/workspace/jobs/job-happy/figma-analysis",
    );
    const manifestIndex = callOrder.indexOf(
      "/workspace/jobs/job-happy/component-manifest",
    );

    expect(runningPollIndex).toBeGreaterThan(secondPollIndex);
    expect(designIrIndex).toBeGreaterThan(runningPollIndex);
    expect(figmaAnalysisIndex).toBeGreaterThan(runningPollIndex);
    expect(manifestIndex).toBeGreaterThan(runningPollIndex);
    expect(designIrIndex).toBeLessThan(completedPollIndex);
    expect(figmaAnalysisIndex).toBeLessThan(completedPollIndex);
    expect(manifestIndex).toBeLessThan(completedPollIndex);
  });

  it("uses figma_plugin mode for plugin envelope submissions", async () => {
    fetchJsonMock.mockImplementation(async ({ url, init }) => {
      if (url === "/workspace/submit") {
        expect(init?.body).toBe(
          JSON.stringify({
            figmaSourceMode: "figma_plugin",
            figmaJsonPayload: buildPluginEnvelopePayload(),
            enableGitPr: false,
            llmCodegenMode: "deterministic",
          }),
        );
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-plugin" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-plugin") {
        return createJsonResponse({
          payload: {
            jobId: "job-plugin",
            status: "completed",
            preview: { url: "http://127.0.0.1:1983/plugin-preview" },
          },
        }) as never;
      }

      if (
        url === "/workspace/jobs/job-plugin/design-ir" ||
        url === "/workspace/jobs/job-plugin/figma-analysis" ||
        url === "/workspace/jobs/job-plugin/component-manifest"
      ) {
        return createJsonResponse({
          payload: { jobId: "job-plugin", screens: [] },
        }) as never;
      }

      if (url === "/workspace/jobs/job-plugin/files") {
        return createJsonResponse({
          payload: { files: [] },
        }) as never;
      }

      if (url === "/workspace/jobs/job-plugin/screenshot") {
        return createJsonResponse({
          status: 404,
          ok: false,
          payload: {},
        }) as never;
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() => usePastePipeline(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      result.current.start(buildPluginEnvelopePayload(), {
        sourceMode: "figma_plugin",
      });
    });

    await waitFor(() => {
      expect(result.current.state.stage).toBe("ready");
    });

    expect(result.current.state.sourceScreens).toEqual([
      { id: "1:2", name: "Card", nodeType: "frame" },
    ]);
  });

  it("retry() restarts the last supported request", async () => {
    let submitCount = 0;

    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        submitCount += 1;
        if (submitCount === 1) {
          return createJsonResponse({
            status: 500,
            ok: false,
            payload: { error: "SERVER_ERROR" },
          }) as never;
        }

        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-retry" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-retry") {
        return createJsonResponse({
          payload: {
            jobId: "job-retry",
            status: "completed",
            preview: { url: "http://127.0.0.1:1983/retry-preview" },
          },
        }) as never;
      }

      if (
        url === "/workspace/jobs/job-retry/design-ir" ||
        url === "/workspace/jobs/job-retry/figma-analysis" ||
        url === "/workspace/jobs/job-retry/component-manifest"
      ) {
        return createJsonResponse({
          payload: { jobId: "job-retry", screens: [] },
        }) as never;
      }

      if (url === "/workspace/jobs/job-retry/files") {
        return createJsonResponse({
          payload: { files: [] },
        }) as never;
      }

      if (url === "/workspace/jobs/job-retry/screenshot") {
        return createJsonResponse({
          status: 404,
          ok: false,
          payload: {},
        }) as never;
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() => usePastePipeline(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      result.current.start(buildDirectJsonPayload());
    });

    await waitFor(() => {
      expect(result.current.state.stage).toBe("error");
    });

    await act(async () => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.state.stage).toBe("ready");
    });

    expect(submitCount).toBe(2);
  });

  it("cancel() calls the server cancel endpoint for accepted jobs", async () => {
    let cancelRequestCount = 0;
    let polledAfterCancel = false;

    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-cancel" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-cancel/cancel") {
        cancelRequestCount += 1;
        return createJsonResponse({
          payload: {
            jobId: "job-cancel",
            status: "canceled",
          },
        }) as never;
      }

      if (url === "/workspace/jobs/job-cancel") {
        if (polledAfterCancel) {
          return createJsonResponse({
            payload: {
              jobId: "job-cancel",
              status: "canceled",
            },
          }) as never;
        }

        return createJsonResponse({
          payload: {
            jobId: "job-cancel",
            status: "running",
            stages: [{ name: "figma.source", status: "running" }],
          },
        }) as never;
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() => usePastePipeline(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      result.current.start(buildDirectJsonPayload());
    });

    await waitFor(() => {
      expect(result.current.state.jobId).toBe("job-cancel");
    });

    polledAfterCancel = true;

    await act(async () => {
      result.current.cancel();
    });

    await waitFor(() => {
      expect(result.current.state.stage).toBe("idle");
    });

    await act(async () => {
      result.current.cancel();
    });

    expect(
      fetchJsonMock.mock.calls.some(
        ([input]) => input.url === "/workspace/jobs/job-cancel/cancel",
      ),
    ).toBe(true);
    expect(cancelRequestCount).toBe(1);
  });

  it("startPastePipeline does not retain a stale active job after cancellation", async () => {
    let cancelRequestCount = 0;

    fetchJsonMock.mockImplementation(({ url, init }) => {
      if (url === "/workspace/submit") {
        return Promise.resolve(
          createJsonResponse({
            status: 202,
            payload: { jobId: "job-controller-cancel" },
          }),
        ) as never;
      }

      if (url === "/workspace/jobs/job-controller-cancel") {
        return new Promise((_, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () =>
              reject(
                new DOMException("The operation was aborted.", "AbortError"),
              ),
            { once: true },
          );
        }) as never;
      }

      if (url === "/workspace/jobs/job-controller-cancel/cancel") {
        cancelRequestCount += 1;
        return Promise.resolve(
          createJsonResponse({
            payload: {
              jobId: "job-controller-cancel",
              status: "canceled",
            },
          }),
        ) as never;
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    const controller = startPastePipeline(buildDirectJsonPayload());

    await waitFor(() => {
      expect(controller.getState().jobId).toBe("job-controller-cancel");
    });

    controller.cancel();

    await waitFor(() => {
      expect(controller.getState().stage).toBe("idle");
    });

    controller.cancel();

    await waitFor(() => {
      expect(cancelRequestCount).toBe(1);
    });
  });
});

describe("executionLog wiring", () => {
  it("exposes an empty executionLog on the initial hook result", () => {
    const { result } = renderHook(() => usePastePipeline(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.executionLog).toBeDefined();
    expect(result.current.executionLog.entries).toEqual([]);
  });

  it("records a single failed parsing entry when invalid JSON is submitted", async () => {
    const { result } = renderHook(() => usePastePipeline(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      result.current.start("not-json");
    });

    await waitFor(() => {
      expect(result.current.state.stage).toBe("error");
    });

    const entries = result.current.executionLog.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.stage).toBe("parsing");
    expect(entries[0]?.success).toBe(false);
    expect(typeof entries[0]?.errorCode).toBe("string");
    expect(entries[0]?.errorCode).not.toBe("");
    // No HTTP call should have been made because parsing fails client-side.
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("records parsing success followed by a failed resolving entry when submit returns 500", async () => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 500,
          ok: false,
          payload: {},
        }) as never;
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() => usePastePipeline(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      result.current.start(buildDirectJsonPayload());
    });

    await waitFor(() => {
      expect(result.current.state.stage).toBe("error");
    });

    const entries = result.current.executionLog.entries;
    expect(entries).toHaveLength(2);
    expect(entries[0]?.stage).toBe("parsing");
    expect(entries[0]?.success).toBe(true);
    expect(entries[1]?.stage).toBe("resolving");
    expect(entries[1]?.success).toBe(false);
  });

  it("clears the log at the start of each new run (no accumulation across runs)", async () => {
    const { result } = renderHook(() => usePastePipeline(), {
      wrapper: makeWrapper(),
    });

    // Run 1 — parsing failure records one entry.
    await act(async () => {
      result.current.start("not-json");
    });
    await waitFor(() => {
      expect(result.current.state.stage).toBe("error");
    });
    expect(result.current.executionLog.entries).toHaveLength(1);

    // Run 2 — another parsing failure. If the log were not cleared, we'd
    // see 2 entries; the clear() at the start of startRun guarantees 1.
    await act(async () => {
      result.current.start("not-json");
    });
    await waitFor(() => {
      expect(result.current.state.stage).toBe("error");
    });
    expect(result.current.executionLog.entries).toHaveLength(1);
  });
});
