"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { LoadingScreen } from "@/components/loading-screen";
import { api, type SharedItemResponse } from "@/lib/api";
import { AlertCircle } from "lucide-react";
import { SharedDocumentView } from "@/components/shared/shared-document-view";
import { SharedFolderView } from "@/components/shared/shared-folder-view";

export default function SharedPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = params.token as string;
  const path = searchParams.get("path");

  const [data, setData] = useState<SharedItemResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSharedItem() {
      try {
        setLoading(true);
        setError(null);
        const result = await api.getSharedDocument(token, path || undefined);
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load shared content");
      } finally {
        setLoading(false);
      }
    }

    loadSharedItem();
  }, [token, path]);

  const handleNavigate = useCallback(
    (targetPath: string | null) => {
      if (targetPath) {
        router.push(`/shared/${token}?path=${encodeURIComponent(targetPath)}`);
      } else {
        router.push(`/shared/${token}`);
      }
    },
    [router, token]
  );

  if (loading) {
    return (
      <LoadingScreen isLoading={true} isMobile={false}>
        {null}
      </LoadingScreen>
    );
  }

  if (error || !data) {
    return (
      <AppShell hideHeader>
        <div className="flex h-screen items-center justify-center bg-background">
          <div className="max-w-md space-y-4 px-6 text-center">
            <AlertCircle className="mx-auto h-16 w-16 text-destructive" />
            <h1 className="text-2xl font-bold text-foreground">Content Not Found</h1>
            <p className="text-muted-foreground">
              {error || "This shared content may have expired or been removed."}
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (data.is_folder) {
    return (
      <AppShell hideHeader>
        <SharedFolderView data={data} onNavigate={handleNavigate} />
      </AppShell>
    );
  }

  return (
    <AppShell hideHeader>
      <SharedDocumentView
        data={data}
        breadcrumbs={data.breadcrumbs || undefined}
        onNavigate={path ? handleNavigate : undefined}
      />
    </AppShell>
  );
}
