import type { TreeNode } from "./component-tree";

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
