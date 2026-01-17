"use client";

import { useCallback, useRef } from "react";
import { Editor } from "@tiptap/react";
import {
  extractTextWithPositions,
  mapOffsetToPosition,
} from "@/extensions/spellcheck-extension";
import type {
  ReviewSuggestion,
  ReviewCategory,
} from "@/extensions/text-review-extension";
import {
  processSSEStream,
  isAbortError,
  createStreamController,
} from "@/lib/streaming";
import { API_BASE_URL, MIN_REVIEW_DOCUMENT_LENGTH } from "@/lib/constants";
import { api } from "@/lib/api";

interface UseTextReviewOptions {
  editor: Editor | null;
  fileId: string;
  onReviewStart?: () => void;
  onReviewComplete?: (count: number, summary: string) => void;
  onReviewError?: (error: string) => void;
}

interface ReviewResult {
  suggestions: ReviewSuggestion[];
  summary: string;
}

interface APISuggestion {
  category: string;
  type: string;
  original_text: string;
  replacement: string;
  explanation: string;
  start_offset: number;
  end_offset: number;
}

interface ReviewStreamEvent {
  result?: { suggestions: APISuggestion[]; summary: string };
  error?: string;
}

export function useTextReview({
  editor,
  fileId,
  onReviewStart,
  onReviewComplete,
  onReviewError,
}: UseTextReviewOptions) {
  const streamControllerRef = useRef(createStreamController());
  const isReviewingRef = useRef(false);

  const triggerReview = useCallback(async (): Promise<ReviewResult | null> => {
    if (!editor) {
      return null;
    }

    if (isReviewingRef.current) {
      return null;
    }

    // Extract text with position mapping
    const { text, posMap } = extractTextWithPositions(editor.state.doc);

    if (text.trim().length < MIN_REVIEW_DOCUMENT_LENGTH) {
      return null;
    }

    const signal = streamControllerRef.current.start();
    isReviewingRef.current = true;

    // Set loading state
    editor.commands.setReviewLoading(true);
    onReviewStart?.();

    let result: { suggestions: APISuggestion[]; summary: string } | null = null;

    try {
      const response = await fetch(`${API_BASE_URL}/api/review/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...api.getAuthorizationHeaders(),
        },
        body: JSON.stringify({
          content: text,
          file_id: fileId,
        }),
        signal,
      });

      if (!response.ok) {
        throw new Error(`Review request failed: ${response.status}`);
      }

      await processSSEStream<ReviewStreamEvent>(response, (event) => {
        if (event.result) {
          result = event.result;
        }
        if (event.error) {
          throw new Error(event.error);
        }
      });

      if (result) {
        const docSize = editor.state.doc.content.size;

        // Convert API suggestions to ReviewSuggestions with mapped positions
        const suggestions: ReviewSuggestion[] = (result as { suggestions: APISuggestion[]; summary: string }).suggestions
          .map((s: APISuggestion, index: number): ReviewSuggestion | null => {
            // Map text offsets to ProseMirror positions
            const from = mapOffsetToPosition(posMap, s.start_offset);
            const to = mapOffsetToPosition(posMap, s.end_offset);

            // Validate positions
            if (from >= to || to > docSize || from < 0) {
              return null;
            }

            // Verify the category is valid
            const validCategories: ReviewCategory[] = [
              "correctness",
              "clarity",
              "tone",
              "engagement",
            ];
            const category = validCategories.includes(s.category as ReviewCategory)
              ? (s.category as ReviewCategory)
              : "correctness";

            return {
              id: `review-${index}-${s.start_offset}`,
              category,
              type: s.type || "general",
              from,
              to,
              originalText: s.original_text,
              replacement: s.replacement,
              explanation: s.explanation,
              status: "pending",
            };
          })
          .filter(
            (s: ReviewSuggestion | null): s is ReviewSuggestion => s !== null
          );

        // Set suggestions in editor
        editor.commands.setReviewSuggestions(suggestions, (result as { suggestions: APISuggestion[]; summary: string }).summary);

        const reviewResult: ReviewResult = {
          suggestions,
          summary: (result as { suggestions: APISuggestion[]; summary: string }).summary,
        };

        onReviewComplete?.(suggestions.length, (result as { suggestions: APISuggestion[]; summary: string }).summary);

        isReviewingRef.current = false;
        return reviewResult;
      }

      isReviewingRef.current = false;
      return null;
    } catch (error) {
      isReviewingRef.current = false;

      if (isAbortError(error)) {
        return null;
      }
      editor.commands.setReviewLoading(false);
      onReviewError?.((error as Error).message);
      return null;
    }
  }, [editor, fileId, onReviewStart, onReviewComplete, onReviewError]);

  const clearReview = useCallback(() => {
    streamControllerRef.current.abort();
    isReviewingRef.current = false;
    editor?.commands.clearReview();
  }, [editor]);

  const acceptAll = useCallback(() => {
    editor?.commands.acceptAllSuggestions();
  }, [editor]);

  const dismissAll = useCallback(() => {
    editor?.commands.dismissAllSuggestions();
  }, [editor]);

  return {
    triggerReview,
    clearReview,
    acceptAll,
    dismissAll,
    isReviewing: isReviewingRef.current,
  };
}
