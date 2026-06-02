/**
 * Markdown round-trip fidelity (issue #149).
 *
 * Guards the data-destroying corruption classes that survive a
 * md -> editor -> getMarkdown() round-trip. These are the *semantic* losses
 * (vs. cosmetic reflow): code spans/blocks reinterpreted as math, and
 * relative doc-to-doc links silently dropped on parse.
 *
 * Byte-for-byte fidelity of untouched blocks is a separate, larger concern
 * (block-level source preservation) and is asserted elsewhere as that lands.
 */
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { getEditorExtensions } from "@/components/editor/editor-extensions";

function roundtrip(html: string): string {
  const editor = new Editor({ extensions: getEditorExtensions(), content: html });
  // Mirror the runtime open path: programmatic setContent triggers the math
  // migration plugin exactly as a real document load does.
  editor.commands.setContent(html, { emitUpdate: false } as never);
  const md = editor.getMarkdown() as string;
  editor.destroy();
  return md;
}

describe("issue #149 — code is verbatim, never math", () => {
  it("inline code containing $...$ keeps its backticks and is not rendered as math", () => {
    expect(roundtrip("<p>Use <code>$x^2$</code> for inline math.</p>")).toContain("`$x^2$`");
  });

  it("inline code containing $$...$$ stays code, never becomes a block-math node", () => {
    const out = roundtrip("<p>Use <code>$$E=mc^2$$</code> here.</p>");
    expect(out).toContain("`$$E=mc^2$$`");
    expect(out).not.toMatch(/\$\$\nE=mc/); // not split into an actual math block
  });

  it("a fenced code block showing latex stays fenced and intact", () => {
    const out = roundtrip("<pre><code>$$E=mc^2$$\n$x$</code></pre>");
    expect(out).toContain("```");
    expect(out).toContain("$$E=mc^2$$");
    expect(out).not.toMatch(/\$\$\nE=mc/);
  });

  it("genuine math in prose still migrates (no regression)", () => {
    expect(roundtrip("<p>Energy is $E=mc^2$ today.</p>")).toContain("$E=mc^2$");
  });
});

describe("issue #149 — relative links survive the round-trip", () => {
  it("keeps a scheme-less path link with slashes", () => {
    const out = roundtrip('<p>See <a href="docs/adr/0001-x.md">docs/adr/0001</a>.</p>');
    expect(out).toContain("[docs/adr/0001](docs/adr/0001-x.md)");
  });

  it("keeps a bare filename link", () => {
    expect(roundtrip('<p>See <a href="CONTEXT.md">CONTEXT.md</a>.</p>')).toContain(
      "[CONTEXT.md](CONTEXT.md)"
    );
  });

  it("keeps absolute links", () => {
    expect(roundtrip('<p>See <a href="https://x.com/a/b">label</a>.</p>')).toContain(
      "[label](https://x.com/a/b)"
    );
  });

  it("still drops dangerous javascript: links", () => {
    const out = roundtrip('<p>x <a href="javascript:alert(1)">click</a> y</p>');
    expect(out).not.toContain("javascript:");
  });
});
