import { describe, expect, it } from "vitest";

import {
  duplicateNames,
  quickSwitcherFolder,
  searchQuickSwitcherFiles,
} from "@/lib/quick-switcher-search";
import type { FileItem } from "@/types";

function page(name: string, relPath: string): FileItem {
  return {
    id: relPath,
    name,
    content: "",
    isFolder: false,
    parentId: null,
    position: 0,
    isFavorite: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    wordCount: 0,
    preview: "",
    documentType: "markdown",
    storageHandle: { mode: "disk", id: relPath, kind: "document", path: relPath, relPath },
  };
}

const files = [
  page("Roadmap", "Projects/Roadmap.md"),
  page("Roadmap", "Personal/Roadmap.md"),
  page("Retro notes", "Meetings/Retro notes.md"),
  page("标题设计", "Design/标题设计.md"),
];

describe("searchQuickSwitcherFiles", () => {
  it("keeps the caller's recency order when there is no query", () => {
    expect(searchQuickSwitcherFiles(files, "   ")).toEqual(files);
  });

  it("ranks a filename prefix above everything else", () => {
    expect(searchQuickSwitcherFiles(files, "road").map((f) => f.storageHandle?.relPath)).toEqual([
      "Projects/Roadmap.md",
      "Personal/Roadmap.md",
    ]);
  });

  it("matches word initials and a subsequence, like the slash menu", () => {
    expect(searchQuickSwitcherFiles(files, "rn")[0]?.name).toBe("Retro notes");
    expect(searchQuickSwitcherFiles(files, "rtro")[0]?.name).toBe("Retro notes");
  });

  it("matches on the folder path, but never above the filename itself", () => {
    const byFolder = searchQuickSwitcherFiles(files, "meetings");
    expect(byFolder.map((f) => f.name)).toEqual(["Retro notes"]);

    // "personal" only appears in a path, so it must not outrank a Page actually named Roadmap.
    const both = searchQuickSwitcherFiles(files, "roadmap");
    expect(both[0]?.name).toBe("Roadmap");
  });

  it("matches CJK by substring", () => {
    expect(searchQuickSwitcherFiles(files, "标题")[0]?.name).toBe("标题设计");
  });

  it("returns nothing when a query matches nothing, so the caller can offer to create", () => {
    expect(searchQuickSwitcherFiles(files, "zzzz")).toEqual([]);
  });
});

describe("quickSwitcherFolder / duplicateNames", () => {
  it("reports the containing folder, and nothing for a root Page", () => {
    expect(quickSwitcherFolder(files[0])).toBe("Projects");
    expect(quickSwitcherFolder(page("Inbox", "Inbox.md"))).toBe("");
  });

  it("flags only the names that actually repeat", () => {
    const repeated = duplicateNames(files);
    expect(repeated.has("roadmap")).toBe(true);
    expect(repeated.has("retro notes")).toBe(false);
  });
});
