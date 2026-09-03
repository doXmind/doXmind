import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { InlineFormatToolbar } from "@/editor/markdown-block/inline-format-toolbar";

const baseProps: ComponentProps<typeof InlineFormatToolbar> = {
  visible: false,
  onType: vi.fn(),
  onBold: vi.fn(),
  onItalic: vi.fn(),
  onStrike: vi.fn(),
  onLink: vi.fn(),
  onCode: vi.fn(),
  onMore: vi.fn(),
};

describe("InlineFormatToolbar", () => {
  it("appears only while a text selection is active", () => {
    const { rerender } = render(<InlineFormatToolbar {...baseProps} />);

    expect(screen.queryByRole("toolbar", { name: "Text formatting" })).not.toBeInTheDocument();

    rerender(<InlineFormatToolbar {...baseProps} visible />);
    expect(screen.getByRole("toolbar", { name: "Text formatting" })).toBeInTheDocument();
  });

  it("routes the compact type control with the current type label", async () => {
    const user = userEvent.setup();
    const onType = vi.fn();
    render(<InlineFormatToolbar {...baseProps} visible typeLabel="Heading 2" onType={onType} />);

    await user.click(screen.getByRole("button", { name: "Change block type: Heading 2" }));

    expect(onType).toHaveBeenCalledOnce();
  });

  it("opens a type menu beside the selection toolbar and applies a Block type", async () => {
    const user = userEvent.setup();
    const onTurnInto = vi.fn();
    render(
      <InlineFormatToolbar
        {...baseProps}
        visible
        typeLabel="Text"
        blockTypeOptions={[
          { label: "Text", kind: "paragraph" },
          { label: "Heading 2", kind: "heading", level: 2 },
        ]}
        onTurnInto={onTurnInto}
      />
    );

    await user.click(screen.getByRole("button", { name: "Change block type: Text" }));
    await user.click(screen.getByRole("menuitem", { name: "Heading 2" }));

    expect(onTurnInto).toHaveBeenCalledWith({
      label: "Heading 2",
      kind: "heading",
      level: 2,
    });
  });

  it("announces and toggles an active bold format", async () => {
    const user = userEvent.setup();
    const onBold = vi.fn();
    render(
      <InlineFormatToolbar {...baseProps} visible activeFormats={{ bold: true }} onBold={onBold} />
    );

    const bold = screen.getByRole("button", { name: "Bold" });
    expect(bold).toHaveAttribute("aria-pressed", "true");
    await user.click(bold);

    expect(onBold).toHaveBeenCalledOnce();
  });

  it("routes italic formatting", async () => {
    const user = userEvent.setup();
    const onItalic = vi.fn();
    render(<InlineFormatToolbar {...baseProps} visible onItalic={onItalic} />);

    await user.click(screen.getByRole("button", { name: "Italic" }));

    expect(onItalic).toHaveBeenCalledOnce();
  });

  it("routes strikethrough formatting", async () => {
    const user = userEvent.setup();
    const onStrike = vi.fn();
    render(<InlineFormatToolbar {...baseProps} visible onStrike={onStrike} />);

    await user.click(screen.getByRole("button", { name: "Strikethrough" }));

    expect(onStrike).toHaveBeenCalledOnce();
  });

  it("routes link formatting", async () => {
    const user = userEvent.setup();
    const onLink = vi.fn();
    render(<InlineFormatToolbar {...baseProps} visible onLink={onLink} />);

    await user.click(screen.getByRole("button", { name: "Link" }));

    expect(onLink).toHaveBeenCalledOnce();
  });

  it("routes inline code formatting", async () => {
    const user = userEvent.setup();
    const onCode = vi.fn();
    render(<InlineFormatToolbar {...baseProps} visible onCode={onCode} />);

    await user.click(screen.getByRole("button", { name: "Inline code" }));

    expect(onCode).toHaveBeenCalledOnce();
  });

  it("routes overflow formatting from More", async () => {
    const user = userEvent.setup();
    const onMore = vi.fn();
    render(<InlineFormatToolbar {...baseProps} visible onMore={onMore} />);

    await user.click(screen.getByRole("button", { name: "More actions" }));

    expect(onMore).toHaveBeenCalledOnce();
  });

  it("uses fixed selection coordinates when supplied", () => {
    render(<InlineFormatToolbar {...baseProps} visible position={{ top: 240, left: 360 }} />);

    const toolbar = screen.getByRole("toolbar", { name: "Text formatting" });
    expect(toolbar).toHaveStyle({
      position: "fixed",
      top: "232px",
      left: "360px",
      transform: "translate(-50%, -100%)",
    });
    expect(toolbar.parentElement).toBe(document.body);
  });

  it("preserves the document selection during pointer activation", () => {
    render(<InlineFormatToolbar {...baseProps} visible />);
    const bold = screen.getByRole("button", { name: "Bold" });
    const mouseDown = createEvent.mouseDown(bold);

    fireEvent(bold, mouseDown);

    expect(mouseDown.defaultPrevented).toBe(true);
  });

  /*
   * The toolbar answers a pointer the way the rest of the editor does.
   *
   * It carried a bare `transition-colors`, which inherits Tailwind's 150ms default, so all seven
   * buttons filled over 0.15s while every other control in the editor took 0.02s — measured
   * half-fill 48ms and 90% at 94ms against the gutter's 20ms. It is portalled onto `document.body`,
   * so it cannot be reached by the `.markdown-page`-scoped half of the state table in editor.css;
   * the `.editor-control` class is how it opts into the same rules.
   */
  it("puts every button on the editor's one table of interaction states", () => {
    render(
      <InlineFormatToolbar {...baseProps} visible typeLabel="Text" activeFormats={{ bold: true }} />
    );

    const toolbar = screen.getByRole("toolbar", { name: "Text formatting" });
    const buttons = [...toolbar.querySelectorAll("button")];
    expect(buttons).toHaveLength(7);

    for (const button of buttons) {
      expect(button.className, button.getAttribute("aria-label") ?? "").toContain("editor-control");
      // The states live in the stylesheet, so a per-button duration or hover fill here can only
      // disagree with them.
      expect(button.className).not.toMatch(/\btransition-colors\b/);
      expect(button.className).not.toMatch(/\bduration-\[?\d/);
      expect(button.className).not.toMatch(/hover:bg-/);
      expect(button.className).not.toMatch(/focus-visible:ring/);
    }
  });

  /**
   * Seven glyphs and, until this, nothing that said what any of them did.
   *
   * The buttons carried a native `title` and no in-app label. Measured in the packaged app:
   * hovering a format button for 1.4s put no popout in the document at all, while the gutter's own
   * controls — same gesture, same 320ms delay — showed theirs. The one surface made entirely of
   * unlabelled icons was the only one with no hover label.
   */
  it("names each control on hover, with the shortcut that reaches it", async () => {
    const user = userEvent.setup();
    render(<InlineFormatToolbar {...baseProps} visible typeLabel="Text" />);

    await user.hover(screen.getByRole("button", { name: "Bold" }));

    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("Bold");
    // Mod, formatted for the platform: ⌘B on a Mac, Ctrl+B elsewhere.
    expect(tip.textContent).toMatch(/(⌘|Ctrl\+)B/);
  });

  it("gives the type control and the overflow button a label too", async () => {
    const user = userEvent.setup();
    render(<InlineFormatToolbar {...baseProps} visible typeLabel="Text" />);

    await user.hover(screen.getByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("More actions");

    await user.unhover(screen.getByRole("button", { name: "More actions" }));
    await user.hover(screen.getByRole("button", { name: "Change block type: Text" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Change block type");
  });

  /**
   * The lit state says it in a currency the hover state does not use.
   *
   * It was `bg-muted`, which is the exact value the shared hover tint is solved to land on — the
   * table's own docblock says so. Measured on the packaged app in the dark theme: a lit Bold button
   * read rgb(46,46,46) on a rgba(46,46,46,.95) panel, 1.04:1, while merely hovering an unlit
   * neighbour lifted it clear. The hovered button looked lit and the lit one looked idle.
   */
  it("marks an applied format with the state the stylesheet paints, not a grey fill", () => {
    render(<InlineFormatToolbar {...baseProps} visible activeFormats={{ bold: true }} />);

    const bold = screen.getByRole("button", { name: "Bold" });
    const italic = screen.getByRole("button", { name: "Italic" });

    expect(bold).toHaveAttribute("aria-pressed", "true");
    expect(italic).toHaveAttribute("aria-pressed", "false");
    // No fill of its own — a grey here can only be the hover colour again.
    expect(bold.className).not.toMatch(/\bbg-/);
    expect(italic.className).not.toMatch(/\bbg-/);
  });

  /** The other half of the pair: the stylesheet has to answer `aria-pressed`, and not in grey. */
  it("paints the pressed state from the accent, and keeps it accent under the pointer", () => {
    const css = readFileSync(resolve(process.cwd(), "src/app/styles/editor.css"), "utf8");

    const on = css.match(/\.editor-control\[aria-pressed="true"\],[^{]*\{([^}]*)\}/)?.[1];
    const onHover = css.match(
      /\.editor-control\[aria-pressed="true"\]:hover:not\(:disabled\),[^{]*\{([^}]*)\}/
    )?.[1];

    expect(on, "editor.css declares an aria-pressed state").toBeTruthy();
    expect(on).toMatch(/rgba\(35, 131, 226/);
    expect(on).toMatch(/color:\s*#2383e2/);
    // Written out rather than inherited: the shared hover rule is (0,3,0) and would otherwise
    // repaint a lit control grey the moment the pointer arrived.
    expect(onHover, "the lit hover is declared, not left to the cascade").toBeTruthy();
    expect(onHover).toMatch(/rgba\(35, 131, 226/);
    expect(onHover).toMatch(/color:\s*#2383e2/);
  });
});
