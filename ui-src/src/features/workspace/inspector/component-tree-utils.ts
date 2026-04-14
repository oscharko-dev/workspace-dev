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

  function pruneLoadedChildren(list: TreeNode[]): TreeNode[] {
    const kept: TreeNode[] = [];
    for (const node of list) {
      if (node.type === "skeleton") {
        continue;
      }
      kept.push({
        ...node,
        ...(node.children
          ? { children: pruneLoadedChildren(node.children) }
          : {}),
      });
    }
    return kept;
  }

  function matches(node: TreeNode): boolean {
    return node.name.toLowerCase().includes(lower);
  }

  function prune(list: TreeNode[]): TreeNode[] {
    const kept: TreeNode[] = [];
    for (const node of list) {
      if (matches(node)) {
        kept.push({
          ...node,
          ...(node.children
            ? { children: pruneLoadedChildren(node.children) }
            : {}),
        });
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
  mappingStatusById: ReadonlyMap<string, TreeNode["mappingStatus"]>,
  showMappingBadges: boolean,
  stage: PastePipelineState["stage"],
): TreeNode {
  const node: TreeNode = {
    id: el.id,
    name: el.name,
    type: el.type,
  };

  if (showMappingBadges) {
    const mappingStatus = mappingStatusById.get(el.id);
    if (mappingStatus !== undefined) {
      node.mappingStatus = mappingStatus;
    } else {
      node.mappingStatus = "unmapped";
    }
  }

  if (stage === "generating" && (!el.children || el.children.length === 0)) {
    node.pipelineStatus = "generating";
  }

  if (el.children && el.children.length > 0) {
    node.children = el.children.map((child) =>
      irElementToStreamingNode(
        child,
        mappingStatusById,
        showMappingBadges,
        stage,
      ),
    );
  }

  return node;
}

function buildRootSkeletons(
  roots: ReadonlyArray<{ id: string; name: string }>,
): TreeNode[] {
  return roots.map((root) => ({
    id: root.id,
    name: root.name,
    type: "screen",
    children: makeSkeletonChildren(root.id),
  }));
}

function buildRootsFromFigmaAnalysis(
  pipeline: PastePipelineState,
): TreeNode[] {
  const pages = pipeline.figmaAnalysis?.layoutGraph?.pages ?? [];
  const frames = pipeline.figmaAnalysis?.layoutGraph?.frames ?? [];
  if (frames.length === 0) {
    return [];
  }

  const framesById = new Map(frames.map((frame) => [frame.id, frame]));
  const roots: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();

  for (const page of pages) {
    for (const frameId of page.frameIds) {
      const frame = framesById.get(frameId);
      if (!frame || frame.parentSectionId !== undefined || seen.has(frame.id)) {
        continue;
      }
      seen.add(frame.id);
      roots.push({ id: frame.id, name: frame.name });
    }
  }

  if (roots.length === 0) {
    for (const frame of frames) {
      if (frame.parentSectionId !== undefined || seen.has(frame.id)) {
        continue;
      }
      seen.add(frame.id);
      roots.push({ id: frame.id, name: frame.name });
    }
  }

  return buildRootSkeletons(roots);
}

/**
 * Convert a PastePipelineState into TreeNode[] suitable for ComponentTree.
 *
 * - Uses payload-derived or analysis-derived root hints before designIR exists.
 * - Adds skeleton placeholder screens when stage is early or children are absent.
 * - Annotates nodes with mappingStatus after the "mapping" stage.
 * - Marks leaf nodes as "generating" during the generating stage.
 */
export function buildTreeFromIR(pipeline: PastePipelineState): TreeNode[] {
  const { componentManifest, designIR, stage } = pipeline;

  if (!designIR) {
    if (pipeline.sourceScreens && pipeline.sourceScreens.length > 0) {
      return buildRootSkeletons(pipeline.sourceScreens);
    }
    return buildRootsFromFigmaAnalysis(pipeline);
  }

  const mappingStatusById = new Map<string, TreeNode["mappingStatus"]>();
  if (componentManifest !== undefined) {
    for (const screen of componentManifest.screens) {
      for (const entry of screen.components) {
        mappingStatusById.set(
          entry.irNodeId,
          entry.extractedComponent === true ? "suggested" : "matched",
        );
      }
    }
  }
  for (const diagnostic of pipeline.figmaAnalysis?.diagnostics ?? []) {
    if (
      diagnostic.severity === "error" &&
      typeof diagnostic.sourceNodeId === "string"
    ) {
      mappingStatusById.set(diagnostic.sourceNodeId, "error");
    }
  }
  const showMappingBadges =
    stage === "mapping" || stage === "generating" || stage === "ready";

  return designIR.screens.map((screen) => {
    const children: TreeNode[] =
      screen.children.length > 0
        ? screen.children.map((el) =>
            irElementToStreamingNode(
              el,
              mappingStatusById,
              showMappingBadges,
              stage,
            ),
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
    [
      pipeline.componentManifest,
      pipeline.designIR,
      pipeline.figmaAnalysis,
      pipeline.sourceScreens,
      pipeline.stage,
    ],
  );
}
