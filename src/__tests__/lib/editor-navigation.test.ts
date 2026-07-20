/**
 * In-app resolution of document-relative and anchor links.
 * A relative `[spec](Other Doc.md)` must navigate to that document inside the
 * app; it must never fall through to `window.open`, which resolves the path
 * against `/editor/<id>` and lands on a route that does not exist.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { Editor } from "@tiptap/core";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useFileStore } from "@/stores/file-store";
import {
  classifyHref,
  documentHrefForPage,
  documentNameForPage,
  normalizeWorkspacePath,
  openEditorLink,
  relativeDocumentHref,
  resolveEditorLink,
  scrollToHeadingAnchor,
} from "@/lib/editor-navigation";

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

describe("classifyHref", () => {
  it("treats explicit schemes as external", () => {
    expect(classifyHref("https://example.com")).toEqual({ kind: "external" });
    expect(classifyHref("mailto:a@b.c")).toEqual({ kind: "external" });
    expect(classifyHref("//example.com/x")).toEqual({ kind: "external" });
  });

  it("treats a bare fragment as an in-document anchor", () => {
    expect(classifyHref("#storage-model")).toEqual({ kind: "anchor", anchor: "storage-model" });
  });

  it("splits a relative path from its fragment and decodes it", () => {
    expect(classifyHref("Other%20Doc.md#top")).toEqual({
      kind: "path",
      path: "Other Doc.md",
      anchor: "top",
    });
  });

  it("has no target for an empty href", () => {
    expect(classifyHref("   ")).toBeNull();
  });
});

describe("normalizeWorkspacePath", () => {
  it("resolves . and .. against the containing directory", () => {
    expect(normalizeWorkspacePath("notes/sub", "../Other.md")).toBe("notes/Other.md");
    expect(normalizeWorkspacePath("notes/sub", "./x.md")).toBe("notes/sub/x.md");
    expect(normalizeWorkspacePath("notes", "/root.md")).toBe("root.md");
  });

  it("cannot escape the workspace root", () => {
    expect(normalizeWorkspacePath("", "../../etc/passwd")).toBe("etc/passwd");
  });
});

describe("relativeDocumentHref", () => {
  it("links to a sibling by bare name", () => {
    expect(relativeDocumentHref("Index.md", "Other Doc.md")).toBe("Other%20Doc.md");
  });

  it("descends into a subdirectory", () => {
    expect(relativeDocumentHref("Index.md", "notes/sub/Nested.md")).toBe("notes/sub/Nested.md");
  });

  it("climbs out of a subdirectory", () => {
    expect(relativeDocumentHref("notes/sub/Nested.md", "Other Doc.md")).toBe(
      "../../Other%20Doc.md"
    );
  });
});

describe("resolveEditorLink", () => {
  it("resolves a relative link to the target document", () => {
    expect(resolveEditorLink("Other%20Doc.md")).toEqual({
      kind: "document",
      fileId: "id-other",
      anchor: null,
    });
  });

  it("carries the fragment through to the target document", () => {
    expect(resolveEditorLink("notes/sub/Nested.md#intro")).toEqual({
      kind: "document",
      fileId: "id-nested",
      anchor: "intro",
    });
  });

  it("resolves relative to the document the link lives in", () => {
    useFileStore.setState({ currentFileId: "id-nested" });
    expect(resolveEditorLink("../../Other Doc.md")).toEqual({
      kind: "document",
      fileId: "id-other",
      anchor: null,
    });
  });

  it("reports an unresolved path rather than pretending it is external", () => {
    expect(resolveEditorLink("Missing.md")).toEqual({
      kind: "unresolved",
      path: "Missing.md",
    });
  });

  it("passes real URLs through as external", () => {
    expect(resolveEditorLink("https://example.com")).toEqual({ kind: "external" });
  });
});

describe("anchor links", () => {
  it("moves the caret to the heading the fragment names", () => {
    const editor = new Editor({
      extensions: getEditorExtensions(),
      content: "<p>intro</p><h2>Storage Model</h2><p>body</p>",
    });
    useEditorRefStore.setState({ editor });

    scrollToHeadingAnchor("storage-model", 0);

    const headingPos = editor.state.doc.resolve(editor.state.selection.from).parent;
    expect(headingPos.type.name).toBe("heading");
    expect(headingPos.textContent).toBe("Storage Model");
    useEditorRefStore.setState({ editor: null });
    editor.destroy();
  });

  it("never sends a bare fragment to the browser", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    expect(openEditorLink("#nothing-here")).toBe(true);
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("refuses to hand the browser a scheme it has no business opening", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    expect(openEditorLink("javascript:alert(1)")).toBe(false);
    expect(openEditorLink("file:///etc/passwd")).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("stays put rather than opening a window on a path it cannot resolve", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    expect(openEditorLink("Missing.md")).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});

describe("page target lookup", () => {
  it("returns a link relative to the document being serialized", () => {
    expect(documentHrefForPage("id-nested", "id-index")).toBe("notes/sub/Nested.md");
    expect(documentHrefForPage("id-index", "id-nested")).toBe("../../Index.md");
  });

  it("returns null for an unknown page", () => {
    expect(documentHrefForPage("id-missing", "id-index")).toBeNull();
    expect(documentNameForPage("id-missing")).toBeNull();
  });

  it("returns the target's current name in the workspace", () => {
    expect(documentNameForPage("id-other")).toBe("Other Doc");
  });
});
