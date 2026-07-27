"use client";

import { ImageIcon } from "lucide-react";

/**
 * The one rendering of an inline image, used by the preview and by the editing surface.
 *
 * They used to be written separately and drifted, which is the whole reason this file exists. The
 * preview drew the alt text in a pill and the editor drew a 24x24 icon, so clicking a sentence that
 * contained an image swapped one for the other and slid every word after it sideways under the
 * pointer — the in-place contract's first rule says the rendered form *is* the Block, and two forms
 * cannot both be it.
 *
 * The chip is one atom on purpose. `preservesAtomicImages` in the semantic editor depends on the
 * image being a single indivisible object, and the projection maps it to exactly one visible
 * character, so the alt text cannot be drawn as real text here: a text node inside the chip would be
 * read back as typed content and every caret offset after it in the line would be wrong. It stays on
 * `title` and `aria-label`, where a pointer and a screen reader can both still reach it. The label is
 * the alt text alone, not "Image: ..." — `role="img"` already says what it is, and the caller sets
 * that role where it applies.
 */
export function InlineImageChip({
  alt,
  target,
  selected = false,
  ...rest
}: {
  alt: string;
  target?: string;
  selected?: boolean;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...rest}
      title={target}
      aria-label={alt || target || "Markdown image"}
      className={`mx-0.5 inline-flex h-6 w-6 select-all items-center justify-center rounded text-muted-foreground ${
        selected ? "bg-primary/20 ring-2 ring-primary/40" : "bg-muted"
      }`}
    >
      <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
      {rest.children}
    </span>
  );
}
