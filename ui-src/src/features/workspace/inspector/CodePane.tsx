import { useCallback, useEffect, useRef, useState, type JSX } from "react";

export interface HighlightRange {
  startLine: number;
  endLine: number;
}

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
  const [copied, setCopied] = useState(false);
  const highlightRef = useRef<HTMLDivElement>(null);

  const handleCopy = useCallback(async () => {
    if (!fileContent) {
      return;
    }
    try {
      await navigator.clipboard.writeText(fileContent);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      // Clipboard API may not be available
    }
  }, [fileContent]);

  // Scroll to highlighted range when it changes
  useEffect(() => {
    if (highlightRange && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [highlightRange]);

  const codeFiles = files.filter(
    (f) => f.path.endsWith(".tsx") || f.path.endsWith(".ts")
  );

  const lines = fileContent?.split("\n") ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
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
        <button
          type="button"
          data-testid="inspector-copy-button"
          onClick={() => {
            void handleCopy();
          }}
          disabled={!fileContent}
          className="shrink-0 cursor-pointer rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-white p-0">
        {isLoadingContent ? (
          <p className="m-0 p-3 text-xs text-slate-500">Loading file…</p>
        ) : fileContent !== null ? (
          <div data-testid="code-content" className="min-w-0">
            {lines.map((line, i) => {
              const lineNum = i + 1;
              const isHighlighted =
                highlightRange != null &&
                lineNum >= highlightRange.startLine &&
                lineNum <= highlightRange.endLine;

              return (
                <div
                  key={i}
                  ref={isHighlighted && lineNum === highlightRange!.startLine ? highlightRef : undefined}
                  data-testid={isHighlighted ? "highlighted-line" : undefined}
                  className={`flex text-xs leading-relaxed ${
                    isHighlighted ? "bg-emerald-50" : ""
                  }`}
                >
                  <span className="inline-block w-10 shrink-0 pr-2 text-right text-slate-400 select-none">
                    {lineNum}
                  </span>
                  <pre className="m-0 min-w-0 flex-1 whitespace-pre-wrap break-all text-slate-800">
                    {line}
                  </pre>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="m-0 p-3 text-xs text-slate-500">Select a file to view its source.</p>
        )}
      </div>
    </div>
  );
}
