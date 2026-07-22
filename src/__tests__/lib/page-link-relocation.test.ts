import { describe, expect, it, vi } from "vitest";

import { planFolderLinkRelocation, planPageLinkRelocation } from "@/lib/page-link-relocation";
import type {
  DocumentContent,
  DocumentHandle,
  StorageAdapter,
  WorkspaceEntry,
} from "@/lib/storage";

const NOW = "2026-07-22T00:00:00.000Z";

function pageEntry(id: string, path: string): WorkspaceEntry {
  const name = path.split("/").at(-1) ?? path;
  return {
    handle: {
      mode: "disk",
      id,
      kind: "document",
      documentType: "markdown",
      path,
      relPath: path,
    },
    kind: "document",
    name,
    parent: null,
    position: 0,
    createdAt: NOW,
    updatedAt: NOW,
    documentType: "markdown",
  };
}

function content(
  entry: WorkspaceEntry,
  markdown: string,
  revision: string,
  meta: Record<string, unknown> = {}
): DocumentContent {
  return {
    handle: entry.handle,
    name: entry.name,
    markdown,
    revision,
    meta: { id: entry.handle.id, ...meta },
    documentType: "markdown",
    updatedAt: NOW,
  };
}

function adapterFixture(entries: WorkspaceEntry[], documents: Map<string, DocumentContent>) {
  const list = vi.fn(async () => entries);
  const read = vi.fn(async (handle: DocumentHandle) => {
    const document = documents.get(handle.id);
    if (!document) throw new Error(`missing fixture document: ${handle.id}`);
    return document;
  });
  return {
    mode: "disk" as const,
    list,
    read,
    write: vi.fn(),
    create: vi.fn(),
    rename: vi.fn(),
    move: vi.fn(),
    delete: vi.fn(),
  } satisfies Pick<StorageAdapter, "mode" | "list" | "read"> & Record<string, unknown>;
}

