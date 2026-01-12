"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Editor } from "@tiptap/react";
import { X, Check, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  REVIEW_CATEGORIES,
  TextReviewPluginKey,
  type ReviewSuggestion,
} from "@/extensions/text-review-extension";

interface ReviewPopupProps {
  editor: Editor;
}

export function ReviewPopup({ editor }: ReviewPopupProps) {
  const [activeSuggestion, setActiveSuggestion] =
    useState<ReviewSuggestion | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null
  );
  const popupRef = useRef<HTMLDivElement>(null);

  // Handle click on review suggestion
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // Check if clicking inside the popup
      if (popupRef.current?.contains(target)) {
        return;
      }

      // Check if clicking on a review suggestion
      const suggestionEl = target.closest(".review-suggestion");

      if (!suggestionEl) {
        setActiveSuggestion(null);
        setPosition(null);
        return;
      }

      const suggestionId = suggestionEl.getAttribute("data-review-id");
      if (!suggestionId) {
        return;
      }

      // Get suggestion data from plugin state
      const pluginState = TextReviewPluginKey.getState(editor.state);
      const suggestion = pluginState?.suggestions.find(
        (s) => s.id === suggestionId
      );

      if (suggestion && suggestion.status === "pending") {
        setActiveSuggestion(suggestion);

        // Set active in editor state for highlighting
        editor.commands.setActiveSuggestion(suggestion.id);

        // Position popup below the suggestion
        const rect = suggestionEl.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const popupWidth = 340; // Approximate popup width

        // Calculate x position, ensuring it stays within viewport
        let x = rect.left;
        if (x + popupWidth > viewportWidth - 16) {
          x = viewportWidth - popupWidth - 16;
        }
        if (x < 16) {
          x = 16;
        }

        setPosition({ x, y: rect.bottom + 6 });
      }
    };

    // Close popup on scroll
    const handleScroll = () => {
      setActiveSuggestion(null);
      setPosition(null);
    };

    // Close popup on escape key
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveSuggestion(null);
        setPosition(null);
        editor.commands.setActiveSuggestion(null);
      }
    };

    const editorDom = editor.view.dom;
    editorDom.addEventListener("click", handleClick);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      editorDom.removeEventListener("click", handleClick);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [editor]);

  // Handle accept
  const handleAccept = useCallback(() => {
    if (!activeSuggestion) return;
    editor.commands.acceptSuggestion(activeSuggestion.id);
    setActiveSuggestion(null);
    setPosition(null);
  }, [editor, activeSuggestion]);

  // Handle dismiss
  const handleDismiss = useCallback(() => {
    if (!activeSuggestion) return;
    editor.commands.dismissSuggestion(activeSuggestion.id);
    setActiveSuggestion(null);
    setPosition(null);
  }, [editor, activeSuggestion]);

  // Handle close
  const handleClose = useCallback(() => {
    setActiveSuggestion(null);
    setPosition(null);
    editor.commands.setActiveSuggestion(null);
  }, [editor]);

  if (!activeSuggestion || !position) return null;

  const category = REVIEW_CATEGORIES[activeSuggestion.category];

  return (
    <div
      ref={popupRef}
      className="fixed z-50 bg-popover border border-border rounded-lg shadow-lg w-[340px] review-popup"
      style={{ left: position.x, top: position.y }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: category.color }}
          />
          <span className="text-sm font-medium">{category.label}</span>
          <span
            className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: `${category.color}15`,
              color: category.color,
            }}
          >
            {activeSuggestion.type.replace(/_/g, " ")}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClose}
          className="h-6 w-6"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="p-3">
        {/* Original -> Replacement */}
        <div className="flex items-start gap-2 mb-3">
          <span className="line-through text-red-500/80 bg-red-500/10 px-2 py-1 rounded text-sm max-w-[45%] break-words">
            {activeSuggestion.originalText}
          </span>
          <ArrowRight className="h-4 w-4 text-muted-foreground mt-1.5 flex-shrink-0" />
          <span className="text-green-600 dark:text-green-400 bg-green-500/10 px-2 py-1 rounded text-sm max-w-[45%] break-words">
            {activeSuggestion.replacement}
          </span>
        </div>

        {/* Explanation */}
        <p className="text-xs text-muted-foreground leading-relaxed">
          {activeSuggestion.explanation}
        </p>
      </div>

      {/* Actions */}
      <div className="flex gap-2 p-3 pt-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDismiss}
          className="flex-1"
        >
          Dismiss
        </Button>
        <Button
          size="sm"
          className="flex-1 bg-green-600 hover:bg-green-700"
          onClick={handleAccept}
        >
          <Check className="h-4 w-4 mr-1" />
          Accept
        </Button>
      </div>
    </div>
  );
}
