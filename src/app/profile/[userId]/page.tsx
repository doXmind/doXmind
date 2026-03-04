"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { LoadingScreen } from "@/components/loading-screen";
import { api, type UserProfileResponse, type CommunityItem } from "@/lib/api";
import { ProfileHeader } from "@/components/profile/profile-header";
import { CommunityGrid } from "@/components/community/community-grid";
import { EditShareModal } from "@/components/community/edit-share-modal";
import { AlertCircle, ArrowLeft, Globe } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslations } from "next-intl";

export default function ProfilePage() {
  const params = useParams();
  const userId = params.userId as string;
  const currentUser = useAuthStore((s) => s.user);
  const t = useTranslations("profile");

  const [profile, setProfile] = useState<UserProfileResponse | null>(null);
  const [published, setPublished] = useState<CommunityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<CommunityItem | null>(null);

  const isOwnProfile = currentUser?.id === userId;

  // Update browser tab title
  useEffect(() => {
    if (profile) {
      document.title = profile.username || "Profile";
    }
  }, [profile]);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);

        const [profileData, publishedData] = await Promise.all([
          api.getUserProfile(userId),
          api.getUserPublished(userId),
        ]);

        setProfile(profileData);
        setPublished(publishedData.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load profile");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [userId]);

  if (loading) {
    return (
      <LoadingScreen isLoading={true} isMobile={false}>
        {null}
      </LoadingScreen>
    );
  }

  if (error || !profile) {
    return (
      <AppShell>
        <div className="flex h-[80vh] items-center justify-center">
          <div className="max-w-sm space-y-4 px-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
              <AlertCircle className="h-7 w-7 text-destructive" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {t("userNotFound")}
            </h1>
            <p className="text-sm text-muted-foreground">{error || t("userNotFoundDesc")}</p>
            <Link
              href="/community"
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-foreground/80"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {t("backToCommunity")}
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        {/* Header area */}
        <div className="border-b border-border/40">
          <div className="mx-auto max-w-5xl px-4 pb-5 pt-6 sm:px-8 sm:pb-6 sm:pt-10 lg:px-10">
            <ProfileHeader
              profile={profile}
              isOwnProfile={isOwnProfile}
              onFollowChange={(isFollowing, followerCount) => {
                setProfile((prev) =>
                  prev
                    ? {
                        ...prev,
                        is_following: isFollowing,
                        stats: { ...prev.stats, followers: followerCount },
                      }
                    : prev
                );
              }}
            />
          </div>
        </div>

        {/* Published content */}
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-10 lg:px-10">
          <h2 className="mb-6 flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
            <Globe className="h-3.5 w-3.5" />
            {t("publishedSection")}
            <span className="text-muted-foreground/50">{published.length}</span>
          </h2>

          {published.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center sm:py-20">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
                <Globe className="h-6 w-6 text-muted-foreground/40" />
              </div>
              <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-foreground">
                {t("noPublishedDocs")}
              </h3>
              <p className="mt-1.5 max-w-sm text-[13px] text-muted-foreground">
                {isOwnProfile ? t("noPublishedDocsOwnDesc") : t("noPublishedDocsDesc")}
              </p>
            </div>
          ) : (
            <CommunityGrid
              items={published}
              isLoading={false}
              onEditItem={isOwnProfile ? setEditingItem : undefined}
            />
          )}
        </div>
      </div>

      {editingItem && (
        <EditShareModal
          open={!!editingItem}
          onClose={() => setEditingItem(null)}
          item={{
            shareId: editingItem.share_id,
            title: editingItem.title,
            description: editingItem.description,
            tags: editingItem.tags,
            allowFork: editingItem.allow_fork,
          }}
          onSave={(updated) => {
            setPublished((prev) =>
              prev.map((p) =>
                p.share_id === editingItem.share_id
                  ? {
                      ...p,
                      title: updated.title,
                      description: updated.description,
                      tags: updated.tags,
                      allow_fork: updated.allow_fork,
                    }
                  : p
              )
            );
            setEditingItem(null);
          }}
        />
      )}
    </AppShell>
  );
}
