import type { JSX, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJson, type JsonResponse } from "../../../lib/http";
import { useInspectorBootstrap } from "./useInspectorBootstrap";
import {
  __resetFigmaMcpCallCounterForTests,
  getQuotaSnapshot,
} from "./figma-mcp-call-counter";
import {
  __resetIntentClassificationMetricsForTests,
  getIntentClassificationMetricsSnapshot,
} from "./intent-classification-metrics";

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

function buildFigmaClipboardHtml(): string {
  const encoded = btoa(
    JSON.stringify({ fileKey: "abc123XYZ", pasteID: 42, dataType: "scene" }),
  );
  return `<span data-metadata="<!--(figmeta)${encoded}(/figmeta)-->"></span>`;
}

function parseRequestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== "string") {
    throw new Error("Expected a JSON request body.");
  }

  const parsed = JSON.parse(init.body) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected request body to parse to an object.");
  }

  return parsed as Record<string, unknown>;
}

beforeEach(() => {
  __resetIntentClassificationMetricsForTests();
  __resetFigmaMcpCallCounterForTests();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  __resetIntentClassificationMetricsForTests();
  __resetFigmaMcpCallCounterForTests();
});

describe("useInspectorBootstrap", () => {
  it("runs confirmed direct JSON imports through the live pipeline and reaches ready", async () => {
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
              stages: [
                { name: "figma.source", status: "completed" },
                { name: "ir.derive", status: "completed" },
                { name: "template.prepare", status: "completed" },
                { name: "codegen.generate", status: "running" },
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
            ],
          },
        }) as never;
      }

      if (
        url === "/workspace/jobs/job-happy/design-ir" ||
        url === "/workspace/jobs/job-happy/component-manifest"
      ) {
        return createJsonResponse({
          payload: { jobId: "job-happy", screens: [] },
        }) as never;
      }

      if (url === "/workspace/jobs/job-happy/files") {
        return createJsonResponse({
          payload: { files: [] },
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

    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.submitPaste(buildDirectJsonPayload());
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("detected");
    });

    act(() => {
      result.current.confirmIntent("FIGMA_JSON_DOC");
    });

    await waitFor(
      () => {
        expect(result.current.state.kind).toBe("ready");
      },
      { timeout: 5000 },
    );

    expect(result.current.jobId).toBe("job-happy");
    expect(result.current.previewUrl).toBe("http://127.0.0.1:1983/preview");
    expect(getQuotaSnapshot().callsThisMonth).toBe(0);
  });

  it("uses figma_plugin mode for confirmed plugin envelopes", async () => {
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

    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.submitPaste(buildPluginEnvelopePayload());
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("detected");
    });

    act(() => {
      result.current.confirmIntent("FIGMA_PLUGIN_ENVELOPE");
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });
  });

  it("switches replay paths from selected to server-accepted pipeline id", async () => {
    const submitBodies: Record<string, unknown>[] = [];
    let submitCount = 0;

    fetchJsonMock.mockImplementation(async ({ url, init }) => {
      if (url === "/workspace/submit") {
        submitCount += 1;
        submitBodies.push(parseRequestBody(init));
        if (submitCount === 1) {
          return createJsonResponse({
            status: 500,
            ok: false,
            payload: { error: "SERVER_ERROR" },
          }) as never;
        }

        return createJsonResponse({
          status: 202,
          payload: {
            jobId: `job-${submitCount}`,
            pipelineId: "pipe-alt",
            pipelineMetadata: {
              pipelineId: "pipe-alt",
              pipelineDisplayName: "Pipeline Alt",
              templateBundleId: "template-alt",
              buildProfile: "default,rocket",
              deterministic: true,
            },
          },
        }) as never;
      }

      const jobMatch = url.match(/^\/workspace\/jobs\/(job-\d+)$/);
      if (jobMatch) {
        return createJsonResponse({
          payload: {
            jobId: jobMatch[1],
            pipelineId: "pipe-alt",
            pipelineMetadata: {
              pipelineId: "pipe-alt",
              pipelineDisplayName: "Pipeline Alt",
              templateBundleId: "template-alt",
              buildProfile: "default,rocket",
              deterministic: true,
            },
            status: "completed",
            preview: { url: `http://127.0.0.1:1983/${jobMatch[1]}` },
          },
        }) as never;
      }

      const artifactMatch = url.match(
        /^\/workspace\/jobs\/(job-\d+)\/(design-ir|component-manifest|files)$/,
      );
      if (artifactMatch) {
        return createJsonResponse({
          payload: { jobId: artifactMatch[1], screens: [], files: [] },
        }) as never;
      }

      if (url.match(/^\/workspace\/jobs\/(job-\d+)\/screenshot$/)) {
        return createJsonResponse({
          status: 404,
          ok: false,
          payload: {},
        }) as never;
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(
      () =>
        useInspectorBootstrap({
          availablePipelines: [
            { id: "pipe-default", displayName: "Pipeline Default" },
            { id: "pipe-alt", displayName: "Pipeline Alt" },
          ],
          defaultPipelineId: "pipe-default",
        }),
      {
        wrapper: makeWrapper(),
      },
    );

    expect(result.current.selectedPipelineId).toBe("pipe-default");

    act(() => {
      result.current.submit({ figmaJsonPayload: buildDirectJsonPayload() });
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("failed");
    });

    expect(submitBodies[0]?.pipelineId).toBe("pipe-default");

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });

    expect(submitBodies[1]?.pipelineId).toBe("pipe-default");
    expect(result.current.pipelineState.pipelineId).toBe("pipe-alt");
    expect(
      result.current.pipelineState.pipelineMetadata?.pipelineDisplayName,
    ).toBe("Pipeline Alt");

    act(() => {
      result.current.resubmitFresh();
    });

    await waitFor(() => {
      expect(submitBodies).toHaveLength(3);
    });

    expect(submitBodies[2]?.pipelineId).toBe("pipe-alt");

    act(() => {
      result.current.regenerateScoped({
        selectedNodeIds: ["node-1"],
        importMode: "delta",
      });
    });

    await waitFor(() => {
      expect(submitBodies).toHaveLength(4);
    });

    expect(submitBodies[3]?.pipelineId).toBe("pipe-alt");
    expect(submitBodies[3]?.selectedNodeIds).toEqual(["node-1"]);
    expect(submitBodies[3]?.importMode).toBe("delta");
  });

  it("routes plugin-shaped JSON node batches through figma_paste (regression for #1105)", async () => {
    const pluginShapedPayload = JSON.stringify({
      type: "PLUGIN_EXPORT",
      nodes: [{ type: "FRAME", name: "Card" }],
    });

    fetchJsonMock.mockImplementation(async ({ url, init }) => {
      if (url === "/workspace/submit") {
        expect(init?.body).toBe(
          JSON.stringify({
            figmaSourceMode: "figma_paste",
            figmaJsonPayload: pluginShapedPayload,
            enableGitPr: false,
            llmCodegenMode: "deterministic",
          }),
        );
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-plugin-shape" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-plugin-shape") {
        return createJsonResponse({
          payload: {
            jobId: "job-plugin-shape",
            status: "completed",
            preview: { url: "http://127.0.0.1:1983/plugin-shape-preview" },
          },
        }) as never;
      }

      if (
        url === "/workspace/jobs/job-plugin-shape/design-ir" ||
        url === "/workspace/jobs/job-plugin-shape/component-manifest"
      ) {
        return createJsonResponse({
          payload: { jobId: "job-plugin-shape", screens: [] },
        }) as never;
      }

      if (url === "/workspace/jobs/job-plugin-shape/files") {
        return createJsonResponse({
          payload: { files: [] },
        }) as never;
      }

      if (url === "/workspace/jobs/job-plugin-shape/screenshot") {
        return createJsonResponse({
          status: 404,
          ok: false,
          payload: {},
        }) as never;
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.submitPaste(pluginShapedPayload);
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("detected");
    });

    if (result.current.state.kind === "detected") {
      expect(result.current.state.intent).toBe("FIGMA_JSON_NODE_BATCH");
      expect(result.current.state.suggestedJobSource).toBe("figma_paste");
    }

    act(() => {
      result.current.confirmIntent("FIGMA_JSON_NODE_BATCH");
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });

    expect(result.current.jobId).toBe("job-plugin-shape");
    expect(result.current.previewUrl).toBe(
      "http://127.0.0.1:1983/plugin-shape-preview",
    );
  });

  it("keeps partial jobs in partial bootstrap state instead of collapsing to ready", async () => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-partial" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-partial") {
        return createJsonResponse({
          payload: {
            jobId: "job-partial",
            status: "partial",
            outcome: "partial",
            inspector: {
              outcome: "partial",
              fallbackMode: "rest",
              stages: [
                { stage: "figma.source", status: "completed" },
                { stage: "ir.derive", status: "completed" },
                {
                  stage: "codegen.generate",
                  status: "failed",
                  code: "CODEGEN_PARTIAL",
                  message: "One file failed to generate.",
                  retryable: true,
                },
              ],
            },
            error: {
              code: "CODEGEN_PARTIAL",
              stage: "codegen.generate",
              message: "One file failed to generate.",
              retryable: true,
              fallbackMode: "rest",
            },
          },
        }) as never;
      }

      if (
        url === "/workspace/jobs/job-partial/design-ir" ||
        url === "/workspace/jobs/job-partial/component-manifest"
      ) {
        return createJsonResponse({
          payload: { jobId: "job-partial", screens: [] },
        }) as never;
      }

      if (url === "/workspace/jobs/job-partial/files") {
        return createJsonResponse({
          payload: { files: [{ path: "src/App.tsx", sizeBytes: 128 }] },
        }) as never;
      }

      if (url === "/workspace/jobs/job-partial/screenshot") {
        return createJsonResponse({
          payload: { screenshotUrl: "http://127.0.0.1:1983/partial-shot.png" },
        }) as never;
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.submit({ figmaJsonPayload: buildDirectJsonPayload() });
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("partial");
    });

    if (result.current.state.kind === "partial") {
      expect(result.current.state.jobId).toBe("job-partial");
      expect(result.current.state.fallbackMode).toBe("rest");
    }
    expect(getQuotaSnapshot().callsThisMonth).toBe(0);
  });

  it("counts server-reported MCP tool usage for completed MCP-backed jobs", async () => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-count-ready" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-count-ready") {
        return createJsonResponse({
          payload: {
            jobId: "job-count-ready",
            status: "completed",
            inspector: {
              mcpCallsConsumed: 3,
              stages: [],
            },
            preview: { url: "http://127.0.0.1:1983/count-ready" },
          },
        }) as never;
      }

      if (
        url === "/workspace/jobs/job-count-ready/design-ir" ||
        url === "/workspace/jobs/job-count-ready/component-manifest"
      ) {
        return createJsonResponse({
          payload: { jobId: "job-count-ready", screens: [] },
        }) as never;
      }

      if (url === "/workspace/jobs/job-count-ready/files") {
        return createJsonResponse({
          payload: { files: [] },
        }) as never;
      }

      if (url === "/workspace/jobs/job-count-ready/screenshot") {
        return createJsonResponse({
          status: 404,
          ok: false,
          payload: {},
        }) as never;
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.submitUrl("ABC123fileKey", "1:2");
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });

    expect(getQuotaSnapshot().callsThisMonth).toBe(3);
  });

  it("counts server-reported MCP tool usage for terminal MCP-backed failures", async () => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-count-failed" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-count-failed") {
        return createJsonResponse({
          payload: {
            jobId: "job-count-failed",
            status: "failed",
            inspector: {
              mcpCallsConsumed: 2,
              stages: [],
            },
            error: {
              stage: "figma.source",
              code: "MCP_SOURCE_FAILED",
              message: "Figma MCP source stage failed.",
              retryable: true,
            },
          },
        }) as never;
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.submitUrl("ABC123fileKey", "1:2");
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("failed");
    }, { timeout: 5000 });

    expect(getQuotaSnapshot().callsThisMonth).toBe(2);
  });

  it("does not count failed jobs when the backend reports no MCP usage", async () => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-no-mcp-usage" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-no-mcp-usage") {
        return createJsonResponse({
          payload: {
            jobId: "job-no-mcp-usage",
            status: "failed",
            error: {
              stage: "figma.source",
              code: "MCP_USAGE_UNKNOWN",
              message: "Backend failed before MCP usage could be projected.",
              retryable: true,
            },
          },
        }) as never;
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.submitUrl("ABC123fileKey", "1:2");
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("failed");
    });

    expect(getQuotaSnapshot().callsThisMonth).toBe(0);
  });

  it("fails fast for raw Figma clipboard HTML without a JSON payload", async () => {
    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.submitPaste("", {
        clipboardHtml: buildFigmaClipboardHtml(),
      });
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("failed");
    });

    if (result.current.state.kind === "failed") {
      expect(result.current.state.reason).toBe(
        "UNSUPPORTED_FIGMA_CLIPBOARD_HTML",
      );
      expect(result.current.state.retryable).toBe(false);
    }
  });

  it("retry() restarts the last pipeline-backed submission", async () => {
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

    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.submit({ figmaJsonPayload: buildDirectJsonPayload() });
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("failed");
    });

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });

    expect(submitCount).toBe(2);
  });

  it("preserves partial pipeline state instead of collapsing it to ready", async () => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-partial" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-partial") {
        return createJsonResponse({
          payload: {
            jobId: "job-partial",
            status: "completed",
            outcome: "partial",
            fallbackMode: "rest",
            stages: [
              { name: "figma.source", status: "completed" },
              { name: "ir.derive", status: "completed" },
              {
                name: "template.prepare",
                status: "failed",
                code: "TRANSFORM_PARTIAL",
                message: "Unsupported nodes were skipped",
                retryable: false,
              },
            ],
            error: {
              stage: "mapping",
              code: "TRANSFORM_PARTIAL",
              message: "Unsupported nodes were skipped",
              retryable: false,
              fallbackMode: "rest",
            },
          },
        }) as never;
      }

      if (
        url === "/workspace/jobs/job-partial/design-ir" ||
        url === "/workspace/jobs/job-partial/component-manifest"
      ) {
        return createJsonResponse({
          payload: { jobId: "job-partial", screens: [] },
        }) as never;
      }

      if (url === "/workspace/jobs/job-partial/files") {
        return createJsonResponse({
          payload: { files: [] },
        }) as never;
      }

      if (url === "/workspace/jobs/job-partial/screenshot") {
        return createJsonResponse({
          payload: { screenshotUrl: "http://127.0.0.1:1983/partial-shot.png" },
        }) as never;
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.submit({ figmaJsonPayload: buildDirectJsonPayload() });
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("partial");
    });

    if (result.current.state.kind === "partial") {
      expect(result.current.state.jobId).toBe("job-partial");
      expect(result.current.state.fallbackMode).toBe("rest");
    }
  });

  it("submitUrl sends figma_url source mode with the encoded file key and node id", async () => {
    let capturedBody: string | null = null;

    fetchJsonMock.mockImplementation(async ({ url, init }) => {
      if (url === "/workspace/submit") {
        capturedBody = typeof init?.body === "string" ? init.body : null;
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-url" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-url") {
        return createJsonResponse({
          payload: {
            jobId: "job-url",
            status: "completed",
            preview: { url: "http://127.0.0.1:1983/url-preview" },
          },
        }) as never;
      }

      if (
        url === "/workspace/jobs/job-url/design-ir" ||
        url === "/workspace/jobs/job-url/component-manifest"
      ) {
        return createJsonResponse({
          payload: { jobId: "job-url", screens: [] },
        }) as never;
      }

      if (url === "/workspace/jobs/job-url/files") {
        return createJsonResponse({
          payload: { files: [] },
        }) as never;
      }

      // screenshot endpoint may fire — return 404-like response
      if (url === "/workspace/jobs/job-url/screenshot") {
        return createJsonResponse({
          status: 404,
          ok: false,
          payload: {},
        }) as never;
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.setSelectedPipelineId("pipe-url");
    });

    act(() => {
      result.current.submitUrl("ABC123fileKey", "1-2");
    });

    await waitFor(
      () => {
        expect(result.current.state.kind).toBe("ready");
      },
      { timeout: 5000 },
    );

    expect(capturedBody).not.toBeNull();
    const parsedBody = JSON.parse(capturedBody!) as {
      figmaSourceMode: string;
      figmaJsonPayload: string;
      enableGitPr: boolean;
      llmCodegenMode: string;
      pipelineId?: string;
    };
    expect(parsedBody.figmaSourceMode).toBe("figma_url");
    expect(parsedBody.figmaJsonPayload).toBe(
      JSON.stringify({ figmaFileKey: "ABC123fileKey", nodeId: "1-2" }),
    );
    expect(parsedBody.enableGitPr).toBe(false);
    expect(parsedBody.pipelineId).toBe("pipe-url");
  });

  it("records a classification event for plugin-shaped JSON (high bucket)", () => {
    const pluginShapedPayload = JSON.stringify({
      type: "PLUGIN_EXPORT",
      nodes: [{ type: "FRAME", name: "Card" }],
    });

    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.submitPaste(pluginShapedPayload);
    });

    const snapshot = getIntentClassificationMetricsSnapshot();
    expect(snapshot.totalClassifications).toBe(1);
    expect(snapshot.classifications.FIGMA_JSON_NODE_BATCH.high).toBe(1);
  });

  it("records a classification event for Figma clipboard HTML (very_high bucket)", () => {
    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.submitPaste(buildDirectJsonPayload(), {
        clipboardHtml: buildFigmaClipboardHtml(),
      });
    });

    const snapshot = getIntentClassificationMetricsSnapshot();
    expect(snapshot.totalClassifications).toBe(1);
    expect(snapshot.classifications.FIGMA_JSON_NODE_BATCH.very_high).toBe(1);
  });

  it("does not record a classification when the input is empty (UNKNOWN intent)", () => {
    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.submitPaste("");
    });

    const snapshot = getIntentClassificationMetricsSnapshot();
    expect(snapshot.totalClassifications).toBe(0);
  });

  it("bypasses intent classification for programmatic submit()", async () => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-programmatic" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-programmatic") {
        return createJsonResponse({
          payload: {
            jobId: "job-programmatic",
            status: "completed",
            preview: { url: "http://127.0.0.1:1983/programmatic" },
          },
        }) as never;
      }

      if (
        url === "/workspace/jobs/job-programmatic/design-ir" ||
        url === "/workspace/jobs/job-programmatic/component-manifest"
      ) {
        return createJsonResponse({
          payload: { jobId: "job-programmatic", screens: [] },
        }) as never;
      }

      if (url === "/workspace/jobs/job-programmatic/files") {
        return createJsonResponse({
          payload: { files: [] },
        }) as never;
      }

      if (url === "/workspace/jobs/job-programmatic/screenshot") {
        return createJsonResponse({
          status: 404,
          ok: false,
          payload: {},
        }) as never;
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.submit({ figmaJsonPayload: buildDirectJsonPayload() });
    });

    expect(result.current.state.kind).not.toBe("detected");

    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });

    const snapshot = getIntentClassificationMetricsSnapshot();
    expect(snapshot.totalClassifications).toBe(0);
    expect(snapshot.totalCorrections).toBe(0);
  });

  it("preserves explicit figma_plugin source mode for programmatic submit()", async () => {
    let capturedBody: string | null = null;

    fetchJsonMock.mockImplementation(async ({ url, init }) => {
      if (url === "/workspace/submit") {
        capturedBody = typeof init?.body === "string" ? init.body : null;
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-programmatic-plugin" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-programmatic-plugin") {
        return createJsonResponse({
          payload: {
            jobId: "job-programmatic-plugin",
            status: "completed",
            preview: { url: "http://127.0.0.1:1983/programmatic-plugin" },
          },
        }) as never;
      }

      if (
        url === "/workspace/jobs/job-programmatic-plugin/design-ir" ||
        url === "/workspace/jobs/job-programmatic-plugin/component-manifest"
      ) {
        return createJsonResponse({
          payload: { jobId: "job-programmatic-plugin", screens: [] },
        }) as never;
      }

      if (url === "/workspace/jobs/job-programmatic-plugin/files") {
        return createJsonResponse({
          payload: { files: [] },
        }) as never;
      }

      if (url === "/workspace/jobs/job-programmatic-plugin/screenshot") {
        return createJsonResponse({
          status: 404,
          ok: false,
          payload: {},
        }) as never;
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.setSelectedPipelineId("pipe-plugin");
    });

    act(() => {
      result.current.submit({
        figmaJsonPayload: buildPluginEnvelopePayload(),
        sourceMode: "figma_plugin",
      });
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });

    expect(capturedBody).not.toBeNull();
    const parsedBody = JSON.parse(capturedBody!) as {
      figmaSourceMode: string;
      figmaJsonPayload: string;
      enableGitPr: boolean;
      llmCodegenMode: string;
      pipelineId?: string;
    };
    expect(parsedBody.figmaSourceMode).toBe("figma_plugin");
    expect(parsedBody.figmaJsonPayload).toBe(buildPluginEnvelopePayload());
    expect(parsedBody.enableGitPr).toBe(false);
    expect(parsedBody.pipelineId).toBe("pipe-plugin");
  });

  it("records a correction when confirmIntent changes the detected intent", async () => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-correct" },
        }) as never;
      }
      if (url === "/workspace/jobs/job-correct") {
        return createJsonResponse({
          payload: {
            jobId: "job-correct",
            status: "completed",
            preview: { url: "http://127.0.0.1:1983/correct" },
          },
        }) as never;
      }
      if (
        url === "/workspace/jobs/job-correct/design-ir" ||
        url === "/workspace/jobs/job-correct/component-manifest"
      ) {
        return createJsonResponse({
          payload: { jobId: "job-correct", screens: [] },
        }) as never;
      }
      if (url === "/workspace/jobs/job-correct/files") {
        return createJsonResponse({ payload: { files: [] } }) as never;
      }
      if (url === "/workspace/jobs/job-correct/screenshot") {
        return createJsonResponse({
          status: 404,
          ok: false,
          payload: {},
        }) as never;
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    const pluginShapedPayload = JSON.stringify({
      type: "PLUGIN_EXPORT",
      nodes: [{ type: "FRAME", name: "Card" }],
    });

    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.submitPaste(pluginShapedPayload);
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("detected");
    });

    act(() => {
      result.current.confirmIntent("FIGMA_PLUGIN_ENVELOPE");
    });

    const snapshot = getIntentClassificationMetricsSnapshot();
    expect(snapshot.totalClassifications).toBe(1);
    expect(snapshot.totalCorrections).toBe(1);
    expect(
      snapshot.corrections.FIGMA_JSON_NODE_BATCH.FIGMA_PLUGIN_ENVELOPE,
    ).toBe(1);
    expect(snapshot.misclassificationRate).toBe(1);
  });

  it("does not record a correction when confirmIntent matches the detected intent", async () => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-match" },
        }) as never;
      }
      if (url === "/workspace/jobs/job-match") {
        return createJsonResponse({
          payload: {
            jobId: "job-match",
            status: "completed",
            preview: { url: "http://127.0.0.1:1983/match" },
          },
        }) as never;
      }
      if (
        url === "/workspace/jobs/job-match/design-ir" ||
        url === "/workspace/jobs/job-match/component-manifest"
      ) {
        return createJsonResponse({
          payload: { jobId: "job-match", screens: [] },
        }) as never;
      }
      if (url === "/workspace/jobs/job-match/files") {
        return createJsonResponse({ payload: { files: [] } }) as never;
      }
      if (url === "/workspace/jobs/job-match/screenshot") {
        return createJsonResponse({
          status: 404,
          ok: false,
          payload: {},
        }) as never;
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    const { result } = renderHook(() => useInspectorBootstrap(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.submitPaste(buildDirectJsonPayload());
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("detected");
    });

    act(() => {
      result.current.confirmIntent("FIGMA_JSON_DOC");
    });

    const snapshot = getIntentClassificationMetricsSnapshot();
    expect(snapshot.totalCorrections).toBe(0);
  });
});
