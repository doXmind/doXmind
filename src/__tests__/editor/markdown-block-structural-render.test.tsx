import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which Blocks were re-rendered, observed through the editing projection every row builds.
 *
 * The same probe the typing test in `markdown-block-runtime.test.tsx` uses: a row keeps its
 * projection in a `useMemo` keyed on `block`, and `getSnapshot()` hands out a fresh Block object on
 * every call, so a row that re-renders always lands here and a row the memo skips never does.
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

import { MarkdownBlockRuntime } from "@/editor/markdown-block/markdown-block-runtime";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useEditorStore } from "@/stores/editor-store";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { usePageSessionStore } from "@/stores/page-session-store";

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

/** The Blocks whose rows re-rendered when Enter split the first Block of an `blockCount`-Block Page. */
function blocksReRenderedBySplit(blockCount: number): string[] {
  const markdown = `${Array.from(
    { length: blockCount },
    (_, index) => `Paragraph ${index + 1}.`
  ).join("\n\n")}\n`;
  const view = render(<MarkdownBlockRuntime file={{ ...file, content: markdown }} />);
  expect(view.container.querySelectorAll("[data-native-block-row]")).toHaveLength(blockCount);

  fireEvent.click(screen.getByText("Paragraph 1."));
  const textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
  textarea.setSelectionRange(5, 5);

  projectedBlockSources.length = 0;
  fireEvent.keyDown(textarea, { key: "Enter" });
  const touched = [...projectedBlockSources];

  view.unmount();
  return touched;
}

describe("MarkdownBlockRuntime structural edits", () => {
  beforeEach(() => {
    vi.useFakeTimers();
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-renders only the split Block and its two halves, however long the Page", () => {
    const short = blocksReRenderedBySplit(12);
    const long = blocksReRenderedBySplit(60);

    // Enter used to cost the whole document: the row took its ordinal position as `index` and
    // `count` props, and both change value on every row the instant a Block is inserted, so
    // `sameRowProps` reported all N rows as changed and all N rebuilt their projection. Measured
    // here, one Enter re-rendered 17 rows at 12 Blocks and 65 at 60 — the same 6 either way now.
    expect(long).toEqual(short);
    expect(long.length).toBeLessThanOrEqual(8);
    // The Block under the caret and the two halves it becomes, and nothing else: the Blocks below
    // all took a new ordinal and none of them re-rendered for it.
    expect(new Set(long.map((raw) => raw.trimEnd()))).toEqual(
      new Set(["Paragraph 1.", "Parag", "raph 1."])
    );
  });

  it("names every row with its ordinal, and renumbers them all through a split", () => {
    const markdown = `${Array.from({ length: 4 }, (_, index) => `Paragraph ${index + 1}.`).join(
      "\n\n"
    )}\n`;
    render(<MarkdownBlockRuntime file={{ ...file, content: markdown }} />);

    // Every row, not just the one that can take focus: a screen reader reading the Page in browse
    // mode passes over all of them, and the ordinal is how it knows where it is. The names are
    // written by the runtime rather than rendered by the row — see the note on the layout effect in
    // markdown-block-runtime.tsx for why the ordinal cannot be a prop.
    expect(rowNames()).toEqual([
      "Text, block 1 of 4",
      "Text, block 2 of 4",
      "Text, block 3 of 4",
      "Text, block 4 of 4",
    ]);

    fireEvent.click(screen.getByText("Paragraph 2."));
    const textarea = screen.getByLabelText("Markdown block") as HTMLTextAreaElement;
    textarea.setSelectionRange(5, 5);
    fireEvent.keyDown(textarea, { key: "Enter" });

    // The split renumbers every row below it, and the total on every row above it.
    expect(rowNames()).toEqual([
      "Text, block 1 of 5",
      "Text, block 2 of 5",
      "Text, block 3 of 5",
      "Text, block 4 of 5",
      "Text, block 5 of 5",
    ]);
  });
});

function rowNames(): string[] {
  return Array.from(document.querySelectorAll("[data-native-block-row]")).map(
    (row) => row.getAttribute("aria-label") ?? ""
  );
}
