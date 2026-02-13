"use client";

import { useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { OutlineView } from "@/components/editor/mindlines/outline-view";
import { useHeadings } from "@/components/editor/mindlines/use-headings";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import type { Heading } from "@/components/editor/mindlines/types";

export function SharedOutline() {
  const editor = useEditorRefStore((s) => s.editor);
  const { headings, activeId, navigateTo } = useHeadings(editor);

  const handleNavigate = useCallback(
    (heading: Heading) => {
      navigateTo(heading);
    },
    [navigateTo]
  );

  if (headings.length === 0) return null;

  return (
    <aside className="hidden h-full w-64 shrink-0 lg:flex lg:flex-col">
      <div className="px-3 py-4 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
        Outline
      </div>
      <ScrollArea className="autohide-scrollbar flex-1">
        <OutlineView headings={headings} activeId={activeId} onNavigate={handleNavigate} />
      </ScrollArea>
    </aside>
  );
}
