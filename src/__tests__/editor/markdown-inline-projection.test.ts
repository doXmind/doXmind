import { describe, expect, it } from "vitest";

import {
  applyVisibleTextPatch,
  projectMarkdownInline,
} from "@/editor/markdown-block/markdown-inline-projection";

describe("Markdown inline projection", () => {
  it("projects bold syntax as marked visible text without losing its source span", () => {
    const projection = projectMarkdownInline("Hello **bold**.");

    expect(projection.visibleText).toBe("Hello bold.");
    expect(projection.segments).toEqual([
      expect.objectContaining({
        kind: "text",
        text: "Hello ",
        sourceFrom: 0,
        sourceTo: 6,
        visibleFrom: 0,
        visibleTo: 6,
        marks: {
          bold: false,
          italic: false,
          strike: false,
          code: false,
          link: false,
          wiki: false,
        },
      }),
      expect.objectContaining({
        kind: "text",
        text: "bold",
        sourceFrom: 8,
        sourceTo: 12,
        visibleFrom: 6,
        visibleTo: 10,
        marks: expect.objectContaining({ bold: true }),
      }),
      expect.objectContaining({
        kind: "text",
        text: ".",
        sourceFrom: 14,
        sourceTo: 15,
        visibleFrom: 10,
        visibleTo: 11,
        marks: expect.objectContaining({ bold: false }),
      }),
    ]);
    expect(projection.visibleRangeToSource({ from: 6, to: 10 })).toEqual({
      from: 8,
      to: 12,
    });
  });

  it("composes nested emphasis and strike marks in source order", () => {
    const projection = projectMarkdownInline("***bold italic*** and ~~struck **bold**~~");

    expect(projection.visibleText).toBe("bold italic and struck bold");
    expect(
      projection.segments.map((segment) => ({
        text: segment.text,
        marks: segment.marks,
      }))
    ).toEqual([
      {
        text: "bold italic",
        marks: expect.objectContaining({ bold: true, italic: true, strike: false }),
      },
      {
        text: " and ",
        marks: expect.objectContaining({ bold: false, italic: false, strike: false }),
      },
      {
        text: "struck ",
        marks: expect.objectContaining({ bold: false, italic: false, strike: true }),
      },
      {
        text: "bold",
        marks: expect.objectContaining({ bold: true, italic: false, strike: true }),
      },
    ]);
  });

  it("maps escaped punctuation and emoji with UTF-16 offsets in both directions", () => {
    const projection = projectMarkdownInline("🚀 \\*ship\\* **now**");

    expect(projection.visibleText).toBe("🚀 *ship* now");
    expect(projection.visibleOffsetToSource("🚀 ".length)).toBe("🚀 ".length);
    expect(projection.visibleOffsetToSource("🚀 *".length)).toBe("🚀 \\*".length);
    expect(projection.sourceOffsetToVisible("🚀 \\".length, "backward")).toBe("🚀 ".length);
    expect(projection.sourceOffsetToVisible("🚀 \\*".length, "forward")).toBe("🚀 *".length);
    expect(
      projection.visibleRangeToSource({
        from: "🚀 *ship* ".length,
        to: "🚀 *ship* now".length,
      })
    ).toEqual({
      from: "🚀 \\*ship\\* **".length,
      to: "🚀 \\*ship\\* **now".length,
    });
    expect(
      projection.sourceRangeToVisible({
        from: "🚀 \\*ship\\* ".length,
        to: "🚀 \\*ship\\* **now**".length,
      })
    ).toEqual({
      from: "🚀 *ship* ".length,
      to: "🚀 *ship* now".length,
    });
  });

  it("treats a matching backtick run as literal inline code", () => {
    const source = "Use ``a `tick` **raw**`` now";
    const projection = projectMarkdownInline(source);

    expect(projection.visibleText).toBe("Use a `tick` **raw** now");
    expect(projection.segments).toEqual([
      expect.objectContaining({
        text: "Use ",
        marks: expect.objectContaining({ code: false }),
      }),
      expect.objectContaining({
        kind: "text",
        text: "a `tick` **raw**",
        sourceFrom: "Use ``".length,
        sourceTo: "Use ``a `tick` **raw**".length,
        marks: expect.objectContaining({
          bold: false,
          italic: false,
          code: true,
        }),
      }),
      expect.objectContaining({
        text: " now",
        marks: expect.objectContaining({ code: false }),
      }),
    ]);
  });

  it("hides an autolink's angle brackets and links the URL it wraps", () => {
    const projection = projectMarkdownInline("Visit <https://example.com> now");

    expect(projection.visibleText).toBe("Visit https://example.com now");
    expect(projection.segments).toEqual([
      expect.objectContaining({ text: "Visit " }),
      expect.objectContaining({
        text: "https://example.com",
        sourceFrom: "Visit <".length,
        sourceTo: "Visit <https://example.com".length,
        marks: expect.objectContaining({ link: true }),
        linkTarget: "https://example.com",
      }),
      expect.objectContaining({ text: " now" }),
    ]);
  });

  it("treats an email autolink as a mailto link", () => {
    const projection = projectMarkdownInline("Mail <someone@example.com> today");

    expect(projection.visibleText).toBe("Mail someone@example.com today");
    expect(projection.segments).toContainEqual(
      expect.objectContaining({
        text: "someone@example.com",
        linkTarget: "mailto:someone@example.com",
      })
    );
  });

  it("leaves angle brackets alone when they are not an autolink", () => {
    // Prose comparisons and a bracketed word that names no scheme both have to survive verbatim, or
    // the projection would eat text the user typed.
    for (const source of [
      "If a < b and c > d then stop",
      "Tag <notaurl> here",
      "Spaced <not a url> here",
    ]) {
      expect(projectMarkdownInline(source).visibleText, source).toBe(source);
    }
  });

  it("projects nested marks inside links with balanced destination parentheses", () => {
    const source = "Read [**API** docs](https://example.test/a_(b)) now";
    const projection = projectMarkdownInline(source);

    expect(projection.visibleText).toBe("Read API docs now");
    expect(projection.segments).toEqual([
      expect.objectContaining({ text: "Read " }),
      expect.objectContaining({
        text: "API",
        sourceFrom: "Read [**".length,
        sourceTo: "Read [**API".length,
        marks: expect.objectContaining({ bold: true, link: true }),
        linkTarget: "https://example.test/a_(b)",
      }),
      expect.objectContaining({
        text: " docs",
        marks: expect.objectContaining({ bold: false, link: true }),
        linkTarget: "https://example.test/a_(b)",
      }),
      expect.objectContaining({ text: " now" }),
    ]);
  });

  it("accepts escaped destination parentheses without truncating the target", () => {
    const projection = projectMarkdownInline("[escaped](https://example.test/a_\\(b\\))");

    expect(projection.visibleText).toBe("escaped");
    expect(projection.segments[0]).toEqual(
      expect.objectContaining({
        linkTarget: "https://example.test/a_(b)",
        marks: expect.objectContaining({ link: true }),
      })
    );
  });

  it("projects an image as one atomic non-editable object instead of link text", () => {
    const source = "Before ![rocket 🚀](./assets/rocket_(dark).png) after";
    const projection = projectMarkdownInline(source);
    const image = projection.segments[1];

    expect(projection.visibleText).toBe("Before \uFFFC after");
    expect(image).toEqual(
      expect.objectContaining({
        kind: "image",
        text: "\uFFFC",
        editable: false,
        imageAlt: "rocket 🚀",
        imageTarget: "./assets/rocket_(dark).png",
        sourceFrom: "Before ".length,
        sourceTo: "Before ![rocket 🚀](./assets/rocket_(dark).png)".length,
        marks: expect.objectContaining({ link: false }),
      })
    );
    expect(projection.visibleRangeToSource({ from: 7, to: 8 })).toEqual({
      from: "Before ".length,
      to: "Before ![rocket 🚀](./assets/rocket_(dark).png)".length,
    });
  });

  it("projects wiki-link aliases while retaining their local target", () => {
    const projection = projectMarkdownInline("See [[Roadmap#Q3|Launch \\| plan]] and [[Inbox]]");

    expect(projection.visibleText).toBe("See Launch | plan and Inbox");
    expect(projection.segments).toEqual([
      expect.objectContaining({ text: "See " }),
      expect.objectContaining({
        kind: "text",
        text: "Launch | plan",
        marks: expect.objectContaining({ wiki: true, link: false }),
        wikiTarget: "Roadmap#Q3",
      }),
      expect.objectContaining({ text: " and " }),
      expect.objectContaining({
        kind: "text",
        text: "Inbox",
        marks: expect.objectContaining({ wiki: true }),
        wikiTarget: "Inbox",
      }),
    ]);
  });

  it.each([
    "[bad](javascript:alert(1))",
    "[**bad**](javascript:alert(1))",
    "![bad](data:text/html,x)",
    "[unfinished](https://example.test",
    "**unfinished",
    "[[unfinished",
  ])("fails closed as plain text for malformed or unsafe source: %s", (source) => {
    const projection = projectMarkdownInline(source);

    expect(projection.visibleText).toBe(source);
    expect(projection.segments.every((segment) => segment.kind === "text")).toBe(true);
    expect(
      projection.segments.every((segment) =>
        Object.values(segment.marks).every((active) => !active)
      )
    ).toBe(true);
  });

  it("applies the minimal visible edit while preserving untouched Markdown markers", () => {
    const source = "Keep **bold 🚀** and [link](https://example.test)";
    const oldVisible = "Keep bold 🚀 and link";
    const newVisible = "Keep bolder 🚀 and link";
    const result = applyVisibleTextPatch(source, oldVisible, newVisible, {
      anchor: "Keep bolder".length,
      head: "Keep bolder 🚀".length,
    });

    expect(result).toEqual({
      source: "Keep **bolder 🚀** and [link](https://example.test)",
      selection: {
        anchor: "Keep **bolder".length,
        head: "Keep **bolder 🚀".length,
      },
      applied: true,
    });
    expect(projectMarkdownInline(result.source).visibleText).toBe(newVisible);
  });

  it("rejects visible text patches that would mutate an atomic image", () => {
    const source = "A ![diagram](./diagram.png) B";
    const oldVisible = "A \uFFFC B";

    expect(applyVisibleTextPatch(source, oldVisible, "A replacement B")).toEqual({
      source,
      applied: false,
    });
  });

  it("escapes newly typed Markdown punctuation so the visible text stays literal", () => {
    const result = applyVisibleTextPatch("Plain text", "Plain text", "Plain *text*");

    expect(result).toEqual({
      source: "Plain \\*text\\*",
      applied: true,
    });
    expect(projectMarkdownInline(result.source).visibleText).toBe("Plain *text*");
  });
});
