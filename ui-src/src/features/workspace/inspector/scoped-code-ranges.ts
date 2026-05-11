/**
 * Scoped code range derivation for Inspector code viewing modes.
 *
 * Given a manifest mapping (file + startLine/endLine), derives the effective
 * content and line ranges for three code viewing modes:
 *
 * - **Snippet**: Only the manifest range ± context lines.
 * - **Focused file**: Full file content with a highlight range for the manifest region.
 * - **Full file**: Full file content with no range restriction.
 *
 * Also handles diff scenarios where old and new content may have independent
 * line offsets and range anchoring.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/444
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScopedCodeMode = "snippet" | "focused" | "full";

export interface ManifestRange {
  startLine: number;
  endLine: number;
}

export interface ScopedCodeResult {
  /** The (possibly sliced) code to display. */
  code: string;
  /** Highlight range within the returned code (1-based). Null when no range. */
  highlightRange: { startLine: number; endLine: number } | null;
  /** The 1-based offset of the first line in the returned code relative to the full file. */
  lineOffset: number;
  /** Total lines in the returned code. */
  totalLines: number;
}

export interface ScopedDiffRanges {
  /** Focus range for the old (previous) side of the diff. Null = show all. */
  oldFocusRange: ManifestRange | null;
  /** Focus range for the new (current) side of the diff. Null = show all. */
  newFocusRange: ManifestRange | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of context lines shown above/below the snippet range. */
export const SNIPPET_CONTEXT_LINES = 2;
const IR_START_PATTERN = /\{\/\* @ir:start (\S+) (.+?) (\S+?)(?: extracted)? \*\/\}/;
const IR_END_PATTERN = /\{\/\* @ir:end (\S+) \*\/\}/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampLine(line: number, totalLines: number): number {
  if (!Number.isFinite(line)) {
    return 1;
  }
  return Math.max(1, Math.min(totalLines, Math.floor(line)));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Determine the effective code mode when no manifest mapping exists.
 * Returns "full" — the only valid mode for unmapped nodes.
 */
export function fallbackMode(): ScopedCodeMode {
  return "full";
}

/**
 * Determine the default code mode when a manifest mapping exists.
 * Returns "snippet" as the most focused default.
 */
export function defaultMappedMode(): ScopedCodeMode {
  return "snippet";
}

/**
 * Derive scoped code content for a given mode.
 *
 * @param fullCode      Complete file content.
 * @param mode          Active code viewing mode.
 * @param manifestRange Manifest line range (1-based). Null for unmapped nodes.
 * @returns Scoped code result with content, highlight, and line offset.
 */
export function deriveScopedCode(
  fullCode: string,
  mode: ScopedCodeMode,
  manifestRange: ManifestRange | null
): ScopedCodeResult {
  const allLines = fullCode.split("\n");
  const totalLines = allLines.length;

  // No manifest — always full file
  if (!manifestRange) {
    return {
      code: fullCode,
      highlightRange: null,
      lineOffset: 1,
      totalLines
    };
  }

  const clampedStart = clampLine(manifestRange.startLine, totalLines);
  const clampedEnd = clampLine(manifestRange.endLine, totalLines);

  switch (mode) {
    case "snippet": {
      const snippetStart = clampLine(clampedStart - SNIPPET_CONTEXT_LINES, totalLines);
      const snippetEnd = clampLine(clampedEnd + SNIPPET_CONTEXT_LINES, totalLines);
      const slicedLines = allLines.slice(snippetStart - 1, snippetEnd);
      const highlightStartInSlice = clampedStart - snippetStart + 1;
      const highlightEndInSlice = clampedEnd - snippetStart + 1;

      return {
        code: slicedLines.join("\n"),
        highlightRange: {
          startLine: highlightStartInSlice,
          endLine: highlightEndInSlice
        },
        lineOffset: snippetStart,
        totalLines: slicedLines.length
      };
    }

    case "focused": {
      return {
        code: fullCode,
        highlightRange: {
          startLine: clampedStart,
          endLine: clampedEnd
        },
        lineOffset: 1,
        totalLines
      };
    }

    case "full": {
      return {
        code: fullCode,
        highlightRange: null,
        lineOffset: 1,
        totalLines
      };
    }
  }
}

export function findManifestRangeByIrNodeId(
  fullCode: string,
  irNodeId: string
): ManifestRange | null {
  const lines = fullCode.split("\n");
  const openStack: Array<{
    irNodeId: string;
    startLine: number;
  }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const startMatch = IR_START_PATTERN.exec(line);
    if (startMatch) {
      openStack.push({
        irNodeId: startMatch[1]!,
        startLine: index + 1
      });
      continue;
    }

    const endMatch = IR_END_PATTERN.exec(line);
    if (!endMatch) {
      continue;
    }

    const endIrNodeId = endMatch[1]!;
    let stackIndex = -1;
    for (let reverseIndex = openStack.length - 1; reverseIndex >= 0; reverseIndex -= 1) {
      if (openStack[reverseIndex]?.irNodeId === endIrNodeId) {
        stackIndex = reverseIndex;
        break;
      }
    }
    if (stackIndex < 0) {
      continue;
    }

    const [startEntry] = openStack.splice(stackIndex, 1);
    if (!startEntry || startEntry.irNodeId !== irNodeId) {
      continue;
    }

    return {
      startLine: startEntry.startLine,
      endLine: index + 1
    };
  }

  return null;
}

/**
 * Derive independent focus ranges for old and new sides of a diff.
 *
 * In diff mode, the old (previous job) and new (current job) content may
 * reference different files and/or have different line offsets. This function
 * returns the appropriate range for each side based on the active mode.
 *
 * @param mode             Active code viewing mode.
 * @param currentRange     Manifest range for the current (new) file.
 * @param previousRange    Manifest range for the previous (old) file.
 * @returns Independent focus ranges for each diff side.
 */
export function deriveScopedDiffRanges(
  mode: ScopedCodeMode,
  currentRange: ManifestRange | null,
  previousRange: ManifestRange | null
): ScopedDiffRanges {
  if (mode === "full") {
    return { oldFocusRange: null, newFocusRange: null };
  }

  // For snippet and focused modes, use the manifest ranges when available
  return {
    oldFocusRange: previousRange ?? null,
    newFocusRange: currentRange ?? null
  };
}

/**
 * Check whether a given mode is available for a node.
 * Unmapped nodes can only use "full" mode.
 */
export function isModeAvailable(
  mode: ScopedCodeMode,
  isMapped: boolean
): boolean {
  if (!isMapped) {
    return mode === "full";
  }
  return true;
}

/**
 * Returns the ordered list of available modes for a node.
 */
export function getAvailableModes(isMapped: boolean): ScopedCodeMode[] {
  if (!isMapped) {
    return ["full"];
  }
  return ["snippet", "focused", "full"];
}

/**
 * Human-readable label for each mode.
 */
export function modeLabel(mode: ScopedCodeMode): string {
  switch (mode) {
    case "snippet":
      return "Snippet";
    case "focused":
      return "Focused file";
    case "full":
      return "Full file";
  }
}
