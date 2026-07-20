/**
 * The link bubble menu reads the active link off the editor. It used to do so
 * during render only, so the very first time a link came under the caret after
 * page load nothing re-rendered the component and every control still held the
 * empty URL captured at mount.
 *
 * It also has to follow workspace-relative and anchor links in-app: handing
 * them to window.open resolves them against /editor/<id>, which is not a route.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { LinkBubbleMenu } from "@/components/editor/link-bubble-menu";
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

function makeEditor(html: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({ element, extensions: getEditorExtensions(), content: html });
}

// The caret position inside the first link mark of the document.
function posInsideLink(editor: Editor): number {
  let found = 0;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.isText && node.marks.some((m) => m.type.name === "link")) found = pos + 1;
    return true;
  });
  return found;
}

// jsdom has no layout, and the bubble menu positions itself off the caret's
// client rect on every editor transaction.
beforeAll(() => {
  const rect = { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0 };
  const stub = { getClientRects: () => [rect], getBoundingClientRect: () => rect };
  Object.assign(Text.prototype, stub);
  Object.assign(Range.prototype, stub);
});

beforeEach(() => {
  useFileStore.setState({
    files: [
      markdownFile("id-index", "Index", "Index.md"),
      markdownFile("id-other", "Other Doc", "Other Doc.md"),
    ],
    currentFileId: "id-index",
    openTarget: "folder",
    rootPath: "/workspace",
  });
});

describe("LinkBubbleMenu", () => {
  it("shows the link under the caret the first time one appears after mount", async () => {
    const editor = makeEditor('<p>plain</p><p><a href="https://example.com/spec">spec</a></p>');
    render(<LinkBubbleMenu editor={editor} />);

    expect(screen.queryByText("https://example.com/spec")).not.toBeInTheDocument();

    await act(async () => {
      editor.commands.setTextSelection(posInsideLink(editor));
    });

    expect(screen.getByTitle("https://example.com/spec")).toBeInTheDocument();
    editor.destroy();
  });

  it("opens a workspace-relative link in-app instead of in a new window", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const editor = makeEditor('<p>plain</p><p>see <a href="Other%20Doc.md">spec</a> here</p>');
    render(<LinkBubbleMenu editor={editor} />);

    await act(async () => {
      editor.commands.setTextSelection(posInsideLink(editor));
    });
    await act(async () => {
      screen.getByTitle("linkMenu.open").click();
    });

    expect(openSpy).not.toHaveBeenCalled();
    expect(useFileStore.getState().currentFileId).toBe("id-other");
    openSpy.mockRestore();
    editor.destroy();
  });

  it("still opens a real URL in the browser", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const editor = makeEditor('<p>plain</p><p><a href="https://example.com/spec">spec</a></p>');
    render(<LinkBubbleMenu editor={editor} />);

    await act(async () => {
      editor.commands.setTextSelection(posInsideLink(editor));
    });
    await act(async () => {
      screen.getByTitle("linkMenu.open").click();
    });

    expect(openSpy).toHaveBeenCalledWith("https://example.com/spec", "_blank", expect.any(String));
    openSpy.mockRestore();
    editor.destroy();
  });
});
