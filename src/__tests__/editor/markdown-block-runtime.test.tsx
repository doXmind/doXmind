import { act, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which Blocks were re-rendered, observed through the editing projection every row builds.
 *
 * A row keeps its projection in a `useMemo` keyed on `block`, and `getSnapshot()` hands out a fresh
 * Block object on every call — so a row that actually re-renders always lands here, and a row the
 * memo skips never does. This is how the "typing does not touch the other rows" test pins the
 * mechanism; a wall-clock assertion would be flaky.
 */
const { projectedBlockSources } = vi.hoisted(() => ({ projectedBlockSources: [] as string[] }));

vi.mock("@/editor/markdown-block/block-editing-projection", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/editor/markdown-block/block-editing-projection")>();
  return {
    ...actual,
    createBlockEditingProjection: (
      block: Parameters<typeof actual.createBlockEditingProjection>[0]
    ) => {
      projectedBlockSources.push(block.raw);
      return actual.createBlockEditingProjection(block);
    },
  };
});

import { MarkdownBlockDocument } from "@/editor/markdown-block/markdown-block-document";
import {
  MarkdownBlockRuntime,
  type MarkdownImageServices,
  type MarkdownTransclusionServices,
} from "@/editor/markdown-block/markdown-block-runtime";
import { eventBus } from "@/lib/events";
import type { KnowledgeSourceIndex } from "@/lib/knowledge-index";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useEditorStore } from "@/stores/editor-store";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useNotificationStore } from "@/stores/notification-store";
import { usePageSessionStore } from "@/stores/page-session-store";

const createTransientFile = vi.fn((name: string) => `transient-${name}`);
const updateFile = vi.fn(
  async (_id: string, _updates: Partial<Pick<FileItem, "content" | "name">>): Promise<void> => {}
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function dragTransfer(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    dropEffect: "none",
    effectAllowed: "uninitialized",
    files: [],
    items: [],
    get types() {
      return [...data.keys()];
    },
    clearData(type?: string) {
      if (type) data.delete(type);
      else data.clear();
    },
    getData(type: string) {
      return data.get(type) ?? "";
    },
    setData(type: string, value: string) {
      data.set(type, value);
    },
    setDragImage: vi.fn(),
  } as unknown as DataTransfer;
}

/**
 * jsdom has no `DragEvent`, so Testing Library falls back to a plain `Event` and silently drops
 * `clientY`. Define it explicitly, or every coordinate-based assertion is vacuous.
 */
function fireDragAt(
  target: HTMLElement,
  type: "dragOver" | "drop",
  dataTransfer: DataTransfer,
  clientY: number
) {
  const event = createEvent[type](target, { dataTransfer });
  Object.defineProperty(event, "clientY", { value: clientY, configurable: true });
  return fireEvent(target, event);
}

/**
 * jsdom implements neither `DragEvent` nor `PointerEvent`, so Testing Library falls back to a plain
 * `Event` and the coordinates never arrive. Define them explicitly.
 */
function firePointerAt(
  target: Window | HTMLElement,
  type: "pointerDown" | "pointerMove" | "pointerUp",
  clientX: number,
  clientY: number
) {
  const event = createEvent[type](target as Element, { button: 0 });
  Object.defineProperty(event, "clientX", { value: clientX, configurable: true });
  Object.defineProperty(event, "clientY", { value: clientY, configurable: true });
  return fireEvent(target as Element, event);
}

/** Stack rows vertically so the drop-boundary table has real geometry to pick from. */
function stackRowRects(rows: ArrayLike<HTMLElement>, height = 40, top = 100) {
  for (let index = 0; index < rows.length; index += 1) {
    const rowTop = top + index * height;
    vi.spyOn(rows[index], "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: rowTop,
      top: rowTop,
      left: 0,
      right: 600,
      bottom: rowTop + height,
      width: 600,
      height,
      toJSON: () => ({}),
    });
  }
}

