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
import {
  firstLineBox,
  MarkdownBlockRow,
  MarkdownWikiLinkContext,
} from "@/editor/markdown-block/markdown-block-row";
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

/**
 * Type into a contenteditable the way the semantic editor observes it: the browser mutates the DOM
 * and then reports one `input`. Setting a `value` would do nothing — the element has no value.
 */
function typeInto(editor: HTMLElement, text: string) {
  const walker = editor.ownerDocument.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let target = walker.nextNode() as Text | null;
  if (!target) {
    target = editor.ownerDocument.createTextNode("");
    editor.append(target);
  }
  // Replace the whole run rather than appending: the editor reads the DOM back, so a stray second
  // text node reads as the user having typed the new text after the old.
  target.nodeValue = text;
  for (let extra = walker.nextNode(); extra; extra = walker.nextNode()) extra.nodeValue = "";
  const selection = editor.ownerDocument.defaultView?.getSelection();
  const range = editor.ownerDocument.createRange();
  range.setStart(target, text.length);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
  fireEvent.input(editor, { inputType: "insertText" });
}

/**
 * Put a collapsed caret `offset` characters into a contenteditable's own text.
 *
 * The row reads the caret straight off the DOM for the surfaces that hand every arrow back, so a
 * test of that has to place a real Range rather than hand the editor a selection prop.
 */
