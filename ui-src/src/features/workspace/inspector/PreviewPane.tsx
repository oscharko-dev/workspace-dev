import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { InspectOverlay } from "./InspectOverlay";
import { ScreenshotPreview } from "./ScreenshotPreview";
import type { PipelineStage } from "./paste-pipeline";

interface PreviewPaneProps {
  previewUrl: string;
  phase2PreviewUrl?: string;
  inspectEnabled: boolean;
  activeScopeNodeId: string | null;
  onToggleInspect: () => void;
  onInspectSelect: (irNodeId: string) => void;
  pipelineStage?: PipelineStage;
  screenshot?: string;
}

type ViewMode = "single" | "split" | "overlay";

const VIEW_MODE_PREF_KEY = "workspace-dev:inspector:preview-view-mode";
const LEGACY_SPLIT_PREF_KEY = "workspace-dev:inspector:preview-split";
const DEFAULT_OVERLAY_OPACITY = 50;
const OVERLAY_QUICK_SET_VALUES = [0, 50, 100] as const;

function isViewMode(value: string | null): value is ViewMode {
  return value === "single" || value === "split" || value === "overlay";
}

// Reads the persisted view-mode, migrating the legacy "preview-split" key.
// Legacy "1" → "split"; legacy "0" or any other → "single". The legacy key is
// deleted after migration so only the new key is written going forward.
function readViewModePref(): ViewMode {
  if (typeof window === "undefined") return "single";
  try {
    const stored = window.localStorage.getItem(VIEW_MODE_PREF_KEY);
    if (isViewMode(stored)) return stored;
    const legacy = window.localStorage.getItem(LEGACY_SPLIT_PREF_KEY);
    if (legacy !== null) {
      const migrated: ViewMode = legacy === "1" ? "split" : "single";
      window.localStorage.setItem(VIEW_MODE_PREF_KEY, migrated);
      window.localStorage.removeItem(LEGACY_SPLIT_PREF_KEY);
      return migrated;
    }
    return "single";
  } catch {
    return "single";
  }
}

function writeViewModePref(value: ViewMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VIEW_MODE_PREF_KEY, value);
  } catch {
    // Swallow quota / access errors; UI state is the source of truth.
  }
}

function getStageLabel(stage: PipelineStage): string {
  switch (stage) {
    case "resolving":
      return "Resolving design…";
    case "extracting":
      return "Extracting design…";
    case "transforming":
      return "Building IR…";
    case "mapping":
      return "Mapping components…";
    case "generating":
      return "Generating code…";
    default:
      return "Processing…";
  }
}

function PreviewIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="size-3.5"
    >
      <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9Zm1.5 0v1.25h9V3.5h-9Zm9 2.75h-9v6.25h9V6.25Z" />
    </svg>
  );
}

function ExternalLinkIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="size-3.5"
    >
      <path d="M9 2h4a1 1 0 0 1 1 1v4h-1.5V4.56L8.53 8.53l-1.06-1.06L11.44 3.5H9V2Z" />
      <path d="M4 4.5h3V6H4.5v7h7V9h1.5v4A1.5 1.5 0 0 1 11.5 14h-7A1.5 1.5 0 0 1 3 12.5v-7A1.5 1.5 0 0 1 4.5 4H4v.5Z" />
    </svg>
  );
}

function LoadingOverlay(): JSX.Element {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#111111]">
      <span className="text-sm text-white/55">Loading preview…</span>
    </div>
  );
}

// Pane label badge — absolute top-left, pointer-events-none so it doesn't
// interfere with iframe interaction.
function PaneLabel({ text }: { text: string }): JSX.Element {
  return (
    <span className="absolute left-2 top-2 z-10 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white/75 pointer-events-none">
      {text}
    </span>
  );
}

