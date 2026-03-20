/**
 * Tree traversal and structural analysis utilities for raw Figma node trees.
 *
 * Extracted from ir.ts to isolate generic tree walking, depth pressure analysis,
 * and depth-budget pruning logic that operates independently of IR construction
 * and design token extraction.
 */
import { hasAnySubstring } from "./ir-classification.js";
import { isTechnicalPlaceholderText } from "../figma-node-heuristics.js";
import type { ScreenElementIR } from "./types.js";
import {
  DEFAULT_SCREEN_ELEMENT_BUDGET as _DEFAULT_SCREEN_ELEMENT_BUDGET,
  DEFAULT_SCREEN_ELEMENT_MAX_DEPTH as _DEFAULT_SCREEN_ELEMENT_MAX_DEPTH,
  DEPTH_HIGH_SEMANTIC_DENSITY_THRESHOLD,
  DEPTH_HIGH_DENSITY_PRESSURE_MULTIPLIER,
  DEPTH_LOW_DENSITY_PRESSURE_MULTIPLIER,
  DEPTH_MIN_NODE_COUNT_FLOOR,
  DEPTH_SEMANTIC_WIDTH_DENSITY_THRESHOLD,
  DEPTH_HIGH_DENSITY_WIDTH_MULTIPLIER,
  DEPTH_LOW_DENSITY_WIDTH_MULTIPLIER,
  DEPTH_MIN_SEMANTIC_WIDTH
} from "./constants.js";

// ── Minimal FigmaNode shape needed by tree traversal ─────────────────────────
// This duplicates a subset of the FigmaNode interface defined in ir.ts.
// Tree traversal only needs the structural and identity fields.
export interface TreeFigmaNode {
  id: string;
  name?: string;
  type: string;
  visible?: boolean;
  children?: TreeFigmaNode[];
  characters?: string;
  style?: {
    fontSize?: number;
  };
}

// ── Constants (re-exported from centralized constants module) ────────────────
export const DEFAULT_SCREEN_ELEMENT_BUDGET: number = _DEFAULT_SCREEN_ELEMENT_BUDGET;
export const DEFAULT_SCREEN_ELEMENT_MAX_DEPTH: number = _DEFAULT_SCREEN_ELEMENT_MAX_DEPTH;

// ── Depth-semantic classification helpers ────────────────────────────────────
export const DEPTH_SEMANTIC_TYPES: Set<ScreenElementIR["type"]> = new Set<ScreenElementIR["type"]>([
  "text",
  "button",
  "input",
  "select",
  "switch",
  "checkbox",
  "radio",
  "slider",
  "rating",
  "tab",
  "drawer",
  "breadcrumbs",
  "navigation",
  "stepper",
  "table",
  "snackbar"
]);

export const DEPTH_SEMANTIC_NAME_HINTS: string[] = [
  "button",
  "cta",
  "input",
  "select",
  "dropdown",
  "textfield",
  "form",
  "switch",
  "checkbox",
  "radio",
  "slider",
  "rating",
  "tab",
  "drawer",
  "breadcrumbs",
  "navigation",
  "stepper",
  "accordion",
  "table",
  "snackbar",
  "alert"
];

// ── Generic tree traversal ──────────────────────────────────────────────────

export const countSubtreeNodes = (root: TreeFigmaNode): number => {
  let count = 0;
  const stack: TreeFigmaNode[] = [root];
  while (stack.length > 0) {
    count++;
    const node = stack.pop()!;
    const children = node.children;
    if (children) {
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push(children[i]!);
      }
    }
  }
  return count;
};

export const collectNodes = <T extends TreeFigmaNode>(root: T, predicate: (candidate: T) => boolean): T[] => {
  if ((root as TreeFigmaNode).visible === false) {
    return [];
  }

  const collected: T[] = [];
  const stack: T[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if ((node as TreeFigmaNode).visible === false) {
      continue;
    }
    if (predicate(node)) {
      collected.push(node);
    }
    const children = node.children;
    if (children) {
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push(children[i] as T);
      }
    }
  }
  return collected;
};

// ── Depth pressure analysis ─────────────────────────────────────────────────

export interface DepthAnalysis {
  nodeCountByDepth: Map<number, number>;
  semanticCountByDepth: Map<number, number>;
  subtreeHasSemanticById: Map<string, boolean>;
}

export interface ScreenDepthBudgetContext {
  screenElementBudget: number;
  configuredMaxDepth: number;
  mappedElementCount: number;
  nodeCountByDepth: Map<number, number>;
  semanticCountByDepth: Map<number, number>;
  subtreeHasSemanticById: Map<string, boolean>;
  truncatedBranchCount: number;
  firstTruncatedDepth?: number;
}

export const hasMeaningfulNodeText = (node: TreeFigmaNode): boolean => {
  const normalized = (node.characters ?? "").trim().toLowerCase();
  return normalized.length > 0 && !isTechnicalPlaceholderText({ text: normalized });
};

