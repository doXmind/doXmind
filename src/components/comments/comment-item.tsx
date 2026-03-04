"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import Image from "next/image";
import { CommentResponse } from "@/lib/api";
import { Reply, Pencil, Trash2, Heart } from "lucide-react";
import { EmojiReactionPicker } from "./emoji-reaction-picker";
import { MarkdownContent } from "./markdown-content";
import { Button } from "@/components/ui/button";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";

interface CommentItemProps {
  comment: CommentResponse;
  onReply?: () => void;
  onReact?: (emoji: string) => void;
  onEdit?: (content: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  showThreadLine?: boolean;
  replyingToUsername?: string;
  replyCount?: number;
}

export function CommentItem({
  comment,
  onReply,
  onReact,
  onEdit,
  onDelete,
  showThreadLine = false,
  replyingToUsername,
  replyCount = 0,
}: CommentItemProps) {
  const t = useTranslations("comments");
  const tc = useTranslations("common");
  const tCom = useTranslations("community");
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const timeAgo = getTimeAgo(comment.created_at, tCom);

  // Heart reaction shortcut — derive from existing reactions
  const heartReaction = comment.reactions.find((r) => r.emoji === "❤️");
  const heartReacted = heartReaction?.has_reacted ?? false;
  const heartCount = heartReaction?.count ?? 0;
  // Filter heart from reaction pills to avoid duplication
  const nonHeartReactions = comment.reactions.filter((r) => r.emoji !== "❤️");

  const handleSaveEdit = async () => {
    if (!editContent.trim() || !onEdit) return;
    await onEdit(editContent.trim());
    setIsEditing(false);
  };

  const handleConfirmDelete = async () => {
    if (!onDelete) return;
    setIsDeleting(true);
    await onDelete();
    setIsDeleting(false);
    setShowDeleteConfirm(false);
  };

  // Deleted comment — two-column layout with placeholder avatar
  if (comment.is_deleted) {
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center">
          <div className="h-9 w-9 rounded-full bg-muted sm:h-10 sm:w-10" />
          {showThreadLine && (
            <div className="mt-2 min-h-[20px] w-0.5 flex-1 rounded-full bg-border/40" />
          )}
        </div>
        <div className="flex-1 py-2 text-[13px] italic text-muted-foreground/50">
          {t("deleted")}
        </div>
      </div>
    );
  }

