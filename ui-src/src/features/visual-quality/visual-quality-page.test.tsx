import { type JSX } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VisualQualityPage } from "./visual-quality-page";

function LocationProbe(): JSX.Element {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function renderPage(initial: string): void {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route
            path="/workspace/ui/visual-quality"
            element={
              <>
                <VisualQualityPage />
                <LocationProbe />
              </>
            }
          />
          <Route
            path="*"
            element={<div data-testid="fallback">fallback</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("VisualQualityPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the empty state when no report is loaded", () => {
    renderPage("/workspace/ui/visual-quality");
    expect(screen.getByTestId("visual-quality-empty-state")).toBeVisible();
    expect(screen.getByTestId("visual-quality-load-sample")).toBeVisible();
  });

  it("loads the sample report when the user clicks 'Load sample'", async () => {
    renderPage("/workspace/ui/visual-quality");
    fireEvent.click(screen.getByTestId("visual-quality-load-sample"));

    await waitFor(() => {
      expect(screen.getByTestId("score-dashboard")).toBeVisible();
    });
    expect(screen.getByTestId("gallery-view")).toBeVisible();
    expect(screen.getByTestId("history-chart")).toBeVisible();
  });

  it("updates the URL query string when the filter sort changes", async () => {
    renderPage("/workspace/ui/visual-quality");
    fireEvent.click(screen.getByTestId("visual-quality-load-sample"));
    await waitFor(() => {
      expect(screen.getByTestId("score-dashboard")).toBeVisible();
    });

    fireEvent.change(screen.getByTestId("filter-sort"), {
      target: { value: "score-asc" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("location-search").textContent).toContain(
        "sort=score-asc",
      );
    });
  });

  it("restores filter state from the URL on mount", async () => {
    renderPage("/workspace/ui/visual-quality?sort=score-asc&minScore=50");
    fireEvent.click(screen.getByTestId("visual-quality-load-sample"));
    await waitFor(() => {
      expect(screen.getByTestId("score-dashboard")).toBeVisible();
    });
    const sort = screen.getByTestId("filter-sort") as HTMLSelectElement;
    expect(sort.value).toBe("score-asc");
    const min = screen.getByTestId("filter-min-score") as HTMLInputElement;
    expect(min.value).toBe("50");
  });

  it("clicking 'Load another report' clears the report state", async () => {
    renderPage("/workspace/ui/visual-quality");
    fireEvent.click(screen.getByTestId("visual-quality-load-sample"));
    await waitFor(() => {
      expect(screen.getByTestId("score-dashboard")).toBeVisible();
    });

    fireEvent.click(screen.getByTestId("visual-quality-reset"));
    expect(screen.getByTestId("visual-quality-empty-state")).toBeVisible();
  });

  it("loads standalone visual-quality/report.json from the report query", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            status: "completed",
            referenceSource: "frozen_fixture",
            capturedAt: "2026-04-11T00:00:00.000Z",
            overallScore: 98.8,
            interpretation: "Excellent parity",
            dimensions: [],
            hotspots: [],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    renderPage(
      "/workspace/ui/visual-quality?report=%2Fworkspace%2Fjobs%2Fjob-123%2Ffiles%2Fvisual-quality%2Freport.json",
    );

    await waitFor(() => {
      expect(screen.getByTestId("score-dashboard")).toBeVisible();
    });
    expect(screen.getByTestId("gallery-view")).toBeVisible();
    expect(screen.queryByTestId("visual-parity-summary")).not.toBeInTheDocument();
  });

  it("hydrates confidence from the job confidence artifact when loading a report URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/files/visual-quality/report.json")) {
          return new Response(
            JSON.stringify({
              status: "completed",
              referenceSource: "frozen_fixture",
              capturedAt: "2026-04-11T00:00:00.000Z",
              overallScore: 98.8,
              interpretation: "Excellent parity",
              dimensions: [],
              hotspots: [],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        if (url.endsWith("/files/confidence-report.json")) {
          return new Response(
            JSON.stringify({
              status: "completed",
              level: "medium",
              score: 74.2,
              lowConfidenceSummary: ["component_match_rate: 7/10 matched"],
              screens: [
                {
                  screenId: "visual-quality",
                  screenName: "Visual Quality",
                  level: "medium",
                  score: 74.2,
                  contributors: [],
                  components: [],
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        return new Response(null, { status: 404 });
      }),
    );

    renderPage(
      "/workspace/ui/visual-quality?report=%2Fworkspace%2Fjobs%2Fjob-123%2Ffiles%2Fvisual-quality%2Freport.json",
    );

    await waitFor(() => {
      expect(screen.getByTestId("confidence-summary")).toBeVisible();
    });
    expect(screen.getByTestId("confidence-summary")).toHaveTextContent(
      "74.2%",
    );
  });

  it("renders confidence summary when confidence is available from sibling job endpoints", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/visual-quality/report.json")) {
          return new Response(
            JSON.stringify({
              status: "completed",
              overallScore: 98.8,
              dimensions: [],
              hotspots: [],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        if (url.endsWith("/files/confidence-report.json")) {
          return new Response(
            JSON.stringify({
              status: "completed",
              level: "low",
              score: 65.5,
              lowConfidenceSummary: ["Low confidence in hero section"],
              screens: [
                {
                  screenId: "visual-quality",
                  screenName: "Visual Quality",
                  level: "low",
                  score: 65.5,
                  contributors: [],
                  components: [],
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        return new Response(null, { status: 404 });
      }),
    );

    renderPage(
      "/workspace/ui/visual-quality?report=%2Fworkspace%2Fjobs%2Fjob-123%2Ffiles%2Fvisual-quality%2Freport.json",
    );

    await waitFor(() => {
      expect(screen.getByTestId("confidence-summary")).toBeVisible();
    });
    expect(screen.getByTestId("confidence-summary")).toHaveTextContent(
      "Low Confidence",
    );
  });

  it("loads visual-parity-report.json in summary-only mode", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            status: "warn",
            mode: "strict",
            baselinePath: "/tmp/baseline.png",
            runtimePreviewUrl: "http://127.0.0.1:19835/workspace/repros/job-1/",
            maxDiffPixelRatio: 0.2,
            details: "Visual difference exceeded threshold.",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    renderPage(
      "/workspace/ui/visual-quality?report=%2Fworkspace%2Fjobs%2Fjob-123%2Ffiles%2Fvisual-parity-report.json",
    );

    await waitFor(() => {
      expect(screen.getByTestId("visual-parity-summary")).toBeVisible();
    });
    expect(screen.getByTestId("visual-quality-notices")).toHaveTextContent(
      /Per-screen overlays are unavailable/i,
    );
    expect(screen.queryByTestId("gallery-view")).not.toBeInTheDocument();
  });

  it("shows a clear error when the report URL returns 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );

    renderPage(
      "/workspace/ui/visual-quality?report=%2Fworkspace%2Fjobs%2Fmissing%2Ffiles%2Fvisual-quality%2Freport.json",
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Failed to fetch report .* HTTP 404/i,
      );
    });
    expect(screen.getByTestId("visual-quality-empty-state")).toBeVisible();
  });

  it("shows a clear error when the report JSON is malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ status: "bogus" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    renderPage(
      "/workspace/ui/visual-quality?report=%2Fworkspace%2Fjobs%2Fjob-123%2Ffiles%2Fvisual-parity-report.json",
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Invalid visual-parity-report\.json/i,
      );
    });
    expect(screen.getByTestId("visual-quality-empty-state")).toBeVisible();
  });

  it("shows a loading state while fetching a report URL", async () => {
    let resolveFetch:
      | ((value: Response | PromiseLike<Response>) => void)
      | undefined;
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        callCount += 1;
        if (callCount === 1) {
          return new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          });
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      }),
    );

    renderPage(
      "/workspace/ui/visual-quality?report=%2Fworkspace%2Fjobs%2Fjob-123%2Ffiles%2Fvisual-quality%2Freport.json",
    );
    expect(screen.getByTestId("visual-quality-loading")).toBeVisible();
    expect(screen.queryByTestId("visual-quality-empty-state")).not.toBeInTheDocument();

    resolveFetch?.(
      new Response(
        JSON.stringify({
          status: "completed",
          referenceSource: "frozen_fixture",
          capturedAt: "2026-04-11T00:00:00.000Z",
          overallScore: 95.2,
          interpretation: "Good parity",
          dimensions: [],
          hotspots: [],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await waitFor(() => {
      expect(screen.getByTestId("score-dashboard")).toBeVisible();
    });
  });

  it("navigates back to /workspace/ui when Back is clicked", () => {
    renderPage("/workspace/ui/visual-quality");

    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByTestId("fallback")).toBeVisible();
  });

  it("renders a passed visual-parity summary status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            status: "passed",
            mode: "warn",
            baselinePath: "/tmp/baseline.png",
            runtimePreviewUrl: "http://127.0.0.1:19835/workspace/repros/job-1/",
            maxDiffPixelRatio: 0.07,
            details: "Generated preview matches baseline within threshold.",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    renderPage(
      "/workspace/ui/visual-quality?report=%2Fworkspace%2Fjobs%2Fjob-123%2Ffiles%2Fvisual-parity-report.json",
    );

    await waitFor(() => {
      expect(screen.getByTestId("visual-parity-summary")).toBeVisible();
    });
    expect(screen.getByTestId("visual-parity-summary")).toHaveTextContent(
      /Passed/,
    );
  });

  it("clears report and filter params when resetting after URL load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            status: "completed",
            referenceSource: "frozen_fixture",
            capturedAt: "2026-04-11T00:00:00.000Z",
            overallScore: 97.2,
            interpretation: "Good parity",
            dimensions: [],
            hotspots: [],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    renderPage(
      "/workspace/ui/visual-quality?report=%2Fworkspace%2Fjobs%2Fjob-123%2Ffiles%2Fvisual-quality%2Freport.json&sort=score-asc&minScore=50&q=header",
    );
    await waitFor(() => {
      expect(screen.getByTestId("score-dashboard")).toBeVisible();
    });

    fireEvent.click(screen.getByTestId("visual-quality-reset"));

    await waitFor(() => {
      const search = screen.getByTestId("location-search").textContent ?? "";
      expect(search).not.toContain("report=");
      expect(search).not.toContain("sort=");
      expect(search).not.toContain("minScore=");
      expect(search).not.toContain("q=");
    });
    expect(screen.getByTestId("visual-quality-empty-state")).toBeVisible();
  });

  it("recovers from URL load failure when loading a sample manually", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );

    renderPage(
      "/workspace/ui/visual-quality?report=%2Fworkspace%2Fjobs%2Fmissing%2Ffiles%2Fvisual-quality%2Freport.json",
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Failed to fetch report .* HTTP 404/i,
      );
    });

    fireEvent.click(screen.getByTestId("visual-quality-load-sample"));

    await waitFor(() => {
      expect(screen.getByTestId("score-dashboard")).toBeVisible();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
