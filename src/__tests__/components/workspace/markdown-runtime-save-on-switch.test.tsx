import { NextIntlClientProvider } from "next-intl";
import { act, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/messages/en.json";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { MarkdownRuntime } from "@/components/workspace/markdown-runtime";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useEditorStore } from "@/stores/editor-store";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { useNotificationStore } from "@/stores/notification-store";

const now = "2026-07-01T00:00:00.000Z";

function markdownFile(name: string, html: string, markdown: string): FileItem {
  const id = `path:${name}`;
  return {
    id,
    name,
    content: html,
    contentMarkdown: markdown,
    isFolder: false,
    parentId: null,
    position: 0,
    isFavorite: false,
    createdAt: now,
    updatedAt: now,
    wordCount: 0,
    preview: "",
    documentType: "markdown",
    storageHandle: {
      mode: "disk",
      id,
      kind: "document",
      documentType: "markdown",
      path: `/workspace/${name}`,
      relPath: name,
    },
  };
}

const fileA = markdownFile("A.md", "<p>Alpha</p>", "Alpha");
const fileB = markdownFile("B.md", "<p>Bravo</p>", "Bravo");

/**
 * An HTML document whose on-disk markup is NOT already ProseMirror-normalized
 * (extra attributes survive via the html source baseline). The flush path has
 * to compare against the preserved raw markup, not the normalized form, or an
 * untouched file looks edited.
 */
function htmlFile(name: string, html: string): FileItem {
  const file = markdownFile(name, html, "");
  return {
    ...file,
    documentType: "html",
    contentMarkdown: null,
    storageHandle: { ...file.storageHandle!, documentType: "html" },
  } as FileItem;
}

const filePage = htmlFile(
  "Page.html",
  '<h1 id="t" class="title">Title</h1>\n<p data-x="1">Body text here</p>'
);

/** Every `doc_write_workspace` call the adapter made, in order. */
function writes() {
  return invokeMock.mock.calls
    .filter(([command]) => command === "doc_write_workspace")
    .map(([, payload]) => payload as { path: string; payload: Record<string, string> });
}

function seedStore() {
  useFileStore.setState({
    files: [fileA, fileB],
    currentFileId: fileA.id,
    openTabIds: [fileA.id, fileB.id],
    currentFolderId: null,
    openTarget: "folder",
    rootPath: "/workspace",
    openFilePath: null,
    transientFile: null,
    recents: [],
    isLoading: false,
    isSynced: true,
    justCreatedFileId: null,
    expandedFolderIds: new Set(),
    selectedFileIds: new Set(),
    loadedContentIds: new Set([fileA.id, fileB.id]),
  });
}

function withIntl(ui: ReactElement) {
  return (
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>
  );
}

/** Let TipTap's deferred mount, the switch macrotask, and the save land. */
async function settle(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/**
 * Documents open in read mode; a printable keypress is the real activation
 * path into edit mode. Typing before that would never mark the doc dirty.
 */
async function activateEditMode() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));
  });
  await settle();
}

async function typeIntoEditor(text: string) {
  const editor = useEditorRefStore.getState().editor;
  if (!editor) throw new Error("editor never registered");
  if (!editor.isEditable) await activateEditMode();
  await act(async () => {
    useEditorRefStore
      .getState()
      .editor?.commands.insertContentAt(
        useEditorRefStore.getState().editor!.state.doc.content.size - 1,
        text
      );
  });
}

