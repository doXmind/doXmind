import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { usePageSessionStore } from "@/stores/page-session-store";

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
    setDragImage() {},
  } as unknown as DataTransfer;
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
    useFileStore.setState({ updateFile });
    useEditorStore.setState({ isDirty: false, isSaving: false, lastSavedAt: null });
    useEditorRefStore.setState({
      requestSave: null,
      requestUndo: null,
      requestRedo: null,
      discardPendingChanges: null,
    });
    useLayoutStore.setState({ autosaveEnabled: true, isSearchBarOpen: false });
    usePageSessionStore.setState({ outlineSession: null });
  });

  afterEach(() => {
    vi.useRealTimers();
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
    let textarea = screen.getByLabelText("Markdown block");
    fireEvent.keyDown(textarea, { key: "Enter" });

    textarea = screen.getByLabelText("Markdown block");
    expect(textarea).toHaveValue(
      "<details>\n<summary>Toggle</summary>\n\nWrite something…\n\n</details>"
    );
    expect(container.querySelector("[data-native-markdown-document]")).toHaveAttribute(
      "data-revision",
      "1"
    );

    fireEvent.keyDown(textarea, { key: "z", metaKey: true });
    expect(screen.getByLabelText("Markdown block")).toHaveValue("/tog");
    fireEvent.keyDown(screen.getByLabelText("Markdown block"), {
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
    const textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    textarea.setSelectionRange(22, 22);

    expect(fireEvent.keyDown(textarea, { key: "Enter" })).toBe(true);
    fireEvent.change(textarea, {
      target: { value: "```ts\nconst first = 1;\n// inserted\n\nconst second = 2;\n```" },
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

  it("continues a list item on Enter without pulling the caret back during the next edit", async () => {
    render(<MarkdownBlockRuntime file={{ ...file, content: "- one two\n- keep\n" }} />);

    fireEvent.click(screen.getByText("one two"));
    const first = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    first.setSelectionRange(6, 6);
    fireEvent.keyDown(first, { key: "Enter" });

    const second = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    expect(second).toHaveValue("- two");
    expect(second.selectionStart).toBe(2);
    fireEvent.change(second, { target: { value: "- typed" } });
    expect(second.selectionStart).toBe(7);

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
    textarea.setSelectionRange(2, 2);
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

  it("finds source text and moves the textarea selection between matching Blocks", () => {
    render(
      <MarkdownBlockRuntime
        file={{
          ...file,
          content: "First Needle\r\n\r\nSecond needle\r\n",
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
    let textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    expect(textarea).toHaveValue("First Needle");
    expect(textarea.selectionStart).toBe(6);
    expect(textarea.selectionEnd).toBe(12);

    fireEvent.click(screen.getByRole("button", { name: "Next result" }));
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
    textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    expect(textarea).toHaveValue("Second needle");
    expect(textarea.selectionStart).toBe(7);
    expect(textarea.selectionEnd).toBe(13);

    fireEvent.click(screen.getByRole("button", { name: "Previous result" }));
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Markdown block")).toHaveValue("First Needle");
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
    expect(screen.getByLabelText("Markdown block")).toHaveValue("## Next steps");
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
        const row = screen.getByRole("group", { name: "Block 1 of 1" });
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

  it("moves a Block only from its grip and supports dropping after the last Block", async () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n" }} />
    );
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    const grips = screen.getAllByRole("button", { name: "Drag block" });
    const endTarget = container.querySelector<HTMLElement>("[data-native-block-drop-end]");
    const transfer = dragTransfer();

    expect(rows[0]).not.toHaveAttribute("draggable", "true");
    expect(grips[0]).toHaveAttribute("draggable", "true");
    expect(endTarget).not.toBeNull();
    if (!endTarget) return;

    fireEvent.dragStart(grips[0], { dataTransfer: transfer });
    expect(transfer.types).toContain("application/x-doxmind-markdown-block");
    expect(fireEvent.dragOver(endTarget, { dataTransfer: transfer })).toBe(false);
    expect(fireEvent.drop(endTarget, { dataTransfer: transfer })).toBe(false);

    await act(async () => {
      await useEditorRefStore.getState().requestSave?.();
    });
    expect(updateFile).toHaveBeenCalledWith(
      "page-1",
      expect.objectContaining({ content: "Second\n\nFirst\n\n" })
    );
  });

  it("ignores text and external drops and clears the internal drag session on dragend", () => {
    const { container } = render(
      <MarkdownBlockRuntime file={{ ...file, content: "First\n\nSecond\n" }} />
    );
    const rows = container.querySelectorAll<HTMLElement>("[data-native-block-row]");
    const grip = screen.getAllByRole("button", { name: "Drag block" })[0];
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
});
