"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { NodeViewWrapper, NodeViewContent, NodeViewProps } from "@tiptap/react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function ToggleNodeView({ node, updateAttributes }: NodeViewProps) {
  const isOpen = node.attrs.open !== false;
  const summary = node.attrs.summary || "Toggle heading";
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleToggle = () => {
    updateAttributes({ open: !isOpen });
  };

  const handleSummaryDoubleClick = () => {
    setIsEditing(true);
  };

  const handleSummaryBlur = () => {
    setIsEditing(false);
  };

  const handleSummaryKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      setIsEditing(false);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setIsEditing(false);
    }
  };

  const handleSummaryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateAttributes({ summary: e.target.value });
  };

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  return (
    <NodeViewWrapper>
      <div className="my-2 rounded-lg border border-border">
        {/* Summary / Header */}
        <div
          contentEditable={false}
          className={cn(
            "flex select-none items-center gap-2 px-3 py-2",
            "cursor-pointer transition-colors hover:bg-accent/50",
            isOpen && "border-b border-border"
          )}
        >
          <button
            type="button"
            onClick={handleToggle}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded transition-transform"
          >
            <ChevronRight
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform duration-200",
                isOpen && "rotate-90"
              )}
            />
          </button>

          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={summary}
              onChange={handleSummaryChange}
              onBlur={handleSummaryBlur}
              onKeyDown={handleSummaryKeyDown}
              className="flex-1 bg-transparent text-sm font-medium outline-none"
            />
          ) : (
            <span
              className="flex-1 text-sm font-medium"
              onDoubleClick={handleSummaryDoubleClick}
              onClick={handleToggle}
            >
              {summary}
            </span>
          )}
        </div>

        {/* Collapsible content */}
        <div
          className={cn(
            "overflow-hidden transition-all duration-200",
            isOpen ? "max-h-[5000px] opacity-100" : "max-h-0 opacity-0"
          )}
        >
          <div className="px-3 py-2 pl-10">
            <NodeViewContent className="min-w-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
          </div>
        </div>
      </div>
    </NodeViewWrapper>
  );
}
