"use client";

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
  { key: "total_published", label: "Published", icon: FileText },
  { key: "total_views", label: "Views", icon: Eye },
  { key: "total_forks_received", label: "Forks", icon: GitFork },
  { key: "total_bookmarks_received", label: "Bookmarks", icon: Bookmark },
] as const;

export function ProfileStats({ stats }: ProfileStatsProps) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {STAT_ITEMS.map(({ key, label, icon: Icon }) => (
        <div key={key} className="rounded-lg border border-border bg-card p-4 text-center">
          <Icon className="mx-auto mb-1.5 h-4 w-4 text-muted-foreground" />
          <div className="text-2xl font-bold text-foreground">{formatNumber(stats[key])}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
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
