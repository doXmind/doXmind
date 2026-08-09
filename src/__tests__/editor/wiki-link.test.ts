import { describe, expect, it } from "vitest";

import { resolveWikiLinkTarget, workspaceWikiPages } from "@/editor/markdown-block/wiki-link";
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

describe("resolveWikiLinkTarget", () => {
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

describe("workspaceWikiPages", () => {
  it("titles a Page from frontmatter, then preview, then its filename", () => {
    const titled = {
      ...page("titled", "Specs/Canonical.md"),
      meta: { id: "titled", title: "Project Atlas" },
    };
    const previewed = { ...page("previewed", "Notes/Today.md"), preview: "Today's standup" };
    const bare = page("bare", "Roadmap.md");
    const files = [titled, previewed, bare];

    expect(workspaceWikiPages(files)).toEqual([
      { id: "titled", path: "specs/canonical", title: "Project Atlas", aliases: [] },
      { id: "previewed", path: "notes/today", title: "Today's standup", aliases: [] },
      { id: "bare", path: "roadmap", title: "roadmap", aliases: [] },
    ]);
  });

  it("drops folders and non-Markdown attachments — neither is a link target", () => {
    const folder = { ...page("folder", "Projects"), isFolder: true };
    const attachment = { ...page("pdf", "Spec.pdf"), documentType: "pdf" as const };
    const files = [folder, attachment, page("note", "Note.md")];

    expect(workspaceWikiPages(files).map((candidate) => candidate.id)).toEqual(["note"]);
  });

  it("carries frontmatter aliases through, blank ones dropped", () => {
    const aliased = {
      ...page("aliased", "Glossary.md"),
      meta: {
        id: "aliased",
        title: "Glossary",
        // Frontmatter is untrusted YAML — a stray non-string entry has to be dropped, not thrown.
        aliases: ["Terms", "  ", 42, "Dictionary"] as unknown as string[],
      },
    };

    expect(workspaceWikiPages([aliased])[0].aliases).toEqual(["Terms", "Dictionary"]);
  });
});
