import { describe, expect, it } from "vitest";

import { resolveWikiLinkTarget } from "@/editor/markdown-block/wiki-link";
import type { FileItem } from "@/stores/file-store";

function page(id: string, relPath: string): FileItem {
  const name =
    relPath
      .split("/")
      .at(-1)
      ?.replace(/\.(?:md|markdown)$/i, "") ?? relPath;
  return {
    id,
    name,
    content: "",
    documentType: "markdown",
    storageHandle: {
      mode: "disk",
      id,
      kind: "document",
      documentType: "markdown",
      path: relPath,
      relPath,
    },
    isFolder: false,
    parentId: null,
    position: 0,
    isFavorite: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    wordCount: 0,
    preview: "",
  };
}

function asset(id: string, relPath: string): FileItem {
  return {
    ...page(id, relPath),
    name: relPath.split("/").at(-1) ?? relPath,
    documentType: undefined,
    isAsset: true,
    storageHandle: { mode: "disk", id, kind: "asset", path: relPath, relPath },
  };
}

describe("resolveWikiLinkTarget", () => {
  it("never resolves a Wiki Link to a workspace file", () => {
    // An asset carries no `documentType`, which is also what an unopened Page looks like — so
    // without an explicit guard `[[diagram]]` would resolve to the image and try to open it.
    const files = [
      page("home", "Home.md"),
      asset("asset:assets/diagram.png", "assets/diagram.png"),
    ];

    expect(resolveWikiLinkTarget(files, "home", "diagram")).toBe(null);
    expect(resolveWikiLinkTarget(files, "home", "assets/diagram.png")).toBe(null);
  });

  it("resolves case-insensitive Page names and ignores heading fragments", () => {
    const files = [page("home", "Home.md"), page("roadmap", "Projects/Roadmap.md")];

    expect(resolveWikiLinkTarget(files, "home", "roadMAP#Milestones")?.id).toBe("roadmap");
  });

  it("resolves a relative Page path from the current Page folder", () => {
    const files = [
      page("current", "Projects/Notes/Today.md"),
      page("roadmap", "Projects/Roadmap.md"),
      page("root-roadmap", "Roadmap.md"),
    ];

    expect(resolveWikiLinkTarget(files, "current", "../Roadmap.md")?.id).toBe("roadmap");
  });

  it("prefers the unique same-folder Page when names repeat", () => {
    const files = [
      page("current", "Work/Today.md"),
      page("work-roadmap", "Work/Roadmap.md"),
      page("personal-roadmap", "Personal/Roadmap.md"),
      page("root-roadmap", "Roadmap.md"),
    ];

    expect(resolveWikiLinkTarget(files, "current", "Roadmap")?.id).toBe("work-roadmap");
  });

  it("refuses an ambiguous bare name and never resolves an attachment", () => {
    const attachment = { ...page("pdf", "Roadmap.pdf"), documentType: "pdf" as const };
    const files = [
      page("current", "Today.md"),
      page("one", "Work/Roadmap.md"),
      page("two", "Personal/Roadmap.md"),
      attachment,
    ];

    expect(resolveWikiLinkTarget(files, "current", "Roadmap")).toBeNull();
  });

  it("keeps a qualified path unresolved instead of falling back to its basename", () => {
    const files = [page("current", "Work/Today.md"), page("other-roadmap", "Personal/Roadmap.md")];

    expect(resolveWikiLinkTarget(files, "current", "Missing/Roadmap")).toBeNull();
    expect(resolveWikiLinkTarget(files, "current", "../Missing/Roadmap")).toBeNull();
  });

  it("matches with locale-independent casing", () => {
    const files = [page("current", "Today.md"), page("istanbul", "Istanbul.md")];

    expect(resolveWikiLinkTarget(files, "current", "istanbul")?.id).toBe("istanbul");
  });

  it("uses loaded frontmatter titles and aliases like the knowledge index", () => {
    const canonical = {
      ...page("canonical", "Specs/Canonical.md"),
      meta: { id: "canonical", title: "Project Atlas", aliases: ["Atlas"] },
    };
    const files = [page("current", "Today.md"), canonical];

    expect(resolveWikiLinkTarget(files, "current", "Atlas")?.id).toBe("canonical");
    expect(resolveWikiLinkTarget(files, "current", "Project Atlas")?.id).toBe("canonical");
  });
});
