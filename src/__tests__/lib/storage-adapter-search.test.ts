import { describe, expect, it, vi } from "vitest";

import {
  DbStorageAdapter,
  DiskStorageAdapter,
  queryWorkspaceIndex,
  searchMarkdown,
} from "@/lib/storage";

const now = "2026-04-30T00:00:00.000Z";

function dbFile(overrides: Record<string, unknown> = {}) {
  return {
    id: "file-1",
    name: "Project Plan",
    content: "<p>Alpha roadmap</p>",
    content_markdown: "Alpha roadmap",
    is_folder: false,
    parent_id: null,
    position: 0,
    is_favorite: false,
    icon: null,
    cover_image_url: null,
    cover_position: 0.5,
    created_at: now,
    updated_at: now,
    word_count: 2,
    preview: "Alpha roadmap",
    ...overrides,
  };
}

describe("storage search helpers", () => {
  it("queries the DB workspace index from listFiles without changing file-store callers", async () => {
    const adapter = new DbStorageAdapter({
      apiClient: {
        listFiles: vi
          .fn()
          .mockResolvedValue([
            dbFile(),
            dbFile({ id: "folder-1", name: "Archive", is_folder: true }),
            dbFile({ id: "file-2", name: "Meeting Notes", preview: "Beta notes" }),
          ]),
        getFile: vi.fn(),
        createFile: vi.fn(),
        updateFile: vi.fn(),
        createFolder: vi.fn(),
        moveFile: vi.fn(),
        deleteFile: vi.fn(),
        searchFiles: vi.fn(),
      },
    });

    const results = await queryWorkspaceIndex(adapter, { query: "project" });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "file-1",
      kind: "document",
      title: "Project Plan",
    });
  });

  it("maps DB markdown search results onto storage result types", async () => {
    const searchFiles = vi.fn().mockResolvedValue({
      results: [
        {
          id: "hit-1",
          content: "Alpha roadmap",
          metadata: {
            file_id: "file-1",
            chunk_index: 0,
            name: "Project Plan",
            start: 2,
            end: 7,
          },
          distance: 0.25,
        },
      ],
    });
    const adapter = new DbStorageAdapter({
      apiClient: {
        listFiles: vi.fn(),
        getFile: vi.fn(),
        createFile: vi.fn(),
        updateFile: vi.fn(),
        createFolder: vi.fn(),
        moveFile: vi.fn(),
        deleteFile: vi.fn(),
        searchFiles,
      },
    });

    const results = await searchMarkdown(adapter, "Alpha", { fileIds: ["file-1"], limit: 10 });

    expect(searchFiles).toHaveBeenCalledWith("Alpha", ["file-1"], 10, undefined);
    expect(results.results[0]).toMatchObject({
      id: "hit-1",
      content: "Alpha roadmap",
      metadata: {
        fileId: "file-1",
        name: "Project Plan",
        start: 2,
        end: 7,
        chunkIndex: 0,
      },
      score: 0.75,
    });
  });

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
        name: "Project.md",
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
