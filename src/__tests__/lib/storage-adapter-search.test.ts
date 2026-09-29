import { describe, expect, it, vi } from "vitest";

import { DiskStorageAdapter, searchMarkdown } from "@/lib/storage";
import { useWorkspaceSettingsStore } from "@/stores/workspace-settings-store";

describe("storage search helpers", () => {
  it("searches disk markdown through workspace search commands", async () => {
    const invokeMock = vi.fn(async (command: string, payload: Record<string, unknown>) => {
      if (command === "workspace_markdown_search") {
        expect(payload).toEqual({
          root: "/workspace",
          query: "roadmap",
          limit: 5,
          excludeDirs: [],
        });
        return [
          {
            id: "doc-1",
            path: "Project.md",
            name: "Project.md",
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
    expect(invokeMock).not.toHaveBeenCalledWith("workspace_scan", expect.anything());
    expect(invokeMock).toHaveBeenCalledWith("workspace_markdown_search", {
      root: "/workspace",
      query: "roadmap",
      limit: 5,
      excludeDirs: [],
    });
  });

  it("passes excluded directory names into native Markdown search", async () => {
    useWorkspaceSettingsStore.getState().setExcludedScanDirs(["archive"]);
    const invoke = vi.fn(async () => []);
    const adapter = new DiskStorageAdapter({ root: "/workspace", invoke: invoke as never });

    await adapter.searchMarkdown("roadmap");

    expect(invoke).toHaveBeenCalledWith(
      "workspace_markdown_search",
      expect.objectContaining({ excludeDirs: ["archive"] })
    );
    useWorkspaceSettingsStore.getState().setExcludedScanDirs([]);
  });
});
