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
  parentUsername?: string;
}

const MAX_DEPTH = 3;

function CommentSkeleton() {
  return (
    <div className="flex gap-3">
      <Skeleton className="h-9 w-9 shrink-0 rounded-full sm:h-10 sm:w-10" />
      <div className="flex-1 space-y-2">
        <SkeletonLine className="h-3 w-24" />
        <SkeletonLine className="h-3 w-full" />
        <SkeletonLine className="h-3 w-3/4" />
      </div>
    </div>
  );
}

export function CommentThread({ comment, shareToken, depth, parentUsername }: CommentThreadProps) {
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

  // Thread line shows when replies are expanded and visible
  const hasVisibleReplies = showReplies && !loadingReplies && replies.length > 0;

  return (
    <div>
      <CommentItem
        comment={comment}
        onReply={canReply ? () => setIsReplying(!isReplying) : undefined}
        onReact={user ? handleReaction : undefined}
        onEdit={user?.id === comment.author.id ? handleEdit : undefined}
        onDelete={user?.id === comment.author.id ? handleDelete : undefined}
        showThreadLine={hasVisibleReplies}
        replyingToUsername={depth > 0 ? parentUsername : undefined}
        replyCount={comment.reply_count}
      />

      {/* Reply count button */}
      {comment.reply_count > 0 && (
        <button
          onClick={handleShowReplies}
          className="ml-12 mt-1 text-[13px] font-medium text-muted-foreground/60 transition-colors hover:text-foreground sm:ml-[52px]"
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
        <p className="ml-12 mt-1.5 text-[11px] text-muted-foreground/40 sm:ml-[52px]">
          {t("threadLimitReached")}
        </p>
      )}

      {/* Reply composer — indented to align with replies */}
      {isReplying && (
        <div className="ml-12 mt-3 sm:ml-[52px]">
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
        <div className="ml-12 mt-4 space-y-4 sm:ml-[52px]">
          <CommentSkeleton />
          <CommentSkeleton />
        </div>
      )}

      {/* Replies */}
      {showReplies && !loadingReplies && (
        <div className="ml-12 mt-3 space-y-3 sm:ml-[52px]">
          {replies.map((reply) => (
            <CommentThread
              key={reply.id}
              comment={reply}
              shareToken={shareToken}
              depth={depth + 1}
              parentUsername={comment.author.username || undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
