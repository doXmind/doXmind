"use client";

import { useState } from "react";
import { CommunityDetailResponse, api } from "@/lib/api";
import { GitFork, Bookmark, Share2, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth-store";
import { useBookmarksStore } from "@/stores/bookmarks-store";
import { toast } from "sonner";

interface CommunityActionBarProps {
  detail: CommunityDetailResponse;
  shareToken: string;
  onForkSuccess: (fileId: string) => void;
}

export function CommunityActionBar({ detail, shareToken, onForkSuccess }: CommunityActionBarProps) {
  const user = useAuthStore((s) => s.user);
  const isBookmarked = useBookmarksStore((s) => s.isBookmarked(detail.share_id));
  const toggleBookmark = useBookmarksStore((s) => s.toggleBookmark);
  const [isForking, setIsForking] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleFork = async () => {
    if (!user) {
      toast.error("Please sign in to fork documents");
      return;
    }

    setIsForking(true);
    try {
      const result = await api.forkDocument(shareToken);
      toast.success("Saved to your workspace!");
      onForkSuccess(result.forked_file_id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to fork document");
    } finally {
      setIsForking(false);
    }
  };

  const handleBookmark = async () => {
    if (!user) {
      toast.error("Please sign in to bookmark");
      return;
    }
    const result = await toggleBookmark(shareToken, detail.share_id);
    toast.success(result ? "Bookmark removed" : "Bookmarked!");
  };

  const handleShare = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Link copied to clipboard!");
    } catch {
      toast.error("Failed to copy link");
    }
  };

  return (
    <div className="mt-8 flex flex-wrap items-center gap-2.5">
      {/* Fork */}
      <Button
        variant="outline"
        size="sm"
        onClick={handleFork}
        disabled={isForking || detail.is_forked}
        className="h-9 gap-2 rounded-lg border-border/60 px-4 text-[13px] font-medium transition-all hover:border-foreground/20"
      >
        {isForking ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <GitFork className="h-3.5 w-3.5" />
        )}
        {detail.is_forked ? "Forked" : "Fork"}
        {detail.fork_count > 0 && (
          <span className="ml-0.5 text-muted-foreground">{detail.fork_count}</span>
        )}
      </Button>

      {/* Bookmark */}
      <Button
        variant="outline"
        size="sm"
        onClick={handleBookmark}
        className={`h-9 gap-2 rounded-lg border-border/60 px-4 text-[13px] font-medium transition-all hover:border-foreground/20 ${
          isBookmarked ? "border-foreground/20 bg-muted/50" : ""
        }`}
      >
        <Bookmark className={`h-3.5 w-3.5 ${isBookmarked ? "fill-current" : ""}`} />
        {isBookmarked ? "Saved" : "Save"}
        {detail.bookmark_count > 0 && (
          <span className="ml-0.5 text-muted-foreground">{detail.bookmark_count}</span>
        )}
      </Button>

      {/* Share */}
      <Button
        variant="outline"
        size="sm"
        onClick={handleShare}
        className="h-9 gap-2 rounded-lg border-border/60 px-4 text-[13px] font-medium transition-all hover:border-foreground/20"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Share2 className="h-3.5 w-3.5" />
        )}
        {copied ? "Copied" : "Share"}
      </Button>
    </div>
  );
}
