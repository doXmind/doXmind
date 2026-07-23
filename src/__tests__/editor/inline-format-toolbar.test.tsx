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
});
