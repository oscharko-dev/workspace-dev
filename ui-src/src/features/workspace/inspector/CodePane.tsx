import { useState, type JSX } from "react";
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
  /** Previous job ID for diff comparison. `null` when no prior job exists. */
  previousJobId?: string | null;
  /** Content of the selected file from the previous job. `null` while loading or unavailable. */
  previousFileContent?: string | null;
  /** Loading state for the previous file content fetch. */
  previousFileContentLoading?: boolean;
  /** Breadcrumb path from root screen to selected node. Empty when no node selected. */
  breadcrumbPath?: BreadcrumbSegment[];
  /** Callback when user clicks a breadcrumb segment to navigate to an ancestor. */
  onBreadcrumbSelect?: (nodeId: string) => void;
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
  onBreadcrumbSelect
}: CodePaneProps): JSX.Element {
  const [jsonVisible, setJsonVisible] = useState(false);
  const [diffEnabled, setDiffEnabled] = useState(false);

  const codeFiles = files.filter(
    (f) => f.path.endsWith(".tsx") || f.path.endsWith(".ts") || (jsonVisible && f.path.endsWith(".json"))
  );

  const jsonFiles = files.filter((f) => f.path.endsWith(".json"));
  const hasJsonFiles = jsonFiles.length > 0;
  const hasCodeFiles = codeFiles.length > 0;
  const isFileSelectorDisabled = filesState === "loading" || filesState === "error" || !hasCodeFiles;

  const canDiff = Boolean(previousJobId) && fileContent !== null && previousFileContent !== null && !previousFileContentLoading;
  const isDiffActive = diffEnabled && canDiff;

  const diffTooltip = !previousJobId
    ? "No previous job available for comparison"
    : previousFileContentLoading
      ? "Loading previous file…"
      : previousFileContent === null
        ? "Previous file not available"
        : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* File selector header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <select
          data-testid="inspector-file-selector"
          value={selectedFile ?? ""}
          disabled={isFileSelectorDisabled}
          onChange={(e) => {
            if (!e.target.value) {
              return;
            }
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

      {/* Breadcrumb navigation — visible only when a node is selected */}
      {breadcrumbPath && breadcrumbPath.length > 0 && onBreadcrumbSelect ? (
        <Breadcrumb path={breadcrumbPath} onSelect={onBreadcrumbSelect} />
      ) : null}

      {/* Code viewer or diff viewer or loading/empty state */}
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
