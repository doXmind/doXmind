"use client";

import { Bookmark } from "lucide-react";
import { type CommunityItem } from "@/lib/api";
import { CommunityGrid } from "@/components/community/community-grid";

interface BookmarksSectionProps {
  bookmarks: CommunityItem[];
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
        <Bookmark className="h-6 w-6 text-muted-foreground/40" />
      </div>
      <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-foreground">
        No bookmarks
      </h3>
      <p className="mt-1.5 max-w-sm text-[13px] text-muted-foreground">
        Save documents from the community to find them here.
      </p>
    </div>
  );
}

export function BookmarksSection({ bookmarks }: BookmarksSectionProps) {
  if (bookmarks.length === 0) return <EmptyState />;

  return <CommunityGrid items={bookmarks} isLoading={false} />;
}
