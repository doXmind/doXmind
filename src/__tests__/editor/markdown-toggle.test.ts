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
      summaryFrom: 20,
      markdown: "Write something…",
    });
    // The offset has to survive CRLF, where assuming a one-character terminator drifts by a
    // character per line and the caret lands inside the tag rather than on the title.
    expect(source.slice(20, 20 + "Toggle".length)).toBe("Toggle");
  });

  it("accepts the portable open attribute but rejects lookalike raw HTML", () => {
    const open =
      "<details open>\n<summary>Release notes</summary>\n\n- shipped\n- local\n\n</details>\n";
    expect(parseMarkdownToggle(open)).toEqual({
      open: true,
      summary: "Release notes",
      summaryFrom: 24,
      markdown: "- shipped\n- local",
    });
    expect(open.slice(24, 24 + "Release notes".length)).toBe("Release notes");
    expect(parseMarkdownToggle("<details>not a toggle</details>\n")).toBeNull();
    expect(parseMarkdownToggle("<div>\n<summary>No</summary>\n</div>\n")).toBeNull();
  });
});
