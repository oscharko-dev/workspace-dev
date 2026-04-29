import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJson, type JsonResponse } from "../../lib/http";
import { expectNoBlockingAccessibilityViolations } from "../../test/accessibility";
import type { RuntimeStatusPayload } from "./workspace-page.helpers";
import { WorkspacePage } from "./workspace-page";

vi.mock("../../lib/http", () => ({
  fetchJson: vi.fn(),
}));

const fetchJsonMock = vi.mocked(fetchJson);

const runtimeStatusPayload: RuntimeStatusPayload = {
  running: true,
  url: "http://127.0.0.1:1983",
  host: "127.0.0.1",
  port: 1983,
  figmaSourceMode: "rest",
  llmCodegenMode: "deterministic",
  uptimeMs: 120_000,
  outputRoot: "/tmp/workspace-dev",
  previewEnabled: true,
};

function createJsonResponse<TPayload>({
  status = 200,
  ok = true,
  payload,
}: {
  status?: number;
  ok?: boolean;
  payload: TPayload;
}): JsonResponse<TPayload> {
  return {
    status,
    ok,
    payload,
  };
}

function parseJsonBody({
  init,
}: {
  init: RequestInit | undefined;
}): Record<string, unknown> {
  if (typeof init?.body !== "string") {
    throw new Error("Expected a JSON request body.");
  }

  const parsed = JSON.parse(init.body) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected request body to parse to an object.");
  }

  return parsed as Record<string, unknown>;
}

