import type { JSX } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { InspectorPage } from "./inspector-page";

vi.mock("./inspector/InspectorPanel", () => ({
  InspectorPanel: ({
    jobId,
    previewUrl,
    previousJobId,
    isRegenerationJob,
    openDialog,
    onCloseDialog,
    onRegenerationAccepted,
  }: {
    jobId: string;
    previewUrl: string;
    previousJobId?: string | null;
    isRegenerationJob: boolean;
    openDialog: string | null;
    onCloseDialog: () => void;
    onRegenerationAccepted: (nextJobId: string) => void;
  }): JSX.Element => (
    <div>
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
      <button type="button" onClick={onCloseDialog}>
        Close dialog
      </button>
    </div>
  ),
}));

vi.mock("./inspector/InspectorErrorBoundary", () => ({
  InspectorErrorBoundary: ({ children }: { children: JSX.Element }) => children,
}));

function LocationProbe(): JSX.Element {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}{location.search}</div>;
}

function renderPage(initialEntry: string): void {
  render(
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
        <Route
          path="/workspace/ui"
          element={<LocationProbe />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("InspectorPage", () => {
  it("shows the missing-job fallback and navigates back to the workspace", () => {
    renderPage("/workspace/ui/inspector");

    expect(screen.getByText("No job data available.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back to Workspace" }));
    expect(screen.getByTestId("location-probe")).toHaveTextContent(
      "/workspace/ui",
    );
  });

  it("passes search-param state into the inspector panel and updates regeneration job id", () => {
    renderPage(
      "/workspace/ui/inspector?jobId=job-1&previewUrl=http%3A%2F%2F127.0.0.1%3A1983%2Fpreview&previousJobId=job-0&isRegeneration=true",
    );

    expect(screen.getByTestId("inspector-panel-props")).toHaveTextContent(
      "job-1|http://127.0.0.1:1983/preview|job-0|true|",
    );

    fireEvent.click(screen.getByRole("button", { name: "Accept regeneration" }));
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
