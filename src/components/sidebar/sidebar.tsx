"use client";

import { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronsUpDown, GitBranch, FileText, PanelLeftClose } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip } from "@/components/ui/tooltip";
import { OutlineView } from "@/components/editor/mindlines/outline-view";

// Lazy load MindmapFlow (~100kB @xyflow/react) — only needed on button click
const MindmapFlow = dynamic(
  () =>
    import("@/components/editor/mindlines/mindmap-flow").then((m) => ({
      default: m.MindmapFlow,
    })),
  { ssr: false }
);
import { useHeadings } from "@/components/editor/mindlines/use-headings";
import { useFileStore } from "@/stores/file-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useOutlineStore } from "@/stores/outline-store";
import { useTranslations } from "next-intl";
import { buildTree } from "@/components/editor/mindlines/use-tree";
import { Z_INDEX } from "@/lib/constants";
import type { Heading } from "@/components/editor/mindlines/types";

export function Sidebar() {
  const t = useTranslations("sidebar");
  const { currentFileId } = useFileStore();
  const editor = useEditorRefStore((s) => s.editor);
  const { toggleSidebar } = useLayoutStore();
  const { headings, activeId, navigateTo } = useHeadings(editor);
  const [isMindmapOpen, setIsMindmapOpen] = useState(false);

  const handleOutlineNavigate = useCallback(
    (heading: Heading) => {
      navigateTo(heading);
    },
    [navigateTo]
  );

  const handleMindmapNodeClick = useCallback(
    (heading: Heading) => {
      navigateTo(heading);
    },
    [navigateTo]
  );

  // Outline helpers
  const { expandAll, collapseAll } = useOutlineStore();
  const allNodeIds = headings.map((h) => h.id);
  const handleToggleAllOutline = () => {
    if (!currentFileId) return;
    const tree = buildTree(headings);
    const hasCollapsible = tree.some((n) => n.children.length > 0);
    if (!hasCollapsible) return;
    const collapsedNodes = useOutlineStore.getState().getCollapsedNodes(currentFileId);
    if (collapsedNodes.size > 0) {
      expandAll(currentFileId);
    } else {
      collapseAll(currentFileId, allNodeIds);
    }
  };

  return (
    <div className="flex h-full flex-col border-r border-border/30 bg-background/70">
      {/* Outline header */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-ui-xs font-semibold uppercase tracking-wide text-muted-foreground/60">
          {t("outline")}
        </span>
        <div className="flex gap-1">
          <Tooltip content={t("toggleCollapseAll")} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleToggleAllOutline}
              disabled={headings.length === 0}
              aria-label={t("toggleCollapseAll")}
              className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
            >
              <ChevronsUpDown className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={t("mindmapView")} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsMindmapOpen(true)}
              disabled={headings.length === 0}
              aria-label={t("openMindmap")}
              className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
            >
              <GitBranch className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={t("hideOutline")} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              aria-label={t("hideOutline")}
              className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Outline content */}
      <ScrollArea className="autohide-scrollbar flex-1">
        {editor && headings.length > 0 ? (
          <div className="p-2">
            <OutlineView
              headings={headings}
              activeId={activeId}
              onNavigate={handleOutlineNavigate}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
            <FileText className="h-8 w-8 text-muted-foreground/40 dark:text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground">
              {editor ? t("noHeadings") : t("openDocForOutline")}
            </p>
          </div>
        )}
      </ScrollArea>

      {/* Mindmap fullscreen overlay */}
      {isMindmapOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-background"
              style={{ zIndex: Z_INDEX.MODAL }}
            >
              <MindmapFlow
                headings={headings}
                activeId={activeId}
                onNodeClick={handleMindmapNodeClick}
                onClose={() => setIsMindmapOpen(false)}
              />
            </motion.div>
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}
