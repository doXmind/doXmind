"use client";

import { useState, useEffect, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { List } from "lucide-react";
import { cn } from "@/lib/utils";

interface TocHeading {
  level: number;
  text: string;
  pos: number;
}

export function TocNodeView({ editor }: NodeViewProps) {
  const [headings, setHeadings] = useState<TocHeading[]>([]);

  // Extract headings from the document
  const updateHeadings = useCallback(() => {
    const found: TocHeading[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading") {
        found.push({
          level: node.attrs.level,
          text: node.textContent || "Untitled",
          pos,
        });
      }
    });
    setHeadings(found);
  }, [editor]);

  // Update on mount and on every transaction
  useEffect(() => {
    updateHeadings();

    const handler = () => updateHeadings();
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor, updateHeadings]);

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
      className="not-prose my-4 select-none"
    >
      <div className="rounded-lg border border-border bg-muted/30 px-5 py-4">
        {/* Header */}
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <List className="h-4 w-4" />
          Table of Contents
        </div>

        {/* Heading list */}
        {headings.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No headings found. Add headings to your document to generate a table of contents.
          </p>
        ) : (
          <nav className="flex flex-col gap-0.5">
            {headings.map((heading, i) => (
              <button
                key={`${heading.pos}-${i}`}
                onClick={() => scrollToHeading(heading.pos)}
                className={cn(
                  "rounded px-2 py-1 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                  heading.level === 1 && "font-medium text-foreground",
                  heading.level === 2 && "pl-6 text-foreground/80",
                  heading.level === 3 && "pl-10 text-muted-foreground",
                  heading.level === 4 && "pl-14 text-xs text-muted-foreground",
                  heading.level === 5 && "pl-[4.5rem] text-xs text-muted-foreground",
                  heading.level === 6 && "pl-20 text-xs text-muted-foreground"
                )}
              >
                {heading.text}
              </button>
            ))}
          </nav>
        )}
      </div>
    </NodeViewWrapper>
  );
}
