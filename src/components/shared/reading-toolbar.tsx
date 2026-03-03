"use client";

import { Play, Search } from "lucide-react";
import { useLayoutStore } from "@/stores/layout-store";
import { Tooltip } from "@/components/ui/tooltip";
import { useTranslations } from "next-intl";

export function ReadingToolbar() {
  const t = useTranslations("editor");
  const { setSearchBarOpen, setPresentationMode } = useLayoutStore();

  return (
    <div className="flex flex-shrink-0 items-center gap-1">
      <Tooltip content={t("present")} side="bottom">
        <button
          onClick={() => setPresentationMode(true)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t("present")}
        >
          <Play className="h-4 w-4" />
        </button>
      </Tooltip>

      <Tooltip content={t("searchCtrlF")} side="bottom">
        <button
          onClick={() => setSearchBarOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t("searchInDocument")}
        >
          <Search className="h-4 w-4" />
        </button>
      </Tooltip>
    </div>
  );
}