describe("planPageLinkRelocation", () => {
  it("plans exact incoming Wiki and Markdown target replacements without touching code", async () => {
    const target = pageEntry("target", "Notes/Target.md");
    const daily = pageEntry("daily", "Notes/Daily.md");
    const dailyMarkdown = [
      "😀 [[Target#范围|阅读]] and [the label](<./Target.MD#Section>).",
      "`[[Target]] and [the label](<./Target.md>)`",
    ].join("\n");
    const adapter = adapterFixture(
      [target, daily],
      new Map([
        [target.handle.id, content(target, "# Target\n", "sha256:target")],
        [daily.handle.id, content(daily, dailyMarkdown, "sha256:daily")],
      ])
    );

    const plan = await planPageLinkRelocation(adapter, {
      pageId: target.handle.id,
      fromPath: "Notes/Target.md",
      toPath: "Archive/Roadmap.md",
    });

    const wikiFrom = dailyMarkdown.indexOf("Target");
    const markdownFrom = dailyMarkdown.indexOf("./Target.MD");
    expect(plan).toEqual({
      relocation: {
        pageId: "target",
        fromPath: "Notes/Target.md",
        toPath: "Archive/Roadmap.md",
        expectedRevision: "sha256:target",
      },
      writes: [
        {
          sourceId: "daily",
          sourcePath: "Notes/Daily.md",
          destinationPath: "Notes/Daily.md",
          expectedRevision: "sha256:daily",
          markdown: [
            "😀 [[../Archive/Roadmap#范围|阅读]] and [the label](<../Archive/Roadmap.MD#Section>).",
            "`[[Target]] and [the label](<./Target.md>)`",
          ].join("\n"),
          replacements: [
            {
              kind: "wiki",
              targetId: "target",
              range: { from: wikiFrom, to: wikiFrom + "Target".length },
              before: "Target",
              after: "../Archive/Roadmap",
            },
            {
              kind: "markdown",
              targetId: "target",
              range: { from: markdownFrom, to: markdownFrom + "./Target.MD".length },
              before: "./Target.MD",
              after: "../Archive/Roadmap.MD",
            },
          ],
        },
      ],
      skipped: [],
      checks: [
        { path: "Notes/Daily.md", expectedRevision: "sha256:daily" },
        { path: "Notes/Target.md", expectedRevision: "sha256:target" },
      ],
    });
    expect(adapter.list).toHaveBeenCalledTimes(1);
    expect(adapter.read).toHaveBeenCalledTimes(2);
    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.create).not.toHaveBeenCalled();
    expect(adapter.rename).not.toHaveBeenCalled();
    expect(adapter.move).not.toHaveBeenCalled();
    expect(adapter.delete).not.toHaveBeenCalled();
  });

  it("repairs an embed target while preserving its marker, fragment, and label", async () => {
    const target = pageEntry("target", "Notes/Target.md");
    const source = pageEntry("source", "Notes/Source.md");
    const markdown = "![[Target#范围|嵌入视图]]\n";
    const adapter = adapterFixture(
      [target, source],
      new Map([
        [target.handle.id, content(target, "# Target\n", "sha256:target")],
        [source.handle.id, content(source, markdown, "sha256:source")],
      ])
    );

    const plan = await planPageLinkRelocation(adapter, {
      pageId: "target",
      fromPath: "Notes/Target.md",
      toPath: "Archive/Roadmap.md",
    });

    expect(plan.writes).toEqual([
      expect.objectContaining({
        sourcePath: "Notes/Source.md",
        markdown: "![[../Archive/Roadmap#范围|嵌入视图]]\n",
        replacements: [
          expect.objectContaining({
            kind: "wiki",
            before: "Target",
            after: "../Archive/Roadmap",
          }),
        ],
      }),
    ]);
  });

  it("repairs only uniquely resolved links and reports an ambiguous candidate", async () => {
    const target = pageEntry("target", "Notes/Target.md");
    const duplicate = pageEntry("duplicate", "Other/Target.md");
    const daily = pageEntry("daily", "Daily.md");
    const markdown = "[[Target|ambiguous]] [exact](<./Notes/Target.md#Keep>)";
    const adapter = adapterFixture(
      [target, duplicate, daily],
      new Map([
        [target.handle.id, content(target, "Target", "sha256:target")],
        [duplicate.handle.id, content(duplicate, "Duplicate", "sha256:duplicate")],
        [daily.handle.id, content(daily, markdown, "sha256:daily")],
      ])
    );

    const plan = await planPageLinkRelocation(adapter, {
      pageId: "target",
      fromPath: "Notes/Target.md",
      toPath: "Archive/Roadmap.md",
    });

    expect(plan.writes).toEqual([
      expect.objectContaining({
        sourcePath: "Daily.md",
        markdown: "[[Target|ambiguous]] [exact](<Archive/Roadmap.md#Keep>)",
        replacements: [
          expect.objectContaining({
            kind: "markdown",
            before: "./Notes/Target.md",
            after: "Archive/Roadmap.md",
          }),
        ],
      }),
    ]);
    expect(plan.skipped).toEqual([
      {
        sourceId: "daily",
        sourcePath: "Daily.md",
        kind: "wiki",
        targetText: "Target",
        range: {
          from: markdown.indexOf("Target"),
          to: markdown.indexOf("Target") + "Target".length,
        },
        reason: "ambiguous",
      },
    ]);
  });

  it("repairs relative outgoing links inside the Page that is moving", async () => {
    const target = pageEntry("target", "Notes/Target.md");
    const companion = pageEntry("companion", "Notes/Companion.markdown");
    const markdown = "[[./Companion#Part|C]] and [C](./Companion.markdown#Part)";
    const adapter = adapterFixture(
      [target, companion],
      new Map([
        [target.handle.id, content(target, markdown, "sha256:target")],
        [companion.handle.id, content(companion, "Companion", "sha256:companion")],
      ])
    );

    const plan = await planPageLinkRelocation(adapter, {
      pageId: "target",
      fromPath: "Notes/Target.md",
      toPath: "Archive/Roadmap.md",
    });

    expect(plan.writes).toEqual([
      expect.objectContaining({
        sourceId: "target",
        sourcePath: "Notes/Target.md",
        destinationPath: "Archive/Roadmap.md",
        expectedRevision: "sha256:target",
        markdown: "[[../Notes/Companion#Part|C]] and [C](../Notes/Companion.markdown#Part)",
      }),
    ]);
  });

  it("leaves escaped link literals untouched", async () => {
    const target = pageEntry("target", "Notes/Target.md");
    const daily = pageEntry("daily", "Daily.md");
    const markdown = String.raw`\[[Target]] and \[Target](./Notes/Target.md)`;
    const adapter = adapterFixture(
      [target, daily],
      new Map([
        [target.handle.id, content(target, "Target", "sha256:target")],
        [daily.handle.id, content(daily, markdown, "sha256:daily")],
      ])
    );

    const plan = await planPageLinkRelocation(adapter, {
      pageId: "target",
      fromPath: "Notes/Target.md",
      toPath: "Archive/Roadmap.md",
    });

    expect(plan.writes).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it("leaves link-shaped literals inside unsupported raw HTML byte-for-byte untouched", async () => {
    const target = pageEntry("target", "Target.md");
    const raw = pageEntry("raw", "Raw.md");
    const markdown = [
      '<div data-ref="![[Target#Heading|raw attribute]]">',
      "[[Target]] raw body",
      "</div>",
      "",
      "<script>",
      'const example = "[[Target]]";',
      "</script>",
    ].join("\n");
    const adapter = adapterFixture(
      [target, raw],
      new Map([
        [target.handle.id, content(target, "Target", "sha256:target")],
        [raw.handle.id, content(raw, markdown, "sha256:raw")],
      ])
    );

    const plan = await planPageLinkRelocation(adapter, {
      pageId: "target",
      fromPath: "Target.md",
      toPath: "Archive/Renamed.md",
    });

    expect(plan.writes).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it("reports a link when the destination cannot be represented without changing Wiki syntax", async () => {
    const target = pageEntry("target", "Notes/Target.md");
    const daily = pageEntry("daily", "Daily.md");
    const markdown = "[[Notes/Target]]";
    const adapter = adapterFixture(
      [target, daily],
      new Map([
        [target.handle.id, content(target, "Target", "sha256:target")],
        [daily.handle.id, content(daily, markdown, "sha256:daily")],
      ])
    );

    const plan = await planPageLinkRelocation(adapter, {
      pageId: "target",
      fromPath: "Notes/Target.md",
      toPath: "Archive/Road#map.md",
    });

    expect(plan.writes).toEqual([]);
    expect(plan.skipped).toEqual([
      expect.objectContaining({
        sourceId: "daily",
        targetText: "Notes/Target",
        reason: "cannot-preserve-target",
      }),
    ]);
  });
});

describe("planFolderLinkRelocation", () => {
  it("repairs links from outside the moved subtree", async () => {
    const target = pageEntry("target", "Notes/Target.md");
    const daily = pageEntry("daily", "Daily.md");
    const markdown = "[[Notes/Target#Part|Target]] and [the label](<./Notes/Target.md#Part>)";
    const adapter = adapterFixture(
      [target, daily],
      new Map([
        [target.handle.id, content(target, "Target", "sha256:target")],
        [daily.handle.id, content(daily, markdown, "sha256:daily")],
      ])
    );

    const plan = await planFolderLinkRelocation(adapter, {
      fromPath: "Notes",
      toPath: "Archive/Notes",
    });

    expect(plan).toEqual({
      relocation: {
        fromPath: "Notes",
        toPath: "Archive/Notes",
        pages: [
          {
            pageId: "target",
            sourcePath: "Notes/Target.md",
            destinationPath: "Archive/Notes/Target.md",
            expectedRevision: "sha256:target",
          },
        ],
      },
      writes: [
        {
          sourceId: "daily",
          sourcePath: "Daily.md",
          destinationPath: "Daily.md",
          expectedRevision: "sha256:daily",
          markdown:
            "[[Archive/Notes/Target#Part|Target]] and [the label](<Archive/Notes/Target.md#Part>)",
          replacements: [
            expect.objectContaining({
              kind: "wiki",
              targetId: "target",
              before: "Notes/Target",
              after: "Archive/Notes/Target",
            }),
            expect.objectContaining({
              kind: "markdown",
              targetId: "target",
              before: "./Notes/Target.md",
              after: "Archive/Notes/Target.md",
            }),
          ],
        },
      ],
      skipped: [],
      checks: [
        { path: "Daily.md", expectedRevision: "sha256:daily" },
        { path: "Notes/Target.md", expectedRevision: "sha256:target" },
      ],
    });
  });

  it("repairs outgoing links whose source moves but target stays outside", async () => {
    const target = pageEntry("target", "Notes/Target.md");
    const reference = pageEntry("reference", "Reference.md");
    const markdown = "[[../Reference#Part|Ref]] and [Ref](../Reference.md#Part)";
    const adapter = adapterFixture(
      [target, reference],
      new Map([
        [target.handle.id, content(target, markdown, "sha256:target")],
        [reference.handle.id, content(reference, "Reference", "sha256:reference")],
      ])
    );

    const plan = await planFolderLinkRelocation(adapter, {
      fromPath: "Notes",
      toPath: "Archive/Notes",
    });

    expect(plan.writes).toEqual([
      expect.objectContaining({
        sourceId: "target",
        sourcePath: "Notes/Target.md",
        destinationPath: "Archive/Notes/Target.md",
        expectedRevision: "sha256:target",
        markdown: "[[../../Reference#Part|Ref]] and [Ref](../../Reference.md#Part)",
      }),
    ]);
  });

  it("leaves internal relative links byte-for-byte unchanged while checking every moved Page", async () => {
    const first = pageEntry("first", "Notes/A.md");
    const second = pageEntry("second", "Notes/B.md");
    const markdown = "[[./B#Part|B]] and [B](./B.md#Part)";
    const adapter = adapterFixture(
      [first, second],
      new Map([
        [first.handle.id, content(first, markdown, "sha256:a")],
        [second.handle.id, content(second, "B", "sha256:b")],
      ])
    );

    const plan = await planFolderLinkRelocation(adapter, {
      fromPath: "Notes",
      toPath: "Archive/Notes",
    });

    expect(plan.relocation.pages).toEqual([
      {
        pageId: "first",
        sourcePath: "Notes/A.md",
        destinationPath: "Archive/Notes/A.md",
        expectedRevision: "sha256:a",
      },
      {
        pageId: "second",
        sourcePath: "Notes/B.md",
        destinationPath: "Archive/Notes/B.md",
        expectedRevision: "sha256:b",
      },
    ]);
    expect(plan.writes).toEqual([]);
    expect(plan.checks).toEqual([
      { path: "Notes/A.md", expectedRevision: "sha256:a" },
      { path: "Notes/B.md", expectedRevision: "sha256:b" },
    ]);
  });

  it("reports ambiguous and unresolved affected links without rewriting them", async () => {
    const daily = pageEntry("daily", "Daily.md");
    const movingSource = pageEntry("moving-source", "Notes/A.md");
    const movingTarget = pageEntry("moving-target", "Notes/Target.md");
    const duplicate = pageEntry("duplicate", "Other/Target.md");
    const dailyMarkdown = "[[Target|ambiguous]]";
    const movingMarkdown = "[Missing](./Missing.md)";
    const adapter = adapterFixture(
      [daily, movingSource, movingTarget, duplicate],
      new Map([
        [daily.handle.id, content(daily, dailyMarkdown, "sha256:daily")],
        [movingSource.handle.id, content(movingSource, movingMarkdown, "sha256:a")],
        [movingTarget.handle.id, content(movingTarget, "Target", "sha256:target")],
        [duplicate.handle.id, content(duplicate, "Duplicate", "sha256:duplicate")],
      ])
    );

    const plan = await planFolderLinkRelocation(adapter, {
      fromPath: "Notes",
      toPath: "Archive/Notes",
    });

    expect(plan.writes).toEqual([]);
    expect(plan.skipped).toEqual([
      {
        sourceId: "daily",
        sourcePath: "Daily.md",
        kind: "wiki",
        targetText: "Target",
        range: {
          from: dailyMarkdown.indexOf("Target"),
          to: dailyMarkdown.indexOf("Target") + "Target".length,
        },
        reason: "ambiguous",
      },
      {
        sourceId: "moving-source",
        sourcePath: "Notes/A.md",
        kind: "markdown",
        targetText: "./Missing.md",
        range: {
          from: movingMarkdown.indexOf("./Missing.md"),
          to: movingMarkdown.indexOf("./Missing.md") + "./Missing.md".length,
        },
        reason: "unsafe",
      },
    ]);
  });

  it("rejects a destination occupied by a Page outside the moved subtree", async () => {
    const moving = pageEntry("moving", "Notes/Target.md");
    const collision = pageEntry("collision", "Archive/Notes/Target.md");
    const adapter = adapterFixture(
      [moving, collision],
      new Map([
        [moving.handle.id, content(moving, "Moving", "sha256:moving")],
        [collision.handle.id, content(collision, "Collision", "sha256:collision")],
      ])
    );

    await expect(
      planFolderLinkRelocation(adapter, {
        fromPath: "Notes",
        toPath: "Archive/Notes",
      })
    ).rejects.toThrow(
      "Folder relocation destination already contains a Page: Archive/Notes/Target.md"
    );
  });
});
