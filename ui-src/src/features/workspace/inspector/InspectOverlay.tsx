import { useCallback, useEffect, useRef, useState, type JSX } from "react";

interface OverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
  irNodeName: string;
}

interface InspectOverlayProps {
  inspectEnabled: boolean;
  activeScopeNodeId: string | null;
  onToggleInspect: () => void;
  onSelectNode: (irNodeId: string) => void;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  iframeLoadVersion: number;
}

type InspectBridgeControlMessage =
  | {
      type: "inspect:enable" | "inspect:disable" | "inspect:scope:clear";
      sessionToken: string;
    }
  | {
      type: "inspect:scope:set";
      sessionToken: string;
      irNodeId: string;
    };

function createInspectSessionToken(): string {
  if (typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const randomPart = Math.random().toString(36).slice(2, 10);
  return `inspect-${Date.now().toString(36)}-${randomPart}`;
}

function toSafeOrigin(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) {
    return null;
  }
  try {
    const origin = new URL(rawUrl, window.location.href).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isHoverRect(value: unknown): value is { x: number; y: number; width: number; height: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const rect = value as Record<string, unknown>;
  return (
    isFiniteNumber(rect.x) &&
    isFiniteNumber(rect.y) &&
    isFiniteNumber(rect.width) &&
    isFiniteNumber(rect.height)
  );
}

export function InspectOverlay({
  inspectEnabled,
  activeScopeNodeId,
  onToggleInspect,
  onSelectNode,
  iframeRef,
  iframeLoadVersion
}: InspectOverlayProps): JSX.Element {
  const [overlayRect, setOverlayRect] = useState<OverlayRect | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const sessionTokenRef = useRef<string | null>(null);
  const expectedPreviewOriginRef = useRef<string | null>(null);

  const resolvePreviewOrigin = useCallback((): string | null => {
    const iframe = iframeRef.current;
    if (!iframe) {
      return null;
    }
    const origin = toSafeOrigin(iframe.src);
    if (origin) {
      expectedPreviewOriginRef.current = origin;
    }
    return origin;
  }, [iframeRef]);

  const postInspectControlMessage = useCallback(
    (message: InspectBridgeControlMessage): void => {
      const iframe = iframeRef.current;
      const targetWindow = iframe?.contentWindow;
      if (!targetWindow) {
        return;
      }
      const previewOrigin = resolvePreviewOrigin();
      if (!previewOrigin) {
        return;
      }
      targetWindow.postMessage(message, previewOrigin);
    },
    [iframeRef, resolvePreviewOrigin]
  );

  // Send enable/disable messages to the iframe (also re-send on iframe load)
  useEffect(() => {
    if (!inspectEnabled) {
      const activeSessionToken = sessionTokenRef.current;
      if (activeSessionToken) {
        postInspectControlMessage({
          type: "inspect:disable",
          sessionToken: activeSessionToken
        });
      }
      sessionTokenRef.current = null;
      expectedPreviewOriginRef.current = null;
      queueMicrotask(() => {
        setOverlayRect(null);
      });
      return;
    }

    if (!sessionTokenRef.current) {
      sessionTokenRef.current = createInspectSessionToken();
    }
    postInspectControlMessage({
      type: "inspect:enable",
      sessionToken: sessionTokenRef.current
    });
  }, [inspectEnabled, iframeLoadVersion, postInspectControlMessage]);

  // Keep preview scope spotlight synchronized with Inspector scope state.
  useEffect(() => {
    if (!inspectEnabled) {
      return;
    }
    const activeSessionToken = sessionTokenRef.current;
    if (!activeSessionToken) {
      return;
    }
    if (typeof activeScopeNodeId === "string" && activeScopeNodeId.length > 0) {
      postInspectControlMessage({
        type: "inspect:scope:set",
        sessionToken: activeSessionToken,
        irNodeId: activeScopeNodeId
      });
      return;
    }
    postInspectControlMessage({
      type: "inspect:scope:clear",
      sessionToken: activeSessionToken
    });
  }, [activeScopeNodeId, inspectEnabled, iframeLoadVersion, postInspectControlMessage]);

  // Listen for postMessage from the iframe — compute overlay rect in the event callback
  useEffect(() => {
    const handler = (event: MessageEvent<unknown>): void => {
      if (!inspectEnabled) {
        return;
      }
      if (!event.data || typeof event.data !== "object") {
        return;
      }
      const data = event.data as Record<string, unknown>;
      if (typeof data.type !== "string") {
        return;
      }
      if (data.type !== "inspect:hover" && data.type !== "inspect:select") {
        return;
      }

      const iframe = iframeRef.current;
      const iframeWindow = iframe?.contentWindow;
      if (!iframe || !iframeWindow) {
        return;
      }
      if (event.source !== iframeWindow) {
        return;
      }

      const previewOrigin = expectedPreviewOriginRef.current ?? resolvePreviewOrigin();
      if (!previewOrigin || event.origin !== previewOrigin) {
        return;
      }

      const activeSessionToken = sessionTokenRef.current;
      if (
        !activeSessionToken ||
        typeof data.sessionToken !== "string" ||
        data.sessionToken !== activeSessionToken
      ) {
        return;
      }

      if (data.type === "inspect:hover") {
        if (typeof data.irNodeId !== "string" || !isHoverRect(data.rect)) {
          return;
        }

        const overlayEl = overlayRef.current;
        if (!overlayEl) {
          return;
        }

        const iframeRect = iframe.getBoundingClientRect();
        const containerRect = overlayEl.getBoundingClientRect();
        setOverlayRect({
          left: iframeRect.left - containerRect.left + data.rect.x,
          top: iframeRect.top - containerRect.top + data.rect.y,
          width: data.rect.width,
          height: data.rect.height,
          irNodeName: typeof data.irNodeName === "string" ? data.irNodeName : ""
        });
      }

      if (data.type === "inspect:select") {
        if (typeof data.irNodeId === "string") {
          onSelectNode(data.irNodeId);
        }
      }
    };

    window.addEventListener("message", handler);
    return () => {
      window.removeEventListener("message", handler);
    };
  }, [inspectEnabled, onSelectNode, iframeRef, resolvePreviewOrigin]);

  // Derive effective overlay rect — null when inspect is disabled
  const effectiveOverlayRect = inspectEnabled ? overlayRect : null;

  return (
    <div ref={overlayRef} className="pointer-events-none absolute inset-0" data-testid="inspect-overlay-container">
      {/* Toggle button — always pointer-events-auto */}
      <div className="pointer-events-auto absolute right-3 top-3 z-20">
        <button
          type="button"
          data-testid="inspect-toggle"
          onClick={onToggleInspect}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors ${
            inspectEnabled
              ? "border-[#4eba87] bg-[#000000]/85 text-[#4eba87]"
              : "border-[#333333] bg-[#000000]/85 text-white/70 hover:border-[#4eba87]/40 hover:text-[#4eba87]"
          }`}
          aria-pressed={inspectEnabled}
          title={inspectEnabled ? "Disable inspect mode" : "Enable inspect mode"}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M6.672 1.911a1 1 0 10-1.932.518l.259.966a1 1 0 001.932-.518l-.26-.966zM2.429 4.74a1 1 0 10-.517 1.932l.966.259a1 1 0 00.517-1.932l-.966-.26zm8.814-.569a1 1 0 00-1.415-1.414l-.707.707a1 1 0 101.414 1.415l.708-.708zm-7.071 7.072l.707-.707A1 1 0 003.465 9.12l-.708.707a1 1 0 001.415 1.415zM12 7.5a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zm-4.5 2.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"
              clipRule="evenodd"
            />
          </svg>
          Inspect
        </button>
      </div>

      {/* Hover overlay highlight */}
      {effectiveOverlayRect ? (
        <>
          <div
            data-testid="inspect-highlight"
            className="removed-style-1"
          />
          {effectiveOverlayRect.irNodeName ? (
            <div
              data-testid="inspect-tooltip"
              className="removed-style-2"
            >
              {effectiveOverlayRect.irNodeName}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
