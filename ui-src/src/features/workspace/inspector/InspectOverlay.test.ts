import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { createElement } from "react";
import { InspectOverlay } from "./InspectOverlay";

describe("InspectOverlay", () => {
  const onToggleInspect = vi.fn();
  const onSelectNode = vi.fn();

  const createIframeRef = (): {
    iframeRef: React.RefObject<HTMLIFrameElement | null>;
    postMessage: ReturnType<typeof vi.fn>;
  } => {
    const iframe = document.createElement("iframe");
    const postMessage = vi.fn();

    Object.defineProperty(iframe, "contentWindow", {
      value: { postMessage },
      configurable: true
    });

    Object.defineProperty(iframe, "getBoundingClientRect", {
      value: () => ({
        x: 100,
        y: 50,
        left: 100,
        top: 50,
        right: 500,
        bottom: 350,
        width: 400,
        height: 300,
        toJSON: () => ({})
      }),
      configurable: true
    });

    return {
      iframeRef: { current: iframe },
      postMessage
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("posts inspect:disable on mount and inspect:enable when toggled on", async () => {
    const { iframeRef, postMessage } = createIframeRef();

    const { rerender } = render(
      createElement(InspectOverlay, {
        inspectEnabled: false,
        onToggleInspect,
        onSelectNode,
        iframeRef
      })
    );

    expect(postMessage).toHaveBeenCalledWith({ type: "inspect:disable" }, "*");

    rerender(
      createElement(InspectOverlay, {
        inspectEnabled: true,
        onToggleInspect,
        onSelectNode,
        iframeRef
      })
    );

    expect(postMessage).toHaveBeenLastCalledWith({ type: "inspect:enable" }, "*");
  });

  it("renders hover highlight and tooltip from inspect:hover postMessage", async () => {
    const { iframeRef } = createIframeRef();

    render(
      createElement(InspectOverlay, {
        inspectEnabled: true,
        onToggleInspect,
        onSelectNode,
        iframeRef
      })
    );

    const container = screen.getByTestId("inspect-overlay-container");
    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        toJSON: () => ({})
      }),
      configurable: true
    });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "inspect:hover",
          irNodeId: "home-title",
          irNodeName: "Title",
          rect: {
            x: 20,
            y: 30,
            width: 120,
            height: 42
          }
        }
      })
    );

    await waitFor(() => {
      const highlight = screen.getByTestId("inspect-highlight");
      expect(highlight).toBeInTheDocument();
      expect(highlight).toHaveStyle({
        left: "120px",
        top: "80px",
        width: "120px",
        height: "42px"
      });
      expect(screen.getByTestId("inspect-tooltip")).toHaveTextContent("Title");
    });
  });

  it("calls onSelectNode for inspect:select postMessage", async () => {
    const { iframeRef } = createIframeRef();

    render(
      createElement(InspectOverlay, {
        inspectEnabled: true,
        onToggleInspect,
        onSelectNode,
        iframeRef
      })
    );

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "inspect:select",
          irNodeId: "nav-button"
        }
      })
    );

    await waitFor(() => {
      expect(onSelectNode).toHaveBeenCalledWith("nav-button");
    });
  });

  it("ignores invalid message payloads", async () => {
    const { iframeRef } = createIframeRef();

    render(
      createElement(InspectOverlay, {
        inspectEnabled: true,
        onToggleInspect,
        onSelectNode,
        iframeRef
      })
    );

    window.dispatchEvent(new MessageEvent("message", { data: null }));
    window.dispatchEvent(new MessageEvent("message", { data: "invalid" }));
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "inspect:hover",
          irNodeId: 123,
          rect: "invalid"
        }
      })
    );

    await waitFor(() => {
      expect(screen.queryByTestId("inspect-highlight")).not.toBeInTheDocument();
      expect(onSelectNode).not.toHaveBeenCalled();
    });
  });

  it("clears hover overlay when inspect mode is disabled", async () => {
    const { iframeRef } = createIframeRef();

    const { rerender } = render(
      createElement(InspectOverlay, {
        inspectEnabled: true,
        onToggleInspect,
        onSelectNode,
        iframeRef
      })
    );

    const container = screen.getByTestId("inspect-overlay-container");
    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        toJSON: () => ({})
      }),
      configurable: true
    });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "inspect:hover",
          irNodeId: "home-title",
          irNodeName: "Title",
          rect: {
            x: 10,
            y: 15,
            width: 90,
            height: 24
          }
        }
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("inspect-highlight")).toBeInTheDocument();
    });

    rerender(
      createElement(InspectOverlay, {
        inspectEnabled: false,
        onToggleInspect,
        onSelectNode,
        iframeRef
      })
    );

    await waitFor(() => {
      expect(screen.queryByTestId("inspect-highlight")).not.toBeInTheDocument();
    });
  });

  it("calls onToggleInspect when toggle button is clicked", () => {
    const { iframeRef } = createIframeRef();

    render(
      createElement(InspectOverlay, {
        inspectEnabled: false,
        onToggleInspect,
        onSelectNode,
        iframeRef
      })
    );

    fireEvent.click(screen.getByTestId("inspect-toggle"));
    expect(onToggleInspect).toHaveBeenCalledTimes(1);
  });
});
