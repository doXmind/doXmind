"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { AppShell } from "@/components/layout/app-shell";
import { LoadingScreen } from "@/components/loading-screen";
import {
  api,
  type CommunityDetailResponse,
  type SharedItemResponse,
  type SharedFolderItem,
} from "@/lib/api";
import { CommunityActionBar } from "@/components/community/community-action-bar";
import { StickyActionBar } from "@/components/community/sticky-action-bar";
import { ShareReactions } from "@/components/community/share-reactions";
import { CommentsSection } from "@/components/comments/comments-section";
import { SharedDocumentView } from "@/components/shared/shared-document-view";
import { ReadingToolbar } from "@/components/shared/reading-toolbar";
import { StickyOutline } from "@/components/shared/sticky-outline";
import { ReadingStatsBar } from "@/components/shared/reading-stats-bar";
import { PresentationMode } from "@/components/editor/presentation-mode";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { EditShareModal } from "@/components/community/edit-share-modal";
import { useAuthStore } from "@/stores/auth-store";
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
  Pencil,
} from "lucide-react";

export default function CommunityDetailPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const t = useTranslations("community");
  const currentUser = useAuthStore((s) => s.user);

  const [detail, setDetail] = useState<CommunityDetailResponse | null>(null);
  const [docData, setDocData] = useState<SharedItemResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditingMeta, setIsEditingMeta] = useState(false);
  const actionBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);

        const [communityDetail, sharedDoc] = await Promise.all([
          api.getCommunityDetail(token),
          api.getSharedDocument(token),
        ]);

        setDetail(communityDetail);
        setDocData(sharedDoc);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load content");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [token]);

  // Update browser tab title
  useEffect(() => {
    if (detail) {
      document.title = detail.title;
    }
  }, [detail]);

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

  // Initialize folder view with root data; re-fetch when navigating into subfolders
  useEffect(() => {
    if (!docData?.is_folder) return;

    if (folderPath === null) {
      setFolderViewData(docData);
      return;
    }

    let cancelled = false;
    setFolderLoading(true);
    api
      .getSharedDocument(token, folderPath)
      .then((result) => {
        if (!cancelled) setFolderViewData(result);
      })
      .catch(() => {
        // keep current data on error
      })
      .finally(() => {
        if (!cancelled) setFolderLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [docData, folderPath, token]);

  const handleFolderNavigate = useCallback(
    (itemId: string | null) => {
      if (itemId === null) {
        setFolderPath(null);
        setFolderViewData(docData);
      } else {
        setFolderPath(itemId);
      }
    },
    [docData]
  );

  // Whether we're currently viewing a document (standalone or drilled into from folder)
  const isViewingDocInFolder = !!(
    docData?.is_folder &&
    folderViewData &&
    !folderViewData.is_folder
  );
  const showDocumentChrome = !docData?.is_folder || isViewingDocInFolder;

  if (loading) {
    return (
      <LoadingScreen isLoading={true} isMobile={false}>
        {null}
      </LoadingScreen>
    );
  }

  if (error || !detail || !docData) {
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
              {error || "This content may have been removed or is no longer available."}
            </p>
            <Link
              href="/community"
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-foreground/80"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {t("community")}
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  const publishedDate = detail.published_at
    ? new Date(detail.published_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  return (
    <AppShell>
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {/* Article Header */}
          <div className="border-b border-border/40">
            <div className="mx-auto max-w-3xl px-6 pb-10 pt-10 sm:px-8 lg:max-w-5xl">
              {/* Back link + Reading toolbar */}
              <div className="mb-8 flex items-center justify-between">
                <Link
                  href="/community"
                  className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground/70 transition-colors hover:text-foreground"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {t("community")}
                </Link>
                {showDocumentChrome && <ReadingToolbar />}
              </div>

              {/* Title */}
              <h1 className="text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl">
                {detail.title}
              </h1>

              {/* Description */}
              {detail.description && (
                <p className="mt-4 text-[16px] leading-relaxed text-muted-foreground">
                  {detail.description}
                </p>
              )}

              {/* Meta row */}
              <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
                <Link
                  href={`/profile/${detail.owner.id}`}
                  className="flex items-center gap-2.5 font-medium transition-colors hover:text-foreground"
                >
                  {detail.owner.avatar_url ? (
                    <Image
                      src={detail.owner.avatar_url}
                      alt=""
                      width={28}
                      height={28}
                      className="h-7 w-7 rounded-full ring-1 ring-border/50"
                      unoptimized
                    />
                  ) : (
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground ring-1 ring-border/50">
                      {(detail.owner.username || "?")[0].toUpperCase()}
                    </div>
                  )}
                  <span className="text-foreground/80">{detail.owner.username || "Anonymous"}</span>
                </Link>

                <span className="text-border/60">·</span>

                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 opacity-50" />
                  {publishedDate}
                </span>

                <span className="text-border/60">·</span>

                <span className="flex items-center gap-1.5">
                  <Eye className="h-3.5 w-3.5 opacity-50" />
                  {detail.view_count} views
                </span>
              </div>

              {/* Tags */}
              {detail.tags.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-1.5">
                  {detail.tags.map((tag) => (
                    <Link
                      key={tag}
                      href={`/community?tag=${encodeURIComponent(tag)}`}
                      className="rounded-full border border-border/60 bg-muted/50 px-3 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
                    >
                      {tag}
                    </Link>
                  ))}
                </div>
              )}

              {/* Action buttons */}
              <div ref={actionBarRef} className="mt-8 flex flex-wrap items-center gap-3">
                <CommunityActionBar
                  detail={detail}
                  shareToken={token}
                  onForkSuccess={handleForkSuccess}
                />
                {currentUser?.id === detail.owner.id && (
                  <button
                    onClick={() => setIsEditingMeta(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-2 text-[13px] font-medium text-muted-foreground transition-all hover:border-foreground/20 hover:text-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {t("editPost")}
                  </button>
                )}
              </div>

              {/* Reactions */}
              <div className="mt-4">
                <ShareReactions shareToken={token} reactions={detail.reactions} />
              </div>
            </div>
          </div>

          {/* Sticky action bar (appears when original scrolls out of view) */}
          <StickyActionBar
            detail={detail}
            shareToken={token}
            triggerRef={actionBarRef}
            onForkSuccess={handleForkSuccess}
          />

          {/* Content area with outline sidebar */}
          <div className="mx-auto flex max-w-3xl gap-8 px-6 sm:px-8 lg:max-w-5xl">
            {/* Sticky outline sidebar (lg+ only, documents only) */}
            {showDocumentChrome && <StickyOutline maxHeight="calc(100vh - 8rem)" />}

            {/* Main content column */}
            <div className="relative min-w-0 flex-1">
              {/* Content */}
              <article className="py-10">
                {docData.is_folder ? (
                  <>
                    {/* Breadcrumb navigation within folder */}
                    {folderPath !== null && folderViewData && (
                      <nav className="mb-6 flex min-w-0 items-center gap-1.5 text-[13px]">
                        <button
                          onClick={() => handleFolderNavigate(null)}
                          className="inline-flex shrink-0 items-center gap-1.5 text-muted-foreground/70 transition-colors hover:text-foreground"
                        >
                          <ArrowLeft className="h-3.5 w-3.5" />
                          {detail.title}
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
                      /* Viewing a document within the folder */
                      <SharedDocumentView data={folderViewData} embedded />
                    ) : (
                      /* Folder file list */
                      <FolderItemsList
                        items={folderViewData?.items || []}
                        onItemClick={handleFolderNavigate}
                      />
                    )}
                  </>
                ) : (
                  <SharedDocumentView data={docData} embedded />
                )}
              </article>

              {/* Divider */}
              <hr className="border-border/30" />

              {/* Comments */}
              <div className="py-12">
                <CommentsSection shareToken={token} commentCount={detail.comment_count} />
              </div>
            </div>
          </div>

          {/* Presentation mode portal */}
          {showDocumentChrome && (
            <PresentationMode
              title={detail.title}
              author={detail.owner.username || undefined}
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

      {isEditingMeta && detail && (
        <EditShareModal
          open={isEditingMeta}
          onClose={() => setIsEditingMeta(false)}
          item={{
            shareId: detail.share_id,
            title: detail.title,
            description: detail.description,
            tags: detail.tags,
            allowFork: detail.allow_fork,
          }}
          onSave={(updated) => {
            setDetail((prev) =>
              prev
                ? {
                    ...prev,
                    title: updated.title,
                    description: updated.description,
                    tags: updated.tags,
                    allow_fork: updated.allow_fork,
                  }
                : prev
            );
            setIsEditingMeta(false);
          }}
        />
      )}
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
