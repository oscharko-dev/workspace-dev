import { useCallback, useMemo, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from "react";
import { CodeViewer, type HighlightRange } from "./CodeViewer";
import { DiffViewer } from "./DiffViewer";
import { Breadcrumb } from "./Breadcrumb";
import { ScopedCodeModeSelector } from "./ScopedCodeModeSelector";
import type { BreadcrumbSegment } from "./component-tree-utils";
import type { CodeBoundaryEntry } from "./code-boundaries";
import {
  defaultMappedMode,
  deriveScopedCode,
  deriveScopedDiffRanges,
  fallbackMode,
  type ManifestRange,
  type ScopedCodeMode
} from "./scoped-code-ranges";

export type { HighlightRange } from "./CodeViewer";

type InspectorSourceStatus = "loading" | "ready" | "empty" | "error";

interface EndpointErrorDetails {
  status: number;
  code: string;
  message: string;
}

type FileScopedManifestRange = ManifestRange & {
  file?: string | null;
};

interface CodePaneProps {
  files: Array<{ path: string; sizeBytes: number }>;
  filesState: InspectorSourceStatus;
  filesError: EndpointErrorDetails | null;
  onRetryFiles: () => void;
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
  fileContent: string | null;
  fileContentState: InspectorSourceStatus;
  fileContentError: EndpointErrorDetails | null;
  onRetryFileContent: () => void;
  highlightRange?: HighlightRange | null;
  previousJobId?: string | null;
  previousFileContent?: string | null;
  previousFileContentLoading?: boolean;
  breadcrumbPath?: BreadcrumbSegment[];
  onBreadcrumbSelect?: (nodeId: string) => void;
  /** Whether a hierarchical drilldown scope is currently active. */
  hasActiveScope?: boolean;
  /** Callback to enter scope on a breadcrumb node. */
  onEnterScope?: (nodeId: string) => void;
  /** Callback to exit the current scope level. */
  onExitScope?: () => void;
  /** Split view: suggested/selected second file path. */
  splitFile?: string | null;
  /** Split view: content of the second file. */
  splitFileContent?: string | null;
  /** Split view: loading state for second file. */
  splitFileContentLoading?: boolean;
  /** Split view: callback to change second file selection. */
  onSelectSplitFile?: (filePath: string) => void;
  boundariesEnabled?: boolean;
  onBoundariesEnabledChange?: (enabled: boolean) => void;
  fileBoundaries?: CodeBoundaryEntry[];
  splitFileBoundaries?: CodeBoundaryEntry[];
  onBoundarySelect?: (nodeId: string) => void;
  /** Manifest range for the currently selected node (null if unmapped). */
  activeManifestRange?: FileScopedManifestRange | null;
  /** Whether the currently selected node has a manifest mapping. */
  isNodeMapped?: boolean;
  /** Manifest range for the previous job's version of this node (for diff mode). */
  previousManifestRange?: FileScopedManifestRange | null;
  /** Reason why node-scoped diff is unavailable (null when available). */
  nodeDiffFallbackReason?: string | null;
  /** Parent file path when viewing a cross-file extracted component. */
  parentFile?: string | null;
  /** Callback to return to the parent file context. */
  onReturnToParentFile?: () => void;
  /** Currently selected IR node id for viewer-local remapping. */
  selectedIrNodeId?: string | null;
}

const MIN_SPLIT_PANE_PCT = 25;
const NARROW_VIEWPORT_PX = 768;

function activeFileLabel(filePath: string | null): string {
  if (!filePath) {
    return "Source";
  }
  const segments = filePath.split("/");
  return segments[segments.length - 1] ?? filePath;
}

function CodeFileIcon(): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
      <path d="M3.5 2A1.5 1.5 0 0 0 2 3.5v9A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5V6.414a1.5 1.5 0 0 0-.44-1.06l-2.914-2.915A1.5 1.5 0 0 0 9.586 2H3.5Zm6 1.25v2a.75.75 0 0 0 .75.75h2V12.5a.25.25 0 0 1-.25.25h-8.5a.25.25 0 0 1-.25-.25v-9a.25.25 0 0 1 .25-.25h6Z" />
    </svg>
  );
}

function SplitViewIcon(): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
      <path d="M2.5 2A1.5 1.5 0 0 0 1 3.5v9A1.5 1.5 0 0 0 2.5 14h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 13.5 2h-11Zm0 1.5h4.75v9H2.5v-9Zm6.25 0h4.75v9H8.75v-9Z" />
    </svg>
  );
}

