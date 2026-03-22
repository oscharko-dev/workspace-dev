/**
 * Client-side unified diff computation using the Myers diff algorithm.
 *
 * Zero external dependencies — air-gap safe.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/434
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiffLineKind = "context" | "added" | "removed";

export interface DiffLine {
  kind: DiffLineKind;
  /** Content of the line (without trailing newline). */
  content: string;
  /** 1-based line number in the old (previous) file. `null` for added lines. */
  oldLineNumber: number | null;
  /** 1-based line number in the new (current) file. `null` for removed lines. */
  newLineNumber: number | null;
}

export interface DiffResult {
  lines: DiffLine[];
  /** Number of added lines. */
  addedCount: number;
  /** Number of removed lines. */
  removedCount: number;
  /** True when old and new are identical. */
  isIdentical: boolean;
}

// ---------------------------------------------------------------------------
// Myers diff – shortest edit script (SES)
// ---------------------------------------------------------------------------

type EditOp = "keep" | "insert" | "delete";

interface EditStep {
  op: EditOp;
  oldIndex: number;
  newIndex: number;
}

/**
 * Compute the shortest edit script between two string arrays using the
 * classic Myers O(ND) algorithm.
 *
 * Returns an ordered list of edit operations.
 */
function myersDiff(oldLines: string[], newLines: string[]): EditStep[] {
  const n = oldLines.length;
  const m = newLines.length;
  const max = n + m;

  if (max === 0) {
    return [];
  }

  // V stores the best x-position for each k-diagonal.
  // We shift k by `max` so that negative diagonals map to valid indices.
  const size = 2 * max + 1;
  const v = new Int32Array(size);
  v.fill(0);

  // Trace stores a copy of V at each step d so we can reconstruct the path.
  const trace: Int32Array[] = [];

  outer:
  for (let d = 0; d <= max; d += 1) {
    const snapshot = new Int32Array(v);
    trace.push(snapshot);

    for (let k = -d; k <= d; k += 2) {
      const kOffset = k + max;

      let x: number;
      if (k === -d || (k !== d && v[kOffset - 1]! < v[kOffset + 1]!)) {
        x = v[kOffset + 1]!;
      } else {
        x = v[kOffset - 1]! + 1;
      }

      let y = x - k;

      // Follow diagonal (matching lines)
      while (x < n && y < m && oldLines[x] === newLines[y]) {
        x += 1;
        y += 1;
      }

      v[kOffset] = x;

      if (x >= n && y >= m) {
        break outer;
      }
    }
  }

  // Backtrack to reconstruct edit operations
  const ops: EditStep[] = [];
  let cx = n;
  let cy = m;

  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const tv = trace[d]!;
    const k = cx - cy;
    const kOffset = k + max;

    let prevK: number;
    if (k === -d || (k !== d && tv[kOffset - 1]! < tv[kOffset + 1]!)) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevKOffset = prevK + max;
    let prevX = tv[prevKOffset]!;
    let prevY = prevX - prevK;

    // Diagonal moves first (these are "keep" operations)
    while (cx > prevX && cy > prevY) {
      cx -= 1;
      cy -= 1;
      ops.push({ op: "keep", oldIndex: cx, newIndex: cy });
    }

    if (d > 0) {
      if (cx === prevX) {
        // Moved down → insert
        cy -= 1;
        ops.push({ op: "insert", oldIndex: cx, newIndex: cy });
      } else {
        // Moved right → delete
        cx -= 1;
        ops.push({ op: "delete", oldIndex: cx, newIndex: cy });
      }
    }
  }

  ops.reverse();
  return ops;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a unified diff between two strings.
 *
 * @param oldText - Previous file content (empty string for new files).
 * @param newText - Current file content.
 * @param contextLines - Number of unchanged context lines around each hunk (default 3).
 */
export function computeUnifiedDiff(
  oldText: string,
  newText: string,
  contextLines: number = 3
): DiffResult {
  if (oldText === newText) {
    const lines = oldText.split("\n");
    return {
      lines: lines.map((content, i) => ({
        kind: "context" as const,
        content,
        oldLineNumber: i + 1,
        newLineNumber: i + 1
      })),
      addedCount: 0,
      removedCount: 0,
      isIdentical: true
    };
  }

  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const ops = myersDiff(oldLines, newLines);

  // Convert edit operations to DiffLine[]
  const rawDiffLines: DiffLine[] = [];
  let addedCount = 0;
  let removedCount = 0;

  for (const step of ops) {
    switch (step.op) {
      case "keep":
        rawDiffLines.push({
          kind: "context",
          content: oldLines[step.oldIndex] ?? "",
          oldLineNumber: step.oldIndex + 1,
          newLineNumber: step.newIndex + 1
        });
        break;
      case "delete":
        rawDiffLines.push({
          kind: "removed",
          content: oldLines[step.oldIndex] ?? "",
          oldLineNumber: step.oldIndex + 1,
          newLineNumber: null
        });
        removedCount += 1;
        break;
      case "insert":
        rawDiffLines.push({
          kind: "added",
          content: newLines[step.newIndex] ?? "",
          oldLineNumber: null,
          newLineNumber: step.newIndex + 1
        });
        addedCount += 1;
        break;
    }
  }

  // Apply context filtering: only show context lines within `contextLines` of a change
  if (contextLines < 0) {
    // Negative → show all lines
    return { lines: rawDiffLines, addedCount, removedCount, isIdentical: false };
  }

  const changeIndices = new Set<number>();
  for (let i = 0; i < rawDiffLines.length; i += 1) {
    if (rawDiffLines[i]!.kind !== "context") {
      changeIndices.add(i);
    }
  }

  const visibleIndices = new Set<number>();
  for (const idx of changeIndices) {
    for (let offset = -contextLines; offset <= contextLines; offset += 1) {
      const target = idx + offset;
      if (target >= 0 && target < rawDiffLines.length) {
        visibleIndices.add(target);
      }
    }
  }

  const filteredLines: DiffLine[] = [];
  for (let i = 0; i < rawDiffLines.length; i += 1) {
    if (visibleIndices.has(i)) {
      filteredLines.push(rawDiffLines[i]!);
    }
  }

  return { lines: filteredLines, addedCount, removedCount, isIdentical: false };
}
