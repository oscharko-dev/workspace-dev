import { useMemo } from "react";
import type { TreeNode } from "./component-tree";
import type { PastePipelineState } from "./paste-pipeline";

export interface BreadcrumbSegment {
  id: string;
  name: string;
  type: string;
}

/**
 * Find the path from the root of the tree to the node with the given `targetId`.
 *
 * Returns an array of `BreadcrumbSegment` objects representing each ancestor
 * from the root screen down to (and including) the target node.
 * Returns an empty array if the target is not found.
 */
export function findNodePath(
  nodes: TreeNode[],
  targetId: string,
): BreadcrumbSegment[] {
  const path: BreadcrumbSegment[] = [];

  function walk(list: TreeNode[]): boolean {
    for (const node of list) {
      path.push({ id: node.id, name: node.name, type: node.type });

      if (node.id === targetId) {
        return true;
      }

      if (node.children && node.children.length > 0) {
        if (walk(node.children)) {
          return true;
        }
      }

      path.pop();
    }
    return false;
  }

  walk(nodes);
  return path;
}

/**
 * Filter tree nodes, keeping parent paths when a descendant matches.
 */
export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query.trim()) {
    return nodes;
  }
  const lower = query.toLowerCase();

  function matches(node: TreeNode): boolean {
    return node.name.toLowerCase().includes(lower);
  }

  function prune(list: TreeNode[]): TreeNode[] {
    const kept: TreeNode[] = [];
    for (const node of list) {
      if (matches(node)) {
        // Include the node with all its children (matched directly)
        kept.push(node);
      } else if (node.children && node.children.length > 0) {
        // Check if any descendant matches — keep parent path
        const filteredChildren = prune(node.children);
        if (filteredChildren.length > 0) {
          kept.push({ ...node, children: filteredChildren });
        }
      }
    }
    return kept;
  }

  return prune(nodes);
}

const SKELETON_NODE_COUNT = 3;

function makeSkeletonChildren(parentId: string): TreeNode[] {
  return Array.from({ length: SKELETON_NODE_COUNT }, (_, i) => ({
    id: `skeleton-${parentId}-${String(i)}`,
    name: "",
    type: "skeleton",
  }));
}

interface IrElementShape {
  id: string;
  name: string;
  type: string;
  children?: IrElementShape[];
}

function irElementToStreamingNode(
  el: IrElementShape,
  mappedIds: ReadonlySet<string>,
  hasMappings: boolean,
  stage: PastePipelineState["stage"],
): TreeNode {
  const node: TreeNode = {
    id: el.id,
    name: el.name,
    type: el.type,
  };

  if (hasMappings) {
    node.mappingStatus = mappedIds.has(el.id) ? "matched" : "new";
  }

  if (stage === "generating" && (!el.children || el.children.length === 0)) {
    node.pipelineStatus = "generating";
  }

  if (el.children && el.children.length > 0) {
    node.children = el.children.map((child) =>
      irElementToStreamingNode(child, mappedIds, hasMappings, stage),
    );
  }

  return node;
}

/**
 * Convert a PastePipelineState into TreeNode[] suitable for ComponentTree.
 *
 * - Returns [] when no designIR is available.
 * - Adds skeleton placeholder screens when stage is early (no IR yet).
 * - Annotates nodes with mappingStatus after the "mapping" stage.
 * - Marks leaf nodes as "generating" during the generating stage.
 */
export function buildTreeFromIR(pipeline: PastePipelineState): TreeNode[] {
  const { designIR, componentManifest, stage } = pipeline;

  if (!designIR) {
    return [];
  }

  // Build set of mapped IR node IDs from the component manifest
  const mappedIds = new Set<string>();
  const hasMappings =
    componentManifest !== undefined &&
    (stage === "mapping" || stage === "generating" || stage === "ready");

  if (hasMappings) {
    for (const screen of componentManifest.screens) {
      for (const entry of screen.components) {
        mappedIds.add(entry.irNodeId);
      }
    }
  }

  return designIR.screens.map((screen) => {
    const children: TreeNode[] =
      screen.children.length > 0
        ? screen.children.map((el) =>
            irElementToStreamingNode(el, mappedIds, hasMappings, stage),
          )
        : stage !== "ready"
          ? makeSkeletonChildren(screen.id)
          : [];

    return {
      id: screen.id,
      name: screen.name,
      type: "screen",
      children,
    };
  });
}

/**
 * React hook that converts a PastePipelineState into a stable TreeNode[]
 * for progressive rendering in ComponentTree.
 */
export function useStreamingTreeNodes(
  pipeline: PastePipelineState,
): TreeNode[] {
  return useMemo(
    () => buildTreeFromIR(pipeline),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pipeline.designIR, pipeline.stage, pipeline.componentManifest],
  );
}
