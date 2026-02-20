"use client";

import { useEffect } from "react";
import { useCommentsStore } from "@/stores/comments-store";
import { useAuthStore } from "@/stores/auth-store";
import { CommentComposer } from "./comment-composer";
import { CommentThread } from "./comment-thread";
import { Loader2 } from "lucide-react";

interface CommentsSectionProps {
  shareToken: string;
  commentCount: number;
}

const SORT_OPTIONS = [
  { value: "oldest" as const, label: "Oldest" },
  { value: "newest" as const, label: "Newest" },
];

export function CommentsSection({ shareToken, commentCount }: CommentsSectionProps) {
  const user = useAuthStore((s) => s.user);
  const {
    comments,
    isLoading,
    isLoadingMore,
    hasMore,
    sort,
    loadComments,
    loadMoreComments,
    setSort,
    addComment,
  } = useCommentsStore();

  useEffect(() => {
    loadComments(shareToken);
    return () => {
      useCommentsStore.getState().reset();
    };
  }, [shareToken, loadComments]);

  const handleSubmit = async (content: string) => {
    await addComment(shareToken, content);
  };

  return (
    <div>
      {/* Header with sort */}
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
          Comments
          {commentCount > 0 && (
            <span className="ml-2 text-muted-foreground/60">{commentCount}</span>
          )}
        </h2>

        {comments.length > 1 && (
          <div className="flex gap-0.5 rounded-md border border-border/50 bg-muted/30 p-0.5">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setSort(option.value)}
                className={`rounded px-2.5 py-1 text-[11px] font-medium transition-all ${
                  sort === option.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      {user ? (
        <div className="mt-5">
          <CommentComposer onSubmit={handleSubmit} placeholder="Write a comment..." />
        </div>
      ) : (
        <p className="mt-4 text-[13px] text-muted-foreground">Sign in to leave a comment.</p>
      )}

      {/* Comments list */}
      <div className="mt-8 space-y-5">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/50" />
          </div>
        ) : comments.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted-foreground/60">
            No comments yet. Start the conversation.
          </p>
        ) : (
          comments.map((comment) => (
            <CommentThread key={comment.id} comment={comment} shareToken={shareToken} depth={0} />
          ))
        )}
      </div>

      {/* Load more */}
      {hasMore && !isLoading && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={loadMoreComments}
            disabled={isLoadingMore}
            className="flex items-center gap-2 rounded-lg border border-border/60 px-6 py-2 text-[13px] font-medium text-muted-foreground transition-all hover:border-foreground/20 hover:text-foreground disabled:opacity-50"
          >
            {isLoadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Load more comments
          </button>
        </div>
      )}
    </div>
  );
}
