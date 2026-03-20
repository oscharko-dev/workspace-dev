/**
 * Syntax-highlighted code viewer using Shiki.
 *
 * Features:
 * - Syntax highlighting for tsx, typescript, json via Shiki
 * - Line numbers in gutter
 * - Highlight range with smooth scroll
 * - Copy button (full file or highlighted range)
 * - Word wrap toggle
 * - Light/dark theme following system preference
 * - Files > 500 KB fall back to plain text with warning
 * - Cached highlighting per file path
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/384
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import {
  highlightCode,
  exceedsMaxSize,
  getPreferredTheme,
  type HighlightResult
} from "../../../lib/shiki";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HighlightRange {
  startLine: number;
  endLine: number;
}

interface CodeViewerProps {
  /** Source code to display */
  code: string;
  /** File path — used for language detection and display */
  filePath: string;
  /** Optional line range to highlight and scroll to */
  highlightRange?: HighlightRange | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse Shiki HTML output into an array of line HTML strings.
 * Shiki wraps output in `<pre class="shiki ..."><code>` with each line
 * as `<span class="line">...</span>`.
 */
function parseShikiLines(html: string): string[] {
  // Extract inner content of <code>...</code>
  const codeMatch = /<code[^>]*>([\s\S]*?)<\/code>/.exec(html);
  if (!codeMatch?.[1]) return [];

  const inner = codeMatch[1];
  const lines: string[] = [];
  const lineRegex = /<span class="line">([\s\S]*?)<\/span>/g;
  let match = lineRegex.exec(inner);
  while (match) {
    lines.push(match[1] ?? "");
    match = lineRegex.exec(inner);
  }

  // If no line spans found, split by newline (fallback)
  if (lines.length === 0) {
    return inner.split("\n");
  }

  return lines;
}

/**
 * Extract the background color from Shiki's generated pre style.
 */
