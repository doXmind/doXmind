import { createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mermaidTheme, renderMermaidSvg, renderMermaidSvgLight, renderToString } = vi.hoisted(
  () => ({
    mermaidTheme: { value: "test-light" },
    renderMermaidSvg: vi.fn(async () => "<svg><text>Rendered diagram</text></svg>"),
    renderMermaidSvgLight: vi.fn(async () => "<svg><text>Printable diagram</text></svg>"),
    renderToString: vi.fn(() => '<span data-testid="rendered-math">Rendered equation</span>'),
  })
);

vi.mock("@/lib/mermaid-renderer", () => ({
  getMermaidThemeKey: () => mermaidTheme.value,
  subscribeMermaidTheme: () => () => undefined,
  renderMermaidSvg,
  renderMermaidSvgLight,
}));

vi.mock("katex", () => ({
  default: { renderToString },
}));

import { MarkdownBlockDocument } from "@/editor/markdown-block/markdown-block-document";
import { MarkdownBlockRow } from "@/editor/markdown-block/markdown-block-row";
import { wikiEmbedIdentity } from "@/editor/markdown-block/wiki-embed";
import type { KnowledgeSourceIndex } from "@/lib/knowledge-index";

/** Every required callback as a no-op, so a test only names the handlers it asserts on. */
function slashHandlers() {
  return {
    onActivate: vi.fn(),
    onChange: vi.fn(),
    onPaste: vi.fn(),
    onCompositionStart: vi.fn(),
    onCompositionEnd: vi.fn(),
    onSplit: vi.fn(),
    onMergeBackward: vi.fn(),
    onInsertAfter: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onSetTaskChecked: vi.fn(),
    onMove: vi.fn(),
    onSetKind: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
  } satisfies Partial<ComponentProps<typeof MarkdownBlockRow>>;
}

