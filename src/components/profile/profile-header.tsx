"use client";

import { useState } from "react";
import { UserProfileResponse } from "@/lib/api";
import { ExternalLink, Pencil, FileText, Eye, GitFork, Bookmark } from "lucide-react";
import { ProfileEditModal } from "./profile-edit-modal";

interface ProfileHeaderProps {
  profile: UserProfileResponse;
  isOwnProfile: boolean;
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

export function ProfileHeader({ profile, isOwnProfile }: ProfileHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <>
      <div className="flex items-start gap-6">
        {/* Avatar */}
        {profile.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt={profile.username || "User"}
            className="h-20 w-20 shrink-0 rounded-full ring-1 ring-border/50 sm:h-24 sm:w-24"
          />
        ) : (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-muted text-2xl font-bold text-muted-foreground ring-1 ring-border/50 sm:h-24 sm:w-24">
            {(profile.username || "?")[0].toUpperCase()}
          </div>
        )}

        <div className="min-w-0 flex-1">
          {/* Name + Edit */}
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {profile.username || "Anonymous"}
            </h1>
            {isOwnProfile && (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-all hover:border-foreground/20 hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit Profile
              </button>
            )}
          </div>

          {/* Bio */}
          {profile.bio && (
            <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{profile.bio}</p>
          )}

          {/* Links + Joined */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground">
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
                GitHub
              </a>
            )}

            {profile.social_links?.twitter && (
              <a
                href={`https://twitter.com/${profile.social_links.twitter}`}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-foreground"
              >
                Twitter
              </a>
            )}

            <span className="text-muted-foreground/50">
              Joined{" "}
              {new Date(profile.created_at).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
              })}
            </span>
          </div>

          {/* Stats row */}
          <div className="mt-4 flex items-center gap-5 text-[13px]">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <FileText className="h-3.5 w-3.5 opacity-50" />
              <span className="font-medium text-foreground">
                {formatNumber(profile.stats.total_published)}
              </span>
              published
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Eye className="h-3.5 w-3.5 opacity-50" />
              <span className="font-medium text-foreground">
                {formatNumber(profile.stats.total_views)}
              </span>
              views
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <GitFork className="h-3.5 w-3.5 opacity-50" />
              <span className="font-medium text-foreground">
                {formatNumber(profile.stats.total_forks_received)}
              </span>
              forks
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Bookmark className="h-3.5 w-3.5 opacity-50" />
              <span className="font-medium text-foreground">
                {formatNumber(profile.stats.total_bookmarks_received)}
              </span>
              saves
            </span>
          </div>
        </div>
      </div>

      {isEditing && <ProfileEditModal open={isEditing} onClose={() => setIsEditing(false)} />}
    </>
  );
}
