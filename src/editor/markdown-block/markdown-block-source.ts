/** Exact source exposed to a Block editor, excluding its authored Page separator. */
export function editableMarkdownBlockSource(raw: string): string {
  const separator = raw.match(/((?:\r\n|\n|\r)(?:[ \t]*(?:\r\n|\n|\r))*[ \t]*)$/)?.[1];
  return separator ? raw.slice(0, -separator.length) : raw;
}

/**
 * The ordinal each ordered list item should *display*, which is not the one in its source.
 *
 * Markdown does not renumber. `1. a` / `2. b` / `3. c` with a new item typed after the first is
 * written `1.` / `1.` / `2.` / `3.` on disk, and CommonMark, Notion and Feishu all render that
 * 1, 2, 3, 4 — only the first ordinal of a run is meaningful, and the rest are counted. Rendering
 * the source ordinal verbatim showed two "2." in a row after any insert, "1." twice after a
 * duplicate, and a list starting at "3." after moving its last item to the top.
 *
 * A run is seeded from its first item's own ordinal, so a list that genuinely starts at 2 — which is
 * what deleting the first item of `1./2./3.` leaves behind — still renders 2, 3 rather than being
 * silently renumbered to 1, 2. Nothing here writes: the source keeps whatever ordinals it had.
 */
export function orderedListDisplayOrdinals(
  blocks: readonly { id: string; kind: string; raw: string; depth?: number }[]
): ReadonlyMap<string, number> {
  const ordinals = new Map<string, number>();
  /** The last ordinal rendered at each depth, for runs that are still open. */
  const counters = new Map<number, number>();

  const closeDeeperThan = (depth: number, inclusive: boolean) => {
    for (const key of [...counters.keys()]) {
      if (inclusive ? key >= depth : key > depth) counters.delete(key);
    }
  };

  for (const block of blocks) {
    const depth = block.depth ?? 0;
    if (block.kind === "ordered_list_item") {
      const open = counters.get(depth);
      const seed = Number(block.raw.match(/^[ \t]*(\d{1,9})[.)]/)?.[1] ?? 1);
      const ordinal = open === undefined ? seed : open + 1;
      counters.set(depth, ordinal);
      ordinals.set(block.id, ordinal);
      // A nested list that appears again later is a new list and counts from its own first item.
      closeDeeperThan(depth, false);
      continue;
    }
    if (block.kind === "bullet_list_item" || block.kind === "task_list_item") {
      // A bullet between two numbers is a different list, so the run at this depth ends here.
      closeDeeperThan(depth, true);
      continue;
    }
    counters.clear();
  }

  return ordinals;
}

/** A Block the fold control can act on, and where the range it owns ends. */
export interface MarkdownFoldable {
  readonly id: string;
  readonly kind: string;
  readonly depth?: number;
  readonly level?: number;
}

/**
 * The index one past the last Block that folding `blocks[index]` would hide, or `index + 1` when
 * nothing would be hidden.
 *
 * A heading owns everything down to the next heading of equal or higher level — the section, in
 * the sense the outline already uses. A list item owns its deeper descendants. Nothing else owns
 * anything, which is what makes a paragraph unfoldable rather than folding to itself.
 */
export function markdownFoldRangeEnd(blocks: readonly MarkdownFoldable[], index: number): number {
  const block = blocks[index];
  if (!block) return index;

  if (block.kind === "heading") {
    const level = block.level ?? 1;
    let end = index + 1;
    while (end < blocks.length) {
      const candidate = blocks[end];
      if (candidate.kind === "heading" && (candidate.level ?? 1) <= level) break;
      end += 1;
    }
    return end;
  }

  if (isFoldableListKind(block.kind)) {
    const depth = block.depth ?? 0;
    let end = index + 1;
    while (end < blocks.length) {
      const candidate = blocks[end];
      if (!isFoldableListKind(candidate.kind) || (candidate.depth ?? 0) <= depth) break;
      end += 1;
    }
    return end;
  }

  return index + 1;
}

/** Whether `blocks[index]` owns anything, i.e. whether a fold control belongs on it. */
export function isMarkdownFoldable(blocks: readonly MarkdownFoldable[], index: number): boolean {
  return markdownFoldRangeEnd(blocks, index) > index + 1;
}

/**
 * Every hidden Block, mapped to the folded anchors hiding it.
 *
 * A map rather than a set because the caret can arrive inside a folded range — from a search
 * result, a Wiki Link, an undo — and the only way to reveal it is to know which anchors to open.
 *
 * Anchor ids that are no longer in `blocks` are ignored by construction, which is what makes fold
 * state self-healing across edits: a folded heading that gets deleted takes its fold with it.
 */
export function hiddenMarkdownBlockIds(
  blocks: readonly MarkdownFoldable[],
  folded: ReadonlySet<string>
): ReadonlyMap<string, readonly string[]> {
  const hidden = new Map<string, string[]>();
  if (folded.size === 0) return hidden;
  for (let index = 0; index < blocks.length; index += 1) {
    if (!folded.has(blocks[index].id)) continue;
    const anchor = blocks[index].id;
    const end = markdownFoldRangeEnd(blocks, index);
    for (let inner = index + 1; inner < end; inner += 1) {
      const anchors = hidden.get(blocks[inner].id);
      if (anchors) anchors.push(anchor);
      else hidden.set(blocks[inner].id, [anchor]);
    }
    // The folded Block itself stays visible; only what it owns is hidden. Skipping to the end of
    // the range means a fold nested inside another contributes nothing extra.
    index = end - 1;
  }
  return hidden;
}

function isFoldableListKind(kind: string): boolean {
  return kind === "bullet_list_item" || kind === "ordered_list_item" || kind === "task_list_item";
}