describe("MarkdownRuntime save-on-switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom has no layout engine; the keyboard edit-activation path calls
    // posAtCoords, which needs it.
    if (!document.elementFromPoint) {
      (document as Document & { elementFromPoint: () => null }).elementFromPoint = () => null;
    }
    invokeMock.mockImplementation(async (command: string, args: { payload?: unknown }) => {
      if (command === "doc_write_workspace") {
        const payload = (args.payload ?? {}) as Record<string, string>;
        return {
          html: payload.html ?? "",
          editorHtml: payload.html ?? "",
          browsingHtml: payload.html ?? "",
          markdown: payload.markdown ?? "",
          meta: { id: "doc", title: "Doc", created: now, updated: now },
          extras: {},
          source: "sidecar",
          sourceState: "sidecar_fresh",
          outline: [],
          browsingRendererVersion: "browsing-html/v1",
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    seedStore();
    useEditorStore.setState({ isDirty: false, isSaving: false, lastSavedAt: null });
    useNotificationStore.setState({ errors: [], progress: [] });
  });

  it("writes an edit made inside the debounce window before swapping to another file", async () => {
    const { rerender } = render(withIntl(<MarkdownRuntime file={fileA} />));
    await settle();

    await typeIntoEditor(" IMPORTANT-EDIT");
    expect(useEditorStore.getState().isDirty).toBe(true);

    // Switch well inside EDITOR_DEBOUNCE_DELAY — the trailing timer has not
    // fired, so only a flush on switch can get this to disk.
    rerender(withIntl(<MarkdownRuntime file={fileB} />));
    await settle(50);

    const docWrites = writes();
    expect(docWrites).toHaveLength(1);
    expect(docWrites[0].path).toBe("A.md");
    expect(docWrites[0].payload.markdown).toContain("IMPORTANT-EDIT");
  });

  it("writes an edit made inside the debounce window before the runtime unmounts", async () => {
    const { unmount } = render(withIntl(<MarkdownRuntime file={fileA} />));
    await settle();

    await typeIntoEditor(" IMPORTANT-EDIT");
    unmount();
    await settle(50);

    const docWrites = writes();
    expect(docWrites).toHaveLength(1);
    expect(docWrites[0].path).toBe("A.md");
    expect(docWrites[0].payload.markdown).toContain("IMPORTANT-EDIT");
  });

  it("does not write the outgoing buffer into the incoming file", async () => {
    const { rerender } = render(withIntl(<MarkdownRuntime file={fileA} />));
    await settle();

    await typeIntoEditor(" IMPORTANT-EDIT");
    rerender(withIntl(<MarkdownRuntime file={fileB} />));
    await settle(1500);

    expect(writes().some((w) => w.path === "A.md")).toBe(true);
    for (const write of writes()) {
      if (write.path === "B.md") {
        expect(write.payload.markdown).not.toContain("IMPORTANT-EDIT");
      }
    }
  });

  it("writes nothing when switching away from a document the user never edited", async () => {
    // Guards the flush against writing files the user only looked at. The
    // .html fixture is deliberate: its on-disk markup is not ProseMirror-
    // normalized, so the flush has to compare against the preserved raw markup
    // that setHtmlBaseline installs rather than the normalized form.
    const { rerender } = render(withIntl(<MarkdownRuntime file={fileA} />));
    await settle();

    rerender(withIntl(<MarkdownRuntime file={filePage} />));
    await settle(1500);

    rerender(withIntl(<MarkdownRuntime file={fileB} />));
    await settle(1500);

    expect(writes().some((w) => w.path === "Page.html")).toBe(false);
  });

  it("flushes each outgoing buffer once across a rapid A→B→A switch", async () => {
    const { rerender } = render(withIntl(<MarkdownRuntime file={fileA} />));
    await settle();

    await typeIntoEditor(" EDIT-A");
    rerender(withIntl(<MarkdownRuntime file={fileB} />));
    await settle();

    await typeIntoEditor(" EDIT-B");
    rerender(withIntl(<MarkdownRuntime file={fileA} />));
    await settle(1500);

    const byPath = writes();
    const aWrites = byPath.filter((w) => w.path === "A.md");
    const bWrites = byPath.filter((w) => w.path === "B.md");
    expect(aWrites).toHaveLength(1);
    expect(aWrites[0].payload.markdown).toContain("EDIT-A");
    expect(bWrites).toHaveLength(1);
    expect(bWrites[0].payload.markdown).toContain("EDIT-B");
    expect(bWrites[0].payload.markdown).not.toContain("EDIT-A");
  });

  it("tells the user when an external rewrite replaces an unsaved buffer", async () => {
    const { rerender } = render(withIntl(<MarkdownRuntime file={fileA} />));
    await settle();

    await typeIntoEditor(" UNSAVED-LOCAL");

    // Somebody rewrote A.md outside doXmind; the workspace refresh hands us
    // the disk version while the local edit is still only in the editor.
    const external = {
      ...fileA,
      content: "<p>Alpha rewritten elsewhere</p>",
      contentMarkdown: "Alpha rewritten elsewhere",
    };
    rerender(withIntl(<MarkdownRuntime file={external} />));
    await settle(50);

    const editor = useEditorRefStore.getState().editor;
    expect(editor?.getHTML()).toContain("rewritten elsewhere");
    expect(editor?.getHTML()).not.toContain("UNSAVED-LOCAL");

    const banners = useNotificationStore.getState().errors;
    expect(banners).toHaveLength(1);
    expect(banners[0].title).toBe("A.md changed on disk");
    expect(banners[0].persistent).toBe(true);
  });
});
