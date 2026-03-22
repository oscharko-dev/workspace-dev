/**
 * Bounded undo/redo history for Inspector override draft edit actions.
 *
 * Tracks draft state snapshots in a linear history stack with a configurable
 * maximum depth. Pushing a new state while not at the tip of the history
 * truncates any forward (redo) entries. The stack is entirely in-memory and
 * does not interfere with navigation history from inspector-scope-state.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/460
 */

import type { InspectorOverrideDraft } from "./inspector-override-draft";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default maximum number of undo states retained. */
export const DEFAULT_MAX_EDIT_HISTORY = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Immutable snapshot of the edit history stack. */
export interface InspectorEditHistory {
  /** Ordered list of draft snapshots (index 0 = oldest). */
  readonly stack: readonly InspectorOverrideDraft[];

  /** Index of the currently active state within `stack`. */
  readonly cursor: number;

  /** Maximum number of entries the stack may hold. */
  readonly maxEntries: number;
}

export interface EditHistoryUndoResult {
  history: InspectorEditHistory;
  draft: InspectorOverrideDraft | null;
}

export interface EditHistoryRedoResult {
  history: InspectorEditHistory;
  draft: InspectorOverrideDraft | null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a new empty edit history. If an initial draft is provided it becomes
 * the first (and current) entry on the stack.
 */
export function createEditHistory(
  options?: {
    initialDraft?: InspectorOverrideDraft;
    maxEntries?: number;
  }
): InspectorEditHistory {
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_EDIT_HISTORY;
  if (maxEntries < 1) {
    throw new RangeError("maxEntries must be >= 1");
  }

  if (options?.initialDraft) {
    return {
      stack: [options.initialDraft],
      cursor: 0,
      maxEntries
    };
  }

  return {
    stack: [],
    cursor: -1,
    maxEntries
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Pushes a new draft snapshot onto the history stack.
 *
 * - Truncates any forward (redo) entries beyond the current cursor.
 * - If the stack exceeds `maxEntries`, the oldest entry is evicted.
 * - Returns the updated history.
 */
export function pushEditHistory(
  history: InspectorEditHistory,
  draft: InspectorOverrideDraft
): InspectorEditHistory {
  // Truncate forward entries
  const base = history.stack.slice(0, history.cursor + 1);
  const next = [...base, draft];

  // Evict oldest if over limit
  if (next.length > history.maxEntries) {
    const trimmed = next.slice(next.length - history.maxEntries);
    return {
      stack: trimmed,
      cursor: trimmed.length - 1,
      maxEntries: history.maxEntries
    };
  }

  return {
    stack: next,
    cursor: next.length - 1,
    maxEntries: history.maxEntries
  };
}

/**
 * Moves the cursor back one step (undo). Returns the draft at the new cursor
 * position, or null if undo is not possible.
 */
export function undoEditHistory(
  history: InspectorEditHistory
): EditHistoryUndoResult {
  if (!canUndo(history)) {
    return { history, draft: null };
  }

  const nextCursor = history.cursor - 1;
  const nextHistory: InspectorEditHistory = {
    ...history,
    cursor: nextCursor
  };

  return {
    history: nextHistory,
    draft: history.stack[nextCursor] ?? null
  };
}

/**
 * Moves the cursor forward one step (redo). Returns the draft at the new
 * cursor position, or null if redo is not possible.
 */
export function redoEditHistory(
  history: InspectorEditHistory
): EditHistoryRedoResult {
  if (!canRedo(history)) {
    return { history, draft: null };
  }

  const nextCursor = history.cursor + 1;
  const nextHistory: InspectorEditHistory = {
    ...history,
    cursor: nextCursor
  };

  return {
    history: nextHistory,
    draft: history.stack[nextCursor] ?? null
  };
}

/**
 * Resets the history stack, optionally seeding with a new initial draft.
 */
export function clearEditHistory(
  history: InspectorEditHistory,
  initialDraft?: InspectorOverrideDraft
): InspectorEditHistory {
  if (initialDraft) {
    return {
      stack: [initialDraft],
      cursor: 0,
      maxEntries: history.maxEntries
    };
  }

  return {
    stack: [],
    cursor: -1,
    maxEntries: history.maxEntries
  };
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** Whether an undo step is available. */
export function canUndo(history: InspectorEditHistory): boolean {
  return history.cursor > 0;
}

/** Whether a redo step is available. */
export function canRedo(history: InspectorEditHistory): boolean {
  return history.cursor < history.stack.length - 1;
}

/** Returns the draft at the current cursor, or null if the stack is empty. */
export function currentEditHistoryDraft(
  history: InspectorEditHistory
): InspectorOverrideDraft | null {
  if (history.cursor < 0 || history.cursor >= history.stack.length) {
    return null;
  }
  return history.stack[history.cursor] ?? null;
}

/** Number of undo steps available from the current cursor. */
export function undoDepth(history: InspectorEditHistory): number {
  return Math.max(0, history.cursor);
}

/** Number of redo steps available from the current cursor. */
export function redoDepth(history: InspectorEditHistory): number {
  return Math.max(0, history.stack.length - 1 - history.cursor);
}
