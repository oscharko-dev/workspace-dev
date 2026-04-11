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
import { afterEach, describe, expect, it } from "vitest";
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
  cleanup();
});

describe("VisualQualityPage", () => {
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
});
