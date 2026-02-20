"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { LoadingScreen } from "@/components/loading-screen";
import { api, type UserProfileResponse, type CommunityItem } from "@/lib/api";
import { ProfileHeader } from "@/components/profile/profile-header";
import { CommunityGrid } from "@/components/community/community-grid";
import { AlertCircle, ArrowLeft, Globe } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";

export default function ProfilePage() {
  const params = useParams();
  const userId = params.userId as string;
  const currentUser = useAuthStore((s) => s.user);

  const [profile, setProfile] = useState<UserProfileResponse | null>(null);
  const [published, setPublished] = useState<CommunityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isOwnProfile = currentUser?.id === userId;

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
            <h1 className="text-xl font-semibold tracking-tight text-foreground">User Not Found</h1>
            <p className="text-sm text-muted-foreground">
              {error || "This user profile could not be found."}
            </p>
            <Link
              href="/community"
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-foreground/80"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Community
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
          <div className="mx-auto max-w-5xl px-6 pb-6 pt-10 sm:px-8 lg:px-10">
            <ProfileHeader profile={profile} isOwnProfile={isOwnProfile} />
          </div>
        </div>

        {/* Published content */}
        <div className="mx-auto max-w-5xl px-6 py-10 sm:px-8 lg:px-10">
          <h2 className="mb-6 flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
            <Globe className="h-3.5 w-3.5" />
            Published
            <span className="text-muted-foreground/50">{published.length}</span>
          </h2>

          {published.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
                <Globe className="h-6 w-6 text-muted-foreground/40" />
              </div>
              <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-foreground">
                No published documents
              </h3>
              <p className="mt-1.5 max-w-sm text-[13px] text-muted-foreground">
                {isOwnProfile
                  ? "Share your work with the community by publishing a document."
                  : "This user hasn't published any documents yet."}
              </p>
            </div>
          ) : (
            <CommunityGrid items={published} isLoading={false} />
          )}
        </div>
      </div>
    </AppShell>
  );
}
