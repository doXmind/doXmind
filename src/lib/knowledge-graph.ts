import type { KnowledgeIndex, KnowledgePage } from "@/lib/knowledge-index";

export interface KnowledgeGraphNode extends KnowledgePage {
  incoming: number;
  outgoing: number;
  degree: number;
}

export interface KnowledgeGraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  occurrences: number;
}

export interface KnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
}

export interface PositionedKnowledgeGraphNode extends KnowledgeGraphNode {
  x: number;
  y: number;
}

export interface PositionedKnowledgeGraph {
  nodes: PositionedKnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
}

/** Derive a graph from resolved Page links; this Module never owns or writes knowledge state. */
export function buildKnowledgeGraph(index: KnowledgeIndex): KnowledgeGraph {
  const pages = new Map(index.pages.map((page) => [page.id, page]));
  const edgeOccurrences = new Map<string, number>();
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();

  for (const link of index.links) {
    if (link.status !== "resolved" || !link.targetId) continue;
    if (!pages.has(link.sourceId) || !pages.has(link.targetId)) continue;
    const key = edgeKey(link.sourceId, link.targetId);
    edgeOccurrences.set(key, (edgeOccurrences.get(key) ?? 0) + 1);
    outgoing.set(link.sourceId, (outgoing.get(link.sourceId) ?? 0) + 1);
    incoming.set(link.targetId, (incoming.get(link.targetId) ?? 0) + 1);
  }

  const nodes = [...pages.values()]
    .sort((left, right) => compareText(left.path, right.path))
    .map((page) => {
      const incomingCount = incoming.get(page.id) ?? 0;
      const outgoingCount = outgoing.get(page.id) ?? 0;
      return {
        ...page,
        incoming: incomingCount,
        outgoing: outgoingCount,
        degree: incomingCount + outgoingCount,
      };
    });
  const edges = [...edgeOccurrences.entries()]
    .map(([key, occurrences]) => {
      const [sourceId, targetId] = key.split("\u0000");
      return { id: `${sourceId}->${targetId}`, sourceId, targetId, occurrences };
    })
    .sort(
      (left, right) =>
        compareText(left.sourceId, right.sourceId) || compareText(left.targetId, right.targetId)
    );
  return { nodes, edges };
}

/** Bounded breadth-first neighborhood for a useful graph on large workspaces. */
export function selectKnowledgeGraphNeighborhood(
  graph: KnowledgeGraph,
  focusId: string | null,
  limit = 60
): KnowledgeGraph {
  const safeLimit = Math.max(1, Math.floor(limit));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const selected: KnowledgeGraphNode[] = [];
  const selectedIds = new Set<string>();
  const adjacency = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    addNeighbor(adjacency, edge.sourceId, edge.targetId);
    addNeighbor(adjacency, edge.targetId, edge.sourceId);
  }

  if (focusId && nodeById.has(focusId)) {
    const queue = [focusId];
    selectedIds.add(focusId);
    while (queue.length && selected.length < safeLimit) {
      const id = queue.shift()!;
      const node = nodeById.get(id);
      if (node) selected.push(node);
      const neighbors = [...(adjacency.get(id) ?? [])].sort((left, right) =>
        compareText(nodeById.get(left)?.path ?? left, nodeById.get(right)?.path ?? right)
      );
      for (const neighbor of neighbors) {
        if (selectedIds.size >= safeLimit) break;
        if (selectedIds.has(neighbor)) continue;
        selectedIds.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  if (selected.length < safeLimit) {
    for (const node of [...graph.nodes].sort(compareGraphNodes)) {
      if (selected.length >= safeLimit) break;
      if (selectedIds.has(node.id)) continue;
      selectedIds.add(node.id);
      selected.push(node);
    }
  }

  return {
    nodes: selected,
    edges: graph.edges.filter(
      (edge) => selectedIds.has(edge.sourceId) && selectedIds.has(edge.targetId)
    ),
  };
}

/** Deterministic radial layout with the active Page at the center. */
export function layoutKnowledgeGraph(
  graph: KnowledgeGraph,
  focusId: string | null,
  width: number,
  height: number
): PositionedKnowledgeGraph {
  const centerX = width / 2;
  const centerY = height / 2;
  const focus = focusId ? graph.nodes.find((node) => node.id === focusId) : undefined;
  const remaining = graph.nodes.filter((node) => node.id !== focus?.id);
  const positioned: PositionedKnowledgeGraphNode[] = [];
  if (focus) positioned.push({ ...focus, x: centerX, y: centerY });

  const perRing = 18;
  const baseRadius = Math.min(width, height) * 0.3;
  remaining.forEach((node, index) => {
    const ring = Math.floor(index / perRing);
    const ringStart = ring * perRing;
    const count = Math.min(perRing, remaining.length - ringStart);
    const position = index - ringStart;
    const radius = Math.min(Math.min(width, height) * 0.46, baseRadius + ring * 52);
    const angle = -Math.PI / 2 + (position * Math.PI * 2) / Math.max(1, count);
    positioned.push({
      ...node,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    });
  });

  if (!focus && positioned.length === 0 && graph.nodes[0]) {
    positioned.push({ ...graph.nodes[0], x: centerX, y: centerY });
  }
  return { nodes: positioned, edges: graph.edges };
}

function addNeighbor(adjacency: Map<string, Set<string>>, source: string, target: string): void {
  const neighbors = adjacency.get(source);
  if (neighbors) neighbors.add(target);
  else adjacency.set(source, new Set([target]));
}

function edgeKey(sourceId: string, targetId: string): string {
  return `${sourceId}\u0000${targetId}`;
}

function compareGraphNodes(left: KnowledgeGraphNode, right: KnowledgeGraphNode): number {
  return right.degree - left.degree || compareText(left.path, right.path);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}
