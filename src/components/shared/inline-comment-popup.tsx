"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { X, Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommentComposer } from "@/components/comments/comment-composer";
import { CommentItem } from "@/components/comments/comment-item";
import type { InlineCommentResponse, CommentResponse } from "@/lib/api/types";
import { useInlineCommentsStore } from "@/stores/inline-comments-store";
import { useAuthStore } from "@/stores/auth-store";
import { cn } from "@/lib/utils";

interface InlineCommentPopupProps {
  shareToken: string;
  /** Popup mode: "create" for new comment, "view" for existing thread */
  mode: "create" | "view";
  /** The inline comment thread (for "view" mode) */
  thread?: InlineCommentResponse;
  /** Anchor text preview (for "create" mode) */
  anchorText?: string;
  /** Position in viewport coordinates */
  position: { top: number; left: number };
  onClose: () => void;
  onSubmitCreate?: (content: string) => Promise<void>;
}

export function InlineCommentPopup({
  shareToken,
  mode,
  thread,
  anchorText,
  position,
  onClose,
  onSubmitCreate,
}: InlineCommentPopupProps) {
  const t = useTranslations("inlineComments");
  const popupRef = useRef<HTMLDivElement>(null);
  const [replies, setReplies] = useState<CommentResponse[]>([]);
  const [isLoadingReplies, setIsLoadingReplies] = useState(false);
  const { resolveComment, unresolveComment, toggleReaction, loadReplies } =
    useInlineCommentsStore();
  const user = useAuthStore((s) => s.user);

  // Load replies when viewing a thread
  useEffect(() => {
    if (mode === "view" && thread && thread.reply_count > 0) {
      setIsLoadingReplies(true);
      loadReplies(shareToken, thread.id).then((r) => {
        setReplies(r);
        setIsLoadingReplies(false);
      });
    }
  }, [mode, thread, shareToken, loadReplies]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid immediate close from the click that opened it
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Adjust position to stay within viewport
  const adjustedPosition = useCallback(() => {
    const maxWidth = 380;
    const maxHeight = 400;
    let { top, left } = position;

    if (typeof window !== "undefined") {
      if (left + maxWidth > window.innerWidth - 16) {
        left = window.innerWidth - maxWidth - 16;
      }
      if (left < 16) left = 16;
      if (top + maxHeight > window.innerHeight - 16) {
        top = position.top - maxHeight - 8;
      }
    }
    return { top, left };
  }, [position]);

  const pos = adjustedPosition();

  const handleReply = async (content: string) => {
    const { api } = await import("@/lib/api");
    const reply = await api.createComment(shareToken, content, thread?.id);
    setReplies((prev) => [...prev, reply]);
  };

  return (
    <div
      ref={popupRef}
      className={cn(
        "fixed z-[60] max-h-[400px] w-[380px] overflow-y-auto",
        "rounded-xl border border-border/60 bg-background shadow-xl",
        "animate-in fade-in-0 slide-in-from-top-2 duration-200"
      )}
      style={{ top: pos.top, left: pos.left }}
    >
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/40 bg-background px-4 py-2.5">
        <span className="text-sm font-medium text-foreground">
          {mode === "create" ? t("newComment") : t("commentThread")}
        </span>
        <div className="flex items-center gap-1">
          {mode === "view" && thread && user && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => {
                if (thread.is_resolved) {
                  unresolveComment(shareToken, thread.id);
                } else {
                  resolveComment(shareToken, thread.id);
                }
              }}
            >
              {thread.is_resolved ? (
                <>
                  <RotateCcw className="h-3 w-3" />
                  {t("reopen")}
                </>
              ) : (
                <>
                  <Check className="h-3 w-3" />
                  {t("resolve")}
                </>
              )}
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Create mode: anchor preview + composer */}
      {mode === "create" && (
        <div className="p-4">
          {anchorText && (
            <div className="mb-3 rounded-md border border-border/40 bg-muted/50 px-3 py-2 text-xs italic text-muted-foreground">
              &ldquo;{anchorText.length > 120 ? anchorText.slice(0, 120) + "..." : anchorText}
              &rdquo;
            </div>
          )}
          <CommentComposer
            onSubmit={async (content) => {
              await onSubmitCreate?.(content);
            }}
            placeholder={t("writeAnnotation")}
            autoFocus
            onCancel={onClose}
            showAvatar={false}
          />
        </div>
      )}

      {/* View mode: thread with replies */}
      {mode === "view" && thread && (
        <div className="space-y-3 p-4">
          {/* Anchor text preview */}
          <div className="rounded-md border border-border/40 bg-muted/50 px-3 py-2 text-xs italic text-muted-foreground">
            &ldquo;
            {thread.anchor.text.length > 120
              ? thread.anchor.text.slice(0, 120) + "..."
              : thread.anchor.text}
            &rdquo;
          </div>

          {/* Main comment */}
          <CommentItem
            comment={thread}
            onReact={(emoji) => toggleReaction(shareToken, thread.id, emoji)}
          />

          {/* Replies */}
          {isLoadingReplies && (
            <div className="py-2 text-center text-xs text-muted-foreground">
              {t("loadingReplies")}
            </div>
          )}
          {replies.map((reply) => (
            <CommentItem key={reply.id} comment={reply} />
          ))}

          {/* Reply composer */}
          {user && (
            <CommentComposer
              onSubmit={handleReply}
              placeholder={t("writeReply")}
              showAvatar={false}
            />
          )}
        </div>
      )}
    </div>
  );
}
