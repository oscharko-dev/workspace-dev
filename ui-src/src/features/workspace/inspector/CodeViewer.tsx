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
import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { type BundledTheme } from "shiki";
import {
  exceedsMaxSize,
  getPreferredTheme,
  type HighlightResult
} from "../../../lib/shiki";
import { highlightCodeWithWorker, isAbortError } from "../../../lib/shiki-worker-client";
import {
  buildCodeBoundaryLayout,
  type CodeBoundaryEntry,
  type CodeBoundaryWithLane
} from "./code-boundaries";

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
  /** Force the viewer into a dark IDE treatment regardless of system preference. */
  forceDarkTheme?: boolean;
  /** Optional line range to highlight and scroll to */
  highlightRange?: HighlightRange | null;
  /** Optional IR code boundaries for the displayed file */
  boundaries?: CodeBoundaryEntry[];
  /** Controls whether boundary gutters are visible */
  boundariesEnabled?: boolean;
  /** Called when boundary visibility toggle changes */
  onBoundariesEnabledChange?: (enabled: boolean) => void;
  /** Called when a boundary marker is clicked */
  onBoundarySelect?: (irNodeId: string) => void;
  /** 1-based offset for line numbers when displaying a code snippet. */
  lineOffset?: number;
}

interface SearchMatch {
  line: number;
  column: number;
}

type SearchMode =
  | { kind: "empty" }
  | { kind: "find"; query: string }
  | { kind: "jump"; requestedLine: number };

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

function clampLineNumber({
  line,
  maxLines
}: {
  line: number;
  maxLines: number;
}): number {
  if (maxLines <= 0) {
    return 1;
  }
  if (line < 1) {
    return 1;
  }
  if (line > maxLines) {
    return maxLines;
  }
  return line;
}

function parseSearchInput(value: string): SearchMode {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return { kind: "empty" };
  }

  const jumpMatch = /^:(\d+)$/.exec(normalized);
  if (jumpMatch?.[1]) {
    const requestedLine = Number.parseInt(jumpMatch[1], 10);
    if (Number.isFinite(requestedLine) && requestedLine > 0) {
      return { kind: "jump", requestedLine };
    }
  }

  return { kind: "find", query: normalized };
}

