"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CommentResponse } from "@/lib/api";
import { CommentItem } from "./comment-item";
import { CommentComposer } from "./comment-composer";
import { useCommentsStore } from "@/stores/comments-store";
import { useAuthStore } from "@/stores/auth-store";
import { Skeleton, SkeletonLine } from "@/components/ui/skeleton";

interface CommentThreadProps {
  comment: CommentResponse;
  shareToken: string;
  depth: number;
}

const MAX_DEPTH = 3;

function CommentSkeleton() {
  return (
    <div className="flex gap-2.5">
      <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <SkeletonLine className="h-3 w-24" />
        <SkeletonLine className="h-3 w-full" />
        <SkeletonLine className="h-3 w-3/4" />
      </div>
    </div>
  );
}

export function CommentThread({ comment, shareToken, depth }: CommentThreadProps) {
  const t = useTranslations("comments");
  const user = useAuthStore((s) => s.user);
  const { addComment, loadReplies, toggleReaction, editComment, deleteComment } =
    useCommentsStore();
  const [isReplying, setIsReplying] = useState(false);
  const [replies, setReplies] = useState<CommentResponse[]>([]);
  const [showReplies, setShowReplies] = useState(false);
  const [loadingReplies, setLoadingReplies] = useState(false);

  const handleReply = async (content: string) => {
    await addComment(shareToken, content, comment.id);
    setIsReplying(false);

    // Refresh replies
    if (showReplies) {
      const newReplies = await loadReplies(shareToken, comment.id);
      setReplies(newReplies);
    }
  };

  const handleShowReplies = async () => {
    if (showReplies) {
      setShowReplies(false);
      return;
    }

    setLoadingReplies(true);
    const result = await loadReplies(shareToken, comment.id);
    setReplies(result);
    setShowReplies(true);
    setLoadingReplies(false);
  };

  const handleReaction = async (emoji: string) => {
    await toggleReaction(shareToken, comment.id, emoji);
  };

  const handleEdit = async (content: string) => {
    await editComment(shareToken, comment.id, content);
  };

  const handleDelete = async () => {
    await deleteComment(shareToken, comment.id);
  };

  const canReply = user && depth < MAX_DEPTH;

  return (
    <div className={depth > 0 ? "ml-6 border-l border-border/40 pl-4" : ""}>
      <CommentItem
        comment={comment}
        onReply={canReply ? () => setIsReplying(!isReplying) : undefined}
        onReact={user ? handleReaction : undefined}
        onEdit={user?.id === comment.author.id ? handleEdit : undefined}
        onDelete={user?.id === comment.author.id ? handleDelete : undefined}
      />

      {/* Reply count button */}
      {comment.reply_count > 0 && (
        <button
          onClick={handleShowReplies}
          className="mt-2 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {showReplies
            ? t("hideReplies")
            : comment.reply_count === 1
              ? t("replySingular", { count: comment.reply_count })
              : t("replyPlural", { count: comment.reply_count })}
        </button>
      )}

      {/* Depth limit indicator */}
      {user && depth >= MAX_DEPTH && !comment.is_deleted && (
        <p className="mt-1.5 pl-8 text-[11px] text-muted-foreground/40">
          {t("threadLimitReached")}
        </p>
      )}

      {/* Reply composer */}
      {isReplying && (
        <div className="ml-6 mt-3">
          <CommentComposer
            onSubmit={handleReply}
            placeholder={t("replyToUser", { name: comment.author.username || "user" })}
            autoFocus
            onCancel={() => setIsReplying(false)}
          />
        </div>
      )}

      {/* Reply loading skeletons */}
      {loadingReplies && (
        <div className="ml-6 mt-4 space-y-4 border-l border-border/40 pl-4">
          <CommentSkeleton />
          <CommentSkeleton />
        </div>
      )}

      {/* Replies */}
      {showReplies && !loadingReplies && (
        <div className="mt-4 space-y-4">
          {replies.map((reply) => (
            <CommentThread
              key={reply.id}
              comment={reply}
              shareToken={shareToken}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
