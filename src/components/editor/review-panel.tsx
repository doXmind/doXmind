"use client";

import { useState, useCallback, useEffect } from "react";
import { Editor } from "@tiptap/react";
import {
  X,
  Check,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Loader2,
  ArrowRight,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  REVIEW_CATEGORIES,
  ReviewCategory,
  ReviewSuggestion,
  TextReviewPluginKey,
} from "@/extensions/text-review-extension";

interface ReviewPanelProps {
  editor: Editor;
  isOpen: boolean;
  onClose: () => void;
}

export function ReviewPanel({ editor, isOpen, onClose }: ReviewPanelProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<ReviewCategory>>(
    new Set(["correctness", "clarity", "tone", "engagement"])
  );
  const [pluginState, setPluginState] = useState(() => TextReviewPluginKey.getState(editor.state));

  // Subscribe to editor state changes
  useEffect(() => {
    const updateState = () => {
      setPluginState(TextReviewPluginKey.getState(editor.state));
    };

    editor.on("transaction", updateState);
    return () => {
      editor.off("transaction", updateState);
    };
  }, [editor]);

  const suggestions = pluginState?.suggestions ?? [];
  const isLoading = pluginState?.isLoading ?? false;
  const summary = pluginState?.summary;
  const pendingSuggestions = suggestions.filter((s) => s.status === "pending");

  // Group by category
  const groupedSuggestions = pendingSuggestions.reduce(
    (acc, s) => {
      if (!acc[s.category]) acc[s.category] = [];
      acc[s.category].push(s);
      return acc;
    },
    {} as Record<ReviewCategory, ReviewSuggestion[]>
  );

  const handleAccept = useCallback(
    (id: string) => {
      editor.commands.acceptSuggestion(id);
    },
    [editor]
  );

  const handleDismiss = useCallback(
    (id: string) => {
      editor.commands.dismissSuggestion(id);
    },
    [editor]
  );

  const handleAcceptAll = useCallback(() => {
    editor.commands.acceptAllSuggestions();
  }, [editor]);

  const handleDismissAll = useCallback(() => {
    editor.commands.dismissAllSuggestions();
    onClose();
  }, [editor, onClose]);

  const handleNavigate = useCallback(
    (suggestion: ReviewSuggestion) => {
      // Highlight the suggestion
      editor.commands.setActiveSuggestion(suggestion.id);

      // Scroll to and select the suggestion in editor
      editor
        .chain()
        .focus()
        .setTextSelection({
          from: suggestion.from,
          to: suggestion.to,
        })
        .scrollIntoView()
        .run();
    },
    [editor]
  );

  const toggleCategory = (category: ReviewCategory) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  if (!isOpen) return null;

  return (
    <div className="flex h-full w-80 flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border p-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Writing Review</span>
          {pendingSuggestions.length > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {pendingSuggestions.length}
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex flex-1 flex-col items-center justify-center py-8">
          <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Analyzing document...</span>
          <span className="mt-1 text-xs text-muted-foreground">This may take a moment</span>
        </div>
      )}

      {/* Summary */}
      {!isLoading && summary && pendingSuggestions.length > 0 && (
        <div className="border-b border-border bg-muted/30 px-3 py-2">
          <p className="text-xs text-muted-foreground">{summary}</p>
        </div>
      )}

      {/* Suggestions List */}
      {!isLoading && pendingSuggestions.length > 0 && (
        <>
          <ScrollArea className="flex-1">
            <div className="space-y-2 p-2">
              {(Object.keys(REVIEW_CATEGORIES) as ReviewCategory[]).map((category) => {
                const items = groupedSuggestions[category] ?? [];
                if (items.length === 0) return null;

                const categoryInfo = REVIEW_CATEGORIES[category];
                const isExpanded = expandedCategories.has(category);

                return (
                  <div key={category} className="overflow-hidden rounded-lg border border-border">
                    <button
                      onClick={() => toggleCategory(category)}
                      className="flex w-full items-center gap-2 p-2 transition-colors hover:bg-accent/50"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <div
                        className="h-3 w-3 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: categoryInfo.color }}
                      />
                      <span className="flex-1 text-left text-sm font-medium">
                        {categoryInfo.label}
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        {items.length}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-border">
                        {items.map((suggestion) => (
                          <SuggestionCard
                            key={suggestion.id}
                            suggestion={suggestion}
                            onAccept={() => handleAccept(suggestion.id)}
                            onDismiss={() => handleDismiss(suggestion.id)}
                            onNavigate={() => handleNavigate(suggestion)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          {/* Footer Actions */}
          <div className="space-y-2 border-t border-border p-3">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={handleDismissAll}>
                <Trash2 className="mr-1 h-4 w-4" />
                Dismiss All
              </Button>
              <Button
                size="sm"
                className="flex-1 bg-green-600 hover:bg-green-700"
                onClick={handleAcceptAll}
              >
                <Check className="mr-1 h-4 w-4" />
                Accept All
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Empty State */}
      {!isLoading && pendingSuggestions.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center p-4 text-muted-foreground">
          <Sparkles className="mb-3 h-10 w-10 opacity-40" />
          <p className="text-sm font-medium">No suggestions</p>
          <p className="mt-1 text-center text-xs">
            {suggestions.length > 0
              ? "All suggestions have been reviewed"
              : "Your writing looks great!"}
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={onClose}>
            Close
          </Button>
        </div>
      )}
    </div>
  );
}

// Individual suggestion card
function SuggestionCard({
  suggestion,
  onAccept,
  onDismiss,
  onNavigate,
}: {
  suggestion: ReviewSuggestion;
  onAccept: () => void;
  onDismiss: () => void;
  onNavigate: () => void;
}) {
  const category = REVIEW_CATEGORIES[suggestion.category];

  return (
    <div
      className="group cursor-pointer border-b border-border p-3 transition-colors last:border-b-0 hover:bg-accent/30"
      onClick={onNavigate}
    >
      {/* Type label */}
      <div className="mb-2 flex items-center gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
          style={{
            backgroundColor: `${category.color}15`,
            color: category.color,
          }}
        >
          {suggestion.type.replace(/_/g, " ")}
        </span>
      </div>

      {/* Original -> Replacement */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-xs text-red-500/80 line-through">
          {suggestion.originalText.length > 50
            ? suggestion.originalText.slice(0, 50) + "..."
            : suggestion.originalText}
        </span>
        <ArrowRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
        <span className="rounded bg-green-500/10 px-1.5 py-0.5 text-xs text-green-600 dark:text-green-400">
          {suggestion.replacement.length > 50
            ? suggestion.replacement.slice(0, 50) + "..."
            : suggestion.replacement}
        </span>
      </div>

      {/* Explanation */}
      <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">{suggestion.explanation}</p>

      {/* Actions */}
      <div
        className="flex gap-2 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onDismiss}>
          Dismiss
        </Button>
        <Button
          size="sm"
          className="h-7 bg-green-600 text-xs hover:bg-green-700"
          onClick={onAccept}
        >
          <Check className="mr-1 h-3 w-3" />
          Accept
        </Button>
      </div>
    </div>
  );
}
