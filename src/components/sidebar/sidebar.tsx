"use client";

import { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronsUpDown, GitBranch, FileText, PanelLeftClose } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip } from "@/components/ui/tooltip";
import { OutlineView } from "@/components/editor/mindlines/outline-view";
import { MindmapFlow } from "@/components/editor/mindlines/mindmap-flow";
import { useHeadings } from "@/components/editor/mindlines/use-headings";
import { useFileStore } from "@/stores/file-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useOutlineStore } from "@/stores/outline-store";
import { buildTree } from "@/components/editor/mindlines/use-tree";
import { Z_INDEX } from "@/lib/constants";
import type { Heading } from "@/components/editor/mindlines/types";

export function Sidebar() {
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
    <div className="flex h-full flex-col" data-onboarding="sidebar-toggle">
      {/* Outline header */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
          Outline
        </span>
        <div className="flex gap-1">
          <Tooltip content="Toggle collapse all" side="bottom">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleToggleAllOutline}
              disabled={headings.length === 0}
              aria-label="Toggle collapse all"
              className="h-8 w-8"
            >
              <ChevronsUpDown className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Tooltip content="Mindmap view" side="bottom">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsMindmapOpen(true)}
              disabled={headings.length === 0}
              aria-label="Open mindmap"
              className="h-8 w-8"
            >
              <GitBranch className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Tooltip content="Hide Outline" side="bottom">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              aria-label="Hide Outline"
              className="h-8 w-8"
            >
              <PanelLeftClose className="h-4 w-4" />
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
            <FileText className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">
              {editor ? "No headings in this document" : "Open a document to see its outline"}
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
