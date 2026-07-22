import { describe, expect, it, vi } from "vitest";

import {
  buildKnowledgeIndex,
  buildKnowledgeSourceCatalog,
  resolveKnowledgeWikiPage,
} from "@/lib/knowledge-index";
import type {
  DocumentContent,
  DocumentHandle,
  StorageAdapter,
  WorkspaceDocumentType,
  WorkspaceEntry,
} from "@/lib/storage";

const NOW = "2026-07-21T00:00:00.000Z";

function pageEntry(
  id: string,
  path: string,
  documentType: WorkspaceDocumentType = "markdown"
): WorkspaceEntry {
  const name = path.split("/").at(-1) ?? path;
  return {
    handle: {
      mode: "disk",
      id,
      kind: "document",
      documentType,
      path,
      relPath: path,
    },
    kind: "document",
    name,
    parent: null,
    position: 0,
    createdAt: NOW,
    updatedAt: NOW,
    documentType,
  };
}

function content(
  entry: WorkspaceEntry,
  markdown: string,
  meta: Record<string, unknown> = {}
): DocumentContent {
  return {
    handle: entry.handle,
    name: entry.name,
    markdown,
    meta: { id: entry.handle.id, ...meta },
    documentType: entry.documentType,
    updatedAt: NOW,
  };
}

function adapterFixture(
  entries: WorkspaceEntry[],
  documents: Map<string, DocumentContent>
): Pick<StorageAdapter, "list" | "read"> & {
  list: ReturnType<typeof vi.fn>;
  read: ReturnType<typeof vi.fn>;
} {
  const list = vi.fn(async () => entries);
  const read = vi.fn(async (handle: DocumentHandle) => {
    const document = documents.get(handle.id);
    if (!document) throw new Error(`missing fixture document: ${handle.id}`);
    return document;
  });
  return { list, read };
}

