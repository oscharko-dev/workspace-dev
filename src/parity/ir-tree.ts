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

// ── Constants ────────────────────────────────────────────────────────────────
export const DEFAULT_SCREEN_ELEMENT_BUDGET = 1_200;
export const DEFAULT_SCREEN_ELEMENT_MAX_DEPTH = 14;

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

export const countSubtreeNodes = (node: TreeFigmaNode): number => {
  const children = node.children ?? [];
  if (children.length === 0) {
    return 1;
  }
  return 1 + children.reduce((count, child) => count + countSubtreeNodes(child), 0);
};

export const collectNodes = <T extends TreeFigmaNode>(node: T, predicate: (candidate: T) => boolean): T[] => {
  if ((node as TreeFigmaNode).visible === false) {
    return [];
  }

  const collected: T[] = [];
  if (predicate(node)) {
    collected.push(node);
  }
  if (!node.children) {
    return collected;
  }
  for (const child of node.children) {
    collected.push(...collectNodes(child as T, predicate));
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

  const visit = (node: TreeFigmaNode, depth: number): boolean => {
    if (node.visible === false) {
      return false;
    }

    nodeCountByDepth.set(depth, (nodeCountByDepth.get(depth) ?? 0) + 1);

    const selfSemantic = isDepthSemanticNode(node, determineElementType);
    if (selfSemantic) {
      semanticCountByDepth.set(depth, (semanticCountByDepth.get(depth) ?? 0) + 1);
    }

    let childSemantic = false;
    for (const child of node.children ?? []) {
      childSemantic = visit(child, depth + 1) || childSemantic;
    }

    const hasSemanticSubtree = selfSemantic || childSemantic;
    subtreeHasSemanticById.set(node.id, hasSemanticSubtree);
    return hasSemanticSubtree;
  };

  for (const node of nodes) {
    visit(node, 0);
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
    const pressureMultiplier = semanticDensityAtDepth > 0.25 ? 6 : 4;
    const highPressureCutoff = remainingBudget > 0 && nodeCountAtDepth > Math.max(remainingBudget * pressureMultiplier, 32);
    return highPressureCutoff && !semanticRelevant;
  }

  if (remainingBudget <= 0) {
    return true;
  }
  if (!semanticRelevant) {
    return true;
  }

  const allowedSemanticDepthWidth = Math.max(remainingBudget * (semanticDensityAtDepth > 0.15 ? 3 : 2), 12);
  return nodeCountAtDepth > allowedSemanticDepthWidth;
};
