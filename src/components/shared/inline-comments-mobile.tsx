"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { MessageSquare, X, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useInlineCommentsStore } from "@/stores/inline-comments-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useAuthStore } from "@/stores/auth-store";
import { cn } from "@/lib/utils";
import type { InlineCommentResponse } from "@/lib/api/types";

interface InlineCommentsMobileProps {
  shareToken: string;
}

export function InlineCommentsMobile({ shareToken }: InlineCommentsMobileProps) {
  const t = useTranslations("inlineComments");
  const [isOpen, setIsOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const editor = useEditorRefStore((s) => s.editor);
  const { threads, total, showResolved, setActiveThread, toggleShowResolved, loadComments } =
    useInlineCommentsStore();

  useEffect(() => {
    if (shareToken && user) {
      loadComments(shareToken);
    }
  }, [shareToken, user, loadComments]);

  // Don't show on desktop or if user is not authenticated
  if (!user) return null;

  const handleClickThread = (thread: InlineCommentResponse) => {
    setIsOpen(false);
    setActiveThread(thread.id);

    // Scroll to the comment position
    if (editor) {
      try {
        const coords = editor.view.coordsAtPos(thread.anchor.from);
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
    }
  };

  return (
    <>
      {/* FAB - visible only on mobile (lg: hidden) */}
      {total > 0 && (
        <button
          onClick={() => setIsOpen(true)}
          className={cn(
            "fixed bottom-20 right-4 z-40 lg:hidden",
            "flex h-12 w-12 items-center justify-center rounded-full",
            "bg-primary text-primary-foreground shadow-lg",
            "transition-transform active:scale-95"
          )}
        >
          <MessageSquare className="h-5 w-5" />
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-medium text-destructive-foreground">
            {total}
          </span>
        </button>
      )}

      {/* Bottom sheet */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-50 bg-black/40 lg:hidden"
            onClick={() => setIsOpen(false)}
          />

          {/* Sheet */}
          <div
            className={cn(
              "fixed inset-x-0 bottom-0 z-50 lg:hidden",
              "max-h-[70vh] rounded-t-2xl border-t border-border bg-background",
              "animate-in slide-in-from-bottom duration-300"
            )}
          >
            {/* Handle */}
            <div className="flex justify-center py-2">
              <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 pb-3">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <MessageSquare className="h-4 w-4" />
                {t("annotations")} ({total})
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 text-xs"
                  onClick={toggleShowResolved}
                >
                  {showResolved ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {showResolved ? t("hideResolved") : t("showResolved")}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setIsOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Thread list */}
            <div className="overflow-y-auto px-4 pb-8">
              {threads.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {t("noAnnotations")}
                </div>
              ) : (
                <div className="space-y-2">
                  {threads.map((thread) => (
                    <button
                      key={thread.id}
                      onClick={() => handleClickThread(thread)}
                      className={cn(
                        "w-full rounded-lg border border-border/40 p-3 text-left transition-colors",
                        "active:bg-accent/50",
                        thread.is_resolved && "opacity-60"
                      )}
                    >
                      {/* Anchor text */}
                      <div className="mb-1.5 line-clamp-2 text-[11px] italic text-muted-foreground/70">
                        &ldquo;{thread.anchor.text.slice(0, 80)}
                        {thread.anchor.text.length > 80 ? "..." : ""}&rdquo;
                      </div>

                      {/* Author + content */}
                      <div className="flex items-start gap-2">
                        <UserAvatar
                          avatarUrl={thread.author.avatar_url}
                          username={thread.author.username || ""}
                          size={20}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium">
                            {thread.author.username}
                          </div>
                          <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {thread.content}
                          </div>
                        </div>
                      </div>

                      {/* Footer */}
                      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground/60">
                        {thread.reply_count > 0 && (
                          <span>
                            {thread.reply_count}{" "}
                            {thread.reply_count === 1 ? t("reply") : t("replies")}
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
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
