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
  evidenceVerify?: MockResponse;
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
    if (url.endsWith("/evidence/verify")) {
      return buildJsonResponse(
        spec.evidenceVerify ?? {
          status: 200,
          payload: {
            schemaVersion: "1.0.0",
            verifiedAt: "2026-05-04T10:00:00.000Z",
            jobId: "job-1",
            ok: true,
            manifestSha256: "a".repeat(64),
            checks: [],
            failures: [],
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
              jobId: "validation-onboarding",
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
        screen.getByTestId("ti-job-picker-row-validation-onboarding"),
      ).toBeInTheDocument();
    });
  });

  it("renders the bundle once both fetches resolve", async () => {
    configureFetchJson({});
    renderPage("/workspace/ui/inspector/test-intelligence?jobId=job-1");
    await waitFor(() => {
      expect(screen.getByTestId("ti-tablist")).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
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

  it("loads the evidence status panel lazily when its tab is selected", async () => {
    configureFetchJson({
      evidenceVerify: {
        status: 200,
        payload: {
          schemaVersion: "1.0.0",
          verifiedAt: "2026-05-04T10:00:00.000Z",
          jobId: "job-1",
          ok: true,
          manifestSha256: "a".repeat(64),
          checks: [{ kind: "ml_bom", ok: true, reference: "ml-bom.json" }],
          failures: [],
        },
      },
    });
    renderPage("/workspace/ui/inspector/test-intelligence?jobId=job-1");

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    expect(
      fetchJsonMock.mock.calls.some(
        ([request]) => request.url === "/workspace/jobs/job-1/evidence/verify",
      ),
    ).toBe(false);

    fireEvent.click(screen.getByRole("tab", { name: "Evidence Status" }));

    await waitFor(() => {
      expect(screen.getByTestId("ti-evidence-status-panel")).toBeInTheDocument();
      expect(screen.getByTestId("ti-evidence-checks")).toHaveTextContent("1");
    });
    expect(
      fetchJsonMock.mock.calls.some(
        ([request]) => request.url === "/workspace/jobs/job-1/evidence/verify",
      ),
    ).toBe(true);
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

describe("InspectorTestIntelligencePage — multi-source tab state", () => {
  it("shows the multi-source tab only when the nested runtime gate is enabled", async () => {
    configureFetchJson({
      workspaceStatus: {
        status: 200,
        payload: {
          testIntelligenceEnabled: true,
          testIntelligenceMultiSourceEnabled: true,
        },
      },
    });
    renderPage("/workspace/ui/inspector/test-intelligence?jobId=job-1");
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Multi-Source" })).toBeInTheDocument();
    });
  });

  it("switches to the multi-source tab and remains free of blocking a11y violations", async () => {
    configureFetchJson({
      workspaceStatus: {
        status: 200,
        payload: {
          testIntelligenceEnabled: true,
          testIntelligenceMultiSourceEnabled: true,
          testIntelligenceJiraGatewayConfigured: true,
        },
      },
      bundle: {
        status: 200,
        payload: buildBundle({
          sourceRefs: [
            {
              sourceId: "jira-primary",
              kind: "jira_paste",
              capturedAt: "2026-04-27T11:00:00.000Z",
              contentHash: "a".repeat(64),
              role: "primary",
              label: "Jira paste PAY-1437",
            },
          ],
          sourceEnvelope: {
            aggregateContentHash: "hash-1",
            conflictResolutionPolicy: "reviewer_decides",
          },
          multiSourceReconciliation: {
            envelopeHash: "hash-1",
            conflicts: [],
            unmatchedSources: [],
            contributingSourcesPerCase: [],
            policyApplied: "reviewer_decides",
          },
        }),
      },
    });
    renderPage("/workspace/ui/inspector/test-intelligence?jobId=job-1");
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Multi-Source" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("tab", { name: "Multi-Source" }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Multi-Source" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByTestId("ti-multisource-source-mix")).toBeInTheDocument();
    });
    await expectNoBlockingAccessibilityViolations(screen.getByTestId("ti-page"));
  });

  it("persists the selected multi-source tab in localStorage using the reviewer key", async () => {
    configureFetchJson({
      workspaceStatus: {
        status: 200,
        payload: {
          testIntelligenceEnabled: true,
          testIntelligenceMultiSourceEnabled: true,
        },
      },
      bundle: {
        status: 200,
        payload: buildBundle({
          sourceRefs: [
            {
              sourceId: "jira-primary",
              kind: "jira_paste",
              capturedAt: "2026-04-27T11:00:00.000Z",
              contentHash: "a".repeat(64),
              role: "primary",
              label: "Jira paste PAY-1437",
            },
          ],
          sourceEnvelope: {
            aggregateContentHash: "hash-1",
            conflictResolutionPolicy: "reviewer_decides",
          },
          multiSourceReconciliation: {
            envelopeHash: "hash-1",
            conflicts: [],
            unmatchedSources: [],
            contributingSourcesPerCase: [],
            policyApplied: "reviewer_decides",
          },
        }),
      },
    });
    renderPage("/workspace/ui/inspector/test-intelligence?jobId=job-1");
    await waitFor(() => {
      expect(screen.getByTestId("ti-test-case-list")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId("ti-reviewer-handle-input"), {
      target: { value: "Alice Example" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Multi-Source" }));
    await waitFor(() => {
      expect(screen.getByTestId("ti-multisource-source-list")).toBeInTheDocument();
      expect(screen.getByTestId("ti-multisource-source-mix")).toBeInTheDocument();
      expect(screen.getByText(/Jira paste remains the supported air-gapped path/)).toBeInTheDocument();
    });
    expect(
      window.localStorage.getItem("workspace-dev:ti-multisource-alice-example:v1"),
    ).toBe("multi-source");
  });
});

describe("InspectorTestIntelligencePage — multi-source ingestion flow", () => {
  it("attaches three sources, submits a job, resolves a conflict, and approves the case", async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    const figmaSource = {
      sourceId: "figma-primary",
      kind: "figma_plugin" as const,
      capturedAt: "2026-04-27T11:00:00.000Z",
      contentHash: "a".repeat(64),
      role: "primary" as const,
      label: "Figma primary UI",
    };
    const jiraSource = {
      sourceId: "jira-adf-1",
      kind: "jira_paste" as const,
      capturedAt: "2026-04-27T11:01:00.000Z",
      contentHash: "b".repeat(64),
      role: "supporting" as const,
      label: "Jira paste PAY-1437",
      inputFormat: "structured_json" as const,
    };
    const customSource = {
      sourceId: "custom-context-1",
      kind: "custom_text" as const,
      capturedAt: "2026-04-27T11:02:00.000Z",
      contentHash: "c".repeat(64),
      role: "supporting" as const,
      label: "Custom context note",
      inputFormat: "markdown" as const,
    };
    const conflictDecision = {
      conflictId: "conflict-1",
      state: "approved" as const,
      lastEventId: "evt-1",
      lastEventAt: "2026-04-27T11:03:00.000Z",
      actor: "Alice Example",
      selectedSourceId: jiraSource.sourceId,
    };
    let bundle = buildBundle({
      sourceRefs: [figmaSource],
      sourceEnvelope: {
        aggregateContentHash: "hash-1",
        conflictResolutionPolicy: "reviewer_decides",
        priorityOrder: ["figma_plugin", "jira_paste", "custom_text"],
      },
      multiSourceReconciliation: {
        envelopeHash: "hash-1",
        conflicts: [
          {
            conflictId: conflictDecision.conflictId,
            kind: "title",
            participatingSourceIds: [
              figmaSource.sourceId,
              jiraSource.sourceId,
              customSource.sourceId,
            ],
            normalizedValues: ["Log in", "Sign in"],
            effectiveState: "unresolved",
            resolution: "deferred_to_reviewer",
            detail: "Title differs across attached sources.",
          },
        ],
        unmatchedSources: [],
        contributingSourcesPerCase: [
          {
            testCaseId: "tc-1",
            sourceIds: [
              figmaSource.sourceId,
              jiraSource.sourceId,
              customSource.sourceId,
            ],
          },
        ],
        policyApplied: "reviewer_decides",
      },
      conflictDecisions: {},
      testCaseProvenance: {
        "tc-1": {
          testCaseId: "tc-1",
          allSourceIds: [
            figmaSource.sourceId,
            jiraSource.sourceId,
            customSource.sourceId,
          ],
          fieldSourceIds: [figmaSource.sourceId],
          actionSourceIds: [jiraSource.sourceId],
          validationSourceIds: [customSource.sourceId],
          navigationSourceIds: [figmaSource.sourceId],
        },
      },
    });

    fetchJsonMock.mockImplementation(async ({ url, init }) => {
      if (url === "/workspace") {
        return buildJsonResponse({
          status: 200,
          payload: {
            testIntelligenceEnabled: true,
            testIntelligenceMultiSourceEnabled: true,
          },
        });
      }
      if (url === "/workspace/test-intelligence/jobs/job-1") {
        return buildJsonResponse({
          status: 200,
          payload: bundle,
        });
      }
      if (url === "/workspace/test-intelligence/review/job-1/state") {
        return buildJsonResponse({
          status: 200,
          payload: {
            ok: true,
            snapshot: bundle.reviewSnapshot!,
            events: [],
          },
        });
      }
      if (
        url === "/workspace/test-intelligence/sources/job-1/jira-paste" &&
        init?.method === "POST"
      ) {
        const parsed = JSON.parse(init.body as string) as Record<
          string,
          unknown
        >;
        expect(parsed.format).toBe("adf_json");
        bundle = {
          ...bundle,
          sourceRefs: [...(bundle.sourceRefs ?? []), jiraSource],
        };
        return buildJsonResponse({
          status: 200,
          payload: { ok: true },
        });
      }
      if (
        url === "/workspace/test-intelligence/sources/job-1/custom-context" &&
        init?.method === "POST"
      ) {
        bundle = {
          ...bundle,
          sourceRefs: [...(bundle.sourceRefs ?? []), customSource],
        };
        return buildJsonResponse({
          status: 200,
          payload: { ok: true },
        });
      }
      if (url === "/workspace/submit" && init?.method === "POST") {
        const parsed = JSON.parse(init.body as string) as Record<
          string,
          unknown
        >;
        expect(parsed.figmaSourceMode).toBe("figma_paste");
        expect(parsed.jobType).toBe("figma_to_qc_test_cases");
        expect(parsed.testIntelligenceMode).toBe("dry_run");
        return buildJsonResponse({
          status: 202,
          payload: { jobId: "job-1" },
        });
      }
      if (
        url ===
          "/workspace/test-intelligence/review/job-1/conflicts/conflict-1/resolve" &&
        init?.method === "POST"
      ) {
        bundle = {
          ...bundle,
          multiSourceReconciliation: {
            ...bundle.multiSourceReconciliation!,
            conflicts: bundle.multiSourceReconciliation!.conflicts.map(
              (conflict) =>
                conflict.conflictId === conflictDecision.conflictId
                  ? {
                      ...conflict,
                      effectiveState: "resolved",
                      resolvedBy: "Alice Example",
                    }
                  : conflict,
            ),
          },
          conflictDecisions: {
            ...bundle.conflictDecisions,
            [conflictDecision.conflictId]: conflictDecision,
          },
        };
        return buildJsonResponse({
          status: 200,
          payload: {
            snapshot: conflictDecision,
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
        expect(parsed.actor).toBe("Alice Example");
        bundle = {
          ...bundle,
          reviewSnapshot: {
            ...bundle.reviewSnapshot!,
            approvedCount: 1,
            needsReviewCount: 0,
            perTestCase: bundle.reviewSnapshot!.perTestCase.map((entry) =>
              entry.testCaseId === "tc-1"
                ? {
                    ...entry,
                    state: "approved",
                    policyDecision: "approved",
                    approvers: ["Alice Example"],
                  }
                : entry,
            ),
          },
        };
        return buildJsonResponse({
          status: 200,
          payload: {
            ok: true,
            snapshot: bundle.reviewSnapshot,
            event: {
              schemaVersion: "1.0.0",
              contractVersion: "1.0.0",
              id: "evt-approve",
              jobId: "job-1",
              testCaseId: "tc-1",
              kind: "approved",
              at: "2026-04-27T11:04:00.000Z",
              sequence: 2,
              fromState: "needs_review",
              toState: "approved",
              actor: "Alice Example",
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
      target: { value: "Alice Example" },
    });
    fireEvent.change(screen.getByTestId("ti-reviewer-bearer-input"), {
      target: { value: "secret-token" },
    });

    fireEvent.click(screen.getByRole("tab", { name: "Multi-Source" }));
    await waitFor(() => {
      expect(screen.getByTestId("ti-multisource-ingestion")).toBeInTheDocument();
    });

    const figmaFile = new File(
      ['{"document":{"id":"0:0","name":"Document"}}'],
      "figma-export.json",
      { type: "application/json" },
    );
    fireEvent.change(screen.getByLabelText("Upload Figma JSON file"), {
      target: { files: [figmaFile] },
    });

    const jiraFile = new File(
      ['{"type":"doc","version":1,"content":[{"type":"paragraph"}]}'],
      "jira-adf.json",
      { type: "application/json" },
    );
    fireEvent.change(screen.getByLabelText("Upload Jira ADF JSON file"), {
      target: { files: [jiraFile] },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Jira paste format")).toHaveValue(
        "adf_json",
      );
      expect(screen.getByTestId("ti-multisource-jira-paste")).toHaveValue(
        '{"type":"doc","version":1,"content":[{"type":"paragraph"}]}',
      );
    });

    fireEvent.change(screen.getByTestId("ti-multisource-custom-markdown"), {
      target: { value: "Custom context for the generated job." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Attach Jira paste" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Attach custom context" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Generate multi-source job" }),
    );

    await waitFor(() => {
      expect(fetchJsonMock.mock.calls.some(([request]) => request.url === "/workspace/submit")).toBe(true);
      expect(
        screen.getByTestId("ti-multisource-source-list"),
      ).toHaveTextContent("3 total");
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: `Approve ${jiraSource.sourceId} for conflict-1`,
      }),
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("ti-multisource-conflicts"),
      ).toHaveTextContent("resolved");
    });

    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    await waitFor(() => {
      expect(screen.getByTestId("ti-test-case-list")).toBeInTheDocument();
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
