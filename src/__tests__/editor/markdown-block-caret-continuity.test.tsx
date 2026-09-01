import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MarkdownBlockRuntime } from "@/editor/markdown-block/markdown-block-runtime";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useEditorStore } from "@/stores/editor-store";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { usePageSessionStore } from "@/stores/page-session-store";

/**
 * The caret does not lie, and nothing the editor opens takes the keyboard away.
 *
 * Everything here is a defect that was measured in the running app first: a caret that jumped to the
 * end of the line when a Block changed kind, a slash command that wrote into the Block above the one
 * it was run in, and a link editor that left `document.activeElement` on `<body>` with no key able to
 * recover it. Each is asserted at the level it broke — the caret offset the surface actually holds,
 * and the element that actually has focus.
 *
 * The scroll half of the same cluster is in tests/e2e/block-ux/scroll-continuity.spec.ts: jsdom
 * lays nothing out, so a scroll assertion here would pass against any code at all. What can be
 * pinned without geometry is pinned here — that activation focuses with `preventScroll`, and that
 * the scroll port declares the safe area the window chrome eats.
 */

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

function openPage(content: string) {
  return render(<MarkdownBlockRuntime file={{ ...file, content }} />);
}

/** Type into the active textarea the way the row does: mirror the caret, then issue the change. */
function typeInto(textarea: HTMLTextAreaElement, value: string, caret: number) {
  textarea.selectionStart = caret;
  textarea.selectionEnd = caret;
  fireEvent.change(textarea, { target: { value } });
}

describe("caret and focus continuity", () => {
  beforeEach(() => {
    useFileStore.setState({ updateFile: vi.fn(async () => {}) });
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

  it.each([
    ["## ", "heading", "## Heading text"],
    ["- ", "bullet_list_item", "- Heading text"],
    ["> ", "blockquote", "> Heading text"],
  ])(
    "leaves the caret where %s was typed when the Block changes kind",
    (marker, kind, nextSource) => {
      const { container } = openPage("Heading text\n");
      fireEvent.click(screen.getByText("Heading text"));
      const textarea = screen.getByLabelText<HTMLTextAreaElement>("Markdown block");

      typeInto(textarea, nextSource, marker.length);

      expect(container.querySelector("[data-native-block-row]")).toHaveAttribute(
        "data-block-kind",
        kind
      );
      // The marker is projected out of the editing surface, so the caret that was after it is now
      // at offset 0 — not at the end of the line, where React's rewrite of `value` parks it.
      expect(screen.getByLabelText<HTMLTextAreaElement>("Markdown block").value).toBe(
        "Heading text"
      );
      expect(screen.getByLabelText<HTMLTextAreaElement>("Markdown block").selectionStart).toBe(0);
    }
  );

  it("leaves the caret to the surface while ordinary typing leaves the kind alone", () => {
    openPage("Hello\n");
    fireEvent.click(screen.getByText("Hello"));
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Markdown block");

    textarea.setSelectionRange(2, 2);
    typeInto(textarea, "HeXllo", 3);

    // 6 is jsdom's own answer — it parks the caret at the end of a value it was handed — and that
    // is the point: the document would have said 3, and a runtime that applied its selection on
    // every keystroke would show 3 here. Ordinary typing must cost no selection round-trip, or the
    // caret fights the surface on every character and an IME loses its candidate window.
    expect(screen.getByLabelText<HTMLTextAreaElement>("Markdown block").selectionStart).toBe(6);
  });

  it("runs the slash menu's Text command in the Block it was typed in, not the one above", () => {
    const { container } = openPage("Alpha\n\n/text\n");
    fireEvent.click(screen.getByText("/text"));
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Markdown block");
    textarea.setSelectionRange(5, 5);
    fireEvent.select(textarea);
    fireEvent.keyDown(textarea, { key: "Enter" });

    const rows = container.querySelectorAll("[data-native-block-row]");
    // Block spans are contiguous, so the emptied Block's only offset is also the end of `Alpha`.
    expect(rows[1]).toHaveAttribute("data-active", "true");
    expect(rows[0]).toHaveAttribute("data-active", "false");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Markdown block").value).toBe("");
  });

  it("hands the keyboard back when the link editor is dismissed", () => {
    openPage("Alpha bravo\n");
    fireEvent.click(screen.getByText("Alpha bravo"));
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Markdown block");
    textarea.setSelectionRange(0, 5);
    fireEvent.keyDown(textarea, { key: "k", metaKey: true });

    const url = screen.getByLabelText("Link URL");
    url.focus();
    expect(document.activeElement).toBe(url);

    fireEvent.keyDown(url, { key: "Escape" });

    expect(screen.queryByLabelText("Link URL")).not.toBeInTheDocument();
    const restored = screen.getByLabelText<HTMLTextAreaElement>("Markdown block");
    expect(document.activeElement).toBe(restored);
    expect([restored.selectionStart, restored.selectionEnd]).toEqual([0, 5]);
  });

  it("draws the run a link is about to wrap, in the editor's own selection colour", () => {
    openPage("Alpha bravo\n");
    fireEvent.click(screen.getByText("Alpha bravo"));
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Markdown block");
    textarea.setSelectionRange(0, 5);
    fireEvent.keyDown(textarea, { key: "k", metaKey: true });

    // Neither surface paints an unfocused selection, and the popover's input has the focus, so the
    // Block draws the run itself or the reader is asked about text they can no longer see.
    // Portalled onto the body: a `position: fixed` child of the row resolves against the row, which
    // is a containing block twice over, and the boxes are measured against the window.
    const popover = screen.getByLabelText("Link destination");
    expect(popover.closest("[data-native-block-row]")).toBeNull();
    expect(popover.parentElement).toHaveAttribute("data-native-editor-overlay");
    // jsdom lays nothing out, so there are no rects to draw here — the painted geometry is asserted
    // in the e2e spec. What holds without layout is where they are drawn from.
  });

  it("declares the safe area the window chrome eats over the scroll port", () => {
    const { container } = openPage("Alpha\n");

    // Blink aligns every scroll it performs on our behalf to this inset, including the ones a
    // focus() triggers and the ones a row's own resize triggers. 80px of opaque chrome plus a
    // 4px hairline.
    expect(
      container.querySelector<HTMLElement>("[data-native-markdown-scroll]")?.style.scrollPaddingTop
    ).toBe("84px");
  });

  it("focuses an activated Block without letting the browser choose the scroll", () => {
    openPage("Alpha\n");
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, "focus");

    fireEvent.click(screen.getByText("Alpha"));

    // Blink's default is `CenterIfNeeded`, which recentres a surface that mounts off screen and
    // steps one that is partly visible — the bimodality that made an Enter walk jump 453px.
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    focus.mockRestore();
  });
});
