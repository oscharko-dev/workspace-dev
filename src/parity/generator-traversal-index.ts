import { isTextElement } from "./types.js";
import type { ScreenElementIR, TextElementIR } from "./types.js";

export interface TraversalIndex {
  flatElements: ScreenElementIR[];
  textNodesById: Map<string, TextElementIR[]>;
  vectorPathsById: Map<string, string[]>;
  subtreeNodeIdsById: Map<string, string[]>;
}

interface TraversalSummary {
  textNodes: TextElementIR[];
  vectorPaths: string[];
  subtreeNodeIds: string[];
}

const EMPTY_TEXT_NODES: TextElementIR[] = [];
const EMPTY_STRING_VALUES: string[] = [];

export const createTraversalIndex = (elements: readonly ScreenElementIR[]): TraversalIndex => {
  const flatElements: ScreenElementIR[] = [];
  const textNodesById = new Map<string, TextElementIR[]>();
  const vectorPathsById = new Map<string, string[]>();
  const subtreeNodeIdsById = new Map<string, string[]>();
  const visited = new Set<ScreenElementIR>();

  const visit = (element: ScreenElementIR): TraversalSummary => {
    if (visited.has(element)) {
      return {
        textNodes: textNodesById.get(element.id) ?? EMPTY_TEXT_NODES,
        vectorPaths: vectorPathsById.get(element.id) ?? EMPTY_STRING_VALUES,
        subtreeNodeIds: subtreeNodeIdsById.get(element.id) ?? EMPTY_STRING_VALUES
      };
    }
    visited.add(element);
    flatElements.push(element);

    const textNodes = isTextElement(element) && element.text.trim().length > 0 ? [element] : [];
    const vectorPaths = Array.isArray(element.vectorPaths)
      ? element.vectorPaths.filter((path): path is string => typeof path === "string" && path.length > 0)
      : [];
    const subtreeNodeIds = [element.id];

    for (const child of element.children ?? []) {
      const childSummary = visit(child);
      textNodes.push(...childSummary.textNodes);
      vectorPaths.push(...childSummary.vectorPaths);
      subtreeNodeIds.push(...childSummary.subtreeNodeIds);
    }

    const dedupedVectorPaths = Array.from(new Set(vectorPaths));
    textNodesById.set(element.id, textNodes);
    vectorPathsById.set(element.id, dedupedVectorPaths);
    subtreeNodeIdsById.set(element.id, subtreeNodeIds);

    return {
      textNodes,
      vectorPaths: dedupedVectorPaths,
      subtreeNodeIds
    };
  };

  for (const element of elements) {
    visit(element);
  }

  return {
    flatElements,
    textNodesById,
    vectorPathsById,
    subtreeNodeIdsById
  };
};

export const getIndexedTextNodes = (index: TraversalIndex, element: ScreenElementIR): TextElementIR[] => {
  return index.textNodesById.get(element.id) ?? EMPTY_TEXT_NODES;
};

export const getIndexedVectorPaths = (index: TraversalIndex, element: ScreenElementIR): string[] => {
  return index.vectorPathsById.get(element.id) ?? EMPTY_STRING_VALUES;
};

export const getIndexedSubtreeNodeIds = (index: TraversalIndex, element: ScreenElementIR): string[] => {
  return index.subtreeNodeIdsById.get(element.id) ?? EMPTY_STRING_VALUES;
};
