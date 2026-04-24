import type { JSX, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJson, type JsonResponse } from "../../lib/http";
import { expectNoBlockingAccessibilityViolations } from "../../test/accessibility";
import { TestSpacePage } from "./test-space-page";

vi.mock("../../lib/http", () => ({
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

function makeQueryClient(): QueryClient {
  return new QueryClient({
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
}

function Providers({ children }: { children: ReactNode }): JSX.Element {
  return (
    <QueryClientProvider client={makeQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

function renderTestSpacePage(initialEntry: string): void {
  const router = createMemoryRouter(
    [
      {
        path: "/workspace/ui/test-space",
        element: <TestSpacePage />,
      },
      {
        path: "/ui/test-space",
        element: <TestSpacePage />,
      },
      {
        path: "*",
        element: <TestSpacePage />,
      },
    ],
    {
      initialEntries: [initialEntry],
    },
  );

  render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
}

function buildMarkdownResponse(text: string): Response {
  return new Response(text, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
    },
  });
}

describe("TestSpacePage", () => {
  let clipboardWriteTextMock: ReturnType<typeof vi.fn>;
  let markdownResponses: string[];
  let markdownFetchMode: "success" | "error";

  beforeEach(() => {
    clipboardWriteTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock,
      },
    });

    markdownResponses = [
      "# Generated test cases\n\n- TC-1: Happy path\n",
      "# Generated test cases\n\n- TC-1: Happy path\n- TC-2: Refresh check\n",
    ];
    markdownFetchMode = "success";

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (markdownFetchMode === "error" && url.endsWith("/workspace/test-space/runs/run-123/test-cases.md")) {
        return new Response("Markdown unavailable", {
          status: 500,
          headers: {
            "content-type": "text/plain; charset=utf-8",
          },
        });
      }

      if (url.endsWith("/workspace/test-space/runs/run-123/test-cases.md")) {
        const markdown = markdownResponses.shift() ?? "";
        return buildMarkdownResponse(markdown);
      }

      throw new Error(`Unexpected markdown fetch URL: ${url}`);
    }));

    fetchJsonMock.mockImplementation(async ({ url, init }) => {
      if (url === "/workspace/test-space/runs" && init?.method === "POST") {
        return createJsonResponse({
          payload: {
            runId: "run-123",
            status: "queued",
            createdAt: "2026-04-24T08:30:00.000Z",
            updatedAt: "2026-04-24T08:31:00.000Z",
          },
        }) as never;
      }

      if (url === "/workspace/test-space/runs/run-123") {
        return createJsonResponse({
          payload: {
            runId: "run-123",
            status: "completed",
            createdAt: "2026-04-24T08:30:00.000Z",
            updatedAt: "2026-04-24T08:31:00.000Z",
          },
        }) as never;
      }

      if (url === "/workspace/test-space/runs/run-123/test-cases") {
        return createJsonResponse({
          payload: {
            testCases: [
              {
                id: "TC-1",
                title: "Happy path purchase completes",
                priority: "P0",
                type: "purchase-flow",
                preconditions: ["Signed-in user", "Cart contains one item"],
                steps: [
                  {
                    order: 1,
                    action: "Open checkout",
                    expectedResult: "Checkout loads with the order summary.",
                  },
                  {
                    order: 2,
                    action: "Submit payment",
                    expectedResult: "Order confirmation is shown.",
                  },
                ],
                expectedResult: "Order confirmation is shown and receipt data is persisted.",
                coverageTags: ["checkout", "payment", "receipt"],
                notes: "Primary business happy path.",
                status: "reviewed",
              },
              {
                id: "TC-2",
                title: "Payment validation failure surfaces a retry path",
                priority: "P1",
                type: "validation",
                preconditions: ["Signed-in user"],
                steps: [
                  {
                    order: 1,
                    action: "Submit checkout with an expired card",
                    expectedResult: "Inline validation is visible.",
                  },
                ],
                expectedResult: "The customer can correct the payment details and retry.",
                coverageTags: ["payment-validation"],
              },
            ],
          },
        }) as never;
      }

      throw new Error(`Unexpected fetchJson url: ${url}`);
    });
    fetchJsonMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    "/workspace/ui/test-space",
    "/ui/test-space",
  ])("renders the page shell at %s", async (path) => {
    renderTestSpacePage(path);

    const page = screen.getByTestId("test-space-page");

    expect(page).toHaveClass("h-screen", "overflow-auto");
    expect(screen.getByRole("heading", { name: "Test Space v1" })).toBeVisible();
    expect(screen.getByLabelText("Source mode")).toBeVisible();
    expect(screen.getByLabelText("Figma JSON payload")).toBeVisible();
    expect(screen.getByLabelText("Figma file key")).toBeVisible();
    expect(screen.getByRole("button", { name: "Generate test cases" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /qc/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/transfer to qc/i)).not.toBeInTheDocument();
  });

  it("generates test cases, refreshes markdown from the API, and supports copy/export", async () => {
    const createObjectUrlMock = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const revokeObjectUrlMock = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const anchorClickMock = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    renderTestSpacePage("/workspace/ui/test-space");

    fireEvent.change(screen.getByLabelText("Figma JSON payload"), {
      target: {
        value: JSON.stringify({
          document: {
            name: "Test Space",
            type: "DOCUMENT",
            children: [],
          },
        }),
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Generate test cases" }));

    const casesPanel = screen.getByTestId("test-space-cases-panel");
    const detailPanel = screen.getByTestId("test-space-detail-panel");
    const markdownPanel = screen.getByTestId("test-space-markdown-panel");

    await waitFor(() => {
      expect(
        within(casesPanel).getByRole("button", {
          name: /Happy path purchase completes/,
        }),
      ).toBeVisible();
    });
    await waitFor(() => {
      expect(
        within(detailPanel).getByText("Primary business happy path."),
      ).toBeVisible();
    });
    expect(
      within(detailPanel).getByText("1. Open checkout"),
    ).toHaveClass("break-words");
    await waitFor(() => {
      expect(
        within(detailPanel).getByText("Order confirmation is shown and receipt data is persisted."),
      ).toBeVisible();
    });
    await waitFor(() => {
      expect(
        within(casesPanel).getByText("checkout, payment, receipt"),
      ).toBeVisible();
    });
    await waitFor(() => {
      expect(
        within(markdownPanel).getByText(/Generated test cases/),
      ).toBeVisible();
    });

    const submitCall = fetchJsonMock.mock.calls.find(([arg]) => arg.url === "/workspace/test-space/runs");
    if (!submitCall) {
      throw new Error("Expected a submit call for the run creation request.");
    }

    const submitBody = submitCall[0].init?.body;
    if (typeof submitBody !== "string") {
      throw new Error("Expected a string body for the run creation request.");
    }
    const submittedBody = JSON.parse(submitBody) as Record<string, unknown>;
    expect(submittedBody).toMatchObject({
      figmaSourceMode: "rest",
      figmaJsonPayload: JSON.stringify({
        document: {
          name: "Test Space",
          type: "DOCUMENT",
          children: [],
        },
      }),
      businessContext: {
        summary:
          "Generate business-facing test cases for the primary Figma flow. Focus on customer-visible outcomes, critical state transitions, and failure recovery.",
        goals: ["Validate the flow against business rules and expected customer outcomes."],
        constraints: ["Keep the suite concise, deterministic, and traceable."],
      },
    });
    expect(submittedBody).not.toHaveProperty("model");
    expect(submittedBody).not.toHaveProperty("businessObjective");
    expect(submittedBody).not.toHaveProperty("businessConstraints");
    expect(submittedBody.figmaJsonPath).toBeUndefined();
    expect(submittedBody.figmaFileKey).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "Save Markdown" }));

    await waitFor(() => {
      expect(screen.getByText(/Refresh check/)).toBeVisible();
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy Markdown" }));
    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith(
        "# Generated test cases\n\n- TC-1: Happy path\n- TC-2: Refresh check\n",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Export Markdown" }));
    await waitFor(() => {
      expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
    });
    expect(revokeObjectUrlMock).toHaveBeenCalledWith("blob:test");
    expect(anchorClickMock).toHaveBeenCalledTimes(1);
  });

  it("submits local JSON path when that mode is selected", async () => {
    renderTestSpacePage("/workspace/ui/test-space");

    fireEvent.change(screen.getByLabelText("Source mode"), {
      target: { value: "local_json" },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Local JSON path")).toBeVisible();
    });

    fireEvent.change(screen.getByLabelText("Local JSON path"), {
      target: { value: "/fixtures/figma.json" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Generate test cases" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: /Happy path purchase completes/,
        }),
      ).toBeVisible();
    });

    const submitCall = fetchJsonMock.mock.calls.find(([arg]) => arg.url === "/workspace/test-space/runs");
    if (!submitCall) {
      throw new Error("Expected a submit call for the run creation request.");
    }

    const submitBody = submitCall[0].init?.body;
    if (typeof submitBody !== "string") {
      throw new Error("Expected a string body for the run creation request.");
    }

    const submittedBody = JSON.parse(submitBody) as Record<string, unknown>;
    expect(submittedBody).toMatchObject({
      figmaSourceMode: "local_json",
      figmaJsonPath: "/fixtures/figma.json",
      businessContext: {
        summary:
          "Generate business-facing test cases for the primary Figma flow. Focus on customer-visible outcomes, critical state transitions, and failure recovery.",
        goals: ["Validate the flow against business rules and expected customer outcomes."],
        constraints: ["Keep the suite concise, deterministic, and traceable."],
      },
    });
    expect(submittedBody.figmaJsonPayload).toBeUndefined();
    expect(submittedBody.figmaFileKey).toBeUndefined();
  });

  it("shows an error state when markdown refresh fails", async () => {
    markdownFetchMode = "error";

    renderTestSpacePage("/workspace/ui/test-space");

    fireEvent.change(screen.getByLabelText("Figma JSON payload"), {
      target: {
        value: JSON.stringify({
          document: {
            name: "Test Space",
            type: "DOCUMENT",
          },
        }),
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Generate test cases" }));

    await waitFor(() => {
      expect(screen.getByText("Markdown unavailable")).toBeVisible();
    });

    expect(screen.queryByRole("button", { name: /qc/i })).not.toBeInTheDocument();
  });

  it("has no blocking accessibility violations on the initial shell", async () => {
    renderTestSpacePage("/workspace/ui/test-space");

    const page = document.querySelector("[data-testid='test-space-page']");
    if (!(page instanceof Element)) {
      throw new Error("Expected test space page to be rendered.");
    }

    await expectNoBlockingAccessibilityViolations(page);
  });
});
