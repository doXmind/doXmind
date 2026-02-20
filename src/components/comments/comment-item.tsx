"use client";

import { useState } from "react";
import Link from "next/link";
import { CommentResponse } from "@/lib/api";
import { Reply, Pencil, Trash2 } from "lucide-react";
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
}

export function CommentItem({ comment, onReply, onReact, onEdit, onDelete }: CommentItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const timeAgo = getTimeAgo(comment.created_at);

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

  if (comment.is_deleted) {
    return <div className="py-2 text-[13px] italic text-muted-foreground/50">[deleted]</div>;
  }

  return (
    <div className="group">
      {/* Author line */}
      <div className="flex items-center gap-2">
        <Link
          href={comment.author.id ? `/profile/${comment.author.id}` : "#"}
          className="flex items-center gap-2 transition-colors hover:opacity-80"
        >
          {comment.author.avatar_url ? (
            <img
              src={comment.author.avatar_url}
              alt=""
              className="h-6 w-6 rounded-full ring-1 ring-border/50"
            />
          ) : (
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground ring-1 ring-border/50">
              {(comment.author.username || "?")[0].toUpperCase()}
            </div>
          )}
          <span className="text-[13px] font-medium text-foreground/80">
            {comment.author.username || "Anonymous"}
          </span>
        </Link>
        <span className="text-[12px] text-muted-foreground/50">{timeAgo}</span>
        {comment.is_edited && (
          <span className="text-[11px] text-muted-foreground/40">(edited)</span>
        )}
      </div>

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
            <Button size="sm" onClick={handleSaveEdit} className="h-7 rounded-lg px-3 text-[12px]">
              Save
            </Button>
            <button
              onClick={() => {
                setIsEditing(false);
                setEditContent(comment.content);
              }}
              className="rounded-lg px-3 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-1.5 pl-8">
          <MarkdownContent content={comment.content} />
        </div>
      )}

      {/* Reactions */}
      {comment.reactions.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1 pl-8">
          {comment.reactions.map((r) => (
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

      {/* Actions — visible on mobile, hover-reveal on desktop */}
      {!isEditing && (onReact || onReply || onEdit || onDelete) && (
        <div className="mt-1.5 flex items-center gap-1 pl-8 opacity-60 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100">
          {onReact && <EmojiReactionPicker onSelect={onReact} />}

          {onReply && (
            <button
              onClick={onReply}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted-foreground/60 transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              <Reply className="h-3 w-3" />
              Reply
            </button>
          )}

          {onEdit && (
            <button
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted-foreground/60 transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
          )}

          {onDelete && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-destructive/50 transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
          )}
        </div>
      )}

      {/* Delete confirmation modal */}
      <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)}>
        <ModalHeader>Delete comment</ModalHeader>
        <p className="text-sm text-muted-foreground">
          Are you sure you want to delete this comment? This action cannot be undone.
        </p>
        <ModalFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDeleteConfirm(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleConfirmDelete}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

function getTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}
