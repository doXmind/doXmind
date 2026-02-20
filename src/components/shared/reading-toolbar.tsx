"use client";

import { Play, Search } from "lucide-react";
import { useLayoutStore } from "@/stores/layout-store";
import { Tooltip } from "@/components/ui/tooltip";

export function ReadingToolbar() {
  const { setSearchBarOpen, setPresentationMode } = useLayoutStore();

  return (
    <div className="flex flex-shrink-0 items-center gap-1">
      <Tooltip content="Present" side="bottom">
        <button
          onClick={() => setPresentationMode(true)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Present"
        >
          <Play className="h-4 w-4" />
        </button>
      </Tooltip>

      <Tooltip content="Search (Ctrl+F)" side="bottom">
        <button
          onClick={() => setSearchBarOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Search in document"
        >
          <Search className="h-4 w-4" />
        </button>
      </Tooltip>
    </div>
  );
}
