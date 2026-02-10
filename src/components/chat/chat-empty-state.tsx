"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface Suggestion {
  label: string;
  prompt: string;
}

interface ChatEmptyStateProps {
  greeting?: string;
  subtitle?: string;
  suggestions: Suggestion[];
  onSelectSuggestion: (prompt: string) => void;
  className?: string;
}

/**
 * Centered empty state with greeting and suggestion grid.
 */
export function ChatEmptyState({
  greeting = "How can I help?",
  subtitle = "Ask me to write, edit, or improve your document.",
  suggestions,
  onSelectSuggestion,
  className,
}: ChatEmptyStateProps) {
  return (
    <div className={cn("flex h-full flex-col items-center justify-center px-4 py-8", className)}>
      <Sparkles className="mb-4 h-8 w-8 text-muted-foreground/30" />
      <h3 className="mb-1 text-lg font-medium">{greeting}</h3>
      <p className="mb-6 max-w-[250px] text-center text-sm text-muted-foreground">{subtitle}</p>
      <div className="grid w-full max-w-sm grid-cols-1 gap-2 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button
            key={s.prompt}
            type="button"
            onClick={() => onSelectSuggestion(s.prompt)}
            className="rounded-xl border border-border/60 px-3 py-2.5 text-left text-xs text-foreground transition-all hover:bg-accent/50 active:scale-[0.98]"
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