  return (
    <div className="group">
      <div className="flex gap-3">
        {/* LEFT COLUMN: Avatar + thread line */}
        <div className="flex flex-col items-center">
          <Link
            href={comment.author.id ? `/profile/${comment.author.id}` : "#"}
            className="flex-shrink-0 transition-opacity hover:opacity-80"
          >
            {comment.author.avatar_url ? (
              <Image
                src={comment.author.avatar_url}
                alt=""
                width={40}
                height={40}
                className="h-9 w-9 rounded-full ring-1 ring-border/50 sm:h-10 sm:w-10"
                unoptimized
              />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground ring-1 ring-border/50 sm:h-10 sm:w-10 sm:text-sm">
                {(comment.author.username || "?")[0].toUpperCase()}
              </div>
            )}
          </Link>
          {showThreadLine && (
            <div className="mt-2 min-h-[20px] w-0.5 flex-1 rounded-full bg-border/40" />
          )}
        </div>

        {/* RIGHT COLUMN: Content + actions */}
        <div className="min-w-0 flex-1">
          {/* Header: name · time · edited */}
          <div className="flex items-center gap-1.5">
            <Link
              href={comment.author.id ? `/profile/${comment.author.id}` : "#"}
              className="text-[14px] font-semibold text-foreground/90 transition-colors hover:underline"
            >
              {comment.author.username || tCom("anonymous")}
            </Link>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-[13px] text-muted-foreground/50">{timeAgo}</span>
            {comment.is_edited && (
              <span className="text-[11px] text-muted-foreground/40">{t("edited")}</span>
            )}
          </div>

          {/* Replying to indicator */}
          {replyingToUsername && (
            <p className="mt-0.5 text-[12px] text-muted-foreground/60">
              {t("replyingTo")} <span className="text-foreground/60">@{replyingToUsername}</span>
            </p>
          )}

          {/* Content */}
          {isEditing ? (
            <div className="mt-2 space-y-2">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-xl border border-border/60 bg-background px-4 py-3 text-sm text-foreground focus:border-foreground/20 focus:outline-none focus:ring-1 focus:ring-foreground/10"
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleSaveEdit}
                  className="h-7 rounded-lg px-3 text-[12px]"
                >
                  {tc("save")}
                </Button>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setEditContent(comment.content);
                  }}
                  className="rounded-lg px-3 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  {tc("cancel")}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-1">
              <MarkdownContent content={comment.content} />
            </div>
          )}

          {/* Reaction pills (excluding heart — heart is in the action bar) */}
          {nonHeartReactions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {nonHeartReactions.map((r) => (
                <button
                  key={r.emoji}
                  onClick={() => onReact?.(r.emoji)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] transition-all ${
                    r.has_reacted
                      ? "border-foreground/20 bg-foreground/5"
                      : "border-border/50 hover:border-border hover:bg-muted/50"
                  }`}
                >
                  <span>{r.emoji}</span>
                  <span className="text-muted-foreground">{r.count}</span>
                </button>
              ))}
            </div>
          )}

          {/* Action bar — X-style icons with counts */}
          {!isEditing && (onReact || onReply || onEdit || onDelete) && (
            <div className="-ml-2 mt-2 flex items-center">
              {/* Reply */}
              {onReply && (
                <button
                  onClick={onReply}
                  className="flex items-center gap-1 rounded-full px-2 py-1 text-muted-foreground/60 transition-colors hover:bg-blue-500/10 hover:text-blue-500"
                >
                  <Reply className="h-3.5 w-3.5" />
                  {replyCount > 0 && <span className="text-[12px]">{replyCount}</span>}
                </button>
              )}

              {/* Heart / Like */}
              {onReact && (
                <button
                  onClick={() => onReact("❤️")}
                  className={`flex items-center gap-1 rounded-full px-2 py-1 transition-colors ${
                    heartReacted
                      ? "text-rose-500"
                      : "text-muted-foreground/60 hover:bg-rose-500/10 hover:text-rose-500"
                  }`}
                >
                  <Heart className={`h-3.5 w-3.5 ${heartReacted ? "fill-current" : ""}`} />
                  {heartCount > 0 && <span className="text-[12px]">{heartCount}</span>}
                </button>
              )}

              {/* Emoji picker for other reactions */}
              {onReact && <EmojiReactionPicker onSelect={onReact} />}

              {/* Edit / Delete — hover-reveal on desktop */}
              {(onEdit || onDelete) && (
                <div className="ml-auto flex items-center gap-0.5 opacity-60 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                  {onEdit && (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="flex items-center rounded-full p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted/50 hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {onDelete && (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="flex items-center rounded-full p-1.5 text-destructive/50 transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation modal */}
      <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)}>
        <ModalHeader>{t("deleteConfirmTitle")}</ModalHeader>
        <p className="text-sm text-muted-foreground">{t("deleteConfirmMessage")}</p>
        <ModalFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDeleteConfirm(false)}
            disabled={isDeleting}
          >
            {tc("cancel")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleConfirmDelete}
            disabled={isDeleting}
          >
            {isDeleting ? t("deleting") : tc("delete")}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

function getTimeAgo(
  dateStr: string,
  t: (key: string, values?: Record<string, number>) => string
): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return t("justNow");
  if (diffMins < 60) return t("mAgo", { count: diffMins });

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return t("hAgo", { count: diffHours });

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return t("dAgo", { count: diffDays });

  return date.toLocaleDateString();
}
