import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
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

  it("still marks an applied format without reaching for a hover token", () => {
    render(<InlineFormatToolbar {...baseProps} visible activeFormats={{ bold: true }} />);

    // `bg-muted` on a pressed button is the format's own state, not a hover state: the table's tint
    // is an overlay, so the two compose instead of fighting.
    expect(screen.getByRole("button", { name: "Bold" }).className).toContain("bg-muted");
    expect(screen.getByRole("button", { name: "Italic" }).className).not.toContain("bg-muted");
  });
});