export const isDepthSemanticNode = (
  node: TreeFigmaNode,
  determineElementType: (candidate: TreeFigmaNode) => ScreenElementIR["type"]
): boolean => {
  if (node.visible === false) {
    return false;
  }
  if (node.type === "TEXT") {
    return hasMeaningfulNodeText(node);
  }
  const semanticType = determineElementType(node);
  if (DEPTH_SEMANTIC_TYPES.has(semanticType)) {
    return true;
  }
  const loweredName = (node.name ?? "").toLowerCase();
  return hasAnySubstring(loweredName, DEPTH_SEMANTIC_NAME_HINTS);
};

export const analyzeDepthPressure = (
  nodes: TreeFigmaNode[],
  determineElementType: (candidate: TreeFigmaNode) => ScreenElementIR["type"]
): DepthAnalysis => {
  const nodeCountByDepth = new Map<number, number>();
  const semanticCountByDepth = new Map<number, number>();
  const subtreeHasSemanticById = new Map<string, boolean>();

  // Phase 1: Iterative DFS to collect visited nodes in pre-order with depth
  // and compute per-depth counts. We record parent→child relationships for
  // bottom-up semantic propagation.
  const visited: Array<{ node: TreeFigmaNode; selfSemantic: boolean }> = [];
  const parentIdOf = new Map<string, string>();
  const stack: Array<{ node: TreeFigmaNode; depth: number; parentId: string | undefined }> = [];

  for (let i = nodes.length - 1; i >= 0; i--) {
    stack.push({ node: nodes[i]!, depth: 0, parentId: undefined });
  }

  while (stack.length > 0) {
    const { node, depth, parentId } = stack.pop()!;
    if (node.visible === false) {
      continue;
    }

    nodeCountByDepth.set(depth, (nodeCountByDepth.get(depth) ?? 0) + 1);

    const selfSemantic = isDepthSemanticNode(node, determineElementType);
    if (selfSemantic) {
      semanticCountByDepth.set(depth, (semanticCountByDepth.get(depth) ?? 0) + 1);
    }

    visited.push({ node, selfSemantic });
    if (parentId !== undefined) {
      parentIdOf.set(node.id, parentId);
    }

    const children = node.children;
    if (children) {
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ node: children[i]!, depth: depth + 1, parentId: node.id });
      }
    }
  }

  // Phase 2: Reverse iteration (post-order) to propagate semantic flags
  // bottom-up. Children appear after their parent in the visited array,
  // so reverse iteration processes children before parents.
  for (let i = visited.length - 1; i >= 0; i--) {
    const { node, selfSemantic } = visited[i]!;
    const current = subtreeHasSemanticById.get(node.id) ?? false;
    const hasSemantic = selfSemantic || current;
    subtreeHasSemanticById.set(node.id, hasSemantic);
    if (hasSemantic) {
      const pid = parentIdOf.get(node.id);
      if (pid !== undefined) {
        subtreeHasSemanticById.set(pid, true);
      }
    }
  }

  return {
    nodeCountByDepth,
    semanticCountByDepth,
    subtreeHasSemanticById
  };
};

// ── Depth budget pruning ────────────────────────────────────────────────────

export const shouldTruncateChildrenByDepth = ({
  node,
  depth,
  elementType,
  context
}: {
  node: TreeFigmaNode;
  depth: number;
  elementType: ScreenElementIR["type"];
  context: ScreenDepthBudgetContext;
}): boolean => {
  if (!node.children?.length) {
    return false;
  }

  const nextDepth = depth + 1;
  const remainingBudget = Math.max(0, context.screenElementBudget - context.mappedElementCount);
  const nodeCountAtDepth = context.nodeCountByDepth.get(nextDepth) ?? 0;
  const semanticCountAtDepth = context.semanticCountByDepth.get(nextDepth) ?? 0;
  const subtreeHasSemantic = context.subtreeHasSemanticById.get(node.id) ?? false;
  const semanticRelevant = DEPTH_SEMANTIC_TYPES.has(elementType) || subtreeHasSemantic;
  const semanticDensityAtDepth = nodeCountAtDepth > 0 ? semanticCountAtDepth / nodeCountAtDepth : 0;

  if (nextDepth <= context.configuredMaxDepth) {
    const pressureMultiplier = semanticDensityAtDepth > DEPTH_HIGH_SEMANTIC_DENSITY_THRESHOLD ? DEPTH_HIGH_DENSITY_PRESSURE_MULTIPLIER : DEPTH_LOW_DENSITY_PRESSURE_MULTIPLIER;
    const highPressureCutoff = remainingBudget > 0 && nodeCountAtDepth > Math.max(remainingBudget * pressureMultiplier, DEPTH_MIN_NODE_COUNT_FLOOR);
    return highPressureCutoff && !semanticRelevant;
  }

  if (remainingBudget <= 0) {
    return true;
  }
  if (!semanticRelevant) {
    return true;
  }

  const allowedSemanticDepthWidth = Math.max(remainingBudget * (semanticDensityAtDepth > DEPTH_SEMANTIC_WIDTH_DENSITY_THRESHOLD ? DEPTH_HIGH_DENSITY_WIDTH_MULTIPLIER : DEPTH_LOW_DENSITY_WIDTH_MULTIPLIER), DEPTH_MIN_SEMANTIC_WIDTH);
  return nodeCountAtDepth > allowedSemanticDepthWidth;
};
