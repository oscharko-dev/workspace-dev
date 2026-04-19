import type { DiffableFigmaNode } from "./paste-tree-diff.js";

const ROOT_NODE_TYPES = new Set<string>([
  "FRAME",
  "COMPONENT",
  "COMPONENT_SET",
  "INSTANCE",
]);

const collectScreenLikeRoots = (
  node: DiffableFigmaNode,
  roots: DiffableFigmaNode[],
): void => {
  if (ROOT_NODE_TYPES.has(node.type)) {
    roots.push(node);
    return;
  }
  if (node.type !== "SECTION" || !Array.isArray(node.children)) {
    return;
  }
  for (const child of node.children) {
    collectScreenLikeRoots(child, roots);
  }
};

const asDiffableFigmaNode = (
  value: unknown,
): DiffableFigmaNode | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.type !== "string") {
    return undefined;
  }
  return record as unknown as DiffableFigmaNode;
};

export const extractDiffablePasteRoots = (
  parsed: unknown,
): DiffableFigmaNode[] => {
  if (typeof parsed !== "object" || parsed === null) {
    return [];
  }

  const record = parsed as Record<string, unknown>;
  const document = record.document;
  if (document !== undefined) {
    const documentRecord =
      typeof document === "object" && document !== null
        ? (document as Record<string, unknown>)
        : undefined;
    if (documentRecord !== undefined && Array.isArray(documentRecord.children)) {
      const roots: DiffableFigmaNode[] = [];
      for (const child of documentRecord.children) {
        const node = asDiffableFigmaNode(child);
        if (node === undefined) {
          continue;
        }
        if (node.type === "CANVAS" && Array.isArray(node.children)) {
          for (const pageChild of node.children) {
            collectScreenLikeRoots(pageChild, roots);
          }
          continue;
        }
        collectScreenLikeRoots(node, roots);
      }
      return roots;
    }
  }

  if (typeof record.nodes === "object" && record.nodes !== null) {
    const roots: DiffableFigmaNode[] = [];
    for (const entry of Object.values(record.nodes as Record<string, unknown>)) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      const node = asDiffableFigmaNode(
        (entry as Record<string, unknown>).document,
      );
      if (node !== undefined) {
        collectScreenLikeRoots(node, roots);
      }
    }
    return roots;
  }

  return [];
};

export const extractDiffablePasteRootsFromJson = (
  jsonString: string,
): DiffableFigmaNode[] => {
  try {
    return extractDiffablePasteRoots(JSON.parse(jsonString));
  } catch {
    return [];
  }
};