function placeCaret(editor: HTMLElement, offset: number) {
  const walker = editor.ownerDocument.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  let remaining = offset;
  while (node && remaining > (node.nodeValue?.length ?? 0)) {
    remaining -= node.nodeValue?.length ?? 0;
    const next = walker.nextNode() as Text | null;
    if (!next) break;
    node = next;
  }
  const range = editor.ownerDocument.createRange();
  if (node) range.setStart(node, Math.min(remaining, node.nodeValue?.length ?? 0));
  else range.setStart(editor, 0);
  range.collapse(true);
  const selection = editor.ownerDocument.defaultView?.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("MarkdownBlockRow semantic previews", () => {
  beforeEach(() => {
    mermaidTheme.value = "test-light";
    renderMermaidSvg.mockClear();
    renderMermaidSvgLight.mockClear();
  });

  const renderInactive = (markdown: string) => {
    const [block] = MarkdownBlockDocument.fromMarkdown(markdown).getSnapshot().blocks;
    render(
      <MarkdownBlockRow
        block={block}
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
    return document.querySelector<HTMLElement>("[data-native-block-row]")!;
  };

  it("renders a fenced code block nested in a list item, instead of dropping it", () => {
    // The bytes were always on disk and never on screen: only the first of the item's top-level
    // tokens was rendered, so the fence survived every edit invisibly.
    const row = renderInactive("- item text\n\n  ```js\n  const a = 1;\n  ```\n");

    expect(row.textContent).toContain("item text");
    expect(row.textContent).toContain("const a = 1;");
    expect(row.querySelector("pre code")).not.toBeNull();
  });

  it("renders a list item's second paragraph", () => {
    const row = renderInactive("- one\n\n  second para\n");

    expect(row.textContent).toContain("one");
    expect(row.textContent).toContain("second para");
  });

  it("renders a plain list item exactly as before, with no block wrapper", () => {
    const row = renderInactive("- item\n  continued\n");

    // Continuation indentation is payload, not syntax, so it stays — unchanged by this fix.
    expect(row.textContent).toBe("•item\n  continued");
    expect(row.querySelector("pre")).toBeNull();
  });

  it("leaves every inline sharp as ordinary prose", () => {
    const row = renderInactive("see #project/web and C# and #1984 and src/lib#anchor\n");

    expect(row.querySelector("[data-markdown-inline-tag]")).toBeNull();
    expect(row.textContent).toBe("see #project/web and C# and #1984 and src/lib#anchor");
  });

  it("renders ==highlight== as a mark, not as its own punctuation", () => {
    const row = renderInactive("say ==this== loudly\n");

    expect(row.querySelector("mark")?.textContent).toBe("this");
    expect(row.textContent).toBe("say this loudly");
  });

  it("never renders the contents of a %%comment%%", () => {
    // The author marked this text as not part of the document. Showing it anyway is the failure
    // this case exists to prevent.
    const row = renderInactive("public %%private note%% public\n");

    expect(row.textContent).not.toContain("private note");
    expect(row.textContent).toBe("public  public");
  });

  it("leaves a lone = or % as ordinary prose", () => {
    expect(renderInactive("50% of x, a = b\n").textContent).toBe("50% of x, a = b");
  });

  it("exposes an inactive Block as one keyboard entry point before its hidden gutter controls", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown("Editable\n").getSnapshot().blocks;
    const onActivate = vi.fn();
    const props: ComponentProps<typeof MarkdownBlockRow> = {
      block,
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

    const row = document.querySelector<HTMLElement>("[data-native-block-row]")!;
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

    const row = document.querySelector<HTMLElement>("[data-native-block-row]")!;
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
    // Activating a toggle no longer replaces it with `<details>` and `<summary>` tags. The rendered
    // disclosure stays, its title and body are edited in place, and the scaffolding is never shown.
    const toggle = screen.getByTestId("toggle-block");
    expect(toggle).toHaveTextContent("Project details");
    expect(toggle.textContent).not.toContain("<summary>");
    expect(toggle.textContent).not.toContain("<details>");
    expect(screen.getByRole("textbox", { name: "Toggle summary" })).toBeInTheDocument();
  });

  const wikiPages = [
    { id: "a", name: "Roadmap", folder: "Projects", path: "Projects/Roadmap", aliases: [] },
    { id: "b", name: "Roadmap", folder: "Personal", path: "Personal/Roadmap", aliases: [] },
    { id: "c", name: "Retro notes", folder: "", path: "Retro notes", aliases: [] },
  ];

  const renderWikiRow = (markdown: string, onInsertWikiLink = vi.fn()) => {
    const [block] = MarkdownBlockDocument.fromMarkdown(markdown).getSnapshot().blocks;
    render(
      <MarkdownBlockRow
        block={block}
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
        onRunSlashCommand={vi.fn()}
        onSuggestWikiLinks={() => wikiPages}
        onInsertWikiLink={onInsertWikiLink}
      />
    );
    return { block, onInsertWikiLink };
  };

  it("suggests Pages while a [[ run is open, and inserts the one that is chosen", () => {
    const { block, onInsertWikiLink } = renderWikiRow("See [[Retro");

    expect(screen.getByRole("listbox", { name: "Wiki link targets" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Markdown block" }), { key: "Enter" });

    // Only the `[[Retro` the user typed is replaced — "See " stays exactly where it was.
    expect(onInsertWikiLink).toHaveBeenCalledWith(block.id, "[[Retro notes]]", {
      start: 4,
      end: 11,
      query: "Retro",
    });
  });

  it("writes the path when a bare name would be ambiguous", () => {
    const { block, onInsertWikiLink } = renderWikiRow("[[Road");

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Markdown block" }), { key: "Enter" });

    expect(onInsertWikiLink).toHaveBeenCalledWith(
      block.id,
      "[[Projects/Roadmap]]",
      expect.objectContaining({ query: "Road" })
    );
  });

  it("closes on a query no Page matches, so Enter still splits the Block", () => {
    const onSplit = vi.fn();
    const [block] = MarkdownBlockDocument.fromMarkdown("[[zzzz").getSnapshot().blocks;
    render(
      <MarkdownBlockRow
        block={block}
        active
        onActivate={vi.fn()}
        onChange={vi.fn()}
        onPaste={vi.fn()}
        onCompositionStart={vi.fn()}
        onCompositionEnd={vi.fn()}
        onSplit={onSplit}
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
        onSuggestWikiLinks={() => wikiPages}
        onInsertWikiLink={vi.fn()}
      />
    );

    expect(screen.queryByRole("listbox", { name: "Wiki link targets" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Markdown block" }), { key: "Enter" });
    expect(onSplit).toHaveBeenCalled();
  });

  it("does not suggest inside a Wiki Link the user already closed", () => {
    renderWikiRow("[[Retro notes]] and more");

    expect(screen.queryByRole("listbox", { name: "Wiki link targets" })).toBeNull();
  });

  it("keeps the slash menu out of a [[ run", () => {
    renderWikiRow("[[Retro/tog");

    expect(screen.queryByRole("listbox", { name: "Block commands" })).toBeNull();
  });

  it("opens and executes the native slash menu without editor-framework state", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown("/tog").getSnapshot().blocks;
    const onRunSlashCommand = vi.fn();
    render(
      <MarkdownBlockRow
        block={block}
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
        active
        {...slashHandlers()}
        onRunSlashCommand={onRunSlashCommand}
      />
    );

    expect(screen.getByRole("listbox", { name: "Block commands" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Markdown block" }), { key: "Enter" });
    expect(onRunSlashCommand).toHaveBeenCalledWith(block.id, expectedId, expectedRun);
  });

  it("points the focused editor at the open slash menu and tracks the highlighted command", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown("/\n").getSnapshot().blocks;
    render(
      <MarkdownBlockRow block={block} active {...slashHandlers()} onRunSlashCommand={vi.fn()} />
    );

    // jsdom implements no scrolling, and moving the highlight scrolls it into view.
    Element.prototype.scrollIntoView = vi.fn();
    const editor = screen.getByRole("textbox", { name: "Markdown block" });
    const listbox = screen.getByRole("listbox", { name: "Block commands" });
    const options = screen.getAllByRole("option");
    expect(editor).toHaveAttribute("aria-haspopup", "listbox");
    expect(editor).toHaveAttribute("aria-controls", listbox.id);
    expect(editor).toHaveAttribute("aria-activedescendant", options[0].id);

    // Focus never leaves the editor, so the moving highlight is only announceable through here.
    fireEvent.keyDown(editor, { key: "ArrowDown" });
    expect(editor).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[1].id);
  });

  it.each(["and/or", "src/lib", "2026/07"])(
    "leaves %s typeable without opening the slash menu",
    (source) => {
      const [block] = MarkdownBlockDocument.fromMarkdown(source).getSnapshot().blocks;
      render(
        <MarkdownBlockRow block={block} active {...slashHandlers()} onRunSlashCommand={vi.fn()} />
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
    const { rerender } = render(<MarkdownBlockRow block={paragraph} active {...slashHandlers()} />);
    expect(screen.getByRole("textbox", { name: "Markdown block" })).toHaveAttribute(
      "placeholder",
      "Write, or press '/' for commands"
    );

    rerender(<MarkdownBlockRow block={heading} active={false} {...slashHandlers()} />);
    expect(screen.getByText("Heading 2")).toHaveAttribute("data-block-placeholder");
  });

  it("keeps a source-only Block's container while it is being edited", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown("```ts\nconst a = 1;\n```\n").getSnapshot()
      .blocks;
    const { container } = render(<MarkdownBlockRow block={block} active {...slashHandlers()} />);

    // The code Block keeps its own rendered box while it is edited rather than being replaced by a
    // bare field: the highlighted `<pre>` is still mounted, and the caret is in a surface laid over
    // it. Activation used to swap the whole thing for a plain textarea, which dropped every colour.
    const pre = screen.getByTestId("fenced-code-block");
    expect(pre).toBeInTheDocument();
    expect(pre.className).toContain("bg-muted");
    expect(pre.textContent).not.toContain("```");
    expect(container.querySelector("[data-code-editing-surface]")).toHaveAttribute(
      "spellcheck",
      "false"
    );
  });

  it("keeps Tab inside the editor and routes indentation to the list command", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown("- item\n").getSnapshot().blocks;
    const onIndent = vi.fn();
    render(<MarkdownBlockRow block={block} active {...slashHandlers()} onIndent={onIndent} />);

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

  it("leaves a fenced Block on an arrow its own surface has already handed back", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown("```js\nlet a = 1;\n```\n").getSnapshot()
      .blocks;
    const onNavigate = vi.fn(() => true);
    const { container } = render(
      <MarkdownBlockRow block={block} active {...slashHandlers()} onNavigate={onNavigate} />
    );

    // The code Block only hands an arrow back once the caret is at the payload's own edge, so by
    // the time the Block sees one it already means "leave". Dropping it made the Block a keyboard
    // trap: neither the Block above nor the one below could be reached without the mouse.
    //
    // The third argument is the column a vertical crossing is leaving from. It is `undefined` in
    // every one of these because jsdom lays nothing out to measure — that the browser passes a real
    // one is asserted a few tests below, against a stubbed caret rect.
    const surface = container.querySelector<HTMLTextAreaElement>("[data-code-editing-surface]")!;
    surface.setSelectionRange(0, 0);
    fireEvent.keyDown(surface, { key: "ArrowUp" });
    expect(onNavigate).toHaveBeenCalledWith(block.id, -1, undefined);

    surface.setSelectionRange("let a = 1;".length, "let a = 1;".length);
    fireEvent.keyDown(surface, { key: "ArrowDown" });
    expect(onNavigate).toHaveBeenCalledWith(block.id, 1, undefined);
  });

  it("keeps an arrow inside a fenced Block when the caret is not at the payload edge", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown(
      "```js\nlet a = 1;\nlet b = 2;\n```\n"
    ).getSnapshot().blocks;
    const onNavigate = vi.fn(() => true);
    const { container } = render(
      <MarkdownBlockRow block={block} active {...slashHandlers()} onNavigate={onNavigate} />
    );

    const surface = container.querySelector<HTMLTextAreaElement>("[data-code-editing-surface]")!;
    surface.setSelectionRange(0, 0);
    fireEvent.keyDown(surface, { key: "ArrowDown" });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("leaves a figure Block only when the caret is at the edge of its source", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown("$$\nx^2\ny^2\n$$\n").getSnapshot().blocks;
    const onNavigate = vi.fn(() => true);
    render(<MarkdownBlockRow block={block} active {...slashHandlers()} onNavigate={onNavigate} />);

    // The field hands every key but Enter back, so unlike a code Block it makes no edge decision of
    // its own. Without one made here the equation was a keyboard trap; with one made loosely the
    // caret could not have reached the second line of it.
    const field = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "LaTeX source" });
    field.setSelectionRange(0, 0);
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(onNavigate).not.toHaveBeenCalled();

    fireEvent.keyDown(field, { key: "ArrowUp" });
    expect(onNavigate).toHaveBeenCalledWith(block.id, -1, undefined);

    field.setSelectionRange(field.value.length, field.value.length);
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(onNavigate).toHaveBeenCalledWith(block.id, 1, undefined);
  });

  it("leaves a callout downward from the last line of its body but not from the first", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown(
      "> [!WARNING] Careful\n> Line one.\n> Line two.\n"
    ).getSnapshot().blocks;
    const onNavigate = vi.fn(() => true);
    render(<MarkdownBlockRow block={block} active {...slashHandlers()} onNavigate={onNavigate} />);

    const body = screen.getByRole("textbox", { name: "Callout body" });
    placeCaret(body, 0);
    fireEvent.keyDown(body, { key: "ArrowDown" });
    expect(onNavigate).not.toHaveBeenCalled();

    placeCaret(body, "Line one.\nLine two.".length);
    fireEvent.keyDown(body, { key: "ArrowDown" });
    expect(onNavigate).toHaveBeenCalledWith(block.id, 1, undefined);
  });

  it("leaves a bodyless callout on the arrow its heading hands back", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown("> [!NOTE] Careful\n").getSnapshot().blocks;
    const onNavigate = vi.fn(() => true);
    render(<MarkdownBlockRow block={block} active {...slashHandlers()} onNavigate={onNavigate} />);

    // A heading is one line, so there is no line below the caret to move to and Down means "leave",
    // wherever in the title it was pressed. Left still means "leave" only at the very start.
    const heading = screen.getByRole("textbox", { name: "Callout title" });
    placeCaret(heading, 3);
    fireEvent.keyDown(heading, { key: "ArrowLeft" });
    expect(onNavigate).not.toHaveBeenCalled();

    fireEvent.keyDown(heading, { key: "ArrowDown" });
    expect(onNavigate).toHaveBeenCalledWith(block.id, 1, undefined);

    placeCaret(heading, 0);
    fireEvent.keyDown(heading, { key: "ArrowLeft" });
    expect(onNavigate).toHaveBeenCalledWith(block.id, -1, undefined);
  });

  it("carries the column out of an in-place surface, so a crossing keeps its place in the line", () => {
    // The whole in-place family handed its arrows back with no column at all, so the runtime had
    // nothing to aim at and fell back to the destination's source edge: every ArrowDown out of a
    // code Block, a callout, a toggle or a table dropped the caret at offset 0 of the Block below,
    // however far right it had been. The text surface has passed its column for as long as it has
    // had one; this is the same measurement, taken off the surface the key came from.
    const [block] = MarkdownBlockDocument.fromMarkdown(
      "> [!WARNING] Careful\n> Line one.\n"
    ).getSnapshot().blocks;
    const onNavigate = vi.fn(() => true);
    render(<MarkdownBlockRow block={block} active {...slashHandlers()} onNavigate={onNavigate} />);

    const body = screen.getByRole("textbox", { name: "Callout body" });
    placeCaret(body, "Line one.".length);
    // jsdom lays nothing out, so both boxes the measurement reads are stubbed; what is under test
    // is that the column reaches the runtime at all, not what a browser would measure it to be.
    const originalRects = Range.prototype.getClientRects;
    Range.prototype.getClientRects = function getClientRects() {
      return [new DOMRect(212, 40, 0, 20)] as unknown as DOMRectList;
    };
    body.getBoundingClientRect = () => new DOMRect(80, 30, 400, 40);
    try {
      fireEvent.keyDown(body, { key: "ArrowDown" });
    } finally {
      Range.prototype.getClientRects = originalRects;
    }

    // Offset 0, not the caret's offset in the region: a region's offsets are not offsets in the
    // Block's source, and the runtime uses this one only to tell a walk it is still steering from
    // one it has to re-measure.
    expect(onNavigate).toHaveBeenCalledWith(block.id, 1, { x: 212, offset: 0 });
  });

  it("leaves an in-place Block sideways on its source edge, with no column at all", () => {
    // Left and Right mean "the edge of the next Block" by definition, so they must keep passing
    // nothing even where a column could be measured — a Right that carried one would land the caret
    // in the middle of the line below instead of in front of it.
    const [block] = MarkdownBlockDocument.fromMarkdown("> [!NOTE] Careful\n").getSnapshot().blocks;
    const onNavigate = vi.fn(() => true);
    render(<MarkdownBlockRow block={block} active {...slashHandlers()} onNavigate={onNavigate} />);

    const heading = screen.getByRole("textbox", { name: "Callout title" });
    placeCaret(heading, 0);
    const originalRects = Range.prototype.getClientRects;
    Range.prototype.getClientRects = function getClientRects() {
      return [new DOMRect(212, 40, 0, 20)] as unknown as DOMRectList;
    };
    heading.getBoundingClientRect = () => new DOMRect(80, 30, 400, 40);
    try {
      fireEvent.keyDown(heading, { key: "ArrowLeft" });
    } finally {
      Range.prototype.getClientRects = originalRects;
    }

    expect(onNavigate).toHaveBeenCalledWith(block.id, -1, undefined);
  });

  it("merges the next Block up on forward Delete at the end", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown("word\n").getSnapshot().blocks;
    const onMergeForward = vi.fn();
    render(
      <MarkdownBlockRow block={block} active {...slashHandlers()} onMergeForward={onMergeForward} />
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
    render(<MarkdownBlockRow block={block} active {...slashHandlers()} onEditLink={onEditLink} />);

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
      <MarkdownBlockRow block={block} active={false} {...slashHandlers()} />
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
      <MarkdownBlockRow block={block} active={false} {...slashHandlers()} />
    );
    expect(screen.getByTestId("callout-block").className).toContain("amber");

    rerender(<MarkdownBlockRow block={block} active {...slashHandlers()} />);
    // The rendered callout is what stays on screen now, so the accent lives on it rather than on a
    // separate editing surface that replaced it.
    expect(screen.getByTestId("callout-block").className).toContain("amber");
  });

  it("honours column alignment and puts the caret in the cell that was clicked", () => {
    const source = "| A | B |\n| :-- | --: |\n| a1 | b1 |\n";
    const [block] = MarkdownBlockDocument.fromMarkdown(source).getSnapshot().blocks;
    const onActivate = vi.fn();
    const { container } = render(
      <MarkdownBlockRow block={block} active={false} {...slashHandlers()} onActivate={onActivate} />
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

  it("pastes into a table cell once, at the caret, escaping every pipe", () => {
    const source = "| abc | B |\n| --- | --- |\n| a1 | b1 |\n";
    const [block] = MarkdownBlockDocument.fromMarkdown(source).getSnapshot().blocks;
    const onChange = vi.fn();
    render(<MarkdownBlockRow block={block} active {...slashHandlers()} onChange={onChange} />);
    const cell = screen.getByRole("textbox", { name: "Table cell" });

    // Caret at the very start of the cell, which is where the old handler ignored it and appended.
    const range = document.createRange();
    const text = cell.firstChild ?? cell;
    range.setStart(text, 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.paste(cell, {
      clipboardData: {
        files: [],
        items: [],
        getData: (type: string) => (type === "text/plain" ? "X ||" : ""),
      },
    });

    // One commit, not two: the handler returns `true`, so the editor does not also run its own
    // insert. Two commits gave one paste two undo steps, and the intermediate state showed text that
    // had never been on screen.
    expect(onChange).toHaveBeenCalledTimes(1);
    // Inserted at the caret, and both pipes escaped — the old pattern consumed the character before
    // each pipe, so a run kept every other one and the survivor ended the cell.
    expect(onChange).toHaveBeenCalledWith(
      block.id,
      "| X \\|\\|abc | B |\n| --- | --- |\n| a1 | b1 |"
    );
  });

  it("edits a table cell in place and moves between cells with Tab", () => {
    const source = "| A | B |\n| --- | --- |\n| a1 | b1 |\n";
    const [block] = MarkdownBlockDocument.fromMarkdown(source).getSnapshot().blocks;
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownBlockRow block={block} active {...slashHandlers()} onChange={onChange} />
    );

    // The grid is the editing surface. Activation no longer replaces it with the raw pipe source, so
    // the table element is still here and the caret lives in one cell of it.
    expect(container.querySelector("table")).toBeInTheDocument();
    const cell = screen.getByRole("textbox", { name: "Table cell" });
    // The cell holds its text, not the padding around it: holding the padding made it visible the
    // moment a cell was clicked, and the line jumped sideways.
    expect(cell).toHaveTextContent("A");

    typeInto(cell, "Alpha");
    expect(onChange).toHaveBeenCalledWith(block.id, "| Alpha | B |\n| --- | --- |\n| a1 | b1 |");

    fireEvent.keyDown(cell, { key: "Tab" });
    expect(screen.getByRole("textbox", { name: "Table cell" })).toHaveTextContent("B");
  });

  it("keeps a pipe typed into a cell inside that cell", () => {
    const source = "| A | B |\n| --- | --- |\n| a1 | b1 |\n";
    const [block] = MarkdownBlockDocument.fromMarkdown(source).getSnapshot().blocks;
    const onChange = vi.fn();
    render(<MarkdownBlockRow block={block} active {...slashHandlers()} onChange={onChange} />);

    // Unescaped, this would end the cell and give one row a column the others do not have.
    typeInto(screen.getByRole("textbox", { name: "Table cell" }), "a|b");
    expect(onChange).toHaveBeenCalledWith(block.id, "| a\\|b | B |\n| --- | --- |\n| a1 | b1 |");
  });

  it("renders a table cell's inline Markdown instead of its delimiters", () => {
    const source = "| **bold** | B |\n| --- | --- |\n| a1 | b1 |\n";
    const [block] = MarkdownBlockDocument.fromMarkdown(source).getSnapshot().blocks;
    render(<MarkdownBlockRow block={block} active {...slashHandlers()} />);

    // The cell being edited shows what the cell means, not the syntax that spells it — the same
    // promise every prose Block makes, which a raw payload field could not keep.
    const cell = screen.getByRole("textbox", { name: "Table cell" });
    expect(cell).not.toHaveTextContent("**");
    expect(cell.querySelector("strong")).toHaveTextContent("bold");
  });

  it("keeps a semantic print preview beside the active source control", () => {
    const [block] =
      MarkdownBlockDocument.fromMarkdown("# Printable heading\n").getSnapshot().blocks;

    const { container } = render(
      <MarkdownBlockRow
        block={block}
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
        {blocks.map((block) => (
          <MarkdownBlockRow
            key={block.id}
            block={block}
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
    // A diagram the renderer refuses still shows what the user wrote, in a source field beside the
    // Block rather than by replacing it — the ``` delimiters stay out of sight either way.
    const surface = screen.getByRole("textbox", { name: "Mermaid source" });
    expect(surface).toHaveValue('flowchart LR\nA@{ img: "https://example.com/private.png" }');
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

describe("MarkdownBlockRow wiki links", () => {
  it("draws a link with no Page behind it apart and opens both through the context", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown(
      "See [[Real]] and [[Ghost]].\n"
    ).getSnapshot().blocks;
    const open = vi.fn();

    render(
      <MarkdownWikiLinkContext.Provider value={{ open, resolves: (target) => target === "Real" }}>
        <MarkdownBlockRow block={block} active={false} {...slashHandlers()} />
      </MarkdownWikiLinkContext.Provider>
    );

    const resolved = screen.getByRole("button", { name: "Open Page: Real" });
    const unresolved = screen.getByRole("button", { name: "Unresolved Page link: Ghost" });
    expect(resolved).not.toHaveAttribute("data-wiki-link-unresolved");
    expect(unresolved).toHaveAttribute("data-wiki-link-unresolved", "true");
    expect(unresolved.className).not.toEqual(resolved.className);

    fireEvent.click(unresolved);
    expect(open).toHaveBeenCalledWith("Ghost");
  });
});

describe("MarkdownBlockRow keys on a Block with no text", () => {
  /*
   * A divider, an image and a Collection have no caret of their own.
   *
   * When one of them is the last Block on the Page there is also no Block below to arrow into, so
   * every key was answered with nothing: typing was discarded silently and the keyboard had no way
   * left to add anything after it. Enter is the key that means "a new Block here" everywhere else in
   * the editor, and it has to mean that here too.
   */
  for (const [label, source] of [
    ["divider", "---\n"],
    ["image", "![Shot](assets/shot.png)\n"],
  ] as const) {
    it(`creates a Block after a ${label} that ends the Page`, () => {
      const [block] = MarkdownBlockDocument.fromMarkdown(source).getSnapshot().blocks;
      const onInsertAfter = vi.fn();
      render(
        <MarkdownBlockRow
          block={block}
          active
          {...slashHandlers()}
          onInsertAfter={onInsertAfter}
          onNavigate={() => false}
        />
      );

      const shell = document.querySelector<HTMLElement>("[data-native-block-editor]");
      expect(shell).not.toBeNull();
      const event = createEvent.keyDown(shell as HTMLElement, {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      fireEvent(shell as HTMLElement, event);

      expect(onInsertAfter).toHaveBeenCalledWith(block.id);
      expect(event.defaultPrevented).toBe(true);
    });
  }
});

/**
 * One marker column for every list kind, in both states.
 *
 * jsdom has no layout, so the class list is the measurement here; the numbers below were taken in
 * the packaged app and the classes are what produce them.
 */
describe("MarkdownBlockRow list marker column", () => {
  function markerColumn(): HTMLElement {
    const column = document.querySelector<HTMLElement>("[data-native-block-content] .w-5");
    expect(column).not.toBeNull();
    return column as HTMLElement;
  }

  for (const [label, markdown, ordinal] of [
    ["a bulleted item", "- item\n", undefined],
    ["the tenth ordinal", "10. item\n", 10],
    ["a to-do", "- [ ] item\n", undefined],
  ] as const) {
    for (const active of [false, true]) {
      it(`hangs ${label}'s marker in the shared column while ${active ? "active" : "at rest"}`, () => {
        const [block] = MarkdownBlockDocument.fromMarkdown(markdown).getSnapshot().blocks;
        render(
          <MarkdownBlockRow
            block={block}
            active={active}
            listOrdinal={ordinal}
            {...slashHandlers()}
          />
        );

        // 20px wide, contents aligned to its right edge, followed by the row's own 8px gap. The
        // to-do used to drop its bare 16px checkbox straight into the row, which started its label
        // 4.00px left of every other list kind's at depths 0, 1 and 2.
        const column = markerColumn();
        expect(column.className).toContain("flex");
        expect(column.className).toContain("justify-end");
        expect(column.className).toContain("shrink-0");
        // `text-right` is what wrapped a two-digit ordinal; the flex column replaces it outright.
        expect(column.className).not.toContain("text-right");
      });
    }
  }

  it("never lets a two-digit ordinal wrap out of the 20px column", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown("10. item\n").getSnapshot().blocks;
    render(<MarkdownBlockRow block={block} active={false} listOrdinal={10} {...slashHandlers()} />);

    // "10." is 20.66px of glyph in a 20.00px box. Right-aligned with `text-right` its period
    // dropped to a second line and the row grew from 40.00px to 68.00px — 22 of the first 33
    // ordinals did that. As a `nowrap` flex child aligned to the column's end it overflows
    // leftward into the 10px grip gap instead, and the label's x never moves.
    const ink = markerColumn().firstElementChild as HTMLElement;
    expect(ink.textContent).toBe("10.");
    expect(ink.className).toContain("whitespace-nowrap");
    expect(ink.className).toContain("shrink-0");
  });

  it("puts the to-do checkbox inside that column rather than beside it", () => {
    const [block] = MarkdownBlockDocument.fromMarkdown("- [ ] item\n").getSnapshot().blocks;
    render(<MarkdownBlockRow block={block} active={false} {...slashHandlers()} />);

    const checkbox = screen.getByRole("checkbox", { name: "item" });
    expect(markerColumn()).toContainElement(checkbox);
    // The glyph itself stays 16px; only the column around it is 20px.
    expect(checkbox.className).toContain("h-4 w-4");
  });
});

describe("MarkdownBlockRow selection and gutter geometry", () => {
  function row(markdown: string, props: Partial<ComponentProps<typeof MarkdownBlockRow>> = {}) {
    const [block] = MarkdownBlockDocument.fromMarkdown(markdown).getSnapshot().blocks;
    // Scoped to this render's own container: two rows in one test would otherwise both answer a
    // document-wide query and the second assertion would read the first row.
    const { container } = render(
      <MarkdownBlockRow block={block} active={false} {...slashHandlers()} {...props} />
    );
    return container.querySelector("[data-native-block-row]") as HTMLElement;
  }

  it("takes the UA's own focus outline off the row", () => {
    // The row is focusable, so a keyboard user got Chromium's `auto 1px rgb(229,151,0)` around the
    // *row* box: measured on the packaged app, left 312.00 against the selection fill's 377.00, and
    // wrapped around the gutter controls at 347-371. Two boxes, 65.00px apart, for one state.
    expect(row("Text\n").className).toContain("outline-none");
  });

  it("draws the keyboard-focus ring on the same box as the selection fill", () => {
    const ring = row("Text\n").querySelector<HTMLElement>("[data-native-block-focus-ring]");
    // Byte for byte the geometry `[data-native-block-row]::after` uses for the fill, so focus and
    // selection are one rectangle that changes colour rather than two rectangles side by side.
    expect(ring?.style.top).toBe("calc(var(--row-lead) - 1px)");
    expect(ring?.style.left).toBe("var(--editor-content-rail, 4rem)");
    expect(ring?.style.right).toBe("0px");
    expect(ring?.style.bottom).toBe("-1px");
    expect(ring?.className).toContain("ring-inset");
    expect(ring?.className).toContain("rounded-[3px]");
    expect(ring?.className).toContain("group-focus-visible/native-block:opacity-100");
  });

  it("draws no ring on a selected Block, so a run of them stays one band", () => {
    // The fill already says where a selected Block is. A ring inside a continuous multi-Block band
    // is the amber line this replaced.
    expect(
      row("Text\n", { blockSelected: true }).querySelector("[data-native-block-focus-ring]")
    ).toBeNull();
  });

  it("puts a quote's bar on the same rail as every other kind's first glyph", () => {
    // Every other kind puts its own `px-1` between the content rail and its ink. A quote's leftmost
    // ink is a border, and a border sits outside padding, so its bar started at 377.00 against
    // 381.00 everywhere else and the grip->ink gap read 6.00px instead of 10.00px. The padding is
    // on the column so the rendering and the editing surface cannot disagree about it.
    const quote = row("> Quoted\n").querySelector<HTMLElement>("[data-native-block-content]");
    expect(quote?.className).toContain("pl-1");
    const paragraph = row("Text\n").querySelector<HTMLElement>("[data-native-block-content]");
    expect(paragraph?.className).not.toContain("pl-1");
  });
});

describe("firstLineBox", () => {
  /** jsdom lays nothing out, so the one thing under test — which box is picked — is stubbed. */
  function withLineBoxes(rects: Map<string, DOMRect>) {
    const original = Range.prototype.getClientRects;
    Range.prototype.getClientRects = function getClientRects() {
      const rect = rects.get(this.startContainer.nodeValue ?? "");
      return (rect ? [rect] : []) as unknown as DOMRectList;
    };
    return () => {
      Range.prototype.getClientRects = original;
    };
  }

  it("measures the first line the reader can see, not the decoration around it", () => {
    const content = document.createElement("div");
    content.innerHTML =
      '<span aria-hidden="true">Note</span> <span>Real title</span><span>later</span>';
    const restore = withLineBoxes(
      new Map([
        ["Note", new DOMRect(0, 5, 40, 20)],
        ["Real title", new DOMRect(0, 50, 80, 20)],
        ["later", new DOMRect(0, 90, 40, 20)],
      ])
    );
    try {
      // The derived callout label and the whitespace between the spans are both rejected, so the
      // first line is the user's own text and every offset-free kind agrees on what "first" means.
      expect(firstLineBox(content)?.top).toBe(50);
    } finally {
      restore();
    }
  });

  it("falls back to a divider's rule, which is its only line of ink", () => {
    const content = document.createElement("div");
    content.innerHTML = "<hr>";
    const rule = content.querySelector("hr") as HTMLElement;
    rule.getBoundingClientRect = () => new DOMRect(0, 30, 100, 1);
    expect(firstLineBox(content)?.top).toBe(30);
  });

  it("gives back null for a Block that draws no line at all", () => {
    // A picture or a rendered diagram has no first *line*, and the caller keeps the stylesheet's
    // own lead rather than centring the gutter on the middle of a 300px image.
    const content = document.createElement("div");
    content.innerHTML = '<img alt="">';
    expect(firstLineBox(content)).toBeNull();
  });
});
