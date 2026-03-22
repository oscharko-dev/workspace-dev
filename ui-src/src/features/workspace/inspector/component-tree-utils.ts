import type { TreeNode } from "./component-tree";

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
export function findNodePath(nodes: TreeNode[], targetId: string): BreadcrumbSegment[] {
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
