import type { JSX, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
});
