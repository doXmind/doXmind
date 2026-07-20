/**
 * Page links and mentions must survive in the portable `.md`.
 *
 * They used to serialize as bare text, so any external edit of the file (which
 * invalidates the sidecar and makes the markdown authoritative) left the title
 * behind with no way back to the target — the reference evaporated. They now
 * serialize as an ordinary relative markdown link, and a standalone one
 * re-imports as the page-link card.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { markdownToHtml } from "@/lib/markdown";
import { useFileStore } from "@/stores/file-store";

const now = "2026-07-20T00:00:00.000Z";

function markdownFile(id: string, name: string, relPath: string) {
  return {
    id,
    name,
    content: "",
    isFolder: false,
    parentId: null,
    position: 0,
    isFavorite: false,
    createdAt: now,
    updatedAt: now,
    wordCount: 0,
    preview: "",
    documentType: "markdown" as const,
    storageHandle: { mode: "disk" as const, id, kind: "document" as const, relPath },
  };
}

function makeEditor(content = "<p></p>"): Editor {
  const editor = new Editor({ extensions: getEditorExtensions(), content });
  editor.commands.setContent(content, { emitUpdate: false } as never);
  return editor;
}

function markdownOf(editor: Editor): string {
  return (editor.getMarkdown() as string).trim();
}

beforeEach(() => {
  useFileStore.setState({
    files: [
      markdownFile("id-index", "Index", "Index.md"),
      markdownFile("id-other", "Other Doc", "Other Doc.md"),
      markdownFile("id-nested", "Nested", "notes/sub/Nested.md"),
    ],
    currentFileId: "id-index",
    openTarget: "folder",
    rootPath: "/workspace",
  });
});

describe("page link → markdown", () => {
  it("serializes a page link as a relative link to the target document", () => {
    const editor = makeEditor();
    editor.commands.setPageLink({ pageId: "id-other", pageTitle: "Other Doc" });
    const out = markdownOf(editor);
    editor.destroy();
    expect(out).toContain("[Other Doc](Other%20Doc.md)");
  });

  it("serializes a page mention inline, relative to the linking document", () => {
    const editor = makeEditor();
    editor.commands.setPageMention({ pageId: "id-nested", pageTitle: "Nested" });
    const out = markdownOf(editor);
    editor.destroy();
    expect(out).toContain("[Nested](notes/sub/Nested.md)");
  });

  it("keeps its own href after the target is renamed", () => {
    const editor = makeEditor();
    editor.commands.setPageLink({ pageId: "id-other", pageTitle: "Other Doc" });
    useFileStore.setState({
      files: useFileStore.getState().files.map((f) =>
        f.id === "id-other"
          ? {
              ...f,
              name: "Renamed",
              storageHandle: { ...f.storageHandle!, relPath: "Renamed.md" },
            }
          : f
      ),
    });
    const out = markdownOf(editor);
    editor.destroy();
    // The href a node carries wins over one recomputed at serialize time:
    // documentHrefForPage() resolves against the currently-selected document,
    // so recomputing rewrote correct links in files that merely happened to be
    // open elsewhere. Re-pointing after a rename therefore belongs to the
    // rename operation, which knows both endpoints and can rewrite the stored
    // hrefs — serialization does not and must not guess.
    expect(out).toContain("[Other Doc](Other%20Doc.md)");
  });

  it("keeps emitting the bare title when the target is not in the workspace", () => {
    // Legacy sidecar nodes carry no href. Losing the title outright would be
    // worse than the missing link, so the old plain-text form stays the floor.
    const editor = makeEditor();
    editor.commands.setPageLink({ pageId: "gone-123", pageTitle: "Vanished" });
    const out = markdownOf(editor);
    editor.destroy();
    expect(out).toContain("Vanished");
    expect(out).not.toContain("](");
  });

  it("emits nothing for an unlinked placeholder", () => {
    const editor = makeEditor();
    editor.commands.setPageLink({ pageId: "", pageTitle: "" });
    const out = markdownOf(editor);
    editor.destroy();
    expect(out).toBe("");
  });
});

describe("markdown → page link", () => {
  it("imports a standalone relative document link as the page-link card", () => {
    const editor = makeEditor(markdownToHtml("[Other Doc](Other%20Doc.md)"));
    const node = editor.state.doc.firstChild;
    const out = markdownOf(editor);
    editor.destroy();
    expect(node?.type.name).toBe("pageLink");
    expect(node?.attrs.pageId).toBe("id-other");
    expect(node?.attrs.pageTitle).toBe("Other Doc");
    expect(out).toBe("[Other Doc](Other%20Doc.md)");
  });

  it("survives the full round trip a page link takes through the .md", () => {
    const source = makeEditor();
    source.commands.setPageLink({ pageId: "id-other", pageTitle: "Other Doc" });
    const markdown = markdownOf(source);
    source.destroy();

    const reopened = makeEditor(markdownToHtml(markdown));
    const node = reopened.state.doc.firstChild;
    const out = markdownOf(reopened);
    reopened.destroy();
    expect(node?.type.name).toBe("pageLink");
    expect(node?.attrs.pageId).toBe("id-other");
    expect(out).toBe(markdown);
  });

  it("leaves a standalone link the user labelled themselves as a link", () => {
    // The label of a real page link is always the target's name — the node is
    // an atom, so there is nothing to type into. A different label means the
    // user wrote the link by hand and expects to keep editing it.
    const editor = makeEditor(markdownToHtml("[the spec](Other%20Doc.md)"));
    const node = editor.state.doc.firstChild;
    const out = markdownOf(editor);
    editor.destroy();
    expect(node?.type.name).toBe("paragraph");
    expect(out).toBe("[the spec](Other%20Doc.md)");
  });

  it("keeps the link intact when the target is missing from the workspace", () => {
    const editor = makeEditor(markdownToHtml("[Gone](Missing.md)"));
    const out = markdownOf(editor);
    editor.destroy();
    expect(out).toBe("[Gone](Missing.md)");
  });

  it("leaves an inline link inside a sentence alone", () => {
    const editor = makeEditor(markdownToHtml("See [Other Doc](Other%20Doc.md) for details."));
    const node = editor.state.doc.firstChild;
    const out = markdownOf(editor);
    editor.destroy();
    expect(node?.type.name).toBe("paragraph");
    expect(out).toBe("See [Other Doc](Other%20Doc.md) for details.");
  });

  it("leaves a link-only list item as a list item", () => {
    const editor = makeEditor(
      markdownToHtml("- [Other Doc](Other%20Doc.md)\n- [Nested](notes/sub/Nested.md)")
    );
    const node = editor.state.doc.firstChild;
    const out = markdownOf(editor);
    editor.destroy();
    expect(node?.type.name).toBe("bulletList");
    expect(out).toContain("- [Other Doc](Other%20Doc.md)");
  });

  it("recovers a page link whose target changed id since it was written", () => {
    // A document that has never been opened is identified by its path; opening
    // it gives it a sidecar id and the old id stops resolving. The stored href
    // is what carries the reference across that.
    const editor = makeEditor(
      '<div data-type="page-link" data-page-id="path:stale" data-page-href="Other%20Doc.md"' +
        ' data-page-title="Other Doc"></div>'
    );
    const node = editor.state.doc.firstChild;
    editor.destroy();
    expect(node?.type.name).toBe("pageLink");
    expect(node?.attrs.pageId).toBe("id-other");
  });

  it("leaves a standalone external link as a paragraph", () => {
    const editor = makeEditor(markdownToHtml("[Home](https://example.com)"));
    const node = editor.state.doc.firstChild;
    editor.destroy();
    expect(node?.type.name).toBe("paragraph");
  });

  it("leaves a standalone image link alone", () => {
    const editor = makeEditor(markdownToHtml("[Diagram](assets/diagram.png)"));
    const node = editor.state.doc.firstChild;
    editor.destroy();
    expect(node?.type.name).toBe("paragraph");
  });
});
