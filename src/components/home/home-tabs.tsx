"use client";

import { FileText, Link2, GitFork, Bookmark } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores/layout-store";

type HomeTab = "documents" | "shares" | "forks" | "bookmarks";

interface TabDef {
  id: HomeTab;
  label: string;
  icon: typeof FileText;
}

const TABS: TabDef[] = [
  { id: "documents", label: "Documents", icon: FileText },
  { id: "shares", label: "Shares", icon: Link2 },
  { id: "forks", label: "Forks", icon: GitFork },
  { id: "bookmarks", label: "Saved", icon: Bookmark },
];

interface HomeTabsProps {
  counts: Record<HomeTab, number>;
}

export function HomeTabs({ counts }: HomeTabsProps) {
  const activeTab = useLayoutStore((s) => s.homeActiveTab);
  const setActiveTab = useLayoutStore((s) => s.setHomeActiveTab);

  return (
    <div className="sticky top-0 z-10 -mx-4 border-b border-border/40 bg-background/95 px-4 backdrop-blur-md md:static md:mx-0 md:bg-transparent md:px-0 md:backdrop-blur-none">
      {/* Desktop: horizontal tabs with underline */}
      <div className="hidden gap-1 md:flex">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-4 pb-3 text-[13px] font-medium transition-colors",
                isActive
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              <span
                className={cn(
                  "ml-0.5 tabular-nums",
                  isActive ? "text-muted-foreground/60" : "text-muted-foreground/40"
                )}
              >
                {counts[tab.id]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Mobile: horizontal scroll pill style */}
      <div className="scrollbar-none flex gap-2 overflow-x-auto px-1 pb-3 md:hidden">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                isActive
                  ? "bg-foreground text-background"
                  : "bg-muted/60 text-muted-foreground active:bg-muted"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              <span
                className={cn(
                  "tabular-nums",
                  isActive ? "text-background/60" : "text-muted-foreground/50"
                )}
              >
                {counts[tab.id]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