function DiffIcon(): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
      <path d="M6.5 3a.75.75 0 0 1 .75.75V5h2.5a.75.75 0 0 1 0 1.5h-2.5v1.25a.75.75 0 0 1-1.5 0V6.5h-1.25a.75.75 0 0 1 0-1.5h1.25V3.75A.75.75 0 0 1 6.5 3Zm4 5a.75.75 0 0 1 .75.75V10h1.25a.75.75 0 0 1 0 1.5h-1.25v1.25a.75.75 0 0 1-1.5 0V11.5H8.5a.75.75 0 0 1 0-1.5h1.25V8.75A.75.75 0 0 1 10.5 8Z" />
    </svg>
  );
}

function JsonIcon(): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
      <path d="M5.25 3a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 0-.75.75v1.5c0 .56-.24 1.06-.62 1.41.38.35.62.85.62 1.41v1.5c0 .41.34.75.75.75h.5a.75.75 0 0 1 0 1.5h-.5A2.25 2.25 0 0 1 2.5 12.75v-1.5c0-.41-.34-.75-.75-.75a.75.75 0 0 1 0-1.5c.41 0 .75-.34.75-.75v-1.5A2.25 2.25 0 0 1 4.75 3h.5Zm5.5 0a2.25 2.25 0 0 1 2.25 2.25v1.5c0 .41.34.75.75.75a.75.75 0 0 1 0 1.5c-.41 0-.75.34-.75.75v1.5A2.25 2.25 0 0 1 10.75 15h-.5a.75.75 0 0 1 0-1.5h.5c.41 0 .75-.34.75-.75v-1.5c0-.56.24-1.06.62-1.41a2.1 2.1 0 0 1-.62-1.41v-1.5a.75.75 0 0 0-.75-.75h-.5a.75.75 0 0 1 0-1.5h.5Z" />
    </svg>
  );
}

