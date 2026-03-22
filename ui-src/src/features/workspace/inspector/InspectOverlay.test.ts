import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { createElement } from "react";
import { InspectOverlay } from "./InspectOverlay";

const PREVIEW_ORIGIN = "http://127.0.0.1:19831";
const PREVIEW_URL = `${PREVIEW_ORIGIN}/workspace/repros/job-1/`;

describe("InspectOverlay", () => {
  const onToggleInspect = vi.fn();
  const onSelectNode = vi.fn();
  const defaultActiveScopeNodeId = null;

  const createIframeRef = (): {
    iframeRef: React.RefObject<HTMLIFrameElement | null>;
    postMessage: ReturnType<typeof vi.fn>;
    iframeContentWindow: { postMessage: ReturnType<typeof vi.fn> };
  } => {
    const iframe = document.createElement("iframe");
    iframe.src = PREVIEW_URL;
    const postMessage = vi.fn();
    const iframeContentWindow = { postMessage };

    Object.defineProperty(iframe, "contentWindow", {
      value: iframeContentWindow,
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
      postMessage,
      iframeContentWindow
    };
  };

  const getLastEnableSessionToken = ({
    postMessage
  }: {
    postMessage: ReturnType<typeof vi.fn>;
  }): string => {
    const calls = [...postMessage.mock.calls].reverse();
    const enableCall = calls.find(([message]) => {
      return Boolean(message) && typeof message === "object" && (message as { type?: string }).type === "inspect:enable";
    });
    expect(enableCall).toBeDefined();
    if (!enableCall || typeof enableCall[0] !== "object" || !enableCall[0]) {
      throw new Error("inspect:enable call was not found");
    }

    const token = (enableCall[0] as { sessionToken?: unknown }).sessionToken;
    expect(typeof token).toBe("string");
    if (typeof token !== "string") {
      throw new Error("session token is missing");
    }
    return token;
  };

  const getLastMessageByType = ({
    postMessage,
    type
  }: {
    postMessage: ReturnType<typeof vi.fn>;
    type: string;
  }): Record<string, unknown> | null => {
    const calls = [...postMessage.mock.calls].reverse();
    const match = calls.find(([message]) => {
      return Boolean(message) && typeof message === "object" && (message as { type?: string }).type === type;
    });
    if (!match || typeof match[0] !== "object" || !match[0]) {
      return null;
    }
    return match[0] as Record<string, unknown>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("posts inspect:enable/scope:clear/disable with session token and explicit preview origin", () => {
    const { iframeRef, postMessage } = createIframeRef();

    const { rerender } = render(
      createElement(InspectOverlay, {
        inspectEnabled: false,
        activeScopeNodeId: defaultActiveScopeNodeId,
        onToggleInspect,
        onSelectNode,
        iframeRef,
        iframeLoadVersion: 0
      })
    );

    expect(postMessage).toHaveBeenCalledTimes(0);

    rerender(
      createElement(InspectOverlay, {
        inspectEnabled: true,
        activeScopeNodeId: defaultActiveScopeNodeId,
        onToggleInspect,
        onSelectNode,
        iframeRef,
        iframeLoadVersion: 0
      })
    );

    const sessionToken = getLastEnableSessionToken({ postMessage });
    expect(postMessage).toHaveBeenCalledWith(
      { type: "inspect:enable", sessionToken },
      PREVIEW_ORIGIN
    );
    expect(postMessage).toHaveBeenCalledWith(
      { type: "inspect:scope:clear", sessionToken },
      PREVIEW_ORIGIN
    );

    rerender(
      createElement(InspectOverlay, {
        inspectEnabled: false,
        activeScopeNodeId: defaultActiveScopeNodeId,
        onToggleInspect,
        onSelectNode,
        iframeRef,
        iframeLoadVersion: 0
      })
    );

    expect(postMessage).toHaveBeenLastCalledWith(
      { type: "inspect:disable", sessionToken },
      PREVIEW_ORIGIN
    );
  });

  it("posts inspect:scope:set and inspect:scope:clear for scope transitions", () => {
    const { iframeRef, postMessage } = createIframeRef();
    const { rerender } = render(
      createElement(InspectOverlay, {
        inspectEnabled: true,
        activeScopeNodeId: defaultActiveScopeNodeId,
        onToggleInspect,
        onSelectNode,
        iframeRef,
        iframeLoadVersion: 0
      })
    );

    const sessionToken = getLastEnableSessionToken({ postMessage });

    rerender(
      createElement(InspectOverlay, {
        inspectEnabled: true,
        activeScopeNodeId: "nav-button",
        onToggleInspect,
        onSelectNode,
        iframeRef,
        iframeLoadVersion: 0
      })
    );

    expect(postMessage).toHaveBeenLastCalledWith(
      { type: "inspect:scope:set", sessionToken, irNodeId: "nav-button" },
      PREVIEW_ORIGIN
    );

    rerender(
      createElement(InspectOverlay, {
        inspectEnabled: true,
        activeScopeNodeId: defaultActiveScopeNodeId,
        onToggleInspect,
        onSelectNode,
        iframeRef,
        iframeLoadVersion: 0
      })
    );

    const lastScopeClear = getLastMessageByType({ postMessage, type: "inspect:scope:clear" });
    expect(lastScopeClear).toEqual({ type: "inspect:scope:clear", sessionToken });
  });

  it("renders hover highlight and tooltip from validated inspect:hover postMessage", async () => {
    const { iframeRef, postMessage, iframeContentWindow } = createIframeRef();

    render(
      createElement(InspectOverlay, {
        inspectEnabled: true,
        activeScopeNodeId: defaultActiveScopeNodeId,
        onToggleInspect,
        onSelectNode,
        iframeRef,
        iframeLoadVersion: 0
      })
    );

    const sessionToken = getLastEnableSessionToken({ postMessage });
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
          sessionToken,
          irNodeId: "home-title",
          irNodeName: "Title",
          rect: {
            x: 20,
            y: 30,
            width: 120,
            height: 42
          }
        },
        origin: PREVIEW_ORIGIN,
        source: iframeContentWindow as unknown as MessageEventSource
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

  it("accepts inspect:select only for expected origin/source/session", async () => {
    const { iframeRef, postMessage, iframeContentWindow } = createIframeRef();

    render(
      createElement(InspectOverlay, {
        inspectEnabled: true,
        activeScopeNodeId: defaultActiveScopeNodeId,
        onToggleInspect,
        onSelectNode,
        iframeRef,
        iframeLoadVersion: 0
      })
    );

    const sessionToken = getLastEnableSessionToken({ postMessage });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "inspect:select",
          sessionToken,
          irNodeId: "foreign-origin-node"
        },
        origin: "https://evil.example",
        source: iframeContentWindow as unknown as MessageEventSource
      })
    );

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "inspect:select",
          sessionToken: "wrong-session-token",
          irNodeId: "wrong-session-node"
        },
        origin: PREVIEW_ORIGIN,
        source: iframeContentWindow as unknown as MessageEventSource
      })
    );

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "inspect:select",
          sessionToken,
          irNodeId: "valid-node"
        },
        origin: PREVIEW_ORIGIN,
        source: iframeContentWindow as unknown as MessageEventSource
      })
    );

    await waitFor(() => {
      expect(onSelectNode).toHaveBeenCalledTimes(1);
      expect(onSelectNode).toHaveBeenCalledWith("valid-node");
    });
  });

  it("ignores invalid message payloads", async () => {
    const { iframeRef, postMessage, iframeContentWindow } = createIframeRef();

    render(
      createElement(InspectOverlay, {
        inspectEnabled: true,
        activeScopeNodeId: defaultActiveScopeNodeId,
        onToggleInspect,
        onSelectNode,
        iframeRef,
        iframeLoadVersion: 0
      })
    );

    const sessionToken = getLastEnableSessionToken({ postMessage });

    window.dispatchEvent(new MessageEvent("message", { data: null }));
    window.dispatchEvent(new MessageEvent("message", { data: "invalid" }));
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "inspect:hover",
          sessionToken,
          irNodeId: 123,
          rect: "invalid"
        },
        origin: PREVIEW_ORIGIN,
        source: iframeContentWindow as unknown as MessageEventSource
      })
    );

    await waitFor(() => {
      expect(screen.queryByTestId("inspect-highlight")).not.toBeInTheDocument();
      expect(onSelectNode).not.toHaveBeenCalled();
    });
  });

  it("clears hover overlay when inspect mode is disabled", async () => {
    const { iframeRef, postMessage, iframeContentWindow } = createIframeRef();

    const { rerender } = render(
      createElement(InspectOverlay, {
        inspectEnabled: true,
        activeScopeNodeId: defaultActiveScopeNodeId,
        onToggleInspect,
        onSelectNode,
        iframeRef,
        iframeLoadVersion: 0
      })
    );

    const sessionToken = getLastEnableSessionToken({ postMessage });
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
          sessionToken,
          irNodeId: "home-title",
          irNodeName: "Title",
          rect: {
            x: 10,
            y: 15,
            width: 90,
            height: 24
          }
        },
        origin: PREVIEW_ORIGIN,
        source: iframeContentWindow as unknown as MessageEventSource
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("inspect-highlight")).toBeInTheDocument();
    });

    rerender(
      createElement(InspectOverlay, {
        inspectEnabled: false,
        activeScopeNodeId: defaultActiveScopeNodeId,
        onToggleInspect,
        onSelectNode,
        iframeRef,
        iframeLoadVersion: 0
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
        activeScopeNodeId: defaultActiveScopeNodeId,
        onToggleInspect,
        onSelectNode,
        iframeRef,
        iframeLoadVersion: 0
      })
    );

    fireEvent.click(screen.getByTestId("inspect-toggle"));
    expect(onToggleInspect).toHaveBeenCalledTimes(1);
  });
});
