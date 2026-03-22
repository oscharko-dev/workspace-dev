import { useCallback, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from "react";
import { CodeViewer, type HighlightRange } from "./CodeViewer";
import { DiffViewer } from "./DiffViewer";
import { Breadcrumb } from "./Breadcrumb";
import type { BreadcrumbSegment } from "./component-tree-utils";

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
  /** Split view: suggested/selected second file path. */
  splitFile?: string | null;
  /** Split view: content of the second file. */
  splitFileContent?: string | null;
  /** Split view: loading state for second file. */
  splitFileContentLoading?: boolean;
  /** Split view: callback to change second file selection. */
  onSelectSplitFile?: (filePath: string) => void;
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
  splitFile,
  splitFileContent,
  splitFileContentLoading,
  onSelectSplitFile
}: CodePaneProps): JSX.Element {
  const [jsonVisible, setJsonVisible] = useState(false);
  const [diffEnabled, setDiffEnabled] = useState(false);
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitRatio, setSplitRatio] = useState(50); // percentage for left pane

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
    <div className="flex h-full min-h-0 flex-col">
      {/* File selector header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <select
          data-testid="inspector-file-selector"
          value={selectedFile ?? ""}
          disabled={isFileSelectorDisabled}
          onChange={(e) => {
            if (!e.target.value) return;
            onSelectFile(e.target.value);
          }}
          className="min-w-0 flex-1 truncate rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
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
            className="shrink-0 cursor-pointer rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 transition hover:bg-slate-100"
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
          <p data-testid="inspector-state-files-loading" className="m-0 text-xs text-slate-500">
            Loading generated files…
          </p>
        ) : null}
        {filesState === "empty" ? (
          <p data-testid="inspector-state-files-empty" className="m-0 text-xs text-amber-800">
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
        <Breadcrumb path={breadcrumbPath} onSelect={onBreadcrumbSelect} />
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
              newCode={fileContent}
              filePath={selectedFile}
              previousJobId={previousJobId}
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
                  code={fileContent}
                  filePath={selectedFile}
                  highlightRange={highlightRange}
                />
              </div>

              {/* Resizable divider */}
              <div
                role="separator"
                tabIndex={0}
                aria-label="Resize split panes"
                aria-orientation="vertical"
                data-testid="inspector-split-divider"
                className="w-1 shrink-0 cursor-col-resize bg-slate-200 transition-colors hover:bg-slate-400 focus:bg-slate-400 focus:outline-none"
                style={{ touchAction: "none" }}
                onPointerDown={handleSplitPointerDown}
              />

              {/* Right pane */}
              <div
                data-testid="inspector-split-right"
                className="flex min-w-0 flex-1 flex-col overflow-hidden"
              >
                {/* Right pane file selector */}
                <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50 px-2 py-1">
                  <select
                    data-testid="inspector-split-file-selector"
                    value={splitFile ?? ""}
                    onChange={(e) => {
                      if (!e.target.value || !onSelectSplitFile) return;
                      onSelectSplitFile(e.target.value);
                    }}
                    className="min-w-0 flex-1 truncate rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-800"
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
              code={fileContent}
              filePath={selectedFile}
              highlightRange={highlightRange}
            />
          )
        ) : filesState === "empty" ? (
          <p data-testid="inspector-state-file-content-empty" className="m-0 p-3 text-xs text-slate-500">
            No source file content is available yet.
          </p>
        ) : (
          <p data-testid="inspector-state-file-content-empty" className="m-0 p-3 text-xs text-slate-500">
            Select a file to view its source.
          </p>
        )}
      </div>
    </div>
  );
}
