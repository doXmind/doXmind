"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Send, Loader2 } from "lucide-react";

interface CommentComposerProps {
  onSubmit: (content: string) => Promise<void>;
  placeholder?: string;
  autoFocus?: boolean;
  onCancel?: () => void;
}

export function CommentComposer({
  onSubmit,
  placeholder = "Write a comment...",
  autoFocus = false,
  onCancel,
}: CommentComposerProps) {
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!content.trim()) return;

    setIsSubmitting(true);
    try {
      await onSubmit(content.trim());
      setContent("");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape" && onCancel) {
      onCancel();
    }
  };

  return (
    <div className="space-y-3">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={3}
        autoFocus={autoFocus}
        className="w-full resize-none rounded-xl border border-border/60 bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-foreground/20 focus:outline-none focus:ring-1 focus:ring-foreground/10"
      />
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground/50">
          **bold**, *italic*, `code`, lists supported · Ctrl+Enter to submit
        </p>
        <div className="flex gap-2">
          {onCancel && (
            <button
              onClick={onCancel}
              className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancel
            </button>
          )}
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!content.trim() || isSubmitting}
            className="h-8 gap-1.5 rounded-lg px-4 text-[13px]"
          >
            {isSubmitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Comment
          </Button>
        </div>
      </div>
    </div>
  );
}
