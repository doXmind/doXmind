import { describe, expect, it } from "vitest";

import {
  parseWikiEmbedBlock,
  projectWikiEmbedBody,
  resolveWikiEmbed,
  wikiEmbedIdentity,
} from "@/editor/markdown-block/wiki-embed";
import type { KnowledgeSourceIndex } from "@/lib/knowledge-index";

describe("parseWikiEmbedBlock", () => {
  it("parses a whole-block Page embed", () => {
    expect(parseWikiEmbedBlock("![[Projects/Roadmap]]")).toEqual({
      target: "Projects/Roadmap",
      label: null,
      fragment: null,
    });
  });

  it("separates a CJK heading fragment and alias without normalizing CRLF block source", () => {
    expect(parseWikiEmbedBlock("![[路线图#发布 🚀|发布计划]]\r\n\r\n")).toEqual({
      target: "路线图",
      label: "发布计划",
      fragment: { kind: "heading", value: "发布 🚀" },
    });
  });

  it("types a block fragment without treating it as a heading", () => {
    expect(parseWikiEmbedBlock("![[Roadmap^release-2026]]")).toEqual({
      target: "Roadmap",
      label: null,
      fragment: { kind: "block", value: "release-2026" },
    });
    expect(parseWikiEmbedBlock("![[Roadmap#^release-2026]]")).toEqual({
      target: "Roadmap",
      label: null,
      fragment: { kind: "block", value: "release-2026" },
    });
  });

  it("rejects escaped embeds and embeds sharing a block with other text", () => {
    expect(parseWikiEmbedBlock("\\![[Roadmap]]")).toBeNull();
    expect(parseWikiEmbedBlock("Before ![[Roadmap]]")).toBeNull();
    expect(parseWikiEmbedBlock("![[Roadmap]] after")).toBeNull();
  });
});

describe("projectWikiEmbedBody", () => {
  it("returns the complete target Markdown body when there is no fragment", () => {
    const body = '# 路线图 🚀\r\n\r\n<unknown-widget data-x="1">\r\n';

    expect(projectWikiEmbedBody(body, null)).toBe(body);
  });

  it("projects one heading through its descendants and stops before its next sibling", () => {
    const body =
      "# Intro\nBefore\n## Details\nExact source\n### Child\nChild source\n## Next\nNot included\n";

    expect(projectWikiEmbedBody(body, { kind: "heading", value: "Details" })).toBe(
      "## Details\nExact source\n### Child\nChild source\n"
    );
  });

  it("matches formatted CJK and emoji headings case- and NFC-insensitively while preserving CRLF", () => {
    const body =
      "# Top\r\n## **Cafe\u0301 发布** 🚀 ##\r\n::unknown{value}\r\n### 子项\r\n- ✅\r\n## Next\r\n";

    expect(projectWikiEmbedBody(body, { kind: "heading", value: "CAFÉ 发布 🚀" })).toBe(
      "## **Cafe\u0301 发布** 🚀 ##\r\n::unknown{value}\r\n### 子项\r\n- ✅\r\n"
    );
  });

  it("fails closed when a heading fragment has zero or multiple matches", () => {
    const uniqueBody = "# Intro\nText\n";
    const duplicateBody = "## Release\nOne\n## release\nTwo\n";

    expect(projectWikiEmbedBody(uniqueBody, { kind: "heading", value: "Missing" })).toBeNull();
    expect(projectWikiEmbedBody(duplicateBody, { kind: "heading", value: "RELEASE" })).toBeNull();
  });

  it("matches only parsed ATX headings, not setext or fenced-code lookalikes", () => {
    const body = "Release\n=======\n```md\n# Release\n```\n## Release\nReal\n## Next\nOutside\n";

    expect(projectWikiEmbedBody(body, { kind: "heading", value: "Release" })).toBe(
      "## Release\nReal\n"
    );
  });

  it("projects one unique portable block id and hides only its anchor token", () => {
    expect(
      projectWikiEmbedBody("Before\n\nParagraph **source** ^release-2026\n\nAfter\n", {
        kind: "block",
        value: "release-2026",
      })
    ).toBe("Paragraph **source**\n\n");
  });

  it("fails closed when a block id is missing, duplicated, or inside fenced code", () => {
    expect(projectWikiEmbedBody("Paragraph\n", { kind: "block", value: "missing" })).toBeNull();
    expect(
      projectWikiEmbedBody("One ^same\n\nTwo ^same\n", { kind: "block", value: "same" })
    ).toBeNull();
    expect(
      projectWikiEmbedBody("```md\nFake ^inside-code\n```\n", {
        kind: "block",
        value: "inside-code",
      })
    ).toBeNull();
  });
});

