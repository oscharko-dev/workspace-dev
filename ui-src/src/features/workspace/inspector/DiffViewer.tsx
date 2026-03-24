/**
 * Unified diff viewer with dual-gutter line numbers, add/remove/context coloring,
 * and theme-aware styling that follows the system preference (light/dark).
 *
 * Features:
 * - Colored diff lines: green (added), red (removed), neutral (context)
 * - Dual line number gutters (old / new)
 * - Find-in-diff with Cmd+F / Ctrl+F
 * - Match navigation (Prev / Next)
 * - Copy current file content
 * - Word wrap toggle
 * - Keyboard accessible
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/434
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { computeUnifiedDiff, type DiffLine, type DiffResult } from "../../../lib/diff";
import { getPreferredTheme, type HighlightTheme } from "../../../lib/shiki-shared";
import type { ManifestRange, ScopedCodeMode } from "./scoped-code-ranges";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiffViewerProps {
  /** Previous (old) file content. */
  oldCode: string;
  /** Current (new) file content. */
  newCode: string;
  /** File path — used for display and language context. */
  filePath: string;
  /** Previous job ID shown in the toolbar. */
  previousJobId: string;
  /** Focus range for the old (previous) side. Null = no range focus. */
  oldFocusRange?: ManifestRange | null;
  /** Focus range for the new (current) side. Null = no range focus. */
  newFocusRange?: ManifestRange | null;
  /** Active scoped code mode. */
  scopedMode?: ScopedCodeMode;
  /** Whether the diff is scoped to a specific node. */
  isNodeScoped?: boolean;
  /** Reason why node-scoped diff is unavailable (null when available). */
  nodeDiffFallbackReason?: string | null | undefined;
  /** Force a viewer theme instead of following the system preference. */
  themeMode?: "system" | "dark";
}

interface DiffSearchMatch {
  lineIndex: number;
  column: number;
}

