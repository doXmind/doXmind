"use client";

import { useCallback } from "react";
import { PanelRightClose } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip } from "@/components/ui/tooltip";
import { OutlineView } from "@/components/editor/mindlines/outline-view";
import { useHeadings } from "@/components/editor/mindlines/use-headings";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useTranslations } from "next-intl";
import type { Heading } from "@/components/editor/mindlines/types";
import { isMarkdownFile } from "@/lib/document-types";

/**
 * Outline panel (expanded state).
 *
 * Visual language follows the Notion no-rail / typography-only edition:
 * - Mono uppercase eyebrow `OUTLINE · n`
 * - Quiet doc title bound to the current file's display name
 * - Pure-typography heading list (no rails, no row backgrounds)
 * - Hover-reveal close affordance — header stays calm at rest
 *
 * Lives on the RIGHT side of the editor; close button sits on the LEFT
 * edge of the header so it points back toward the document.
 */
export function Sidebar() {
  const t = useTranslations("sidebar");
  const editor = useEditorRefStore((s) => s.editor);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const { headings, activeId, navigateTo } = useHeadings(editor);

  const currentFile = useFileStore((s) =>
    s.currentFileId ? s.files.find((file) => file.id === s.currentFileId) : undefined
  );
  const docTitle =
    currentFile && isMarkdownFile(currentFile)
      ? currentFile.name || "Untitled"
      : (currentFile?.name ?? "");

  const handleOutlineNavigate = useCallback(
    (heading: Heading) => {
      navigateTo(heading);
    },
    [navigateTo]
  );

  return (
    <div className="font-brand-sans group/outline flex h-full flex-col">
      {/* Header: mono eyebrow + quiet doc title; hairline divider below */}
      <div className="relative flex flex-col gap-2.5 border-b border-border/55 px-5 pb-3.5 pt-4">
        <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
          <span>{t("outline")}</span>
          {headings.length > 0 && (
            <>
              <span className="text-muted-foreground/55">·</span>
              <span>{headings.length}</span>
            </>
          )}
        </div>

        {docTitle && (
          <h2
            className="text-balance text-[15px] font-semibold leading-[1.3] tracking-[-0.012em] text-foreground"
            title={docTitle}
          >
            {docTitle}
          </h2>
        )}

        {/* Hover-reveal close button on the LEFT edge of the panel */}
        <Tooltip content={t("hideOutline")} side="left">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={t("hideOutline")}
            className="absolute left-1 top-3 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity duration-150 hover:bg-accent/60 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40 group-hover/outline:opacity-100"
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>

      {/* Outline body */}
      <ScrollArea className="autohide-scrollbar flex-1">
        {editor && headings.length > 0 ? (
          <OutlineView headings={headings} activeId={activeId} onNavigate={handleOutlineNavigate} />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
            <p className="text-[12px] text-muted-foreground">
              {editor ? t("noHeadings") : t("openDocForOutline")}
            </p>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
