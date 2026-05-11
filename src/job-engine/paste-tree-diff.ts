// ---------------------------------------------------------------------------
// paste-tree-diff.ts — Pure tree-diff for Figma node trees.
// Computes a `PasteDeltaPlan` by hashing subtrees and comparing against a
// prior fingerprint manifest. Powers the incremental delta-import flow:
// callers classify each paste as `baseline_created`, `no_changes`, `delta`,
// or `structural_break` (fall back to full rebuild). See issue #992.
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import type { PasteFingerprintManifest, PasteFingerprintNode } from "./paste-fingerprint-store.js";

const DEFAULT_STRUCTURAL_BREAK_THRESHOLD = 0.5;

export interface DiffableFigmaNode {
  readonly id: string;
  readonly type: string;
  readonly children?: readonly DiffableFigmaNode[];
  readonly [key: string]: unknown;
}

export type PasteDeltaStrategy =
  | "baseline_created"
  | "no_changes"
  | "delta"
  | "structural_break";

export interface PasteDeltaNodeChange {
  readonly id: string;
  readonly type: string;
  readonly kind: "added" | "removed" | "updated";
}

export interface PasteDeltaPlan {
  readonly strategy: PasteDeltaStrategy;
  readonly totalNodes: number;
  readonly reusedNodes: number;
  readonly reprocessedNodes: number;
  readonly addedNodes: readonly PasteDeltaNodeChange[];
  readonly removedNodes: readonly PasteDeltaNodeChange[];
  readonly updatedNodes: readonly PasteDeltaNodeChange[];
  readonly structuralChangeRatio: number;
  readonly currentFingerprintNodes: readonly PasteFingerprintNode[];
  readonly rootNodeIds: readonly string[];
}

export interface DiffOptions {
  /** Ratio above which we recommend full rebuild. Default 0.5. */
  readonly structuralBreakThreshold?: number;
}

const toCanonicalJsonValue = (value: unknown): unknown => {
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toCanonicalJsonValue(entry));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort((left, right) => left.localeCompare(right))) {
    const entry = toCanonicalJsonValue(record[key]);
    if (entry === undefined) {
      continue;
    }
    output[key] = entry;
  }
  return output;
};

export const computeSubtreeHash = (node: DiffableFigmaNode): string => {
  const canonical = toCanonicalJsonValue(node);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
};

const roundToThreeDecimals = (value: number): number => {
  return Math.round(value * 1000) / 1000;
};

export const buildFingerprintNodes = (roots: readonly DiffableFigmaNode[]): {
  nodes: PasteFingerprintNode[];
  rootNodeIds: string[];
} => {
  const nodes: PasteFingerprintNode[] = [];
  const seenIds = new Set<string>();
  const rootNodeIds: string[] = [];

  interface QueueEntry {
    readonly node: DiffableFigmaNode;
    readonly parentId: string | null;
    readonly depth: number;
  }

  const queue: QueueEntry[] = [];
  for (const root of roots) {
    queue.push({ node: root, parentId: null, depth: 0 });
    if (!seenIds.has(root.id)) {
      rootNodeIds.push(root.id);
    }
  }

  while (queue.length > 0) {
    const entry = queue.shift();
    if (entry === undefined) {
      continue;
    }
    const { node, parentId, depth } = entry;
    if (seenIds.has(node.id)) {
      continue;
    }
    seenIds.add(node.id);
    nodes.push({
      id: node.id,
      type: node.type,
      parentId,
      subtreeHash: computeSubtreeHash(node),
      depth
    });
    if (node.children !== undefined) {
      for (const child of node.children) {
        queue.push({ node: child, parentId: node.id, depth: depth + 1 });
      }
    }
  }

  return { nodes, rootNodeIds };
};

const toAddedAll = (nodes: readonly PasteFingerprintNode[]): PasteDeltaNodeChange[] => {
  return nodes.map((node) => ({ id: node.id, type: node.type, kind: "added" as const }));
};

const collectDescendants = (
  parentId: string,
  childrenByParent: Map<string, PasteFingerprintNode[]>,
  out: Set<string>
): void => {
  const children = childrenByParent.get(parentId);
  if (children === undefined) {
    return;
  }
  for (const child of children) {
    if (out.has(child.id)) {
      continue;
    }
    out.add(child.id);
    collectDescendants(child.id, childrenByParent, out);
  }
};

const indexChildrenByParent = (
  nodes: readonly PasteFingerprintNode[]
): Map<string, PasteFingerprintNode[]> => {
  const map = new Map<string, PasteFingerprintNode[]>();
  for (const node of nodes) {
    if (node.parentId === null) {
      continue;
    }
    const existing = map.get(node.parentId);
    if (existing === undefined) {
      map.set(node.parentId, [node]);
    } else {
      existing.push(node);
    }
  }
  return map;
};