export function CodePane({
  files,
  filesState,
  filesError,
  onRetryFiles,
  selectedFile,
  onSelectFile,
  fileContent,
  fileContentState,
  fileContentError,
  onRetryFileContent,
  highlightRange,
  previousJobId,
  previousFileContent,
  previousFileContentLoading,
  breadcrumbPath,
  onBreadcrumbSelect,
  hasActiveScope,
  onEnterScope,
  onExitScope,
  splitFile,
  splitFileContent,
  splitFileContentLoading,
  onSelectSplitFile,
  boundariesEnabled,
  onBoundariesEnabledChange,
  fileBoundaries = [],
  splitFileBoundaries = [],
  onBoundarySelect,
  activeManifestRange,
  isNodeMapped = false,
  previousManifestRange,
  nodeDiffFallbackReason,
  parentFile,
  onReturnToParentFile,
  selectedIrNodeId = null
}: CodePaneProps): JSX.Element {
  const [jsonVisible, setJsonVisible] = useState(false);
  const [diffEnabled, setDiffEnabled] = useState(false);
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitRatio, setSplitRatio] = useState(50); // percentage for left pane
  const [scopedModes, setScopedModes] = useState(() => ({
    mapped: defaultMappedMode(),
    unmapped: fallbackMode()
  }));
  const scopedMode = isNodeMapped ? scopedModes.mapped : scopedModes.unmapped;
  const handleScopedModeChange = useCallback((nextMode: ScopedCodeMode) => {
    setScopedModes((currentModes) => {
      return isNodeMapped
        ? { ...currentModes, mapped: nextMode }
        : { ...currentModes, unmapped: nextMode };
    });
  }, [isNodeMapped]);

  const effectiveActiveManifestRange = useMemo<ManifestRange | null>(() => {
    if (!activeManifestRange || !selectedFile) {
      return null;
    }

    if (activeManifestRange.file && activeManifestRange.file !== selectedFile) {
      return null;
    }

    return {
      startLine: activeManifestRange.startLine,
      endLine: activeManifestRange.endLine
    };
  }, [activeManifestRange, selectedFile]);

  // Derive scoped code for the current file
  const scopedCode = useMemo(() => {
    if (fileContent === null) return null;
    return deriveScopedCode(fileContent, scopedMode, effectiveActiveManifestRange);
  }, [effectiveActiveManifestRange, fileContent, scopedMode]);

  // Derive scoped diff ranges (independent old/new offsets)
  const scopedDiffRanges = useMemo(() => {
    return deriveScopedDiffRanges(
      scopedMode,
      effectiveActiveManifestRange,
      previousManifestRange ?? null
    );
  }, [scopedMode, effectiveActiveManifestRange, previousManifestRange]);

  const splitContainerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ startX: number; startRatio: number } | null>(null);

  const codeFiles = files.filter(
    (f) => f.path.endsWith(".tsx") || f.path.endsWith(".ts") || (jsonVisible && f.path.endsWith(".json"))
  );

  const jsonFiles = files.filter((f) => f.path.endsWith(".json"));
  const hasJsonFiles = jsonFiles.length > 0;
  const hasCodeFiles = codeFiles.length > 0;
  const isFileSelectorDisabled = filesState === "loading" || filesState === "error" || !hasCodeFiles;

  const canDiff = Boolean(previousJobId) && fileContent !== null && previousFileContent !== null && !previousFileContentLoading;
  const isDiffActive = diffEnabled && canDiff;

  // Split requires at least 2 files and wide enough viewport
  const isNarrow = typeof window !== "undefined" && window.innerWidth < NARROW_VIEWPORT_PX;
  const canSplit = codeFiles.length >= 2 && !isNarrow;
  const isSplitActive = splitEnabled && canSplit && !isDiffActive;

  const diffTooltip = !previousJobId
    ? "No previous job available for comparison"
    : previousFileContentLoading
      ? "Loading previous file…"
      : previousFileContent === null
        ? "Previous file not available"
        : undefined;

  // --- Split resizer handlers ---

  const handleSplitPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;

    dragStartRef.current = { startX: event.clientX, startRatio: splitRatio };

    const onPointerMove = (moveEvent: PointerEvent): void => {
      const state = dragStartRef.current;
      if (!state) return;
      const containerWidth = container.getBoundingClientRect().width;
      if (containerWidth <= 0) return;
      const deltaPx = moveEvent.clientX - state.startX;
      const deltaPct = (deltaPx / containerWidth) * 100;
      const next = Math.max(MIN_SPLIT_PANE_PCT, Math.min(100 - MIN_SPLIT_PANE_PCT, state.startRatio + deltaPct));
      setSplitRatio(next);
    };

    const onPointerUp = (): void => {
      dragStartRef.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }, [splitRatio]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#333333] text-white">
      <div className="flex shrink-0 items-center border-b border-[#000000] bg-[#000000]">
        <div className="flex h-10 min-w-0 items-center gap-2 border-t-2 border-[#4eba87] bg-[#333333] px-4 text-sm text-white">
          <CodeFileIcon />
          <span className="truncate">{activeFileLabel(selectedFile)}</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 px-3 text-[11px] font-semibold text-white/70">
          {hasJsonFiles ? (
            <button
              type="button"
              data-testid="inspector-json-toggle"
              onClick={() => { setJsonVisible((v) => !v); }}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 transition ${
                jsonVisible
                  ? "border-[#4eba87] bg-[#4eba87]/15 text-[#4eba87]"
                  : "border-[#333333] bg-transparent text-white/70 hover:border-[#4eba87]/40 hover:text-[#4eba87]"
              }`}
            >
              <JsonIcon />
              {jsonVisible ? "JSON: On" : "JSON"}
            </button>
          ) : null}
          <button
            type="button"
            data-testid="inspector-split-toggle"
            disabled={!canSplit || isDiffActive}
            title={isDiffActive ? "Disable diff to use split view" : !canSplit ? "Need at least 2 files" : undefined}
            onClick={() => { setSplitEnabled((v) => !v); }}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 transition disabled:cursor-default disabled:opacity-40"
            style={{
              borderColor: isSplitActive ? "#4eba87" : "#333333",
              backgroundColor: isSplitActive ? "rgba(78, 186, 135, 0.15)" : "transparent",
              color: isSplitActive ? "#4eba87" : "rgba(255,255,255,0.7)"
            }}
          >
            <SplitViewIcon />
            {isSplitActive ? "Split: On" : "Split"}
          </button>
          <button
            type="button"
            data-testid="inspector-diff-toggle"
            disabled={!canDiff && !diffEnabled}
            title={diffTooltip}
            onClick={() => { setDiffEnabled((v) => !v); }}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 transition disabled:cursor-default disabled:opacity-40"
            style={{
              borderColor: isDiffActive ? "#4eba87" : "#333333",
              backgroundColor: isDiffActive ? "rgba(78, 186, 135, 0.15)" : "transparent",
              color: isDiffActive ? "#4eba87" : "rgba(255,255,255,0.7)"
            }}
          >
            <DiffIcon />
            {isDiffActive ? "Diff: On" : "Diff"}
          </button>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#000000] bg-[#2a2a2a] px-3 py-2">
        <select
          data-testid="inspector-file-selector"
          value={selectedFile ?? ""}
          disabled={isFileSelectorDisabled}
          onChange={(e) => {
            if (!e.target.value) return;
            onSelectFile(e.target.value);
          }}
          className="min-w-0 flex-1 truncate rounded border border-[#000000] bg-[#1b1b1b] px-3 py-1.5 text-xs text-white"
        >
          {hasCodeFiles ? (
            codeFiles.map((f) => (
              <option key={f.path} value={f.path}>
                {f.path}
              </option>
            ))
          ) : (
            <option value="">No source files available</option>
          )}
        </select>
          {selectedFile && fileContent !== null ? (
            <ScopedCodeModeSelector
              activeMode={scopedMode}
              onModeChange={handleScopedModeChange}
              isMapped={isNodeMapped}
            />
          ) : null}
      </div>

      {/* Status messages */}
      <div className="shrink-0 border-b border-[#000000] bg-[#262626] px-3 py-2">
        {filesState === "loading" ? (
          <p data-testid="inspector-state-files-loading" className="m-0 text-xs text-white/55">
            Loading generated files…
          </p>
        ) : null}
        {filesState === "empty" ? (
          <p data-testid="inspector-state-files-empty" className="m-0 text-xs text-amber-300">
            No generated source files are available for this job.
          </p>
        ) : null}
        {filesState === "error" && filesError ? (
          <div
            data-testid="inspector-state-files-error"
            className="flex flex-wrap items-center gap-2 rounded border border-rose-500/30 bg-rose-950/30 px-2 py-1.5 text-xs text-rose-200"
          >
            <span>
              {filesError.message} ({filesError.code}, HTTP {String(filesError.status)})
            </span>
            <button
              type="button"
              data-testid="inspector-retry-files"
              onClick={onRetryFiles}
              className="cursor-pointer rounded border border-rose-400/40 bg-transparent px-2 py-0.5 text-[11px] font-semibold text-rose-200 transition hover:bg-rose-500/10"
            >
              Retry
            </button>
          </div>
        ) : null}
      </div>

      {/* Breadcrumb navigation */}
      {breadcrumbPath && breadcrumbPath.length > 0 && onBreadcrumbSelect ? (
        <Breadcrumb
          path={breadcrumbPath}
          onSelect={onBreadcrumbSelect}
          hasActiveScope={hasActiveScope}
          onEnterScope={onEnterScope}
          onExitScope={onExitScope}
          parentFile={parentFile}
          onReturnToParentFile={onReturnToParentFile}
        />
      ) : null}

      {/* Code viewer / diff viewer / split view */}
      <div className="min-h-0 flex-1 bg-[#333333]">
        {fileContentState === "loading" ? (
          <p data-testid="inspector-state-file-content-loading" className="m-0 p-3 text-xs text-white/55">
            Loading file…
          </p>
        ) : fileContentState === "error" && fileContentError ? (
          <div
            data-testid="inspector-state-file-content-error"
            className="m-3 flex flex-wrap items-center gap-2 rounded border border-rose-500/30 bg-rose-950/30 px-2 py-1.5 text-xs text-rose-200"
          >
            <span>
              {fileContentError.message} ({fileContentError.code}, HTTP {String(fileContentError.status)})
            </span>
            <button
              type="button"
              data-testid="inspector-retry-file-content"
              onClick={onRetryFileContent}
              className="cursor-pointer rounded border border-rose-400/40 bg-transparent px-2 py-0.5 text-[11px] font-semibold text-rose-200 transition hover:bg-rose-500/10"
            >
              Retry
            </button>
          </div>
        ) : fileContent !== null && selectedFile ? (
          isDiffActive && typeof previousFileContent === "string" && typeof previousJobId === "string" ? (
            <DiffViewer
              themeMode="dark"
              oldCode={previousFileContent}
              newCode={scopedCode?.code ?? fileContent}
              filePath={selectedFile}
              previousJobId={previousJobId}
              oldFocusRange={scopedDiffRanges.oldFocusRange}
              newFocusRange={scopedDiffRanges.newFocusRange}
              scopedMode={scopedMode}
              isNodeScoped={!nodeDiffFallbackReason && isNodeMapped}
              nodeDiffFallbackReason={nodeDiffFallbackReason}
            />
          ) : isSplitActive ? (
            <div
              ref={splitContainerRef}
              data-testid="inspector-split-view"
              className="flex h-full min-h-0"
            >
              {/* Left pane */}
              <div
                data-testid="inspector-split-left"
                className="min-w-0 overflow-hidden"
                style={{ flexBasis: `${splitRatio.toFixed(2)}%`, flexGrow: 0, flexShrink: 0 }}
              >
                <CodeViewer
                  themeMode="dark"
                  code={scopedCode?.code ?? fileContent}
                  filePath={selectedFile}
                  highlightRange={scopedCode?.highlightRange ?? highlightRange}
                  selectedIrNodeId={selectedIrNodeId}
                  boundariesEnabled={boundariesEnabled}
                  onBoundariesEnabledChange={onBoundariesEnabledChange}
                  boundaries={fileBoundaries}
                  onBoundarySelect={onBoundarySelect}
                  lineOffset={scopedCode?.lineOffset}
                />
              </div>

              {/* Resizable divider */}
              <div
                role="separator"
                tabIndex={0}
                aria-label="Resize split panes"
                aria-orientation="vertical"
                data-testid="inspector-split-divider"
                className="w-1 shrink-0 cursor-col-resize bg-[#000000] transition-colors hover:bg-[#4eba87] focus:bg-[#4eba87] focus:outline-none"
                style={{ touchAction: "none" }}
                onPointerDown={handleSplitPointerDown}
              />

              {/* Right pane */}
              <div
                data-testid="inspector-split-right"
                className="flex min-w-0 flex-1 flex-col overflow-hidden"
              >
                {/* Right pane file selector */}
                <div className="flex shrink-0 items-center gap-2 border-b border-[#000000] bg-[#1f1f1f] px-2 py-1.5">
                  <select
                    data-testid="inspector-split-file-selector"
                    value={splitFile ?? ""}
                    onChange={(e) => {
                      if (!e.target.value || !onSelectSplitFile) return;
                      onSelectSplitFile(e.target.value);
                    }}
                    className="min-w-0 flex-1 truncate rounded border border-[#000000] bg-[#111111] px-2 py-1 text-xs text-white"
                  >
                    {codeFiles.map((f) => (
                      <option key={f.path} value={f.path}>
                        {f.path}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Right pane content */}
                <div className="min-h-0 flex-1">
                  {splitFileContentLoading ? (
                    <p data-testid="inspector-split-loading" className="m-0 p-3 text-xs text-white/55">
                      Loading file…
                    </p>
                  ) : typeof splitFileContent === "string" && typeof splitFile === "string" ? (
                    <CodeViewer
                      themeMode="dark"
                      code={splitFileContent}
                      filePath={splitFile}
                      selectedIrNodeId={splitFile === selectedFile ? selectedIrNodeId : null}
                      boundariesEnabled={boundariesEnabled}
                      onBoundariesEnabledChange={onBoundariesEnabledChange}
                      boundaries={splitFileBoundaries}
                      onBoundarySelect={onBoundarySelect}
                    />
                  ) : (
                    <p data-testid="inspector-split-empty" className="m-0 p-3 text-xs text-white/55">
                      Select a file for the right pane.
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <CodeViewer
              themeMode="dark"
              code={scopedCode?.code ?? fileContent}
              filePath={selectedFile}
              highlightRange={scopedCode?.highlightRange ?? highlightRange}
              selectedIrNodeId={selectedIrNodeId}
              boundariesEnabled={boundariesEnabled}
              onBoundariesEnabledChange={onBoundariesEnabledChange}
              boundaries={fileBoundaries}
              onBoundarySelect={onBoundarySelect}
              lineOffset={scopedCode?.lineOffset}
            />
          )
        ) : !isNodeMapped && selectedFile ? (
          <div
            data-testid="inspector-unmapped-fallback"
            className="flex flex-col items-center justify-center gap-2 p-6 text-center"
          >
            <p className="m-0 text-xs font-semibold text-amber-300">
              This component has no file mapping
            </p>
            <p className="m-0 text-[11px] text-white/55">
              The selected node is not mapped to a specific location in the generated source. The current file is displayed as context.
            </p>
            {parentFile && onReturnToParentFile ? (
              <button
                type="button"
                data-testid="inspector-unmapped-return-parent"
                onClick={onReturnToParentFile}
                className="mt-1 cursor-pointer rounded border border-[#4eba87]/40 bg-[#4eba87]/10 px-3 py-1 text-[11px] font-semibold text-[#4eba87] transition hover:bg-[#4eba87]/15"
              >
                ← Return to {parentFile.split("/").pop() ?? parentFile}
              </button>
            ) : null}
          </div>
        ) : filesState === "empty" ? (
          <p data-testid="inspector-state-file-content-empty" className="m-0 p-3 text-xs text-white/55">
            No source file content is available yet.
          </p>
        ) : (
          <p data-testid="inspector-state-file-content-empty" className="m-0 p-3 text-xs text-white/55">
            Select a file to view its source.
          </p>
        )}
      </div>
    </div>
  );
}
