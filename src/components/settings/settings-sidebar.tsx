"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useIsTauri } from "@/hooks/use-is-tauri";
import { SETTINGS_TABS, type SettingsTabId } from "./settings-tabs";

interface SettingsSidebarProps {
  activeTab: SettingsTabId;
  onSelectTab: (tab: SettingsTabId) => void;
}

export function SettingsSidebar({ activeTab, onSelectTab }: SettingsSidebarProps) {
  const t = useTranslations("settings");
  const { isTauri, platform } = useIsTauri();
  const isMacTauri = isTauri && platform === "macos";

  return (
    <aside
      aria-label="Settings sidebar"
      data-tauri-drag-region
      className="sidebar-glass flex h-full w-[260px] shrink-0 flex-col border-r border-[var(--sidebar-active-border)]"
    >
      <div
        data-tauri-drag-region
        className={cn("flex items-center px-4", isMacTauri ? "h-11 pl-[88px]" : "h-12")}
      >
        <Link
          href="/editor"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("backToApp")}
        </Link>
      </div>

      <nav className="space-y-0.5 overflow-y-auto px-2 pb-4">
        {SETTINGS_TABS.map(({ id, icon: Icon, labelKey }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectTab(id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                isActive
                  ? "bg-[var(--sidebar-active)] font-medium text-foreground"
                  : "text-muted-foreground hover:bg-[var(--sidebar-hover)] hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{t(labelKey)}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
