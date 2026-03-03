"use client";

import { useTranslations } from "next-intl";
import { FileText, Eye, GitFork, Bookmark } from "lucide-react";

interface ProfileStatsProps {
  stats: {
    total_published: number;
    total_views: number;
    total_forks_received: number;
    total_bookmarks_received: number;
  };
}

const STAT_ITEMS = [
  { key: "total_published", labelKey: "statsPublished", icon: FileText },
  { key: "total_views", labelKey: "statsViews", icon: Eye },
  { key: "total_forks_received", labelKey: "statsForks", icon: GitFork },
  { key: "total_bookmarks_received", labelKey: "statsBookmarks", icon: Bookmark },
] as const;

export function ProfileStats({ stats }: ProfileStatsProps) {
  const t = useTranslations("profile");

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {STAT_ITEMS.map(({ key, labelKey, icon: Icon }) => (
        <div key={key} className="rounded-lg border border-border bg-card p-4 text-center">
          <Icon className="mx-auto mb-1.5 h-4 w-4 text-muted-foreground" />
          <div className="text-2xl font-bold text-foreground">{formatNumber(stats[key])}</div>
          <div className="text-xs text-muted-foreground">{t(labelKey)}</div>
        </div>
      ))}
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}