function renderWorkspacePage() {
  window.history.pushState({}, "", "/workspace/ui");

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
      mutations: {
        retry: false,
      },
    },
  });

  const router = createMemoryRouter(
    [
      {
        path: "/workspace/ui",
        element: <WorkspacePage />,
      },
      {
        path: "*",
        element: <WorkspacePage />,
      },
    ],
    {
      initialEntries: ["/workspace/ui"],
    },
  );

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return { router };
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
          payload: { jobId: "job-123" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-123") {
        return createJsonResponse({
          payload: {
            jobId: "job-123",
            status: "queued",
          },
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
    expect(
      screen.getByText(/figmaSourceMode=rest\|hybrid\|local_json/),
    ).toBeVisible();
    expect(screen.queryByText(/figma_paste/)).not.toBeInTheDocument();
    expect(screen.queryByText(/figma_plugin/)).not.toBeInTheDocument();
  });

  it("shows figmaJsonPath and activates the Local JSON chip when local_json is selected", async () => {
    renderWorkspacePage();

    fireEvent.change(screen.getByLabelText("Source mode"), {
      target: { value: "local_json" },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Figma JSON Path")).toBeVisible();
    });

    expect(screen.queryByLabelText("Figma File Key")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Figma Access Token"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Local JSON mode")).toHaveClass("border");
  });

  it("has no blocking accessibility violations in the submit form", async () => {
    renderWorkspacePage();

    const form = document.getElementById("workspace-submit-form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Expected workspace submit form to be rendered.");
    }

    await expectNoBlockingAccessibilityViolations(form);
  });

  it("renders the pipeline selector for multi-pipeline runtimes and submits the selected pipeline", async () => {
    fetchJsonMock.mockImplementation(async ({ url, init }) => {
      if (url === "/healthz") {
        return createJsonResponse({ payload: { status: "ok" } }) as never;
      }

      if (url === "/workspace") {
        return createJsonResponse({
          payload: {
            ...runtimeStatusPayload,
            defaultPipelineId: "default",
            availablePipelines: [
              { id: "default", displayName: "Default" },
              { id: "rocket", displayName: "Rocket" },
            ],
          },
        }) as never;
      }

      if (url === "/workspace/submit") {
        submittedPayloads.push(parseJsonBody({ init }));
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-123" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-123") {
        return createJsonResponse({
          payload: {
            jobId: "job-123",
            status: "queued",
          },
        }) as never;
      }

      throw new Error(`Unexpected fetchJson url: ${url}`);
    });

    renderWorkspacePage();

    const selector = await screen.findByLabelText("Pipeline");
    expect(selector).toHaveValue("default");

    fireEvent.change(selector, {
      target: { value: "rocket" },
    });
    fireEvent.change(screen.getByLabelText("Figma File Key"), {
      target: { value: "demo-file-key" },
    });
    fireEvent.change(screen.getByLabelText("Figma Access Token"), {
      target: { value: "demo-access-token" },
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
      pipelineId: "rocket",
      figmaFileKey: "demo-file-key",
      figmaAccessToken: "demo-access-token",
      figmaSourceMode: "rest",
      llmCodegenMode: "deterministic",
    });
  });

  it("does not render the pipeline selector for single-pipeline runtimes", async () => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/healthz") {
        return createJsonResponse({ payload: { status: "ok" } }) as never;
      }

      if (url === "/workspace") {
        return createJsonResponse({
          payload: {
            ...runtimeStatusPayload,
            defaultPipelineId: "default",
            availablePipelines: [{ id: "default", displayName: "Default" }],
          },
        }) as never;
      }

      throw new Error(`Unexpected fetchJson url: ${url}`);
    });

    renderWorkspacePage();

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ url: "/workspace" }),
      );
    });

    expect(screen.queryByLabelText("Pipeline")).not.toBeInTheDocument();
  });

  it("restores REST-only fields when switching from local_json to hybrid", async () => {
    renderWorkspacePage();

    fireEvent.change(screen.getByLabelText("Source mode"), {
      target: { value: "local_json" },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Figma JSON Path")).toBeVisible();
    });

    fireEvent.change(screen.getByLabelText("Source mode"), {
      target: { value: "hybrid" },
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
      target: { value: "stale-file-key" },
    });
    fireEvent.change(screen.getByLabelText("Figma Access Token"), {
      target: { value: "stale-access-token" },
    });
    fireEvent.change(screen.getByLabelText("Source mode"), {
      target: { value: "local_json" },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Figma JSON Path")).toBeVisible();
    });

    fireEvent.change(screen.getByLabelText("Figma JSON Path"), {
      target: { value: " /data/figma-export.json " },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: /advanced destination and git \/ pr options/i,
      }),
    );
    fireEvent.change(screen.getByLabelText("Storybook static dir"), {
      target: { value: " storybook-static/customer " },
    });
    fireEvent.change(screen.getByLabelText("Customer profile path"), {
      target: { value: " profiles/customer-profile.json " },
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
      storybookStaticDir: "storybook-static/customer",
      customerProfilePath: "profiles/customer-profile.json",
      enableGitPr: false,
      llmCodegenMode: "deterministic",
    });
    expect(submittedPayloads[0]).not.toHaveProperty("figmaFileKey");
    expect(submittedPayloads[0]).not.toHaveProperty("figmaAccessToken");
  });

  it("shows an Open Visual Quality action for completed jobs and navigates with the report query", async () => {
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
          payload: { jobId: "job-123" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-123") {
        return createJsonResponse({
          payload: {
            jobId: "job-123",
            status: "completed",
            preview: {
              enabled: true,
              url: "http://127.0.0.1:1983/preview",
            },
          },
        }) as never;
      }

      if (url === "/workspace/jobs/job-123/result") {
        return createJsonResponse({
          payload: {
            files: [],
          },
        }) as never;
      }

      throw new Error(`Unexpected fetchJson url: ${url}`);
    });

    const { router } = renderWorkspacePage();

    fireEvent.change(screen.getByLabelText("Figma File Key"), {
      target: { value: "demo-file-key" },
    });
    fireEvent.change(screen.getByLabelText("Figma Access Token"), {
      target: { value: "demo-access-token" },
    });

    const form = document.getElementById("workspace-submit-form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Expected workspace submit form to be rendered.");
    }

    fireEvent.submit(form);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Open Visual Quality" }),
      ).toBeVisible();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Open Visual Quality" }),
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        "/workspace/ui/visual-quality",
      );
      expect(router.state.location.search).toBe(
        "?report=%2Fworkspace%2Fjobs%2Fjob-123%2Ffiles%2Fvisual-quality%2Freport.json",
      );
    });
  });

  it("surfaces a non-accepted submit response without activating a job", async () => {
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
          status: 400,
          ok: false,
          payload: { error: "INVALID_REQUEST" },
        }) as never;
      }

      throw new Error(`Unexpected fetchJson url: ${url}`);
    });

    renderWorkspacePage();

    fireEvent.change(screen.getByLabelText("Figma File Key"), {
      target: { value: "demo-file-key" },
    });
    fireEvent.change(screen.getByLabelText("Figma Access Token"), {
      target: { value: "demo-access-token" },
    });

    const form = document.getElementById("workspace-submit-form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Expected workspace submit form to be rendered.");
    }

    fireEvent.submit(form);

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Open Inspector" }),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("submit-payload")).toHaveTextContent(
        /INVALID_REQUEST/,
      );
    });
  });

  it("refreshes runtime diagnostics on demand", async () => {
    renderWorkspacePage();

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ url: "/healthz" }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      const healthCalls = fetchJsonMock.mock.calls.filter(
        ([args]) => args?.url === "/healthz",
      );
      const workspaceCalls = fetchJsonMock.mock.calls.filter(
        ([args]) => args?.url === "/workspace",
      );
      expect(healthCalls.length).toBeGreaterThanOrEqual(2);
      expect(workspaceCalls.length).toBeGreaterThanOrEqual(2);
    });

    fireEvent.click(
      screen.getByRole("button", { name: /runtime diagnostics/i }),
    );

    expect(screen.getByTestId("runtime-payload")).toHaveTextContent(
      /"previewEnabled": true/,
    );
  });

  it("shows job diagnostics, stage fallback labels, and generation diff badges", async () => {
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
          payload: { jobId: "job-123" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-123") {
        return createJsonResponse({
          payload: {
            jobId: "job-123",
            status: "completed",
            stages: [{ name: "", status: "" }],
            preview: {
              enabled: true,
              url: "http://127.0.0.1:1983/preview",
            },
            generationDiff: {
              summary: "2 files changed",
              added: ["src/new.ts"],
              modified: [{ file: "src/changed.ts" }],
              removed: ["src/old.ts"],
              unchanged: ["src/same.ts"],
            },
          },
        }) as never;
      }

      if (url === "/workspace/jobs/job-123/result") {
        return createJsonResponse({
          payload: {
            files: [],
          },
        }) as never;
      }

      throw new Error(`Unexpected fetchJson url: ${url}`);
    });

    renderWorkspacePage();

    fireEvent.change(screen.getByLabelText("Figma File Key"), {
      target: { value: "demo-file-key" },
    });
    fireEvent.change(screen.getByLabelText("Figma Access Token"), {
      target: { value: "demo-access-token" },
    });

    const form = document.getElementById("workspace-submit-form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Expected workspace submit form to be rendered.");
    }

    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByTestId("generation-diff-summary")).toHaveTextContent(
        /2 files changed/,
      );
    });

    expect(screen.getByText("+1 added")).toBeVisible();
    expect(screen.getByText("~1 modified")).toBeVisible();
    expect(screen.getByText("-1 removed")).toBeVisible();
    expect(screen.getByText("1 unchanged")).toBeVisible();
    expect(screen.getByText("unknown")).toBeVisible();
    expect(screen.getByText("QUEUED")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /job diagnostics/i }));

    expect(screen.getByTestId("job-payload")).toHaveTextContent(
      /"status": "completed"/,
    );

    await expectNoBlockingAccessibilityViolations(
      screen.getByTestId("job-status-card"),
    );
  });

  it("cancels an active job and records the cancel response", async () => {
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
          payload: { jobId: "job-123" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-123") {
        return createJsonResponse({
          payload: {
            jobId: "job-123",
            status: "running",
            queue: {
              runningCount: 1,
              queuedCount: 0,
              maxConcurrentJobs: 2,
              maxQueuedJobs: 3,
            },
          },
        }) as never;
      }

      if (url === "/workspace/jobs/job-123/cancel") {
        submittedPayloads.push(parseJsonBody({ init }));
        return createJsonResponse({
          payload: {
            jobId: "job-123",
            status: "running",
            cancellation: {
              reason: "Cancellation requested from workspace UI.",
            },
          },
        }) as never;
      }

      throw new Error(`Unexpected fetchJson url: ${url}`);
    });

    renderWorkspacePage();

    fireEvent.change(screen.getByLabelText("Figma File Key"), {
      target: { value: "demo-file-key" },
    });
    fireEvent.change(screen.getByLabelText("Figma Access Token"), {
      target: { value: "demo-access-token" },
    });

    const form = document.getElementById("workspace-submit-form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Expected workspace submit form to be rendered.");
    }

    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel Job" })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel Job" }));

    await waitFor(() => {
      expect(screen.getByTestId("submit-payload")).toHaveTextContent(
        /Cancellation requested from workspace UI/,
      );
    });
  });

  it("opens the inspector with regeneration context when lineage is present", async () => {
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
          payload: { jobId: "job-123" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-123") {
        return createJsonResponse({
          payload: {
            jobId: "job-123",
            status: "completed",
            preview: {
              enabled: true,
              url: "http://127.0.0.1:1983/preview",
            },
            generationDiff: {
              summary: "1 file changed",
              previousJobId: "job-122",
            },
            lineage: {
              sourceJobId: "job-121",
            },
          },
        }) as never;
      }

      if (url === "/workspace/jobs/job-123/result") {
        return createJsonResponse({
          payload: {
            files: [],
          },
        }) as never;
      }

      throw new Error(`Unexpected fetchJson url: ${url}`);
    });

    const { router } = renderWorkspacePage();

    fireEvent.change(screen.getByLabelText("Figma File Key"), {
      target: { value: "demo-file-key" },
    });
    fireEvent.change(screen.getByLabelText("Figma Access Token"), {
      target: { value: "demo-access-token" },
    });

    const form = document.getElementById("workspace-submit-form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Expected workspace submit form to be rendered.");
    }

    fireEvent.submit(form);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Open Inspector" }),
      ).toBeVisible();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open Inspector" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/workspace/ui/inspector");
      expect(router.state.location.search).toContain("jobId=job-123");
      expect(router.state.location.search).toContain("previousJobId=job-122");
      expect(router.state.location.search).toContain("isRegeneration=true");
    });
  });
});