function resolveViewerTheme(themeMode: "system" | "dark"): HighlightTheme {
  if (themeMode === "dark") {
    return "github-dark";
  }
  return getPreferredTheme();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DiffViewer({
  oldCode,
  newCode,
  filePath,
  previousJobId,
  oldFocusRange,
  newFocusRange,
  scopedMode,
  isNodeScoped,
  nodeDiffFallbackReason,
  themeMode = "system"
}: DiffViewerProps): JSX.Element {
  const [wordWrap, setWordWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1);
  const [searchFocused, setSearchFocused] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<HighlightTheme>(() => resolveViewerTheme(themeMode));

  const containerRef = useRef<HTMLDivElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDark = currentTheme === "github-dark";

  // Theme listener
  useEffect(() => {
    setCurrentTheme(resolveViewerTheme(themeMode));
  }, [themeMode]);

  // Theme listener
  useEffect(() => {
    if (themeMode !== "system") return;
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (): void => { setCurrentTheme(getPreferredTheme()); };
    mq.addEventListener("change", handler);
    return () => { mq.removeEventListener("change", handler); };
  }, [themeMode]);

  // Compute diff
  const diffResult: DiffResult = useMemo(
    () => computeUnifiedDiff(oldCode, newCode, 3),
    [oldCode, newCode]
  );

  // Search
  const searchQuery = searchInput.trim().toLowerCase();
  const searchMatches = useMemo<DiffSearchMatch[]>(() => {
    if (searchQuery.length === 0) return [];
    const matches: DiffSearchMatch[] = [];
    for (let i = 0; i < diffResult.lines.length; i += 1) {
      const line = diffResult.lines[i]!;
      const lowerContent = line.content.toLowerCase();
      let start = 0;
      while (start < lowerContent.length) {
        const idx = lowerContent.indexOf(searchQuery, start);
        if (idx < 0) break;
        matches.push({ lineIndex: i, column: idx + 1 });
        start = idx + 1;
      }
    }
    return matches;
  }, [diffResult.lines, searchQuery]);

  const activeMatch = useMemo(() => {
    if (activeMatchIndex < 0 || activeMatchIndex >= searchMatches.length) return null;
    return searchMatches[activeMatchIndex] ?? null;
  }, [activeMatchIndex, searchMatches]);

  const searchMatchedLineSet = useMemo(
    () => new Set(searchMatches.map((m) => m.lineIndex)),
    [searchMatches]
  );

  // Reset match index when query or matches change
  useEffect(() => {
    if (searchQuery.length === 0 || searchMatches.length === 0) {
      setActiveMatchIndex(-1);
      return;
    }
    setActiveMatchIndex((c) => (c < 0 || c >= searchMatches.length ? 0 : c));
  }, [searchQuery, searchMatches.length]);

  // Scroll active match into view
  useEffect(() => {
    if (!activeMatch) return;
    const el = lineRefs.current.get(activeMatch.lineIndex);
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeMatch]);

  // Cmd+F handler — only intercepts when the DiffViewer contains the active element
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f") return;
      if (!containerRef.current) return;
      if (!containerRef.current.contains(document.activeElement) && document.activeElement !== document.body) return;
      event.preventDefault();
      findInputRef.current?.focus();
      findInputRef.current?.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, []);

  const handleNavigateMatches = useCallback(
    (direction: 1 | -1) => {
      if (searchMatches.length === 0) return;
      setActiveMatchIndex((current) => {
        const base = current < 0 ? (direction === 1 ? -1 : 0) : current;
        return (base + direction + searchMatches.length) % searchMatches.length;
      });
    },
    [searchMatches.length]
  );

  const handleSearchInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      handleNavigateMatches(event.shiftKey ? -1 : 1);
    },
    [handleNavigateMatches]
  );

  const findCountText = useMemo(() => {
    if (searchQuery.length === 0) return "0";
    if (searchMatches.length === 0 || activeMatchIndex < 0) {
      return `0 of ${String(searchMatches.length)}`;
    }
    return `${String(activeMatchIndex + 1)} of ${String(searchMatches.length)}`;
  }, [activeMatchIndex, searchMatches.length, searchQuery.length]);

  // Clean up copy timeout on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  // Copy handler — always copies the *new* file content
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(newCode);
      setCopied(true);
      if (copyTimeoutRef.current !== null) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
        copyTimeoutRef.current = null;
      }, 1500);
    } catch {
      // Clipboard API may not be available
    }
  }, [newCode]);

  // Summary text
  const summaryText = diffResult.isIdentical
    ? "Files are identical"
    : `+${String(diffResult.addedCount)} added, -${String(diffResult.removedCount)} removed`;

  // Colors per line kind
  const lineColors = useMemo(() => ({
    added: {
      bg: isDark ? "rgba(46, 160, 67, 0.15)" : "rgba(16, 185, 129, 0.12)",
      border: isDark ? "#2ea043" : "#10b981",
      gutter: isDark ? "rgba(46, 160, 67, 0.30)" : "rgba(16, 185, 129, 0.20)"
    },
    removed: {
      bg: isDark ? "rgba(248, 81, 73, 0.15)" : "rgba(239, 68, 68, 0.10)",
      border: isDark ? "#f85149" : "#ef4444",
      gutter: isDark ? "rgba(248, 81, 73, 0.30)" : "rgba(239, 68, 68, 0.18)"
    },
    context: {
      bg: undefined,
      border: undefined,
      gutter: undefined
    }
  }), [isDark]);

  const searchBg = isDark ? "rgba(251, 191, 36, 0.12)" : "rgba(245, 158, 11, 0.14)";
  const activeBg = isDark ? "rgba(251, 191, 36, 0.28)" : "rgba(245, 158, 11, 0.24)";
  const focusBg = isDark ? "rgba(56, 139, 253, 0.10)" : "rgba(16, 185, 129, 0.07)";

  /** Check if a diff line falls within a scoped focus range. */
  const isInFocusRange = useCallback((diffLine: DiffLine): boolean => {
    if (!scopedMode || scopedMode === "full") return false;
    if (diffLine.kind === "removed" && oldFocusRange) {
      const lineNum = diffLine.oldLineNumber;
      return lineNum != null && lineNum >= oldFocusRange.startLine && lineNum <= oldFocusRange.endLine;
    }
    if (diffLine.kind === "added" && newFocusRange) {
      const lineNum = diffLine.newLineNumber;
      return lineNum != null && lineNum >= newFocusRange.startLine && lineNum <= newFocusRange.endLine;
    }
    if (diffLine.kind === "context") {
      const inOld = oldFocusRange && diffLine.oldLineNumber != null
        && diffLine.oldLineNumber >= oldFocusRange.startLine && diffLine.oldLineNumber <= oldFocusRange.endLine;
      const inNew = newFocusRange && diffLine.newLineNumber != null
        && diffLine.newLineNumber >= newFocusRange.startLine && diffLine.newLineNumber <= newFocusRange.endLine;
      return Boolean(inOld) || Boolean(inNew);
    }
    return false;
  }, [oldFocusRange, newFocusRange, scopedMode]);

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 flex-col"
      data-testid="diff-viewer"
    >
      {/* Toolbar */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5"
        style={{
          backgroundColor: isDark ? "#161b22" : undefined,
          borderColor: isDark ? "#30363d" : undefined
        }}
      >
        <span
          className="min-w-0 flex-1 truncate text-xs font-mono"
          data-testid="diff-viewer-filepath"
          style={{ color: isDark ? "#8b949e" : "#57606a" }}
        >
          {filePath}
          <span className="ml-2 text-[10px] opacity-60">
            vs {previousJobId.slice(0, 8)}…
          </span>
          {isNodeScoped ? (
            <span
              data-testid="diff-viewer-node-scoped-badge"
              className="ml-2 rounded-full border px-1.5 py-0 text-[9px] font-bold tracking-wide"
              style={{
                borderColor: isDark ? "#388bfd" : "#0969da",
                backgroundColor: isDark ? "rgba(56, 139, 253, 0.15)" : "rgba(9, 105, 218, 0.08)",
                color: isDark ? "#58a6ff" : "#0969da"
              }}
            >
              NODE
            </span>
          ) : null}
        </span>

        {/* Find input */}
        <div className="flex shrink-0 items-center gap-1">
          <input
            ref={findInputRef}
            type="text"
            value={searchInput}
            onChange={(e) => { setSearchInput(e.target.value); setActiveMatchIndex(-1); }}
            onFocus={() => { setSearchFocused(true); }}
            onBlur={() => { setSearchFocused(false); }}
            onKeyDown={handleSearchInputKeyDown}
            placeholder="Find in diff"
            aria-label="Find in diff"
            data-testid="diff-viewer-find-input"
            className="h-6 w-36 rounded border bg-transparent px-2 text-[10px] font-mono"
            style={{
              borderColor: searchFocused
                ? (isDark ? "#1f6feb" : "#0969da")
                : (isDark ? "#30363d" : "#d0d7de"),
              color: isDark ? "#c9d1d9" : "#24292f"
            }}
          />
          <button
            type="button"
            aria-label="Previous search match"
            data-testid="diff-viewer-find-prev"
            onClick={() => { handleNavigateMatches(-1); }}
            disabled={searchMatches.length === 0}
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
            aria-label="Next search match"
            data-testid="diff-viewer-find-next"
            onClick={() => { handleNavigateMatches(1); }}
            disabled={searchMatches.length === 0}
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
            aria-live="polite"
            data-testid="diff-viewer-find-count"
            className="w-16 text-right text-[10px] font-semibold"
            style={{ color: isDark ? "#8b949e" : "#57606a" }}
          >
            {findCountText}
          </span>
        </div>

        <button
          type="button"
          data-testid="diff-viewer-wrap-toggle"
          aria-pressed={wordWrap}
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

        <button
          type="button"
          data-testid="diff-viewer-copy-button"
          onClick={() => { void handleCopy(); }}
          className="shrink-0 cursor-pointer rounded border px-2 py-0.5 text-[10px] font-semibold transition"
          style={{
            borderColor: isDark ? "#30363d" : "#d0d7de",
            backgroundColor: isDark ? "#21262d" : "#ffffff",
            color: isDark ? "#c9d1d9" : "#24292f"
          }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      {/* Node-scoped diff fallback banner */}
      {nodeDiffFallbackReason ? (
        <div
          data-testid="inspector-node-diff-fallback"
          className="shrink-0 border-b px-3 py-1.5 text-[11px]"
          style={{
            backgroundColor: isDark ? "rgba(187, 128, 9, 0.15)" : "#fffbeb",
            borderColor: isDark ? "#bb8009" : "#fbbf24",
            color: isDark ? "#e3b341" : "#92400e"
          }}
        >
          {nodeDiffFallbackReason}
        </div>
      ) : null}

      {/* Summary bar */}
      <div
        className="shrink-0 border-b px-3 py-1 text-[11px] font-semibold"
        data-testid="diff-viewer-summary"
        style={{
          backgroundColor: isDark ? "#0d1117" : "#f6f8fa",
          borderColor: isDark ? "#30363d" : "#d0d7de",
          color: diffResult.isIdentical
            ? (isDark ? "#7ee787" : "#1a7f37")
            : (isDark ? "#c9d1d9" : "#24292f")
        }}
      >
        {summaryText}
      </div>

      {/* Diff content */}
      <div
        className="min-h-0 flex-1 overflow-auto p-0"
        data-testid="diff-content"
        style={{ backgroundColor: isDark ? "#0d1117" : "#ffffff" }}
      >
        <div className="min-w-0">
          {diffResult.lines.map((diffLine: DiffLine, i: number) => {
            const colors = lineColors[diffLine.kind];
            const hasSearchMatch = searchMatchedLineSet.has(i);
            const isActiveMatchLine = activeMatch?.lineIndex === i;
            const inFocus = isInFocusRange(diffLine);

            let lineBg = colors.bg;
            if (inFocus && !colors.bg) lineBg = focusBg;
            if (hasSearchMatch) lineBg = searchBg;
            if (isActiveMatchLine) lineBg = activeBg;

            const prefix = diffLine.kind === "added" ? "+" : diffLine.kind === "removed" ? "-" : " ";

            return (
              <div
                key={i}
                ref={(node) => {
                  if (node) lineRefs.current.set(i, node);
                  else lineRefs.current.delete(i);
                }}
                data-testid={`diff-line-${diffLine.kind}`}
                data-in-focus={inFocus ? "true" : undefined}
                className="flex text-xs leading-relaxed"
                style={{
                  backgroundColor: lineBg,
                  borderLeft: colors.border ? `3px solid ${colors.border}` : undefined
                }}
              >
                {/* Old line number gutter */}
                <span
                  data-testid="diff-old-line-number"
                  className="inline-block w-10 shrink-0 pr-1 text-right select-none font-mono"
                  style={{
                    color: isDark ? "#484f58" : "#8c959f",
                    backgroundColor: colors.gutter
                  }}
                >
                  {diffLine.oldLineNumber ?? ""}
                </span>

                {/* New line number gutter */}
                <span
                  data-testid="diff-new-line-number"
                  className="inline-block w-10 shrink-0 pr-2 text-right select-none font-mono"
                  style={{
                    color: isDark ? "#484f58" : "#8c959f",
                    backgroundColor: colors.gutter
                  }}
                >
                  {diffLine.newLineNumber ?? ""}
                </span>

                {/* Diff prefix (+/-/space) */}
                <span
                  className="inline-block w-4 shrink-0 select-none text-center font-mono"
                  style={{
                    color: diffLine.kind === "added"
                      ? (isDark ? "#7ee787" : "#1a7f37")
                      : diffLine.kind === "removed"
                        ? (isDark ? "#f85149" : "#cf222e")
                        : (isDark ? "#484f58" : "#8c959f")
                  }}
                >
                  {prefix}
                </span>

                {/* Line content */}
                <pre
                  className={`m-0 min-w-0 flex-1 font-mono ${wordWrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"}`}
                  style={{ color: isDark ? "#c9d1d9" : "#24292f" }}
                >
                  {diffLine.content}
                </pre>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
