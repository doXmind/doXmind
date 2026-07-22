import { describe, expect, it } from "vitest";

import {
  buildKnowledgeGraph,
  layoutKnowledgeGraph,
  selectKnowledgeGraphNeighborhood,
} from "@/lib/knowledge-graph";
import type { KnowledgeIndex } from "@/lib/knowledge-index";

const index: KnowledgeIndex = {
  pages: [
    { id: "a", path: "A.md", title: "A", aliases: [] },
    { id: "b", path: "B.md", title: "B", aliases: [] },
    { id: "c", path: "C.md", title: "C", aliases: [] },
    { id: "orphan", path: "Orphan.md", title: "Orphan", aliases: [] },
  ],
  links: [
    {
      kind: "wiki",
      sourceId: "a",
      sourcePath: "A.md",
      targetId: "b",
      targetPath: "B.md",
      targetText: "B",
      alias: null,
      fragment: null,
      status: "resolved",
      range: { from: 0, to: 5 },
    },
    {
      kind: "markdown",
      sourceId: "a",
      sourcePath: "A.md",
      targetId: "b",
      targetPath: "B.md",
      targetText: "B",
      alias: null,
      fragment: null,
      status: "resolved",
      range: { from: 6, to: 12 },
    },
    {
      kind: "wiki",
      sourceId: "b",
      sourcePath: "B.md",
      targetId: "c",
      targetPath: "C.md",
      targetText: "C",
      alias: null,
      fragment: null,
      status: "resolved",
      range: { from: 0, to: 5 },
    },
    {
      kind: "wiki",
      sourceId: "c",
      sourcePath: "C.md",
      targetId: null,
      targetPath: null,
      targetText: "Missing",
      alias: null,
      fragment: null,
      status: "unresolved",
      range: { from: 0, to: 11 },
    },
  ],
  backlinks: [],
  unlinkedMentions: [],
};

describe("derived knowledge graph", () => {
  it("aggregates resolved occurrences without treating unresolved links as edges", () => {
    const graph = buildKnowledgeGraph(index);

    expect(graph.nodes).toEqual([
      expect.objectContaining({ id: "a", incoming: 0, outgoing: 2, degree: 2 }),
      expect.objectContaining({ id: "b", incoming: 2, outgoing: 1, degree: 3 }),
      expect.objectContaining({ id: "c", incoming: 1, outgoing: 0, degree: 1 }),
      expect.objectContaining({ id: "orphan", incoming: 0, outgoing: 0, degree: 0 }),
    ]);
    expect(graph.edges).toEqual([
      expect.objectContaining({ sourceId: "a", targetId: "b", occurrences: 2 }),
      expect.objectContaining({ sourceId: "b", targetId: "c", occurrences: 1 }),
    ]);
  });

  it("prioritizes a bounded connected neighborhood and lays it out deterministically", () => {
    const graph = buildKnowledgeGraph(index);
    const neighborhood = selectKnowledgeGraphNeighborhood(graph, "a", 3);
    expect(neighborhood.nodes.map((node) => node.id)).toEqual(["a", "b", "c"]);
    expect(neighborhood.edges).toHaveLength(2);

    const first = layoutKnowledgeGraph(neighborhood, "a", 720, 420);
    const second = layoutKnowledgeGraph(neighborhood, "a", 720, 420);
    expect(first).toEqual(second);
    expect(first.nodes.find((node) => node.id === "a")).toMatchObject({ x: 360, y: 210 });
  });
});
