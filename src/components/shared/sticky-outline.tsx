"use client";

import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { OutlineView } from "@/components/editor/mindlines/outline-view";
import { OutlineCollapsed } from "@/components/editor/mindlines/outline-collapsed";
import { useHeadings } from "@/components/editor/mindlines/use-headings";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { Heading } from "@/components/editor/mindlines/types";

interface StickyOutlineProps {
  maxHeight?: string;
}

const EXPANDED_WIDTH = 224; // w-56
const COLLAPSED_WIDTH = 48;

export function StickyOutline({ maxHeight = "calc(100vh - 8rem)" }: StickyOutlineProps) {
  const editor = useEditorRefStore((s) => s.editor);
  const { headings, activeId, navigateTo } = useHeadings(editor);
  const [collapsed, setCollapsed] = useState(false);

  const handleNavigate = useCallback(
    (heading: Heading) => {
      navigateTo(heading);
    },
    [navigateTo]
  );

  const handleExpand = useCallback(() => {
    setCollapsed(false);
  }, []);

  if (headings.length === 0) return null;

  return (
    <motion.aside
      className="hidden shrink-0 lg:block"
      style={{ position: "sticky", top: "4rem", alignSelf: "flex-start" }}
      initial={false}
      animate={{ width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
    >
      {/* Header with toggle */}
      <div className="flex items-center justify-between px-3 py-4">
        {!collapsed && (
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
            Outline
          </span>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={collapsed ? "Expand outline" : "Collapse outline"}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait" initial={false}>
        {collapsed ? (
          <motion.div
            key="collapsed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <OutlineCollapsed
              headings={headings}
              activeId={activeId}
              onNavigate={handleNavigate}
              onExpand={handleExpand}
            />
          </motion.div>
        ) : (
          <motion.div
            key="expanded"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <ScrollArea style={{ maxHeight }} className="autohide-scrollbar">
              <OutlineView headings={headings} activeId={activeId} onNavigate={handleNavigate} />
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.aside>
  );
}
