"use client";

import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { navigateToEditorFile } from "@/lib/editor-navigation";
import { useFileStore } from "@/stores/file-store";

/**
 * Notion-style inline page mention: a small page icon + the page title rendered
 * inline with the surrounding text, in regular weight with a faint underline
 * that darkens on hover. Click navigates to the page. Distinct from the
 * block-level "Link to Page" card (page-link-node-view.tsx).
 */
function MentionIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M11.5 2.25H5.5C4.94772 2.25 4.5 2.69772 4.5 3.25V16.75C4.5 17.3023 4.94772 17.75 5.5 17.75H14.5C15.0523 17.75 15.5 17.3023 15.5 16.75V6.25L11.5 2.25Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M11.5 2.25V6.25H15.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PageMentionNodeView({ node }: NodeViewProps) {
  const { pageId, pageTitle, pageIcon } = node.attrs;
  const currentFileId = useFileStore((s) => s.currentFileId);
  const file = useFileStore((s) => s.getFile(pageId));

  const displayTitle = file?.name || pageTitle || "Untitled";
  const displayIcon = pageIcon;
  const isDeleted = !file && pageId;

  const handleClick = () => {
    if (!pageId || isDeleted) return;
    if (currentFileId !== pageId) navigateToEditorFile(pageId);
  };

  return (
    <NodeViewWrapper as="span" className="page-mention-wrapper">
      <span
        role="link"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
        className={cn(
          // Inline mention: icon + title baseline-aligned with text, regular
          // weight, faint underline that darkens on hover (Notion).
          "inline-flex max-w-full cursor-pointer items-baseline gap-1 rounded-sm align-baseline",
          "underline decoration-foreground/35 underline-offset-2 hover:decoration-foreground/70",
          isDeleted ? "italic text-muted-foreground" : "text-foreground"
        )}
        contentEditable={false}
      >
        <span className="inline-flex h-[1em] w-[1.05em] shrink-0 translate-y-[0.12em] items-center justify-center leading-none">
          {displayIcon ? (
            <span className="text-[0.95em] leading-none no-underline">{displayIcon}</span>
          ) : (
            <MentionIcon className="h-[0.95em] w-[0.95em] text-muted-foreground" />
          )}
        </span>
        <span className="truncate">{isDeleted ? "Page not found" : displayTitle}</span>
      </span>
    </NodeViewWrapper>
  );
}
