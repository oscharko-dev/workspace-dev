/**
 * Syntax-highlighted code viewer using Shiki.
 *
 * Features:
 * - Syntax highlighting for tsx, TypeScript, JSON via Shiki
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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

/* eslint-disable react-hooks/set-state-in-effect */
import {
  detectLanguage,
  exceedsMaxSize,
  getPreferredTheme,
  type HighlightTheme,
  type HighlightResult,
} from "../../../lib/shiki-shared";
import {
  highlightCodeWithWorker,
  isAbortError,
} from "../../../lib/shiki-worker-client";
import {
  buildCodeBoundaryLayout,
  type CodeBoundaryEntry,
  type CodeBoundaryWithLane,
} from "./code-boundaries";
import {
  formatCodeForViewer,
  FORMAT_ERROR_TIMEOUT_MS,
  FORMAT_SUCCESS_TIMEOUT_MS,
  type FormatStatus,
  type ViewerLanguage,
} from "./code-formatting";
import "./inspector.css";

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
  highlightRange?: HighlightRange | null | undefined;
  /** Optional IR code boundaries for the displayed file */
  boundaries?: CodeBoundaryEntry[];
  /** Controls whether boundary gutters are visible */
  boundariesEnabled?: boolean | undefined;
  /** Called when boundary visibility toggle changes */
  onBoundariesEnabledChange?: ((enabled: boolean) => void) | undefined;
  /** Called when boundary marker is clicked */
  onBoundarySelect?: ((irNodeId: string) => void) | undefined;
  /** Active IR node id used to remap overlays after formatting. */
  selectedIrNodeId?: string | null | undefined;
  /** 1-based offset for line numbers when displaying a code snippet. */
  lineOffset?: number | undefined;
  /** Force a viewer theme instead of following the system preference. */
  themeMode?: "system" | "dark";
  /** Allow this viewer to claim Cmd/Ctrl+F when focus is elsewhere in the inspector. */
  allowExternalFindShortcut?: boolean | undefined;
  /** Optional external format handler for full-file-managed formatting flows. */
  onFormat?: (() => void | Promise<void>) | undefined;
  /** Optional externally managed format status. */
  formatStatus?: FormatStatus | undefined;
}

interface SearchMatch {
  line: number;
  column: number;
}

type SearchMode =
  | { kind: "empty" }
  | { kind: "find"; query: string }
  | { kind: "jump"; requestedLine: number };

type ViewerTheme = HighlightTheme;

interface RainbowDecoration {
  color: string;
  depth: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IR_START_PATTERN =
  /\{\/\* @ir:start (\S+) (.+?) (\S+?)(?: extracted)? \*\/\}/;
const IR_END_PATTERN = /\{\/\* @ir:end (\S+) \*\/\}/;
const RAINBOW_BRACKET_ATTRIBUTE = "data-rainbow-bracket";
const LIGHT_RAINBOW_COLORS = [
  "#d1242f",
  "#8250df",
  "#0969da",
  "#0a7f50",
  "#9a6700",
  "#bc4c00",
] as const;
const DARK_RAINBOW_COLORS = [
  "#ff7b72",
  "#d2a8ff",
  "#79c0ff",
  "#7ee787",
  "#f2cc60",
  "#ffa657",
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse Shiki HTML output into an array of line HTML strings.
 * Shiki wraps output in `<pre class="shiki ..."><code>` with each line
 * as `<span class="line">...</span>`.
 */
function parseShikiLines(html: string): string[] | null {
  if (typeof document === "undefined") {
    return null;
  }

  try {
    const template = document.createElement("template");
    template.innerHTML = html;
    const codeElement = template.content.querySelector("code");
    if (!codeElement) {
      return null;
    }

    const lineElements = Array.from(codeElement.children).filter(
      (child): child is HTMLSpanElement => {
        return (
          child instanceof HTMLSpanElement && child.classList.contains("line")
        );
      },
    );

    if (lineElements.length === 0) {
      return null;
    }

    return lineElements.map((lineElement) => lineElement.innerHTML);
  } catch {
    return null;
  }
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
  maxLines,
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
  query,
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
        column: foundIndex + 1,
      });
      startIndex = foundIndex + 1;
    }
  }

  return matches;
}

function resolveViewerTheme(themeMode: "system" | "dark"): ViewerTheme {
  if (themeMode === "dark") {
    return "github-dark";
  }
  return getPreferredTheme();
}

