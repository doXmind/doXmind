/**
 * Find/replace must see matches that straddle mark boundaries, and replacing
 * must not drop the marks that covered the match.
 */
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { processSearches, SearchPluginKey } from "@/extensions/search";

function makeEditor(html: string): Editor {
  return new Editor({ extensions: getEditorExtensions(), content: html });
}

function search(editor: Editor, term: string, caseSensitive = false) {
  return processSearches(editor.state.doc, term, caseSensitive);
}

describe("find across mark boundaries", () => {
  it("finds a word that is only partly bold", () => {
    const editor = makeEditor("<p><strong>nee</strong>dle</p>");
    const results = search(editor, "needle");
    editor.destroy();
    expect(results).toHaveLength(1);
  });

  it("finds a word split across three marks", () => {
    const editor = makeEditor("<p><strong>ne</strong><em>ed</em>le</p>");
    const results = search(editor, "needle");
    const doc = editor.state.doc;
    const text = results.map((r) => doc.textBetween(r.from, r.to));
    editor.destroy();
    expect(text).toEqual(["needle"]);
  });

  it("does not join text across block boundaries", () => {
    const editor = makeEditor("<p>nee</p><p>dle</p>");
    const results = search(editor, "needle");
    editor.destroy();
    expect(results).toHaveLength(0);
  });

  it("counts every occurrence in a block exactly once", () => {
    const editor = makeEditor("<p><strong>nee</strong>dle and needle and <em>need</em>le</p>");
    const results = search(editor, "needle");
    editor.destroy();
    expect(results).toHaveLength(3);
  });

  it("returns results in document order", () => {
    const editor = makeEditor("<p>one x</p><p>two <strong>x</strong>y x</p>");
    const results = search(editor, "x");
    editor.destroy();
    const froms = results.map((r) => r.from);
    expect(froms).toEqual([...froms].sort((a, b) => a - b));
  });
});

describe("replace", () => {
  it("replaces a match that straddles a mark boundary", () => {
    const editor = makeEditor("<p><strong>nee</strong>dle here</p>");
    editor.commands.setSearchTerm("needle");
    editor.commands.setReplaceTerm("pin");
    editor.commands.replace();
    const md = editor.getMarkdown() as string;
    editor.destroy();
    expect(md.trim()).toBe("**pin** here");
  });

  it("keeps the marks of the first character of the match", () => {
    const editor = makeEditor("<p>a <em>hay</em>stack b</p>");
    editor.commands.setSearchTerm("haystack");
    editor.commands.setReplaceTerm("pin");
    editor.commands.replace();
    const md = editor.getMarkdown() as string;
    editor.destroy();
    expect(md.trim()).toBe("a *pin* b");
  });

  it("replace all reaches mark-split occurrences", () => {
    const editor = makeEditor("<p><strong>nee</strong>dle one</p><p>needle two</p>");
    editor.commands.setSearchTerm("needle");
    editor.commands.setReplaceTerm("pin");
    editor.commands.replaceAll();
    const md = editor.getMarkdown() as string;
    editor.destroy();
    expect(md).toContain("**pin** one");
    expect(md).toContain("pin two");
  });

  it("replace all is a single undo step", () => {
    const editor = makeEditor("<p>needle one</p><p>needle two</p><p>needle three</p>");
    const before = editor.getMarkdown() as string;
    editor.commands.setSearchTerm("needle");
    editor.commands.setReplaceTerm("pin");
    editor.commands.replaceAll();
    expect(editor.getMarkdown()).not.toBe(before);
    editor.commands.undo();
    const after = editor.getMarkdown() as string;
    editor.destroy();
    expect(after).toBe(before);
  });

  it("empty replacement deletes the match", () => {
    const editor = makeEditor("<p>a needle b</p>");
    editor.commands.setSearchTerm("needle");
    editor.commands.setReplaceTerm("");
    editor.commands.replaceAll();
    const md = editor.getMarkdown() as string;
    editor.destroy();
    expect(md.trim()).toBe("a  b");
  });
});

describe("match counter", () => {
  it("plugin state count agrees with the matches found", () => {
    const editor = makeEditor("<p><strong>nee</strong>dle and needle</p>");
    editor.commands.setSearchTerm("needle");
    const state = SearchPluginKey.getState(editor.state);
    editor.destroy();
    expect(state?.results).toHaveLength(2);
    expect(state?.currentIndex).toBe(0);
  });

  it("count drops as replace all consumes matches", () => {
    const editor = makeEditor("<p><strong>nee</strong>dle and needle</p>");
    editor.commands.setSearchTerm("needle");
    editor.commands.setReplaceTerm("pin");
    editor.commands.replaceAll();
    const state = SearchPluginKey.getState(editor.state);
    editor.destroy();
    expect(state?.results).toHaveLength(0);
    expect(state?.currentIndex).toBe(0);
  });
});

describe("whitespace-only search term", () => {
  it("matches spaces in plain mode", () => {
    const editor = makeEditor("<p>a b c</p>");
    const results = search(editor, " ");
    editor.destroy();
    expect(results).toHaveLength(2);
  });

  it("an empty term still matches nothing", () => {
    const editor = makeEditor("<p>a b c</p>");
    const results = search(editor, "");
    editor.destroy();
    expect(results).toHaveLength(0);
  });
});
