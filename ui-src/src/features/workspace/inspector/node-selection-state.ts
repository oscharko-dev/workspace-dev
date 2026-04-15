/**
 * Pure tri-state selection model for the Inspector component tree.
 *
 * Backs the multi-selection scope controls. Selection is stored as a
 * `Set<string>` of explicitly excluded node ids (default = all selected),
 * which makes "Select All" trivial and tri-state derivation a depth-first
 * walk against `excluded`. Skeleton nodes (`type === "skeleton"`) are
 * ignored: never counted, never selectable.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/1010
 */

import type { TreeNode } from "./component-tree";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NodeCheckState = "checked" | "partial" | "unchecked";

/** Default = all selected. The set holds ids the user has explicitly excluded. */
export interface NodeSelectionState {
  readonly excluded: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Constants & factories
// ---------------------------------------------------------------------------

const SKELETON_TYPE = "skeleton";

export const EMPTY_SELECTION: NodeSelectionState = {
  excluded: new Set<string>(),
};

export function createSelectionWithAllSelected(): NodeSelectionState {
  return EMPTY_SELECTION;
}

// ---------------------------------------------------------------------------
// Internal walk helpers
// ---------------------------------------------------------------------------

function isSkeleton(node: TreeNode): boolean {
  return node.type === SKELETON_TYPE;
}

/** Calls `visit` for every non-skeleton descendant of `node`, including `node` itself. */
function walkSubtree(node: TreeNode, visit: (n: TreeNode) => void): void {
  if (isSkeleton(node)) return;
  visit(node);
  const children = node.children;
  if (!children) return;
  for (const child of children) {
    walkSubtree(child, visit);
  }
}

/** Calls `visit` for every non-skeleton node across `screens`. */
function walkForest(
  screens: readonly TreeNode[],
  visit: (n: TreeNode) => void,
): void {
  for (const screen of screens) {
    walkSubtree(screen, visit);
  }
}

interface SubtreeTally {
  readonly total: number;
  readonly excluded: number;
}

function tallySubtree(
  node: TreeNode,
  excluded: ReadonlySet<string>,
): SubtreeTally {
  let total = 0;
  let excludedCount = 0;
  walkSubtree(node, (n) => {
    total += 1;
    if (excluded.has(n.id)) {
      excludedCount += 1;
    }
  });
  return { total, excluded: excludedCount };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** True when nothing is excluded. */
export function isAllSelected(state: NodeSelectionState): boolean {
  return state.excluded.size === 0;
}

/** True when the entire tree is excluded. */
export function isNoneSelected(
  state: NodeSelectionState,
  screens: readonly TreeNode[],
): boolean {
  if (screens.length === 0) {
    return false;
  }
  const counts = getSelectionCounts(state, screens);
  return counts.total > 0 && counts.selected === 0;
}

/** Returns the tri-state for a node, walking its subtree against `excluded`. */
export function getNodeCheckState(
  state: NodeSelectionState,
  node: TreeNode,
): NodeCheckState {
  const tally = tallySubtree(node, state.excluded);
  if (tally.total === 0) return "checked";
  if (tally.excluded === 0) return "checked";
  if (tally.excluded === tally.total) return "unchecked";
  return "partial";
}

/**
 * One-pass post-order build of the tri-state map for an entire forest.
 * Replaces O(n^2) per-row `getNodeCheckState` lookups with O(n) total.
 */
export function buildCheckStateMap(
  state: NodeSelectionState,
  screens: readonly TreeNode[],
): ReadonlyMap<string, NodeCheckState> {
  const result = new Map<string, NodeCheckState>();

  const visit = (node: TreeNode): { total: number; excluded: number } => {
    if (isSkeleton(node)) {
      return { total: 0, excluded: 0 };
    }
    let total = 1;
    let excluded = state.excluded.has(node.id) ? 1 : 0;
    if (node.children) {
      for (const child of node.children) {
        const childTally = visit(child);
        total += childTally.total;
        excluded += childTally.excluded;
      }
    }
    let nodeState: NodeCheckState;
    if (total === 0 || excluded === 0) {
      nodeState = "checked";
    } else if (excluded === total) {
      nodeState = "unchecked";
    } else {
      nodeState = "partial";
    }
    result.set(node.id, nodeState);
    return { total, excluded };
  };

  for (const screen of screens) {
    visit(screen);
  }

  return result;
}

/**
 * All selected ids visible in `screens` (post-filter). Used to build the
 * submit body. Order = depth-first traversal.
 */
export function getSelectedNodeIds(
  state: NodeSelectionState,
  screens: readonly TreeNode[],
): string[] {
  const out: string[] = [];
  walkForest(screens, (n) => {
    if (!state.excluded.has(n.id)) {
      out.push(n.id);
    }
  });
  return out;
}

/** Top-level screens whose entire subtree is at least partially selected. */
export function getSelectedScreens(
  state: NodeSelectionState,
  screens: readonly TreeNode[],
): TreeNode[] {
  const out: TreeNode[] = [];
  for (const screen of screens) {
    if (getNodeCheckState(state, screen) !== "unchecked") {
      out.push(screen);
    }
  }
  return out;
}

/** Number of leaves selected and total leaf count, e.g. for a "12 of 30 components" label. */
export function getSelectionCounts(
  state: NodeSelectionState,
  screens: readonly TreeNode[],
): { selected: number; total: number } {
  let total = 0;
  let selected = 0;
  walkForest(screens, (n) => {
    total += 1;
    if (!state.excluded.has(n.id)) {
      selected += 1;
    }
  });
  return { selected, total };
}

// ---------------------------------------------------------------------------
// Mutations (pure — return new state)
// ---------------------------------------------------------------------------

/** Toggle a node and propagate to descendants; returns a new state. */
export function toggleNode(
  state: NodeSelectionState,
  node: TreeNode,
  nextSelected: boolean,
): NodeSelectionState {
  if (isSkeleton(node)) return state;

  const next = new Set(state.excluded);
  if (nextSelected) {
    walkSubtree(node, (n) => {
      next.delete(n.id);
    });
  } else {
    walkSubtree(node, (n) => {
      next.add(n.id);
    });
  }
  return { excluded: next };
}

/** Select every leaf under the given screens. */
export function selectAll(): NodeSelectionState {
  return EMPTY_SELECTION;
}

/** Exclude every node under the given screens. */
export function deselectAll(screens: readonly TreeNode[]): NodeSelectionState {
  const excluded = new Set<string>();
  walkForest(screens, (n) => {
    excluded.add(n.id);
  });
  return { excluded };
}

// ---------------------------------------------------------------------------
// Scope presets
// ---------------------------------------------------------------------------

/**
 * "Single component" — select only this node (and its descendants, since
 * selecting a parent implies all children). Everything else excluded.
 */
export function selectOnlyNode(
  node: TreeNode,
  screens: readonly TreeNode[],
): NodeSelectionState {
  const excluded = new Set<string>();
  walkForest(screens, (n) => {
    excluded.add(n.id);
  });
  if (!isSkeleton(node)) {
    walkSubtree(node, (n) => {
      excluded.delete(n.id);
    });
  }
  return { excluded };
}

/**
 * "Component + children" — same as selectOnlyNode in this model. Provided as
 * an alias for clarity at call sites.
 */
export function selectSubtree(
  node: TreeNode,
  screens: readonly TreeNode[],
): NodeSelectionState {
  return selectOnlyNode(node, screens);
}

/**
 * "All screens" — select every top-level screen (and all descendants).
 * Equivalent to selectAll() in this model.
 */
export function selectAllScreens(): NodeSelectionState {
  return EMPTY_SELECTION;
}

/** "Changed components" — select only the ids present in `changedNodeIds`. */
export function selectChangedNodes(
  changedNodeIds: readonly string[],
  screens: readonly TreeNode[],
): NodeSelectionState {
  const keep = new Set<string>(changedNodeIds);
  const excluded = new Set<string>();
  walkForest(screens, (n) => {
    if (!keep.has(n.id)) {
      excluded.add(n.id);
    }
  });
  return { excluded };
}
