import { describe, expect, it } from "vitest";

import {
  markdownSlashCommandCaret,
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

  it("narrows full pinyin the way the Feishu insert panel does", () => {
    expect(searchMarkdownSlashCommands("biaoti").map((command) => command.id)).toEqual([
      "heading-1",
      "heading-2",
      "heading-3",
    ]);
    expect(searchMarkdownSlashCommands("daima").map((command) => command.id)).toEqual(["code"]);
  });

  it.each([
    ["bt", "heading-1"],
    ["bg", "table"],
    ["bl", "bullet-list"],
    ["tbl", "table"],
    ["table", "table"],
  ] as const)("ranks the best match for %s first", (query, expected) => {
    expect(searchMarkdownSlashCommands(query)[0]?.id).toBe(expected);
  });

  it("carries icon and Markdown shortcut metadata per row", () => {
    const commands = searchMarkdownSlashCommands("");
    const heading = commands.find((command) => command.id === "heading-1");

    expect(heading).toMatchObject({ icon: "Heading1", shortcut: "#" });
    expect(commands.find((command) => command.id === "task")?.shortcut).toBe("- [ ]");
    expect(commands.find((command) => command.id === "table")?.shortcut).toBeUndefined();
    for (const command of commands) {
      expect(command.icon).not.toBe("");
      expect(command.pinyin.length).toBeGreaterThan(0);
      expect(command.initials.length).toBeGreaterThan(0);
    }
  });

  it("places the caret inside the generated template", () => {
    const code = markdownSlashCommandSource("code");
    const caret = markdownSlashCommandCaret("code");

    expect(code.slice(0, caret)).toBe("```\n");
    expect(code.slice(caret)).toBe("\n```");
    expect(markdownSlashCommandCaret("code", "\r\n")).toBe("```\r\n".length);
    expect(markdownSlashCommandSource("toggle").slice(markdownSlashCommandCaret("toggle"))).toBe(
      "Write something…\n\n</details>"
    );
    expect(markdownSlashCommandSource("table").slice(markdownSlashCommandCaret("table"))).toBe(
      " |  |"
    );
    expect(markdownSlashCommandCaret("callout")).toBe(markdownSlashCommandSource("callout").length);
    expect(markdownSlashCommandCaret("text")).toBe(0);
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
