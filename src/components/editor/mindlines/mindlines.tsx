"use client";

import { useState, useEffect, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores/layout-store";
import { Tooltip } from "@/components/ui/tooltip";

interface Heading {
  id: string;
  level: number;
  text: string;
  pos: number;
}

interface MindlinesProps {
  editor: Editor | null;
}

export function Mindlines({ editor }: MindlinesProps) {
  const { isMindlinesOpen } = useLayoutStore();
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Extract headings from editor
  useEffect(() => {
    if (!editor) return;

    const updateHeadings = () => {
      const found: Heading[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading" && node.attrs.level <= 3) {
          found.push({
            id: `h-${pos}`,
            level: node.attrs.level,
            text: node.textContent || "Untitled",
            pos,
          });
        }
      });
      setHeadings(found);
    };

    updateHeadings();
    editor.on("update", updateHeadings);
    return () => {
      editor.off("update", updateHeadings);
    };
  }, [editor]);

  // Track current position
  useEffect(() => {
    if (!editor || headings.length === 0) return;

    const trackPosition = () => {
      const { from } = editor.state.selection;
      let active: Heading | null = null;

      for (let i = headings.length - 1; i >= 0; i--) {
        if (headings[i].pos <= from) {
          active = headings[i];
          break;
        }
      }
      setActiveId(active?.id ?? null);
    };

    trackPosition();
    editor.on("selectionUpdate", trackPosition);
    return () => {
      editor.off("selectionUpdate", trackPosition);
    };
  }, [editor, headings]);

  // Handle click to navigate
  const handleClick = useCallback(
    (heading: Heading) => {
      if (!editor) return;
      editor.chain().focus().setTextSelection(heading.pos).scrollIntoView().run();
    },
    [editor]
  );

  if (!isMindlinesOpen || !editor) return null;

  if (headings.length === 0) {
    return (
      <div className="w-44 shrink-0 relative z-10 border-r bg-background/95 backdrop-blur-sm p-3 text-sm text-muted-foreground">
        Add headings to see outline
      </div>
    );
  }

  return (
    <nav
      className="w-44 shrink-0 relative z-10 border-r bg-background/95 backdrop-blur-sm overflow-y-auto"
      aria-label="Document outline"
    >
      <div className="py-2 px-1">
        {headings.map((heading) => {
          const isActive = heading.id === activeId;
          const indent = (heading.level - 1) * 12;

          return (
            <Tooltip key={heading.id} content={heading.text} side="right">
              <button
                onClick={() => handleClick(heading)}
                className={cn(
                  "w-full text-left py-1.5 px-2 rounded text-sm truncate transition-colors",
                  "hover:bg-accent/50",
                  isActive && "bg-accent/30 border-l-2 border-primary"
                )}
                style={{ paddingLeft: `${indent + 8}px` }}
              >
                <span
                  className={cn(
                    "mr-1.5",
                    heading.level === 1 && "text-primary font-semibold",
                    heading.level === 2 && "text-muted-foreground font-medium",
                    heading.level === 3 && "text-muted-foreground/70"
                  )}
                >
                  {heading.level === 1 ? "●" : heading.level === 2 ? "○" : "◦"}
                </span>
                <span
                  className={cn(
                    heading.level === 1 && "font-semibold",
                    heading.level === 2 && "font-medium"
                  )}
                >
                  {heading.text}
                </span>
              </button>
            </Tooltip>
          );
        })}
      </div>
    </nav>
  );
}
