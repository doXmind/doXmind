import { useMemo } from "react";
import * as d3 from "d3-hierarchy";
import type { Heading, HeadingNode } from "./types";

/**
 * Convert flat headings array to tree structure
 */
export function buildTree(headings: Heading[]): HeadingNode[] {
  const root: HeadingNode[] = [];
  const stack: HeadingNode[] = [];

  for (const heading of headings) {
    const node: HeadingNode = { ...heading, children: [] };

    // Pop stack until we find a lower level (parent)
    while (stack.length && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(node); // Root level
    } else {
      stack[stack.length - 1].children.push(node); // Add as child
    }

    stack.push(node);
  }

  return root;
}

/**
 * Calculate tree layout positions using d3-hierarchy
 */
export function calculateTreeLayout(
  tree: HeadingNode[],
  width: number,
  _height: number
): {
  nodes: d3.HierarchyPointNode<HeadingNode>[];
  links: d3.HierarchyPointLink<HeadingNode>[];
  treeHeight: number;
} {
  if (tree.length === 0) {
    return { nodes: [], links: [], treeHeight: 0 };
  }

  // Create virtual root if multiple H1s exist
  const rootData: HeadingNode =
    tree.length === 1
      ? tree[0]
      : {
          id: "virtual-root",
          level: 0,
          text: "",
          pos: -1,
          children: tree,
        };

  // Create hierarchy
  const root = d3.hierarchy(rootData);

  // Calculate dynamic height based on number of nodes
  // Each level needs ~60px, with minimum of 300px
  const nodeCount = root.descendants().length;
  const treeDepth = root.height;
  const dynamicHeight = Math.max(300, treeDepth * 80 + nodeCount * 20);

  // Calculate layout - vertical tree (top to bottom)
  const treeLayout = d3
    .tree<HeadingNode>()
    .size([width - 60, dynamicHeight])
    .separation((a, b) => (a.parent === b.parent ? 1.5 : 2));

  const layoutRoot = treeLayout(root);

  // Get nodes and links (filter out virtual root if present)
  let nodes = layoutRoot.descendants();
  let links = layoutRoot.links();

  if (tree.length > 1) {
    // Filter out virtual root node
    nodes = nodes.filter((n) => n.data.id !== "virtual-root");
    links = links.filter((l) => l.source.data.id !== "virtual-root");
  }

  return { nodes, links, treeHeight: dynamicHeight + 60 };
}

/**
 * Hook to convert headings to tree structure
 */
export function useTree(headings: Heading[]) {
  const tree = useMemo(() => buildTree(headings), [headings]);
  return tree;
}

/**
 * Hook to get both tree and layout
 */
export function useTreeLayout(headings: Heading[], width: number, height: number) {
  const tree = useMemo(() => buildTree(headings), [headings]);
  const layout = useMemo(() => calculateTreeLayout(tree, width, height), [tree, width, height]);
  return { tree, ...layout };
}
