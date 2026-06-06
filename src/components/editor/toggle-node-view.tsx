"use client";

import type { MouseEvent } from "react";
import { NodeViewWrapper, NodeViewContent, NodeViewProps } from "@tiptap/react";
import { cn } from "@/lib/utils";

/** Notion's disclosure marker is a small solid triangle (not a stroked
 *  chevron); it rotates 90° when the toggle opens. */
function DisclosureTriangle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 13 13" width="13" height="13" className={className} aria-hidden="true">
      <path d="M4.5 3 L9 6.5 L4.5 10 Z" fill="currentColor" />
    </svg>
  );
}

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
          className="absolute left-0 top-0 flex h-6 w-6 select-none items-center justify-center text-foreground/85 transition-colors hover:text-foreground"
        >
          <DisclosureTriangle
            className={cn("transition-transform duration-150", isOpen && "rotate-90")}
          />
        </button>

        <NodeViewContent />
      </div>
    </NodeViewWrapper>
  );
}
