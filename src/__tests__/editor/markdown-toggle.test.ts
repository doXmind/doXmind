import { describe, expect, it } from "vitest";

import {
  markdownToggleTemplate,
  parseMarkdownToggle,
} from "@/editor/markdown-block/markdown-toggle";

describe("portable Markdown toggle", () => {
  it("uses an ordinary HTML details block and preserves nested Markdown", () => {
    const source = markdownToggleTemplate("\r\n");

    expect(source).toBe(
      "<details>\r\n<summary>Toggle</summary>\r\n\r\nWrite something…\r\n\r\n</details>"
    );
    expect(parseMarkdownToggle(source)).toEqual({
      open: false,
      summary: "Toggle",
      markdown: "Write something…",
    });
  });

  it("accepts the portable open attribute but rejects lookalike raw HTML", () => {
    expect(
      parseMarkdownToggle(
        "<details open>\n<summary>Release notes</summary>\n\n- shipped\n- local\n\n</details>\n"
      )
    ).toEqual({
      open: true,
      summary: "Release notes",
      markdown: "- shipped\n- local",
    });
    expect(parseMarkdownToggle("<details>not a toggle</details>\n")).toBeNull();
    expect(parseMarkdownToggle("<div>\n<summary>No</summary>\n</div>\n")).toBeNull();
  });
});
