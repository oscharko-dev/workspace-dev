import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from "react";
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
  activeManifestRange?: ManifestRange | null;
  /** Whether the currently selected node has a manifest mapping. */
  isNodeMapped?: boolean;
  /** Manifest range for the previous job's version of this node (for diff mode). */
  previousManifestRange?: ManifestRange | null;
  /** Reason why node-scoped diff is unavailable (null when available). */
  nodeDiffFallbackReason?: string | null;
  /** Parent file path when viewing a cross-file extracted component. */
  parentFile?: string | null;
  /** Callback to return to the parent file context. */
  onReturnToParentFile?: () => void;
  /** Render the pane inside the dedicated dark IDE shell. */
  ideMode?: boolean;
}

const MIN_SPLIT_PANE_PCT = 25;
const NARROW_VIEWPORT_PX = 768;

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
  ideMode = false
}: CodePaneProps): JSX.Element {
  const [jsonVisible, setJsonVisible] = useState(false);
  const [diffEnabled, setDiffEnabled] = useState(false);
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitRatio, setSplitRatio] = useState(50); // percentage for left pane
  const [scopedMode, setScopedMode] = useState<ScopedCodeMode>(
    isNodeMapped ? defaultMappedMode() : fallbackMode()
  );

  // Reset scoped mode when mapping status changes
  useEffect(() => {
    setScopedMode(isNodeMapped ? defaultMappedMode() : fallbackMode());
  }, [isNodeMapped]);

  // Derive scoped code for the current file
  const scopedCode = useMemo(() => {
    if (fileContent === null) return null;
    return deriveScopedCode(fileContent, scopedMode, activeManifestRange ?? null);
  }, [fileContent, scopedMode, activeManifestRange]);

  // Derive scoped diff ranges (independent old/new offsets)
  const scopedDiffRanges = useMemo(() => {
    return deriveScopedDiffRanges(
      scopedMode,
      activeManifestRange ?? null,
      previousManifestRange ?? null
    );
  }, [scopedMode, activeManifestRange, previousManifestRange]);

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
      if (!state || !container) return;
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
    <div
      className="flex h-full min-h-0 flex-col"
      style={{
        backgroundColor: ideMode ? "#1e1e1e" : undefined,
        color: ideMode ? "#e4e4e7" : undefined
      }}
    >
      {/* File selector header */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-3 py-2"
        style={{
          borderColor: ideMode ? "#3f3f46" : undefined,
          backgroundColor: ideMode ? "#252526" : undefined
        }}
      >
        <select
          data-testid="inspector-file-selector"
          value={selectedFile ?? ""}
          disabled={isFileSelectorDisabled}
          onChange={(e) => {
            if (!e.target.value) return;
            onSelectFile(e.target.value);
          }}
          className="min-w-0 flex-1 truncate rounded border px-2 py-1 text-xs"
          style={{
            borderColor: ideMode ? "#52525b" : undefined,
            backgroundColor: ideMode ? "#1f1f21" : undefined,
            color: ideMode ? "#f4f4f5" : undefined
          }}
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
        {hasJsonFiles ? (
          <button
            type="button"
            data-testid="inspector-json-toggle"
            onClick={() => { setJsonVisible((v) => !v); }}
            className="shrink-0 cursor-pointer rounded border px-2 py-1 text-[10px] font-semibold transition"
            style={{
              borderColor: ideMode ? "#52525b" : undefined,
              backgroundColor: ideMode ? "#1f1f21" : undefined,
              color: ideMode ? "#d4d4d8" : undefined
            }}
          >
            {jsonVisible ? "Hide JSON" : "Show JSON"}
          </button>
        ) : null}
        {/* Split toggle */}
        <button
          type="button"
          data-testid="inspector-split-toggle"
          disabled={!canSplit || isDiffActive}
          title={isDiffActive ? "Disable diff to use split view" : !canSplit ? "Need at least 2 files" : undefined}
          onClick={() => { setSplitEnabled((v) => !v); }}
          className="shrink-0 cursor-pointer rounded border px-2 py-1 text-[10px] font-semibold transition disabled:cursor-default disabled:opacity-40"
          style={{
            borderColor: isSplitActive ? "#0891b2" : undefined,
            backgroundColor: isSplitActive ? "#ecfeff" : undefined,
            color: isSplitActive ? "#155e75" : undefined
          }}
        >
          {isSplitActive ? "Split: On" : "Split"}
        </button>
        {/* Diff toggle */}
        <button
          type="button"
          data-testid="inspector-diff-toggle"
          disabled={!canDiff && !diffEnabled}
          title={diffTooltip}
          onClick={() => { setDiffEnabled((v) => !v); }}
          className="shrink-0 cursor-pointer rounded border px-2 py-1 text-[10px] font-semibold transition disabled:cursor-default disabled:opacity-40"
          style={{
            borderColor: isDiffActive ? "#6366f1" : undefined,
            backgroundColor: isDiffActive ? "#eef2ff" : undefined,
            color: isDiffActive ? "#4338ca" : undefined
          }}
        >
          {isDiffActive ? "Diff: On" : "Diff"}
        </button>
      </div>

      {/* Status messages */}
      <div className="shrink-0 px-3 py-2">
        {filesState === "loading" ? (
          <p
            data-testid="inspector-state-files-loading"
            className="m-0 text-xs"
            style={{ color: ideMode ? "#a1a1aa" : undefined }}
          >
            Loading generated files…
          </p>
        ) : null}
        {filesState === "empty" ? (
          <p
            data-testid="inspector-state-files-empty"
            className="m-0 text-xs"
            style={{ color: ideMode ? "#facc15" : undefined }}
          >
            No generated source files are available for this job.
          </p>
        ) : null}
        {filesState === "error" && filesError ? (
          <div
            data-testid="inspector-state-files-error"
            className="flex flex-wrap items-center gap-2 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-900"
          >
            <span>
              {filesError.message} ({filesError.code}, HTTP {String(filesError.status)})
            </span>
            <button
              type="button"
              data-testid="inspector-retry-files"
              onClick={onRetryFiles}
              className="cursor-pointer rounded border border-rose-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-800 transition hover:bg-rose-100"
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

      {/* Scoped code mode selector — shown when a node is selected */}
      {selectedFile && fileContent !== null ? (
        <div
          className="shrink-0 border-b px-3 py-1.5"
          style={{
            borderColor: ideMode ? "#3f3f46" : undefined,
            backgroundColor: ideMode ? "#252526" : undefined
          }}
        >
          <ScopedCodeModeSelector
            activeMode={scopedMode}
            onModeChange={setScopedMode}
            isMapped={isNodeMapped}
            ideMode={ideMode}
          />
        </div>
      ) : null}

      {/* Code viewer / diff viewer / split view */}
      <div className="min-h-0 flex-1">
        {fileContentState === "loading" ? (
          <p data-testid="inspector-state-file-content-loading" className="m-0 p-3 text-xs text-slate-500">
            Loading file…
          </p>
        ) : fileContentState === "error" && fileContentError ? (
          <div
            data-testid="inspector-state-file-content-error"
            className="m-3 flex flex-wrap items-center gap-2 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-900"
          >
            <span>
              {fileContentError.message} ({fileContentError.code}, HTTP {String(fileContentError.status)})
            </span>
            <button
              type="button"
              data-testid="inspector-retry-file-content"
              onClick={onRetryFileContent}
              className="cursor-pointer rounded border border-rose-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-800 transition hover:bg-rose-100"
            >
              Retry
            </button>
          </div>
        ) : fileContent !== null && selectedFile ? (
          isDiffActive && typeof previousFileContent === "string" && typeof previousJobId === "string" ? (
            <DiffViewer
              oldCode={previousFileContent}
              newCode={scopedCode?.code ?? fileContent}
              filePath={selectedFile}
              forceDarkTheme={ideMode}
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
                style={{ flexBasis: `${String(splitRatio.toFixed(2))}%`, flexGrow: 0, flexShrink: 0 }}
              >
                <CodeViewer
                  code={scopedCode?.code ?? fileContent}
                  filePath={selectedFile}
                  forceDarkTheme={ideMode}
                  highlightRange={scopedCode?.highlightRange ?? highlightRange}
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
                className="w-1 shrink-0 cursor-col-resize transition-colors hover:bg-slate-400 focus:bg-slate-400 focus:outline-none"
                style={{
                  backgroundColor: ideMode ? "#3f3f46" : undefined,
                  touchAction: "none"
                }}
                onPointerDown={handleSplitPointerDown}
              />

              {/* Right pane */}
              <div
                data-testid="inspector-split-right"
                className="flex min-w-0 flex-1 flex-col overflow-hidden"
              >
                {/* Right pane file selector */}
                <div
                  className="flex shrink-0 items-center gap-2 border-b px-2 py-1"
                  style={{
                    borderColor: ideMode ? "#3f3f46" : undefined,
                    backgroundColor: ideMode ? "#252526" : undefined
                  }}
                >
                  <select
                    data-testid="inspector-split-file-selector"
                    value={splitFile ?? ""}
                    onChange={(e) => {
                      if (!e.target.value || !onSelectSplitFile) return;
                      onSelectSplitFile(e.target.value);
                    }}
                    className="min-w-0 flex-1 truncate rounded border px-2 py-0.5 text-xs"
                    style={{
                      borderColor: ideMode ? "#52525b" : undefined,
                      backgroundColor: ideMode ? "#1f1f21" : undefined,
                      color: ideMode ? "#f4f4f5" : undefined
                    }}
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
                    <p data-testid="inspector-split-loading" className="m-0 p-3 text-xs text-slate-500">
                      Loading file…
                    </p>
                  ) : typeof splitFileContent === "string" && typeof splitFile === "string" ? (
                    <CodeViewer
                      code={splitFileContent}
                      filePath={splitFile}
                      forceDarkTheme={ideMode}
                      boundariesEnabled={boundariesEnabled}
                      onBoundariesEnabledChange={onBoundariesEnabledChange}
                      boundaries={splitFileBoundaries}
                      onBoundarySelect={onBoundarySelect}
                    />
                  ) : (
                    <p data-testid="inspector-split-empty" className="m-0 p-3 text-xs text-slate-500">
                      Select a file for the right pane.
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <CodeViewer
              code={scopedCode?.code ?? fileContent}
              filePath={selectedFile}
              forceDarkTheme={ideMode}
              highlightRange={scopedCode?.highlightRange ?? highlightRange}
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
            style={{ color: ideMode ? "#d4d4d8" : undefined }}
          >
            <p className="m-0 text-xs font-semibold" style={{ color: ideMode ? "#facc15" : undefined }}>
              This component has no file mapping
            </p>
            <p className="m-0 text-[11px]" style={{ color: ideMode ? "#a1a1aa" : undefined }}>
              The selected node is not mapped to a specific location in the generated source. The current file is displayed as context.
            </p>
            {parentFile && onReturnToParentFile ? (
              <button
                type="button"
                data-testid="inspector-unmapped-return-parent"
                onClick={onReturnToParentFile}
                className="mt-1 cursor-pointer rounded border px-3 py-1 text-[11px] font-semibold transition hover:bg-sky-100"
                style={{
                  borderColor: ideMode ? "#0f766e" : undefined,
                  backgroundColor: ideMode ? "rgba(13, 148, 136, 0.16)" : undefined,
                  color: ideMode ? "#99f6e4" : undefined
                }}
              >
                ← Return to {parentFile.split("/").pop() ?? parentFile}
              </button>
            ) : null}
          </div>
        ) : filesState === "empty" ? (
          <p
            data-testid="inspector-state-file-content-empty"
            className="m-0 p-3 text-xs"
            style={{ color: ideMode ? "#a1a1aa" : undefined }}
          >
            No source file content is available yet.
          </p>
        ) : (
          <p
            data-testid="inspector-state-file-content-empty"
            className="m-0 p-3 text-xs"
            style={{ color: ideMode ? "#a1a1aa" : undefined }}
          >
            Select a file to view its source.
          </p>
        )}
      </div>
    </div>
  );
}
