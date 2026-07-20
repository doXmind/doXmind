/**
 * Markdown serialization fidelity: what we write to the `.md` must read back
 * as the same document WITHOUT the hidden sidecar (external edit, git clone).
 */
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { markdownToHtml } from "@/lib/markdown";

function makeEditor(body: string): Editor {
  const editor = new Editor({ extensions: getEditorExtensions(), content: markdownToHtml(body) });
  editor.commands.setContent(markdownToHtml(body), { emitUpdate: false } as never);
  editor.commands.setSourceBaseline(body);
  return editor;
}
function getMd(editor: Editor): string {
  return editor.getMarkdown() as string;
}
const norm = (s: string) => s.replace(/\n+$/, "");

/** Plain text of every top-level paragraph, in order. */
function paragraphTexts(md: string): string[] {
  const editor = new Editor({ extensions: getEditorExtensions(), content: markdownToHtml(md) });
  const out: string[] = [];
  editor.state.doc.forEach((node) => {
    if (node.type.name === "paragraph" && node.textContent) out.push(node.textContent);
  });
  editor.destroy();
  return out;
}

describe("appending after the last block", () => {
  it("separates a freshly typed block from the preceding one with a blank line", () => {
    const body = "# A\n\nOne.\n\nTwo.\n";
    const editor = makeEditor(body);
    // Caret at the end of "Two.", Enter, type "Three."
    editor
      .chain()
      .setTextSelection(editor.state.doc.content.size)
      .insertContent({ type: "paragraph", content: [{ type: "text", text: "Three." }] })
      .run();
    const out = getMd(editor);
    editor.destroy();

    expect(out).toContain("Two.\n\nThree.");
    expect(paragraphTexts(out)).toEqual(["One.", "Two.", "Three."]);
  });

  it("does not absorb an appended paragraph into a preceding list", () => {
    const body = "- one\n- two\n";
    const editor = makeEditor(body);
    editor
      .chain()
      .setTextSelection(editor.state.doc.content.size)
      .insertContent({ type: "paragraph", content: [{ type: "text", text: "After the list." }] })
      .run();
    const out = getMd(editor);
    editor.destroy();

    expect(paragraphTexts(out)).toContain("After the list.");
  });
});

describe("markdown escaping of literal text", () => {
  /** Type `text` as a single paragraph into an empty doc and serialize. */
  function serializeTypedParagraphs(lines: string[]): string {
    const editor = new Editor({ extensions: getEditorExtensions(), content: "<p></p>" });
    editor.commands.setSourceBaseline(null);
    editor.commands.setContent(
      lines.map((l) => `<p>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`).join(""),
      { emitUpdate: false } as never
    );
    const out = editor.getMarkdown() as string;
    editor.destroy();
    return out;
  }

  it("keeps `# foo` / `- foo` / `1. foo` / `> foo` as literal paragraph text", () => {
    const literals = ["# Not a heading", "- not a list", "1. not ordered", "> not a quote"];
    const out = serializeTypedParagraphs(literals);
    expect(paragraphTexts(out)).toEqual(literals);
  });

  it("keeps a literal `---` paragraph from becoming a thematic break", () => {
    const out = serializeTypedParagraphs(["---"]);
    expect(paragraphTexts(out)).toEqual(["---"]);
  });

  it("keeps a literal `[x](y)` from becoming a link", () => {
    const out = serializeTypedParagraphs(["see [x](y) here"]);
    expect(paragraphTexts(out)).toEqual(["see [x](y) here"]);
  });

  it("writes `>` as a backslash escape rather than the HTML entity", () => {
    const out = serializeTypedParagraphs(["> not a quote"]);
    expect(out).not.toContain("&gt;");
  });

  it("leaves markdown-significant characters inside code untouched", () => {
    const body = ["```", "# real hash", "- real dash", "```", "", "`# inline`"].join("\n");
    const editor = makeEditor(body);
    const out = getMd(editor);
    editor.destroy();
    expect(norm(out)).toBe(norm(body));
  });

  it("is idempotent: escaping a doc that already round-tripped changes nothing", () => {
    const once = serializeTypedParagraphs(["# Not a heading", "- not a list", "---"]);
    const editor = makeEditor(once);
    const twice = getMd(editor);
    editor.destroy();
    expect(norm(twice)).toBe(norm(once));
    expect(paragraphTexts(twice)).toEqual(["# Not a heading", "- not a list", "---"]);
  });
});

