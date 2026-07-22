import { describe, expect, it } from "vitest";

import {
  markdownSlashCommandSource,
  searchMarkdownSlashCommands,
} from "@/editor/markdown-block/slash-commands";
import { MarkdownBlockDocument } from "@/editor/markdown-block/markdown-block-document";

describe("native Markdown slash commands", () => {
  it("finds commands by English and Chinese terms with stable ranking", () => {
    expect(
      searchMarkdownSlashCommands("")
        .slice(0, 4)
        .map((command) => command.id)
    ).toEqual(["text", "heading-1", "heading-2", "heading-3"]);
    expect(searchMarkdownSlashCommands("折叠").map((command) => command.id)).toEqual(["toggle"]);
    expect(searchMarkdownSlashCommands("mer").map((command) => command.id)).toContain("mermaid");
    expect(searchMarkdownSlashCommands("看板").map((command) => command.id)).toEqual([
      "collection-board",
    ]);
    expect(searchMarkdownSlashCommands("calendar").map((command) => command.id)).toEqual([
      "collection-calendar",
    ]);
  });

  it.each([
    ["collection-board", '"view": "board"', '"groupBy": "status"'],
    ["collection-calendar", '"view": "calendar"', '"dateBy": "date"'],
  ] as const)("creates a portable %s Collection Block", (command, view, grouping) => {
    const source = `${markdownSlashCommandSource(command)}\n`;
    const snapshot = MarkdownBlockDocument.fromMarkdown(source).getSnapshot();

    expect(source).toContain('"version": 2');
    expect(source).toContain(view);
    expect(source).toContain(grouping);
    expect(snapshot.blocks[0]).toMatchObject({ kind: "collection", raw: source });
  });

  it("creates a Collection that reopens through the native source Block model", () => {
    const source = `${markdownSlashCommandSource("collection", "\r\n")}\r\n`;
    const snapshot = MarkdownBlockDocument.fromMarkdown(source).getSnapshot();

    expect(snapshot.blocks).toHaveLength(1);
    expect(snapshot.blocks[0]).toMatchObject({ kind: "collection", raw: source });
  });

  it("expands commands to canonical Markdown using the Page line ending", () => {
    expect(markdownSlashCommandSource("task", "\r\n")).toBe("- [ ] ");
    expect(markdownSlashCommandSource("code", "\r\n")).toBe("```\r\n\r\n```");
    expect(markdownSlashCommandSource("toggle", "\r\n")).toContain(
      "<summary>Toggle</summary>\r\n\r\n"
    );
    expect(markdownSlashCommandSource("collection", "\r\n")).toContain(
      '```doxmind-collection\r\n{\r\n  "version": 2,'
    );
    expect(markdownSlashCommandSource("image", "\r\n")).toBe("![Image](assets/image.png)");
  });

  it("creates a safe local image placeholder through the source Block model", () => {
    const source = `${markdownSlashCommandSource("image")}\n`;
    expect(MarkdownBlockDocument.fromMarkdown(source).getSnapshot().blocks[0]).toMatchObject({
      kind: "image",
      raw: source,
    });
  });
});