function extractBgColor(html: string): string | null {
  const match = /background-color:\s*(#[0-9a-fA-F]+)/.exec(html);
  return match?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CodeViewer({
  code,
  filePath,
  highlightRange
}: CodeViewerProps): JSX.Element {
  const [highlightResult, setHighlightResult] = useState<HighlightResult | null>(null);
  const [isHighlighting, setIsHighlighting] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const highlightRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [currentTheme, setCurrentTheme] = useState(getPreferredTheme);

  const isOversize = exceedsMaxSize(code);
  const rawLines = useMemo(() => code.split("\n"), [code]);

  // Listen for system theme changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (): void => {
      setCurrentTheme(getPreferredTheme());
    };
    mq.addEventListener("change", handler);
    return () => {
      mq.removeEventListener("change", handler);
    };
  }, []);

  // Run Shiki highlighting
  useEffect(() => {
    if (isOversize) {
      setHighlightResult(null);
      return;
    }

    let cancelled = false;
    setIsHighlighting(true);

    void highlightCode(code, filePath, currentTheme).then((result) => {
      if (!cancelled) {
        setHighlightResult(result);
        setIsHighlighting(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [code, filePath, currentTheme, isOversize]);

  // Scroll to highlighted range
  useEffect(() => {
    if (highlightRange && highlightRef.current && typeof highlightRef.current.scrollIntoView === "function") {
      highlightRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [highlightRange, highlightResult]);

  // Parse highlighted lines
  const highlightedLines = useMemo(() => {
    if (!highlightResult) return null;
    return parseShikiLines(highlightResult.html);
  }, [highlightResult]);

  const bgColor = useMemo(() => {
    if (!highlightResult) return null;
    return extractBgColor(highlightResult.html);
  }, [highlightResult]);

  const isDark = currentTheme === "github-dark";

  // Copy handler
  const handleCopy = useCallback(async () => {
    let textToCopy = code;
    if (highlightRange) {
      const lines = code.split("\n");
      textToCopy = lines.slice(highlightRange.startLine - 1, highlightRange.endLine).join("\n");
    }
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      // Clipboard API may not be available
    }
  }, [code, highlightRange]);

  // Determine lines to render
  const lines = highlightedLines ?? rawLines;
  const useHighlighted = highlightedLines !== null;

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="code-viewer"
    >
      {/* Toolbar */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5"
        style={{
          backgroundColor: isDark ? "#161b22" : undefined,
          borderColor: isDark ? "#30363d" : undefined
        }}
      >
        {/* File path */}
        <span
          className="min-w-0 flex-1 truncate text-xs font-mono"
          data-testid="code-viewer-filepath"
          style={{ color: isDark ? "#8b949e" : "#57606a" }}
        >
          {filePath}
        </span>

        {/* Word wrap toggle */}
        <button
          type="button"
          data-testid="code-viewer-wrap-toggle"
          onClick={() => { setWordWrap((w) => !w); }}
          className="shrink-0 cursor-pointer rounded border px-2 py-0.5 text-[10px] font-semibold transition"
          style={{
            borderColor: isDark ? "#30363d" : "#d0d7de",
            backgroundColor: wordWrap ? (isDark ? "#1f6feb33" : "#ddf4ff") : (isDark ? "#21262d" : "#ffffff"),
            color: isDark ? "#c9d1d9" : "#24292f"
          }}
        >
          {wordWrap ? "Wrap: On" : "Wrap: Off"}
        </button>

        {/* Copy button */}
        <button
          type="button"
          data-testid="inspector-copy-button"
          onClick={() => { void handleCopy(); }}
          className="shrink-0 cursor-pointer rounded border px-2 py-0.5 text-[10px] font-semibold transition"
          style={{
            borderColor: isDark ? "#30363d" : "#d0d7de",
            backgroundColor: isDark ? "#21262d" : "#ffffff",
            color: isDark ? "#c9d1d9" : "#24292f"
          }}
        >
          {copied ? "Copied!" : highlightRange ? "Copy Range" : "Copy"}
        </button>
      </div>

      {/* Oversize warning */}
      {isOversize ? (
        <div
          className="shrink-0 border-b px-3 py-1.5 text-xs font-medium"
          data-testid="code-viewer-oversize-warning"
          style={{
            backgroundColor: isDark ? "#3d1d00" : "#fff8c5",
            borderColor: isDark ? "#5a3600" : "#d4a72c",
            color: isDark ? "#e3b341" : "#6a5300"
          }}
        >
          File exceeds 500 KB — syntax highlighting disabled for performance.
        </div>
      ) : null}

      {/* Code area */}
      <div
        ref={scrollContainerRef}
        className="min-h-0 flex-1 overflow-auto p-0"
        data-testid="code-content"
        style={{ backgroundColor: bgColor ?? (isDark ? "#0d1117" : "#ffffff") }}
      >
        {isHighlighting && !highlightResult ? (
          <p
            className="m-0 p-3 text-xs"
            style={{ color: isDark ? "#8b949e" : "#57606a" }}
          >
            Highlighting…
          </p>
        ) : (
          <div className="min-w-0">
            {lines.map((line, i) => {
              const lineNum = i + 1;
              const isInRange =
                highlightRange != null &&
                lineNum >= highlightRange.startLine &&
                lineNum <= highlightRange.endLine;

              return (
                <div
                  key={i}
                  ref={isInRange && lineNum === highlightRange!.startLine ? highlightRef : undefined}
                  data-testid={isInRange ? "highlighted-line" : undefined}
                  className="flex text-xs leading-relaxed"
                  style={{
                    backgroundColor: isInRange
                      ? (isDark ? "rgba(56, 139, 253, 0.15)" : "rgba(16, 185, 129, 0.1)")
                      : undefined
                  }}
                >
                  {/* Line number gutter */}
                  <span
                    data-testid="line-number"
                    className="inline-block w-10 shrink-0 pr-2 text-right select-none font-mono"
                    style={{ color: isDark ? "#484f58" : "#8c959f" }}
                  >
                    {lineNum}
                  </span>

                  {/* Code content */}
                  {useHighlighted ? (
                    <span
                      className={`m-0 min-w-0 flex-1 font-mono ${wordWrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"}`}
                      dangerouslySetInnerHTML={{ __html: line }}
                    />
                  ) : (
                    <pre
                      className={`m-0 min-w-0 flex-1 font-mono ${wordWrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"}`}
                      style={{ color: isDark ? "#c9d1d9" : "#24292f" }}
                    >
                      {line}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
