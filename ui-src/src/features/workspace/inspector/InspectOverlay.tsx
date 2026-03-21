import { useEffect, useRef, useState, type JSX } from "react";

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
}

export function InspectOverlay({
  inspectEnabled,
  onToggleInspect,
  onSelectNode,
  iframeRef
}: InspectOverlayProps): JSX.Element {
  const [overlayRect, setOverlayRect] = useState<OverlayRect | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Send enable/disable messages to the iframe
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) {
      return;
    }
    iframe.contentWindow.postMessage(
      { type: inspectEnabled ? "inspect:enable" : "inspect:disable" },
      "*"
    );
  }, [inspectEnabled, iframeRef]);

  // Listen for postMessage from the iframe — compute overlay rect in the event callback
  useEffect(() => {
    const handler = (event: MessageEvent<unknown>): void => {
      if (!event.data || typeof event.data !== "object") {
        return;
      }
      const data = event.data as Record<string, unknown>;
      if (typeof data.type !== "string") {
        return;
      }

      if (data.type === "inspect:hover" && inspectEnabled) {
        const rect = data.rect as { x: number; y: number; width: number; height: number } | undefined;
        if (typeof data.irNodeId === "string" && rect) {
          const iframe = iframeRef.current;
          const overlayEl = overlayRef.current;
          if (iframe && overlayEl) {
            const iframeRect = iframe.getBoundingClientRect();
            const containerRect = overlayEl.getBoundingClientRect();
            setOverlayRect({
              left: iframeRect.left - containerRect.left + rect.x,
              top: iframeRect.top - containerRect.top + rect.y,
              width: rect.width,
              height: rect.height,
              irNodeName: typeof data.irNodeName === "string" ? data.irNodeName : ""
            });
          }
        }
      }

      if (data.type === "inspect:select" && inspectEnabled) {
        if (typeof data.irNodeId === "string") {
          onSelectNode(data.irNodeId);
        }
      }
    };

    window.addEventListener("message", handler);
    return () => {
      window.removeEventListener("message", handler);
    };
  }, [inspectEnabled, onSelectNode, iframeRef]);

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