function findOccurrences({
  lines,
  query
}: {
  lines: string[];
  query: string;
}): SearchMatch[] {
  if (query.length === 0) {
    return [];
  }

  const lowerQuery = query.toLowerCase();
  const matches: SearchMatch[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineText = lines[lineIndex] ?? "";
    const lowerLine = lineText.toLowerCase();
    let startIndex = 0;

    while (startIndex < lowerLine.length) {
      const foundIndex = lowerLine.indexOf(lowerQuery, startIndex);
      if (foundIndex < 0) {
        break;
      }

      matches.push({
        line: lineIndex + 1,
        column: foundIndex + 1
      });
      startIndex = foundIndex + 1;
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CodeViewer({
  code,
  filePath,
  forceDarkTheme = false,
  highlightRange,
  boundaries = [],
  boundariesEnabled,
  onBoundariesEnabledChange,
  onBoundarySelect,
  lineOffset = 1
}: CodeViewerProps): JSX.Element {
  const [highlightState, setHighlightState] = useState<{
    result: HighlightResult | null;
    /** Inputs that produced this result — used to detect staleness */
    forCode: string;
    forFilePath: string;
    forTheme: string;
  } | null>(null);
  const [wordWrap, setWordWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1);
  const [jumpTargetLine, setJumpTargetLine] = useState<number | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [internalBoundariesEnabled, setInternalBoundariesEnabled] = useState(false);
  const [hoveredBoundary, setHoveredBoundary] = useState<{
    boundary: CodeBoundaryWithLane;
    x: number;
    y: number;
  } | null>(null);
  const codeViewerRef = useRef<HTMLDivElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [currentTheme, setCurrentTheme] = useState<BundledTheme>(() => {
    return forceDarkTheme ? "github-dark" : getPreferredTheme();
  });

  const isOversize = exceedsMaxSize(code);
  const rawLines = useMemo(() => code.split("\n"), [code]);
  const searchMode = useMemo<SearchMode>(() => parseSearchInput(searchInput), [searchInput]);
  const searchMatches = useMemo(() => {
    if (searchMode.kind !== "find") {
      return [];
    }
    return findOccurrences({ lines: rawLines, query: searchMode.query });
  }, [rawLines, searchMode]);
  const searchMatchedLineSet = useMemo(() => {
    return new Set(searchMatches.map((match) => match.line));
  }, [searchMatches]);
  const activeMatch = useMemo(() => {
    if (activeMatchIndex < 0 || activeMatchIndex >= searchMatches.length) {
      return null;
    }
    return searchMatches[activeMatchIndex] ?? null;
  }, [activeMatchIndex, searchMatches]);

  const scrollToLine = useCallback(
    ({
      lineNumber,
      behavior
    }: {
      lineNumber: number;
      behavior: ScrollBehavior;
    }) => {
      const target = lineRefs.current.get(lineNumber);
      if (!target || typeof target.scrollIntoView !== "function") {
        return;
      }
      target.scrollIntoView({ block: "center", behavior });
    },
    []
  );

  const focusFindInput = useCallback(() => {
    const input = findInputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    input.select();
  }, []);

  // Listen for system theme changes
  useEffect(() => {
    if (forceDarkTheme) {
      setCurrentTheme("github-dark");
      return;
    }
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (): void => {
      setCurrentTheme(getPreferredTheme());
    };
    mq.addEventListener("change", handler);
    return () => {
      mq.removeEventListener("change", handler);
    };
  }, [forceDarkTheme]);

  // Run Shiki highlighting
  useEffect(() => {
    if (isOversize) {
      return;
    }

    const abortController = new AbortController();

    void highlightCodeWithWorker({
      code,
      filePath,
      theme: currentTheme,
      signal: abortController.signal
    })
      .then((result) => {
        if (abortController.signal.aborted) {
          return;
        }
        setHighlightState({ result, forCode: code, forFilePath: filePath, forTheme: currentTheme });
      })
      .catch((error) => {
        if (isAbortError(error) || abortController.signal.aborted) {
          return;
        }
        setHighlightState({
          result: null,
          forCode: code,
          forFilePath: filePath,
          forTheme: currentTheme
        });
      });

    return () => {
      abortController.abort();
    };
  }, [code, filePath, currentTheme, isOversize]);

  useEffect(() => {
    lineRefs.current.clear();
  }, [code, filePath]);

  useEffect(() => {
    if (searchMode.kind !== "find" || searchMatches.length === 0) {
      setActiveMatchIndex(-1);
      return;
    }

    setActiveMatchIndex((current) => {
      if (current < 0 || current >= searchMatches.length) {
        return 0;
      }
      return current;
    });
  }, [searchMode.kind, searchMatches.length]);

  useEffect(() => {
    if (searchMode.kind !== "find" || !activeMatch) {
      return;
    }
    scrollToLine({ lineNumber: activeMatch.line, behavior: "smooth" });
  }, [activeMatch, scrollToLine, searchMode.kind]);

  // Determine if the current highlight state matches the current inputs
  const isFresh = highlightState !== null
    && highlightState.forCode === code
    && highlightState.forFilePath === filePath
    && highlightState.forTheme === currentTheme;
  const isHighlighting = !isOversize && !isFresh;
  const effectiveHighlightResult = isOversize || !isFresh ? null : highlightState.result;

  // Scroll to highlighted range once highlighting settles
  useEffect(() => {
    if (isFresh && highlightRange) {
      scrollToLine({
        lineNumber: highlightRange.startLine,
        behavior: "smooth"
      });
    }
  }, [highlightRange, isFresh, scrollToLine]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }
      if (event.key.toLowerCase() !== "f") {
        return;
      }
      if (!codeViewerRef.current) {
        return;
      }

      event.preventDefault();
      focusFindInput();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [focusFindInput]);

  // Parse highlighted lines
  const highlightedLines = useMemo(() => {
    if (!effectiveHighlightResult) return null;
    return parseShikiLines(effectiveHighlightResult.html);
  }, [effectiveHighlightResult]);

  const bgColor = useMemo(() => {
    if (!effectiveHighlightResult) return null;
    return extractBgColor(effectiveHighlightResult.html);
  }, [effectiveHighlightResult]);

  const isDark = currentTheme === "github-dark";
  const effectiveBoundariesEnabled = boundariesEnabled ?? internalBoundariesEnabled;

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
  const boundaryLayout = useMemo<ReturnType<typeof buildCodeBoundaryLayout>>(() => {
    if (!effectiveBoundariesEnabled || boundaries.length === 0) {
      return {
        boundaries: [],
        byLine: new Map<number, { visible: CodeBoundaryWithLane[]; overflowCount: number }>()
      };
    }
    return buildCodeBoundaryLayout({
      entries: boundaries,
      totalLines: lines.length,
      isDark
    });
  }, [boundaries, effectiveBoundariesEnabled, isDark, lines.length]);
  const findCountText = useMemo(() => {
    if (searchMode.kind !== "find") {
      return "0";
    }
    if (searchMatches.length === 0 || activeMatchIndex < 0) {
      return `0 of ${String(searchMatches.length)}`;
    }
    return `${String(activeMatchIndex + 1)} of ${String(searchMatches.length)}`;
  }, [activeMatchIndex, searchMatches.length, searchMode.kind]);

  const handleNavigateMatches = useCallback(
    (direction: 1 | -1) => {
      if (searchMode.kind !== "find" || searchMatches.length === 0) {
        return;
      }

      setJumpTargetLine(null);
      setActiveMatchIndex((current) => {
        const baseIndex = current < 0 ? (direction === 1 ? -1 : 0) : current;
        const next = (baseIndex + direction + searchMatches.length) % searchMatches.length;
        return next;
      });
    },
    [searchMatches.length, searchMode.kind]
  );

  const handleApplyLineJump = useCallback(() => {
    if (searchMode.kind !== "jump") {
      return;
    }
    const clamped = clampLineNumber({
      line: searchMode.requestedLine,
      maxLines: lines.length
    });
    setJumpTargetLine(clamped);
    setActiveMatchIndex(-1);
    scrollToLine({ lineNumber: clamped, behavior: "smooth" });
  }, [lines.length, scrollToLine, searchMode]);

  const handleSearchInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      if (searchMode.kind === "jump") {
        handleApplyLineJump();
        return;
      }
      if (searchMode.kind === "find") {
        handleNavigateMatches(event.shiftKey ? -1 : 1);
      }
    },
    [handleApplyLineJump, handleNavigateMatches, searchMode.kind]
  );

  const handleBoundariesToggle = useCallback(() => {
    const nextEnabled = !effectiveBoundariesEnabled;
    if (onBoundariesEnabledChange) {
      onBoundariesEnabledChange(nextEnabled);
      return;
    }
    setInternalBoundariesEnabled(nextEnabled);
  }, [effectiveBoundariesEnabled, onBoundariesEnabledChange]);

  useEffect(() => {
    if (!effectiveBoundariesEnabled || boundaries.length === 0) {
      setHoveredBoundary(null);
    }
  }, [boundaries.length, effectiveBoundariesEnabled]);

  return (
    <div
      ref={codeViewerRef}
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

        <div className="flex shrink-0 items-center gap-1">
          <input
            ref={findInputRef}
            type="text"
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
              setActiveMatchIndex(-1);
              setJumpTargetLine(null);
            }}
            onFocus={() => {
              setSearchFocused(true);
            }}
            onBlur={() => {
              setSearchFocused(false);
            }}
            onKeyDown={handleSearchInputKeyDown}
            placeholder="Find or :line"
            data-testid="code-viewer-find-input"
            className="h-6 w-40 rounded border bg-transparent px-2 text-[10px] font-mono"
            style={{
              borderColor: searchFocused
                ? (isDark ? "#1f6feb" : "#0969da")
                : (isDark ? "#30363d" : "#d0d7de"),
              color: isDark ? "#c9d1d9" : "#24292f"
            }}
          />
          <button
            type="button"
            data-testid="code-viewer-find-prev"
            onClick={() => {
              handleNavigateMatches(-1);
            }}
            disabled={searchMode.kind !== "find" || searchMatches.length === 0}
            className="h-6 shrink-0 cursor-pointer rounded border px-2 py-0 text-[10px] font-semibold transition disabled:cursor-default disabled:opacity-50"
            style={{
              borderColor: isDark ? "#30363d" : "#d0d7de",
              backgroundColor: isDark ? "#21262d" : "#ffffff",
              color: isDark ? "#c9d1d9" : "#24292f"
            }}
          >
            Prev
          </button>
          <button
            type="button"
            data-testid="code-viewer-find-next"
            onClick={() => {
              handleNavigateMatches(1);
            }}
            disabled={searchMode.kind !== "find" || searchMatches.length === 0}
            className="h-6 shrink-0 cursor-pointer rounded border px-2 py-0 text-[10px] font-semibold transition disabled:cursor-default disabled:opacity-50"
            style={{
              borderColor: isDark ? "#30363d" : "#d0d7de",
              backgroundColor: isDark ? "#21262d" : "#ffffff",
              color: isDark ? "#c9d1d9" : "#24292f"
            }}
          >
            Next
          </button>
          <span
            data-testid="code-viewer-find-count"
            className="w-16 text-right text-[10px] font-semibold"
            style={{ color: isDark ? "#8b949e" : "#57606a" }}
          >
            {findCountText}
          </span>
        </div>

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

        {/* Boundary toggle */}
        <button
          type="button"
          data-testid="code-viewer-boundaries-toggle"
          onClick={handleBoundariesToggle}
          className="shrink-0 cursor-pointer rounded border px-2 py-0.5 text-[10px] font-semibold transition"
          style={{
            borderColor: isDark ? "#30363d" : "#d0d7de",
            backgroundColor: effectiveBoundariesEnabled ? (isDark ? "#164e63" : "#cffafe") : (isDark ? "#21262d" : "#ffffff"),
            color: effectiveBoundariesEnabled ? (isDark ? "#a5f3fc" : "#0e7490") : (isDark ? "#c9d1d9" : "#24292f")
          }}
        >
          {effectiveBoundariesEnabled ? "Boundaries: On" : "Boundaries: Off"}
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
        {isHighlighting ? (
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
              const displayLineNum = i + lineOffset;
              const hasSearchMatch = searchMatchedLineSet.has(lineNum);
              const isActiveMatchLine = activeMatch?.line === lineNum;
              const isJumpTargetLine = jumpTargetLine === lineNum;
              const isInRange =
                highlightRange != null &&
                lineNum >= highlightRange.startLine &&
                lineNum <= highlightRange.endLine;
              const lineBoundaryDisplay = boundaryLayout.byLine.get(lineNum);
              const visibleBoundaries = lineBoundaryDisplay?.visible ?? [];
              const overflowCount = lineBoundaryDisplay?.overflowCount ?? 0;
              const hasBoundaryMarkers = visibleBoundaries.length > 0 || overflowCount > 0;

              const rangeBg = isDark ? "rgba(56, 139, 253, 0.15)" : "rgba(16, 185, 129, 0.1)";
              const searchBg = isDark ? "rgba(251, 191, 36, 0.12)" : "rgba(245, 158, 11, 0.14)";
              const stackedBg = isDark ? "rgba(147, 197, 253, 0.23)" : "rgba(16, 185, 129, 0.16)";
              const activeBg = isDark ? "rgba(251, 191, 36, 0.28)" : "rgba(245, 158, 11, 0.24)";
              const jumpBg = isDark ? "rgba(96, 165, 250, 0.22)" : "rgba(59, 130, 246, 0.2)";
              const emphasisBorder = isDark ? "#f59e0b" : "#b45309";

              let lineBackground: string | undefined;
              if (isInRange) {
                lineBackground = rangeBg;
              }
              if (hasSearchMatch) {
                lineBackground = isInRange ? stackedBg : searchBg;
              }
              if (isActiveMatchLine) {
                lineBackground = activeBg;
              }
              if (isJumpTargetLine) {
                lineBackground = jumpBg;
              }

              return (
                <div
                  key={i}
                  ref={(node) => {
                    if (node) {
                      lineRefs.current.set(lineNum, node);
                    } else {
                      lineRefs.current.delete(lineNum);
                    }
                  }}
                  data-testid={isInRange ? "highlighted-line" : undefined}
                  className="flex text-xs leading-relaxed"
                  style={{
                    backgroundColor: lineBackground,
                    borderLeft: isActiveMatchLine || isJumpTargetLine
                      ? `2px solid ${emphasisBorder}`
                      : undefined
                  }}
                >
                  {isActiveMatchLine ? (
                    <span data-testid="code-viewer-active-match-line" className="sr-only">
                      Active match line {lineNum}
                    </span>
                  ) : null}
                  {isJumpTargetLine ? (
                    <span data-testid="code-viewer-jump-target-line" className="sr-only">
                      Jump target line {lineNum}
                    </span>
                  ) : null}

                  {/* Line number gutter */}
                  <span
                    data-testid="line-number"
                    className="relative inline-flex w-14 shrink-0 pr-2 text-right select-none font-mono"
                    style={{ color: isDark ? "#484f58" : "#8c959f" }}
                  >
                    {effectiveBoundariesEnabled && hasBoundaryMarkers ? (
                      <span
                        className="absolute inset-y-0 left-0 flex items-stretch gap-px"
                        data-testid={`code-boundary-lanes-${String(lineNum)}`}
                      >
                        {visibleBoundaries.map((boundary) => {
                          const isStart = lineNum === boundary.startLine;
                          const isEnd = lineNum === boundary.endLine;
                          return (
                            <button
                              key={`${boundary.entry.irNodeId}:${String(lineNum)}:${String(boundary.lane)}`}
                              type="button"
                              data-testid={`code-boundary-marker-${boundary.entry.irNodeId}`}
                              data-boundary-node-id={boundary.entry.irNodeId}
                              aria-label={`Select ${boundary.entry.irNodeName}`}
                              className="h-full w-1 cursor-pointer border-0 p-0"
                              style={{
                                backgroundColor: boundary.color,
                                borderTopLeftRadius: isStart ? 2 : 0,
                                borderTopRightRadius: isStart ? 2 : 0,
                                borderBottomLeftRadius: isEnd ? 2 : 0,
                                borderBottomRightRadius: isEnd ? 2 : 0
                              }}
                              onMouseEnter={(event) => {
                                const rect = event.currentTarget.getBoundingClientRect();
                                setHoveredBoundary({
                                  boundary,
                                  x: rect.left,
                                  y: rect.top
                                });
                              }}
                              onMouseLeave={() => {
                                setHoveredBoundary((current) => {
                                  if (!current || current.boundary.entry.irNodeId !== boundary.entry.irNodeId) {
                                    return current;
                                  }
                                  return null;
                                });
                              }}
                              onFocus={(event) => {
                                const rect = event.currentTarget.getBoundingClientRect();
                                setHoveredBoundary({
                                  boundary,
                                  x: rect.left,
                                  y: rect.top
                                });
                              }}
                              onBlur={() => {
                                setHoveredBoundary((current) => {
                                  if (!current || current.boundary.entry.irNodeId !== boundary.entry.irNodeId) {
                                    return current;
                                  }
                                  return null;
                                });
                              }}
                              onClick={(event) => {
                                event.stopPropagation();
                                onBoundarySelect?.(boundary.entry.irNodeId);
                              }}
                            />
                          );
                        })}
                        {overflowCount > 0 ? (
                          <span
                            data-testid={`code-boundary-overflow-indicator-${String(lineNum)}`}
                            className="inline-flex items-center px-0.5 text-[8px] font-bold leading-none"
                            style={{ color: isDark ? "#9ca3af" : "#475569" }}
                            title={`${String(overflowCount)} more overlapping boundaries`}
                          >
                            +{String(overflowCount)}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                    <span className="inline-block w-full text-right">{displayLineNum}</span>
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
      {hoveredBoundary ? (
        <div
          role="tooltip"
          data-testid="code-boundary-tooltip"
          className="pointer-events-none fixed z-30 min-w-40 rounded border px-2 py-1 text-[10px] shadow-lg"
          style={{
            left: Math.max(
              8,
              Math.min(
                (typeof window === "undefined" ? 1024 : window.innerWidth) - 260,
                hoveredBoundary.x + 10
              )
            ),
            top: Math.max(8, hoveredBoundary.y - 36),
            borderColor: isDark ? "#1e293b" : "#cbd5e1",
            backgroundColor: isDark ? "#0f172a" : "#f8fafc",
            color: isDark ? "#e2e8f0" : "#0f172a"
          }}
        >
          <div className="flex items-center gap-1.5">
            <span
              data-testid="code-boundary-tooltip-type"
              className="inline-flex items-center rounded px-1 py-0.5 text-[9px] font-semibold uppercase"
              style={{
                backgroundColor: isDark ? "#1e293b" : "#e2e8f0",
                color: isDark ? "#93c5fd" : "#1d4ed8"
              }}
            >
              {hoveredBoundary.boundary.entry.irNodeType}
            </span>
            <span data-testid="code-boundary-tooltip-name" className="truncate font-semibold">
              {hoveredBoundary.boundary.entry.irNodeName}
            </span>
          </div>
          <div data-testid="code-boundary-tooltip-range" className="mt-0.5 text-[9px]">
            Lines {String(hoveredBoundary.boundary.startLine)}-{String(hoveredBoundary.boundary.endLine)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
