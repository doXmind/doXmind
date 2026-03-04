"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("community");
  const user = useAuthStore((s) => s.user);
  const isBookmarked = useBookmarksStore((s) => s.isBookmarked(detail.share_id));
  const toggleBookmark = useBookmarksStore((s) => s.toggleBookmark);
  const [isForking, setIsForking] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleFork = async () => {
    if (!user) {
      toast.error(t("signInToFork"));
      return;
    }

    setIsForking(true);
    try {
      const result = await api.forkDocument(shareToken);
      toast.success(t("savedToWorkspace"));
      onForkSuccess(result.forked_file_id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("failedToFork"));
    } finally {
      setIsForking(false);
    }
  };

  const handleBookmark = async () => {
    if (!user) {
      toast.error(t("signInToBookmark"));
      return;
    }
    const result = await toggleBookmark(shareToken, detail.share_id);
    toast.success(result ? t("bookmarkRemoved") : t("bookmarked"));
  };

  const handleShare = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success(t("linkCopied"));
    } catch {
      toast.error(t("failedToCopyLink"));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {/* Fork */}
      <Button
        variant="outline"
        size="sm"
        onClick={handleFork}
        disabled={isForking || detail.is_forked || !detail.allow_fork}
        title={!detail.allow_fork ? t("forkDisabled") : undefined}
        className="h-9 gap-2 rounded-lg border-border/60 px-4 text-[13px] font-medium transition-all hover:border-foreground/20"
      >
        {isForking ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <GitFork className="h-3.5 w-3.5" />
        )}
        {detail.is_forked ? t("forked") : t("fork")}
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
        {isBookmarked ? t("saved") : t("save")}
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
        {copied ? t("copied") : t("share")}
      </Button>
    </div>
  );
}
