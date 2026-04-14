import { useMemo, useRef, useState, type JSX } from "react";
import { InspectOverlay } from "./InspectOverlay";
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function buildPhase2Srcdoc(
  screenshotUrl: string | undefined,
  stageLabel: string,
): string {
  const imgHtml =
    screenshotUrl !== undefined
      ? `<img src="${escapeHtml(screenshotUrl)}" alt="Design preview" style="max-width:100%;max-height:100%;object-fit:contain;display:block;">`
      : "";
  const stageHtml =
    stageLabel.length > 0
      ? `<div class="stage">${escapeHtml(stageLabel)}</div>`
      : "";
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    "<style>",
    "*{margin:0;padding:0;box-sizing:border-box}",
    "body{background:#0d0d0d;display:flex;align-items:center;justify-content:center;height:100vh;overflow:hidden}",
    "img{max-width:100%;max-height:100%;object-fit:contain;display:block}",
    ".badge{position:fixed;bottom:12px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#4eba87;border:1px solid rgba(78,186,135,.4);border-radius:9999px;padding:4px 12px;font-size:12px;font-weight:500;white-space:nowrap}",
    ".stage{position:fixed;bottom:40px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.7);color:rgba(255,255,255,.6);border-radius:4px;padding:2px 8px;font-size:10px;white-space:nowrap}",
    "</style>",
    "</head>",
    "<body>",
    imgHtml,
    '<div class="badge">Figma preview</div>',
    stageHtml,
    "</body>",
    "</html>",
  ].join("");
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

  const generatingStagesSet = new Set<PipelineStage>([
    "resolving",
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

  const phase2Srcdoc = useMemo(
    () => (isGenerating ? buildPhase2Srcdoc(screenshot, stageLabel ?? "") : ""),
    [isGenerating, screenshot, stageLabel],
  );

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
          {isParsing ? (
            <div className="flex h-full flex-1 items-center justify-center">
              <span className="text-sm text-white/55">Analyzing design…</span>
            </div>
          ) : isGenerating ? (
            <iframe
              title="Phase 2 preview"
              srcDoc={phase2Srcdoc}
              sandbox="allow-scripts"
              className="h-full w-full flex-1 border-0 bg-[#0d0d0d]"
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