function PreviewSplitLayout({
  screenshot,
  previewUrl,
  stageLabel,
  iframeRef,
  onIframeLoad,
  showIframeLoading,
}: {
  screenshot: string | undefined;
  previewUrl: string;
  stageLabel: string | undefined;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  onIframeLoad: () => void;
  showIframeLoading: boolean;
}): JSX.Element {
  const [iframeScrollY, setIframeScrollY] = useState(0);

  // Same-origin scroll sync: parallax the screenshot upward as the live
  // preview scrolls, so the visible portion of each pane tracks. Falls back
  // silently on cross-origin iframes.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (iframe === null) {
      return;
    }
    setIframeScrollY(0);
    let win: Window;
    try {
      const winCandidate = iframe.contentWindow;
      if (winCandidate === null) {
        return;
      }
      win = winCandidate;
    } catch {
      return;
    }
    const handleScroll = (): void => {
      setIframeScrollY(win.scrollY);
    };
    win.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      win.removeEventListener("scroll", handleScroll);
    };
  }, [iframeRef, previewUrl]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-row">
      {/* Left pane — Figma source */}
      <div className="relative flex-1 min-w-0 border-r border-[#333333]">
        <PaneLabel text="Figma source" />
        {screenshot !== undefined && screenshot.length > 0 ? (
          <ScreenshotPreview
            screenshotUrl={screenshot}
            {...(stageLabel !== undefined ? { stageName: stageLabel } : {})}
            badgeText="Figma source"
            externalOffsetY={-iframeScrollY}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="text-sm text-white/55">
              Screenshot unavailable
            </span>
          </div>
        )}
      </div>

      {/* Right pane — Generated preview */}
      <div className="relative flex-1 min-w-0">
        <PaneLabel text="Generated preview" />
        {previewUrl.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <span className="text-sm text-white/55">
              {stageLabel ?? "Waiting for preview…"}
            </span>
          </div>
        ) : (
          <>
            <iframe
              ref={iframeRef}
              src={previewUrl}
              title="Live preview"
              className="h-full w-full border-0 bg-white"
              onLoad={onIframeLoad}
              sandbox="allow-scripts allow-same-origin"
            />
            {showIframeLoading ? <LoadingOverlay /> : null}
          </>
        )}
      </div>
    </div>
  );
}

function PreviewOverlayLayout({
  screenshot,
  previewUrl,
  opacity,
  iframeRef,
  onIframeLoad,
  showIframeLoading,
}: {
  screenshot: string;
  previewUrl: string;
  opacity: number;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  onIframeLoad: () => void;
  showIframeLoading: boolean;
}): JSX.Element {
  return (
    <div
      className="relative flex h-full min-h-0 flex-1"
      data-testid="preview-overlay-layout"
    >
      <PaneLabel text="Overlay" />
      {/* Figma screenshot layer (below). Plain <img> — the interactive
          ScreenshotPreview has its own pan/zoom which would desync coordinates
          with the iframe. */}
      <img
        src={screenshot}
        alt="Figma design preview"
        className="absolute inset-0 h-full w-full object-contain bg-white"
        draggable={false}
      />
      {/* Live preview layer (above) — opacity controlled by slider. */}
      <iframe
        ref={iframeRef}
        src={previewUrl}
        title="Live preview"
        className="absolute inset-0 h-full w-full border-0 bg-white"
        style={{ opacity: opacity / 100 }}
        onLoad={onIframeLoad}
        sandbox="allow-scripts allow-same-origin"
      />
      {showIframeLoading ? <LoadingOverlay /> : null}
    </div>
  );
}

