"use client";

import type { MouseEvent } from "react";
import { NodeViewWrapper, NodeViewContent, NodeViewProps } from "@tiptap/react";
import { useTranslations } from "next-intl";

/**
 * The body of a toggle. Rendered as a hideable container; visibility is
 * controlled by the parent toggle's `open` attribute via CSS
 * (`.notion-toggle.is-closed [data-toggle-body]`).
 *
 * When the body is empty, an inline hint is shown in place of the missing
 * first paragraph; clicking it inserts a paragraph and focuses it.
 */
export function ToggleBodyNodeView({ node, editor, getPos }: NodeViewProps) {
  const t = useTranslations("editor");
  const isEmpty = node.childCount === 0;

  const swallowMouseDown = (e: MouseEvent) => {
    e.preventDefault();
  };

  const handleEmptyClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof getPos !== "function") return;
    const pos = getPos();
    if (typeof pos !== "number") return;
    // pos is the position of toggleBody itself; +1 enters its content.
    const inside = pos + 1;
    editor
      .chain()
      .focus()
      .insertContentAt(inside, { type: "paragraph" })
      .setTextSelection(inside + 1)
      .run();
  };

  return (
    <NodeViewWrapper as="div" data-toggle-body="" className="notion-toggle-body">
      <NodeViewContent className="notion-toggle-body-content" />
      {isEmpty ? (
        <div
          contentEditable={false}
          onMouseDown={swallowMouseDown}
          onClick={handleEmptyClick}
          className="notion-toggle-empty cursor-text select-none text-sm text-muted-foreground/50 hover:text-muted-foreground/70"
        >
          {t("toggle.emptyHint")}
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}
