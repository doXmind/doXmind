import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import type { Heading, HeadingNode as HeadingTreeNode } from "../types";
import { buildTree } from "../use-tree";

interface FlowNodeData {
  label: string;
  level: number;
  pos: number;
}

/**
 * Convert flat headings array to React Flow nodes and edges
 */
export function convertToFlowElements(headings: Heading[]): {
  initialNodes: Node<FlowNodeData>[];
  initialEdges: Edge[];
} {
  const tree = buildTree(headings);
  const nodes: Node<FlowNodeData>[] = [];
  const edges: Edge[] = [];

  function traverse(item: HeadingTreeNode, parentId?: string) {
    nodes.push({
      id: item.id,
      type: "heading",
      position: { x: 0, y: 0 },
      data: {
        label: item.text,
        level: item.level,
        pos: item.pos,
      },
    });

    if (parentId) {
      edges.push({
        id: `${parentId}-${item.id}`,
        source: parentId,
        target: item.id,
        type: "smoothstep",
      });
    }

    item.children.forEach((child) => traverse(child, item.id));
  }

  tree.forEach((root) => traverse(root));
  return { initialNodes: nodes, initialEdges: edges };
}

/**
 * Apply dagre layout algorithm to position nodes
 */
export function applyDagreLayout(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB"
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));

  g.setGraph({
    rankdir: direction,
    nodesep: 60,
    ranksep: 100,
    marginx: 20,
    marginy: 20,
  });

  // Set node dimensions based on level
  nodes.forEach((node) => {
    const width = node.data.level === 1 ? 220 : node.data.level === 2 ? 180 : 160;
    const height = 44;
    g.setNode(node.id, { width, height });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const isHorizontal = direction === "LR";
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    const width = node.data.level === 1 ? 220 : node.data.level === 2 ? 180 : 160;

    return {
      ...node,
      targetPosition: isHorizontal ? ("left" as const) : ("top" as const),
      sourcePosition: isHorizontal ? ("right" as const) : ("bottom" as const),
      position: {
        x: nodeWithPosition.x - width / 2,
        y: nodeWithPosition.y - 22,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}
