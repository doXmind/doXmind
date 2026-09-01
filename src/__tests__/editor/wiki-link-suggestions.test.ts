import { describe, expect, it } from "vitest";

import {
  searchWikiLinkPages,
  wikiLinkPages,
  wikiLinkSource,
} from "@/editor/markdown-block/wiki-link-suggestions";
import type { FileItem } from "@/types";

function file(id: string, relPath: string, extra: Partial<FileItem> = {}): FileItem {
  const name =
    relPath
      .split("/")
      .at(-1)
      ?.replace(/\.(md|markdown)$/i, "") ?? relPath;
  return {
    id,
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
    storageHandle: { mode: "disk", id, kind: "document", path: relPath, relPath },
    ...extra,
  };
}

const files: FileItem[] = [
  file("a", "Projects/Roadmap.md", { meta: { id: "a", aliases: ["Q3 Plan"] } }),
  file("b", "Personal/Roadmap.md"),
  file("c", "Retro notes.md"),
  file("d", "assets/diagram.png", { documentType: undefined, isAsset: true }),
  file("e", "Archive", { isFolder: true }),
  file("f", "Spec.pdf", { documentType: "pdf" }),
];

describe("wikiLinkPages", () => {
  it("offers only Pages, so a suggestion can never fail to resolve", () => {
    expect(wikiLinkPages(files).map((page) => page.path)).toEqual([
      "Projects/Roadmap",
      "Personal/Roadmap",
      "Retro notes",
    ]);
  });

  it("splits name from folder and drops the Markdown extension", () => {
    const [first, , root] = wikiLinkPages(files);
    expect(first).toMatchObject({ name: "Roadmap", folder: "Projects" });
    expect(root).toMatchObject({ name: "Retro notes", folder: "" });
  });
});

describe("searchWikiLinkPages", () => {
  const pages = wikiLinkPages(files);

  it("lists everything for a bare `[[`, so it is a browsable index", () => {
    expect(searchWikiLinkPages(pages, "")).toHaveLength(3);
  });

  it("ranks a name prefix first, then initials and subsequence", () => {
    expect(searchWikiLinkPages(pages, "road")[0]?.name).toBe("Roadmap");
    expect(searchWikiLinkPages(pages, "rn")[0]?.name).toBe("Retro notes");
  });

  it("matches an alias the resolver would follow anyway", () => {
    expect(searchWikiLinkPages(pages, "q3")[0]?.path).toBe("Projects/Roadmap");
  });

  it("returns nothing when no Page matches", () => {
    expect(searchWikiLinkPages(pages, "zzz")).toEqual([]);
  });
});

describe("wikiLinkSource", () => {
  const pages = wikiLinkPages(files);

  it("writes the bare name when it is unique", () => {
    const retro = pages.find((page) => page.name === "Retro notes")!;
    expect(wikiLinkSource(retro, pages)).toBe("[[Retro notes]]");
  });

  it("writes the path when the name is not, so the chosen row is the one that resolves", () => {
    const projects = pages.find((page) => page.path === "Projects/Roadmap")!;
    expect(wikiLinkSource(projects, pages)).toBe("[[Projects/Roadmap]]");
  });
});
