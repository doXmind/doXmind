"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { AppShell } from "@/components/layout/app-shell";
import { LoadingScreen } from "@/components/loading-screen";
import {
  api,
  type SharedItemResponse,
  type CommunityDetailResponse,
  type SharedFolderItem,
} from "@/lib/api";
import { CommunityActionBar } from "@/components/community/community-action-bar";
import { StickyActionBar } from "@/components/community/sticky-action-bar";
import { CommentsSection } from "@/components/comments/comments-section";
import { SharedDocumentView } from "@/components/shared/shared-document-view";
import { ReadingToolbar } from "@/components/shared/reading-toolbar";
import { StickyOutline } from "@/components/shared/sticky-outline";
import { ReadingStatsBar } from "@/components/shared/reading-stats-bar";
import { PresentationMode } from "@/components/editor/presentation-mode";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useTranslations, useLocale } from "next-intl";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  ChevronRight,
  Eye,
  FileText,
  Folder,
  Loader2,
  Lock,
  LogIn,
  ShieldX,
} from "lucide-react";

export default function SharedPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = params.token as string;
  const path = searchParams.get("path");

  const [data, setData] = useState<SharedItemResponse | null>(null);
  const [detail, setDetail] = useState<CommunityDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<"AUTH_REQUIRED" | "ACCESS_DENIED" | null>(null);
  const actionBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadSharedItem() {
      try {
        setLoading(true);
        setError(null);
        setAuthError(null);

        const result = await api.getSharedDocument(token, path || undefined);

        // Public share → redirect to community page
        if (result.visibility === "public") {
          router.replace(`/community/${token}`);
          return;
        }

        setData(result);

        // Try to load community detail for richer metadata (may fail for private)
        try {
          const communityDetail = await api.getCommunityDetail(token);
          setDetail(communityDetail);
        } catch {
          // Private shares may not have community detail — that's fine
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load";
        if (message === "AUTH_REQUIRED") {
          setAuthError("AUTH_REQUIRED");
        } else if (message === "ACCESS_DENIED") {
          setAuthError("ACCESS_DENIED");
        } else {
          setError(message);
        }
      } finally {
        setLoading(false);
      }
    }

    loadSharedItem();
  }, [token, path, router]);

  // Update browser tab title
  useEffect(() => {
    if (data) {
      const title = detail?.title || data.name.replace(/\.md$/, "");
      document.title = title;
    }
  }, [data, detail]);

  // Keyboard shortcut: Ctrl+F / Cmd+F to open search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        useLayoutStore.getState().setSearchBarOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleForkSuccess = async (fileId: string) => {
    await useFileStore.getState().loadFiles();
    useFileStore.getState().setCurrentFile(fileId);
    router.push(`/editor/${fileId}`);
  };

  // --- Folder navigation state ---
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [folderViewData, setFolderViewData] = useState<SharedItemResponse | null>(null);
  const [folderLoading, setFolderLoading] = useState(false);

  useEffect(() => {
    if (!data?.is_folder) return;
    if (folderPath === null) {
      setFolderViewData(data);
      return;
    }
    let cancelled = false;
    setFolderLoading(true);
    api
      .getSharedDocument(token, folderPath)
      .then((result) => {
        if (!cancelled) setFolderViewData(result);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setFolderLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data, folderPath, token]);

  const handleFolderNavigate = useCallback(
    (itemId: string | null) => {
      if (itemId === null) {
        setFolderPath(null);
        setFolderViewData(data);
      } else {
        setFolderPath(itemId);
      }
    },
    [data]
  );

  const isViewingDocInFolder = !!(data?.is_folder && folderViewData && !folderViewData.is_folder);
  const showDocumentChrome = !data?.is_folder || isViewingDocInFolder;

  // Loading
  if (loading) {
    return (
      <LoadingScreen isLoading={true} isMobile={false}>
        {null}
      </LoadingScreen>
    );
  }

  // Auth required (401)
  if (authError === "AUTH_REQUIRED") {
    return (
      <AppShell>
        <div className="flex h-[80vh] items-center justify-center">
          <div className="max-w-sm space-y-4 px-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10">
              <LogIn className="h-7 w-7 text-amber-600 dark:text-amber-400" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Sign In Required
            </h1>
            <p className="text-sm text-muted-foreground">
              This is a private share. Sign in to view it.
            </p>
            <Link
              href={`/login?redirect=${encodeURIComponent(`/shared/${token}`)}`}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <LogIn className="h-3.5 w-3.5" />
              Sign In
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  // Access denied (403)
  if (authError === "ACCESS_DENIED") {
    return (
      <AppShell>
        <div className="flex h-[80vh] items-center justify-center">
          <div className="max-w-sm space-y-4 px-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
              <ShieldX className="h-7 w-7 text-destructive" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Access Denied</h1>
            <p className="text-sm text-muted-foreground">
              You don&apos;t have permission to view this share.
            </p>
            <Link
              href="/"
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-foreground/80"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Go Home
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  // General error / not found
  if (error || !data) {
    return (
      <AppShell>
        <div className="flex h-[80vh] items-center justify-center">
          <div className="max-w-sm space-y-4 px-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
              <AlertCircle className="h-7 w-7 text-destructive" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Content Not Found
            </h1>
            <p className="text-sm text-muted-foreground">
              {error || "This shared content may have expired or been removed."}
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private share: render with community-style editorial layout
  // ──────────────────────────────────────────────────────────────────────────

  const displayTitle = detail?.title || data.name.replace(/\.md$/, "");
  const ownerName = detail?.owner?.username || data.owner_name || "Anonymous";
  const ownerAvatar = detail?.owner?.avatar_url || data.owner_avatar_url;
  const publishedDate = data.updated_at
    ? new Date(data.updated_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  return (
    <AppShell>
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {/* Editorial Header */}
          <div className="border-b border-border/40">
            <div className="mx-auto max-w-3xl px-6 pb-10 pt-10 sm:px-8 lg:max-w-5xl">
              {/* Private badge + reading toolbar */}
              <div className="mb-8 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[12px] font-medium text-amber-600 dark:text-amber-400">
                  <Lock className="h-3 w-3" />
                  Private Share
                </span>
                {showDocumentChrome && <ReadingToolbar />}
              </div>

              {/* Title */}
              <h1 className="text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl">
                {displayTitle}
              </h1>

              {/* Description */}
              {detail?.description && (
                <p className="mt-4 text-[16px] leading-relaxed text-muted-foreground">
                  {detail.description}
                </p>
              )}

              {/* Meta row */}
              <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
                <span className="flex items-center gap-2.5 font-medium">
                  {ownerAvatar ? (
                    <Image
                      src={ownerAvatar}
                      alt=""
                      width={28}
                      height={28}
                      className="h-7 w-7 rounded-full ring-1 ring-border/50"
                      unoptimized
                    />
                  ) : (
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground ring-1 ring-border/50">
                      {ownerName[0].toUpperCase()}
                    </div>
                  )}
                  <span className="text-foreground/80">{ownerName}</span>
                </span>

                <span className="text-border/60">&middot;</span>

                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 opacity-50" />
                  {publishedDate}
                </span>

                {detail && (
                  <>
                    <span className="text-border/60">&middot;</span>
                    <span className="flex items-center gap-1.5">
                      <Eye className="h-3.5 w-3.5 opacity-50" />
                      {detail.view_count} views
                    </span>
                  </>
                )}
              </div>

              {/* Action buttons (only if we have community detail) */}
              {detail && (
                <div ref={actionBarRef} className="mt-8">
                  <CommunityActionBar
                    detail={detail}
                    shareToken={token}
                    onForkSuccess={handleForkSuccess}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Sticky action bar */}
          {detail && (
            <StickyActionBar
              detail={detail}
              shareToken={token}
              triggerRef={actionBarRef}
              onForkSuccess={handleForkSuccess}
            />
          )}

          {/* Content area with outline sidebar */}
          <div className="mx-auto flex max-w-3xl gap-8 px-6 sm:px-8 lg:max-w-5xl">
            {showDocumentChrome && <StickyOutline maxHeight="calc(100vh - 8rem)" />}

            <div className="relative min-w-0 flex-1">
              <article className="py-10">
                {data.is_folder ? (
                  <>
                    {/* Breadcrumb nav within folder */}
                    {folderPath !== null && folderViewData && (
                      <nav className="mb-6 flex min-w-0 items-center gap-1.5 text-[13px]">
                        <button
                          onClick={() => handleFolderNavigate(null)}
                          className="inline-flex shrink-0 items-center gap-1.5 text-muted-foreground/70 transition-colors hover:text-foreground"
                        >
                          <ArrowLeft className="h-3.5 w-3.5" />
                          {displayTitle}
                        </button>
                        {folderViewData.breadcrumbs
                          ?.filter((c) => c.is_folder)
                          .map((crumb) => (
                            <span key={crumb.id} className="flex items-center gap-1">
                              <span className="text-muted-foreground/50">/</span>
                              <button
                                onClick={() => handleFolderNavigate(crumb.id)}
                                className="truncate text-muted-foreground/70 transition-colors hover:text-foreground"
                              >
                                {crumb.name}
                              </button>
                            </span>
                          ))}
                        {!folderViewData.is_folder && (
                          <>
                            <span className="text-muted-foreground/50">/</span>
                            <span className="truncate font-medium text-foreground">
                              {folderViewData.name.replace(/\.md$/, "")}
                            </span>
                          </>
                        )}
                      </nav>
                    )}

                    {folderLoading ? (
                      <div className="flex items-center justify-center py-16">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : folderViewData && !folderViewData.is_folder ? (
                      <SharedDocumentView data={folderViewData} embedded />
                    ) : (
                      <FolderItemsList
                        items={folderViewData?.items || []}
                        onItemClick={handleFolderNavigate}
                      />
                    )}
                  </>
                ) : (
                  <SharedDocumentView data={data} embedded />
                )}
              </article>

              {/* Comments */}
              <hr className="border-border/30" />
              <div className="py-12">
                <CommentsSection shareToken={token} commentCount={detail?.comment_count ?? 0} />
              </div>
            </div>
          </div>

          {/* Presentation mode */}
          {showDocumentChrome && (
            <PresentationMode
              title={displayTitle}
              author={ownerName}
              date={publishedDate || undefined}
            />
          )}
        </div>

        {/* Fixed bottom stats bar */}
        {showDocumentChrome && (
          <div className="border-t border-border/40 bg-background">
            <div className="mx-auto max-w-3xl px-6 sm:px-8 lg:max-w-5xl">
              <ReadingStatsBar />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

/* ── Helpers ─────────────────────────────────────────── */

function formatDate(dateString: string, locale = "en"): string {
  return new Date(dateString).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function FolderItemsList({
  items,
  onItemClick,
}: {
  items: SharedFolderItem[];
  onItemClick: (id: string) => void;
}) {
  const locale = useLocale();
  const t = useTranslations("community");

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <Folder className="h-12 w-12 text-muted-foreground/20" />
        <p className="text-sm text-muted-foreground">{t("emptyFolder")}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {items.map((item, index) => (
        <button
          key={item.id}
          onClick={() => onItemClick(item.id)}
          className={`flex w-full items-center gap-3.5 px-5 py-3.5 text-left transition-colors hover:bg-accent/50 ${
            index !== items.length - 1 ? "border-b border-border" : ""
          }`}
        >
          {item.is_folder ? (
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-amber-500/10 dark:bg-amber-500/15">
              <Folder className="h-[18px] w-[18px] text-amber-600 dark:text-amber-400" />
            </div>
          ) : (
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
              {item.icon ? (
                <span className="text-lg leading-none">{item.icon}</span>
              ) : (
                <FileText className="h-[18px] w-[18px] text-muted-foreground" />
              )}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {item.is_folder ? item.name : item.name.replace(/\.md$/, "")}
            </p>
          </div>
          <span className="flex-shrink-0 text-xs text-muted-foreground">
            {formatDate(item.updated_at, locale)}
          </span>
          {item.is_folder && (
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground/50" />
          )}
        </button>
      ))}
    </div>
  );
}
