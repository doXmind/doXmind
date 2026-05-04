"use client";

import type { MouseEvent } from "react";
import { NodeViewWrapper, NodeViewContent, NodeViewProps } from "@tiptap/react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function ToggleNodeView({ node, updateAttributes }: NodeViewProps) {
  const isOpen = node.attrs.open !== false;

  const handleToggle = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    updateAttributes({ open: !isOpen });
  };

  // Prevent the chevron's mousedown from moving the editor selection before
  // the click fires.
  const swallowMouseDown = (e: MouseEvent) => {
    e.preventDefault();
  };

  return (
    <NodeViewWrapper className="notion-toggle-wrapper">
      <div
        className={cn("notion-toggle relative my-0.5 pl-6", isOpen ? "is-open" : "is-closed")}
        data-toggle-open={isOpen ? "true" : "false"}
      >
        <button
          type="button"
          contentEditable={false}
          onMouseDown={swallowMouseDown}
          onClick={handleToggle}
          aria-label={isOpen ? "Collapse toggle" : "Expand toggle"}
          aria-expanded={isOpen}
          className="absolute left-0 top-0 flex h-7 w-6 select-none items-center justify-center text-muted-foreground/70 transition-colors hover:text-foreground"
        >
          <ChevronRight
            className={cn("h-3.5 w-3.5 transition-transform duration-150", isOpen && "rotate-90")}
          />
        </button>

        <NodeViewContent />
      </div>
    </NodeViewWrapper>
  );
}