describe("buildKnowledgeIndex", () => {
  it("exposes canonical Page bodies through the read-only source index", async () => {
    const source = pageEntry("source", "Notes/Source.md");
    const target = pageEntry("target", "Notes/Target.md");
    const adapter = adapterFixture(
      [source, target],
      new Map([
        [source.handle.id, content(source, "![[Target]]\r\n")],
        [target.handle.id, content(target, "# Target\r\n\r\nExact source.\r\n")],
      ])
    );

    const index = await buildKnowledgeSourceCatalog(adapter);

    expect(index.sourcePages).toEqual([
      expect.objectContaining({ id: "source", markdown: "![[Target]]\r\n" }),
      expect.objectContaining({ id: "target", markdown: "# Target\r\n\r\nExact source.\r\n" }),
    ]);
    expect(adapter.list).toHaveBeenCalledOnce();
    expect(adapter.read).toHaveBeenCalledTimes(2);
    expect(Object.keys(index).sort()).toEqual(["catalogPages", "pages", "sourcePages"]);
  });

  it("shares deterministic path, title, alias, and ambiguity resolution", () => {
    const pages = [
      { id: "source", path: "Notes/Today.md", title: "Today", aliases: [] },
      { id: "roadmap", path: "Notes/Roadmap.md", title: "产品路线", aliases: ["Plan"] },
      { id: "other-plan", path: "Archive/Plan.md", title: "Old plan", aliases: [] },
      { id: "secret", path: "Secret.md", title: "Secret", aliases: [] },
    ];

    expect(resolveKnowledgeWikiPage(pages, "Notes/Today.md", "Roadmap").page?.id).toBe("roadmap");
    expect(resolveKnowledgeWikiPage(pages, "Notes/Today.md", "产品路线").page?.id).toBe("roadmap");
    expect(resolveKnowledgeWikiPage(pages, "Notes/Today.md", "Plan").status).toBe("ambiguous");
    expect(resolveKnowledgeWikiPage(pages, "Notes/Today.md", "Missing").status).toBe("unresolved");
    expect(resolveKnowledgeWikiPage(pages, "Today.md", "../Secret").status).toBe("unresolved");
    expect(resolveKnowledgeWikiPage(pages, "Today.md", "../../Secret").status).toBe("unresolved");
  });

  it("derives a plain-text unlinked mention with its exact UTF-16 source range", async () => {
    const source = pageEntry("source", "Notes/Source.md");
    const target = pageEntry("target", "Notes/Target.md");
    const markdown = "😀 Target is discussed. [[Target]] is already linked.";
    const adapter = adapterFixture(
      [source, target],
      new Map([
        [source.handle.id, content(source, markdown)],
        [target.handle.id, content(target, "Target describes itself.")],
      ])
    );

    const index = await buildKnowledgeIndex(adapter);

    const from = markdown.indexOf("Target");
    expect(index.unlinkedMentions).toEqual([
      {
        sourceId: "source",
        sourcePath: "Notes/Source.md",
        targetId: "target",
        targetPath: "Notes/Target.md",
        text: "Target",
        range: { from, to: from + "Target".length },
      },
    ]);
  });

  it("does not mention the same normalized Page path when runtime IDs differ", async () => {
    const source = pageEntry("transient-source", "Notes/Self.md");
    const duplicateHandle = pageEntry("path:notes/self.md", "Notes/./Self.md");
    const markdown = "Mirror describes this Page.";
    const adapter = adapterFixture(
      [source, duplicateHandle],
      new Map([
        [source.handle.id, content(source, markdown, { title: "Self" })],
        [
          duplicateHandle.handle.id,
          content(duplicateHandle, "Same Page through another handle.", {
            title: "Mirror",
          }),
        ],
      ])
    );

    const index = await buildKnowledgeIndex(adapter);

    expect(index.unlinkedMentions).toEqual([]);
  });

  it("does not derive mentions from ambiguous titles, aliases, or file stems", async () => {
    const source = pageEntry("source", "Source.md");
    const titled = pageEntry("titled", "Pages/Titled.md");
    const titleAliasCollision = pageEntry("title-alias", "Pages/Title Alias.md");
    const aliased = pageEntry("aliased", "Pages/Aliased.md");
    const aliasTitleCollision = pageEntry("alias-title", "Pages/Alias Title.md");
    const firstStem = pageEntry("first-stem", "Work/Shared Stem.md");
    const secondStem = pageEntry("second-stem", "Personal/Shared Stem.md");
    const markdown = "Shared Title; Shared Alias; Shared Stem.";
    const entries = [
      source,
      titled,
      titleAliasCollision,
      aliased,
      aliasTitleCollision,
      firstStem,
      secondStem,
    ];
    const adapter = adapterFixture(
      entries,
      new Map([
        [source.handle.id, content(source, markdown)],
        [titled.handle.id, content(titled, "Details", { title: "Shared Title" })],
        [
          titleAliasCollision.handle.id,
          content(titleAliasCollision, "Details", { aliases: ["Shared Title"] }),
        ],
        [aliased.handle.id, content(aliased, "Details", { aliases: ["Shared Alias"] })],
        [
          aliasTitleCollision.handle.id,
          content(aliasTitleCollision, "Details", { title: "Shared Alias" }),
        ],
        [firstStem.handle.id, content(firstStem, "Details")],
        [secondStem.handle.id, content(secondStem, "Details")],
      ])
    );

    const index = await buildKnowledgeIndex(adapter);

    expect(index.unlinkedMentions).toEqual([]);
  });

  it("counts only plain prose, not names already inside links, images, code, or comments", async () => {
    const source = pageEntry("source", "Source.md");
    const target = pageEntry("target", "Target.md");
    const markdown = [
      "Target in prose.",
      "[[Target]]",
      "[Target](Target.md)",
      "[Target](https://example.com)",
      "![Target](image.png)",
      "`Target`",
      "<!-- Target -->",
      "```md",
      "Target",
      "```",
    ].join("\n");
    const adapter = adapterFixture(
      [source, target],
      new Map([
        [source.handle.id, content(source, markdown)],
        [target.handle.id, content(target, "# Target")],
      ])
    );

    const index = await buildKnowledgeIndex(adapter);

    expect(index.unlinkedMentions.map((mention) => mention.range.from)).toEqual([
      markdown.indexOf("Target"),
    ]);
  });

  it("does not treat reference links, autolinks, or bare URLs as plain mentions", async () => {
    const source = pageEntry("source", "Source.md");
    const target = pageEntry("target", "Target.md");
    const markdown = [
      "Target in prose.",
      "[Target][external]",
      "[external]: https://example.com/Target",
      "<https://example.com/Target>",
      "https://example.com/Target",
    ].join("\n");
    const adapter = adapterFixture(
      [source, target],
      new Map([
        [source.handle.id, content(source, markdown)],
        [target.handle.id, content(target, "Details")],
      ])
    );

    const index = await buildKnowledgeIndex(adapter);

    expect(index.unlinkedMentions.map((mention) => mention.range.from)).toEqual([
      markdown.indexOf("Target"),
    ]);
  });

  it("chooses the longest unique Page name when mention candidates overlap", async () => {
    const source = pageEntry("source", "Source.md");
    const plan = pageEntry("plan", "Plan.md");
    const planB = pageEntry("plan-b", "Plan B.md");
    const markdown = "Review Plan B today.";
    const adapter = adapterFixture(
      [source, plan, planB],
      new Map([
        [source.handle.id, content(source, markdown)],
        [plan.handle.id, content(plan, "Details")],
        [planB.handle.id, content(planB, "Details")],
      ])
    );

    const index = await buildKnowledgeIndex(adapter);

    expect(index.unlinkedMentions).toEqual([
      expect.objectContaining({ targetId: "plan-b", text: "Plan B" }),
    ]);
  });

  it("applies token boundaries to the Latin edge of a mixed CJK Page name", async () => {
    const source = pageEntry("source", "Source.md");
    const target = pageEntry("target", "Project计划.md");
    const markdown = "MyProject计划X；Project计划推进";
    const adapter = adapterFixture(
      [source, target],
      new Map([
        [source.handle.id, content(source, markdown)],
        [target.handle.id, content(target, "Details")],
      ])
    );

    const index = await buildKnowledgeIndex(adapter);

    expect(index.unlinkedMentions.map((mention) => mention.range.from)).toEqual([
      markdown.lastIndexOf("Project计划"),
    ]);
  });

  it("derives a resolved Wiki Link and backlink with its exact UTF-16 source range", async () => {
    const source = pageEntry("source", "Notes/Today.md");
    const target = pageEntry("target", "Notes/Roadmap.markdown");
    const markdown = "See [[Roadmap#Milestones|the plan]] today.";
    const adapter = adapterFixture(
      [source, target],
      new Map([
        [source.handle.id, content(source, markdown)],
        [target.handle.id, content(target, "# Roadmap")],
      ])
    );

    const index = await buildKnowledgeIndex(adapter);

    const from = markdown.indexOf("[[");
    const to = from + "[[Roadmap#Milestones|the plan]]".length;
    expect(index.links).toEqual([
      {
        kind: "wiki",
        sourceId: "source",
        sourcePath: "Notes/Today.md",
        targetId: "target",
        targetPath: "Notes/Roadmap.markdown",
        targetText: "Roadmap",
        alias: "the plan",
        fragment: "#Milestones",
        status: "resolved",
        range: { from, to },
      },
    ]);
    expect(index.backlinks).toEqual([
      {
        targetId: "target",
        targetPath: "Notes/Roadmap.markdown",
        links: index.links,
      },
    ]);
    expect(markdown.slice(from, to)).toBe("[[Roadmap#Milestones|the plan]]");
  });

  it("treats a source-backed embed as a backlink without consuming its bang marker", async () => {
    const source = pageEntry("source", "Notes/Today.md");
    const target = pageEntry("target", "Notes/Roadmap.md");
    const markdown = "![[Roadmap#Milestones|release view]]";
    const adapter = adapterFixture(
      [source, target],
      new Map([
        [source.handle.id, content(source, markdown)],
        [target.handle.id, content(target, "# Roadmap\n## Milestones\n")],
      ])
    );

    const index = await buildKnowledgeIndex(adapter);

    expect(index.links).toEqual([
      expect.objectContaining({
        sourceId: "source",
        targetId: "target",
        fragment: "#Milestones",
        alias: "release view",
        range: { from: 1, to: markdown.length },
      }),
    ]);
    expect(index.backlinks[0]?.links).toEqual(index.links);
    expect(markdown[0]).toBe("!");
    expect(markdown.slice(index.links[0].range.from, index.links[0].range.to)).toBe(
      "[[Roadmap#Milestones|release view]]"
    );
  });

  it("rebuilds deterministically with one scan, reads only Pages, and performs no writes", async () => {
    const page = pageEntry("path:Notes/Page.md", "Notes/Page.md");
    const attachment = pageEntry("attachment", "Notes/Plan.pdf", "pdf");
    const legacyArtifact = pageEntry("artifact", "Notes/.Page.doxmind.lock.markdown");
    const adapter = Object.assign(
      adapterFixture(
        [attachment, legacyArtifact, page],
        new Map([[page.handle.id, content(page, "No links", { id: "duplicate-authored-id" })]])
      ),
      {
        write: vi.fn(),
        create: vi.fn(),
        rename: vi.fn(),
        move: vi.fn(),
        delete: vi.fn(),
      }
    );

    const first = await buildKnowledgeIndex(adapter);
    const second = await buildKnowledgeIndex(adapter);

    expect(second).toEqual(first);
    expect(first.pages).toEqual([
      { id: "path:Notes/Page.md", path: "Notes/Page.md", title: "Page", aliases: [] },
    ]);
    expect(adapter.list).toHaveBeenCalledTimes(2);
    expect(adapter.read).toHaveBeenCalledTimes(2);
    expect(adapter.read).toHaveBeenNthCalledWith(1, page.handle);
    expect(adapter.read).toHaveBeenNthCalledWith(2, page.handle);
    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.create).not.toHaveBeenCalled();
    expect(adapter.rename).not.toHaveBeenCalled();
    expect(adapter.move).not.toHaveBeenCalled();
    expect(adapter.delete).not.toHaveBeenCalled();
  });

  it("fails the rebuild when any Page cannot be read instead of returning an incomplete index", async () => {
    const readable = pageEntry("readable", "A.md");
    const unreadable = pageEntry("unreadable", "B.md");
    const adapter = adapterFixture(
      [readable, unreadable],
      new Map([[readable.handle.id, content(readable, "[[B]]")]])
    );

    await expect(buildKnowledgeIndex(adapter)).rejects.toThrow(
      "missing fixture document: unreadable"
    );
  });

  it("distinguishes ambiguous bare names, qualified paths, and frontmatter aliases", async () => {
    const source = pageEntry("source", "Today.md");
    const work = pageEntry("path:Work/Roadmap.md", "Work/Roadmap.md");
    const personal = pageEntry("path:Personal/Roadmap.md", "Personal/Roadmap.md");
    const aliased = pageEntry("atlas-page", "Specs/Canonical.md");
    const markdown = "[[Roadmap]] [[Work/Roadmap#Q1]] [[Missing/Roadmap]] [[Project Atlas|Atlas]].";
    const adapter = adapterFixture(
      [personal, aliased, source, work],
      new Map([
        [source.handle.id, content(source, markdown)],
        [work.handle.id, content(work, "Work", { id: "duplicate-authored-id" })],
        [personal.handle.id, content(personal, "Personal", { id: "duplicate-authored-id" })],
        [aliased.handle.id, content(aliased, "Atlas", { aliases: ["Project Atlas"] })],
      ])
    );

    const index = await buildKnowledgeIndex(adapter);

    expect(
      index.links.map(({ targetText, targetId, targetPath, status, fragment, alias }) => ({
        targetText,
        targetId,
        targetPath,
        status,
        fragment,
        alias,
      }))
    ).toEqual([
      {
        targetText: "Roadmap",
        targetId: null,
        targetPath: null,
        status: "ambiguous",
        fragment: null,
        alias: null,
      },
      {
        targetText: "Work/Roadmap",
        targetId: "path:Work/Roadmap.md",
        targetPath: "Work/Roadmap.md",
        status: "resolved",
        fragment: "#Q1",
        alias: null,
      },
      {
        targetText: "Missing/Roadmap",
        targetId: null,
        targetPath: null,
        status: "unresolved",
        fragment: null,
        alias: null,
      },
      {
        targetText: "Project Atlas",
        targetId: "atlas-page",
        targetPath: "Specs/Canonical.md",
        status: "resolved",
        fragment: null,
        alias: "Atlas",
      },
    ]);
  });

  it("ignores links inside fenced, indented and inline code, comments, and raw HTML", async () => {
    const source = pageEntry("source", "Source.md");
    const visible = pageEntry("visible", "Visible.md");
    const markdown = [
      "😀 [[Visible]]",
      "",
      "`[[Inline]]` and ``[[Inline Two]]``",
      "",
      "```md",
      "[[Fenced]]",
      "```",
      "",
      "    [[Indented]]",
      "",
      "<!-- [[Comment]] -->",
      "<!--",
      "[[Multiline Comment]]",
      "-->",
      "",
      '<div data-ref="![[Visible#Heading|raw attribute]]">',
      "[[Visible]] raw body",
      "</div>",
      "",
      "<script>",
      'const example = "[[Visible]]";',
      "</script>",
    ].join("\n");
    const adapter = adapterFixture(
      [source, visible],
      new Map([
        [source.handle.id, content(source, markdown)],
        [visible.handle.id, content(visible, "Visible")],
      ])
    );

    const index = await buildKnowledgeIndex(adapter);

    const from = markdown.indexOf("[[Visible]]");
    expect(index.links).toHaveLength(1);
    expect(index.links[0]).toMatchObject({
      targetId: "visible",
      status: "resolved",
      range: { from, to: from + "[[Visible]]".length },
    });
    // The leading emoji occupies two UTF-16 code units, matching DOM selection offsets.
    expect(from).toBe(3);
  });

  it("does not index escaped Wiki or Markdown link literals", async () => {
    const source = pageEntry("source", "Source.md");
    const target = pageEntry("target", "Target.md");
    const markdown = String.raw`\[[Target]] and \[Target](./Target.md)`;
    const adapter = adapterFixture(
      [source, target],
      new Map([
        [source.handle.id, content(source, markdown)],
        [target.handle.id, content(target, "Target")],
      ])
    );

    const index = await buildKnowledgeIndex(adapter);

    expect(index.links).toEqual([]);
    expect(index.backlinks).toEqual([]);
  });

  it("indexes standard relative Markdown Page links without treating attachments or URLs as links", async () => {
    const source = pageEntry("source", "Notes/Daily/Today.md");
    const roadmap = pageEntry("roadmap", "Notes/Roadmap.md");
    const root = pageEntry("root", "Root.markdown");
    const spaced = pageEntry("spaced", "Notes/Daily/With Space.md");
    const markdown = [
      "[Roadmap](../Roadmap.md#Q1)",
      "[Root](../../Root.markdown)",
      "[Space](<./With Space.md>)",
      "[Missing](../Missing.md)",
      "[External](https://example.com/Outside.md)",
      "[Attachment](../Plan.pdf)",
      "[Escapes workspace](../../../Root.markdown)",
      "[Absolute](/Root.markdown)",
      "[Same-page anchor](#Heading)",
      "![Image](../Image.md)",
    ].join("\n");
    const adapter = adapterFixture(
      [source, roadmap, root, spaced],
      new Map([
        [source.handle.id, content(source, markdown)],
        [roadmap.handle.id, content(roadmap, "Roadmap")],
        [root.handle.id, content(root, "Root")],
        [spaced.handle.id, content(spaced, "Space")],
      ])
    );

    const index = await buildKnowledgeIndex(adapter);

    expect(
      index.links.map(({ kind, alias, fragment, targetId, targetPath, status }) => ({
        kind,
        alias,
        fragment,
        targetId,
        targetPath,
        status,
      }))
    ).toEqual([
      {
        kind: "markdown",
        alias: "Roadmap",
        fragment: "#Q1",
        targetId: "roadmap",
        targetPath: "Notes/Roadmap.md",
        status: "resolved",
      },
      {
        kind: "markdown",
        alias: "Root",
        fragment: null,
        targetId: "root",
        targetPath: "Root.markdown",
        status: "resolved",
      },
      {
        kind: "markdown",
        alias: "Space",
        fragment: null,
        targetId: "spaced",
        targetPath: "Notes/Daily/With Space.md",
        status: "resolved",
      },
      {
        kind: "markdown",
        alias: "Missing",
        fragment: null,
        targetId: null,
        targetPath: null,
        status: "unresolved",
      },
      {
        kind: "markdown",
        alias: "Escapes workspace",
        fragment: null,
        targetId: null,
        targetPath: null,
        status: "unresolved",
      },
    ]);
    expect(markdown.slice(index.links[0].range.from, index.links[0].range.to)).toBe(
      "[Roadmap](../Roadmap.md#Q1)"
    );
  });

  it("sorts backlinks stably by source path and UTF-16 range across repeated rebuilds", async () => {
    const target = pageEntry("target", "Target.md");
    const laterSource = pageEntry("later", "Zed.md");
    const earlierSource = pageEntry("earlier", "Alpha.md");
    const laterMarkdown = "first [[Target]] then [[Target]]";
    const earlierMarkdown = "😀 [[Target]]";
    const adapter = adapterFixture(
      [laterSource, target, earlierSource],
      new Map([
        [target.handle.id, content(target, "Target")],
        [laterSource.handle.id, content(laterSource, laterMarkdown)],
        [earlierSource.handle.id, content(earlierSource, earlierMarkdown)],
      ])
    );

    const first = await buildKnowledgeIndex(adapter);
    const second = await buildKnowledgeIndex(adapter);

    expect(second).toEqual(first);
    expect(first.backlinks[0].links.map((link) => [link.sourcePath, link.range.from])).toEqual([
      ["Alpha.md", earlierMarkdown.indexOf("[[Target]]")],
      ["Zed.md", laterMarkdown.indexOf("[[Target]]")],
      ["Zed.md", laterMarkdown.lastIndexOf("[[Target]]")],
    ]);
  });
});
