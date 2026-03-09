"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { MessageSquare, Eye, EyeOff, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useInlineCommentsStore } from "@/stores/inline-comments-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { cn } from "@/lib/utils";
import type { InlineCommentResponse } from "@/lib/api/types";

interface InlineCommentsSidebarProps {
  shareToken: string;
}

export function InlineCommentsSidebar({ shareToken }: InlineCommentsSidebarProps) {
  const editor = useEditorRefStore((s) => s.editor);
  const t = useTranslations("inlineComments");
  const {
    threads,
    activeThreadId,
    showResolved,
    isLoading,
    total,
    sidebarOpen,
    loadComments,
    setActiveThread,
    toggleShowResolved,
    setSidebarOpen,
  } = useInlineCommentsStore();

  useEffect(() => {
    if (shareToken) {
      loadComments(shareToken);
    }
  }, [shareToken, loadComments]);

  const handleClickThread = (thread: InlineCommentResponse) => {
    setActiveThread(thread.id);

    // Scroll editor to the comment position
    if (editor) {
      const { anchor_from } = { anchor_from: thread.anchor.from };
      try {
        const coords = editor.view.coordsAtPos(anchor_from);
        const editorContainer = editor.view.dom.closest(".overflow-y-auto");
        if (editorContainer) {
          const containerRect = editorContainer.getBoundingClientRect();
          const scrollTop =
            editorContainer.scrollTop + (coords.top - containerRect.top) - containerRect.height / 3;
          editorContainer.scrollTo({ top: scrollTop, behavior: "smooth" });
        }
      } catch {
        // Position may be out of bounds
      }

      // Set active comment in the TipTap extension
      editor.commands.setActiveInlineComment?.(thread.id);
    }
  };

  return (
    <>
      {/* Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 hidden bg-black/20 lg:block"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Slide-in panel */}
      <div
        className={cn(
          "fixed right-0 top-0 z-50 hidden h-full w-80 border-l border-border bg-background shadow-xl lg:block",
          "transition-transform duration-300 ease-in-out",
          sidebarOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
            <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <MessageSquare className="h-4 w-4" />
              <span>
                {t("annotations")} ({total})
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs text-muted-foreground"
                onClick={toggleShowResolved}
              >
                {showResolved ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                {showResolved ? t("hideResolved") : t("showResolved")}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setSidebarOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-20 animate-pulse rounded-lg border border-border/40 bg-muted/30"
                  />
                ))}
              </div>
            ) : threads.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/50 px-4 py-8 text-center">
                <MessageSquare className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">{t("noAnnotations")}</p>
                <p className="mt-1 text-xs text-muted-foreground/60">{t("selectTextToAnnotate")}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {threads.map((thread) => (
                  <InlineCommentCard
                    key={thread.id}
                    thread={thread}
                    isActive={activeThreadId === thread.id}
                    onClick={() => handleClickThread(thread)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ---- Card component ----

function InlineCommentCard({
  thread,
  isActive,
  onClick,
}: {
  thread: InlineCommentResponse;
  isActive: boolean;
  onClick: () => void;
}) {
  const t = useTranslations("inlineComments");

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border px-3 py-2.5 text-left transition-all",
        "hover:border-border hover:bg-accent/50",
        isActive ? "border-primary/40 bg-primary/5" : "border-border/40 bg-background",
        thread.is_resolved && "opacity-60"
      )}
    >
      {/* Anchor text */}
      <div className="mb-1.5 line-clamp-2 text-[11px] italic leading-tight text-muted-foreground/70">
        &ldquo;{thread.anchor.text.slice(0, 80)}
        {thread.anchor.text.length > 80 ? "..." : ""}&rdquo;
      </div>

      {/* Comment preview */}
      <div className="flex items-start gap-2">
        <UserAvatar
          avatarUrl={thread.author.avatar_url}
          username={thread.author.username || ""}
          size={20}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground/80">
            {thread.author.username}
          </div>
          <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{thread.content}</div>
        </div>
      </div>

      {/* Footer: reply count + resolved badge */}
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground/60">
        {thread.reply_count > 0 && (
          <span>
            {thread.reply_count} {thread.reply_count === 1 ? t("reply") : t("replies")}
          </span>
        )}
        {thread.is_resolved && (
          <span className="flex items-center gap-0.5 text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-3 w-3" />
            {t("resolved")}
          </span>
        )}
      </div>
    </button>
  );
}
