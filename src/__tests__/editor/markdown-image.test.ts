import { describe, expect, it } from "vitest";

import {
  markdownImageDestinationForPage,
  parseMarkdownImageBlock,
  resolveMarkdownImagePath,
} from "@/editor/markdown-block/markdown-image";

describe("parseMarkdownImageBlock", () => {
  it("parses one standalone CommonMark image without rewriting its source", () => {
    const source = '![Roadmap](assets/roadmap.png "Q3 plan")\r\n\r\n';

    expect(parseMarkdownImageBlock(source)).toEqual({
      ok: true,
      image: {
        source,
        alt: "Roadmap",
        destination: "assets/roadmap.png",
        title: "Q3 plan",
      },
    });
  });

  it("decodes common alt escapes and accepts angle destinations and all title delimiters", () => {
    expect(parseMarkdownImageBlock("![plain](media/plain.PNG)")).toMatchObject({
      ok: true,
      image: { alt: "plain", destination: "media/plain.PNG", title: null },
    });
    expect(parseMarkdownImageBlock('![a\\*b](<media/my map.webp> "double")')).toMatchObject({
      ok: true,
      image: { alt: "a*b", destination: "media/my map.webp", title: "double" },
    });
    expect(parseMarkdownImageBlock("![地图](media/map.bmp 'single')")).toMatchObject({
      ok: true,
      image: { alt: "地图", destination: "media/map.bmp", title: "single" },
    });
    expect(parseMarkdownImageBlock("![Map](media/map.avif (parenthesized))")).toMatchObject({
      ok: true,
      image: { alt: "Map", destination: "media/map.avif", title: "parenthesized" },
    });
  });

  it.each([
    ["![]()", "empty-destination"],
    ["![](http://example.com/a.png)", "external-destination"],
    ["![](https://example.com/a.png)", "external-destination"],
    ["![](data:image/png;base64,AAAA)", "external-destination"],
    ["![](file:///tmp/a.png)", "external-destination"],
    ["![](/tmp/a.png)", "absolute-destination"],
    ["![](//server/share/a.png)", "absolute-destination"],
    ["![](#diagram)", "query-or-fragment"],
    ["![](assets/a.png?size=2)", "query-or-fragment"],
    ["![](assets/a.png#diagram)", "query-or-fragment"],
    ["![](assets/readme.txt)", "unsupported-extension"],
    ["![](assets/vector.svg)", "unsupported-extension"],
    ["![](assets/a%00.png)", "nul-byte"],
    ["![nul\0alt](assets/a.png)", "nul-byte"],
  ])("rejects unsafe or non-image destination %s", (source, code) => {
    expect(parseMarkdownImageBlock(source)).toMatchObject({
      ok: false,
      diagnostic: { code },
    });
  });

  it("rejects an image expression sharing its source block with other content", () => {
    expect(parseMarkdownImageBlock("Before ![Map](assets/map.png)")).toMatchObject({
      ok: false,
      diagnostic: { code: "not-standalone-image" },
    });
    expect(parseMarkdownImageBlock("![Map](assets/map.png) after")).toMatchObject({
      ok: false,
      diagnostic: { code: "not-standalone-image" },
    });
  });
});

describe("resolveMarkdownImagePath", () => {
  it("creates the shortest encoded relative destination for an imported workspace asset", () => {
    expect(
      markdownImageDestinationForPage("Notes/Projects/Roadmap.md", "assets/hero image.png")
    ).toBe("../../assets/hero%20image.png");
    expect(markdownImageDestinationForPage("Roadmap.md", "assets/map.png")).toBe("assets/map.png");
  });

  it("resolves a URI-decoded destination relative to the current Page workspace path", () => {
    expect(
      resolveMarkdownImagePath("Notes/Projects/Roadmap.md", "../../assets/hero%20image.png")
    ).toEqual({
      ok: true,
      imagePath: {
        pagePath: "Notes/Projects/Roadmap.md",
        destination: "../../assets/hero%20image.png",
        workspacePath: "assets/hero image.png",
      },
    });
  });

  it("normalizes dot segments but fails closed above the workspace root", () => {
    expect(
      resolveMarkdownImagePath("Notes/./Roadmap.md", "./assets/../images/map.png")
    ).toMatchObject({
      ok: true,
      imagePath: { pagePath: "Notes/Roadmap.md", workspacePath: "Notes/images/map.png" },
    });
    expect(resolveMarkdownImagePath("Roadmap.md", "../outside.png")).toMatchObject({
      ok: false,
      diagnostic: { code: "outside-workspace" },
    });
    expect(resolveMarkdownImagePath("Notes/Roadmap.md", "%2e%2e/%2e%2e/outside.png")).toMatchObject(
      {
        ok: false,
        diagnostic: { code: "outside-workspace" },
      }
    );
    expect(resolveMarkdownImagePath("/Notes/Roadmap.md", "assets/map.png")).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-page-path" },
    });
  });
});