describe("resolveWikiEmbed", () => {
  const index: KnowledgeSourceIndex = {
    pages: [
      { id: "today", path: "Notes/Today.md", title: "Today", aliases: [] },
      {
        id: "roadmap",
        path: "Notes/Roadmap.md",
        title: "产品路线",
        aliases: ["Plan"],
      },
      { id: "duplicate", path: "Archive/Plan.md", title: "Old Plan", aliases: [] },
    ],
    sourcePages: [
      {
        id: "today",
        path: "Notes/Today.md",
        title: "Today",
        aliases: [],
        markdown: "![[Roadmap]]\n",
      },
      {
        id: "roadmap",
        path: "Notes/Roadmap.md",
        title: "产品路线",
        aliases: ["Plan"],
        markdown:
          "# Roadmap\r\n\r\n## 发布 🚀\r\nExact.\r\n## Later\r\nOutside.\r\n\r\nStable paragraph ^stable-id\r\n",
      },
      {
        id: "duplicate",
        path: "Archive/Plan.md",
        title: "Old Plan",
        aliases: [],
        markdown: "Old.\n",
      },
    ],
    links: [],
    backlinks: [],
    unlinkedMentions: [],
  };

  it("resolves Page and heading embeds through the shared knowledge rules", () => {
    const whole = resolveWikiEmbed(index, "Notes/Today.md", "![[产品路线|Roadmap card]]", {
      depth: 1,
      ancestry: [wikiEmbedIdentity("today", null)],
    });
    const section = resolveWikiEmbed(index, "Notes/Today.md", "![[Roadmap#发布 🚀]]", {
      depth: 1,
      ancestry: [wikiEmbedIdentity("today", null)],
    });

    expect(whole).toMatchObject({
      status: "resolved",
      target: { id: "roadmap" },
      markdown: index.sourcePages[1].markdown,
    });
    expect(section).toMatchObject({
      status: "resolved",
      target: { id: "roadmap" },
      markdown: "## 发布 🚀\r\nExact.\r\n",
    });
  });

  it("fails closed for ambiguity and missing fragments, and resolves block anchors", () => {
    expect(
      resolveWikiEmbed(index, "Notes/Today.md", "![[Plan]]", { depth: 1, ancestry: [] })?.status
    ).toBe("ambiguous");
    expect(
      resolveWikiEmbed(index, "Notes/Today.md", "![[Roadmap#Missing]]", {
        depth: 1,
        ancestry: [],
      })?.status
    ).toBe("missing-fragment");
    expect(
      resolveWikiEmbed(index, "Notes/Today.md", "![[Roadmap#^stable-id]]", {
        depth: 1,
        ancestry: [],
      })?.status
    ).toBe("resolved");
  });

  it("stops recursive cycles and projections beyond the fixed depth boundary", () => {
    expect(
      resolveWikiEmbed(index, "Notes/Today.md", "![[Roadmap]]", {
        depth: 2,
        ancestry: [wikiEmbedIdentity("roadmap", null)],
      })?.status
    ).toBe("cycle");
    expect(
      resolveWikiEmbed(index, "Notes/Today.md", "![[Roadmap]]", {
        depth: 9,
        ancestry: [],
      })?.status
    ).toBe("depth-exceeded");
  });
});
