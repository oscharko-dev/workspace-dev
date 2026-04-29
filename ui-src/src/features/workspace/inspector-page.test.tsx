import type { JSX, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InspectorPage } from "./inspector-page";
import { fetchJson, type JsonResponse } from "../../lib/http";

vi.mock("./inspector/InspectorPanel", () => ({
  InspectorPanel: ({
    jobId,
    previewUrl,
    previousJobId,
    isRegenerationJob,
    openDialog,
    onCloseDialog,
    onRegenerationAccepted,
    importHistory,
    onReimportSession,
  }: {
    jobId: string;
    previewUrl: string;
    previousJobId?: string | null;
    isRegenerationJob: boolean;
    openDialog: string | null;
    onCloseDialog: () => void;
    onRegenerationAccepted: (nextJobId: string) => void;
    importHistory?: Array<{ id: string }>;
    onReimportSession?: (session: { id: string }) => void;
  }): JSX.Element => (
    <div>
      <div data-testid="inspector-layout">mock-inspector-layout</div>
      <div data-testid="inspector-panel-props">
        {[
          jobId,
          previewUrl,
          previousJobId ?? "",
          String(isRegenerationJob),
          openDialog ?? "",
        ].join("|")}
      </div>
      <button type="button" onClick={() => onRegenerationAccepted("job-2")}>
        Accept regeneration
      </button>
      {importHistory && importHistory.length > 0 && onReimportSession ? (
        <button
          type="button"
          onClick={() => onReimportSession(importHistory[0]!)}
        >
          Reimport history session
        </button>
      ) : null}
      <button type="button" onClick={onCloseDialog}>
        Close dialog
      </button>
    </div>
  ),
}));

vi.mock("./inspector/InspectorErrorBoundary", () => ({
  InspectorErrorBoundary: ({ children }: { children: JSX.Element }) => children,
}));

vi.mock("../../lib/http", () => ({
  fetchJson: vi.fn(),
}));

const fetchJsonMock = vi.mocked(fetchJson);