export const diffFigmaPaste = (args: {
  priorManifest?: PasteFingerprintManifest | undefined;
  currentRoots: readonly DiffableFigmaNode[];
  options?: DiffOptions;
}): PasteDeltaPlan => {
  const threshold =
    args.options?.structuralBreakThreshold ?? DEFAULT_STRUCTURAL_BREAK_THRESHOLD;
  const { nodes: currentNodes, rootNodeIds } = buildFingerprintNodes(args.currentRoots);
  const totalNodes = currentNodes.length;

  if (args.priorManifest === undefined) {
    return {
      strategy: "baseline_created",
      totalNodes,
      reusedNodes: 0,
      reprocessedNodes: totalNodes,
      addedNodes: toAddedAll(currentNodes),
      removedNodes: [],
      updatedNodes: [],
      structuralChangeRatio: totalNodes > 0 ? 1 : 0,
      currentFingerprintNodes: currentNodes,
      rootNodeIds
    };
  }

  const priorNodes = args.priorManifest.nodes;
  const priorById = new Map<string, PasteFingerprintNode>();
  for (const node of priorNodes) {
    priorById.set(node.id, node);
  }
  const currentById = new Map<string, PasteFingerprintNode>();
  for (const node of currentNodes) {
    currentById.set(node.id, node);
  }

  const currentChildrenByParent = indexChildrenByParent(currentNodes);
  const priorChildrenByParent = indexChildrenByParent(priorNodes);

  // Classify current nodes preorder; once a node is marked `updated`, its
  // descendants are suppressed from further classification (but still appear
  // in currentFingerprintNodes). The descendants are part of the "reprocessed
  // closure" — they must be re-derived, but we count only the top-most
  // changed subtree as the unit of work.
  const updatedIds = new Set<string>();
  const addedChanges: PasteDeltaNodeChange[] = [];
  const updatedChanges: PasteDeltaNodeChange[] = [];
  const suppressedByUpdate = new Set<string>();

  const walkCurrent = (nodeId: string): void => {
    if (suppressedByUpdate.has(nodeId)) {
      // Descendant of a node already classified as updated — skip.
      return;
    }
    const current = currentById.get(nodeId);
    if (current === undefined) {
      return;
    }
    const prior = priorById.get(nodeId);
    if (prior === undefined) {
      addedChanges.push({ id: current.id, type: current.type, kind: "added" });
    } else if (prior.subtreeHash !== current.subtreeHash) {
      updatedChanges.push({ id: current.id, type: current.type, kind: "updated" });
      updatedIds.add(current.id);
      // Suppress all descendants from classification.
      const descendants = new Set<string>();
      collectDescendants(current.id, currentChildrenByParent, descendants);
      for (const descendantId of descendants) {
        suppressedByUpdate.add(descendantId);
      }
    }
    const children = currentChildrenByParent.get(nodeId);
    if (children === undefined) {
      return;
    }
    for (const child of children) {
      walkCurrent(child.id);
    }
  };

  for (const rootId of rootNodeIds) {
    walkCurrent(rootId);
  }

  // Removed: prior nodes absent from current, with highest-ancestor dedup.
  const removedChanges: PasteDeltaNodeChange[] = [];
  const suppressedByRemoval = new Set<string>();
  const priorRootIds: string[] = [];
  for (const node of priorNodes) {
    if (node.parentId === null) {
      priorRootIds.push(node.id);
    }
  }

  const walkPriorForRemoval = (nodeId: string): void => {
    if (suppressedByRemoval.has(nodeId)) {
      return;
    }
    const prior = priorById.get(nodeId);
    if (prior === undefined) {
      return;
    }
    if (!currentById.has(nodeId)) {
      removedChanges.push({ id: prior.id, type: prior.type, kind: "removed" });
      const descendants = new Set<string>();
      collectDescendants(nodeId, priorChildrenByParent, descendants);
      for (const descendantId of descendants) {
        suppressedByRemoval.add(descendantId);
      }
      return;
    }
    const children = priorChildrenByParent.get(nodeId);
    if (children === undefined) {
      return;
    }
    for (const child of children) {
      walkPriorForRemoval(child.id);
    }
  };

  for (const rootId of priorRootIds) {
    walkPriorForRemoval(rootId);
  }

  const changeCount = addedChanges.length + removedChanges.length + updatedChanges.length;
  const denominator = Math.max(priorNodes.length, totalNodes, 1);
  const structuralChangeRatio = roundToThreeDecimals(changeCount / denominator);

  // Reprocessed closure = added ∪ updated ∪ (descendants of updated).
  const reprocessedIds = new Set<string>();
  for (const change of addedChanges) {
    reprocessedIds.add(change.id);
  }
  for (const change of updatedChanges) {
    reprocessedIds.add(change.id);
    const descendants = new Set<string>();
    collectDescendants(change.id, currentChildrenByParent, descendants);
    for (const descendantId of descendants) {
      reprocessedIds.add(descendantId);
    }
  }
  const reprocessedNodes = Array.from(reprocessedIds).filter((id) => currentById.has(id)).length;
  const reusedNodes = totalNodes - reprocessedNodes;

  let strategy: PasteDeltaStrategy;
  if (changeCount === 0) {
    strategy = "no_changes";
  } else if (structuralChangeRatio > threshold) {
    strategy = "structural_break";
  } else {
    strategy = "delta";
  }

  return {
    strategy,
    totalNodes,
    reusedNodes,
    reprocessedNodes,
    addedNodes: addedChanges,
    removedNodes: removedChanges,
    updatedNodes: updatedChanges,
    structuralChangeRatio,
    currentFingerprintNodes: currentNodes,
    rootNodeIds
  };
};
