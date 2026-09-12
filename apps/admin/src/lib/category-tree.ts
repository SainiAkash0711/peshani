import { CategoryTreeNode } from '../types/catalog';

export interface FlatCategoryOption {
  id: string;
  name: string;
  depth: number;
}

/** Flattens a category tree depth-first, for a parent-category <select>. */
export function flattenTree(nodes: CategoryTreeNode[], depth = 0): FlatCategoryOption[] {
  return nodes.flatMap((node) => [
    { id: node.id, name: node.name, depth },
    ...flattenTree(node.children, depth + 1),
  ]);
}

/** Ids of a node and all its descendants - used to keep a category from being offered as its own new parent. */
export function collectSubtreeIds(nodes: CategoryTreeNode[], rootId: string): Set<string> {
  const ids = new Set<string>();
  function visit(node: CategoryTreeNode, inSubtree: boolean) {
    const include = inSubtree || node.id === rootId;
    if (include) ids.add(node.id);
    node.children.forEach((child) => visit(child, include));
  }
  nodes.forEach((node) => visit(node, false));
  return ids;
}
