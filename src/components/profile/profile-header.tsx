"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { UserProfileResponse } from "@/lib/api";
import { UserAvatar } from "@/components/ui/user-avatar";
import { ExternalLink, Pencil, FileText, Eye, GitFork, Bookmark, Users } from "lucide-react";

import { ProfileEditModal } from "./profile-edit-modal";
import { FollowButton } from "@/components/community/follow-button";
import { FollowListModal } from "./follow-list-modal";

interface ProfileHeaderProps {
  profile: UserProfileResponse;
  isOwnProfile: boolean;
  onFollowChange?: (isFollowing: boolean, followerCount: number) => void;
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

export function ProfileHeader({ profile, isOwnProfile, onFollowChange }: ProfileHeaderProps) {
  const t = useTranslations("profile");
  const locale = useLocale();
  const [isEditing, setIsEditing] = useState(false);
  const [followListTab, setFollowListTab] = useState<"followers" | "following" | null>(null);

  return (
    <>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-6">
        {/* Avatar */}
        <UserAvatar
          avatarUrl={profile.avatar_url}
          username={profile.username}
          size={96}
          frame={profile.avatar_frame}
          plan={profile.plan}
          className="h-20 w-20 shrink-0 sm:h-24 sm:w-24"
        />

        <div className="min-w-0 flex-1 text-center sm:text-left">
          {/* Name + Edit/Follow */}
          <div className="flex items-baseline justify-center gap-3 sm:justify-start">
            <h1 className="flex items-center text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              {profile.username || t("anonymous")}
            </h1>
            {isOwnProfile ? (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-all hover:border-foreground/20 hover:text-foreground sm:px-3"
              >
                <Pencil className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("editProfile")}</span>
                <span className="sm:hidden">{t("editShort")}</span>
              </button>
            ) : (
              <FollowButton
                userId={profile.id}
                isFollowing={profile.is_following}
                onChange={onFollowChange}
                size="sm"
              />
            )}
          </div>

          {/* Bio */}
          {profile.bio && (
            <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{profile.bio}</p>
          )}

          {/* Links + Joined */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground sm:justify-start">
            {profile.website && (
              <a
                href={profile.website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 transition-colors hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3 opacity-50" />
                {(() => {
                  try {
                    return new URL(profile.website).hostname;
                  } catch {
                    return profile.website;
                  }
                })()}
              </a>
            )}

            {profile.social_links?.github && (
              <a
                href={`https://github.com/${profile.social_links.github}`}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-foreground"
              >
                {t("github")}
              </a>
            )}

            {profile.social_links?.twitter && (
              <a
                href={`https://twitter.com/${profile.social_links.twitter}`}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-foreground"
              >
                {t("twitter")}
              </a>
            )}

            <span className="text-muted-foreground/50">
              {t("joinedOn", {
                date: new Date(profile.created_at).toLocaleDateString(
                  locale === "zh" ? "zh-CN" : "en-US",
                  {
                    year: "numeric",
                    month: "long",
                  }
                ),
              })}
            </span>
          </div>

          {/* Stats row */}
          <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-2 text-[13px] sm:flex sm:items-center sm:gap-5">
            <button
              onClick={() => setFollowListTab("followers")}
              className="flex items-center justify-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground sm:justify-start"
            >
              <Users className="h-3.5 w-3.5 opacity-50" />
              <span className="font-medium text-foreground">
                {formatNumber(profile.stats.followers)}
              </span>
              {t("followers")}
            </button>
            <button
              onClick={() => setFollowListTab("following")}
              className="flex items-center justify-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground sm:justify-start"
            >
              <span className="font-medium text-foreground">
                {formatNumber(profile.stats.following)}
              </span>
              {t("followingLabel")}
            </button>
            <span className="flex items-center justify-center gap-1.5 text-muted-foreground sm:justify-start">
              <FileText className="h-3.5 w-3.5 opacity-50" />
              <span className="font-medium text-foreground">
                {formatNumber(profile.stats.total_published)}
              </span>
              {t("published")}
            </span>
            <span className="flex items-center justify-center gap-1.5 text-muted-foreground sm:justify-start">
              <Eye className="h-3.5 w-3.5 opacity-50" />
              <span className="font-medium text-foreground">
                {formatNumber(profile.stats.total_views)}
              </span>
              {t("views")}
            </span>
            <span className="flex items-center justify-center gap-1.5 text-muted-foreground sm:justify-start">
              <GitFork className="h-3.5 w-3.5 opacity-50" />
              <span className="font-medium text-foreground">
                {formatNumber(profile.stats.total_forks_received)}
              </span>
              {t("forks")}
            </span>
            <span className="flex items-center justify-center gap-1.5 text-muted-foreground sm:justify-start">
              <Bookmark className="h-3.5 w-3.5 opacity-50" />
              <span className="font-medium text-foreground">
                {formatNumber(profile.stats.total_bookmarks_received)}
              </span>
              {t("saves")}
            </span>
          </div>
        </div>
      </div>

      {isEditing && <ProfileEditModal open={isEditing} onClose={() => setIsEditing(false)} />}

      {followListTab && (
        <FollowListModal
          userId={profile.id}
          initialTab={followListTab}
          open={!!followListTab}
          onClose={() => setFollowListTab(null)}
        />
      )}
    </>
  );
}