describe("MarkdownBlockRow semantic previews", () => {
  beforeEach(() => {
    mermaidTheme.value = "test-light";
    renderMermaidSvg.mockClear();
    renderMermaidSvgLight.mockClear();
  });

  it("exposes an inactive Block as one keyboard entry point before its hidden gutter controls", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown("Editable\n").getSnapshot().blocks;
    const onActivate = vi.fn();
    const props: ComponentProps<typeof MarkdownBlockRow> = {
      block,
      index: 0,
      count: 2,
      active: false,
      onActivate,
      onChange: vi.fn(),
      onPaste: vi.fn(),
      onCompositionStart: vi.fn(),
      onCompositionEnd: vi.fn(),
      onSplit: vi.fn(),
      onMergeBackward: vi.fn(),
      onInsertAfter: vi.fn(),
      onDuplicate: vi.fn(),
      onDelete: vi.fn(),
      onSetTaskChecked: vi.fn(),
      onMove: vi.fn(),
      onSetKind: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onDragStart: vi.fn(),
      onDragEnd: vi.fn(),
    };

    render(<MarkdownBlockRow {...props} />);

    const row = screen.getByRole("group", { name: "Text, block 1 of 2" });
    expect(row).toHaveAttribute("tabindex", "0");
    expect(row).toHaveAttribute("data-active", "false");
    expect(screen.getByRole("button", { name: "Add block" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("button", { name: "Block actions" })).toHaveAttribute("tabindex", "-1");
    expect(screen.queryByRole("combobox", { name: "Block type" })).not.toBeInTheDocument();

    fireEvent.keyDown(row, { key: "Enter" });
    expect(onActivate).toHaveBeenCalledWith(block.id);
  });

  it("announces the active Block and follows gutter-editor focus order", async () => {
    const user = userEvent.setup();
    const [block] = MarkdownBlockDocument.fromMarkdown("Editable\n").getSnapshot().blocks;

    render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={2}
        active
        onActivate={vi.fn()}
        onChange={vi.fn()}
        onPaste={vi.fn()}
        onCompositionStart={vi.fn()}
        onCompositionEnd={vi.fn()}
        onSplit={vi.fn()}
        onMergeBackward={vi.fn()}
        onInsertAfter={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onSetTaskChecked={vi.fn()}
        onMove={vi.fn()}
        onSetKind={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />
    );

    const row = screen.getByRole("group", { name: "Text, block 1 of 2" });
    const add = screen.getByRole("button", { name: "Add block" });
    const handle = screen.getByRole("button", { name: "Block actions" });
    const textarea = screen.getByRole("textbox", { name: "Markdown block" });
    expect(row).toHaveAttribute("aria-current", "true");
    expect(row).toHaveAttribute("data-active", "true");
    expect(textarea).toHaveFocus();
    expect(textarea).toHaveAttribute(
      "aria-keyshortcuts",
      "Alt+ArrowUp Alt+ArrowDown Meta+D Control+D Meta+Shift+Backspace Control+Shift+Backspace"
    );
    // Tab is a structural key inside the editor (indent / insert spaces), matching Notion and
    // Feishu, so it must not walk focus out to the gutter buttons.
    await user.tab();
    expect(textarea).toHaveFocus();
    await user.tab({ shift: true });
    expect(textarea).toHaveFocus();
    expect(add).toBeInTheDocument();

    // The keyboard route into the Block menu is Mod+/.
    await user.keyboard("{Meta>}/{/Meta}");
    expect(await screen.findByRole("menu", { name: "Block actions menu" })).toBeVisible();
    await user.keyboard("{Escape}");

    await user.click(handle);
    expect(await screen.findByRole("menu", { name: "Block actions menu" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Copy Markdown" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Move down" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  });

  it("edits supported inline Markdown semantically without exposing source delimiters", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown(
      "Keep **bold**, *clear*, and `local`.\n"
    ).getSnapshot().blocks;

    const { container } = render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={1}
        active
        onActivate={vi.fn()}
        onChange={vi.fn()}
        onPaste={vi.fn()}
        onCompositionStart={vi.fn()}
        onCompositionEnd={vi.fn()}
        onSplit={vi.fn()}
        onMergeBackward={vi.fn()}
        onInsertAfter={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onSetTaskChecked={vi.fn()}
        onMove={vi.fn()}
        onSetKind={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />
    );

    const editor = screen.getByRole("textbox", { name: "Markdown block" });
    expect(editor).toHaveTextContent("Keep bold, clear, and local.");
    expect(editor).not.toHaveTextContent("**");
    expect(editor.querySelector("strong")).toHaveTextContent("bold");
    expect(editor.querySelector("em")).toHaveTextContent("clear");
    expect(editor.querySelector("code")).toHaveTextContent("local");
    expect(container.querySelector("[data-native-semantic-editor]")).toBe(editor);
  });

  it("projects a Markdown Collection as a read-only navigable table", () => {
    const source =
      '```doxmind-collection\n{"version":1,"view":"table","filters":[{"property":"type","operator":"equals","value":"task"}],"columns":["status","due"],"sort":[{"property":"due","direction":"asc"}]}\n```\n';
    const [block] = MarkdownBlockDocument.fromMarkdown(source).getSnapshot().blocks;
    const onOpenPage = vi.fn();

    render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={1}
        active={false}
        onActivate={vi.fn()}
        onChange={vi.fn()}
        onPaste={vi.fn()}
        onCompositionStart={vi.fn()}
        onCompositionEnd={vi.fn()}
        onSplit={vi.fn()}
        onMergeBackward={vi.fn()}
        onInsertAfter={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onSetTaskChecked={vi.fn()}
        onMove={vi.fn()}
        onSetKind={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        collectionContext={{
          status: "ready",
          pages: [
            {
              id: "task-b",
              path: "Tasks/B.md",
              title: "Later task",
              aliases: [],
              properties: { type: "task", status: "todo", due: "2026-08-01" },
              markdown: "",
              revision: null,
            },
            {
              id: "task-a",
              path: "Tasks/A.md",
              title: "First task",
              aliases: [],
              properties: { type: "task", status: "doing", due: "2026-07-30" },
              markdown: "",
              revision: null,
            },
            {
              id: "note",
              path: "Notes/Idea.md",
              title: "Idea",
              aliases: [],
              properties: { type: "note" },
              markdown: "",
              revision: null,
            },
          ],
          onOpenPage,
        }}
      />
    );

    const table = screen.getByRole("table", { name: "Page collection table" });
    expect(table).toHaveTextContent("Page");
    expect(table).toHaveTextContent("First task");
    expect(table).toHaveTextContent("Later task");
    expect(table).not.toHaveTextContent("Idea");
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("First taskdoing2026-07-30");
    fireEvent.click(screen.getByRole("button", { name: "First task" }));
    expect(onOpenPage).toHaveBeenCalledWith("task-a");
    expect(screen.getByTestId("collection-block")).toHaveAttribute(
      "data-native-print-ready",
      "true"
    );
  });

  it("loads a standalone local image through a revocable Blob URL", async () => {
    const createObjectURL = vi.fn(() => "blob:doxmind-image");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const source = '![Pixel](../assets/pixel.png "Local pixel")\n';
    const [block] = MarkdownBlockDocument.fromMarkdown(source).getSnapshot().blocks;
    const readAsset = vi.fn(async () => ({
      path: "assets/pixel.png",
      mime: "image/png",
      base64: "iVBORw0KGgoAAAAA",
    }));

    const { unmount } = render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={1}
        active={false}
        onActivate={vi.fn()}
        onChange={vi.fn()}
        onPaste={vi.fn()}
        onCompositionStart={vi.fn()}
        onCompositionEnd={vi.fn()}
        onSplit={vi.fn()}
        onMergeBackward={vi.fn()}
        onInsertAfter={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onSetTaskChecked={vi.fn()}
        onMove={vi.fn()}
        onSetKind={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        imageContext={{ pagePath: "Notes/Page.md", readAsset }}
      />
    );

    const image = await screen.findByRole("img", { name: "Pixel" });
    expect(readAsset).toHaveBeenCalledWith("assets/pixel.png");
    expect(image).toHaveAttribute("src", "blob:doxmind-image");
    expect(image).toHaveAttribute("title", "Local pixel");
    expect(screen.getByTestId("local-image-block")).toHaveAttribute(
      "data-native-print-ready",
      "false"
    );
    fireEvent.load(image);
    expect(screen.getByTestId("local-image-block")).toHaveAttribute(
      "data-native-print-ready",
      "true"
    );
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:doxmind-image");
  });

  it("previews a portable toggle and keeps its canonical source editable", () => {
    const source =
      "<details open>\n<summary>Project details</summary>\n\nNested **Markdown**.\n\n</details>\n";
    const [block] = MarkdownBlockDocument.fromMarkdown(source).getSnapshot().blocks;
    const { rerender } = render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={1}
        active={false}
        onActivate={vi.fn()}
        onChange={vi.fn()}
        onPaste={vi.fn()}
        onCompositionStart={vi.fn()}
        onCompositionEnd={vi.fn()}
        onSplit={vi.fn()}
        onMergeBackward={vi.fn()}
        onInsertAfter={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onSetTaskChecked={vi.fn()}
        onMove={vi.fn()}
        onSetKind={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />
    );

    expect(screen.getByTestId("toggle-block")).toHaveTextContent("Project details");
    expect(screen.getByTestId("toggle-block")).toHaveTextContent("Nested Markdown.");

    rerender(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={1}
        active
        onActivate={vi.fn()}
        onChange={vi.fn()}
        onPaste={vi.fn()}
        onCompositionStart={vi.fn()}
        onCompositionEnd={vi.fn()}
        onSplit={vi.fn()}
        onMergeBackward={vi.fn()}
        onInsertAfter={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onSetTaskChecked={vi.fn()}
        onMove={vi.fn()}
        onSetKind={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />
    );
    expect(screen.getByRole("textbox", { name: "Markdown block" })).toHaveValue(source.trimEnd());
  });

  it("opens and executes the native slash menu without editor-framework state", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown("/tog").getSnapshot().blocks;
    const onRunSlashCommand = vi.fn();
    render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={1}
        active
        onActivate={vi.fn()}
        onChange={vi.fn()}
        onPaste={vi.fn()}
        onCompositionStart={vi.fn()}
        onCompositionEnd={vi.fn()}
        onSplit={vi.fn()}
        onMergeBackward={vi.fn()}
        onInsertAfter={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onSetTaskChecked={vi.fn()}
        onMove={vi.fn()}
        onSetKind={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        onRunSlashCommand={onRunSlashCommand}
      />
    );

    expect(screen.getByRole("listbox", { name: "Block commands" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Markdown block" }), { key: "Enter" });
    // The run is passed through so the executor replaces only `/tog`, never the whole Block.
    expect(onRunSlashCommand).toHaveBeenCalledWith(block.id, "toggle", {
      start: 0,
      end: 4,
      query: "tog",
    });
  });

  it.each([
    // Offsets are in the Block's *editor* text, which hides the list marker and the ATX hashes.
    ["a bullet list item", "- /tab", "table", { start: 0, end: 4, query: "tab" }],
    ["a heading", "# /quo", "quote", { start: 0, end: 4, query: "quo" }],
    ["mid-sentence text", "Next steps: /divi", "divider", { start: 12, end: 17, query: "divi" }],
    ["a pinyin query", "/biaoti", "heading-1", { start: 0, end: 7, query: "biaoti" }],
  ] as const)("opens the slash menu from %s", (_label, source, expectedId, expectedRun) => {
    const [block] = MarkdownBlockDocument.fromMarkdown(source).getSnapshot().blocks;
    const onRunSlashCommand = vi.fn();
    render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={1}
        active
        {...slashHandlers()}
        onRunSlashCommand={onRunSlashCommand}
      />
    );

    expect(screen.getByRole("listbox", { name: "Block commands" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Markdown block" }), { key: "Enter" });
    expect(onRunSlashCommand).toHaveBeenCalledWith(block.id, expectedId, expectedRun);
  });

  it.each(["and/or", "src/lib", "2026/07"])(
    "leaves %s typeable without opening the slash menu",
    (source) => {
      const [block] = MarkdownBlockDocument.fromMarkdown(source).getSnapshot().blocks;
      render(
        <MarkdownBlockRow
          block={block}
          index={0}
          count={1}
          active
          {...slashHandlers()}
          onRunSlashCommand={vi.fn()}
        />
      );

      expect(screen.queryByRole("listbox", { name: "Block commands" })).not.toBeInTheDocument();
    }
  );

  it("keeps Escape sticky for the rest of the slash run", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown("/tod").getSnapshot().blocks;
    const onRunSlashCommand = vi.fn();
    const onSplit = vi.fn();
    render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={1}
        active
        {...slashHandlers()}
        onSplit={onSplit}
        onRunSlashCommand={onRunSlashCommand}
      />
    );

    const textarea = screen.getByRole("textbox", { name: "Markdown block" });
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Block commands" })).not.toBeInTheDocument();
    // Enter now belongs to the Block again rather than re-running the dismissed command.
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onRunSlashCommand).not.toHaveBeenCalled();
    expect(onSplit).toHaveBeenCalled();
  });

  it("shows a no-results row and still swallows Enter", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown("/zzzz").getSnapshot().blocks;
    const onRunSlashCommand = vi.fn();
    const onSplit = vi.fn();
    render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={1}
        active
        {...slashHandlers()}
        onSplit={onSplit}
        onRunSlashCommand={onRunSlashCommand}
      />
    );

    expect(screen.getByText("No matching blocks")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Markdown block" }), { key: "Enter" });
    expect(onRunSlashCommand).not.toHaveBeenCalled();
    expect(onSplit).not.toHaveBeenCalled();
  });

  it("shows a placeholder on an empty Block and labels an empty heading", () => {
    const snapshot = MarkdownBlockDocument.fromMarkdown("\n\n## \n").getSnapshot();
    const [paragraph, heading] = snapshot.blocks;
    const { rerender } = render(
      <MarkdownBlockRow block={paragraph} index={0} count={2} active {...slashHandlers()} />
    );
    expect(screen.getByRole("textbox", { name: "Markdown block" })).toHaveAttribute(
      "placeholder",
      "Write, or press '/' for commands"
    );

    rerender(
      <MarkdownBlockRow block={heading} index={1} count={2} active={false} {...slashHandlers()} />
    );
    expect(screen.getByText("Heading 2")).toHaveAttribute("data-block-placeholder");
  });

  it("keeps a source-only Block's container while it is being edited", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown("```ts\nconst a = 1;\n```\n").getSnapshot()
      .blocks;
    const { container } = render(
      <MarkdownBlockRow block={block} index={0} count={1} active {...slashHandlers()} />
    );

    const surface = container.querySelector("[data-native-block-edit-surface]");
    expect(surface?.className).toContain("bg-muted");
    expect(surface?.className).toContain("p-4");
    expect(screen.getByRole("textbox", { name: "Markdown block" })).toHaveAttribute(
      "spellcheck",
      "false"
    );
  });

  it("keeps Tab inside the editor and routes indentation to the list command", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown("- item\n").getSnapshot().blocks;
    const onIndent = vi.fn();
    render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={1}
        active
        {...slashHandlers()}
        onIndent={onIndent}
      />
    );

    const textarea = screen.getByRole("textbox", { name: "Markdown block" });
    const event = createEvent.keyDown(textarea, { key: "Tab" });
    fireEvent(textarea, event);
    expect(event.defaultPrevented).toBe(true);
    expect(onIndent).toHaveBeenCalledWith(block.id, 1, { anchor: 4, head: 4 });
  });

  it("crosses the Block boundary on ArrowLeft at the start and ArrowRight at the end", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown("word\n").getSnapshot().blocks;
    const onNavigate = vi.fn(() => true);
    render(
      <MarkdownBlockRow
        block={block}
        index={1}
        count={3}
        active
        selection={{ anchor: 0, head: 0 }}
        {...slashHandlers()}
        onNavigate={onNavigate}
      />
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Markdown block",
    });
    fireEvent.keyDown(textarea, { key: "ArrowLeft" });
    expect(onNavigate).toHaveBeenCalledWith(block.id, -1);

    textarea.setSelectionRange(4, 4);
    fireEvent.keyDown(textarea, { key: "ArrowRight" });
    expect(onNavigate).toHaveBeenCalledWith(block.id, 1);
  });

  it("merges the next Block up on forward Delete at the end", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown("word\n").getSnapshot().blocks;
    const onMergeForward = vi.fn();
    render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={2}
        active
        {...slashHandlers()}
        onMergeForward={onMergeForward}
      />
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Markdown block",
    });
    textarea.setSelectionRange(4, 4);
    fireEvent.keyDown(textarea, { key: "Delete" });
    expect(onMergeForward).toHaveBeenCalledWith(block.id);
  });

  it("renders a fenced Block without its delimiters and exposes the language", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown("```ts\nconst a = 1;\n```\n").getSnapshot()
      .blocks;
    const onSetCodeLanguage = vi.fn();
    render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={1}
        active={false}
        {...slashHandlers()}
        onSetCodeLanguage={onSetCodeLanguage}
      />
    );

    const pre = screen.getByTestId("fenced-code-block");
    expect(pre).toHaveTextContent("const a = 1;");
    expect(pre.textContent).not.toContain("```");
    expect(screen.getByRole("button", { name: "Code language: ts" })).toBeInTheDocument();
  });

  it("commits a new code language without touching the payload", async () => {
    const user = userEvent.setup();
    const [block] = MarkdownBlockDocument.fromMarkdown("```ts\nconst a = 1;\n```\n").getSnapshot()
      .blocks;
    const onSetCodeLanguage = vi.fn();
    render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={1}
        active={false}
        {...slashHandlers()}
        onSetCodeLanguage={onSetCodeLanguage}
      />
    );

    await user.click(screen.getByRole("button", { name: "Code language: ts" }));
    const field = screen.getByRole("textbox", { name: "Code language" });
    await user.clear(field);
    await user.type(field, "python{Enter}");
    expect(onSetCodeLanguage).toHaveBeenCalledWith(block.id, "python");
  });

  it.each([
    ["b", {}, "bold"],
    ["i", {}, "italic"],
    ["e", {}, "code"],
    ["x", { shiftKey: true }, "strike"],
  ] as const)("applies %s as an inline format shortcut", (key, extra, format) => {
    const [block] = MarkdownBlockDocument.fromMarkdown("Read the docs\n").getSnapshot().blocks;
    const onApplyInlineFormat = vi.fn();
    render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={1}
        active
        {...slashHandlers()}
        onApplyInlineFormat={onApplyInlineFormat}
      />
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Markdown block" });
    textarea.setSelectionRange(9, 13);
    const event = createEvent.keyDown(textarea, { key, metaKey: true, ...extra });
    fireEvent(textarea, event);
    // Both flags matter: the window handler owns Mod+K and the app menu binds Mod+B, so one
    // keystroke must not also fire something else.
    expect(event.defaultPrevented).toBe(true);
    expect(onApplyInlineFormat).toHaveBeenCalledWith(block.id, 9, 13, format);
  });

  it("opens a link editor on Mod+K and commits a real destination", async () => {
    const user = userEvent.setup();
    const [block] = MarkdownBlockDocument.fromMarkdown("Read the docs\n").getSnapshot().blocks;
    const onEditLink = vi.fn();
    render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={1}
        active
        {...slashHandlers()}
        onEditLink={onEditLink}
      />
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Markdown block" });
    textarea.setSelectionRange(9, 13);
    fireEvent.keyDown(textarea, { key: "k", metaKey: true });

    const field = screen.getByRole("textbox", { name: "Link URL" });
    await user.type(field, "https://example.com{Enter}");
    expect(onEditLink).toHaveBeenCalledWith(block.id, 9, 13, "https://example.com");
    expect(screen.queryByRole("textbox", { name: "Link URL" })).not.toBeInTheDocument();
  });

  it("prefills the link editor from the link the selection sits inside", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown(
      "see [docs](https://old.example) now\n"
    ).getSnapshot().blocks;
    render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={1}
        active
        selection={{ anchor: 6, head: 6 }}
        {...slashHandlers()}
        onEditLink={vi.fn()}
      />
    );

    const editor = screen.getByRole("textbox", { name: "Markdown block" });
    // A collapsed caret inside the link is enough: Mod+K there edits its destination.
    fireEvent.keyDown(editor, { key: "k", metaKey: true });
    expect(screen.getByRole("textbox", { name: "Link URL" })).toHaveValue("https://old.example");
  });

  it.each([
    ["NOTE", "Note", "sky"],
    ["TIP", "Tip", "emerald"],
    ["WARNING", "Warning", "amber"],
    ["CAUTION", "Caution", "red"],
  ] as const)("renders a %s callout with its own icon and accent", (marker, label, hue) => {
    const [block] = MarkdownBlockDocument.fromMarkdown(
      `> [!${marker}]\n> Body line.\n`
    ).getSnapshot().blocks;
    const { container } = render(
      <MarkdownBlockRow block={block} index={0} count={1} active={false} {...slashHandlers()} />
    );

    const callout = screen.getByTestId("callout-block");
    expect(callout.className).toContain(hue);
    expect(callout).toHaveTextContent(label);
    // No shouting uppercase label, and the icon is a real graphic.
    expect(callout.querySelector("svg")).toBeInTheDocument();
    expect(container.textContent).not.toContain(marker);
  });

  it("keeps a callout's accent when it is activated", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown(
      "> [!WARNING] Careful\n> Body line.\n"
    ).getSnapshot().blocks;
    const { container, rerender } = render(
      <MarkdownBlockRow block={block} index={0} count={1} active={false} {...slashHandlers()} />
    );
    expect(screen.getByTestId("callout-block").className).toContain("amber");

    rerender(<MarkdownBlockRow block={block} index={0} count={1} active {...slashHandlers()} />);
    expect(container.querySelector("[data-native-block-edit-surface]")?.className).toContain(
      "amber"
    );
  });

  it("honours column alignment and puts the caret in the cell that was clicked", () => {
    const source = "| A | B |\n| :-- | --: |\n| a1 | b1 |\n";
    const [block] = MarkdownBlockDocument.fromMarkdown(source).getSnapshot().blocks;
    const onActivate = vi.fn();
    const { container } = render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={1}
        active={false}
        {...slashHandlers()}
        onActivate={onActivate}
      />
    );

    const cells = container.querySelectorAll<HTMLElement>("[data-table-cell]");
    expect(cells).toHaveLength(4);
    expect(cells[0].className).toContain("text-left");
    expect(cells[1].className).toContain("text-right");

    // `b1` starts at the offset the cell advertises, so a click lands the caret on the text.
    const b1 = cells[3];
    expect(source.slice(Number(b1.dataset.tableCell), Number(b1.dataset.tableCell) + 2)).toBe("b1");
    fireEvent.pointerDown(b1, { button: 0 });
    fireEvent.click(b1);
    expect(onActivate).toHaveBeenCalledWith(block.id, {
      anchor: Number(b1.dataset.tableCell),
      head: Number(b1.dataset.tableCell),
    });
  });

  it("moves between table cells with Tab and adds a row at the end", () => {
    const source = "| A | B |\n| --- | --- |\n| a1 | b1 |\n";
    const [block] = MarkdownBlockDocument.fromMarkdown(source).getSnapshot().blocks;
    const onSelectCellRange = vi.fn();
    const onPaste = vi.fn();
    render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={1}
        active
        selection={{ anchor: 2, head: 2 }}
        {...slashHandlers()}
        onPaste={onPaste}
        onSelectCellRange={onSelectCellRange}
      />
    );

    const editor = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Markdown block" });
    editor.setSelectionRange(2, 2);
    fireEvent.keyDown(editor, { key: "Tab" });
    // From "A" to "B".
    expect(onSelectCellRange).toHaveBeenCalledWith(block.id, 6, 7);

    // From the last cell, Tab appends a blank row with the same column count.
    editor.setSelectionRange(source.trimEnd().length - 3, source.trimEnd().length - 3);
    fireEvent.keyDown(editor, { key: "Tab" });
    expect(onPaste).toHaveBeenCalledWith(
      block.id,
      source.trimEnd().length,
      source.trimEnd().length,
      "\n|  |  |"
    );
  });

  it("keeps a semantic print preview beside the active source control", () => {
    const [block] =
      MarkdownBlockDocument.fromMarkdown("# Printable heading\n").getSnapshot().blocks;

    const { container } = render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={1}
        active
        onActivate={vi.fn()}
        onChange={vi.fn()}
        onPaste={vi.fn()}
        onCompositionStart={vi.fn()}
        onCompositionEnd={vi.fn()}
        onSplit={vi.fn()}
        onMergeBackward={vi.fn()}
        onInsertAfter={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onSetTaskChecked={vi.fn()}
        onMove={vi.fn()}
        onSetKind={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />
    );

    expect(container.querySelector("[data-native-block-editor]")).toHaveValue("Printable heading");
    expect(container.querySelector("[data-native-block-print-preview]")).toHaveTextContent(
      "Printable heading"
    );
    expect(container.querySelectorAll("[data-native-block-controls]")).toHaveLength(1);
  });

  it("opens a wiki-link target without turning the source block into edit mode", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown(
      "See [[Projects/Roadmap|the roadmap]].\n"
    ).getSnapshot().blocks;
    const onActivate = vi.fn();
    const onOpenWikiLink = vi.fn();

    render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={1}
        active={false}
        onActivate={onActivate}
        onChange={vi.fn()}
        onPaste={vi.fn()}
        onCompositionStart={vi.fn()}
        onCompositionEnd={vi.fn()}
        onSplit={vi.fn()}
        onMergeBackward={vi.fn()}
        onInsertAfter={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onSetTaskChecked={vi.fn()}
        onMove={vi.fn()}
        onSetKind={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        onOpenWikiLink={onOpenWikiLink}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Page: the roadmap" }));

    expect(onOpenWikiLink).toHaveBeenCalledWith("Projects/Roadmap");
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("renders recursive source-backed embeds read-only and opens their source Page", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown(
      "![[Roadmap#发布 🚀|Release section]]\n"
    ).getSnapshot().blocks;
    const onActivate = vi.fn();
    const onOpenPage = vi.fn();
    const index: KnowledgeSourceIndex = {
      pages: [
        { id: "today", path: "Notes/Today.md", title: "Today", aliases: [] },
        { id: "roadmap", path: "Notes/Roadmap.md", title: "Roadmap", aliases: [] },
        { id: "details", path: "Notes/Details.md", title: "Details", aliases: [] },
      ],
      sourcePages: [
        {
          id: "today",
          path: "Notes/Today.md",
          title: "Today",
          aliases: [],
          markdown: block.raw,
        },
        {
          id: "roadmap",
          path: "Notes/Roadmap.md",
          title: "Roadmap",
          aliases: [],
          markdown:
            "# Roadmap\n## 发布 🚀\nExact source.\n\n- [ ] Read-only task\n\n![[Details]]\n\n## Later\nOutside.\n",
        },
        {
          id: "details",
          path: "Notes/Details.md",
          title: "Details",
          aliases: [],
          markdown: "Nested detail.\n",
        },
      ],
      links: [],
      backlinks: [],
      unlinkedMentions: [],
    };

    const { container } = render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={1}
        active={false}
        onActivate={onActivate}
        onChange={vi.fn()}
        onPaste={vi.fn()}
        onCompositionStart={vi.fn()}
        onCompositionEnd={vi.fn()}
        onSplit={vi.fn()}
        onMergeBackward={vi.fn()}
        onInsertAfter={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onSetTaskChecked={vi.fn()}
        onMove={vi.fn()}
        onSetKind={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        wikiEmbedContext={{
          status: "ready",
          index,
          sourcePageId: "today",
          sourcePath: "Notes/Today.md",
          ancestry: [wikiEmbedIdentity("today", null)],
          depth: 1,
          onOpenPage,
        }}
      />
    );

    const [topEmbed] = screen.getAllByTestId("wiki-embed");
    expect(topEmbed).toHaveTextContent("Exact source.");
    expect(topEmbed).toHaveTextContent("Nested detail.");
    expect(topEmbed).not.toHaveTextContent("Outside.");
    expect(screen.getByRole("checkbox", { name: "Read-only task" })).toBeDisabled();
    expect(container.querySelectorAll("[data-wiki-embed]")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Open embedded Page: Release section" }));
    expect(onOpenPage).toHaveBeenCalledWith("roadmap");
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("keeps embed source editable and prints a safe cycle placeholder", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown("![[Today]]\n").getSnapshot().blocks;
    const index: KnowledgeSourceIndex = {
      pages: [{ id: "today", path: "Today.md", title: "Today", aliases: [] }],
      sourcePages: [
        {
          id: "today",
          path: "Today.md",
          title: "Today",
          aliases: [],
          markdown: block.raw,
        },
      ],
      links: [],
      backlinks: [],
      unlinkedMentions: [],
    };
    const { container } = render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={1}
        active
        onActivate={vi.fn()}
        onChange={vi.fn()}
        onPaste={vi.fn()}
        onCompositionStart={vi.fn()}
        onCompositionEnd={vi.fn()}
        onSplit={vi.fn()}
        onMergeBackward={vi.fn()}
        onInsertAfter={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onSetTaskChecked={vi.fn()}
        onMove={vi.fn()}
        onSetKind={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        wikiEmbedContext={{
          status: "ready",
          index,
          sourcePageId: "today",
          sourcePath: "Today.md",
          ancestry: [wikiEmbedIdentity("today", null)],
          depth: 1,
          onOpenPage: vi.fn(),
        }}
      />
    );

    expect(screen.getByRole("textbox", { name: "Markdown block" })).toHaveValue("![[Today]]");
    expect(container.querySelector("[data-native-block-print-preview]")).toHaveTextContent(
      "Embed cycle detected"
    );
  });

  it("previews source-backed thematic breaks, tables, math, mermaid, and callouts semantically", async () => {
    const markdown =
      "***\n\n" +
      "| Name | Value |\n| --- | ---: |\n| alpha | **one** |\n\n" +
      "$$\nx^2 + y^2\n$$\n\n" +
      "```mermaid\ngraph TD\nA --> B\n```\n\n" +
      "> [!WARNING] Careful\n> Keep the **source**.\n";
    const blocks = MarkdownBlockDocument.fromMarkdown(markdown).getSnapshot().blocks;

    render(
      <>
        {blocks.map((block, index) => (
          <MarkdownBlockRow
            key={block.id}
            block={block}
            index={index}
            count={blocks.length}
            active={false}
            onActivate={vi.fn()}
            onChange={vi.fn()}
            onPaste={vi.fn()}
            onCompositionStart={vi.fn()}
            onCompositionEnd={vi.fn()}
            onSplit={vi.fn()}
            onMergeBackward={vi.fn()}
            onInsertAfter={vi.fn()}
            onDuplicate={vi.fn()}
            onDelete={vi.fn()}
            onSetTaskChecked={vi.fn()}
            onMove={vi.fn()}
            onSetKind={vi.fn()}
            onUndo={vi.fn()}
            onRedo={vi.fn()}
            onDragStart={vi.fn()}
            onDragEnd={vi.fn()}
          />
        ))}
      </>
    );

    expect(screen.getByTestId("thematic-break-block")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Markdown table" })).toHaveTextContent("alpha");
    expect(screen.getByTestId("block-math-block")).toHaveTextContent("x^2 + y^2");
    expect(screen.getByTestId("mermaid-block")).toHaveTextContent("graph TD");
    expect(screen.getByTestId("callout-block")).toHaveTextContent("Careful");
    expect(screen.getByTestId("callout-block")).toHaveTextContent("Keep the source.");
    expect(await screen.findByTestId("rendered-math")).toHaveTextContent("Rendered equation");
    expect(await screen.findByRole("img", { name: "Mermaid diagram" })).toHaveAttribute(
      "src",
      expect.stringContaining("%3Csvg%3E")
    );
    expect(renderToString).toHaveBeenCalledWith(
      "x^2 + y^2",
      expect.objectContaining({ displayMode: true, throwOnError: false, trust: false })
    );
    expect(renderMermaidSvg).toHaveBeenCalledWith("graph TD\nA --> B");
  });

  it("keeps a rejected Mermaid preview as editable raw source", async () => {
    renderMermaidSvg.mockRejectedValueOnce(new Error("Mermaid preview cannot load a remote URL"));
    const markdown =
      '```mermaid\nflowchart LR\nA@{ img: "https://example.com/private.png" }\n```\n';
    const [block] = MarkdownBlockDocument.fromMarkdown(markdown).getSnapshot().blocks;

    render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={1}
        active
        onActivate={vi.fn()}
        onChange={vi.fn()}
        onPaste={vi.fn()}
        onCompositionStart={vi.fn()}
        onCompositionEnd={vi.fn()}
        onSplit={vi.fn()}
        onMergeBackward={vi.fn()}
        onInsertAfter={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onSetTaskChecked={vi.fn()}
        onMove={vi.fn()}
        onSetKind={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(renderMermaidSvg).toHaveBeenCalledWith(expect.stringContaining("https://"))
    );
    // The editing surface shows the diagram payload; the ``` delimiters are projected out.
    expect(screen.getByRole("textbox", { name: "Markdown block" })).toHaveValue(
      'flowchart LR\nA@{ img: "https://example.com/private.png" }'
    );
    expect(screen.queryByRole("img", { name: "Mermaid diagram" })).not.toBeInTheDocument();
    expect(screen.getByTestId("mermaid-block")).toHaveTextContent(
      "https://example.com/private.png"
    );
  });

  it("prepares a separate light Mermaid image for local PDF export in dark mode", async () => {
    mermaidTheme.value = "test-dark";
    const [block] = MarkdownBlockDocument.fromMarkdown(
      "```mermaid\ngraph TD\nDark --> Print\n```\n"
    ).getSnapshot().blocks;

    const { container } = render(
      <MarkdownBlockRow
        block={block}
        index={0}
        count={1}
        active={false}
        onActivate={vi.fn()}
        onChange={vi.fn()}
        onPaste={vi.fn()}
        onCompositionStart={vi.fn()}
        onCompositionEnd={vi.fn()}
        onSplit={vi.fn()}
        onMergeBackward={vi.fn()}
        onInsertAfter={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onSetTaskChecked={vi.fn()}
        onMove={vi.fn()}
        onSetKind={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(container.querySelector("[data-mermaid-print-ready]")).toHaveAttribute(
        "data-mermaid-print-ready",
        "true"
      )
    );
    const screenImage = container.querySelector<HTMLImageElement>(
      "[data-mermaid-screen-preview] img"
    );
    const printImage = container.querySelector<HTMLImageElement>(
      "[data-mermaid-print-preview] img"
    );
    expect(screenImage?.src).toContain("Rendered%20diagram");
    expect(printImage?.src).toContain("Printable%20diagram");
    expect(renderMermaidSvgLight).toHaveBeenCalledWith("graph TD\nDark --> Print");
  });
});