const runtimeStatusPayload = {
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

function LocationProbe(): JSX.Element {
  const location = useLocation();
  return (
    <div data-testid="location-probe">
      {location.pathname}
      {location.search}
    </div>
  );
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function Providers({ children }: { children: ReactNode }): JSX.Element {
  return (
    <QueryClientProvider client={makeQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

function renderPage(initialEntry: string): void {
  render(
    <Providers>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/workspace/ui/inspector"
            element={
              <>
                <InspectorPage />
                <LocationProbe />
              </>
            }
          />
          <Route path="/workspace/ui" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </Providers>,
  );
}

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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InspectorPage — deep-link path", () => {
  it("passes search-param state into the inspector panel and updates regeneration job id", () => {
    renderPage(
      "/workspace/ui/inspector?jobId=job-1&previewUrl=http%3A%2F%2F127.0.0.1%3A1983%2Fpreview&previousJobId=job-0&isRegeneration=true",
    );

    expect(screen.getByTestId("inspector-panel-props")).toHaveTextContent(
      "job-1|http://127.0.0.1:1983/preview|job-0|true|",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Accept regeneration" }),
    );
    expect(screen.getByTestId("inspector-panel-props")).toHaveTextContent(
      "job-2|http://127.0.0.1:1983/preview|job-0|true|",
    );

    fireEvent.click(screen.getByRole("button", { name: "PR" }));
    expect(screen.getByTestId("inspector-panel-props")).toHaveTextContent(
      "job-2|http://127.0.0.1:1983/preview|job-0|true|createPr",
    );

    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(screen.getByTestId("inspector-panel-props")).toHaveTextContent(
      "job-2|http://127.0.0.1:1983/preview|job-0|true|",
    );
  });
});

describe("InspectorPage — bootstrap path", () => {
  beforeEach(() => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace") {
        return createJsonResponse({ payload: runtimeStatusPayload }) as never;
      }

      throw new Error(`Unexpected url: ${url}`);
    });
  });

  it("renders InspectorBootstrap when no query params", () => {
    renderPage("/workspace/ui/inspector");

    expect(screen.getByTestId("inspector-bootstrap")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-bootstrap-left")).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-bootstrap-center"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("inspector-bootstrap-right")).toBeInTheDocument();
    expect(screen.queryByTestId("inspector-layout")).not.toBeInTheDocument();
  });

  it("renders InspectorBootstrap when only one of jobId/previewUrl is provided", () => {
    renderPage("/workspace/ui/inspector?jobId=job-1");

    expect(screen.getByTestId("inspector-bootstrap")).toBeInTheDocument();
    expect(screen.queryByTestId("inspector-layout")).not.toBeInTheDocument();
  });

  it("transitions from bootstrap to panel when bootstrap reaches ready", async () => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace") {
        return createJsonResponse({ payload: runtimeStatusPayload }) as never;
      }
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-bootstrap" },
        }) as never;
      }
      if (url === "/workspace/jobs/job-bootstrap") {
        return createJsonResponse({
          payload: {
            jobId: "job-bootstrap",
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
        url === "/workspace/jobs/job-bootstrap/design-ir" ||
        url === "/workspace/jobs/job-bootstrap/component-manifest"
      ) {
        return createJsonResponse({
          payload: { jobId: "job-bootstrap", screens: [] },
        }) as never;
      }
      if (url === "/workspace/jobs/job-bootstrap/files") {
        return createJsonResponse({
          payload: { files: [] },
        }) as never;
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    renderPage("/workspace/ui/inspector");

    const textarea = screen.getByLabelText(/figma clipboard paste target/i);
    const clipboardData = {
      getData: (type: string) =>
        type === "text" || type === "text/plain" ? '{"document":{}}' : "",
    } as unknown as DataTransfer;
    fireEvent.paste(textarea, { clipboardData });

    // submitPaste dispatches intent_detected; SmartBanner appears — confirm to proceed
    await waitFor(() => {
      expect(screen.getByTestId("smart-banner")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Import starten"));

    await waitFor(
      () => {
        expect(screen.getByTestId("inspector-layout")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );

    expect(screen.queryByTestId("inspector-bootstrap")).not.toBeInTheDocument();
    expect(screen.getByTestId("inspector-panel-props")).toHaveTextContent(
      "job-bootstrap|http://127.0.0.1:1983/preview||false|",
    );
  });

  it("enters the inspector panel while the pipeline is still processing", async () => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace") {
        return createJsonResponse({ payload: runtimeStatusPayload }) as never;
      }
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-processing" },
        }) as never;
      }
      if (url === "/workspace/jobs/job-processing") {
        return createJsonResponse({
          payload: {
            jobId: "job-processing",
            status: "running",
            stages: [{ name: "figma.source", status: "completed" }],
          },
        }) as never;
      }
      if (
        url === "/workspace/jobs/job-processing/design-ir" ||
        url === "/workspace/jobs/job-processing/component-manifest" ||
        url === "/workspace/jobs/job-processing/files" ||
        url === "/workspace/jobs/job-processing/screenshot"
      ) {
        return createJsonResponse({
          status: 409,
          ok: false,
          payload: { error: "JOB_NOT_COMPLETED" },
        }) as never;
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    renderPage("/workspace/ui/inspector");

    const textarea = screen.getByLabelText(/figma clipboard paste target/i);
    const clipboardData = {
      getData: (type: string) =>
        type === "text" || type === "text/plain" ? '{"document":{}}' : "",
    } as unknown as DataTransfer;
    fireEvent.paste(textarea, { clipboardData });

    await waitFor(() => {
      expect(screen.getByTestId("smart-banner")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Import starten"));

    await waitFor(() => {
      expect(screen.getByTestId("inspector-layout")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("inspector-bootstrap")).not.toBeInTheDocument();
    expect(screen.getByTestId("inspector-panel-props")).toHaveTextContent(
      "job-processing|||false|",
    );
  });

  it("reimports history entries through the server-owned replay endpoint", async () => {
    fetchJsonMock.mockImplementation(async ({ url, init }) => {
      if (url === "/workspace") {
        return createJsonResponse({ payload: runtimeStatusPayload }) as never;
      }
      if (url === "/workspace/import-sessions") {
        return createJsonResponse({
          payload: {
            sessions: [
              {
                id: "session-1",
                fileKey: "FILE",
                nodeId: "1:2",
                nodeName: "Home",
                importedAt: "2026-04-15T10:00:00.000Z",
                nodeCount: 5,
                fileCount: 2,
                selectedNodes: [],
                scope: "all",
                componentMappings: 1,
                pasteIdentityKey: null,
                jobId: "job-prev",
                replayable: true,
              },
            ],
          },
        }) as never;
      }
      if (url === "/workspace/submit") {
        return createJsonResponse({
          status: 202,
          payload: { jobId: "job-bootstrap" },
        }) as never;
      }
      if (url === "/workspace/jobs/job-bootstrap") {
        return createJsonResponse({
          payload: {
            jobId: "job-bootstrap",
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
        url === "/workspace/jobs/job-bootstrap/design-ir" ||
        url === "/workspace/jobs/job-bootstrap/component-manifest"
      ) {
        return createJsonResponse({
          payload: { jobId: "job-bootstrap", screens: [] },
        }) as never;
      }
      if (url === "/workspace/jobs/job-bootstrap/files") {
        return createJsonResponse({
          payload: { files: [] },
        }) as never;
      }
      if (
        url === "/workspace/import-sessions/session-1/reimport" &&
        init?.method === "POST"
      ) {
        return createJsonResponse({
          status: 202,
          payload: {
            sessionId: "session-1",
            jobId: "job-reimport",
            sourceJobId: "job-prev",
          },
        }) as never;
      }
      if (url === "/workspace/jobs/job-reimport") {
        return createJsonResponse({
          payload: {
            jobId: "job-reimport",
            status: "running",
            stages: [{ name: "figma.source", status: "completed" }],
          },
        }) as never;
      }
      if (
        url === "/workspace/jobs/job-reimport/design-ir" ||
        url === "/workspace/jobs/job-reimport/component-manifest" ||
        url === "/workspace/jobs/job-reimport/files" ||
        url === "/workspace/jobs/job-reimport/screenshot"
      ) {
        return createJsonResponse({
          status: 409,
          ok: false,
          payload: { error: "JOB_NOT_COMPLETED" },
        }) as never;
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    renderPage("/workspace/ui/inspector");

    const textarea = screen.getByLabelText(/figma clipboard paste target/i);
    fireEvent.paste(textarea, {
      clipboardData: {
        getData: (type: string) =>
          type === "text" || type === "text/plain" ? '{"document":{}}' : "",
      } as DataTransfer,
    });

    await waitFor(() => {
      expect(screen.getByTestId("smart-banner")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Import starten"));

    await waitFor(() => {
      expect(screen.getByTestId("inspector-layout")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Reimport history session" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("inspector-layout")).toBeInTheDocument();
    });

    expect(screen.getByTestId("inspector-panel-props")).toHaveTextContent(
      "job-reimport||job-prev|false|",
    );
  });

  it("allows a corrected second paste after a non-retryable submit failure", async () => {
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
          payload: { jobId: "job-second-paste" },
        }) as never;
      }

      if (url === "/workspace/jobs/job-second-paste") {
        return createJsonResponse({
          payload: {
            jobId: "job-second-paste",
            status: "completed",
            preview: { url: "http://127.0.0.1:1983/preview" },
          },
        }) as never;
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    renderPage("/workspace/ui/inspector");

    const textarea = screen.getByLabelText(/figma clipboard paste target/i);
    fireEvent.paste(textarea, {
      clipboardData: {
        getData: (type: string) =>
          type === "text" || type === "text/plain" ? '{"document":{}}' : "",
      },
    });

    // First paste: detected state — confirm to trigger submission
    await waitFor(() => {
      expect(screen.getByTestId("smart-banner")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Import starten"));

    // First submit returns SCHEMA_MISMATCH → failed state with alert
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    const retryTextarea = screen.getByLabelText(/figma clipboard paste target/i);
    fireEvent.paste(retryTextarea, {
      clipboardData: {
        getData: (type: string) =>
          type === "text" || type === "text/plain" ? '{"document":{}}' : "",
      },
    });

    // Second paste: detected again — confirm to proceed
    await waitFor(() => {
      expect(screen.getByTestId("smart-banner")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Import starten"));

    await waitFor(() => {
      expect(screen.getByTestId("inspector-layout")).toBeInTheDocument();
    });

    expect(screen.getByTestId("inspector-panel-props")).toHaveTextContent(
      "job-second-paste|http://127.0.0.1:1983/preview||false|",
    );
  });

  it("uses text/html clipboard metadata to classify a Figma clipboard paste before submit", async () => {
    renderPage("/workspace/ui/inspector");

    const textarea = screen.getByLabelText(/figma clipboard paste target/i);
    fireEvent.paste(textarea, {
      clipboardData: {
        getData: (type: string) => {
          if (type === "text" || type === "text/plain") {
            return "Copied from Figma";
          }
          if (type === "text/html") {
            return '<span data-metadata="<!--(figmeta)eyJmaWxlS2V5IjoiYWJjMTIzWFlaIiwicGFzdGVJRCI6NDIsImRhdGFUeXBlIjoic2NlbmUifQ==(/figmeta)-->"></span>';
          }
          return "";
        },
      } as DataTransfer,
    });

    await waitFor(() => {
      expect(screen.getByTestId("smart-banner")).toBeInTheDocument();
    });

    expect(screen.getByTestId("smart-banner")).toHaveTextContent(
      "Figma-Node JSON",
    );
  });
});