function clampOpacity(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

export function PreviewPane({
  previewUrl,
  phase2PreviewUrl,
  inspectEnabled,
  activeScopeNodeId,
  onToggleInspect,
  onInspectSelect,
  pipelineStage,
  screenshot,
}: PreviewPaneProps): JSX.Element {
  const livePreviewUrl = previewUrl.trim();
  const splitPreviewUrl =
    pipelineStage === "generating" && phase2PreviewUrl !== undefined
      ? phase2PreviewUrl.trim()
      : livePreviewUrl;
  const hasLivePreviewUrl = livePreviewUrl.length > 0;
  const hasSplitPreviewUrl = splitPreviewUrl.length > 0;
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [iframeLoadVersion, setIframeLoadVersion] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>(readViewModePref);
  const [overlayOpacity, setOverlayOpacity] = useState<number>(
    DEFAULT_OVERLAY_OPACITY,
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Derive loading state from the active iframe URL.
  const isLoading = hasSplitPreviewUrl && loadedUrl !== splitPreviewUrl;

  const generatingStagesSet = new Set<PipelineStage>([
    "resolving",
    "extracting",
    "transforming",
    "mapping",
    "generating",
  ]);
  const isParsing = pipelineStage === "parsing";
  const isGenerating =
    pipelineStage !== undefined && generatingStagesSet.has(pipelineStage);
  const stageLabel =
    pipelineStage !== undefined && generatingStagesSet.has(pipelineStage)
      ? getStageLabel(pipelineStage)
      : undefined;

  const hasScreenshot = screenshot !== undefined && screenshot.length > 0;
  const canSplit =
    viewMode === "split" && (hasScreenshot || hasSplitPreviewUrl);
  // Non-null when overlay mode is engaged AND both layers are available;
  // narrowed to `string` so PreviewOverlayLayout receives a typed prop.
  // Uses hasSplitPreviewUrl (matches split-mode logic) so the overlay engages
  // during the generating phase using the phase-2 preview URL.
  const overlayScreenshot: string | null =
    viewMode === "overlay" &&
    hasSplitPreviewUrl &&
    screenshot !== undefined &&
    screenshot.length > 0
      ? screenshot
      : null;
  const overlayWaitingForLayers =
    viewMode === "overlay" && overlayScreenshot === null;

  const updateViewMode = useCallback((next: ViewMode): void => {
    setViewMode(next);
    writeViewModePref(next);
  }, []);

  const setOverlayOpacityValue = useCallback((value: number): void => {
    setOverlayOpacity(clampOpacity(value));
  }, []);

  function handleIframeLoad(): void {
    setLoadedUrl(splitPreviewUrl);
    setIframeLoadVersion((prev) => prev + 1);
  }

  // Overlay quick-set shortcuts: key "0" → 0%, "5" → 50%, "1" → 100%.
  // Only fires when viewMode is "overlay" and focus is on the PreviewPane
  // root (or a child like the slider). Does not hijack keys globally.
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (viewMode !== "overlay") return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target !== null) {
        const tag = target.tagName;
        if (tag === "INPUT" && target.getAttribute("type") !== "range") return;
        if (tag === "TEXTAREA") return;
        if (target.isContentEditable) return;
      }
      if (event.key === "0") {
        setOverlayOpacityValue(0);
        event.preventDefault();
      } else if (event.key === "5") {
        setOverlayOpacityValue(50);
        event.preventDefault();
      } else if (event.key === "1") {
        setOverlayOpacityValue(100);
        event.preventDefault();
      }
    },
    [setOverlayOpacityValue, viewMode],
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-[#000000] text-white outline-none"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      data-testid="preview-pane-root"
    >
      <div className="flex h-10 shrink-0 items-center border-b border-[#333333] bg-[#000000]">
        <div className="flex h-full min-w-0 items-center gap-2 border-t-2 border-[#4eba87] bg-[#333333] px-4 text-sm text-white">
          <PreviewIcon />
          <span className="truncate">Live preview</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 px-3 text-[11px] text-white/65">
          <button
            type="button"
            onClick={() => {
              updateViewMode(viewMode === "split" ? "single" : "split");
            }}
            aria-pressed={viewMode === "split"}
            aria-label={
              viewMode === "split" ? "Disable split view" : "Enable split view"
            }
            data-testid="preview-split-toggle"
            className={`cursor-pointer rounded border px-2 py-1 font-semibold transition ${
              viewMode === "split"
                ? "border-[#4eba87] bg-[#4eba87]/15 text-[#4eba87]"
                : "border-[#333333] bg-transparent text-white/70 hover:border-[#4eba87]/40 hover:text-[#4eba87]"
            }`}
          >
            Split
          </button>
          <button
            type="button"
            onClick={() => {
              updateViewMode(viewMode === "overlay" ? "single" : "overlay");
            }}
            aria-pressed={viewMode === "overlay"}
            aria-label={
              viewMode === "overlay"
                ? "Disable overlay view"
                : "Enable overlay view"
            }
            data-testid="preview-overlay-toggle"
            className={`cursor-pointer rounded border px-2 py-1 font-semibold transition ${
              viewMode === "overlay"
                ? "border-[#4eba87] bg-[#4eba87]/15 text-[#4eba87]"
                : "border-[#333333] bg-transparent text-white/70 hover:border-[#4eba87]/40 hover:text-[#4eba87]"
            }`}
          >
            Overlay
          </button>
          {overlayScreenshot !== null ? (
            <div
              className="flex items-center gap-2"
              data-testid="preview-overlay-controls"
            >
              <label
                htmlFor="preview-overlay-opacity"
                className="text-white/70"
              >
                Opacity {overlayOpacity}%
              </label>
              <input
                id="preview-overlay-opacity"
                type="range"
                min={0}
                max={100}
                step={1}
                value={overlayOpacity}
                onChange={(event) => {
                  setOverlayOpacityValue(Number(event.target.value));
                }}
                aria-label="Preview overlay opacity"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={overlayOpacity}
                aria-valuetext={`${String(overlayOpacity)}%`}
                data-testid="preview-overlay-opacity-slider"
                className="h-1 w-24 cursor-pointer accent-[#4eba87]"
              />
              <div
                className="flex items-center gap-1"
                data-testid="preview-overlay-quickset-controls"
              >
                {OVERLAY_QUICK_SET_VALUES.map((value) => {
                  const active = overlayOpacity === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setOverlayOpacityValue(value);
                      }}
                      aria-pressed={active}
                      aria-label={`Set overlay opacity to ${String(value)}%`}
                      data-testid={`preview-overlay-quickset-${String(value)}`}
                      className={`cursor-pointer rounded border px-1.5 py-1 font-semibold transition ${
                        active
                          ? "border-[#4eba87] bg-[#4eba87]/15 text-[#4eba87]"
                          : "border-[#333333] bg-transparent text-white/70 hover:border-[#4eba87]/40 hover:text-[#4eba87]"
                      }`}
                    >
                      {value}%
                    </button>
                  );
                })}
              </div>
              <span
                className="text-white/45"
                data-testid="preview-overlay-shortcut-hint"
              >
                Keys 0 / 5 / 1
              </span>
            </div>
          ) : null}
          <button
            type="button"
            onClick={onToggleInspect}
            aria-pressed={inspectEnabled}
            aria-label={
              inspectEnabled ? "Disable inspect mode" : "Enable inspect mode"
            }
            className={`cursor-pointer rounded border px-2 py-1 font-semibold transition ${
              inspectEnabled
                ? "border-[#4eba87] bg-[#4eba87]/15 text-[#4eba87]"
                : "border-[#333333] bg-transparent text-white/70 hover:border-[#4eba87]/40 hover:text-[#4eba87]"
            }`}
          >
            Inspect
          </button>
          {hasSplitPreviewUrl ? (
            <a
              href={splitPreviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open preview in new tab"
              className="inline-flex items-center gap-1.5 rounded border border-[#333333] px-2 py-1 text-white/70 no-underline transition hover:border-[#4eba87]/40 hover:text-[#4eba87]"
            >
              <ExternalLinkIcon />
              Open
            </a>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded border border-[#333333] px-2 py-1 text-white/40">
              <ExternalLinkIcon />
              Waiting
            </span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-[#000000] p-4 md:p-6">
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-[#333333] bg-[#111111] shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
          {overlayScreenshot !== null ? (
            <PreviewOverlayLayout
              screenshot={overlayScreenshot}
              previewUrl={splitPreviewUrl}
              opacity={overlayOpacity}
              iframeRef={iframeRef}
              onIframeLoad={handleIframeLoad}
              showIframeLoading={isLoading}
            />
          ) : overlayWaitingForLayers ? (
            <div className="flex h-full flex-1 items-center justify-center">
              <span className="text-sm text-white/55">
                Waiting for both layers…
              </span>
            </div>
          ) : canSplit ? (
            <PreviewSplitLayout
              screenshot={screenshot}
              previewUrl={splitPreviewUrl}
              stageLabel={stageLabel}
              iframeRef={iframeRef}
              onIframeLoad={handleIframeLoad}
              showIframeLoading={isLoading}
            />
          ) : isParsing ? (
            <div className="flex h-full flex-1 items-center justify-center">
              <span className="text-sm text-white/55">Analyzing design…</span>
            </div>
          ) : isGenerating ? (
            screenshot !== undefined && screenshot.length > 0 ? (
              <ScreenshotPreview
                screenshotUrl={screenshot}
                {...(stageLabel !== undefined ? { stageName: stageLabel } : {})}
              />
            ) : (
              <div className="flex h-full flex-1 items-center justify-center">
                <span className="text-sm text-white/55">
                  {stageLabel ?? "Processing…"}
                </span>
              </div>
            )
          ) : (
            <>
              {isLoading ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#111111]">
                  <span className="text-sm text-white/55">
                    Loading preview…
                  </span>
                </div>
              ) : null}
              {hasLivePreviewUrl ? (
                <iframe
                  ref={iframeRef}
                  src={livePreviewUrl}
                  title="Live preview"
                  className="h-full w-full flex-1 border-0 bg-white"
                  onLoad={handleIframeLoad}
                  sandbox="allow-scripts allow-same-origin"
                />
              ) : (
                <div className="flex h-full flex-1 items-center justify-center px-6 text-center text-sm text-white/55">
                  Preview will appear after the generation job produces a
                  runnable repro.
                </div>
              )}
            </>
          )}
          <InspectOverlay
            inspectEnabled={inspectEnabled}
            activeScopeNodeId={activeScopeNodeId}
            onToggleInspect={onToggleInspect}
            onSelectNode={onInspectSelect}
            iframeRef={iframeRef}
            iframeLoadVersion={iframeLoadVersion}
          />
        </div>
      </div>
    </div>
  );
}
