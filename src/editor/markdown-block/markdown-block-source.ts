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
