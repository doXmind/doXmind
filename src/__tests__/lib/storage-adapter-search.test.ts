import { describe, expect, it, vi } from "vitest";

import { DiskStorageAdapter, searchMarkdown } from "@/lib/storage";

describe("storage search helpers", () => {
  it("searches disk markdown through workspace search commands", async () => {
    const invokeMock = vi.fn(async (command: string, payload: Record<string, unknown>) => {
      if (command === "workspace_scan") {
        expect(payload).toEqual({ root: "/workspace" });
        return {
          root: "/workspace",
          documents: [
            {
              id: "doc-1",
              idSource: "frontmatter",
              path: "Project.md",
              name: "Project.md",
              title: "Project",
              hasSidecar: true,
            },
            {
              id: "doc-2",
              idSource: "frontmatter",
              path: "Notes.md",
              name: "Notes.md",
              title: "Notes",
              hasSidecar: false,
            },
          ],
        };
      }

      if (command === "workspace_index_rebuild") {
        expect(payload).toEqual({ root: "/workspace" });
        return { version: 1, ids: { "doc-1": "Project.md", "doc-2": "Notes.md" } };
      }

      if (command === "workspace_markdown_search") {
        expect(payload).toEqual({ root: "/workspace", query: "roadmap", limit: 5 });
        return [
          {
            path: "Project.md",
            title: "Project",
            matches: [{ line: 1, preview: "Alpha roadmap details" }],
          },
        ];
      }

      throw new Error(`Unexpected command: ${command}`);
    });
    const invoke = invokeMock as unknown as <T>(
      command: string,
      payload: Record<string, unknown>
    ) => Promise<T>;

    const adapter = new DiskStorageAdapter({ root: "/workspace", invoke });
    const results = await searchMarkdown(adapter, "roadmap", { limit: 5 });

    expect(results.results).toHaveLength(1);
    expect(results.results[0]).toMatchObject({
      content: "Alpha roadmap details",
      metadata: {
        fileId: "doc-1",
        name: "Project",
        path: "Project.md",
        chunkIndex: 1,
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("workspace_markdown_search", {
      root: "/workspace",
      query: "roadmap",
      limit: 5,
    });
  });
});
