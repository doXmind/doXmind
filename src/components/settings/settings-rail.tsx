"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SettingsNavItem {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

interface SettingsNavProps {
  items: readonly SettingsNavItem[];
  active: string;
  onSelect: (id: string) => void;
  query: string;
  onQueryChange: (value: string) => void;
  backLabel: string;
  searchPlaceholder: string;
}

/**
 * Codex-style settings rail: a back-to-app link, a filtering search box, and
 * an icon nav whose active item is selected (the content area shows one
 * section at a time). Sits flush against the window's left edge; the top
 * traffic-light strip is reserved by the page's drag region above it.
 */
export function SettingsNav({
  items,
  active,
  onSelect,
  query,
  onQueryChange,
  backLabel,
  searchPlaceholder,
}: SettingsNavProps) {
  const needle = query.trim().toLowerCase();
  const visible = needle ? items.filter((it) => it.label.toLowerCase().includes(needle)) : items;

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col gap-1 border-r border-border/60 bg-[var(--sidebar-translucent-bg)] px-3 pb-4 pt-[44px]">
      <Link
        href="/editor"
        className="mb-1 inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-[var(--sidebar-hover)] hover:text-foreground"
      >
        <ArrowLeft className="h-[15px] w-[15px]" />
        <span>{backLabel}</span>
      </Link>

      <div className="relative mb-1.5">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-muted-foreground/70" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-8 w-full rounded-md bg-foreground/[0.05] pl-8 pr-2.5 text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:bg-foreground/[0.08]"
        />
      </div>

      <nav className="flex flex-col gap-0.5">
        {visible.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2 py-[7px] text-left text-[13px] tracking-[-0.005em] transition-colors",
                isActive
                  ? "bg-[var(--sidebar-hover)] font-medium text-foreground"
                  : "text-muted-foreground hover:bg-[var(--sidebar-hover)] hover:text-foreground"
              )}
            >
              <Icon className="h-[15px] w-[15px] shrink-0" />
              <span className="min-w-0 truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