function compareBoundaries(
  left: CodeBoundaryEntry,
  right: CodeBoundaryEntry,
): number {
  if (left.startLine !== right.startLine) {
    return left.startLine - right.startLine;
  }
  if (left.endLine !== right.endLine) {
    return left.endLine - right.endLine;
  }
  return left.irNodeId.localeCompare(right.irNodeId);
}

function parseIrMarkersFromDisplayedCode({
  code,
}: {
  code: string;
}): CodeBoundaryEntry[] {
  const lines = code.split("\n");
  const entries: CodeBoundaryEntry[] = [];
  const openStack: Array<{
    irNodeId: string;
    irNodeName: string;
    irNodeType: string;
    startLine: number;
  }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const startMatch = IR_START_PATTERN.exec(line);
    if (startMatch) {
      openStack.push({
        irNodeId: startMatch[1]!,
        irNodeName: startMatch[2]!,
        irNodeType: startMatch[3]!,
        startLine: index + 1,
      });
      continue;
    }

    const endMatch = IR_END_PATTERN.exec(line);
    if (!endMatch) {
      continue;
    }

    const targetNodeId = endMatch[1]!;
    for (
      let stackIndex = openStack.length - 1;
      stackIndex >= 0;
      stackIndex -= 1
    ) {
      const candidate = openStack[stackIndex];
      if (!candidate || candidate.irNodeId !== targetNodeId) {
        continue;
      }
      openStack.splice(stackIndex, 1);
      entries.push({
        irNodeId: candidate.irNodeId,
        irNodeName: candidate.irNodeName,
        irNodeType: candidate.irNodeType,
        startLine: candidate.startLine,
        endLine: index + 1,
      });
      break;
    }
  }

  return entries.sort(compareBoundaries).map((entry) => ({
    ...entry,
    irNodeName: entry.irNodeName,
    irNodeType: entry.irNodeType,
  }));
}

function projectBoundariesToDisplay({
  boundaries,
  lineOffset,
  totalLines,
}: {
  boundaries: CodeBoundaryEntry[];
  lineOffset: number;
  totalLines: number;
}): CodeBoundaryEntry[] {
  if (boundaries.length === 0 || totalLines <= 0) {
    return [];
  }

  const projected: CodeBoundaryEntry[] = [];
  for (const entry of boundaries) {
    const startLine = entry.startLine - lineOffset + 1;
    const endLine = entry.endLine - lineOffset + 1;
    const lower = Math.min(startLine, endLine);
    const upper = Math.max(startLine, endLine);
    if (upper < 1 || lower > totalLines) {
      continue;
    }
    projected.push({
      ...entry,
      startLine: Math.max(1, lower),
      endLine: Math.min(totalLines, upper),
    });
  }

  return projected.sort(compareBoundaries);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeRenderableLineHtml(lineHtml: string): string {
  return lineHtml.length > 0 ? lineHtml : "&nbsp;";
}

function isJsxLikeLanguage(
  language: ViewerLanguage,
  filePath: string,
): boolean {
  return language === "tsx" || filePath.endsWith(".jsx");
}

function shouldTreatAsJsxTagStart(line: string, index: number): boolean {
  const after = line.slice(index + 1);
  const trimmedAfter = after.trimStart();
  const next = trimmedAfter[0] ?? "";
  if (!next || !(next === ">" || next === "/" || /[A-Za-z]/.test(next))) {
    return false;
  }

  const before = line.slice(0, index);
  const trimmedBefore = before.trimEnd();
  const prev = trimmedBefore.at(-1) ?? "";
  if (trimmedBefore.length === 0) {
    return true;
  }

  if ("=({[,!?:;>".includes(prev)) {
    return true;
  }

  if (trimmedBefore.endsWith("=>")) {
    return true;
  }

  return /\b(return|case|throw|else)$/.test(trimmedBefore);
}

function buildRainbowDecorations({
  lines,
  palette,
  allowAngleBrackets,
}: {
  lines: string[];
  palette: readonly string[];
  allowAngleBrackets: boolean;
}): Array<Map<number, RainbowDecoration>> {
  const decorations = lines.map(() => new Map<number, RainbowDecoration>());
  const stack: Array<{ closer: string; decoration: RainbowDecoration }> = [];

  const openers = new Map<string, string>([
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ]);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    const lineDecorations = decorations[lineIndex]!;

    for (let charIndex = 0; charIndex < line.length; charIndex += 1) {
      const char = line[charIndex] ?? "";

      if (openers.has(char)) {
        const depth = stack.length;
        const decoration = {
          color: palette[depth % palette.length]!,
          depth,
        };
        lineDecorations.set(charIndex, decoration);
        stack.push({
          closer: openers.get(char)!,
          decoration,
        });
        continue;
      }

      if (
        allowAngleBrackets &&
        char === "<" &&
        shouldTreatAsJsxTagStart(line, charIndex)
      ) {
        const depth = stack.length;
        const decoration = {
          color: palette[depth % palette.length]!,
          depth,
        };
        lineDecorations.set(charIndex, decoration);
        stack.push({
          closer: ">",
          decoration,
        });
        continue;
      }

      if (char === ")" || char === "]" || char === "}" || char === ">") {
        const top = stack[stack.length - 1];
        if (!top || top.closer !== char) {
          continue;
        }
        lineDecorations.set(charIndex, top.decoration);
        stack.pop();
      }
    }
  }

  return decorations;
}

