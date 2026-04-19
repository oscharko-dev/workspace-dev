import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createElement } from "react";
import { PreviewPane } from "./PreviewPane";

const LEGACY_SPLIT_PREF_KEY = "workspace-dev:inspector:preview-split";
const VIEW_MODE_PREF_KEY = "workspace-dev:inspector:preview-view-mode";

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
    badgeText,
    stageName,
    externalOffsetY,
  }: {
    screenshotUrl: string;
    badgeText?: string;
    stageName?: string;
    externalOffsetY?: number;
  }) =>
    createElement(
      "div",
      {
        "data-testid": "screenshot-preview",
        "data-screenshot-url": screenshotUrl,
        "data-badge-text": badgeText ?? "",
        "data-stage-name": stageName ?? "",
        "data-external-offset-y": String(externalOffsetY ?? 0),
      },
      createElement("img", {
        src: screenshotUrl,
        alt: "Figma design preview",
      }),
      createElement("span", null, "Figma preview"),
      stageName !== undefined ? createElement("span", null, stageName) : null,
    ),
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
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

  it("renders ScreenshotPreview with image and badge when generating and screenshot provided", () => {
    render(
      createElement(PreviewPane, {
        previewUrl: "",
        pipelineStage: "generating",
        screenshot: "http://cdn.example.com/screenshot.png",
        inspectEnabled: false,
        activeScopeNodeId: null,
        onToggleInspect: () => {
          /* no-op */
        },
        onInspectSelect: () => {
          /* no-op */
        },
      }),
    );

    expect(
      screen.getByRole("img", { name: "Figma design preview" }),
    ).toHaveAttribute("src", "http://cdn.example.com/screenshot.png");
    expect(screen.getByText("Figma preview")).toBeInTheDocument();
    expect(screen.getByText("Generating code…")).toBeInTheDocument();
    expect(screen.queryByTitle("Live preview")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Phase 2 preview")).not.toBeInTheDocument();
  });

  it("renders ScreenshotPreview with extracting stage label when extracting and screenshot provided", () => {
    render(
      createElement(PreviewPane, {
        previewUrl: "",
        pipelineStage: "extracting",
        screenshot: "http://cdn.example.com/extracting.png",
        inspectEnabled: false,
        activeScopeNodeId: null,
        onToggleInspect: () => {
          /* no-op */
        },
        onInspectSelect: () => {
          /* no-op */
        },
      }),
    );

    expect(
      screen.getByRole("img", { name: "Figma design preview" }),
    ).toHaveAttribute("src", "http://cdn.example.com/extracting.png");
    expect(screen.getByText("Extracting design…")).toBeInTheDocument();
    expect(screen.getByText("Figma preview")).toBeInTheDocument();
    expect(screen.queryByTitle("Live preview")).not.toBeInTheDocument();
  });

  it("renders stage text fallback when generating and no screenshot provided", () => {
    render(
      createElement(PreviewPane, {
        previewUrl: "",
        pipelineStage: "generating",
        inspectEnabled: false,
        activeScopeNodeId: null,
        onToggleInspect: () => {
          /* no-op */
        },
        onInspectSelect: () => {
          /* no-op */
        },
      }),
    );

    expect(screen.getByText("Generating code…")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Phase 2 preview")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Live preview")).not.toBeInTheDocument();
  });

  it("renders extracting text fallback when extracting and no screenshot provided", () => {
    render(
      createElement(PreviewPane, {
        previewUrl: "",
        pipelineStage: "extracting",
        inspectEnabled: false,
        activeScopeNodeId: null,
        onToggleInspect: () => {
          /* no-op */
        },
        onInspectSelect: () => {
          /* no-op */
        },
      }),
    );

    expect(screen.getByText("Extracting design…")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Live preview")).not.toBeInTheDocument();
  });

  it("renders ScreenshotPreview with resolving stage label when resolving and screenshot provided", () => {
    render(
      createElement(PreviewPane, {
        previewUrl: "",
        pipelineStage: "resolving",
        screenshot: "http://cdn.example.com/shot.png",
        inspectEnabled: false,
        activeScopeNodeId: null,
        onToggleInspect: () => {
          /* no-op */
        },
        onInspectSelect: () => {
          /* no-op */
        },
      }),
    );

    expect(screen.getByText("Resolving design…")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Figma design preview" }),
    ).toHaveAttribute("src", "http://cdn.example.com/shot.png");
  });
});

