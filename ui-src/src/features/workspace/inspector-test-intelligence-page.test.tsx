import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJson, type JsonResponse } from "../../lib/http";
import { InspectorTestIntelligencePage } from "./inspector-test-intelligence-page";
import { expectNoBlockingAccessibilityViolations } from "../../test/accessibility";
import { buildBundle } from "./inspector/test-intelligence/test-fixtures";

vi.mock("../../lib/http", () => ({ fetchJson: vi.fn() }));

const fetchJsonMock = vi.mocked(fetchJson);

interface MockResponse {
  status: number;
  payload: unknown;
}

function buildJsonResponse(value: MockResponse): JsonResponse<unknown> {
  return {
    status: value.status,
    ok: value.status >= 200 && value.status < 300,
    payload: value.payload as Record<string, unknown>,
  };
}

interface RouteMockSpec {
  bundle?: MockResponse;
  reviewState?: MockResponse;
  workspaceStatus?: MockResponse;
  jobsList?: MockResponse;
}

function configureFetchJson(spec: RouteMockSpec): void {
  fetchJsonMock.mockImplementation(async ({ url }) => {
    if (url === "/workspace") {
      return buildJsonResponse(
        spec.workspaceStatus ?? {
          status: 200,
          payload: { testIntelligenceEnabled: true },
        },
      );
    }
    if (url === "/workspace/test-intelligence/jobs") {
      return buildJsonResponse(
        spec.jobsList ?? { status: 200, payload: { jobs: [] } },
      );
    }
    if (url.startsWith("/workspace/test-intelligence/jobs/")) {
      return buildJsonResponse(
        spec.bundle ?? {
          status: 200,
          payload: buildBundle(),
        },
      );
    }
    if (url.endsWith("/state")) {
      return buildJsonResponse(
        spec.reviewState ?? {
          status: 200,
          payload: {
            ok: true,
            snapshot: buildBundle().reviewSnapshot,
            events: [],
          },
        },
      );
    }
    return buildJsonResponse({ status: 404, payload: { error: "NOT_FOUND" } });
  });
}

function renderPage(initialEntry: string): { wrapper: ReactNode } {
  const wrapper = (
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false, gcTime: Infinity },
          },
        })
      }
    >
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/workspace/ui/inspector/test-intelligence"
            element={<InspectorTestIntelligencePage />}
          />
          <Route
            path="/workspace/ui/inspector"
            element={<div>inspector-shell</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(wrapper);
  return { wrapper };
}