function applyRainbowDecorationsToLineHtml({
  lineHtml,
  decorations,
}: {
  lineHtml: string;
  decorations: Map<number, RainbowDecoration>;
}): string {
  if (decorations.size === 0 || typeof document === "undefined") {
    return normalizeRenderableLineHtml(lineHtml);
  }

  const template = document.createElement("template");
  template.innerHTML = `<span data-rainbow-root="true">${normalizeRenderableLineHtml(lineHtml)}</span>`;
  const root = template.content.firstElementChild;
  if (!(root instanceof HTMLSpanElement)) {
    return normalizeRenderableLineHtml(lineHtml);
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let cursor = 0;
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    const current = walker.currentNode;
    if (current instanceof Text) {
      textNodes.push(current);
    }
  }

  for (const textNode of textNodes) {
    const value = textNode.data;
    if (value.length === 0) {
      continue;
    }

    let needsReplacement = false;
    for (let index = 0; index < value.length; index += 1) {
      if (decorations.has(cursor + index)) {
        needsReplacement = true;
        break;
      }
    }

    if (!needsReplacement) {
      cursor += value.length;
      continue;
    }

    const fragment = document.createDocumentFragment();
    let segmentStart = 0;

    for (let index = 0; index < value.length; index += 1) {
      const decoration = decorations.get(cursor + index);
      if (!decoration) {
        continue;
      }

      if (index > segmentStart) {
        fragment.append(
          document.createTextNode(value.slice(segmentStart, index)),
        );
      }

      const bracket = document.createElement("span");
      bracket.setAttribute(RAINBOW_BRACKET_ATTRIBUTE, "true");
      bracket.dataset.rainbowDepth = String(decoration.depth);
      bracket.style.color = decoration.color;
      bracket.textContent = value[index] ?? "";
      fragment.append(bracket);
      segmentStart = index + 1;
    }

    if (segmentStart < value.length) {
      fragment.append(document.createTextNode(value.slice(segmentStart)));
    }

    textNode.replaceWith(fragment);
    cursor += value.length;
  }

  return root.innerHTML.length > 0 ? root.innerHTML : "&nbsp;";
}

