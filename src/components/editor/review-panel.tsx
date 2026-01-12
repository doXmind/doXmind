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
import { cn } from "@/lib/utils";
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
  const [expandedCategories, setExpandedCategories] = useState<
    Set<ReviewCategory>
  >(new Set(["correctness", "clarity", "tone", "engagement"]));
  const [pluginState, setPluginState] = useState(() =>
    TextReviewPluginKey.getState(editor.state)
  );

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
    <div className="w-80 border-l border-border bg-card flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">Writing Review</span>
          {pendingSuggestions.length > 0 && (
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
              {pendingSuggestions.length}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-7 w-7"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex-1 flex flex-col items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
          <span className="text-sm text-muted-foreground">
            Analyzing document...
          </span>
          <span className="text-xs text-muted-foreground mt-1">
            This may take a moment
          </span>
        </div>
      )}

      {/* Summary */}
      {!isLoading && summary && pendingSuggestions.length > 0 && (
        <div className="px-3 py-2 border-b border-border bg-muted/30">
          <p className="text-xs text-muted-foreground">{summary}</p>
        </div>
      )}

      {/* Suggestions List */}
      {!isLoading && pendingSuggestions.length > 0 && (
        <>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-2">
              {(Object.keys(REVIEW_CATEGORIES) as ReviewCategory[]).map(
                (category) => {
                  const items = groupedSuggestions[category] ?? [];
                  if (items.length === 0) return null;

                  const categoryInfo = REVIEW_CATEGORIES[category];
                  const isExpanded = expandedCategories.has(category);

                  return (
                    <div
                      key={category}
                      className="border border-border rounded-lg overflow-hidden"
                    >
                      <button
                        onClick={() => toggleCategory(category)}
                        className="w-full flex items-center gap-2 p-2 hover:bg-accent/50 transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: categoryInfo.color }}
                        />
                        <span className="text-sm font-medium flex-1 text-left">
                          {categoryInfo.label}
                        </span>
                        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
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
                }
              )}
            </div>
          </ScrollArea>

          {/* Footer Actions */}
          <div className="p-3 border-t border-border space-y-2">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={handleDismissAll}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Dismiss All
              </Button>
              <Button
                size="sm"
                className="flex-1 bg-green-600 hover:bg-green-700"
                onClick={handleAcceptAll}
              >
                <Check className="h-4 w-4 mr-1" />
                Accept All
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Empty State */}
      {!isLoading && pendingSuggestions.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-4">
          <Sparkles className="h-10 w-10 mb-3 opacity-40" />
          <p className="text-sm font-medium">No suggestions</p>
          <p className="text-xs text-center mt-1">
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
      className="p-3 hover:bg-accent/30 cursor-pointer transition-colors border-b border-border last:border-b-0 group"
      onClick={onNavigate}
    >
      {/* Type label */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded"
          style={{
            backgroundColor: `${category.color}15`,
            color: category.color,
          }}
        >
          {suggestion.type.replace(/_/g, " ")}
        </span>
      </div>

      {/* Original -> Replacement */}
      <div className="flex items-center gap-2 mb-2 text-sm flex-wrap">
        <span className="line-through text-red-500/80 bg-red-500/10 px-1.5 py-0.5 rounded text-xs">
          {suggestion.originalText.length > 50
            ? suggestion.originalText.slice(0, 50) + "..."
            : suggestion.originalText}
        </span>
        <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
        <span className="text-green-600 dark:text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded text-xs">
          {suggestion.replacement.length > 50
            ? suggestion.replacement.slice(0, 50) + "..."
            : suggestion.replacement}
        </span>
      </div>

      {/* Explanation */}
      <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
        {suggestion.explanation}
      </p>

      {/* Actions */}
      <div
        className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={onDismiss}
        >
          Dismiss
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs bg-green-600 hover:bg-green-700"
          onClick={onAccept}
        >
          <Check className="h-3 w-3 mr-1" />
          Accept
        </Button>
      </div>
    </div>
  );
}
