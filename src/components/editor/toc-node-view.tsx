"use client";

import { useState, useEffect, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { subscribeOutline } from "@/components/editor/mindlines/use-canonical-outline";
import type { Heading } from "@/components/editor/mindlines/canonical-outline";

const MAX_SHOW_COUNT = 50;

export function TocNodeView({ editor }: NodeViewProps) {
  const [headings, setHeadings] = useState<Heading[]>([]);

  useEffect(() => {
    return subscribeOutline(editor, (next) => {
      setHeadings(next);
    });
  }, [editor]);

  const visibleHeadings =
    headings.length > MAX_SHOW_COUNT ? headings.slice(0, MAX_SHOW_COUNT) : headings;

  // Scroll to heading position
  const scrollToHeading = useCallback(
    (pos: number) => {
      editor.commands.setTextSelection(pos);
      editor.commands.focus();

      requestAnimationFrame(() => {
        try {
          const coords = editor.view.coordsAtPos(pos);
          const editorElement = editor.view.dom;

          // Find scrollable container
          let scrollContainer: HTMLElement | null = editorElement.parentElement;
          while (scrollContainer) {
            const style = window.getComputedStyle(scrollContainer);
            if (style.overflowY === "auto" || style.overflowY === "scroll") {
              break;
            }
            scrollContainer = scrollContainer.parentElement;
          }

          if (!scrollContainer) {
            window.scrollTo({
              top: coords.top - window.innerHeight / 3,
              behavior: "smooth",
            });
            return;
          }

          const containerRect = scrollContainer.getBoundingClientRect();
          const relativeTop = coords.top - containerRect.top;
          const targetScrollTop =
            scrollContainer.scrollTop + relativeTop - containerRect.height / 3;
          scrollContainer.scrollTo({
            top: targetScrollTop,
            behavior: "smooth",
          });
        } catch {
          // Silently fail if coordinates can't be determined
        }
      });
    },
    [editor]
  );

  return (
    <NodeViewWrapper
      data-type="table-of-contents"
      contentEditable={false}
      className="not-prose my-2 select-none"
    >
      {/* Notion-style: no card, no header — just indented links that read as a
          quiet outline. Uniform muted ink; hover darkens + underlines. */}
      {visibleHeadings.length === 0 ? (
        <p className="text-sm text-muted-foreground/60">
          Add headings to create a table of contents.
        </p>
      ) : (
        <nav className="flex flex-col">
          {visibleHeadings.map((heading) => (
            <button
              key={heading.id}
              onClick={() => scrollToHeading(heading.pos)}
              className={cn(
                "rounded-sm py-1 text-left text-sm text-muted-foreground underline-offset-2 transition-colors",
                "hover:text-foreground hover:underline",
                heading.level === 1 && "pl-0",
                heading.level === 2 && "pl-6",
                heading.level === 3 && "pl-12",
                heading.level === 4 && "pl-[4.5rem]",
                heading.level === 5 && "pl-24",
                heading.level === 6 && "pl-[7.5rem]"
              )}
            >
              {heading.text}
            </button>
          ))}
        </nav>
      )}
    </NodeViewWrapper>
  );
}