function formatPlainTextLineHtml(line: string): string {
  return normalizeRenderableLineHtml(escapeHtml(line));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CodeViewer({
  code,
  filePath,
  highlightRange,
  boundaries = [],
  boundariesEnabled,
  onBoundariesEnabledChange,
  onBoundarySelect,
  selectedIrNodeId = null,
  lineOffset = 1,
  themeMode = "system",
  allowExternalFindShortcut = false,
  onFormat,
  formatStatus: externalFormatStatus,
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
  const [internalBoundariesEnabled, setInternalBoundariesEnabled] =
    useState(false);
  const [hoveredBoundary, setHoveredBoundary] = useState<{
    boundary: CodeBoundaryWithLane;
    x: number;
    y: number;
  } | null>(null);
  const [formattedCode, setFormattedCode] = useState<string | null>(null);
  const [formatStatus, setFormatStatus] = useState<FormatStatus>({
    kind: "idle",
    message: null,
  });
  const [rainbowBracketsEnabled, setRainbowBracketsEnabled] = useState(false);
  const codeViewerRef = useRef<HTMLDivElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const formatFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const systemTheme = useSyncExternalStore(
    (onChange) => {
      if (
        typeof window === "undefined" ||
        typeof window.matchMedia !== "function"
      ) {
        return () => {};
      }

      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      mediaQuery.addEventListener("change", onChange);
      return () => {
        mediaQuery.removeEventListener("change", onChange);
      };
    },
    () => getPreferredTheme(),
    () => getPreferredTheme(),
  );
  const currentTheme = useMemo(() => {
    if (themeMode === "system") {
      return systemTheme;
    }
    return resolveViewerTheme(themeMode);
  }, [systemTheme, themeMode]);
  const usesExternalFormatting =
    onFormat !== undefined || externalFormatStatus !== undefined;
  const effectiveFormatStatus = externalFormatStatus ?? formatStatus;
  const displayCode = usesExternalFormatting ? code : (formattedCode ?? code);
  const detectedLanguage = useMemo<ViewerLanguage>(
    () => detectLanguage(filePath),
    [filePath],
  );
  const isOversize = exceedsMaxSize(displayCode);
  const rawLines = useMemo(() => displayCode.split("\n"), [displayCode]);
  const searchMode = useMemo<SearchMode>(
    () => parseSearchInput(searchInput),
    [searchInput],
  );
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

  const clearFormatFeedbackTimeout = useCallback(() => {
    if (formatFeedbackTimeoutRef.current !== null) {
      clearTimeout(formatFeedbackTimeoutRef.current);
      formatFeedbackTimeoutRef.current = null;
    }
  }, []);

  const scheduleFormatStatusReset = useCallback(
    (delayMs: number) => {
      clearFormatFeedbackTimeout();
      formatFeedbackTimeoutRef.current = setTimeout(() => {
        setFormatStatus({ kind: "idle", message: null });
        formatFeedbackTimeoutRef.current = null;
      }, delayMs);
    },
    [clearFormatFeedbackTimeout],
  );

  const scrollToLine = useCallback(
    ({
      lineNumber,
      behavior,
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
    [],
  );

  const focusFindInput = useCallback(() => {
    const input = findInputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    input.select();
  }, []);

  useEffect(() => {
    if (usesExternalFormatting) {
      setFormattedCode(null);
      return;
    }
    setFormattedCode(null);
    clearFormatFeedbackTimeout();
    setFormatStatus({ kind: "idle", message: null });
  }, [clearFormatFeedbackTimeout, code, filePath, usesExternalFormatting]);

  useEffect(() => {
    return () => {
      clearFormatFeedbackTimeout();
      if (copyTimeoutRef.current !== null) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, [clearFormatFeedbackTimeout]);

  // Run Shiki highlighting
  useEffect(() => {
    if (isOversize) {
      return;
    }

    const abortController = new AbortController();

    void highlightCodeWithWorker({
      code: displayCode,
      filePath,
      theme: currentTheme,
      signal: abortController.signal,
    })
      .then((result) => {
        if (abortController.signal.aborted) {
          return;
        }
        setHighlightState({
          result,
          forCode: displayCode,
          forFilePath: filePath,
          forTheme: currentTheme,
        });
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || abortController.signal.aborted) {
          return;
        }
        setHighlightState({
          result: null,
          forCode: displayCode,
          forFilePath: filePath,
          forTheme: currentTheme,
        });
      });

    return () => {
      abortController.abort();
    };
  }, [currentTheme, displayCode, filePath, isOversize]);

  useEffect(() => {
    lineRefs.current.clear();
  }, [displayCode, filePath]);

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
  const isFresh =
    highlightState !== null &&
    highlightState.forCode === displayCode &&
    highlightState.forFilePath === filePath &&
    highlightState.forTheme === currentTheme;
  const isHighlighting = !isOversize && !isFresh;
  const effectiveHighlightResult =
    isOversize || !isFresh ? null : highlightState.result;

  const parsedDisplayBoundaries = useMemo(() => {
    return parseIrMarkersFromDisplayedCode({
      code: displayCode,
    });
  }, [displayCode]);

  const projectedBoundaries = useMemo(() => {
    return projectBoundariesToDisplay({
      boundaries,
      lineOffset,
      totalLines: rawLines.length,
    });
  }, [boundaries, lineOffset, rawLines.length]);

  const effectiveViewerBoundaries = useMemo(() => {
    return parsedDisplayBoundaries.length > 0
      ? parsedDisplayBoundaries
      : projectedBoundaries;
  }, [parsedDisplayBoundaries, projectedBoundaries]);

  const selectedBoundary = useMemo(() => {
    if (!selectedIrNodeId) {
      return null;
    }
    return (
      effectiveViewerBoundaries.find(
        (entry) => entry.irNodeId === selectedIrNodeId,
      ) ?? null
    );
  }, [effectiveViewerBoundaries, selectedIrNodeId]);

  const effectiveHighlightRange = useMemo<HighlightRange | null>(() => {
    if (selectedBoundary) {
      return {
        startLine: selectedBoundary.startLine,
        endLine: selectedBoundary.endLine,
      };
    }
    return highlightRange ?? null;
  }, [highlightRange, selectedBoundary]);

  // Scroll to highlighted range once highlighting settles
  useEffect(() => {
    if (isFresh && effectiveHighlightRange) {
      scrollToLine({
        lineNumber: effectiveHighlightRange.startLine,
        behavior: "smooth",
      });
    }
  }, [effectiveHighlightRange, isFresh, scrollToLine]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const isTextEditableElement = (element: Element | null): boolean => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      if (element.isContentEditable) {
        return true;
      }
      if (element instanceof HTMLInputElement) {
        const inputType = element.type.toLowerCase();
        return (
          inputType !== "button" &&
          inputType !== "checkbox" &&
          inputType !== "file" &&
          inputType !== "hidden" &&
          inputType !== "image" &&
          inputType !== "radio" &&
          inputType !== "range" &&
          inputType !== "reset" &&
          inputType !== "submit"
        );
      }
      return (
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      );
    };

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
      const activeElement = document.activeElement;
      const viewerHasFocus = codeViewerRef.current.contains(activeElement);
      if (!viewerHasFocus && activeElement !== document.body) {
        if (
          !allowExternalFindShortcut ||
          isTextEditableElement(activeElement)
        ) {
          return;
        }
      }
      if (!viewerHasFocus && isTextEditableElement(activeElement)) {
        return;
      }

      event.preventDefault();
      focusFindInput();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [allowExternalFindShortcut, focusFindInput]);

  // Parse highlighted lines
  const highlightedLines = useMemo(() => {
    if (!effectiveHighlightResult) {
      return null;
    }
    return parseShikiLines(effectiveHighlightResult.html);
  }, [effectiveHighlightResult]);

  const bgColor = useMemo(() => {
    if (!effectiveHighlightResult) {
      return null;
    }
    return extractBgColor(effectiveHighlightResult.html);
  }, [effectiveHighlightResult]);

  const isDark = currentTheme === "github-dark";
  const effectiveBoundariesEnabled =
    boundariesEnabled ?? internalBoundariesEnabled;
  const rainbowPalette = isDark ? DARK_RAINBOW_COLORS : LIGHT_RAINBOW_COLORS;
  const baseLineHtmls = useMemo(() => {
    if (highlightedLines) {
      return highlightedLines.map(normalizeRenderableLineHtml);
    }
    return rawLines.map(formatPlainTextLineHtml);
  }, [highlightedLines, rawLines]);

  const renderedLineHtmls = useMemo(() => {
    if (!rainbowBracketsEnabled || isOversize) {
      return baseLineHtmls;
    }

    const decorations = buildRainbowDecorations({
      lines: rawLines,
      palette: rainbowPalette,
      allowAngleBrackets: isJsxLikeLanguage(detectedLanguage, filePath),
    });

    return baseLineHtmls.map((lineHtml, index) => {
      return applyRainbowDecorationsToLineHtml({
        lineHtml,
        decorations: decorations[index] ?? new Map<number, RainbowDecoration>(),
      });
    });
  }, [
    baseLineHtmls,
    detectedLanguage,
    filePath,
    isOversize,
    rainbowBracketsEnabled,
    rainbowPalette,
    rawLines,
  ]);

  const boundaryLayout = useMemo<
    ReturnType<typeof buildCodeBoundaryLayout>
  >(() => {
    if (!effectiveBoundariesEnabled || effectiveViewerBoundaries.length === 0) {
      return {
        boundaries: [],
        byLine: new Map<
          number,
          { visible: CodeBoundaryWithLane[]; overflowCount: number }
        >(),
      };
    }
    return buildCodeBoundaryLayout({
      entries: effectiveViewerBoundaries,
      totalLines: rawLines.length,
      isDark,
    });
  }, [
    effectiveBoundariesEnabled,
    effectiveViewerBoundaries,
    isDark,
    rawLines.length,
  ]);

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
        const next =
          (baseIndex + direction + searchMatches.length) % searchMatches.length;
        return next;
      });
    },
    [searchMatches.length, searchMode.kind],
  );

  const handleApplyLineJump = useCallback(() => {
    if (searchMode.kind !== "jump") {
      return;
    }
    const clamped = clampLineNumber({
      line: searchMode.requestedLine,
      maxLines: rawLines.length,
    });
    setJumpTargetLine(clamped);
    setActiveMatchIndex(-1);
    scrollToLine({ lineNumber: clamped, behavior: "smooth" });
  }, [rawLines.length, scrollToLine, searchMode]);

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
    [handleApplyLineJump, handleNavigateMatches, searchMode.kind],
  );

  const handleBoundariesToggle = useCallback(() => {
    const nextEnabled = !effectiveBoundariesEnabled;
    if (onBoundariesEnabledChange) {
      onBoundariesEnabledChange(nextEnabled);
      return;
    }
    setInternalBoundariesEnabled(nextEnabled);
  }, [effectiveBoundariesEnabled, onBoundariesEnabledChange]);

  const handleCopy = useCallback(async () => {
    let textToCopy = displayCode;
    if (effectiveHighlightRange) {
      const lines = displayCode.split("\n");
      textToCopy = lines
        .slice(
          effectiveHighlightRange.startLine - 1,
          effectiveHighlightRange.endLine,
        )
        .join("\n");
    }
    try {
      await navigator.clipboard.writeText(textToCopy);
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
  }, [displayCode, effectiveHighlightRange]);

  const handleFormat = useCallback(async () => {
    if (onFormat) {
      await onFormat();
      return;
    }

    setFormatStatus({ kind: "formatting", message: null });
    clearFormatFeedbackTimeout();

    try {
      const formatted = await formatCodeForViewer({
        code: displayCode,
        filePath,
        language: detectedLanguage,
      });
      setFormattedCode(formatted);
      setFormatStatus({ kind: "success", message: null });
      scheduleFormatStatusReset(FORMAT_SUCCESS_TIMEOUT_MS);
    } catch (error) {
      const message =
        error instanceof Error && error.message.length > 0
          ? error.message
          : "Formatting failed.";
      setFormatStatus({ kind: "error", message });
      scheduleFormatStatusReset(FORMAT_ERROR_TIMEOUT_MS);
    }
  }, [
    clearFormatFeedbackTimeout,
    detectedLanguage,
    displayCode,
    filePath,
    onFormat,
    scheduleFormatStatusReset,
  ]);

  useEffect(() => {
    if (!effectiveBoundariesEnabled || effectiveViewerBoundaries.length === 0) {
      setHoveredBoundary(null);
    }
  }, [effectiveBoundariesEnabled, effectiveViewerBoundaries.length]);

  const formatButtonLabel = useMemo(() => {
    if (effectiveFormatStatus.kind === "formatting") {
      return "Formatting…";
    }
    if (effectiveFormatStatus.kind === "success") {
      return "Formatted!";
    }
    return "Format";
  }, [effectiveFormatStatus.kind]);

  // Line highlight colors — runtime values that depend on isDark, cannot be static CSS
  const rangeBg = isDark
    ? "rgba(56, 139, 253, 0.15)"
    : "rgba(16, 185, 129, 0.1)";
  const searchBg = isDark
    ? "rgba(251, 191, 36, 0.12)"
    : "rgba(245, 158, 11, 0.14)";
  const stackedBg = isDark
    ? "rgba(147, 197, 253, 0.23)"
    : "rgba(16, 185, 129, 0.16)";
  const activeBg = isDark
    ? "rgba(251, 191, 36, 0.28)"
    : "rgba(245, 158, 11, 0.24)";
  const jumpBg = isDark
    ? "rgba(96, 165, 250, 0.22)"
    : "rgba(59, 130, 246, 0.2)";
  const emphasisBorder = isDark ? "#f59e0b" : "#b45309";

  // Plain-text fallback color — only applied when Shiki hasn't produced output
  const plainTextColor = isDark ? "#c9d1d9" : "#24292f";

  return (
    <div
      ref={codeViewerRef}
      className="cv-viewer flex h-full min-h-0 flex-col"
      data-theme={isDark ? "dark" : undefined}
      data-testid="code-viewer"
    >
      {/* Toolbar */}
      <div className="cv-toolbar flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        {/* File path */}
        <span
          className="cv-filepath min-w-0 flex-1 truncate text-xs font-mono"
          data-testid="code-viewer-filepath"
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
            className={`cv-find-input h-6 w-40 rounded border bg-transparent px-2 text-[10px] font-mono${searchFocused ? " cv-find-input--focused" : ""}`}
          />
          <button
            type="button"
            data-testid="code-viewer-find-prev"
            onClick={() => {
              handleNavigateMatches(-1);
            }}
            disabled={searchMode.kind !== "find" || searchMatches.length === 0}
            className="cv-toolbar-btn h-6 shrink-0 cursor-pointer rounded border px-2 py-0 text-[10px] font-semibold transition disabled:cursor-default disabled:opacity-50"
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
            className="cv-toolbar-btn h-6 shrink-0 cursor-pointer rounded border px-2 py-0 text-[10px] font-semibold transition disabled:cursor-default disabled:opacity-50"
          >
            Next
          </button>
          <span
            data-testid="code-viewer-find-count"
            className="cv-find-count w-16 text-right text-[10px] font-semibold"
          >
            {findCountText}
          </span>
        </div>

        <button
          type="button"
          data-testid="code-viewer-wrap-toggle"
          onClick={() => {
            setWordWrap((w) => !w);
          }}
          className={`cv-toolbar-btn shrink-0 cursor-pointer rounded border px-2 py-0.5 text-[10px] font-semibold transition${wordWrap ? " cv-toolbar-btn--wrap-active" : ""}`}
        >
          {wordWrap ? "Wrap: On" : "Wrap: Off"}
        </button>

        <button
          type="button"
          data-testid="code-viewer-rainbow-toggle"
          onClick={() => {
            setRainbowBracketsEnabled((enabled) => !enabled);
          }}
          className={`cv-toolbar-btn shrink-0 cursor-pointer rounded border px-2 py-0.5 text-[10px] font-semibold transition${rainbowBracketsEnabled ? " cv-toolbar-btn--rainbow-active" : ""}`}
        >
          {rainbowBracketsEnabled ? "Rainbow: On" : "Rainbow: Off"}
        </button>

        <button
          type="button"
          data-testid="code-viewer-boundaries-toggle"
          onClick={handleBoundariesToggle}
          className={`cv-toolbar-btn shrink-0 cursor-pointer rounded border px-2 py-0.5 text-[10px] font-semibold transition${effectiveBoundariesEnabled ? " cv-toolbar-btn--boundaries-active" : ""}`}
        >
          {effectiveBoundariesEnabled ? "Boundaries: On" : "Boundaries: Off"}
        </button>

        <button
          type="button"
          data-testid="code-viewer-format-button"
          onClick={() => {
            void handleFormat();
          }}
          disabled={effectiveFormatStatus.kind === "formatting"}
          className={`cv-toolbar-btn shrink-0 cursor-pointer rounded border px-2 py-0.5 text-[10px] font-semibold transition disabled:cursor-default disabled:opacity-70${effectiveFormatStatus.kind === "success" ? " cv-toolbar-btn--format-success" : ""}`}
        >
          {formatButtonLabel}
        </button>

        {effectiveFormatStatus.kind === "error" ? (
          <span
            data-testid="code-viewer-format-status"
            className="cv-format-error shrink-0 text-[10px] font-semibold"
          >
            {effectiveFormatStatus.message}
          </span>
        ) : null}

        <button
          type="button"
          data-testid="inspector-copy-button"
          onClick={() => {
            void handleCopy();
          }}
          className="cv-toolbar-btn shrink-0 cursor-pointer rounded border px-2 py-0.5 text-[10px] font-semibold transition"
        >
          {copied ? "Copied!" : effectiveHighlightRange ? "Copy Range" : "Copy"}
        </button>
      </div>

      {isOversize ? (
        <div
          className="cv-oversize-warning shrink-0 border-b px-3 py-1.5 text-xs font-medium"
          data-testid="code-viewer-oversize-warning"
        >
          File exceeds 500 KB — syntax highlighting disabled for performance.
        </div>
      ) : null}

      <div
        ref={scrollContainerRef}
        className="cv-content min-h-0 flex-1 overflow-auto p-0"
        data-testid="code-content"
        style={bgColor ? { backgroundColor: bgColor } : undefined}
      >
        {isHighlighting ? (
          <p className="cv-highlighting-indicator m-0 p-3 text-xs">
            Highlighting…
          </p>
        ) : (
          <div className="min-w-0">
            {renderedLineHtmls.map((lineHtml, index) => {
              const lineNum = index + 1;
              const displayLineNum = index + lineOffset;
              const hasSearchMatch = searchMatchedLineSet.has(lineNum);
              const isActiveMatchLine = activeMatch?.line === lineNum;
              const isJumpTargetLine = jumpTargetLine === lineNum;
              const isInRange =
                effectiveHighlightRange != null &&
                lineNum >= effectiveHighlightRange.startLine &&
                lineNum <= effectiveHighlightRange.endLine;
              const lineBoundaryDisplay = boundaryLayout.byLine.get(lineNum);
              const visibleBoundaries = lineBoundaryDisplay?.visible ?? [];
              const overflowCount = lineBoundaryDisplay?.overflowCount ?? 0;
              const hasBoundaryMarkers =
                visibleBoundaries.length > 0 || overflowCount > 0;

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
                  key={index}
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
                    borderLeft:
                      isActiveMatchLine || isJumpTargetLine
                        ? `2px solid ${emphasisBorder}`
                        : undefined,
                  }}
                >
                  {isActiveMatchLine ? (
                    <span
                      data-testid="code-viewer-active-match-line"
                      className="sr-only"
                    >
                      Active match line {lineNum}
                    </span>
                  ) : null}
                  {isJumpTargetLine ? (
                    <span
                      data-testid="code-viewer-jump-target-line"
                      className="sr-only"
                    >
                      Jump target line {lineNum}
                    </span>
                  ) : null}

                  <span
                    data-testid="line-number"
                    className="cv-line-number relative inline-flex w-14 shrink-0 pr-2 text-right select-none font-mono"
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
                                borderBottomRightRadius: isEnd ? 2 : 0,
                              }}
                              onMouseEnter={(event) => {
                                const rect =
                                  event.currentTarget.getBoundingClientRect();
                                setHoveredBoundary({
                                  boundary,
                                  x: rect.left,
                                  y: rect.top,
                                });
                              }}
                              onMouseLeave={() => {
                                setHoveredBoundary((current) => {
                                  if (
                                    !current ||
                                    current.boundary.entry.irNodeId !==
                                      boundary.entry.irNodeId
                                  ) {
                                    return current;
                                  }
                                  return null;
                                });
                              }}
                              onFocus={(event) => {
                                const rect =
                                  event.currentTarget.getBoundingClientRect();
                                setHoveredBoundary({
                                  boundary,
                                  x: rect.left,
                                  y: rect.top,
                                });
                              }}
                              onBlur={() => {
                                setHoveredBoundary((current) => {
                                  if (
                                    !current ||
                                    current.boundary.entry.irNodeId !==
                                      boundary.entry.irNodeId
                                  ) {
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
                            className="cv-overflow-indicator inline-flex items-center px-0.5 text-[8px] font-bold leading-none"
                            title={`${String(overflowCount)} more overlapping boundaries`}
                          >
                            +{String(overflowCount)}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                    <span className="inline-block w-full text-right">
                      {displayLineNum}
                    </span>
                  </span>

                  <span
                    className={`m-0 min-w-0 flex-1 font-mono ${wordWrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"}`}
                    style={
                      highlightedLines ? undefined : { color: plainTextColor }
                    }
                    dangerouslySetInnerHTML={{ __html: lineHtml }}
                  />
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
          className="cv-boundary-tooltip pointer-events-none fixed z-30 min-w-40 rounded border px-2 py-1 text-[10px] shadow-lg"
          style={{
            left: Math.max(
              8,
              Math.min(
                (typeof window === "undefined" ? 1024 : window.innerWidth) -
                  260,
                hoveredBoundary.x + 10,
              ),
            ),
            top: Math.max(8, hoveredBoundary.y - 36),
          }}
        >
          <div className="flex items-center gap-1.5">
            <span
              data-testid="code-boundary-tooltip-type"
              className="cv-boundary-tooltip-type inline-flex items-center rounded px-1 py-0.5 text-[9px] font-semibold uppercase"
            >
              {hoveredBoundary.boundary.entry.irNodeType}
            </span>
            <span
              data-testid="code-boundary-tooltip-name"
              className="truncate font-semibold"
            >
              {hoveredBoundary.boundary.entry.irNodeName}
            </span>
          </div>
          <div
            data-testid="code-boundary-tooltip-range"
            className="mt-0.5 text-[9px]"
          >
            Lines {String(hoveredBoundary.boundary.startLine + lineOffset - 1)}-
            {String(hoveredBoundary.boundary.endLine + lineOffset - 1)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
