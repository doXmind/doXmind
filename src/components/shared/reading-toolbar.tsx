"use client";

import { Play, Search, MessageSquare } from "lucide-react";
import { useLayoutStore } from "@/stores/layout-store";
import { useInlineCommentsStore } from "@/stores/inline-comments-store";
import { useAuthStore } from "@/stores/auth-store";
import { Tooltip } from "@/components/ui/tooltip";
import { useTranslations } from "next-intl";

export function ReadingToolbar() {
  const t = useTranslations("editor");
  const ti = useTranslations("inlineComments");
  const { setSearchBarOpen, setPresentationMode } = useLayoutStore();
  const user = useAuthStore((s) => s.user);
  const total = useInlineCommentsStore((s) => s.total);
  const toggleSidebar = useInlineCommentsStore((s) => s.toggleSidebar);

  return (
    <div className="flex flex-shrink-0 items-center gap-1">
      {/* Inline comments toggle — only when logged in and comments exist */}
      {user && total > 0 && (
        <Tooltip content={ti("annotations")} side="bottom">
          <button
            onClick={toggleSidebar}
            className="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={ti("annotations")}
          >
            <MessageSquare className="h-4 w-4" />
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
              {total}
            </span>
          </button>
        </Tooltip>
      )}

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
