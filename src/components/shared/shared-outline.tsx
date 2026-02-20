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

const EXPANDED_WIDTH = 256; // w-64
const COLLAPSED_WIDTH = 48;

export function SharedOutline() {
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
      className="hidden h-full shrink-0 lg:flex lg:flex-col"
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
            className="flex-1 overflow-y-auto"
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
            className="flex-1 overflow-hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <ScrollArea className="autohide-scrollbar h-full">
              <OutlineView headings={headings} activeId={activeId} onNavigate={handleNavigate} />
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.aside>
  );
}
