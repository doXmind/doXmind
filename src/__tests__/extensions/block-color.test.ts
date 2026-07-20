/**
 * Block colours arrive from documents, which are untrusted (docs/adr/0011), so
 * the `data-bg-color` / `data-text-color` attributes only survive parsing if
 * they are a plain CSS colour — a value like `red;background-image:url(...)`
 * must not reach the DOM as a style.
 */
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { getEditorExtensions } from "@/components/editor/editor-extensions";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function parse(content: string): Editor {
  const ed = new Editor({ extensions: getEditorExtensions(), content });
  editor = ed;
  return ed;
}

/** The backgroundColor attribute of the first paragraph in the document. */
function paragraphBg(ed: Editor): unknown {
  let value: unknown = "__missing__";
  ed.state.doc.descendants((node) => {
    if (value === "__missing__" && node.type.name === "paragraph") {
      value = node.attrs.backgroundColor ?? null;
      return false;
    }
    return true;
  });
  return value;
}

describe("block colour attributes are sanitized on parse", () => {
  it("keeps a hex colour", () => {
    expect(paragraphBg(parse('<p data-bg-color="#FDEBEC">x</p>'))).toBe("#FDEBEC");
  });

  it("keeps a functional colour notation written by another tool", () => {
    expect(paragraphBg(parse('<p data-bg-color="rgb(10, 20, 30)">x</p>'))).toBe("rgb(10, 20, 30)");
  });

  it("drops a value that smuggles more than a colour", () => {
    const ed = parse('<p data-bg-color="red;background-image:url(https://evil.test/x)">x</p>');
    expect(paragraphBg(ed)).toBeNull();
  });

  it("drops a url() payload", () => {
    expect(paragraphBg(parse('<p data-bg-color="url(https://evil.test/x)">x</p>'))).toBeNull();
  });

  it("leaves an uncoloured block with no attribute", () => {
    expect(paragraphBg(parse("<p>x</p>"))).toBeNull();
  });
});
