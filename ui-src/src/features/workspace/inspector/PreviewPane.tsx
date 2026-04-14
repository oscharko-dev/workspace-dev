import { useRef, useState, type JSX } from "react";
import { InspectOverlay } from "./InspectOverlay";
import type { PipelineStage } from "./paste-pipeline";
import { ScreenshotPreview } from "./ScreenshotPreview";

interface PreviewPaneProps {
  previewUrl: string;
  inspectEnabled: boolean;
  activeScopeNodeId: string | null;
  onToggleInspect: () => void;
  onInspectSelect: (irNodeId: string) => void;
  pipelineStage?: PipelineStage;
  screenshot?: string;
}

function getStageLabel(stage: PipelineStage): string {
  switch (stage) {
    case "resolving":
      return "Resolving design…";
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
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Derive loading state: loading whenever the current previewUrl hasn't finished loading yet
  const isLoading = hasPreviewUrl && loadedUrl !== previewUrl;

  const generatingStages: readonly PipelineStage[] = [
    "resolving",
    "transforming",
    "mapping",
    "generating",
  ];
  const isParsing = pipelineStage === "parsing";
  const isGenerating =
    pipelineStage !== undefined &&
    (generatingStages as readonly string[]).includes(pipelineStage);
  const showScreenshot = isGenerating && screenshot !== undefined;
  const showGeneratingSpinner = isGenerating && screenshot === undefined;
  const stageLabel = isGenerating
    ? getStageLabel(pipelineStage as PipelineStage)
    : undefined;

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
          {isParsing || showGeneratingSpinner ? (
            <div className="flex h-full flex-1 items-center justify-center">
              <span className="text-sm text-white/55">
                {isParsing ? "Analyzing design…" : "Generating code…"}
              </span>
            </div>
          ) : showScreenshot ? (
            <ScreenshotPreview
              screenshotUrl={screenshot!}
              badgeText="Figma preview"
              {...(stageLabel !== undefined ? { stageName: stageLabel } : {})}
            />
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
                  onLoad={() => {
                    setLoadedUrl(previewUrl);
                    setIframeLoadVersion((prev) => prev + 1);
                  }}
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