describe("PreviewPane — split view", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  const noop = () => {
    // no-op
  };

  it("renders split toggle button", () => {
    render(
      createElement(PreviewPane, {
        previewUrl: "",
        inspectEnabled: false,
        activeScopeNodeId: null,
        onToggleInspect: noop,
        onInspectSelect: noop,
      }),
    );

    const toggle = screen.getByTestId("preview-split-toggle");
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("enables split mode on toggle click", () => {
    render(
      createElement(PreviewPane, {
        previewUrl: "http://127.0.0.1:4010/preview",
        inspectEnabled: false,
        activeScopeNodeId: null,
        onToggleInspect: noop,
        onInspectSelect: noop,
      }),
    );

    const toggle = screen.getByTestId("preview-split-toggle");
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem(VIEW_MODE_PREF_KEY)).toBe("split");
    // The legacy key must not be written by the new code path.
    expect(window.localStorage.getItem(LEGACY_SPLIT_PREF_KEY)).toBeNull();
  });

  it("reads persisted split preference on mount (via legacy key migration)", () => {
    // Seed only the legacy key — new code must migrate on read.
    window.localStorage.setItem(LEGACY_SPLIT_PREF_KEY, "1");

    render(
      createElement(PreviewPane, {
        previewUrl: "http://127.0.0.1:4010/preview",
        inspectEnabled: false,
        activeScopeNodeId: null,
        onToggleInspect: noop,
        onInspectSelect: noop,
      }),
    );

    expect(screen.getByTestId("preview-split-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Migration effect: new key written, legacy key removed.
    expect(window.localStorage.getItem(VIEW_MODE_PREF_KEY)).toBe("split");
    expect(window.localStorage.getItem(LEGACY_SPLIT_PREF_KEY)).toBeNull();
  });

  it("reads persisted split preference from the new view-mode key", () => {
    window.localStorage.setItem(VIEW_MODE_PREF_KEY, "split");

    render(
      createElement(PreviewPane, {
        previewUrl: "http://127.0.0.1:4010/preview",
        inspectEnabled: false,
        activeScopeNodeId: null,
        onToggleInspect: noop,
        onInspectSelect: noop,
      }),
    );

    expect(screen.getByTestId("preview-split-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("renders side-by-side panes with screenshot + iframe when split enabled and both available", () => {
    window.localStorage.setItem(VIEW_MODE_PREF_KEY, "split");

    render(
      createElement(PreviewPane, {
        previewUrl: "http://127.0.0.1:4010/preview",
        screenshot: "http://cdn.example.com/screenshot.png",
        inspectEnabled: false,
        activeScopeNodeId: null,
        onToggleInspect: noop,
        onInspectSelect: noop,
      }),
    );

    // Both pane labels visible
    expect(screen.getByText("Figma source")).toBeInTheDocument();
    expect(screen.getByText("Generated preview")).toBeInTheDocument();
    // Screenshot image rendered
    expect(
      screen.getByRole("img", { name: "Figma design preview" }),
    ).toHaveAttribute("src", "http://cdn.example.com/screenshot.png");
    // Iframe rendered
    expect(screen.getByTitle("Live preview")).toBeInTheDocument();
  });

  it("renders waiting placeholder on right pane when split enabled and no preview URL", () => {
    window.localStorage.setItem(VIEW_MODE_PREF_KEY, "split");

    render(
      createElement(PreviewPane, {
        previewUrl: "",
        screenshot: "http://cdn.example.com/screenshot.png",
        inspectEnabled: false,
        activeScopeNodeId: null,
        onToggleInspect: noop,
        onInspectSelect: noop,
      }),
    );

    expect(screen.getByText("Waiting for preview…")).toBeInTheDocument();
    expect(screen.queryByTitle("Live preview")).not.toBeInTheDocument();
  });

  it("uses the phase-2 preview URL during generating when split view is enabled", () => {
    window.localStorage.setItem(VIEW_MODE_PREF_KEY, "split");

    render(
      createElement(PreviewPane, {
        previewUrl: "",
        phase2PreviewUrl: "/workspace/jobs/job-1/preview/",
        pipelineStage: "generating",
        screenshot: "http://cdn.example.com/screenshot.png",
        inspectEnabled: false,
        activeScopeNodeId: null,
        onToggleInspect: noop,
        onInspectSelect: noop,
      }),
    );

    expect(screen.getByTitle("Live preview")).toHaveAttribute(
      "src",
      "/workspace/jobs/job-1/preview/",
    );
    expect(
      screen.getByRole("link", { name: "Open preview in new tab" }),
    ).toHaveAttribute("href", "/workspace/jobs/job-1/preview/");
  });

  it("keeps the ready-state live preview URL when a phase-2 preview URL is also present", () => {
    window.localStorage.setItem(VIEW_MODE_PREF_KEY, "split");

    render(
      createElement(PreviewPane, {
        previewUrl: "http://127.0.0.1:4010/preview",
        phase2PreviewUrl: "/workspace/jobs/job-1/preview/",
        pipelineStage: "ready",
        screenshot: "http://cdn.example.com/screenshot.png",
        inspectEnabled: false,
        activeScopeNodeId: null,
        onToggleInspect: noop,
        onInspectSelect: noop,
      }),
    );

    expect(screen.getByTitle("Live preview")).toHaveAttribute(
      "src",
      "http://127.0.0.1:4010/preview",
    );
  });

  it("renders screenshot placeholder on left pane when split enabled and no screenshot", () => {
    window.localStorage.setItem(VIEW_MODE_PREF_KEY, "split");

    render(
      createElement(PreviewPane, {
        previewUrl: "http://127.0.0.1:4010/preview",
        inspectEnabled: false,
        activeScopeNodeId: null,
        onToggleInspect: noop,
        onInspectSelect: noop,
      }),
    );

    expect(screen.getByText("Screenshot unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("wires iframe scroll sync when split is enabled and both panes render", () => {
    const consoleError = vi.spyOn(console, "error");
    window.localStorage.setItem(VIEW_MODE_PREF_KEY, "split");

    render(
      createElement(PreviewPane, {
        previewUrl: "http://127.0.0.1:4010/preview",
        screenshot: "http://cdn.example.com/screenshot.png",
        inspectEnabled: false,
        activeScopeNodeId: null,
        onToggleInspect: noop,
        onInspectSelect: noop,
      }),
    );

    expect(screen.getByTitle("Live preview")).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it("propagates iframe scroll as negative externalOffsetY on ScreenshotPreview", () => {
    // Stub HTMLIFrameElement.prototype.contentWindow so the sync effect can
    // probe same-origin and register its scroll listener.
    const listeners = new Set<EventListener>();
    let currentScrollY = 0;
    const fakeWin: Partial<Window> & {
      addEventListener: Window["addEventListener"];
      removeEventListener: Window["removeEventListener"];
    } = {
      get document() {
        return { documentElement: {} } as unknown as Document;
      },
      get scrollY() {
        return currentScrollY;
      },
      addEventListener: ((type: string, listener: EventListener) => {
        if (type === "scroll") listeners.add(listener);
      }) as Window["addEventListener"],
      removeEventListener: ((type: string, listener: EventListener) => {
        if (type === "scroll") listeners.delete(listener);
      }) as Window["removeEventListener"],
    };

    const originalDesc = Object.getOwnPropertyDescriptor(
      HTMLIFrameElement.prototype,
      "contentWindow",
    );
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      configurable: true,
      get() {
        return fakeWin as Window;
      },
    });

    try {
      window.localStorage.setItem(
        "workspace-dev:inspector:preview-view-mode",
        "split",
      );

      render(
        createElement(PreviewPane, {
          previewUrl: "http://127.0.0.1:4010/preview",
          pipelineStage: "generating",
          screenshot: "http://cdn.example.com/shot.png",
          inspectEnabled: false,
          activeScopeNodeId: null,
          onToggleInspect: () => {
            /* no-op */
          },
          onInspectSelect: () => {
            /* no-op */
          },
        }),
      );

      const preview = screen.getByTestId("screenshot-preview");
      expect(preview).toHaveAttribute("data-external-offset-y", "0");
      expect(listeners.size).toBe(1);

      // Fire a scroll — handler should read scrollY and update state.
      act(() => {
        currentScrollY = 42;
        for (const handler of listeners) handler(new Event("scroll"));
      });

      expect(screen.getByTestId("screenshot-preview")).toHaveAttribute(
        "data-external-offset-y",
        "-42",
      );

      // Scroll again; sign mirrors iframe scroll direction.
      act(() => {
        currentScrollY = 100;
        for (const handler of listeners) handler(new Event("scroll"));
      });
      expect(screen.getByTestId("screenshot-preview")).toHaveAttribute(
        "data-external-offset-y",
        "-100",
      );
    } finally {
      if (originalDesc) {
        Object.defineProperty(
          HTMLIFrameElement.prototype,
          "contentWindow",
          originalDesc,
        );
      } else {
        Reflect.deleteProperty(HTMLIFrameElement.prototype, "contentWindow");
      }
    }
  });
});

describe("PreviewPane — overlay view", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  const noop = (): void => {
    // no-op
  };

  function renderOverlay(
    overrides: Partial<{
      previewUrl: string;
      screenshot: string | undefined;
    }> = {},
  ): void {
    render(
      createElement(PreviewPane, {
        previewUrl: overrides.previewUrl ?? "http://127.0.0.1:4010/preview",
        screenshot: overrides.screenshot ?? "http://cdn.example.com/shot.png",
        inspectEnabled: false,
        activeScopeNodeId: null,
        onToggleInspect: noop,
        onInspectSelect: noop,
      }),
    );
  }

  it("renders the overlay toggle button", () => {
    renderOverlay();
    const toggle = screen.getByTestId("preview-overlay-toggle");
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("engages overlay mode and shows slider + layout when both layers present", () => {
    renderOverlay();

    const toggle = screen.getByTestId("preview-overlay-toggle");
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem(VIEW_MODE_PREF_KEY)).toBe("overlay");

    // Overlay layout renders an <img> (not via ScreenshotPreview mock) + iframe.
    expect(screen.getByTestId("preview-overlay-layout")).toBeInTheDocument();
    expect(screen.getByTitle("Live preview")).toBeInTheDocument();
    expect(
      screen.getByTestId("preview-overlay-opacity-slider"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("preview-overlay-quickset-controls"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("preview-overlay-shortcut-hint"),
    ).toHaveTextContent("Keys 0 / 5 / 1");
  });

  it("starts opacity at 50% and applies slider value to iframe style", () => {
    renderOverlay();
    fireEvent.click(screen.getByTestId("preview-overlay-toggle"));

    const slider = screen.getByTestId(
      "preview-overlay-opacity-slider",
    ) as HTMLInputElement;
    expect(slider.value).toBe("50");

    const iframe = screen.getByTitle("Live preview") as HTMLIFrameElement;
    expect(iframe.style.opacity).toBe("0.5");

    // 0%
    fireEvent.change(slider, { target: { value: "0" } });
    expect(
      (screen.getByTitle("Live preview") as HTMLIFrameElement).style.opacity,
    ).toBe("0");

    // 100%
    fireEvent.change(slider, { target: { value: "100" } });
    expect(
      (screen.getByTitle("Live preview") as HTMLIFrameElement).style.opacity,
    ).toBe("1");

    // 25%
    fireEvent.change(slider, { target: { value: "25" } });
    expect(
      (screen.getByTitle("Live preview") as HTMLIFrameElement).style.opacity,
    ).toBe("0.25");
  });

  it("clamps slider input at min (0) and max (100) boundaries", () => {
    renderOverlay();
    fireEvent.click(screen.getByTestId("preview-overlay-toggle"));

    const slider = screen.getByTestId(
      "preview-overlay-opacity-slider",
    ) as HTMLInputElement;

    // Below min — opacity clamps to 0.
    fireEvent.change(slider, { target: { value: "-10" } });
    expect(
      (screen.getByTitle("Live preview") as HTMLIFrameElement).style.opacity,
    ).toBe("0");
    expect(slider.getAttribute("aria-valuenow")).toBe("0");

    // Above max — opacity clamps to 1.
    fireEvent.change(slider, { target: { value: "999" } });
    expect(
      (screen.getByTitle("Live preview") as HTMLIFrameElement).style.opacity,
    ).toBe("1");
    expect(slider.getAttribute("aria-valuenow")).toBe("100");
  });

  it("exposes ARIA slider semantics on the opacity input", () => {
    renderOverlay();
    fireEvent.click(screen.getByTestId("preview-overlay-toggle"));

    const slider = screen.getByTestId("preview-overlay-opacity-slider");
    // Native <input type="range"> exposes the implicit ARIA "slider" role
    // via the accessibility tree (verified by getByRole), not as a DOM
    // attribute. Keep both checks: implicit role + the explicit ARIA props.
    expect(
      screen.getByRole("slider", { name: "Preview overlay opacity" }),
    ).toBe(slider);
    expect(slider).toHaveAttribute("aria-label", "Preview overlay opacity");
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", "100");
    expect(slider).toHaveAttribute("aria-valuenow", "50");
    expect(slider).toHaveAttribute("aria-valuetext", "50%");

    // Visible label updates with the value.
    expect(screen.getByText("Opacity 50%")).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: "25" } });
    expect(screen.getByText("Opacity 25%")).toBeInTheDocument();
    expect(
      screen.getByTestId("preview-overlay-opacity-slider"),
    ).toHaveAttribute("aria-valuenow", "25");
  });

  it("supports quick-set keyboard shortcuts 0/5/1 while overlay is active", () => {
    renderOverlay();
    fireEvent.click(screen.getByTestId("preview-overlay-toggle"));

    const root = screen.getByTestId("preview-pane-root");

    fireEvent.keyDown(root, { key: "0" });
    expect(
      (screen.getByTitle("Live preview") as HTMLIFrameElement).style.opacity,
    ).toBe("0");
    expect(
      screen.getByTestId("preview-overlay-opacity-slider"),
    ).toHaveAttribute("aria-valuenow", "0");

    fireEvent.keyDown(root, { key: "5" });
    expect(
      (screen.getByTitle("Live preview") as HTMLIFrameElement).style.opacity,
    ).toBe("0.5");
    expect(
      screen.getByTestId("preview-overlay-opacity-slider"),
    ).toHaveAttribute("aria-valuenow", "50");

    fireEvent.keyDown(root, { key: "1" });
    expect(
      (screen.getByTitle("Live preview") as HTMLIFrameElement).style.opacity,
    ).toBe("1");
    expect(
      screen.getByTestId("preview-overlay-opacity-slider"),
    ).toHaveAttribute("aria-valuenow", "100");
  });

  it("supports visible quick-set controls for 0%, 50%, and 100%", () => {
    renderOverlay();
    fireEvent.click(screen.getByTestId("preview-overlay-toggle"));

    const iframe = screen.getByTitle("Live preview") as HTMLIFrameElement;
    const slider = screen.getByTestId(
      "preview-overlay-opacity-slider",
    ) as HTMLInputElement;

    fireEvent.click(screen.getByTestId("preview-overlay-quickset-0"));
    expect(iframe.style.opacity).toBe("0");
    expect(slider).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByTestId("preview-overlay-quickset-0")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByTestId("preview-overlay-quickset-100"));
    expect(iframe.style.opacity).toBe("1");
    expect(slider).toHaveAttribute("aria-valuenow", "100");
    expect(
      screen.getByTestId("preview-overlay-quickset-100"),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("preview-overlay-quickset-50"));
    expect(iframe.style.opacity).toBe("0.5");
    expect(slider).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByTestId("preview-overlay-quickset-50")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("ignores keyboard shortcuts when overlay mode is not active", () => {
    renderOverlay();
    // Do not toggle overlay — viewMode stays "single".
    const root = screen.getByTestId("preview-pane-root");

    // Without overlay, the slider is not rendered so we assert it is absent
    // and key presses do not create it.
    expect(
      screen.queryByTestId("preview-overlay-opacity-slider"),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(root, { key: "0" });
    fireEvent.keyDown(root, { key: "5" });
    fireEvent.keyDown(root, { key: "1" });

    expect(
      screen.queryByTestId("preview-overlay-opacity-slider"),
    ).not.toBeInTheDocument();
  });

  it("ignores shortcuts when modifier keys are held", () => {
    renderOverlay();
    fireEvent.click(screen.getByTestId("preview-overlay-toggle"));

    const root = screen.getByTestId("preview-pane-root");

    // Slider starts at 50%. A ctrl+0 press should NOT snap it to 0%.
    fireEvent.keyDown(root, { key: "0", ctrlKey: true });
    expect(
      (screen.getByTitle("Live preview") as HTMLIFrameElement).style.opacity,
    ).toBe("0.5");

    fireEvent.keyDown(root, { key: "1", metaKey: true });
    expect(
      (screen.getByTitle("Live preview") as HTMLIFrameElement).style.opacity,
    ).toBe("0.5");
  });

  it("shows a waiting note when overlay is requested but only one layer is available", () => {
    // Preview URL missing — cannot overlay.
    window.localStorage.setItem(VIEW_MODE_PREF_KEY, "overlay");

    render(
      createElement(PreviewPane, {
        previewUrl: "",
        screenshot: "http://cdn.example.com/shot.png",
        inspectEnabled: false,
        activeScopeNodeId: null,
        onToggleInspect: noop,
        onInspectSelect: noop,
      }),
    );

    expect(screen.getByText("Waiting for both layers…")).toBeInTheDocument();
    // Slider must be hidden when both layers aren't ready.
    expect(
      screen.queryByTestId("preview-overlay-opacity-slider"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("preview-overlay-quickset-controls"),
    ).not.toBeInTheDocument();
    // Overlay layout must not render yet.
    expect(
      screen.queryByTestId("preview-overlay-layout"),
    ).not.toBeInTheDocument();
  });

  it("makes overlay mutually exclusive with split", () => {
    renderOverlay();

    const splitToggle = screen.getByTestId("preview-split-toggle");
    const overlayToggle = screen.getByTestId("preview-overlay-toggle");

    fireEvent.click(splitToggle);
    expect(splitToggle).toHaveAttribute("aria-pressed", "true");
    expect(overlayToggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(overlayToggle);
    expect(overlayToggle).toHaveAttribute("aria-pressed", "true");
    // Split must have been released when overlay was selected.
    expect(splitToggle).toHaveAttribute("aria-pressed", "false");
    expect(window.localStorage.getItem(VIEW_MODE_PREF_KEY)).toBe("overlay");

    // And vice-versa.
    fireEvent.click(splitToggle);
    expect(splitToggle).toHaveAttribute("aria-pressed", "true");
    expect(overlayToggle).toHaveAttribute("aria-pressed", "false");
  });
});
