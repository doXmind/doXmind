"use client";

import { useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { useCommunityStore } from "@/stores/community-store";
import { api } from "@/lib/api";
import { EmojiReactionPicker } from "@/components/comments/emoji-reaction-picker";

interface ReactionItem {
  emoji: string;
  count: number;
  has_reacted: boolean;
}

interface ShareReactionsProps {
  shareToken: string;
  reactions: ReactionItem[];
}

export function ShareReactions({ shareToken, reactions: initial }: ShareReactionsProps) {
  const user = useAuthStore((s) => s.user);
  const [reactions, setReactions] = useState<ReactionItem[]>(initial);

  const handleReact = async (emoji: string) => {
    if (!user) return;

    // Optimistic update
    setReactions((prev) => {
      const existing = prev.find((r) => r.emoji === emoji);
      if (existing) {
        if (existing.has_reacted) {
          // Remove our reaction
          return existing.count === 1
            ? prev.filter((r) => r.emoji !== emoji)
            : prev.map((r) =>
                r.emoji === emoji ? { ...r, count: r.count - 1, has_reacted: false } : r
              );
        } else {
          // Add our reaction to existing emoji
          return prev.map((r) =>
            r.emoji === emoji ? { ...r, count: r.count + 1, has_reacted: true } : r
          );
        }
      }
      // New emoji
      return [...prev, { emoji, count: 1, has_reacted: true }];
    });

    try {
      const res = await api.toggleShareReaction(shareToken, emoji);
      setReactions(res.reactions);
      // Sync back to community store so feed cards stay in sync
      useCommunityStore.getState().updateItemReactions(shareToken, res.reactions);
    } catch {
      // Revert on error
      setReactions(initial);
    }
  };

  if (reactions.length === 0 && !user) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-1"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {reactions.map((r) => (
        <button
          key={r.emoji}
          onClick={() => handleReact(r.emoji)}
          disabled={!user}
          className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] transition-all ${
            r.has_reacted
              ? "border-foreground/20 bg-foreground/5"
              : "border-border/50 hover:border-border hover:bg-muted/50"
          } ${!user ? "cursor-default" : "cursor-pointer"}`}
        >
          <span>{r.emoji}</span>
          <span className="text-muted-foreground">{r.count}</span>
        </button>
      ))}
      {user && <EmojiReactionPicker onSelect={handleReact} />}
    </div>
  );
}
