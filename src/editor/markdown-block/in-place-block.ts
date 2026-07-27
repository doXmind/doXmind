import type { KeyboardEvent, ReactNode } from "react";

/**
 * The contract every Block kind's in-place editor follows.
 *
 * A Block must never turn into its own Markdown when you click it. The editor used to swap the whole
 * rendered Block for a textarea holding its raw source, so pressing an image showed
 * `![Alt](path.png)`, a divider showed `---`, a callout showed `> [!NOTE]`, and a code Block lost its
 * highlighting. Ten of the sixteen kinds behaved that way. That is one design decision, not ten bugs,
 * and it is the wrong one: the rendered form *is* the Block, and editing happens inside it.
 *
 * Four rules, all of them learned the hard way while doing this to tables:
 *
 * 1. The rendered form is mounted at the same position in the tree in BOTH states. Not "re-rendered
 *    identically" — the same element, never unmounted. Everything that used to break on activation
 *    (borders vanishing, heights jumping, syntax highlighting dropping) came from tearing the
 *    rendered form down, and none of it can recur once it stays.
 *
 * 2. Activation must not change the Block's height by a single pixel. Anything an editing surface
 *    adds — a handle, a chip, a panel — is either present in both states or positioned out of flow.
 *    Every version of this that mounted controls only while active grew the Block on focus.
 *
 * 3. No Markdown delimiter the rendered form hides may become visible when the Block is edited. A
 *    cell shows bold text, not `**bold**`.
 *
 * 4. While `editable`, exactly one element carries `data-native-block-editor` and holds focus. For a
 *    kind with nothing to type into — a divider, an image, a collection — that element is a focusable
 *    shell rather than a text field, so the Block still answers Escape, Backspace and the arrow keys.
 *    The runtime, the caret machinery and the test matrix all rely on that element existing.
 */
export interface InPlaceBlockProps {
  readonly blockId: string;
  /** The Block's editor source, without its trailing blank-line separator. */
  readonly source: string;
  /** True only for the one Block being edited. A nested or printed Block is never editable. */
  readonly editable: boolean;
  readonly onChange: (
    blockId: string,
    nextSource: string,
    options?: {
      /**
       * True when the edit replaces the Block's editing surface rather than changing text inside it —
       * a callout losing its marker stops being a callout, so the container unmounts and its editor
       * goes with it.
       *
       * A text edit deliberately does *not* apply the document's selection, because the surface that
       * produced it still holds the caret. When the surface is about to be replaced there is nothing
       * left holding anything: the row stayed marked active with `document.activeElement` on `<body>`,
       * and every key after that went nowhere — the same dead end a ragged table's Tab used to reach.
       */
      readonly surfaceChanges?: boolean;
      /**
       * Where the caret belongs in the replaced surface. Without it the caret lands wherever the text
       * patch happened to end, which for a Block that just lost its container is the middle of it —
       * the user pressed Backspace at the very start and would find the caret somewhere else.
       */
      readonly caret?: number;
    }
  ) => void;
  /**
   * Keys the component does not own, handed back to the Block.
   *
   * Escape, undo, redo, duplicate, delete and move all belong to the Block. A surface that swallowed
   * them left the Block unreachable: with the caret inside a table cell, Ctrl/Cmd+Z reached nothing
   * at all, so it was the one Block you could edit and not take back.
   */
  readonly onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  /** Render inline Markdown as rich text. Use for any of the user's text shown read-only. */
  readonly renderInline: (markdown: string) => ReactNode;
}
