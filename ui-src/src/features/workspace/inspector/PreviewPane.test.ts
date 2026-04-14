import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { PreviewPane } from "./PreviewPane";

vi.mock("./InspectOverlay", () => ({
  InspectOverlay: ({
    activeScopeNodeId,
    iframeLoadVersion,
    inspectEnabled,
  }: {
    activeScopeNodeId: string | null;
    iframeLoadVersion: number;
    inspectEnabled: boolean;
  }) =>
    createElement("div", {
      "data-testid": "inspect-overlay",
      "data-active-scope-node-id": activeScopeNodeId ?? "",
      "data-iframe-load-version": String(iframeLoadVersion),
      "data-inspect-enabled": String(inspectEnabled),
    }),
}));

vi.mock("./ScreenshotPreview", () => ({
  ScreenshotPreview: ({
    screenshotUrl,
    stageName,
  }: {
    screenshotUrl: string;
    stageName?: string;
  }) =>
    createElement("div", {
      "data-testid": "screenshot-preview",
      "data-screenshot-url": screenshotUrl,
      "data-stage-name": stageName ?? "",
    }),
}));

afterEach(() => {
  cleanup();
});

describe("PreviewPane", () => {
  it("renders the preview controls and hides the loading overlay after iframe load", () => {
    const onToggleInspect = vi.fn();
    const onInspectSelect = vi.fn();

    render(
      createElement(PreviewPane, {
        previewUrl: "http://127.0.0.1:4010/preview",
        inspectEnabled: false,
        activeScopeNodeId: "node-7",
        onToggleInspect,
        onInspectSelect,
      }),
    );

    expect(screen.getByText("Loading preview…")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open preview in new tab" }),
    ).toHaveAttribute("href", "http://127.0.0.1:4010/preview");
    expect(screen.getByTestId("inspect-overlay")).toHaveAttribute(
      "data-inspect-enabled",
      "false",
    );
    expect(screen.getByTestId("inspect-overlay")).toHaveAttribute(
      "data-active-scope-node-id",
      "node-7",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Enable inspect mode" }),
    );
    expect(onToggleInspect).toHaveBeenCalledTimes(1);

    fireEvent.load(screen.getByTitle("Live preview"));
    expect(screen.queryByText("Loading preview…")).not.toBeInTheDocument();
    expect(screen.getByTestId("inspect-overlay")).toHaveAttribute(
      "data-iframe-load-version",
      "1",
    );
  });

  it("reflects active inspect mode on the toggle button", () => {
    render(
      createElement(PreviewPane, {
        previewUrl: "http://127.0.0.1:4010/preview",
        inspectEnabled: true,
        activeScopeNodeId: null,
        onToggleInspect: () => {
          // no-op
        },
        onInspectSelect: () => {
          // no-op
        },
      }),
    );

    expect(
      screen.getByRole("button", { name: "Disable inspect mode" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("inspect-overlay")).toHaveAttribute(
      "data-inspect-enabled",
      "true",
    );
  });

  it("renders a waiting placeholder when the preview URL is not available yet", () => {
    render(
      createElement(PreviewPane, {
        previewUrl: "",
        inspectEnabled: false,
        activeScopeNodeId: null,
        onToggleInspect: () => {
          // no-op
        },
        onInspectSelect: () => {
          // no-op
        },
      }),
    );

    expect(
      screen.getByText(
        "Preview will appear after the generation job produces a runnable repro.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(screen.queryByTitle("Live preview")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open preview in new tab" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Loading preview…")).not.toBeInTheDocument();
  });
});

describe("PreviewPane — pipeline stage modes", () => {
  it("shows Analyzing design spinner when pipelineStage is parsing", () => {
    render(
      createElement(PreviewPane, {
        previewUrl: "",
        pipelineStage: "parsing",
        inspectEnabled: false,
        activeScopeNodeId: null,
        onToggleInspect: () => {
          // no-op
        },
        onInspectSelect: () => {
          // no-op
        },
      }),
    );

    expect(screen.getByText("Analyzing design…")).toBeInTheDocument();
    expect(screen.queryByTitle("Live preview")).not.toBeInTheDocument();
  });

  it("shows ScreenshotPreview with stage label when generating and screenshot provided", () => {
    render(
      createElement(PreviewPane, {
        previewUrl: "",
        pipelineStage: "generating",
        screenshot: "http://cdn.example.com/screenshot.png",
        inspectEnabled: false,
        activeScopeNodeId: null,
        onToggleInspect: () => {
          // no-op
        },
        onInspectSelect: () => {
          // no-op
        },
      }),
    );

    const preview = screen.getByTestId("screenshot-preview");
    expect(preview).toHaveAttribute(
      "data-screenshot-url",
      "http://cdn.example.com/screenshot.png",
    );
    expect(preview).toHaveAttribute("data-stage-name", "Generating code…");
    expect(screen.queryByTitle("Live preview")).not.toBeInTheDocument();
  });

  it("shows Generating code spinner when generating but no screenshot", () => {
    render(
      createElement(PreviewPane, {
        previewUrl: "",
        pipelineStage: "generating",
        inspectEnabled: false,
        activeScopeNodeId: null,
        onToggleInspect: () => {
          // no-op
        },
        onInspectSelect: () => {
          // no-op
        },
      }),
    );

    expect(screen.getByText("Generating code…")).toBeInTheDocument();
    expect(screen.queryByTestId("screenshot-preview")).not.toBeInTheDocument();
  });

  it("shows ScreenshotPreview with resolving label for resolving stage", () => {
    render(
      createElement(PreviewPane, {
        previewUrl: "",
        pipelineStage: "resolving",
        screenshot: "http://cdn.example.com/shot.png",
        inspectEnabled: false,
        activeScopeNodeId: null,
        onToggleInspect: () => {
          // no-op
        },
        onInspectSelect: () => {
          // no-op
        },
      }),
    );

    expect(screen.getByTestId("screenshot-preview")).toHaveAttribute(
      "data-stage-name",
      "Resolving design…",
    );
  });
});
