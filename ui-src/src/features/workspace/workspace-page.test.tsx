import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJson, type JsonResponse } from "../../lib/http";
import { WorkspacePage } from "./workspace-page";

vi.mock("../../lib/http", () => ({
  fetchJson: vi.fn()
}));

const fetchJsonMock = vi.mocked(fetchJson);

interface MockRuntimeStatusPayload {
  running: boolean;
  url: string;
  host: string;
  port: number;
  figmaSourceMode: "rest" | "hybrid" | "local_json";
  llmCodegenMode: "deterministic";
  uptimeMs: number;
  outputRoot: string;
  previewEnabled: boolean;
}

const runtimeStatusPayload: MockRuntimeStatusPayload = {
  running: true,
  url: "http://127.0.0.1:1983",
  host: "127.0.0.1",
  port: 1983,
  figmaSourceMode: "rest",
  llmCodegenMode: "deterministic",
  uptimeMs: 120_000,
  outputRoot: "/tmp/workspace-dev",
  previewEnabled: true
};

function createJsonResponse<TPayload>({
  status = 200,
  ok = true,
  payload
}: {
  status?: number;
  ok?: boolean;
  payload: TPayload;
}): JsonResponse<TPayload> {
  return {
    status,
    ok,
    payload
  };
}

function parseJsonBody({ init }: { init: RequestInit | undefined }): Record<string, unknown> {
  if (typeof init?.body !== "string") {
    throw new Error("Expected a JSON request body.");
  }

  const parsed = JSON.parse(init.body) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected request body to parse to an object.");
  }

  return parsed as Record<string, unknown>;
}

function renderWorkspacePage(): void {
  window.history.pushState({}, "", "/workspace/ui");

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity
      },
      mutations: {
        retry: false
      }
    }
  });

  const router = createMemoryRouter(
    [
      {
        path: "/workspace/ui",
        element: <WorkspacePage />
      },
      {
        path: "*",
        element: <WorkspacePage />
      }
    ],
    {
      initialEntries: ["/workspace/ui"]
    }
  );

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe("WorkspacePage", () => {
  let submittedPayloads: Record<string, unknown>[];

  beforeEach(() => {
    submittedPayloads = [];

    fetchJsonMock.mockImplementation(async ({ url, init }) => {
      if (url === "/healthz") {
        return createJsonResponse({ payload: { status: "ok" } }) as never;
      }

      if (url === "/workspace") {
        return createJsonResponse({ payload: runtimeStatusPayload }) as never;
      }

      if (url === "/workspace/submit") {
        submittedPayloads.push(parseJsonBody({ init }));
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-123" }
        }) as never;
      }

      if (url === "/workspace/jobs/job-123") {
        return createJsonResponse({
          payload: {
            jobId: "job-123",
            status: "queued"
          }
        }) as never;
      }

      throw new Error(`Unexpected fetchJson url: ${url}`);
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows REST fields by default and renders a Local JSON mode chip", () => {
    renderWorkspacePage();

    expect(screen.getByLabelText("Figma File Key")).toBeVisible();
    expect(screen.getByLabelText("Figma Access Token")).toBeVisible();
    expect(screen.queryByLabelText("Figma JSON Path")).not.toBeInTheDocument();
    expect(screen.getByText("REST mode")).toHaveClass("border");
    expect(screen.getByText("Local JSON mode")).toBeInTheDocument();
  });

  it("shows figmaJsonPath and activates the Local JSON chip when local_json is selected", async () => {
    renderWorkspacePage();

    fireEvent.change(screen.getByLabelText("Source mode"), {
      target: { value: "local_json" }
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Figma JSON Path")).toBeVisible();
    });

    expect(screen.queryByLabelText("Figma File Key")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Figma Access Token")).not.toBeInTheDocument();
    expect(screen.getByText("Local JSON mode")).toHaveClass("border");
  });

  it("restores REST-only fields when switching from local_json to hybrid", async () => {
    renderWorkspacePage();

    fireEvent.change(screen.getByLabelText("Source mode"), {
      target: { value: "local_json" }
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Figma JSON Path")).toBeVisible();
    });

    fireEvent.change(screen.getByLabelText("Source mode"), {
      target: { value: "hybrid" }
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Figma File Key")).toBeVisible();
    });

    expect(screen.getByLabelText("Figma Access Token")).toBeVisible();
    expect(screen.queryByLabelText("Figma JSON Path")).not.toBeInTheDocument();
    expect(screen.getByText("Hybrid mode")).toHaveClass("border");
  });

  it("submits local_json payloads without REST-only fields even when stale values exist", async () => {
    renderWorkspacePage();

    fireEvent.change(screen.getByLabelText("Figma File Key"), {
      target: { value: "stale-file-key" }
    });
    fireEvent.change(screen.getByLabelText("Figma Access Token"), {
      target: { value: "stale-access-token" }
    });
    fireEvent.change(screen.getByLabelText("Source mode"), {
      target: { value: "local_json" }
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Figma JSON Path")).toBeVisible();
    });

    fireEvent.change(screen.getByLabelText("Figma JSON Path"), {
      target: { value: " /data/figma-export.json " }
    });

    const form = document.getElementById("workspace-submit-form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Expected workspace submit form to be rendered.");
    }

    fireEvent.submit(form);

    await waitFor(() => {
      expect(submittedPayloads).toHaveLength(1);
    });

    expect(submittedPayloads[0]).toMatchObject({
      figmaSourceMode: "local_json",
      figmaJsonPath: "/data/figma-export.json",
      enableGitPr: false,
      llmCodegenMode: "deterministic"
    });
    expect(submittedPayloads[0]).not.toHaveProperty("figmaFileKey");
    expect(submittedPayloads[0]).not.toHaveProperty("figmaAccessToken");
  });
});
