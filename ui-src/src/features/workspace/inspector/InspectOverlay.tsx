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
  onToggleInspect: () => void;
  onSelectNode: (irNodeId: string) => void;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  iframeLoadVersion: number;
}

function createInspectSessionToken(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
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
    (type: "inspect:enable" | "inspect:disable"): void => {
      const iframe = iframeRef.current;
      const targetWindow = iframe?.contentWindow;
      const sessionToken = sessionTokenRef.current;
      if (!targetWindow || !sessionToken) {
        return;
      }
      const previewOrigin = resolvePreviewOrigin();
      targetWindow.postMessage(
        {
          type,
          sessionToken
        },
        previewOrigin ?? "*"
      );
    },
    [iframeRef, resolvePreviewOrigin]
  );

  // Send enable/disable messages to the iframe (also re-send on iframe load)
  useEffect(() => {
    if (!inspectEnabled) {
      if (sessionTokenRef.current) {
        postInspectControlMessage("inspect:disable");
      }
      sessionTokenRef.current = null;
      expectedPreviewOriginRef.current = null;
      setOverlayRect(null);
      return;
    }

    if (!sessionTokenRef.current) {
      sessionTokenRef.current = createInspectSessionToken();
    }
    postInspectControlMessage("inspect:enable");
  }, [inspectEnabled, iframeLoadVersion, postInspectControlMessage]);

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
              ? "border-blue-400 bg-blue-50 text-blue-700"
              : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
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
            style={{
              position: "absolute",
              left: effectiveOverlayRect.left,
              top: effectiveOverlayRect.top,
              width: effectiveOverlayRect.width,
              height: effectiveOverlayRect.height,
              border: "2px solid rgba(59, 130, 246, 0.8)",
              background: "rgba(59, 130, 246, 0.15)",
              transition: "all 80ms ease",
              pointerEvents: "none"
            }}
          />
          {effectiveOverlayRect.irNodeName ? (
            <div
              data-testid="inspect-tooltip"
              style={{
                position: "absolute",
                left: effectiveOverlayRect.left,
                top: Math.max(0, effectiveOverlayRect.top - 22),
                background: "#1e293b",
                color: "#f8fafc",
                font: "11px/1.3 system-ui, sans-serif",
                padding: "2px 6px",
                borderRadius: 3,
                whiteSpace: "nowrap",
                pointerEvents: "none"
              }}
            >
              {effectiveOverlayRect.irNodeName}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
