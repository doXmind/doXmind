"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { UserPlus, UserCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

interface FollowButtonProps {
  userId: string;
  isFollowing: boolean;
  onChange?: (isFollowing: boolean, followerCount: number) => void;
  size?: "sm" | "default";
}

export function FollowButton({
  userId,
  isFollowing: initialIsFollowing,
  onChange,
  size = "default",
}: FollowButtonProps) {
  const t = useTranslations("profile");
  const user = useAuthStore((s) => s.user);
  const [isFollowing, setIsFollowing] = useState(initialIsFollowing);
  const [isLoading, setIsLoading] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  if (!user) return null;

  const handleToggle = async () => {
    if (!user) {
      toast.error(t("signInToFollow"));
      return;
    }

    setIsLoading(true);
    try {
      const result = await api.toggleFollow(userId);
      setIsFollowing(result.is_following);
      onChange?.(result.is_following, result.follower_count);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("followError"));
    } finally {
      setIsLoading(false);
    }
  };

  const showUnfollow = isFollowing && isHovered && !isLoading;
  const isSmall = size === "sm";

  return (
    <button
      onClick={handleToggle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      disabled={isLoading}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border font-medium transition-all",
        isSmall ? "px-2.5 py-1 text-[13px]" : "px-3 py-1.5 text-sm",
        isLoading && "pointer-events-none opacity-60",
        showUnfollow
          ? "border-destructive/40 text-destructive hover:bg-destructive/10"
          : isFollowing
            ? "border-border/60 text-muted-foreground hover:border-foreground/20 hover:text-foreground"
            : "border-border/60 text-muted-foreground hover:border-foreground/20 hover:text-foreground"
      )}
    >
      {isLoading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : isFollowing ? (
        showUnfollow ? (
          <span>{t("unfollow")}</span>
        ) : (
          <>
            <UserCheck className="h-3.5 w-3.5" />
            <span>{t("following")}</span>
          </>
        )
      ) : (
        <>
          <UserPlus className="h-3.5 w-3.5" />
          <span>{t("follow")}</span>
        </>
      )}
    </button>
  );
}
