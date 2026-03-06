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
  const [activeSuggestion, setActiveSuggestion] = useState<ReviewSuggestion | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [flipped, setFlipped] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const suggestionRectRef = useRef<DOMRect | null>(null);

  const closePopup = useCallback(
    (syncEditor = true) => {
      setActiveSuggestion(null);
      setPosition(null);
      setFlipped(false);
      if (syncEditor) {
        const pluginState = TextReviewPluginKey.getState(editor.state);
        if (pluginState?.activeSuggestionId) {
          editor.commands.setActiveSuggestion(null);
        }
      }
    },
    [editor]
  );

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
        closePopup();
        return;
      }

      const suggestionId = suggestionEl.getAttribute("data-review-id");
      if (!suggestionId) {
        return;
      }

      // Get suggestion data from plugin state
      const pluginState = TextReviewPluginKey.getState(editor.state);
      const suggestion = pluginState?.suggestions.find((s) => s.id === suggestionId);

      if (suggestion && suggestion.status === "pending") {
        setActiveSuggestion(suggestion);

        // Set active in editor state for highlighting
        editor.commands.setActiveSuggestion(suggestion.id);

        // Position popup below the suggestion
        const rect = suggestionEl.getBoundingClientRect();
        suggestionRectRef.current = rect;
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

        // Default: position below. Will be adjusted in useEffect if it overflows.
        setFlipped(false);
        setPosition({ x, y: rect.bottom + 6 });
      }
    };

    // Close popup on scroll
    const handleScroll = () => {
      closePopup();
    };

    // Close popup on escape key
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closePopup();
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
  }, [editor, closePopup]);

  // Keep popup synced with editor state (e.g. Accept All / Dismiss All)
  useEffect(() => {
    if (!activeSuggestion) return;

    const syncWithReviewState = () => {
      const pluginState = TextReviewPluginKey.getState(editor.state);
      const isStillPending = pluginState?.suggestions.some(
        (s) => s.id === activeSuggestion.id && s.status === "pending"
      );

      if (!isStillPending) {
        // Avoid dispatching another transaction here; this listener itself runs on transaction.
        closePopup(false);
      }
    };

    editor.on("transaction", syncWithReviewState);
    return () => {
      editor.off("transaction", syncWithReviewState);
    };
  }, [editor, activeSuggestion, closePopup]);

  // Flip popup above if it overflows viewport bottom
  useEffect(() => {
    if (!position || !popupRef.current || !suggestionRectRef.current) return;
    const popupHeight = popupRef.current.offsetHeight;
    const viewportHeight = window.innerHeight;
    const rect = suggestionRectRef.current;

    if (position.y + popupHeight > viewportHeight - 8 && !flipped) {
      // Not enough room below — flip above the suggestion
      setFlipped(true);
      setPosition({ x: position.x, y: rect.top - popupHeight - 6 });
    }
  }, [position, flipped]);

  // Handle accept
  const handleAccept = useCallback(() => {
    if (!activeSuggestion) return;
    editor.commands.acceptSuggestion(activeSuggestion.id);
    closePopup();
  }, [editor, activeSuggestion, closePopup]);

  // Handle dismiss
  const handleDismiss = useCallback(() => {
    if (!activeSuggestion) return;
    editor.commands.dismissSuggestion(activeSuggestion.id);
    closePopup();
  }, [editor, activeSuggestion, closePopup]);

  // Handle close
  const handleClose = useCallback(() => {
    closePopup();
  }, [closePopup]);

  if (!activeSuggestion || !position) return null;

  const category = REVIEW_CATEGORIES[activeSuggestion.category];

  return (
    <div
      ref={popupRef}
      className="review-popup fixed z-50 w-[calc(100vw-2rem)] max-w-[340px] rounded-lg border border-border bg-popover shadow-lg"
      style={{ left: position.x, top: position.y }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: category.color }} />
          <span className="text-sm font-medium">{category.label}</span>
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
            style={{
              backgroundColor: `${category.color}15`,
              color: category.color,
            }}
          >
            {activeSuggestion.type.replace(/_/g, " ")}
          </span>
        </div>
        <Button variant="ghost" size="icon" onClick={handleClose} className="h-6 w-6">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="p-3">
        {/* Original -> Replacement */}
        <div className="mb-3 flex items-start gap-2">
          <span className="max-w-[45%] break-words rounded bg-red-500/10 px-2 py-1 text-sm text-red-500/80 line-through">
            {activeSuggestion.originalText}
          </span>
          <ArrowRight className="mt-1.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <span className="max-w-[45%] break-words rounded bg-green-500/10 px-2 py-1 text-sm text-green-600 dark:text-green-400">
            {activeSuggestion.replacement}
          </span>
        </div>

        {/* Explanation */}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {activeSuggestion.explanation}
        </p>
      </div>

      {/* Actions */}
      <div className="flex gap-2 p-3 pt-0">
        <Button variant="ghost" size="sm" onClick={handleDismiss} className="flex-1">
          Dismiss
        </Button>
        <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700" onClick={handleAccept}>
          <Check className="mr-1 h-4 w-4" />
          Accept
        </Button>
      </div>
    </div>
  );
}