beforeEach(() => {
  fetchJsonMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("InspectorTestIntelligencePage — feature-flag gating", () => {
  it("renders the disabled banner when testIntelligenceEnabled is false", async () => {
    configureFetchJson({
      workspaceStatus: {
        status: 200,
        payload: { testIntelligenceEnabled: false },
      },
    });
    renderPage("/workspace/ui/inspector/test-intelligence?jobId=job-1");
    await waitFor(() => {
      expect(
        screen.getByTestId("ti-page-feature-disabled"),
      ).toBeInTheDocument();
    });
  });
});

describe("InspectorTestIntelligencePage — empty + loading + ready", () => {
  it("renders the job picker when no jobId param is supplied", async () => {
    configureFetchJson({
      jobsList: {
        status: 200,
        payload: {
          jobs: [
            {
              jobId: "poc-onboarding",
              hasArtifacts: { generatedTestCases: true },
            },
          ],
        },
      },
    });
    renderPage("/workspace/ui/inspector/test-intelligence");
    await waitFor(() => {
      expect(screen.getByTestId("ti-page-job-picker")).toBeInTheDocument();
      expect(
        screen.getByTestId("ti-job-picker-row-poc-onboarding"),
      ).toBeInTheDocument();
    });
  });

  it("renders the bundle once both fetches resolve", async () => {
    configureFetchJson({});
    renderPage("/workspace/ui/inspector/test-intelligence?jobId=job-1");
    await waitFor(() => {
      expect(screen.getByTestId("ti-policy-summary")).toBeInTheDocument();
      expect(screen.getByTestId("ti-test-case-list")).toBeInTheDocument();
      expect(screen.getByTestId("ti-coverage-panel")).toBeInTheDocument();
      expect(screen.getByTestId("ti-visual-sidecar-panel")).toBeInTheDocument();
      expect(screen.getByTestId("ti-export-diagnostics")).toBeInTheDocument();
      expect(screen.getByTestId("ti-detail-qc-mapping")).toHaveTextContent(
        "Workspace/Login",
      );
    });
  });

  it("renders the loading state while artifact fetches are pending", async () => {
    fetchJsonMock.mockImplementation(async ({ url }) => {
      if (url === "/workspace") {
        return buildJsonResponse({
          status: 200,
          payload: { testIntelligenceEnabled: true },
        });
      }
      return new Promise<JsonResponse<unknown>>(() => {});
    });
    renderPage("/workspace/ui/inspector/test-intelligence?jobId=job-1");
    await waitFor(() => {
      expect(screen.getByTestId("ti-page-loading")).toBeInTheDocument();
    });
  });

  it("renders the 404 empty state when the bundle endpoint returns 404", async () => {
    configureFetchJson({
      bundle: {
        status: 404,
        payload: {
          error: "JOB_NOT_FOUND",
          message: "No artifacts for job 'missing'.",
        },
      },
    });
    renderPage("/workspace/ui/inspector/test-intelligence?jobId=missing");
    await waitFor(() => {
      expect(screen.getByTestId("ti-page-empty-job")).toBeInTheDocument();
    });
  });

  it("renders the error banner when the bundle request fails for a non-404 reason", async () => {
    configureFetchJson({
      bundle: {
        status: 503,
        payload: {
          error: "FEATURE_DISABLED",
          message: "Test intelligence is disabled.",
        },
      },
    });
    renderPage("/workspace/ui/inspector/test-intelligence?jobId=job-1");
    await waitFor(() => {
      expect(screen.getByTestId("ti-page-error")).toHaveTextContent(
        /FEATURE_DISABLED/,
      );
    });
  });

  it("renders the partial-result banner when the bundle reports parse errors", async () => {
    const completeBundle = buildBundle();
    const bundleWithoutValidation = { ...completeBundle };
    delete bundleWithoutValidation.validationReport;
    const bundle = {
      ...bundleWithoutValidation,
      parseErrors: [
        {
          artifact: "validationReport",
          filename: "validation-report.json",
          reason: "schema_mismatch" as const,
          message: "validation-report.json did not match schema",
        },
      ],
    };
    configureFetchJson({
      bundle: { status: 200, payload: bundle },
    });
    renderPage("/workspace/ui/inspector/test-intelligence?jobId=job-1");
    await waitFor(() => {
      expect(screen.getByTestId("ti-page-parse-errors")).toBeInTheDocument();
      expect(screen.getByTestId("ti-page-parse-error-0")).toHaveTextContent(
        "validation-report.json",
      );
    });
  });
});

describe("InspectorTestIntelligencePage — accessibility", () => {
  it("has no blocking a11y violations on the ready state", async () => {
    configureFetchJson({});
    const { wrapper } = renderPage(
      "/workspace/ui/inspector/test-intelligence?jobId=job-1",
    );
    await waitFor(() => {
      expect(screen.getByTestId("ti-test-case-list")).toBeInTheDocument();
    });
    const root = screen.getByTestId("ti-page");
    await expectNoBlockingAccessibilityViolations(root);
    expect(wrapper).toBeTruthy();
  });
});

describe("InspectorTestIntelligencePage — review action submission", () => {
  it("posts an approve action with the configured bearer token + reviewer handle", async () => {
    configureFetchJson({});
    fetchJsonMock.mockImplementation(async ({ url, init }) => {
      if (url === "/workspace") {
        return buildJsonResponse({
          status: 200,
          payload: { testIntelligenceEnabled: true },
        });
      }
      if (url === "/workspace/test-intelligence/jobs/job-1") {
        return buildJsonResponse({
          status: 200,
          payload: buildBundle(),
        });
      }
      if (url === "/workspace/test-intelligence/review/job-1/state") {
        return buildJsonResponse({
          status: 200,
          payload: {
            ok: true,
            snapshot: buildBundle().reviewSnapshot,
            events: [],
          },
        });
      }
      if (
        url === "/workspace/test-intelligence/review/job-1/approve/tc-1" &&
        init?.method === "POST"
      ) {
        const headers = init.headers as Record<string, string>;
        expect(headers.authorization).toBe("Bearer secret-token");
        const parsed = JSON.parse(init.body as string) as Record<
          string,
          unknown
        >;
        expect(parsed.actor).toBe("alice");
        return buildJsonResponse({
          status: 200,
          payload: {
            ok: true,
            snapshot: {
              ...buildBundle().reviewSnapshot,
              approvedCount: 1,
              needsReviewCount: 0,
            },
            event: {
              schemaVersion: "1.0.0",
              contractVersion: "1.0.0",
              id: "evt-2",
              jobId: "job-1",
              testCaseId: "tc-1",
              kind: "approved",
              at: "2026-04-25T12:00:00.000Z",
              sequence: 2,
              fromState: "needs_review",
              toState: "approved",
              actor: "alice",
            },
          },
        });
      }
      return buildJsonResponse({
        status: 404,
        payload: { error: "NOT_FOUND" },
      });
    });

    renderPage("/workspace/ui/inspector/test-intelligence?jobId=job-1");
    await waitFor(() => {
      expect(screen.getByTestId("ti-test-case-list")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("ti-reviewer-handle-input"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByTestId("ti-reviewer-bearer-input"), {
      target: { value: "secret-token" },
    });

    fireEvent.click(screen.getByTestId("ti-detail-action-approve"));

    await waitFor(() => {
      const calls = fetchJsonMock.mock.calls.filter(
        ([request]) =>
          request.url ===
            "/workspace/test-intelligence/review/job-1/approve/tc-1" &&
          request.init?.method === "POST",
      );
      expect(calls.length).toBeGreaterThan(0);
    });
  });
});

describe("InspectorTestIntelligencePage — needs-clarification metadata", () => {
  it("posts a `note` action with metadata.needsClarification when the user clicks Needs clarification", async () => {
    fetchJsonMock.mockImplementation(async ({ url, init }) => {
      if (url === "/workspace") {
        return buildJsonResponse({
          status: 200,
          payload: { testIntelligenceEnabled: true },
        });
      }
      if (url === "/workspace/test-intelligence/jobs/job-1") {
        return buildJsonResponse({ status: 200, payload: buildBundle() });
      }
      if (url === "/workspace/test-intelligence/review/job-1/state") {
        return buildJsonResponse({
          status: 200,
          payload: {
            ok: true,
            snapshot: buildBundle().reviewSnapshot,
            events: [],
          },
        });
      }
      if (
        url === "/workspace/test-intelligence/review/job-1/note/tc-1" &&
        init?.method === "POST"
      ) {
        const parsed = JSON.parse(init.body as string) as Record<
          string,
          unknown
        >;
        expect(parsed.metadata).toEqual({ needsClarification: true });
        return buildJsonResponse({
          status: 200,
          payload: {
            ok: true,
            snapshot: buildBundle().reviewSnapshot,
            event: {
              id: "evt-needs-clarification",
              jobId: "job-1",
              testCaseId: "tc-1",
              kind: "note",
              at: "2026-04-25T12:00:00.000Z",
              sequence: 2,
              metadata: { needsClarification: true },
            },
          },
        });
      }
      return buildJsonResponse({
        status: 404,
        payload: { error: "NOT_FOUND" },
      });
    });

    renderPage("/workspace/ui/inspector/test-intelligence?jobId=job-1");
    await waitFor(() => {
      expect(screen.getByTestId("ti-test-case-list")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId("ti-reviewer-bearer-input"), {
      target: { value: "secret-token" },
    });
    fireEvent.click(screen.getByTestId("ti-detail-action-needs-clarification"));

    await waitFor(() => {
      const calls = fetchJsonMock.mock.calls.filter(
        ([request]) =>
          request.url ===
            "/workspace/test-intelligence/review/job-1/note/tc-1" &&
          request.init?.method === "POST",
      );
      expect(calls.length).toBeGreaterThan(0);
    });
  });
});

describe("InspectorTestIntelligencePage — bearer token persists to sessionStorage", () => {
  it("stores the bearer token in sessionStorage and the reviewer handle in localStorage", async () => {
    configureFetchJson({});
    renderPage("/workspace/ui/inspector/test-intelligence?jobId=job-1");
    await waitFor(() => {
      expect(screen.getByTestId("ti-test-case-list")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId("ti-reviewer-bearer-input"), {
      target: { value: "scoped-token" },
    });
    fireEvent.change(screen.getByTestId("ti-reviewer-handle-input"), {
      target: { value: "alice" },
    });
    expect(
      window.sessionStorage.getItem("workspace-dev:ti-reviewer-bearer:v1"),
    ).toBe("scoped-token");
    expect(
      window.localStorage.getItem("workspace-dev:ti-reviewer-handle:v1"),
    ).toBe("alice");
    // Bearer token is NOT mirrored into localStorage.
    expect(
      window.localStorage.getItem("workspace-dev:ti-reviewer-bearer:v1"),
    ).toBeNull();
  });

  it("warns reviewers about the storage scope of the bearer token", async () => {
    configureFetchJson({});
    renderPage("/workspace/ui/inspector/test-intelligence?jobId=job-1");
    await waitFor(() => {
      expect(
        screen.getByTestId("ti-reviewer-bearer-warning"),
      ).toHaveTextContent(/sessionStorage/);
    });
  });
});
