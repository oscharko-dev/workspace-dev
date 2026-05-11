/**
 * Pure client-side diff between two design-IR snapshots, used by the re-import
 * flow for issue #1010 to:
 * - drive the "Changed components" scope preset
 * - render added / removed / modified / unchanged status colors in the tree
 */

export type IrNodeDiffStatus = "added" | "removed" | "modified" | "unchanged";

export interface IrDiffNode {
  readonly id: string;
  readonly name?: string;
  readonly type?: string;
  readonly children?: readonly IrDiffNode[] | undefined;
  readonly [key: string]: unknown;
}

export interface IrDiffScreen {
  readonly id: string;
  readonly name: string;
  readonly children: readonly IrDiffNode[];
}

export interface IrDiffTree {
  readonly screens: readonly IrDiffScreen[];
}

export interface IrDiffResult {
  readonly statusByNodeId: ReadonlyMap<string, IrNodeDiffStatus>;
  readonly addedNodeIds: readonly string[];
  readonly removedNodeIds: readonly string[];
  readonly modifiedNodeIds: readonly string[];
  readonly unchangedNodeIds: readonly string[];
}

const STRUCTURAL_FIELD_BLOCKLIST = new Set<string>(["children"]);

function indexById(
  tree: IrDiffTree,
): Map<string, { node: IrDiffNode; isScreen: boolean }> {
  const index = new Map<string, { node: IrDiffNode; isScreen: boolean }>();
  const walk = (nodes: readonly IrDiffNode[]): void => {
    for (const node of nodes) {
      if (typeof node.id !== "string" || node.id.length === 0) {
        continue;
      }
      if (!index.has(node.id)) {
        index.set(node.id, { node, isScreen: false });
      }
      if (node.children && node.children.length > 0) {
        walk(node.children);
      }
    }
  };
  for (const screen of tree.screens) {
    if (typeof screen.id !== "string" || screen.id.length === 0) {
      continue;
    }
    index.set(screen.id, {
      node: { id: screen.id, name: screen.name, children: screen.children },
      isScreen: true,
    });
    walk(screen.children);
  }
  return index;
}

function isShallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (a === null || b === null || typeof a !== "object") {
    return false;
  }
  const ak = Object.keys(a as Record<string, unknown>);
  const bk = Object.keys(b as Record<string, unknown>);
  if (ak.length !== bk.length) {
    return false;
  }
  for (const key of ak) {
    if (
      (a as Record<string, unknown>)[key] !==
      (b as Record<string, unknown>)[key]
    ) {
      return false;
    }
  }
  return true;
}

function isModified(a: IrDiffNode, b: IrDiffNode): boolean {
  for (const key of Object.keys(a)) {
    if (STRUCTURAL_FIELD_BLOCKLIST.has(key)) {
      continue;
    }
    if (!isShallowEqual(a[key], (b as Record<string, unknown>)[key])) {
      return true;
    }
  }
  for (const key of Object.keys(b)) {
    if (STRUCTURAL_FIELD_BLOCKLIST.has(key)) {
      continue;
    }
    if (!(key in a)) {
      return true;
    }
  }
  return false;
}

/**
 * Diff two design-IR trees by node id. Nodes present only in `current` are
 * "added"; only in `previous` are "removed"; in both with any property change
 * (excluding `children`) are "modified"; otherwise "unchanged".
 */
export function diffDesignIrTrees(
  current: IrDiffTree,
  previous: IrDiffTree,
): IrDiffResult {
  const currentIndex = indexById(current);
  const previousIndex = indexById(previous);
  const statusByNodeId = new Map<string, IrNodeDiffStatus>();
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  const unchanged: string[] = [];

  for (const [id, entry] of currentIndex) {
    const prior = previousIndex.get(id);
    if (!prior) {
      statusByNodeId.set(id, "added");
      added.push(id);
      continue;
    }
    if (isModified(entry.node, prior.node)) {
      statusByNodeId.set(id, "modified");
      modified.push(id);
    } else {
      statusByNodeId.set(id, "unchanged");
      unchanged.push(id);
    }
  }
  for (const [id] of previousIndex) {
    if (!currentIndex.has(id)) {
      statusByNodeId.set(id, "removed");
      removed.push(id);
    }
  }

  return {
    statusByNodeId,
    addedNodeIds: added,
    removedNodeIds: removed,
    modifiedNodeIds: modified,
    unchangedNodeIds: unchanged,
  };
}