describe("toggle body", () => {
  it("separates multiple body blocks with a blank line", () => {
    const editor = new Editor({ extensions: getEditorExtensions(), content: "<p></p>" });
    editor.commands.setSourceBaseline(null);
    editor.commands.setContent(
      "<details><summary>Title</summary><div data-toggle-body><p>First body.</p><p>Second body.</p></div></details>",
      { emitUpdate: false } as never
    );
    const out = editor.getMarkdown() as string;
    editor.destroy();

    expect(out).toContain("First body.\n\nSecond body.");
  });

  it("round-trips a two-paragraph toggle body", () => {
    const body = [
      "<details>",
      "<summary>Q</summary>",
      "",
      "First body.",
      "",
      "Second body.",
      "",
      "</details>",
    ].join("\n");
    const editor = makeEditor(body);
    const out = getMd(editor);
    editor.destroy();
    expect(norm(out)).toBe(norm(body));
  });
});

describe("GFM alerts round-trip as callouts", () => {
  it("imports `> [!TYPE]` as a callout node, not a blockquote", () => {
    const html = markdownToHtml("> [!WARNING]\n> Heads up!");
    expect(html).toContain('data-callout-type="warning"');
    expect(html).toContain("Heads up!");
    expect(html).not.toContain("[!WARNING]");
    expect(html).not.toContain("<blockquote>");
  });

  it("maps doXmind's own type names and the GFM alert set onto the four types", () => {
    const cases: Array<[string, string]> = [
      ["INFO", "info"],
      ["NOTE", "info"],
      ["IMPORTANT", "info"],
      ["TIP", "tip"],
      ["ERROR", "error"],
      ["CAUTION", "error"],
    ];
    for (const [marker, type] of cases) {
      expect(markdownToHtml(`> [!${marker}]\n> x`)).toContain(`data-callout-type="${type}"`);
    }
  });

  it("leaves plain blockquotes and unknown markers as blockquotes", () => {
    expect(markdownToHtml("> just a quote")).toContain("<blockquote>");
    const unknown = markdownToHtml("> [!NONSENSE]\n> x");
    expect(unknown).toContain("<blockquote>");
    expect(unknown).toContain("[!NONSENSE]");
  });

  it("keeps a saved callout byte-identical through a full round-trip", () => {
    const body = ["Intro.", "", "> [!WARNING]", "> Heads up!", "", "Outro."].join("\n");
    const editor = makeEditor(body);
    const out = getMd(editor);
    editor.destroy();
    expect(norm(out)).toBe(norm(body));
  });
});

describe("callout markers are GFM-conformant", () => {
  it("emits the GFM alert marker for each callout type", () => {
    const editor = new Editor({ extensions: getEditorExtensions(), content: "<p></p>" });
    editor.commands.setSourceBaseline(null);
    for (const [type, marker] of [
      ["info", "NOTE"],
      ["tip", "TIP"],
      ["warning", "WARNING"],
      ["error", "CAUTION"],
    ]) {
      editor.commands.setContent(`<div data-callout-type="${type}"><p>x</p></div>`, {
        emitUpdate: false,
      } as never);
      expect(editor.getMarkdown() as string).toContain(`> [!${marker}]`);
    }
    editor.destroy();
  });

  it("keeps a GitHub-authored NOTE alert byte-identical across an edit to it", () => {
    const body = ["> [!NOTE]", "> Useful info.", "", "Tail."].join("\n");
    const editor = makeEditor(body);
    expect(norm(getMd(editor))).toBe(norm(body));

    editor.commands.insertContentAt(3, "X");
    const out = getMd(editor);
    editor.destroy();
    expect(out).toContain("> [!NOTE]");
  });
});
