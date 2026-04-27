import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { type MergedScreen } from "../data/types";
import { OverlaySideBySide } from "./overlay-side-by-side";
import { OverlayOnionSkin } from "./overlay-onion-skin";
import { OverlayHeatmap } from "./overlay-heatmap";
import { OverlayConfidenceView } from "./overlay-confidence-view";
import { type OverlayMode } from "./overlay-mode";
import "../visual-quality.css";

interface ZoomModalProps {
  screen: MergedScreen;
  mode: OverlayMode;
  onClose: () => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

/**
 * Full-viewport zoom modal. Supports wheel-zoom, drag-to-pan when zoomed in,
 * and keyboard close via Escape. Maintains basic a11y: `role="dialog"`,
 * `aria-modal="true"`, focus restoration on close, and a labelled close
 * button.
 */
export function ZoomModal({
  screen,
  mode,
  onClose,
}: ZoomModalProps): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [panState, setPanState] = useState<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const getFocusableElements = useCallback((): HTMLElement[] => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return [];
    }

    return Array.from(
      dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter(
      (element) =>
        !element.hasAttribute("disabled") &&
        element.getAttribute("aria-hidden") !== "true",
    );
  }, []);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const firstFocusable = getFocusableElements()[0];
    if (firstFocusable) {
      firstFocusable.focus();
      return () => {
        previouslyFocused.current?.focus();
      };
    }

    dialogRef.current?.focus();
    return () => {
      previouslyFocused.current?.focus();
    };
  }, [getFocusableElements]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements.at(-1);
      if (!firstFocusable || !lastFocusable) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const activeElement = document.activeElement;

      if (event.shiftKey) {
        if (
          activeElement === firstFocusable ||
          activeElement === dialogRef.current
        ) {
          event.preventDefault();
          lastFocusable.focus();
        }
        return;
      }

      if (
        activeElement === lastFocusable ||
        activeElement === dialogRef.current
      ) {
        event.preventDefault();
        firstFocusable.focus();
      }
    },
    [getFocusableElements, onClose],
  );

  const handleBackdropClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setZoom((prev) => {
      const delta = event.deltaY > 0 ? -0.25 : 0.25;
      return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev + delta));
    });
  }, []);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (zoom <= 1) {
        return;
      }
      setPanState({
        startX: event.clientX,
        startY: event.clientY,
        origX: offset.x,
        origY: offset.y,
      });
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [zoom, offset],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!panState) {
        return;
      }
      const dx = event.clientX - panState.startX;
      const dy = event.clientY - panState.startY;
      setOffset({ x: panState.origX + dx, y: panState.origY + dy });
    },
    [panState],
  );

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!panState) {
        return;
      }
      setPanState(null);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Some browsers release the capture automatically; tolerate silently.
      }
    },
    [panState],
  );

  const handleReset = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Zoomed view — ${screen.screenName}`}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm outline-none"
      data-testid="zoom-modal"
    >
      <div className="relative flex h-full max-h-[90vh] w-full max-w-[90vw] flex-col overflow-hidden rounded-lg border border-white/10 bg-[#101010]">
        <header className="flex items-center justify-between border-b border-black/40 bg-[#171717] px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs font-semibold text-white">
              {screen.fixtureId}
            </span>
            <span className="truncate text-[11px] text-white/55">
              {screen.screenName}
            </span>
            <span className="rounded border border-white/10 bg-[#0a0a0a] px-1.5 py-0.5 text-[10px] font-mono text-white/45">
              {screen.viewportLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              className="cursor-pointer rounded border border-white/10 bg-[#0a0a0a] px-2 py-1 text-[11px] text-white/60 transition hover:border-[#4eba87]/40 hover:text-[#4eba87]"
            >
              Reset zoom ({(zoom * 100).toFixed(0)}%)
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close zoom view"
              className="grid size-6 cursor-pointer place-items-center rounded border border-white/10 bg-[#0a0a0a] text-white/60 transition hover:border-rose-400/40 hover:text-rose-300"
            >
              ×
            </button>
          </div>
        </header>
        <div
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className={`flex-1 overflow-hidden bg-[#060606] p-4 ${
            zoom > 1 ? "cursor-grab active:cursor-grabbing" : ""
          }`}
        >
          <div
            className="vq-zoom-canvas h-full w-full"
            style={
              {
                "--vq-zoom-transform": `translate(${offset.x.toFixed(0)}px, ${offset.y.toFixed(0)}px) scale(${zoom.toFixed(2)})`,
                "--vq-zoom-transition":
                  panState !== null ? "none" : "transform 80ms ease-out",
              } as React.CSSProperties
            }
          >
            {mode === "side-by-side" ? (
              <OverlaySideBySide screen={screen} onZoom={handleReset} />
            ) : null}
            {mode === "onion-skin" ? (
              <OverlayOnionSkin screen={screen} onZoom={handleReset} />
            ) : null}
            {mode === "heatmap" ? (
              <OverlayHeatmap screen={screen} onZoom={handleReset} />
            ) : null}
            {mode === "confidence" ? (
              <OverlayConfidenceView screen={screen} onZoom={handleReset} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
