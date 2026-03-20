import { useState, type JSX } from "react";
import { CodeViewer, type HighlightRange } from "./CodeViewer";

export type { HighlightRange } from "./CodeViewer";

interface CodePaneProps {
  files: Array<{ path: string; sizeBytes: number }>;
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
  fileContent: string | null;
  isLoadingContent: boolean;
  highlightRange?: HighlightRange | null;
}

export function CodePane({
  files,
  selectedFile,
  onSelectFile,
  fileContent,
  isLoadingContent,
  highlightRange
}: CodePaneProps): JSX.Element {
  const [jsonVisible, setJsonVisible] = useState(false);

  const codeFiles = files.filter(
    (f) => f.path.endsWith(".tsx") || f.path.endsWith(".ts") || (jsonVisible && f.path.endsWith(".json"))
  );

  const jsonFiles = files.filter((f) => f.path.endsWith(".json"));
  const hasJsonFiles = jsonFiles.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* File selector header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <select
          data-testid="inspector-file-selector"
          value={selectedFile ?? ""}
          onChange={(e) => {
            onSelectFile(e.target.value);
          }}
          className="min-w-0 flex-1 truncate rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
        >
          {codeFiles.map((f) => (
            <option key={f.path} value={f.path}>
              {f.path}
            </option>
          ))}
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
      </div>

      {/* Code viewer or loading/empty state */}
      <div className="min-h-0 flex-1">
        {isLoadingContent ? (
          <p className="m-0 p-3 text-xs text-slate-500">Loading file…</p>
        ) : fileContent !== null && selectedFile ? (
          <CodeViewer
            code={fileContent}
            filePath={selectedFile}
            highlightRange={highlightRange}
          />
        ) : (
          <p className="m-0 p-3 text-xs text-slate-500">Select a file to view its source.</p>
        )}
      </div>
    </div>
  );
}
