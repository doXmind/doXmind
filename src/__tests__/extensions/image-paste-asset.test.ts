/**
 * Pasted / dropped images must land in the workspace as a real file and be
 * referenced from the `.md` by a portable relative path. The sidecar's
 * `/api/images/<uuid>` URL is neither: the webview cannot load a root-relative
 * path (its origin is the app, not the sidecar), and no other Markdown tool
 * can resolve it either — so it leaves the user's file pointing at nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
const notifyErrorMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));

vi.mock("@/lib/notifications", () => ({
  notify: {
    error: (...args: unknown[]) => notifyErrorMock(...args),
    promise: vi.fn(),
    dismiss: vi.fn(),
  },
}));

import { Editor } from "@tiptap/core";
import type { Plugin } from "@tiptap/pm/state";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { useFileStore } from "@/stores/file-store";

function mountWorkspace(): void {
  useFileStore.setState({
    rootPath: "/ws",
    currentFileId: "doc-1",
    files: [
      {
        id: "doc-1",
        name: "notes.md",
        storageHandle: { mode: "disk", id: "doc-1", kind: "document", relPath: "notes/notes.md" },
      },
    ],
  } as never);
}

function makeEditor(): Editor {
  return new Editor({ extensions: getEditorExtensions(), content: "<p>hello</p>" });
}

function imageUploadPlugin(editor: Editor): Plugin {
  const plugin = editor.view.state.plugins.find((candidate) =>
    String((candidate as unknown as { key: string }).key).startsWith("imageUpload$")
  );
  if (!plugin) throw new Error("image upload plugin not registered");
  return plugin as Plugin;
}

function pngFile(name: string): File {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const file = new File([bytes], name, { type: "image/png" });
  // jsdom's Blob has no arrayBuffer(); every real webview does.
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
  return file;
}

function pasteEvent(file: File): ClipboardEvent {
  return {
    preventDefault: vi.fn(),
    clipboardData: { items: [{ type: file.type, getAsFile: () => file }] },
  } as unknown as ClipboardEvent;
}

function dropEvent(file: File): DragEvent {
  return {
    preventDefault: vi.fn(),
    clientX: 0,
    clientY: 0,
    dataTransfer: { files: [file] },
  } as unknown as DragEvent;
}

describe("pasted and dropped images", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    notifyErrorMock.mockReset();
    invokeMock.mockResolvedValue({ path: "./assets/pasted-image.png" });
    mountWorkspace();
    // jsdom has no layout engine; posAtCoords needs this to exist to bail out.
    document.elementFromPoint = () => null;
  });

  it("imports a pasted image into the workspace and writes a relative path", async () => {
    const editor = makeEditor();
    const plugin = imageUploadPlugin(editor);
    const file = pngFile("pasted-image.png");

    const handled = plugin.props.handlePaste?.call(
      plugin,
      editor.view,
      pasteEvent(file),
      null as never
    );
    expect(handled).toBe(true);

    await vi.waitFor(() => {
      expect(editor.getMarkdown()).toContain("./assets/pasted-image.png");
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "workspace_import_asset",
      expect.objectContaining({
        root: "/ws",
        documentPath: "notes/notes.md",
        filename: "pasted-image.png",
      })
    );

    const markdown = editor.getMarkdown() as string;
    expect(markdown).toContain("![pasted-image](./assets/pasted-image.png)");
    expect(markdown).not.toContain("/api/images/");
    editor.destroy();
  });

  it("gives a clipboard image with no filename a usable name and extension", async () => {
    const editor = makeEditor();
    const plugin = imageUploadPlugin(editor);
    const file = pngFile("");

    plugin.props.handlePaste?.call(plugin, editor.view, pasteEvent(file), null as never);

    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalled());
    const filename = invokeMock.mock.calls[0][1].filename as string;
    expect(filename).toMatch(/\.png$/);
    editor.destroy();
  });

  it("imports a dropped image the same way", async () => {
    const editor = makeEditor();
    const plugin = imageUploadPlugin(editor);

    const handled = plugin.props.handleDrop?.call(
      plugin,
      editor.view,
      dropEvent(pngFile("dropped.png")),
      null as never,
      false
    );
    expect(handled).toBe(true);

    await vi.waitFor(() => {
      expect(editor.getMarkdown()).toContain("./assets/pasted-image.png");
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "workspace_import_asset",
      expect.objectContaining({ filename: "dropped.png" })
    );
    editor.destroy();
  });

  it("inserts nothing when there is no workspace document to import into", async () => {
    useFileStore.setState({ rootPath: null, currentFileId: null, files: [] } as never);
    const editor = makeEditor();
    const plugin = imageUploadPlugin(editor);

    plugin.props.handlePaste?.call(
      plugin,
      editor.view,
      pasteEvent(pngFile("x.png")),
      null as never
    );

    await vi.waitFor(() => expect(notifyErrorMock).toHaveBeenCalled());
    expect(invokeMock).not.toHaveBeenCalled();
    expect(editor.getMarkdown()).not.toContain("![");
    editor.destroy();
  });
});
