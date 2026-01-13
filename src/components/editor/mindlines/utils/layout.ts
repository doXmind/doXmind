import dagre from "@dagrejs/dagre";
import { Position, type Node, type Edge } from "@xyflow/react";
import type { Heading, HeadingNode as HeadingTreeNode, FlowNodeData } from "../types";
import { buildTree } from "../use-tree";
import {
  DAGRE_LAYOUT,
  MINDMAP_NODE_WIDTH,
  MINDMAP_NODE_HEIGHT,
  MINDMAP_CENTER_VIEW,
} from "@/lib/constants";

/**
 * Convert flat headings array to React Flow nodes and edges
 * Supports collapsed nodes - children of collapsed nodes are hidden
 */
export function convertToFlowElements(
  headings: Heading[],
  collapsedNodes: Set<string> = new Set()
): {
  initialNodes: Node[];
  initialEdges: Edge[];
} {
  const tree = buildTree(headings);
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  function traverse(item: HeadingTreeNode, parentId?: string, isHidden: boolean = false) {
    const isCollapsed = collapsedNodes.has(item.id);
    const hasChildren = item.children.length > 0;

    // Skip hidden nodes (children of collapsed parents)
    if (isHidden) {
      return;
    }

    nodes.push({
      id: item.id,
      type: "heading",
      position: { x: 0, y: 0 },
      data: {
        label: item.text,
        level: item.level,
        pos: item.pos,
        isCollapsed,
        hasChildren,
        childCount: countDescendants(item),
      },
    });

    if (parentId) {
      edges.push({
        id: `${parentId}-${item.id}`,
        source: parentId,
        target: item.id,
        type: "customEdge",
      });
    }

    // If this node is collapsed, hide its children
    item.children.forEach((child) => traverse(child, item.id, isCollapsed));
  }

  tree.forEach((root) => traverse(root));
  return { initialNodes: nodes, initialEdges: edges };
}

/**
 * Count all descendants of a node
 */
function countDescendants(node: HeadingTreeNode): number {
  let count = 0;
  for (const child of node.children) {
    count += 1 + countDescendants(child);
  }
  return count;
}

/**
 * Apply dagre layout algorithm to position nodes
 */
export function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB"
): { nodes: Node[]; edges: Edge[] } {
  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));

  g.setGraph({
    rankdir: direction,
    nodesep: DAGRE_LAYOUT.NODE_SEPARATION,
    ranksep: DAGRE_LAYOUT.RANK_SEPARATION,
    marginx: DAGRE_LAYOUT.MARGIN_X,
    marginy: DAGRE_LAYOUT.MARGIN_Y,
  });

  // Helper function to get node width based on heading level
  const getNodeWidth = (level: number): number => {
    switch (level) {
      case 1:
        return MINDMAP_NODE_WIDTH.H1;
      case 2:
        return MINDMAP_NODE_WIDTH.H2;
      default:
        return MINDMAP_NODE_WIDTH.H3;
    }
  };

  // Set node dimensions based on level
  nodes.forEach((node) => {
    const data = node.data as FlowNodeData;
    const width = getNodeWidth(data.level);
    g.setNode(node.id, { width, height: MINDMAP_NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const isHorizontal = direction === "LR";
  const layoutedNodes: Node[] = nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    const data = node.data as FlowNodeData;
    const width = getNodeWidth(data.level);

    return {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: {
        x: nodeWithPosition.x - width / 2,
        y: nodeWithPosition.y - MINDMAP_CENTER_VIEW.Y_OFFSET,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}