function setCollapsedDomSelection(node: Node, offset: number) {
  const selection = window.getSelection();
  if (!selection) throw new Error("Selection API unavailable");
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

const file: FileItem = {
  id: "page-1",
  name: "Page",
  content: "Hello\n",
  isFolder: false,
  parentId: null,
  position: 0,
  isFavorite: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  wordCount: 1,
  preview: "Hello",
};

describe("MarkdownBlockRuntime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    updateFile.mockClear();
    createTransientFile.mockClear();
    useFileStore.setState({ updateFile });
    useEditorStore.setState({ isDirty: false, isSaving: false, lastSavedAt: null });
    useEditorRefStore.setState({
      requestSave: null,
      requestUndo: null,
      requestRedo: null,
      discardPendingChanges: null,
    });
    useLayoutStore.setState({ autosaveEnabled: true, isSearchBarOpen: false });
    usePageSessionStore.setState({ outlineSession: null, revealRequest: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // The suite runs on fake timers, so the menu's own open transition has to be advanced rather
  // than waited for.
  const openBlockMenu = async () => {
    fireEvent.click(screen.getAllByRole("button", { name: "Block actions" })[0]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
  };

  const openFind = async (term: string) => {
    useLayoutStore.setState({ isSearchBarOpen: true, isReplaceOpen: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.change(screen.getByLabelText("Search text"), { target: { value: term } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  };

  it("marks the current match without waiting on a selection it has already consumed", async () => {
    // A plain paragraph, which renders the raw textarea until a match asks otherwise.
    render(<MarkdownBlockRuntime file={{ ...file, content: "alpha needle beta\n" }} />);
    await openFind("needle");

    expect(screen.getByText("1 of 1")).toBeInTheDocument();
    // The highlight used to be derived from `pendingSelection`, which is cleared as soon as it is
    // applied — so the counter said "1 of 1" while nothing on the Page was marked.
    expect(document.querySelector("[data-native-search-selection]")).toHaveTextContent("needle");
  });

  it("counts matches case-sensitively once Aa is pressed", async () => {
    render(<MarkdownBlockRuntime file={{ ...file, content: "Needle and needle\n" }} />);
    await openFind("needle");
    expect(screen.getByText("1 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Match case"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
  });

  it("reports a half-typed regex instead of throwing on the keystroke", async () => {
    render(<MarkdownBlockRuntime file={{ ...file, content: "needle\n" }} />);
    await openFind("needle");
    fireEvent.click(screen.getByLabelText("Use regular expression"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // `/(` is a syntax error on the way to `/(a)/`; the bar has to survive it.
    fireEvent.change(screen.getByLabelText("Search text"), { target: { value: "ne(" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Bad pattern")).toBeInTheDocument();
  });

  it("replaces every match back to front, so the offsets ahead stay valid", async () => {
    render(<MarkdownBlockRuntime file={{ ...file, content: "one needle two needle three\n" }} />);
    await openFind("needle");
    expect(screen.getByText("1 of 2")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Replace with"), { target: { value: "PIN" } });
    fireEvent.click(screen.getByLabelText("Replace all"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(updateFile).toHaveBeenCalledWith("page-1", {
      content: "one PIN two PIN three\n",
    });
  });

  it("folds a heading section out of view and back, without touching the Markdown", async () => {
    const content = "# One\n\nunder one\n\n# Two\n\nunder two\n";
    render(<MarkdownBlockRuntime file={{ ...file, content }} />);

    expect(screen.getByText("under one")).toBeInTheDocument();

    // Reached through the Block menu: the gutter's 54px slot holds exactly two 24px controls.
    await openBlockMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Fold section" }));

    expect(screen.queryByText("under one")).toBeNull();
    // The other section is untouched, and so is the file.
    expect(screen.getByText("under two")).toBeInTheDocument();
    expect(updateFile).not.toHaveBeenCalled();

    await openBlockMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Unfold section" }));
    expect(screen.getByText("under one")).toBeInTheDocument();
  });

  it("reveals a folded section when the caret is sent inside it", async () => {
    const content = "# One\n\nhidden needle\n\n# Two\n\ntail\n";
    render(<MarkdownBlockRuntime file={{ ...file, content }} />);

    await openBlockMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Fold section" }));
    expect(screen.queryByText("hidden needle")).toBeNull();

    // A search result asks for body line 3, which is inside the fold. A Block with no row cannot
    // be edited or even seen, so the fold has to open rather than swallow the caret.
    act(() => {
      usePageSessionStore.getState().requestReveal("page-1", 3);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByLabelText("Markdown block")).toHaveValue("hidden needle");
  });

  it("puts the caret in the Block a search hit's line falls inside", async () => {
    const multi: FileItem = {
      ...file,
      content: "# Title\n\nAlpha needle\n\n## Section\n\nBeta needle\n",
    };
    render(<MarkdownBlockRuntime file={multi} />);

    // Body line 7 is "Beta needle" — the fourth Block, not the fourth line of the first Block.
    act(() => {
      usePageSessionStore.getState().requestReveal("page-1", 7);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByLabelText("Markdown block")).toHaveValue("Beta needle");
    // Consumed, so re-rendering for any other reason does not move the caret again.
    expect(usePageSessionStore.getState().revealRequest).toBe(null);
  });

  it("ignores a reveal aimed at a different Page", async () => {
    render(<MarkdownBlockRuntime file={{ ...file, content: "Alpha\n\nBeta\n" }} />);

    act(() => {
      usePageSessionStore.getState().requestReveal("some-other-page", 3);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.queryByLabelText("Markdown block")).toBeNull();
    // Left standing for the Page it was meant for.
    expect(usePageSessionStore.getState().revealRequest).toMatchObject({
      pageId: "some-other-page",
    });
  });

  it("edits a source block and autosaves canonical Markdown", async () => {
    render(<MarkdownBlockRuntime file={file} />);

    fireEvent.click(screen.getByText("Hello"));
    const textarea = screen.getByLabelText("Markdown block");
    fireEvent.change(textarea, { target: { value: "Hello world" } });

    expect(useEditorStore.getState().isDirty).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(updateFile).toHaveBeenCalledWith("page-1", {
      content: "Hello world\n",
    });
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it("keeps an authored whitespace-only block separator outside the active textarea", () => {
    render(
      <MarkdownBlockRuntime
        file={{
          ...file,
          content: "Alpha\r\n  \r\nBeta\r\n",
        }}
      />
    );

    fireEvent.click(screen.getByText("Alpha"));

    expect(screen.getByLabelText("Markdown block")).toHaveValue("Alpha");
  });

  it("edits block content without rewriting an authored whitespace-only separator", async () => {
    render(
      <MarkdownBlockRuntime
        file={{
          ...file,
          content: "Alpha\r\n\t\r\nBeta\r\n",
        }}
      />
    );

    fireEvent.click(screen.getByText("Alpha"));
    fireEvent.change(screen.getByLabelText("Markdown block"), {
      target: { value: "Alpha!" },
    });
    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });

    expect(updateFile).toHaveBeenCalledWith(
      "page-1",
      expect.objectContaining({ content: "Alpha!\r\n\t\r\nBeta\r\n" })
    );
  });

  it("runs one slash command through canonical source history and preserves CRLF", async () => {
    const { container } = render(<MarkdownBlockRuntime file={{ ...file, content: "/tog\r\n" }} />);

    fireEvent.click(screen.getByText("/tog"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Enter" });

    // The command inserts a toggle, and a toggle renders as a disclosure rather than as its own
    // `<details>` scaffolding — so what proves the insertion is the rendered Block, not raw source
    // in a field. The scaffolding still has to reach the file, which the save assertion below covers.
    expect(screen.getByTestId("toggle-block")).toBeInTheDocument();
    expect(screen.getByTestId("toggle-block").textContent).not.toContain("<summary>");
    expect(container.querySelector("[data-native-markdown-document]")).toHaveAttribute(
      "data-revision",
      "1"
    );

    // Undo from wherever the command left the caret, which is inside the Block it created.
    const undoFrom = () => document.activeElement ?? document.body;
    fireEvent.keyDown(undoFrom(), { key: "z", metaKey: true });
    expect(screen.getByLabelText("Markdown block")).toHaveValue("/tog");
    fireEvent.keyDown(undoFrom(), {
      key: "z",
      metaKey: true,
      shiftKey: true,
    });

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenCalledWith(
      "page-1",
      expect.objectContaining({
        content:
          "<details>\r\n<summary>Toggle</summary>\r\n\r\nWrite something…\r\n\r\n</details>\r\n",
      })
    );
  });

  it("rebuilds recursive transclusion through a read-only derived-index service", async () => {
    const embeddedFile = {
      ...file,
      storageHandle: {
        mode: "disk" as const,
        kind: "document" as const,
        id: file.id,
        relPath: "Notes/Page.md",
        documentType: "markdown" as const,
      },
      content: "![[Target]]\n",
    };
    const index: KnowledgeSourceIndex = {
      pages: [
        { id: file.id, path: "Notes/Page.md", title: "Page", aliases: [] },
        { id: "target", path: "Notes/Target.md", title: "Target", aliases: [] },
      ],
      sourcePages: [
        {
          id: file.id,
          path: "Notes/Page.md",
          title: "Page",
          aliases: [],
          markdown: embeddedFile.content,
        },
        {
          id: "target",
          path: "Notes/Target.md",
          title: "Target",
          aliases: [],
          markdown: "Target source.\n",
        },
      ],
      links: [],
      backlinks: [],
      unlinkedMentions: [],
    };
    const services: MarkdownTransclusionServices = {
      rebuild: vi.fn(async () => index),
    };

    render(<MarkdownBlockRuntime file={embeddedFile} transclusionServices={services} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(services.rebuild).toHaveBeenCalledOnce();
    expect(screen.getByTestId("wiki-embed")).toHaveTextContent("Target source.");
    expect(updateFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("wiki-embed"));
    fireEvent.change(screen.getByLabelText("Markdown block"), {
      target: { value: "![[Target|Renamed label]]" },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(services.rebuild).toHaveBeenCalledOnce();
    expect(screen.getByTestId("wiki-embed")).toHaveTextContent("Target source.");
  });

  it("invalidates a transclusion projection when workspace storage changes", async () => {
    const embeddedFile = {
      ...file,
      storageHandle: {
        mode: "disk" as const,
        kind: "document" as const,
        id: file.id,
        relPath: "Notes/Page.md",
        documentType: "markdown" as const,
      },
      content: "![[Target]]\n",
    };
    const indexWithTarget = (markdown: string): KnowledgeSourceIndex => ({
      pages: [
        { id: file.id, path: "Notes/Page.md", title: "Page", aliases: [] },
        { id: "target", path: "Notes/Target.md", title: "Target", aliases: [] },
      ],
      sourcePages: [
        {
          id: file.id,
          path: "Notes/Page.md",
          title: "Page",
          aliases: [],
          markdown: embeddedFile.content,
        },
        {
          id: "target",
          path: "Notes/Target.md",
          title: "Target",
          aliases: [],
          markdown,
        },
      ],
      links: [],
      backlinks: [],
      unlinkedMentions: [],
    });
    const services: MarkdownTransclusionServices = {
      rebuild: vi
        .fn()
        .mockResolvedValueOnce(indexWithTarget("Before external edit.\n"))
        .mockResolvedValueOnce(indexWithTarget("After external edit.\n")),
    };

    render(<MarkdownBlockRuntime file={embeddedFile} transclusionServices={services} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("wiki-embed")).toHaveTextContent("Before external edit.");

    await act(async () => {
      eventBus.emit("storage:changed");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(services.rebuild).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("wiki-embed")).toHaveTextContent("After external edit.");
    expect(updateFile).not.toHaveBeenCalled();
  });

  it("builds one shared zero-write catalog for a Markdown Collection", async () => {
    const definition =
      '```doxmind-collection\n{"version":1,"view":"table","filters":[{"property":"type","operator":"equals","value":"task"}],"columns":["status"],"sort":[]}\n```\n';
    const collectionFile: FileItem = {
      ...file,
      content: definition,
      storageHandle: {
        mode: "disk",
        kind: "document",
        id: file.id,
        relPath: "Collections/Tasks.md",
        documentType: "markdown",
      },
    };
    const pending = deferred<KnowledgeSourceIndex>();
    const services: MarkdownTransclusionServices = { rebuild: vi.fn(() => pending.promise) };

    render(<MarkdownBlockRuntime file={collectionFile} transclusionServices={services} />);
    expect(screen.getByTestId("collection-block")).toHaveAttribute(
      "data-native-print-ready",
      "false"
    );

    await act(async () => {
      pending.resolve({
        pages: [],
        sourcePages: [],
        catalogPages: [
          {
            id: "task-1",
            path: "Tasks/One.md",
            title: "One task",
            aliases: [],
            properties: { type: "task", status: "doing" },
            markdown: "Task body\n",
            revision: "sha256:task",
          },
        ],
        links: [],
        backlinks: [],
        unlinkedMentions: [],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(services.rebuild).toHaveBeenCalledOnce();
    expect(screen.getByRole("table", { name: "Page collection table" })).toHaveTextContent(
      "One taskdoing"
    );
    expect(screen.getByTestId("collection-block")).toHaveAttribute(
      "data-native-print-ready",
      "true"
    );
    expect(updateFile).not.toHaveBeenCalled();
  });

  it("opens a Collection target from the workspace index in standalone-file mode", async () => {
    const definition =
      '```doxmind-collection\n{"version":1,"view":"table","filters":[],"columns":[],"sort":[]}\n```\n';
    const collectionFile: FileItem = {
      ...file,
      content: definition,
      storageHandle: {
        mode: "disk",
        kind: "document",
        id: file.id,
        relPath: "Collections/Tasks.md",
        documentType: "markdown",
      },
    };
    const openFile = vi.fn().mockResolvedValue(undefined);
    useFileStore.setState({
      files: [collectionFile],
      currentFileId: collectionFile.id,
      rootPath: "/workspace",
      openFile,
    });
    const services: MarkdownTransclusionServices = {
      rebuild: vi.fn(async () => ({
        pages: [{ id: "task-1", path: "Tasks/One.md", title: "One task", aliases: [] }],
        sourcePages: [
          {
            id: "task-1",
            path: "Tasks/One.md",
            title: "One task",
            aliases: [],
            markdown: "# One task\n",
          },
        ],
        catalogPages: [
          {
            id: "task-1",
            path: "Tasks/One.md",
            title: "One task",
            aliases: [],
            properties: {},
            markdown: "# One task\n",
            revision: "sha256:task",
          },
        ],
        links: [],
        backlinks: [],
        unlinkedMentions: [],
      })),
    };

    render(<MarkdownBlockRuntime file={collectionFile} transclusionServices={services} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: "One task" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(openFile).toHaveBeenCalledWith("/workspace/Tasks/One.md");
  });

  it("resolves and reads a local Markdown image without writing Page state", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:runtime-image"),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    useFileStore.setState({ rootPath: "/vault" });
    const imageServices: MarkdownImageServices = {
      import: vi.fn(),
      read: vi.fn(async () => ({
        path: "assets/pixel.png",
        mime: "image/png",
        base64: "iVBORw0KGgoAAAAA",
      })),
    };
    const imageFile: FileItem = {
      ...file,
      content: "![Pixel](../assets/pixel.png)\n",
      storageHandle: {
        mode: "disk",
        kind: "document",
        id: file.id,
        relPath: "Notes/Page.md",
        documentType: "markdown",
      },
    };

    render(<MarkdownBlockRuntime file={imageFile} imageServices={imageServices} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const image = screen.getByRole("img", { name: "Pixel" });

    expect(imageServices.read).toHaveBeenCalledWith("/vault", "assets/pixel.png");
    expect(image).toHaveAttribute("src", "blob:runtime-image");
    expect(updateFile).not.toHaveBeenCalled();
  });

  it("promotes the visible Block on keyboard edit intent and replays printable text", () => {
    render(<MarkdownBlockRuntime file={file} />);

    expect(screen.queryByLabelText("Markdown block")).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "x" });

    const textarea = screen.getByLabelText("Markdown block");
    expect(textarea).toHaveValue("Hellox");
    expect(textarea).toHaveFocus();
    expect(useEditorStore.getState().isDirty).toBe(true);
  });

  it("replays keyboard input before an authored whitespace-only separator", async () => {
    render(
      <MarkdownBlockRuntime
        file={{
          ...file,
          content: "Alpha\n\t \nBeta\n",
        }}
      />
    );

    fireEvent.keyDown(window, { key: "x" });

    expect(screen.getByLabelText("Markdown block")).toHaveValue("Alphax");
    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenCalledWith(
      "page-1",
      expect.objectContaining({ content: "Alphax\n\t \nBeta\n" })
    );
  });

  it("replays keyboard input inside a fenced Block's payload, not past its closing fence", async () => {
    render(
      <MarkdownBlockRuntime
        file={{
          ...file,
          content: "```js\nconst a = 1;\n```\n\nAfter.\n",
        }}
      />
    );

    fireEvent.keyDown(window, { key: "x" });

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenCalledWith(
      "page-1",
      expect.objectContaining({ content: "```js\nconst a = 1;x\n```\n\nAfter.\n" })
    );
  });

  it("leaves Mod+A/C/X/V to the native clipboard and selection commands", () => {
    render(<MarkdownBlockRuntime file={file} />);

    for (const modifier of ["metaKey", "ctrlKey"] as const) {
      for (const key of ["a", "c", "x", "v"]) {
        const event = new KeyboardEvent("keydown", {
          key,
          [modifier]: true,
          bubbles: true,
          cancelable: true,
        });
        window.dispatchEvent(event);
        expect(event.defaultPrevented, `${modifier}+${key}`).toBe(false);
      }
    }

    expect(screen.queryByLabelText("Markdown block")).not.toBeInTheDocument();
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it("patches a soft-wrapped CRLF paragraph without normalizing untouched line endings", async () => {
    render(
      <MarkdownBlockRuntime
        file={{
          ...file,
          content: "First\r\nsecond\r\n\r\nKeep\r\n",
        }}
      />
    );

    fireEvent.click(screen.getByText(/First/));
    fireEvent.change(screen.getByLabelText("Markdown block"), {
      target: { value: "First!\nsecond" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(updateFile).toHaveBeenCalledWith(
      "page-1",
      expect.objectContaining({
        content: "First!\r\nsecond\r\n\r\nKeep\r\n",
      })
    );
  });

  it("maps textarea offsets back to CRLF source before splitting", async () => {
    render(
      <MarkdownBlockRuntime
        file={{
          ...file,
          content: "First\r\nsecond\r\n\r\nKeep\r\n",
        }}
      />
    );

    fireEvent.click(screen.getByText(/First/));
    const textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    textarea.setSelectionRange(6, 6);
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByLabelText("Markdown block")).toHaveValue("second");
    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenCalledWith(
      "page-1",
      expect.objectContaining({
        content: "First\r\n\r\nsecond\r\n\r\nKeep\r\n",
      })
    );
  });

  it("preserves an authored whitespace-only separator when Enter splits a Block", async () => {
    render(
      <MarkdownBlockRuntime
        file={{
          ...file,
          content: "First\r\nsecond\r\n \t\r\nKeep\r\n",
        }}
      />
    );

    fireEvent.click(screen.getByText(/First/));
    const textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    textarea.setSelectionRange(6, 6);
    fireEvent.keyDown(textarea, { key: "Enter" });
    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });

    expect(updateFile).toHaveBeenCalledWith(
      "page-1",
      expect.objectContaining({
        content: "First\r\n\r\nsecond\r\n \t\r\nKeep\r\n",
      })
    );
  });

  it("uses a CRLF block separator for a newline inserted through the textarea", async () => {
    render(<MarkdownBlockRuntime file={{ ...file, content: "First\r\n" }} />);

    fireEvent.click(screen.getByText("First"));
    fireEvent.change(screen.getByLabelText("Markdown block"), {
      target: { value: "First\nsecond" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(updateFile).toHaveBeenCalledWith(
      "page-1",
      expect.objectContaining({ content: "First\r\nsecond\r\n" })
    );
  });

  it("edits a fenced code source block without treating Enter as a block split", async () => {
    const markdown = "```ts\nconst first = 1;\n\nconst second = 2;\n```\n";
    render(<MarkdownBlockRuntime file={{ ...file, content: markdown }} />);

    fireEvent.click(screen.getByTestId("fenced-code-block"));
    // The editor shows the payload only — the ``` delimiter lines are projected out, the way both
    // Notion and Feishu present a code Block — so the typed value carries no fences.
    const textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    expect(textarea.value).toBe("const first = 1;\n\nconst second = 2;");
    textarea.setSelectionRange(16, 16);

    expect(fireEvent.keyDown(textarea, { key: "Enter" })).toBe(true);
    fireEvent.change(textarea, {
      target: { value: "const first = 1;\n// inserted\n\nconst second = 2;" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(updateFile).toHaveBeenCalledWith(
      "page-1",
      expect.objectContaining({
        content: "```ts\nconst first = 1;\n// inserted\n\nconst second = 2;\n```\n",
      })
    );
  });

  it("renders common inline Markdown semantically without making HTML authoritative", () => {
    render(
      <MarkdownBlockRuntime
        file={{
          ...file,
          content:
            "Read **bold**, *emphasis*, `code`, [a link](https://example.com), and ~~old~~.\n",
        }}
      />
    );

    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("emphasis").tagName).toBe("EM");
    expect(screen.getByText("code").tagName).toBe("CODE");
    expect(screen.getByText("a link")).toHaveAttribute("title", "https://example.com");
    expect(screen.getByText("old").tagName).toBe("DEL");
  });

  it("keeps only one inactive Block in the document tab order", () => {
    render(<MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n\nThird\n" }} />);

    const rows = screen.getAllByRole("group", { name: /block \d of 3/ });
    expect(rows.map((row) => row.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
  });

  it("renders list items semantically and persists task checkbox changes in Markdown", async () => {
    render(
      <MarkdownBlockRuntime file={{ ...file, content: "- bullet\n- [ ] todo\n1. ordered\n" }} />
    );

    expect(screen.getByText("bullet")).toBeInTheDocument();
    expect(screen.getByText("ordered")).toBeInTheDocument();
    const task = screen.getByRole("checkbox", { name: "todo" });
    expect(task).not.toBeChecked();

    fireEvent.click(task);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(updateFile).toHaveBeenCalledWith(
      "page-1",
      expect.objectContaining({ content: "- bullet\n- [x] todo\n1. ordered\n" })
    );
  });

  it("indents and outdents a list Block with Tab without exposing its Markdown marker", async () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "- Parent\r\n- Child\r\n" }} />
    );
    fireEvent.click(screen.getByText("Child"));
    let textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    textarea.setSelectionRange(2, 2);

    expect(fireEvent.keyDown(textarea, { key: "Tab" })).toBe(false);
    expect(screen.getByLabelText("Markdown block")).toHaveValue("Child");
    expect(container.querySelector('[data-block-id="block-2"]')).toHaveAttribute(
      "data-block-depth",
      "1"
    );
    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: "- Parent\r\n  - Child\r\n" })
    );

    textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    expect(textarea.selectionStart).toBe(2);
    expect(fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true })).toBe(false);
    expect(container.querySelector('[data-block-id="block-2"]')).toHaveAttribute(
      "data-block-depth",
      "0"
    );
  });

  it("outdents a nested list Block on Backspace at its payload boundary", async () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "- Parent\r\n  - Child\r\n" }} />
    );
    fireEvent.click(screen.getByText("Child"));
    const textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 0);

    expect(fireEvent.keyDown(textarea, { key: "Backspace" })).toBe(false);
    expect(screen.getByLabelText("Markdown block")).toHaveValue("Child");
    expect(container.querySelector('[data-block-id="block-2"]')).toHaveAttribute(
      "data-block-depth",
      "0"
    );
    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: "- Parent\r\n- Child\r\n" })
    );
  });

  it("outdents an empty nested list Block on Enter before exiting the list", async () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "- Parent\r\n  - \r\n" }} />
    );
    let rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    fireEvent.keyDown(rows[1], { key: "Enter" });
    const textarea = screen.getByLabelText("Markdown block");

    expect(fireEvent.keyDown(textarea, { key: "Enter" })).toBe(false);
    rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect(rows[1]).toHaveAttribute("data-block-kind", "bullet_list_item");
    expect(rows[1]).toHaveAttribute("data-block-depth", "0");
    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: "- Parent\r\n- \r\n" })
    );
  });

  it("indents a selected list range atomically and keeps a parentless Tab source-safe", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "- Parent\r\n- Child\r\n- Third\r\n" }} />
    );
    fireEvent.click(screen.getByText("Child"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    let rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    fireEvent.keyDown(rows[1], { key: "ArrowDown", shiftKey: true });
    rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");

    expect(fireEvent.keyDown(rows[2], { key: "Tab" })).toBe(false);
    rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect(rows[1]).toHaveAttribute("data-block-depth", "1");
    expect(rows[2]).toHaveAttribute("data-block-depth", "1");
    expect(container.querySelector("[data-native-markdown-document]")).toHaveAttribute(
      "data-revision",
      "1"
    );

    fireEvent.keyDown(rows[1], { key: "Escape" });
    fireEvent.keyDown(rows[0], { key: "Enter" });
    const first = screen.getByLabelText("Markdown block");
    expect(fireEvent.keyDown(first, { key: "Tab" })).toBe(false);
    expect(container.querySelector("[data-native-markdown-document]")).toHaveAttribute(
      "data-revision",
      "1"
    );
  });

  it("continues a list item on Enter without pulling the caret back during the next edit", async () => {
    render(<MarkdownBlockRuntime file={{ ...file, content: "- one two\n- keep\n" }} />);

    fireEvent.click(screen.getByText("one two"));
    const first = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    first.setSelectionRange(4, 4);
    fireEvent.keyDown(first, { key: "Enter" });

    const second = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    expect(second).toHaveValue("two");
    expect(second.selectionStart).toBe(0);
    fireEvent.change(second, { target: { value: "typed" } });
    expect(second.selectionStart).toBe(5);

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenCalledWith(
      "page-1",
      expect.objectContaining({ content: "- one \n- typed\n- keep\n" })
    );
  });

  it("unwraps the first list item when Backspace is pressed at its payload boundary", async () => {
    render(<MarkdownBlockRuntime file={{ ...file, content: "Before\n\n- item\n- next\n" }} />);

    fireEvent.click(screen.getByText("item"));
    const textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: "Backspace" });

    expect(screen.getByLabelText("Markdown block")).toHaveValue("item");
    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenCalledWith(
      "page-1",
      expect.objectContaining({ content: "Before\n\nitem\n\n- next\n" })
    );
  });

  it("renders a source-backed blockquote with semantic quote markup", () => {
    render(<MarkdownBlockRuntime file={{ ...file, content: "> quoted text\n" }} />);

    expect(screen.getByText("quoted text").tagName).toBe("BLOCKQUOTE");
  });

  it("finds source text without moving focus away from Search", () => {
    render(
      <MarkdownBlockRuntime
        file={{
          ...file,
          content: "First **Needle**\r\n\r\nSecond needle\r\n",
        }}
      />
    );

    act(() => useLayoutStore.getState().setSearchBarOpen(true));
    const searchInput = screen.getByLabelText("Search text");
    fireEvent.change(searchInput, {
      target: { value: "needle" },
    });

    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(searchInput).toHaveFocus();
    expect(screen.getByLabelText("Markdown block")).toHaveAttribute("data-native-semantic-editor");
    expect(document.querySelector("[data-native-search-selection]")).toHaveTextContent("Needle");

    fireEvent.change(searchInput, { target: { value: "missing" } });
    expect(screen.getByText("No matches")).toBeInTheDocument();
    expect(document.querySelector("[data-native-search-selection]")).not.toBeInTheDocument();
    expect(searchInput).toHaveFocus();

    fireEvent.change(searchInput, { target: { value: "needle" } });
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(document.querySelector("[data-native-search-selection]")).toHaveTextContent("Needle");

    fireEvent.click(screen.getByRole("button", { name: "Next result" }));
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
    expect(searchInput).toHaveFocus();
    // "Second needle" carries no inline syntax, so this Block would otherwise render the raw
    // textarea — where the match exists only as a selection Chromium does not paint while the
    // find bar holds focus. The current match renders the semantic surface for exactly that
    // reason, so the hit the counter is pointing at is one the reader can see.
    expect(screen.getByLabelText("Markdown block")).toHaveAttribute("data-native-semantic-editor");
    expect(document.querySelector("[data-native-search-selection]")).toHaveTextContent("needle");

    fireEvent.click(screen.getByRole("button", { name: "Previous result" }));
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(searchInput).toHaveFocus();
    expect(screen.getByLabelText("Markdown block")).toHaveAttribute("data-native-semantic-editor");
    expect(document.querySelector("[data-native-search-selection]")).toHaveTextContent("Needle");
  });

  it("closes Search and focuses a Block activated explicitly", () => {
    render(
      <MarkdownBlockRuntime
        file={{ ...file, content: "First **needle**\r\n\r\nOther block\r\n" }}
      />
    );

    act(() => useLayoutStore.getState().setSearchBarOpen(true));
    const searchInput = screen.getByLabelText("Search text");
    fireEvent.change(searchInput, { target: { value: "needle" } });
    expect(searchInput).toHaveFocus();

    fireEvent.click(screen.getByText("Other block"));

    expect(screen.queryByRole("search", { name: "Find in Page" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Markdown block")).toHaveValue("Other block");
    expect(screen.getByLabelText("Markdown block")).toHaveFocus();
  });

  it("restores an editing selection after opening and closing empty Search", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "## Hello world\r\n" }} />
    );

    fireEvent.click(screen.getByRole("heading", { name: "Hello world" }));
    const textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 5);
    fireEvent.select(textarea);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));

    act(() => useLayoutStore.getState().setSearchBarOpen(true));
    expect(screen.getByLabelText("Search text")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));

    expect(screen.getByLabelText("Markdown block")).toHaveFocus();
    expect(container.querySelector("[data-native-semantic-editor] strong")).toHaveTextContent(
      "Hello"
    );
    expect(window.getSelection()?.toString()).toBe("Hello");
  });

  it("maps a search match after CRLF to normalized textarea offsets", () => {
    render(
      <MarkdownBlockRuntime
        file={{ ...file, content: "first line\r\nneedle here\r\n\r\nKeep\r\n" }}
      />
    );

    act(() => useLayoutStore.getState().setSearchBarOpen(true));
    fireEvent.change(screen.getByLabelText("Search text"), {
      target: { value: "needle" },
    });

    const textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    expect(textarea).toHaveValue("first line\nneedle here");
    expect(textarea.selectionStart).toBe(11);
    expect(textarea.selectionEnd).toBe(17);
  });

  it("does not create an invalid match across Blocks and closes search on Escape", () => {
    render(<MarkdownBlockRuntime file={{ ...file, content: "end\r\n\r\nstart\r\n" }} />);

    act(() => useLayoutStore.getState().setSearchBarOpen(true));
    const search = screen.getByLabelText("Search text");
    fireEvent.change(search, { target: { value: "end\n\nstart" } });

    expect(screen.getByText("No matches")).toBeInTheDocument();
    expect(screen.queryByLabelText("Markdown block")).not.toBeInTheDocument();

    fireEvent.keyDown(search, { key: "Escape" });
    expect(useLayoutStore.getState().isSearchBarOpen).toBe(false);
    expect(screen.queryByRole("search", { name: "Find in Page" })).not.toBeInTheDocument();
  });

  it("publishes a native Page outline with at least two level 1-3 ATX headings", () => {
    render(
      <MarkdownBlockRuntime
        file={{
          ...file,
          content: "# Project\n\n#### Hidden detail\n\n### Next steps\n",
        }}
      />
    );

    expect(usePageSessionStore.getState().outlineSession).toMatchObject({
      pageId: "page-1",
      activeId: null,
      headings: [
        { id: "block-1", level: 1, text: "Project" },
        { id: "block-3", level: 3, text: "Next steps" },
      ],
    });
  });

  it("navigates a native outline entry by block id and activates that block", () => {
    render(<MarkdownBlockRuntime file={{ ...file, content: "# Project\n\n## Next steps\n" }} />);
    const session = usePageSessionStore.getState().outlineSession;
    const target = document.querySelector<HTMLElement>('[data-block-id="block-2"]');
    const scrollIntoView = vi.fn();
    expect(session).not.toBeNull();
    expect(target).not.toBeNull();
    if (!session || !target) return;
    target.scrollIntoView = scrollIntoView;

    act(() => session.navigateTo(session.headings[1]));

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(screen.getByLabelText("Markdown block")).toHaveValue("Next steps");
    expect(usePageSessionStore.getState().outlineSession?.activeId).toBe("block-2");
  });

  it("replaces and clears the native outline session on Page switch and unmount", () => {
    const { rerender, unmount } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "# Project\n\n## Next steps\n" }} />
    );
    expect(usePageSessionStore.getState().outlineSession?.headings).toHaveLength(2);

    rerender(
      <MarkdownBlockRuntime
        file={{
          ...file,
          id: "page-2",
          name: "Other Page",
          content: "# Only heading\n",
        }}
      />
    );

    expect(usePageSessionStore.getState().outlineSession).toMatchObject({
      pageId: "page-2",
      headings: [],
    });
    unmount();
    expect(usePageSessionStore.getState().outlineSession).toBeNull();
  });

  it("stays dirty when the Markdown write fails", async () => {
    updateFile.mockRejectedValueOnce(new Error("disk full"));
    render(<MarkdownBlockRuntime file={file} />);

    fireEvent.click(screen.getByText("Hello"));
    fireEvent.change(screen.getByLabelText("Markdown block"), {
      target: { value: "Unsaved" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(useEditorStore.getState().isDirty).toBe(true);
    expect(useEditorStore.getState().isSaving).toBe(false);
    expect(useEditorStore.getState().lastSavedAt).toBeNull();
  });

  it("reloads a clean Page when the same file changes externally", async () => {
    const { rerender } = render(<MarkdownBlockRuntime file={file} />);

    rerender(<MarkdownBlockRuntime file={{ ...file, content: "External\n" }} />);

    expect(screen.getByText("External")).toBeInTheDocument();
    expect(useEditorStore.getState().isDirty).toBe(false);
    expect(updateFile).not.toHaveBeenCalled();
  });

  it("reloads a clean external raw Block without leaving the native Adapter", () => {
    const { rerender } = render(<MarkdownBlockRuntime file={file} />);

    rerender(<MarkdownBlockRuntime file={{ ...file, content: "[reference]: /target\n" }} />);

    fireEvent.click(screen.getByText("[reference]: /target"));
    expect(screen.getByLabelText("Markdown block")).toHaveValue("[reference]: /target");
    expect(updateFile).not.toHaveBeenCalled();
  });

  it("blocks autosave when an external edit arrives over local changes", async () => {
    const { rerender } = render(<MarkdownBlockRuntime file={file} />);
    fireEvent.click(screen.getByText("Hello"));
    fireEvent.change(screen.getByLabelText("Markdown block"), {
      target: { value: "Local draft" },
    });

    rerender(<MarkdownBlockRuntime file={{ ...file, content: "External\n" }} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/changed outside doxmind/i);
    expect(screen.getByLabelText("Markdown block")).toHaveValue("Local draft");
    expect(updateFile).not.toHaveBeenCalled();
    expect(useEditorStore.getState().isDirty).toBe(true);
  });

  it("says a blocked save is blocking the close, and takes the local version when asked", async () => {
    const { rerender } = render(<MarkdownBlockRuntime file={file} />);
    fireEvent.click(screen.getByText("Hello"));
    fireEvent.change(screen.getByLabelText("Markdown block"), {
      target: { value: "Local draft" },
    });

    rerender(<MarkdownBlockRuntime file={{ ...file, content: "External\n" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/saving is paused/i);

    // Cmd+S and the shell's flush-before-close both come through `requestSave`. Refusing the write
    // is right — it would pick a winner behind the user's back — but the refusal used to be silent,
    // so the keystroke did nothing and the window simply would not close.
    let refused: boolean | undefined;
    await act(async () => {
      refused = await useEditorRefStore.getState().requestSave?.();
    });
    expect(refused).toBe(false);
    expect(updateFile).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/closing the window/i);

    // The exit that keeps what was typed. Before it existed the banner offered one resolution, and
    // it was the one that threw the local draft away.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Keep my version" }));
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(updateFile).toHaveBeenCalledWith("page-1", { content: "Local draft\n" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Markdown block")).toHaveValue("Local draft");
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it("serializes saves so an older write cannot finish after a newer write", async () => {
    const firstWrite = deferred<void>();
    updateFile.mockImplementationOnce(() => firstWrite.promise).mockResolvedValue(undefined);
    render(<MarkdownBlockRuntime file={file} />);

    fireEvent.click(screen.getByText("Hello"));
    const textarea = screen.getByLabelText("Markdown block");
    fireEvent.change(textarea, { target: { value: "First" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    fireEvent.change(textarea, { target: { value: "Second" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(updateFile).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstWrite.resolve();
      await Promise.resolve();
    });
    expect(updateFile).toHaveBeenCalledTimes(2);
    expect(updateFile.mock.calls[1]?.[1]).toMatchObject({ content: "Second\n" });
  });

  it("does not report a newer draft saved when a duplicate queued save becomes a no-op", async () => {
    const firstWrite = deferred<void>();
    updateFile.mockImplementationOnce(() => firstWrite.promise).mockResolvedValue(undefined);
    render(<MarkdownBlockRuntime file={file} />);
    fireEvent.click(screen.getByText("Hello"));
    const textarea = screen.getByLabelText("Markdown block");
    fireEvent.change(textarea, { target: { value: "Saved version" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    const duplicateSave = useEditorRefStore.getState().requestSave?.();
    fireEvent.change(textarea, { target: { value: "Newer draft" } });
    expect(useEditorStore.getState().isDirty).toBe(true);

    await act(async () => {
      firstWrite.resolve();
      await duplicateSave;
    });

    expect(screen.getByLabelText("Markdown block")).toHaveValue("Newer draft");
    expect(useEditorStore.getState().isDirty).toBe(true);
  });

  it("invalidates queued writes when an external conflict arrives", async () => {
    const firstWrite = deferred<void>();
    updateFile.mockImplementationOnce(() => firstWrite.promise).mockResolvedValue(undefined);
    const { rerender } = render(<MarkdownBlockRuntime file={file} />);
    fireEvent.click(screen.getByText("Hello"));
    const textarea = screen.getByLabelText("Markdown block");
    fireEvent.change(textarea, { target: { value: "First" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    fireEvent.change(textarea, { target: { value: "Queued" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    rerender(<MarkdownBlockRuntime file={{ ...file, content: "External\n" }} />);
    await act(async () => {
      firstWrite.resolve();
      await Promise.resolve();
    });

    expect(updateFile).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(useEditorStore.getState().isDirty).toBe(true);
  });

  it("does not let a previous Page save clear the new Page dirty state", async () => {
    const oldWrite = deferred<void>();
    updateFile.mockImplementationOnce(() => oldWrite.promise).mockResolvedValue(undefined);
    const { rerender } = render(<MarkdownBlockRuntime file={file} />);

    fireEvent.click(screen.getByText("Hello"));
    fireEvent.change(screen.getByLabelText("Markdown block"), {
      target: { value: "Old Page edit" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    const nextFile = {
      ...file,
      id: "page-2",
      name: "Next Page",
      content: "Next\n",
    };
    rerender(<MarkdownBlockRuntime file={nextFile} />);
    fireEvent.click(screen.getByText("Next"));
    fireEvent.change(screen.getByLabelText("Markdown block"), {
      target: { value: "New Page draft" },
    });
    expect(useEditorStore.getState().isDirty).toBe(true);

    await act(async () => {
      oldWrite.resolve();
      await Promise.resolve();
    });

    expect(screen.getByLabelText("Markdown block")).toHaveValue("New Page draft");
    expect(useEditorStore.getState().isDirty).toBe(true);
    expect(useEditorStore.getState().lastSavedAt).toBeNull();
  });

  it("honors disabled autosave and still saves explicitly", async () => {
    useLayoutStore.setState({ autosaveEnabled: false });
    render(<MarkdownBlockRuntime file={file} />);
    fireEvent.click(screen.getByText("Hello"));
    fireEvent.change(screen.getByLabelText("Markdown block"), {
      target: { value: "Manual save" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(updateFile).not.toHaveBeenCalled();
    expect(useEditorStore.getState().isDirty).toBe(true);

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenCalledWith(
      "page-1",
      expect.objectContaining({ content: "Manual save\n" })
    );
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it("cancels a pending autosave before a confirmed discard unmounts the Page", async () => {
    const { unmount } = render(<MarkdownBlockRuntime file={file} />);
    fireEvent.click(screen.getByText("Hello"));
    fireEvent.change(screen.getByLabelText("Markdown block"), {
      target: { value: "Discard me" },
    });

    useEditorRefStore.getState().discardPendingChanges?.();
    expect(useEditorStore.getState().isDirty).toBe(false);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(updateFile).not.toHaveBeenCalled();
  });

  it("invalidates an autosave already queued behind an active write when discarding", async () => {
    const firstWrite = deferred<void>();
    updateFile.mockImplementationOnce(() => firstWrite.promise).mockResolvedValue(undefined);
    const { unmount } = render(<MarkdownBlockRuntime file={file} />);
    fireEvent.click(screen.getByText("Hello"));
    const textarea = screen.getByLabelText("Markdown block");

    fireEvent.change(textarea, { target: { value: "First write" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    fireEvent.change(textarea, { target: { value: "Queued discard" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(updateFile).toHaveBeenCalledTimes(1);

    useEditorRefStore.getState().discardPendingChanges?.();
    unmount();
    await act(async () => {
      firstWrite.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateFile).toHaveBeenCalledTimes(1);
  });

  it("replaces the selected text on Enter and focuses the new block", () => {
    render(<MarkdownBlockRuntime file={file} />);
    fireEvent.click(screen.getByText("Hello"));
    const first = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    first.setSelectionRange(1, 4);

    fireEvent.keyDown(first, { key: "Enter" });

    expect(screen.getByText("H")).toBeInTheDocument();
    const second = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    expect(second).toHaveValue("o");
    expect(second).toHaveFocus();
    expect(second.selectionStart).toBe(0);
    expect(second.selectionEnd).toBe(0);
  });

  it("applies the returned final selection after a paste creates multiple Blocks", async () => {
    render(<MarkdownBlockRuntime file={file} />);
    fireEvent.click(screen.getByText("Hello"));
    const first = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    first.setSelectionRange(5, 5);

    expect(
      fireEvent.paste(first, {
        clipboardData: {
          getData: (type: string) => (type === "text/plain" ? "\n\nSecond" : ""),
        },
      })
    ).toBe(false);

    const second = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    expect(second).toHaveValue("Second");
    expect(second).toHaveFocus();
    expect(second.selectionStart).toBe(6);
    expect(second.selectionEnd).toBe(6);

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenCalledWith(
      "page-1",
      expect.objectContaining({ content: "Hello\n\nSecond\n" })
    );
  });

  it.each(["paste", "drop"] as const)(
    "imports a local raster on %s and inserts a portable relative Markdown image Block",
    async (gesture) => {
      const importAsset = vi.fn(async () => ({ path: "assets/diagram.png", mime: "image/png" }));
      const imageServices: MarkdownImageServices = {
        read: vi.fn(async () => ({
          path: "assets/diagram.png",
          mime: "image/png",
          base64: "iVBORw0KGgo=",
        })),
        import: importAsset,
      };
      const page = {
        ...file,
        name: "Page.md",
        storageHandle: {
          mode: "disk" as const,
          id: file.id,
          kind: "document" as const,
          documentType: "markdown" as const,
          path: "Notes/Page.md",
          relPath: "Notes/Page.md",
        },
      };
      useFileStore.setState({ rootPath: "/workspace" });
      render(<MarkdownBlockRuntime file={page} imageServices={imageServices} />);
      const raster = {
        name: "diagram.png",
        type: "image/png",
        size: 8,
        arrayBuffer: vi.fn(async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer),
      } as unknown as File;

      if (gesture === "paste") {
        fireEvent.click(screen.getByText("Hello"));
        const textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
        textarea.setSelectionRange(5, 5);
        expect(
          fireEvent.paste(textarea, {
            clipboardData: { files: [raster], getData: () => "" },
          })
        ).toBe(false);
      } else {
        const row = screen.getByRole("group", { name: "Text, block 1 of 1" });
        expect(
          fireEvent.drop(row, {
            dataTransfer: {
              files: [raster],
              items: [{ kind: "file", type: "image/png" }],
              types: ["Files"],
              getData: () => "",
            },
          })
        ).toBe(false);
      }

      await act(async () => {
        await vi.waitFor(() => expect(importAsset).toHaveBeenCalledOnce());
      });
      expect(importAsset).toHaveBeenCalledWith("/workspace", {
        name: "diagram.png",
        bytes: expect.any(Uint8Array),
      });
      await act(async () => {
        await useEditorRefStore.getState().requestSave?.();
      });
      expect(updateFile).toHaveBeenCalledWith(
        "page-1",
        expect.objectContaining({ content: "Hello\n\n![diagram](../assets/diagram.png)\n" })
      );
    }
  );

  it("pastes mixed line endings as exact CRLF Blocks and keeps one undo checkpoint", async () => {
    const original = "Alpha tail\r\n\r\nKeep\r\n";
    render(<MarkdownBlockRuntime file={{ ...file, content: original }} />);
    fireEvent.click(screen.getByText("Alpha tail"));
    let textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    textarea.setSelectionRange(6, 10);

    expect(
      fireEvent.paste(textarea, {
        clipboardData: {
          getData: (type: string) => (type === "text/plain" ? "One\r\n\r\nTwo\n\nThree" : ""),
        },
      })
    ).toBe(false);

    textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    expect(textarea).toHaveValue("Three");
    expect(textarea).toHaveFocus();
    expect(textarea.selectionStart).toBe(5);
    expect(textarea.selectionEnd).toBe(5);
    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith("page-1", {
      content: "Alpha One\r\n\r\nTwo\r\n\r\nThree\r\n\r\nKeep\r\n",
    });

    fireEvent.keyDown(textarea, { key: "z", metaKey: true });
    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith("page-1", { content: original });
  });

  it("moves the caret across Block boundaries without wrapping past the Page edges", () => {
    render(<MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n\nThird\n" }} />);

    fireEvent.click(screen.getByText("First"));
    let textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    expect(fireEvent.keyDown(textarea, { key: "ArrowDown" })).toBe(false);

    textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    expect(textarea).toHaveValue("Second");
    expect(textarea).toHaveFocus();
    expect(textarea.selectionStart).toBe(0);

    expect(fireEvent.keyDown(textarea, { key: "ArrowUp" })).toBe(false);
    textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    expect(textarea).toHaveValue("First");
    expect(textarea.selectionStart).toBe(textarea.value.length);

    textarea.setSelectionRange(0, 0);
    expect(fireEvent.keyDown(textarea, { key: "ArrowUp" })).toBe(true);
    expect(screen.getByLabelText("Markdown block")).toHaveValue("First");

    fireEvent.click(screen.getByText("Third"));
    textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    expect(fireEvent.keyDown(textarea, { key: "ArrowDown" })).toBe(true);
    expect(screen.getByLabelText("Markdown block")).toHaveValue("Third");
  });

  it("uses Escape to leave text editing and select the current Block without changing source", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n" }} />
    );

    fireEvent.click(screen.getByText("First"));
    const textarea = screen.getByLabelText("Markdown block");
    expect(fireEvent.keyDown(textarea, { key: "Escape" })).toBe(false);

    expect(screen.queryByLabelText("Markdown block")).not.toBeInTheDocument();
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect(rows[0]).toHaveAttribute("data-block-selected", "true");
    expect(rows[0]).toHaveFocus();
    expect(rows[1]).not.toHaveAttribute("data-block-selected", "true");
    expect(container.querySelector("[data-native-markdown-document]")).toHaveAttribute(
      "data-revision",
      "0"
    );
  });

  it("extends a contiguous Block selection with Shift+Arrow and returns to text with Enter", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n\nThird\n" }} />
    );

    fireEvent.click(screen.getByText("First"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    let rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    fireEvent.keyDown(rows[0], { key: "ArrowDown", shiftKey: true });

    rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect(rows[0]).toHaveAttribute("data-block-selected", "true");
    expect(rows[1]).toHaveAttribute("data-block-selected", "true");
    expect(rows[1]).toHaveFocus();
    expect(rows[2]).not.toHaveAttribute("data-block-selected", "true");

    expect(fireEvent.keyDown(rows[1], { key: "Enter" })).toBe(false);
    expect(screen.getByLabelText("Markdown block")).toHaveValue("Second");
    expect(screen.getByLabelText("Markdown block")).toHaveFocus();
    expect(
      container.querySelector("[data-native-block-row][data-block-selected='true']")
    ).not.toBeInTheDocument();
  });

  it("promotes a full text selection to one Block and then selects the document", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n\nThird\n" }} />
    );
    fireEvent.click(screen.getByText("Second"));
    const editor = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    editor.setSelectionRange(0, editor.value.length);

    expect(fireEvent.keyDown(editor, { key: "a", metaKey: true })).toBe(false);
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(1);

    const selectedRow = container.querySelector<HTMLElement>('[data-block-selected="true"]')!;
    expect(fireEvent.keyDown(selectedRow, { key: "a", metaKey: true })).toBe(false);
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(3);
  });

  it("extends a contiguous Block selection with Shift+click", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n\nThird\n" }} />
    );

    fireEvent.click(screen.getByText("First"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    fireEvent.click(screen.getByText("Third"), { shiftKey: true });

    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(3);
    expect(container.querySelector('[data-block-id="block-1"]')).toHaveAttribute(
      "data-block-selected",
      "true"
    );
    expect(container.querySelector('[data-block-id="block-3"]')).toHaveAttribute(
      "data-block-selected",
      "true"
    );
  });

  it("deletes a multi-Block selection atomically and keeps the next Block selected", async () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n\nThird\n" }} />
    );

    fireEvent.click(screen.getByText("First"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    let rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    fireEvent.keyDown(rows[0], { key: "ArrowDown", shiftKey: true });
    rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect(fireEvent.keyDown(rows[1], { key: "Backspace" })).toBe(false);

    rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("data-block-selected", "true");
    expect(rows[0]).toHaveTextContent("Third");
    expect(screen.queryByLabelText("Markdown block")).not.toBeInTheDocument();

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: "Third\n" })
    );
  });

  it("duplicates a multi-Block selection as one selected group", async () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n\nThird\n" }} />
    );

    fireEvent.click(screen.getByText("First"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    let rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    fireEvent.keyDown(rows[0], { key: "ArrowDown", shiftKey: true });
    rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect(fireEvent.keyDown(rows[1], { key: "d", metaKey: true })).toBe(false);

    rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect(rows).toHaveLength(5);
    expect([...rows].map((row) => row.textContent)).toEqual([
      expect.stringContaining("First"),
      expect.stringContaining("Second"),
      expect.stringContaining("First"),
      expect.stringContaining("Second"),
      expect.stringContaining("Third"),
    ]);
    expect(rows[2]).toHaveAttribute("data-block-selected", "true");
    expect(rows[3]).toHaveAttribute("data-block-selected", "true");

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: "First\n\nSecond\n\nFirst\n\nSecond\n\nThird\n" })
    );
  });

  it("clears stale Block selection state across undo and redo", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n\nThird\n" }} />
    );
    fireEvent.click(screen.getByText("First"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    let rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    fireEvent.keyDown(rows[0], { key: "ArrowDown", shiftKey: true });
    rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    fireEvent.keyDown(rows[1], { key: "d", metaKey: true });

    act(() => useEditorRefStore.getState().requestUndo?.());
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(0);
    expect(screen.getByLabelText("Markdown block")).toHaveValue("First");

    act(() => useEditorRefStore.getState().requestRedo?.());
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(0);
    expect(screen.getByLabelText("Markdown block")).toHaveValue("First");
  });

  it("moves a selected Block group with Mod+Shift+Arrow as one operation", async () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n\nThird\n" }} />
    );

    fireEvent.click(screen.getByText("First"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    let rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    fireEvent.keyDown(rows[0], { key: "ArrowDown", shiftKey: true });
    rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect(
      fireEvent.keyDown(rows[1], {
        key: "ArrowDown",
        metaKey: true,
        shiftKey: true,
      })
    ).toBe(false);

    rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect([...rows].map((row) => row.textContent)).toEqual([
      expect.stringContaining("Third"),
      expect.stringContaining("First"),
      expect.stringContaining("Second"),
    ]);
    expect(rows[1]).toHaveAttribute("data-block-selected", "true");
    expect(rows[2]).toHaveAttribute("data-block-selected", "true");

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: "Third\n\nFirst\n\nSecond\n\n" })
    );
  });

  it("copies the exact Markdown source for a selected Block range", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\r\n\r\nSecond\r\n\r\nThird\r\n" }} />
    );

    fireEvent.click(screen.getByText("First"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    fireEvent.keyDown(rows[0], { key: "ArrowDown", shiftKey: true });
    const setData = vi.fn();

    expect(
      fireEvent.copy(container.querySelector("[data-native-markdown-document]")!, {
        clipboardData: { setData },
      })
    ).toBe(false);
    expect(setData).toHaveBeenCalledWith("text/plain", "First\r\n\r\nSecond\r\n\r\n");
    expect(container.querySelector("[data-native-markdown-document]")).toHaveAttribute(
      "data-revision",
      "0"
    );
  });

  it("cuts the exact Markdown source for a selected Block range in one revision", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\r\n\r\nSecond\r\n\r\nThird\r\n" }} />
    );
    fireEvent.click(screen.getByText("First"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    fireEvent.keyDown(rows[0], { key: "ArrowDown", shiftKey: true });
    const setData = vi.fn();

    expect(
      fireEvent.cut(container.querySelector("[data-native-markdown-document]")!, {
        clipboardData: { setData },
      })
    ).toBe(false);
    expect(setData).toHaveBeenCalledWith("text/plain", "First\r\n\r\nSecond\r\n\r\n");
    expect(container.querySelectorAll("[data-native-block-row]")).toHaveLength(1);
    expect(screen.getByText("Third")).toBeVisible();
    expect(container.querySelector("[data-native-markdown-document]")).toHaveAttribute(
      "data-revision",
      "1"
    );
  });

  it("copies and pastes an exact Block range atomically, then undoes the replacement", async () => {
    const original = "First\r\n\r\nSecond\r\n\r\nRemove one\r\n\r\nRemove two\r\n";
    const { container } = render(<MarkdownBlockRuntime file={{ ...file, content: original }} />);
    const documentElement = container.querySelector<HTMLElement>(
      "[data-native-markdown-document]"
    )!;

    fireEvent.click(screen.getByText("First"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    let rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    fireEvent.keyDown(rows[0], { key: "ArrowDown", shiftKey: true });
    let copied = "";
    expect(
      fireEvent.copy(documentElement, {
        clipboardData: {
          setData: (_type: string, value: string) => {
            copied = value;
          },
        },
      })
    ).toBe(false);
    expect(copied).toBe("First\r\n\r\nSecond\r\n\r\n");

    rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    fireEvent.keyDown(rows[1], { key: "Escape" });
    fireEvent.click(screen.getByText("Remove one"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    fireEvent.keyDown(rows[2], { key: "ArrowDown", shiftKey: true });

    expect(
      fireEvent.paste(documentElement, {
        clipboardData: { getData: (type: string) => (type === "text/plain" ? copied : "") },
      })
    ).toBe(false);
    expect(documentElement).toHaveAttribute("data-revision", "1");
    expect(screen.getByLabelText("Markdown block")).toHaveValue("Second");
    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith("page-1", {
      content: "First\r\n\r\nSecond\r\n\r\nFirst\r\n\r\nSecond\r\n\r\n",
    });

    act(() => useEditorRefStore.getState().requestUndo?.());
    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith("page-1", { content: original });
  });

  it("keeps an empty clipboard paste over a Block selection as an exact no-op", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n" }} />
    );
    fireEvent.click(screen.getByText("First"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    const documentElement = container.querySelector<HTMLElement>(
      "[data-native-markdown-document]"
    )!;

    expect(
      fireEvent.paste(documentElement, {
        clipboardData: { getData: () => "" },
      })
    ).toBe(true);
    expect(documentElement).toHaveAttribute("data-revision", "0");
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(1);
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it("selects, copies, and cuts a list root with its complete nested subtree", () => {
    const { container } = render(
      <MarkdownBlockRuntime
        file={{
          ...file,
          content: "- Parent\r\n  - Child\r\n    - Grandchild\r\n- Sibling\r\n",
        }}
      />
    );
    fireEvent.click(screen.getByText("Parent"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });

    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(3);
    const documentElement = container.querySelector("[data-native-markdown-document]")!;
    const copySetData = vi.fn();
    expect(fireEvent.copy(documentElement, { clipboardData: { setData: copySetData } })).toBe(
      false
    );
    expect(copySetData).toHaveBeenCalledWith(
      "text/plain",
      "- Parent\r\n  - Child\r\n    - Grandchild\r\n"
    );

    const cutSetData = vi.fn();
    expect(fireEvent.cut(documentElement, { clipboardData: { setData: cutSetData } })).toBe(false);
    expect(cutSetData).toHaveBeenCalledWith(
      "text/plain",
      "- Parent\r\n  - Child\r\n    - Grandchild\r\n"
    );
    expect(container.querySelectorAll("[data-native-block-row]")).toHaveLength(1);
    expect(screen.getByText("Sibling")).toBeVisible();
    expect(documentElement).toHaveAttribute("data-revision", "1");
  });

  it("pastes over a selected list subtree with Page-native CRLF boundaries", async () => {
    const original = "- Parent\r\n  - Child\r\n    - Grandchild\r\n- Sibling\r\n";
    const { container } = render(<MarkdownBlockRuntime file={{ ...file, content: original }} />);
    fireEvent.click(screen.getByText("Parent"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    const documentElement = container.querySelector<HTMLElement>(
      "[data-native-markdown-document]"
    )!;

    expect(
      fireEvent.paste(documentElement, {
        clipboardData: {
          getData: (type: string) =>
            type === "text/plain" ? "Replacement\n\n- one\r\n  - nested" : "",
        },
      })
    ).toBe(false);
    expect(documentElement).toHaveAttribute("data-revision", "1");
    expect(container.querySelectorAll("[data-native-block-row]")).toHaveLength(4);
    expect(screen.queryByText("Child")).not.toBeInTheDocument();
    expect(screen.queryByText("Grandchild")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Markdown block")).toHaveValue("nested");
    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith("page-1", {
      content: "Replacement\r\n\r\n- one\r\n  - nested\r\n- Sibling\r\n",
    });
  });

  it("duplicates a selected list root with descendants and selects the duplicate subtree", async () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "- Parent\n  - Child\n- Sibling\n" }} />
    );
    fireEvent.click(screen.getByText("Parent"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    let rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect(fireEvent.keyDown(rows[0], { key: "d", metaKey: true })).toBe(false);

    rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect([...rows].map((row) => row.textContent)).toEqual([
      expect.stringContaining("Parent"),
      expect.stringContaining("Child"),
      expect.stringContaining("Parent"),
      expect.stringContaining("Child"),
      expect.stringContaining("Sibling"),
    ]);
    expect(rows[2]).toHaveAttribute("data-block-selected", "true");
    expect(rows[3]).toHaveAttribute("data-block-selected", "true");
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(2);

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({
        content: "- Parent\n  - Child\n- Parent\n  - Child\n- Sibling\n",
      })
    );

    expect(fireEvent.keyDown(rows[2], { key: "z", metaKey: true })).toBe(false);
    rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect([...rows].map((row) => row.textContent)).toEqual([
      expect.stringContaining("Parent"),
      expect.stringContaining("Child"),
      expect.stringContaining("Sibling"),
    ]);
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(0);
    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({
        content: "- Parent\n  - Child\n- Sibling\n",
      })
    );
  });

  it("moves a nested list subtree across its sibling and keeps it inside the parent", async () => {
    const initial = "- Parent\n  - First\n    - Detail\n  - Second\n    - Other\n- Outside\n";
    const moved = "- Parent\n  - Second\n    - Other\n  - First\n    - Detail\n- Outside\n";
    const { container } = render(<MarkdownBlockRuntime file={{ ...file, content: initial }} />);
    fireEvent.click(screen.getByText("First"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    let rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(2);
    expect(
      fireEvent.keyDown(rows[1], {
        key: "ArrowDown",
        metaKey: true,
        shiftKey: true,
      })
    ).toBe(false);

    rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect([...rows].map((row) => row.textContent)).toEqual([
      expect.stringContaining("Parent"),
      expect.stringContaining("Second"),
      expect.stringContaining("Other"),
      expect.stringContaining("First"),
      expect.stringContaining("Detail"),
      expect.stringContaining("Outside"),
    ]);
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(2);
    expect(container.querySelector("[data-native-markdown-document]")).toHaveAttribute(
      "data-revision",
      "1"
    );

    expect(
      fireEvent.keyDown(rows[4], {
        key: "ArrowDown",
        metaKey: true,
        shiftKey: true,
      })
    ).toBe(true);
    expect(container.querySelector("[data-native-markdown-document]")).toHaveAttribute(
      "data-revision",
      "1"
    );

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: moved })
    );
  });

  it("copies and moves a selected list subtree through the six-dot menu", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { container } = render(
      <MarkdownBlockRuntime
        file={{
          ...file,
          content: "- Parent\r\n  - Child\r\n- Sibling\r\n  - Sibling child\r\n",
        }}
      />
    );
    fireEvent.click(screen.getByText("Parent"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });

    let handle = screen.getAllByRole("button", { name: "Block actions" })[0];
    fireEvent.pointerDown(handle);
    fireEvent.click(handle);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy Markdown" }));
    expect(writeText).toHaveBeenCalledWith("- Parent\r\n  - Child\r\n");

    handle = screen.getAllByRole("button", { name: "Block actions" })[0];
    fireEvent.pointerDown(handle);
    fireEvent.click(handle);
    fireEvent.click(screen.getByRole("menuitem", { name: "Move down" }));

    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect([...rows].map((row) => row.textContent)).toEqual([
      expect.stringContaining("Sibling"),
      expect.stringContaining("Sibling child"),
      expect.stringContaining("Parent"),
      expect.stringContaining("Child"),
    ]);
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(2);

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({
        content: "- Sibling\r\n  - Sibling child\r\n- Parent\r\n  - Child\r\n",
      })
    );
  });

  it("indents and outdents a selected list root with all descendants", async () => {
    const initial = "- Alpha\n- Beta\n  - Child\n";
    const { container } = render(<MarkdownBlockRuntime file={{ ...file, content: initial }} />);
    fireEvent.click(screen.getByText("Beta"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    let rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(2);
    expect(fireEvent.keyDown(rows[1], { key: "Tab" })).toBe(false);

    rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect(rows[1]).toHaveAttribute("data-block-depth", "1");
    expect(rows[2]).toHaveAttribute("data-block-depth", "2");
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(2);

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: "- Alpha\n  - Beta\n    - Child\n" })
    );

    expect(fireEvent.keyDown(rows[2], { key: "Tab", shiftKey: true })).toBe(false);

    rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect(rows[1]).toHaveAttribute("data-block-depth", "0");
    expect(rows[2]).toHaveAttribute("data-block-depth", "1");
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(2);

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: initial })
    );
  });

  it("applies the six-dot menu to the complete selected Block range", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\r\n\r\nSecond\r\n\r\nThird\r\n" }} />
    );
    fireEvent.click(screen.getByText("First"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    let rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    fireEvent.keyDown(rows[0], { key: "ArrowDown", shiftKey: true });

    let handle = screen.getAllByRole("button", { name: "Block actions" })[0];
    fireEvent.pointerDown(handle);
    fireEvent.click(handle);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy Markdown" }));
    expect(writeText).toHaveBeenCalledWith("First\r\n\r\nSecond\r\n\r\n");
    expect(container.querySelector("[data-native-markdown-document]")).toHaveAttribute(
      "data-revision",
      "0"
    );

    handle = screen.getAllByRole("button", { name: "Block actions" })[0];
    fireEvent.pointerDown(handle);
    fireEvent.click(handle);
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));

    rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect(rows).toHaveLength(5);
    expect(rows[2]).toHaveAttribute("data-block-selected", "true");
    expect(rows[3]).toHaveAttribute("data-block-selected", "true");
    expect(container.querySelector("[data-native-markdown-document]")).toHaveAttribute(
      "data-revision",
      "1"
    );
  });

  it("formats only the selected semantic text through the floating Markdown toolbar", async () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "## Hello world\r\n" }} />
    );

    fireEvent.click(screen.getByRole("heading", { name: "Hello world" }));
    const textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 5);
    fireEvent.select(textarea);

    expect(screen.getByRole("toolbar", { name: "Text formatting" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Change block type: Heading 2" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));

    const semanticEditor = screen.getByLabelText("Markdown block");
    expect(semanticEditor).toHaveTextContent("Hello world");
    expect(semanticEditor).not.toHaveTextContent("**");
    expect(container.querySelector("[data-native-semantic-editor] strong")).toHaveTextContent(
      "Hello"
    );
    expect(container.querySelector("[data-native-markdown-document]")).toHaveAttribute(
      "data-revision",
      "1"
    );

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: "## **Hello** world\r\n" })
    );
  });

  it("persists semantic inline edits back to canonical Markdown source", async () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "Keep **bold** text\n" }} />
    );

    fireEvent.click(screen.getByText("bold"));
    const editor = screen.getByLabelText("Markdown block");
    const strongText = container.querySelector("[data-native-semantic-editor] strong")?.firstChild;
    expect(strongText).toBeInstanceOf(Text);
    if (!strongText) throw new Error("Expected semantic bold text");

    strongText.nodeValue = "bolder";
    setCollapsedDomSelection(strongText, "bolder".length);
    fireEvent.input(editor, { inputType: "insertText", data: "er" });

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: "Keep **bolder** text\n" })
    );
  });

  it("moves the active Block with Alt+Arrow and undoes the move in one step", async () => {
    render(<MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n" }} />);

    fireEvent.click(screen.getByText("First"));
    let textarea = screen.getByLabelText("Markdown block");
    expect(fireEvent.keyDown(textarea, { key: "ArrowDown", altKey: true })).toBe(false);
    expect(screen.getByLabelText("Markdown block")).toHaveValue("First");

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: "Second\n\nFirst\n\n" })
    );

    textarea = screen.getByLabelText("Markdown block");
    fireEvent.keyDown(textarea, { key: "z", metaKey: true });
    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: "First\n\nSecond\n" })
    );
  });

  it("duplicates the active Block with Mod+Shift+D and undoes it in one step", async () => {
    render(<MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n" }} />);

    fireEvent.click(screen.getByText("First"));
    let textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    expect(fireEvent.keyDown(textarea, { key: "d", metaKey: true, shiftKey: true })).toBe(false);
    textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    expect(textarea).toHaveValue("First");
    expect(textarea).toHaveFocus();
    expect(textarea.selectionStart).toBe(0);

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: "First\n\nFirst\n\nSecond\n" })
    );

    fireEvent.keyDown(textarea, { key: "z", metaKey: true });
    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: "First\n\nSecond\n" })
    );
  });

  it("deletes the active Block with Mod+Shift+Backspace and undoes it in one step", async () => {
    render(<MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n" }} />);

    fireEvent.click(screen.getByText("First"));
    const first = screen.getByLabelText("Markdown block");
    expect(fireEvent.keyDown(first, { key: "Backspace", metaKey: true, shiftKey: true })).toBe(
      false
    );

    let textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    expect(textarea).toHaveValue("Second");
    expect(textarea).toHaveFocus();
    expect(textarea.selectionStart).toBe(0);
    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: "Second\n" })
    );

    fireEvent.keyDown(textarea, { key: "z", metaKey: true });
    textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    expect(textarea).toHaveValue("Second");
    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: "First\n\nSecond\n" })
    );
  });

  it("autosaves one settled value after an IME composition", async () => {
    render(<MarkdownBlockRuntime file={file} />);
    fireEvent.click(screen.getByText("Hello"));
    const textarea = screen.getByLabelText("Markdown block");

    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: "你" } });
    fireEvent.change(textarea, { target: { value: "你好" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(updateFile).not.toHaveBeenCalled();

    fireEvent.compositionEnd(textarea);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(updateFile).toHaveBeenCalledTimes(1);
    expect(updateFile).toHaveBeenCalledWith(
      "page-1",
      expect.objectContaining({ content: "你好\n" })
    );
  });

  it("undoes an IME composition as one edit", () => {
    render(<MarkdownBlockRuntime file={file} />);
    fireEvent.click(screen.getByText("Hello"));
    const textarea = screen.getByLabelText("Markdown block");

    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: "你" } });
    fireEvent.change(textarea, { target: { value: "你好" } });
    fireEvent.compositionEnd(textarea);
    fireEvent.keyDown(textarea, { key: "z", metaKey: true });

    expect(screen.getByLabelText("Markdown block")).toHaveValue("Hello");
  });

  it("writes no command while an IME composition is open", async () => {
    render(<MarkdownBlockRuntime file={file} />);
    fireEvent.click(screen.getByText("Hello"));
    const textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    const documentElement = document.querySelector("[data-native-markdown-document]");
    const revisionBefore = documentElement?.getAttribute("data-revision");

    fireEvent.compositionStart(textarea);
    fireEvent.compositionUpdate(textarea, { data: "n" });
    fireEvent.change(textarea, { target: { value: "ni" } });
    fireEvent.change(textarea, { target: { value: "niha" } });

    // The DOM keeps the in-flight pinyin — React must not write the model's value back over it —
    // while the document itself is untouched until the composition settles.
    expect(textarea).toHaveValue("niha");
    expect(documentElement?.getAttribute("data-revision")).toBe(revisionBefore);

    fireEvent.compositionEnd(textarea, { target: { value: "你好" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByLabelText("Markdown block")).toHaveValue("你好");
    expect(updateFile).toHaveBeenCalledTimes(1);
    expect(updateFile).toHaveBeenCalledWith(
      "page-1",
      expect.objectContaining({ content: "你好\n" })
    );
  });

  it("keeps a typed word as one undo step and breaks the run at a Block change", async () => {
    render(<MarkdownBlockRuntime file={{ ...file, content: "one\n\ntwo\n" }} />);
    fireEvent.click(screen.getByText("one"));
    const first = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    for (const value of ["oneA", "oneAB", "oneABC"]) {
      fireEvent.change(first, { target: { value } });
    }

    // One Mod+Z takes back the whole run, not one character.
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "z", metaKey: true });
    expect(screen.getByLabelText("Markdown block")).toHaveValue("one");
  });

  it("exposes native menu Undo and Redo through canonical Markdown history", () => {
    render(<MarkdownBlockRuntime file={file} />);
    fireEvent.click(screen.getByText("Hello"));
    fireEvent.change(screen.getByLabelText("Markdown block"), {
      target: { value: "Edited" },
    });

    act(() => useEditorRefStore.getState().requestUndo?.());
    expect(screen.getByLabelText("Markdown block")).toHaveValue("Hello");

    act(() => useEditorRefStore.getState().requestRedo?.());
    expect(screen.getByLabelText("Markdown block")).toHaveValue("Edited");
  });

  it("keeps an editable active block when undo removes the selected block", () => {
    render(<MarkdownBlockRuntime file={file} />);
    fireEvent.click(screen.getByText("Hello"));
    const first = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    first.setSelectionRange(2, 2);
    fireEvent.keyDown(first, { key: "Enter" });

    const second = screen.getByLabelText("Markdown block");
    fireEvent.keyDown(second, { key: "z", metaKey: true });

    expect(screen.getByLabelText("Markdown block")).toHaveValue("Hello");
  });

  it("leaves the caret where the undone split happened, not at the top of the Page", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "One\n\nTwo\n\nThree\n\nFour five\n" }} />
    );
    fireEvent.click(screen.getByText("Four five"));
    const editor = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    editor.setSelectionRange(4, 4);
    fireEvent.keyDown(editor, { key: "Enter" });

    act(() => useEditorRefStore.getState().requestUndo?.());

    // The tail Block the split minted is gone, so its id cannot be restored — but the Block that
    // was split is still there, at the same index, and that is where the user was working.
    expect(screen.getByLabelText("Markdown block")).toHaveValue("Four five");
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect(rows).toHaveLength(4);
    expect(rows[3].querySelector("[aria-label='Markdown block']")).not.toBeNull();
  });

  /*
   * The same rule, read the other way round.
   *
   * A minted Block always lands *after* the one it grew out of, so the Block that slides into its
   * index is the origin's follower, not the origin. Landing there put the caret one Block too far
   * down, and the next keyboard command — the matrix presses Mod+Shift+Backspace straight after this
   * undo — deleted a Block the user never pointed at.
   */
  it("leaves the caret on the duplicated Block, not on the one below it", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "One\n\nTwo\n\nThree\n" }} />
    );
    fireEvent.click(screen.getByText("One"));
    const editor = screen.getByLabelText("Markdown block");
    fireEvent.keyDown(editor, { key: "d", metaKey: true, shiftKey: true });
    expect(container.querySelectorAll("[data-native-block-row]")).toHaveLength(4);

    act(() => useEditorRefStore.getState().requestUndo?.());

    expect(container.querySelectorAll("[data-native-block-row]")).toHaveLength(3);
    expect(screen.getByLabelText("Markdown block")).toHaveValue("One");
  });

  it("moves a Block only from its grip and supports dropping after the last Block", async () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n" }} />
    );
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    const grips = screen.getAllByRole("button", { name: "Block actions" });
    const endTarget = container.querySelector<HTMLElement>("[data-native-block-drop-end]");
    const transfer = dragTransfer();

    expect(rows[0]).not.toHaveAttribute("draggable", "true");
    expect(grips[0]).toHaveAttribute("draggable", "true");
    expect(endTarget).not.toBeNull();
    if (!endTarget) return;

    fireEvent.dragStart(grips[0], { dataTransfer: transfer });
    expect(transfer.types).toContain("application/x-doxmind-markdown-block");
    expect(fireEvent.dragOver(endTarget, { dataTransfer: transfer })).toBe(false);
    expect(endTarget).toHaveAttribute("data-drop-active", "true");
    expect(fireEvent.drop(endTarget, { dataTransfer: transfer })).toBe(false);

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenCalledWith(
      "page-1",
      expect.objectContaining({ content: "Second\n\nFirst\n\n" })
    );
  });

  it("drags a contiguous Block selection as one atomic group with a precise drop guide", async () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n\nThird\n\nFourth\n" }} />
    );
    fireEvent.click(screen.getByText("First"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    let rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    fireEvent.keyDown(rows[0], { key: "ArrowDown", shiftKey: true });

    const grips = screen.getAllByRole("button", { name: "Block actions" });
    const transfer = dragTransfer();
    fireEvent.pointerDown(grips[0]);
    fireEvent.dragStart(grips[0], { dataTransfer: transfer });
    rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    vi.spyOn(rows[3], "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 100,
      top: 100,
      left: 0,
      right: 600,
      bottom: 140,
      width: 600,
      height: 40,
      toJSON: () => ({}),
    });

    expect(fireEvent.dragOver(rows[3], { dataTransfer: transfer, clientY: 101 })).toBe(false);
    expect(rows[3]).toHaveAttribute("data-drop-before", "true");
    expect(fireEvent.drop(rows[3], { dataTransfer: transfer, clientY: 101 })).toBe(false);

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: "Third\n\nFirst\n\nSecond\n\nFourth\n" })
    );
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(2);
  });

  it("turns a cross-Block pointer drag into a Block selection", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n\nThird\n" }} />
    );
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    stackRowRects(rows);

    // Press inside "First" at y=110, sweep to y=195 — a band that covers all three rows.
    firePointerAt(rows[0], "pointerDown", 300, 110);
    firePointerAt(window, "pointerMove", 300, 195);
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(3);
    expect(container.querySelector(".markdown-page")).toHaveAttribute("data-block-marquee", "true");
    // No marquee rectangle: the sweep started on a Block, so only the fill is shown.
    expect(container.querySelector("[data-native-block-marquee]")).not.toBeInTheDocument();

    fireEvent.pointerUp(window);
    expect(container.querySelector(".markdown-page")).not.toHaveAttribute("data-block-marquee");
  });

  it("leaves a sweep inside one Block to the browser's own text selection", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n" }} />
    );
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    stackRowRects(rows);

    firePointerAt(rows[0], "pointerDown", 300, 110);
    firePointerAt(window, "pointerMove", 420, 120);
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(0);
    expect(container.querySelector(".markdown-page")).not.toHaveAttribute("data-block-marquee");
    fireEvent.pointerUp(window);
  });

  it("marquee-selects from the page margin", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n\nThird\n" }} />
    );
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    stackRowRects(rows);
    const page = container.querySelector<HTMLElement>(".markdown-page")!;

    firePointerAt(page, "pointerDown", 20, 105);
    firePointerAt(window, "pointerMove", 60, 175);
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(2);
    expect(container.querySelector("[data-native-block-marquee]")).toBeInTheDocument();
    fireEvent.pointerUp(window);
    expect(container.querySelector("[data-native-block-marquee]")).not.toBeInTheDocument();
  });

  it("releases the caret when a press lands outside every Block", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n" }} />
    );
    fireEvent.click(screen.getByText("First"));
    expect(container.querySelector('[data-native-block-row][data-active="true"]')).toBeTruthy();
    expect(container.querySelector("[data-native-block-edit-surface]")).toBeInTheDocument();

    // The scroll container is an ancestor of the Page, so this is the margin beside the frame —
    // where the caret used to survive indefinitely, leaving the Block visibly mid-edit while
    // `document.activeElement` had already fallen back to the body.
    const scroll = container.querySelector<HTMLElement>("[data-native-markdown-scroll]")!;
    firePointerAt(scroll, "pointerDown", 20, 110);

    expect(container.querySelector('[data-native-block-row][data-active="true"]')).toBeNull();
    expect(container.querySelector("[data-native-block-edit-surface]")).not.toBeInTheDocument();
  });

  it("never appends a Block from a press outside the Page", () => {
    const { container } = render(<MarkdownBlockRuntime file={{ ...file, content: "Only\n" }} />);
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    stackRowRects(rows);
    fireEvent.click(screen.getByText("Only"));

    // Below the last row, but in the margin rather than in the Page. Reaching the append from here
    // wrote an empty paragraph to disk: `"Only paragraph.\n"` became `"Only paragraph.\n\n"` in the
    // browser, from a single click meant only to deselect.
    const scroll = container.querySelector<HTMLElement>("[data-native-markdown-scroll]")!;
    firePointerAt(scroll, "pointerDown", 900, 400);

    expect(container.querySelectorAll("[data-native-block-row]")).toHaveLength(rows.length);
    expect(container.querySelector('[data-native-block-row][data-active="true"]')).toBeNull();
  });

  it("replaces a Block selection with the typed character in one undo step", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n\nThird\n" }} />
    );
    fireEvent.click(screen.getByText("First"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    fireEvent.keyDown(rows[0], { key: "ArrowDown", shiftKey: true });
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(2);

    fireEvent.keyDown(container.querySelectorAll("[data-native-block-row]")[0], { key: "x" });
    expect(container.querySelectorAll("[data-native-block-row]")).toHaveLength(2);
    expect(screen.getByLabelText("Markdown block")).toHaveValue("x");

    act(() => useEditorRefStore.getState().requestUndo?.());
    expect(container.querySelectorAll("[data-native-block-row]")).toHaveLength(3);
  });

  it("collapses a Block selection back to a caret on ArrowLeft and ArrowRight", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n" }} />
    );
    fireEvent.click(screen.getByText("First"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    fireEvent.keyDown(rows[0], { key: "ArrowDown", shiftKey: true });

    fireEvent.keyDown(container.querySelectorAll("[data-native-block-row]")[0], {
      key: "ArrowRight",
    });
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(0);
    const editor = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    expect(editor).toHaveValue("Second");
    expect(editor.selectionStart).toBe("Second".length);
  });

  it("surfaces a toolbar for a multi-Block selection and acts on the whole range", async () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "one\n\ntwo\n\nthree\n" }} />
    );
    fireEvent.click(screen.getByText("one"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    fireEvent.keyDown(rows[0], { key: "ArrowDown", shiftKey: true });
    // Focus follows the selection's focus edge, so the next key goes to that row.
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown", shiftKey: true });
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(3);

    const toolbar = screen.getByRole("toolbar", { name: "3 blocks selected" });
    expect(within(toolbar).getByText("Turn into")).toBeInTheDocument();
    expect(within(toolbar).getByText("Duplicate")).toBeInTheDocument();

    fireEvent.click(within(toolbar).getByRole("button", { name: "Delete selected blocks" }));
    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith("page-1", expect.objectContaining({ content: "" }));
  });

  it("keeps the rest of a multi-token fence info string when the language chip is edited", async () => {
    render(
      <MarkdownBlockRuntime
        file={{ ...file, content: '```ts title="example"\nconst a = 1;\n```\n' }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: 'Code language: ts title="example"' }));
    const field = screen.getByLabelText("Code language");
    fireEvent.change(field, { target: { value: 'js title="example"' } });
    fireEvent.keyDown(field, { key: "Enter" });

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenCalledWith(
      "page-1",
      expect.objectContaining({ content: '```js title="example"\nconst a = 1;\n```\n' })
    );
  });

  it("keeps a multi-Block selection alive while its toolbar is being pressed", async () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "one\n\ntwo\n\nthree\n" }} />
    );
    fireEvent.click(screen.getByText("one"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    fireEvent.keyDown(rows[0], { key: "ArrowDown", shiftKey: true });
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(2);

    // A real press is pointerdown then click. The pointerdown used to reach the document handler
    // and clear the selection out from under the button before its click ever arrived.
    const toolbar = screen.getByRole("toolbar", { name: "2 blocks selected" });
    const remove = within(toolbar).getByRole("button", { name: "Delete selected blocks" });
    fireEvent.pointerDown(remove);
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(2);
    fireEvent.click(remove);

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: "three\n" })
    );
  });

  /*
   * A gutter action hands the Block back.
   *
   * The Block menu portals onto `document.body`, so its press reaches the document handler that
   * releases the caret — and that release is load-bearing, not incidental: the command runs, the
   * Block it acted on re-activates, and its editing surface takes the caret, so the very next
   * keystroke edits the result. Exempting the menu's press from that handler (an attempt to keep a
   * multi-Block selection alive across it) left Duplicate, Delete and Move with no active Block and
   * no surface at all, which is a Page the keyboard cannot reach.
   */
  it("leaves an editing surface behind after a gutter menu action", async () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "One\n\nTwo\n\nThree\n" }} />
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Block actions" })[1]);
    const duplicate = screen.getByRole("menuitem", { name: "Duplicate" });
    fireEvent.pointerDown(duplicate);
    fireEvent.click(duplicate);

    expect(container.querySelectorAll("[data-native-block-row]")).toHaveLength(4);
    expect(container.querySelectorAll('[data-native-block-row][data-active="true"]')).toHaveLength(
      1
    );
    expect(container.querySelectorAll("[data-native-block-editor]")).toHaveLength(1);

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: "One\n\nTwo\n\nTwo\n\nThree\n" })
    );
  });

  it("keeps the shortcut legend out of a cross-Block copy", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n" }} />
    );
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    const range = document.createRange();
    range.setStartBefore(rows[0]);
    range.setEndAfter(rows[1]);
    expect(range.toString()).not.toContain("Press Enter to edit");
    // One legend for the whole document, referenced by every row.
    expect(container.querySelectorAll("#native-block-shortcuts")).toHaveLength(1);
  });

  it("picks the nearest drop boundary wherever the pointer is", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n\nThird\n\nFourth\n" }} />
    );
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    stackRowRects(rows);
    const grips = screen.getAllByRole("button", { name: "Block actions" });
    const transfer = dragTransfer();
    fireEvent.dragStart(grips[0], { dataTransfer: transfer });

    const scroller = container.querySelector<HTMLElement>("[data-native-markdown-scroll]")!;
    // Rows sit at y=100,140,180,220. Dragging "First" makes the boundary before "Second" a no-op,
    // so the nearest useful boundaries are "Third" at 180 and "Fourth" at 220.
    fireDragAt(scroller, "dragOver", transfer, 185);
    expect(rows[2]).toHaveAttribute("data-drop-before", "true");

    // Nearest wins even when the pointer is nowhere near a row's own box — the page margin is live.
    fireDragAt(scroller, "dragOver", transfer, 214);
    expect(rows[3]).toHaveAttribute("data-drop-before", "true");
    expect(container.querySelectorAll("[data-drop-before]")).toHaveLength(1);
  });

  it("shows no insertion line for a drop that would not move anything", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n" }} />
    );
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    stackRowRects(rows);
    // Drag the last Block: dropping it before itself, and dropping it at the tail, are both no-ops,
    // so the only useful boundary is before "First" at y=100.
    const grips = screen.getAllByRole("button", { name: "Block actions" });
    const transfer = dragTransfer();
    fireEvent.dragStart(grips[1], { dataTransfer: transfer });

    const scroller = container.querySelector<HTMLElement>("[data-native-markdown-scroll]")!;
    fireDragAt(scroller, "dragOver", transfer, 900);
    expect(container.querySelectorAll("[data-drop-before]")).toHaveLength(0);
    expect(
      container.querySelector<HTMLElement>("[data-native-block-drop-end]")
    ).not.toHaveAttribute("data-drop-active");
    expect(transfer.dropEffect).toBe("none");

    // Close in, the one real boundary does light up.
    fireDragAt(scroller, "dragOver", transfer, 104);
    expect(rows[0]).toHaveAttribute("data-drop-before", "true");
    expect(transfer.dropEffect).toBe("move");
  });

  it("drags a translucent snapshot of the Block and dims the source", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n" }} />
    );
    const grip = screen.getAllByRole("button", { name: "Block actions" })[0];
    const transfer = dragTransfer();
    fireEvent.dragStart(grip, { dataTransfer: transfer });

    expect(transfer.setDragImage).toHaveBeenCalled();
    expect(container.querySelectorAll('[data-block-dragging="true"]')).toHaveLength(1);

    fireEvent.dragEnd(grip, { dataTransfer: transfer });
    expect(container.querySelectorAll("[data-block-dragging]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-drop-before]")).toHaveLength(0);
  });

  it("drags a selected list root with every descendant in one session", async () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "- Parent\n  - Child\n\nParagraph\n" }} />
    );
    fireEvent.click(screen.getByText("Parent"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(2);

    const handle = screen.getAllByRole("button", { name: "Block actions" })[0];
    const endTarget = container.querySelector<HTMLElement>("[data-native-block-drop-end]")!;
    const transfer = dragTransfer();
    fireEvent.pointerDown(handle);
    fireEvent.dragStart(handle, { dataTransfer: transfer });
    expect(fireEvent.dragOver(endTarget, { dataTransfer: transfer })).toBe(false);
    expect(fireEvent.drop(endTarget, { dataTransfer: transfer })).toBe(false);

    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect([...rows].map((row) => row.textContent)).toEqual([
      expect.stringContaining("Paragraph"),
      expect.stringContaining("Parent"),
      expect.stringContaining("Child"),
    ]);
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(2);

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: "Paragraph\n\n- Parent\n  - Child\n\n" })
    );
  });

  it("ignores text and external drops and clears the internal drag session on dragend", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n" }} />
    );
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    const grip = screen.getAllByRole("button", { name: "Block actions" })[0];
    const text = dragTransfer({ "text/plain": "block-1" });
    const external = dragTransfer();
    Object.defineProperty(external, "files", {
      configurable: true,
      value: [new File(["outside"], "outside.md", { type: "text/markdown" })],
    });

    expect(fireEvent.drop(rows[1], { dataTransfer: text })).toBe(true);
    expect(fireEvent.drop(rows[1], { dataTransfer: external })).toBe(true);

    const internal = dragTransfer();
    fireEvent.dragStart(grip, { dataTransfer: internal });
    fireEvent.dragEnd(grip, { dataTransfer: internal });
    expect(fireEvent.drop(rows[1], { dataTransfer: internal })).toBe(true);

    expect(container.querySelector("[data-native-markdown-document]")).toHaveAttribute(
      "data-revision",
      "0"
    );
    expect(
      [...container.querySelectorAll("[data-native-block-row]")].map((row) => row.textContent)
    ).toEqual([expect.stringContaining("First"), expect.stringContaining("Second")]);
  });
  it("re-renders only the edited Block when a keystroke lands in a long Page", () => {
    const markdown = `${Array.from({ length: 24 }, (_, index) => `Paragraph ${index + 1}.`).join(
      "\n\n"
    )}\n`;
    const { container } = render(<MarkdownBlockRuntime file={{ ...file, content: markdown }} />);
    expect(container.querySelectorAll("[data-native-block-row]")).toHaveLength(24);

    fireEvent.click(screen.getByText("Paragraph 7."));

    projectedBlockSources.length = 0;
    fireEvent.change(screen.getByLabelText("Markdown block"), {
      target: { value: "Paragraph 7 edited." },
    });

    // Before the rows were memoised every one of the other 23 Blocks appeared here: each row rebuilt
    // its editing projection and re-parsed its inline Markdown on every keystroke, which is what made
    // latency scale with document length.
    expect(projectedBlockSources.filter((raw) => !raw.startsWith("Paragraph 7"))).toEqual([]);
    expect(projectedBlockSources.length).toBeGreaterThan(0);
  });

  it("does not rebuild the workspace catalog while the user is typing elsewhere", async () => {
    const definition =
      '```doxmind-collection\n{"version":1,"view":"table","filters":[],"columns":[],"sort":[]}\n```\n';
    const collectionFile: FileItem = {
      ...file,
      content: `Prose.\n\n${definition}`,
      storageHandle: {
        mode: "disk",
        kind: "document",
        id: file.id,
        relPath: "Collections/Tasks.md",
        documentType: "markdown",
      },
    };
    const services: MarkdownTransclusionServices = {
      rebuild: vi.fn(async () => ({
        pages: [],
        sourcePages: [],
        catalogPages: [
          {
            id: "task-1",
            path: "Tasks/One.md",
            title: "One task",
            aliases: [],
            properties: { type: "task" },
            markdown: "Task body\n",
            revision: "sha256:task",
          },
        ],
        links: [],
        backlinks: [],
        unlinkedMentions: [],
      })),
    };

    render(<MarkdownBlockRuntime file={collectionFile} transclusionServices={services} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("table", { name: "Page collection table" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Prose."));
    projectedBlockSources.length = 0;
    fireEvent.change(screen.getByLabelText("Markdown block"), { target: { value: "Prose!" } });

    // The catalog fed to a Collection used to be patched from the live snapshot, so one character
    // produced a whole new `catalogPages` array, a whole new context object and a re-render of every
    // Collection Block on the Page — which then re-filtered and re-sorted the entire workspace.
    expect(projectedBlockSources.filter((raw) => raw.includes("doxmind-collection"))).toEqual([]);
    expect(projectedBlockSources.length).toBeGreaterThan(0);

    // Settled, not abandoned: the catalog still follows the edit, a beat behind the caret.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByRole("table", { name: "Page collection table" })).toHaveTextContent(
      "One task"
    );
  });

  it("does not re-lex the whole Page source on every keystroke", () => {
    render(<MarkdownBlockRuntime file={{ ...file, content: "Alpha\n\nBeta\n" }} />);
    fireEvent.click(screen.getByText("Alpha"));

    // `useRef(MarkdownBlockDocument.fromMarkdown(...))` builds its argument on every render and keeps
    // only the first, so the whole source was re-lexed for each keystroke.
    const fromMarkdown = vi.spyOn(MarkdownBlockDocument, "fromMarkdown");
    try {
      fireEvent.change(screen.getByLabelText("Markdown block"), { target: { value: "Alpha!" } });
      expect(fromMarkdown).not.toHaveBeenCalled();
    } finally {
      fromMarkdown.mockRestore();
    }
  });

  it("marks an unresolved wiki link apart and writes the Page it points at when clicked", () => {
    useFileStore.setState({
      updateFile,
      createTransientFile,
      openTarget: "file",
      rootPath: null,
      files: [
        { ...file, id: "page-1", name: "Notes.md", preview: "Notes" },
        { ...file, id: "page-real", name: "Real.md", content: "Real page.\n", preview: "Real" },
      ],
    });
    useNotificationStore.setState({ errors: [] });

    render(
      <MarkdownBlockRuntime
        file={{
          ...file,
          name: "Notes.md",
          preview: "Notes",
          content: "resolved [[Real]] vs missing [[Ghost]].\n",
        }}
      />
    );

    const resolved = screen.getByRole("button", { name: "Open Page: Real" });
    const unresolved = screen.getByRole("button", { name: "Unresolved Page link: Ghost" });
    expect(resolved).not.toHaveAttribute("data-wiki-link-unresolved");
    expect(unresolved).toHaveAttribute("data-wiki-link-unresolved", "true");
    expect(unresolved.className).not.toEqual(resolved.className);
    expect(unresolved.className).toContain("text-muted-foreground");
    expect(unresolved.className).toContain("decoration-dashed");

    fireEvent.click(unresolved);

    // An unresolved link is a Page the author intends to write, so clicking it writes one rather
    // than reporting that it is missing — which was all the click used to do.
    expect(createTransientFile).toHaveBeenCalledWith("Ghost.md");
    expect(useNotificationStore.getState().errors).toEqual([]);
  });

  it("opens a resolvable wiki link without a notification", async () => {
    const requestCurrentFile = vi.fn(async () => true);
    useFileStore.setState({
      updateFile,
      requestCurrentFile,
      files: [
        { ...file, id: "page-1", name: "Notes.md", preview: "Notes" },
        { ...file, id: "page-real", name: "Real.md", content: "Real page.\n", preview: "Real" },
      ],
    });
    useNotificationStore.setState({ errors: [] });

    render(
      <MarkdownBlockRuntime
        file={{ ...file, name: "Notes.md", preview: "Notes", content: "See [[Real]].\n" }}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open Page: Real" }));
    });

    expect(requestCurrentFile).toHaveBeenCalledWith("page-real");
    expect(useNotificationStore.getState().errors).toEqual([]);
  });

  /*
   * A real mouse press is `pointerdown` and *then* `click`.
   *
   * Every menu case above drives the item with `click` alone, which is why the whole gutter/toolbar
   * menu family passed here while being inert or wrong in the app: the pointerdown that a mouse
   * sends first is the one that reaches the document handler and rewrites the state the item's own
   * click then reads. These press the item the way a mouse does.
   */
  function pressMenuItem(item: HTMLElement) {
    fireEvent.pointerDown(item);
    fireEvent.click(item);
  }

  it("leaves an editing surface behind after a gutter Turn into", async () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "One\n\nTwo\n" }} />
    );

    const grip = screen.getAllByRole("button", { name: "Block actions" })[0];
    fireEvent.pointerDown(grip);
    fireEvent.click(grip);
    pressMenuItem(screen.getByRole("menuitem", { name: "Turn into" }));
    pressMenuItem(screen.getByRole("menuitem", { name: "Heading 2" }));

    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect(rows[0]).toHaveAttribute("data-block-kind", "heading");
    // The conversion always landed; what was lost was every way to keep typing into the result.
    expect(container.querySelectorAll('[data-native-block-row][data-active="true"]')).toHaveLength(
      1
    );
    expect(container.querySelectorAll("[data-native-block-editor]")).toHaveLength(1);

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: "## One\n\nTwo\n" })
    );
  });

  it("turns a whole Block selection when the toolbar's menu item is really pressed", async () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "one\n\ntwo\n\nthree\n" }} />
    );
    fireEvent.click(screen.getByText("one"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    fireEvent.keyDown(rows[0], { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown", shiftKey: true });

    const toolbar = screen.getByRole("toolbar", { name: "3 blocks selected" });
    fireEvent.click(within(toolbar).getByText("Turn into"));
    pressMenuItem(screen.getByRole("menuitem", { name: "Heading 2" }));

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: "## one\n\n## two\n\n## three\n" })
    );
  });

  it("turns a Block selection into a tight list, the shape the editor writes everywhere else", async () => {
    const { container } = render(
      <MarkdownBlockRuntime
        file={{ ...file, content: "Para one\n\nPara two\n\nPara three\n\nKeep me\n" }}
      />
    );
    fireEvent.click(screen.getByText("Para one"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    fireEvent.keyDown(rows[0], { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown", shiftKey: true });

    const toolbar = screen.getByRole("toolbar", { name: "3 blocks selected" });
    fireEvent.click(within(toolbar).getByText("Turn into"));
    pressMenuItem(screen.getByRole("menuitem", { name: "Bulleted list" }));

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({
        content: "- Para one\n- Para two\n- Para three\n\nKeep me\n",
      })
    );
  });

  it("applies a really-pressed gutter menu item to the whole Block selection", async () => {
    const { container } = render(
      <MarkdownBlockRuntime
        file={{ ...file, content: "Keep top\n\nPara A\n\nPara B\n\nPara C\n\nUntouched X\n" }}
      />
    );
    fireEvent.click(screen.getByText("Para A"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    fireEvent.keyDown(rows[1], { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown", shiftKey: true });
    expect(container.querySelectorAll('[data-block-selected="true"]')).toHaveLength(3);

    // The grip of the *middle* Block of the band, which is what makes the one-Block answer visible.
    const grip = screen.getAllByRole("button", { name: "Block actions" })[2];
    fireEvent.pointerDown(grip);
    fireEvent.click(grip);
    pressMenuItem(screen.getByRole("menuitem", { name: "Delete" }));

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: "Keep top\n\nUntouched X\n" })
    );
  });

  it("leaves a key pressed on a focused control outside the Page to that control", async () => {
    render(
      <div>
        <button type="button">Graph</button>
        <MarkdownBlockRuntime file={file} />
      </div>
    );

    const chrome = screen.getByRole("button", { name: "Graph" });
    chrome.focus();
    for (const key of ["h", "e", "Enter", " "]) {
      const event = createEvent.keyDown(chrome, { key, bubbles: true, cancelable: true });
      fireEvent(chrome, event);
      expect(event.defaultPrevented, key).toBe(false);
    }

    expect(screen.queryByLabelText("Markdown block")).not.toBeInTheDocument();
    expect(useEditorStore.getState().isDirty).toBe(false);
    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).not.toHaveBeenCalled();
  });

  it("inserts a slash command's Block after the text instead of into it", async () => {
    render(<MarkdownBlockRuntime file={{ ...file, content: "Alpha /table\n\nTAIL\n" }} />);

    fireEvent.click(screen.getByText("Alpha /table"));
    const editor = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    editor.setSelectionRange(12, 12);
    fireEvent.keyUp(editor, { key: "e" });
    fireEvent.keyDown(editor, { key: "Enter" });

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    // The trailing space is the user's own byte, typed before the trigger, and stays theirs.
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({
        content: "Alpha \n\n| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n\nTAIL\n",
      })
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("hands the Block back after Copy Markdown, which writes nothing", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "AAAA\n\nBBBB\n\nCCCC\n" }} />
    );

    fireEvent.click(screen.getByText("CCCC"));
    const grip = screen.getAllByRole("button", { name: "Block actions" })[2];
    fireEvent.pointerDown(grip);
    fireEvent.click(grip);
    pressMenuItem(screen.getByRole("menuitem", { name: "Copy Markdown" }));

    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect(rows[2]).toHaveAttribute("data-active", "true");
    expect(rows[2].querySelector("[data-native-block-editor]")).not.toBeNull();
    expect(container.querySelector("[data-native-markdown-document]")).toHaveAttribute(
      "data-revision",
      "0"
    );
  });

  it("moves and deletes from row focus with the shortcuts the row announces", async () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "alpha\n\nbeta\n\ngamma\n" }} />
    );
    const legend = container.querySelector("#native-block-shortcuts")?.textContent ?? "";
    expect(legend).toContain("Alt plus Arrow keys to move");
    expect(legend).toContain("Mod plus Shift plus Backspace to delete");

    fireEvent.click(screen.getByText("beta"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowUp", altKey: true });

    let rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect([...rows].map((row) => row.textContent)).toEqual([
      expect.stringContaining("beta"),
      expect.stringContaining("alpha"),
      expect.stringContaining("gamma"),
    ]);

    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "Backspace",
      metaKey: true,
      shiftKey: true,
    });
    rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect(rows).toHaveLength(2);

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenLastCalledWith(
      "page-1",
      expect.objectContaining({ content: "alpha\n\ngamma\n" })
    );
  });

  it("undoes a Block-selection delete onto the restored Blocks, not onto Block 1", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "One\n\nTwo\n\nThree\n\nFour\n" }} />
    );
    fireEvent.click(screen.getByText("Two"));
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), { key: "Escape" });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Backspace" });
    expect(container.querySelectorAll("[data-native-block-row]")).toHaveLength(2);

    act(() => useEditorRefStore.getState().requestUndo?.());

    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    expect(rows).toHaveLength(4);
    // Block 1 is untouched content the user never pointed at; the next keystroke must not land there.
    expect(rows[0].querySelector("[data-native-block-editor]")).toBeNull();
    expect(rows[1].querySelector("[data-native-block-editor]")).not.toBeNull();
  });
});
