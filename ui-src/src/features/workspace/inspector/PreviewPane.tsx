import { useEffect, useRef, useState, type JSX, type RefObject } from "react";
import { InspectOverlay } from "./InspectOverlay";
import { ScreenshotPreview } from "./ScreenshotPreview";
import type { PipelineStage } from "./paste-pipeline";

interface PreviewPaneProps {
  previewUrl: string;
  inspectEnabled: boolean;
  activeScopeNodeId: string | null;
  onToggleInspect: () => void;
  onInspectSelect: (irNodeId: string) => void;
  pipelineStage?: PipelineStage;
  screenshot?: string;
}

const SPLIT_PREF_KEY = "workspace-dev:inspector:preview-split";

function readSplitPref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SPLIT_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSplitPref(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SPLIT_PREF_KEY, value ? "1" : "0");
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
      const doc = iframe.contentWindow?.document.documentElement;
      if (doc === undefined || doc === null) {
        return;
      }
      if (iframe.contentWindow === null) {
        return;
      }
      win = iframe.contentWindow;
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

export function PreviewPane({
  previewUrl,
  inspectEnabled,
  activeScopeNodeId,
  onToggleInspect,
  onInspectSelect,
  pipelineStage,
  screenshot,
}: PreviewPaneProps): JSX.Element {
  const hasPreviewUrl = previewUrl.trim().length > 0;
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [iframeLoadVersion, setIframeLoadVersion] = useState(0);
  const [splitView, setSplitView] = useState<boolean>(readSplitPref);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Derive loading state: loading whenever the current previewUrl hasn't finished loading yet
  const isLoading = hasPreviewUrl && loadedUrl !== previewUrl;

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
  // Computed separately so TypeScript sees the pipelineStage !== undefined guard
  // and narrows the type without a cast.
  const stageLabel =
    pipelineStage !== undefined && generatingStagesSet.has(pipelineStage)
      ? getStageLabel(pipelineStage)
      : undefined;

  const hasScreenshot = screenshot !== undefined && screenshot.length > 0;
  const canSplit = splitView && (hasScreenshot || hasPreviewUrl);

  function handleIframeLoad(): void {
    setLoadedUrl(previewUrl);
    setIframeLoadVersion((prev) => prev + 1);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#000000] text-white">
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
              setSplitView((prev) => {
                const next = !prev;
                writeSplitPref(next);
                return next;
              });
            }}
            aria-pressed={splitView}
            aria-label={splitView ? "Disable split view" : "Enable split view"}
            data-testid="preview-split-toggle"
            className={`cursor-pointer rounded border px-2 py-1 font-semibold transition ${
              splitView
                ? "border-[#4eba87] bg-[#4eba87]/15 text-[#4eba87]"
                : "border-[#333333] bg-transparent text-white/70 hover:border-[#4eba87]/40 hover:text-[#4eba87]"
            }`}
          >
            Split
          </button>
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
          {hasPreviewUrl ? (
            <a
              href={previewUrl}
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
          {canSplit ? (
            <PreviewSplitLayout
              screenshot={screenshot}
              previewUrl={previewUrl}
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
              {hasPreviewUrl ? (
                <iframe
                  ref={iframeRef}
                  src={previewUrl}
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
