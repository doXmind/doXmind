"use client";

import { useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import type { ReviewSuggestion, ReviewCategory } from "@/extensions/text-review-extension";
import { extractTextWithPositions, mapOffsetToPosition } from "@/extensions/spellcheck-extension";

/**
 * Predefined review suggestions for the demo document.
 * Each suggestion maps to specific text in DEMO_DOCUMENT_CONTENT.
 */
interface MockSuggestionDef {
  searchText: string;
  category: ReviewCategory;
  type: string;
  replacement: string;
  explanation: string;
}

const MOCK_SUGGESTIONS: MockSuggestionDef[] = [
  {
    searchText: "that help users",
    category: "correctness",
    type: "grammar",
    replacement: "that helps users",
    explanation: "Subject-verb agreement: 'assistant' is singular and requires 'helps'.",
  },
  {
    searchText: "more efficently",
    category: "correctness",
    type: "spelling",
    replacement: "more efficiently",
    explanation: "Spelling correction: 'efficently' should be 'efficiently'.",
  },
  {
    searchText: "Writers block",
    category: "correctness",
    type: "punctuation",
    replacement: "Writer's block",
    explanation: "Missing apostrophe: 'Writer's block' shows possession.",
  },
  {
    searchText: "Unclear or verbose expressions",
    category: "clarity",
    type: "conciseness",
    replacement: "Unclear or wordy expressions",
    explanation: "Consider using 'wordy' instead of 'verbose' for better readability.",
  },
  {
    searchText: "with the following features",
    category: "clarity",
    type: "conciseness",
    replacement: "featuring",
    explanation: "Simplify: 'featuring' is more concise than 'with the following features'.",
  },
  {
    searchText: "will revolutionize",
    category: "tone",
    type: "formality",
    replacement: "will transform",
    explanation: "Consider 'transform' for a less hyperbolic tone in formal writing.",
  },
  {
    searchText: "intelligent, context-aware",
    category: "engagement",
    type: "word-choice",
    replacement: "smart, contextual",
    explanation: "Consider shorter alternatives for better flow and engagement.",
  },
];

const MOCK_SUMMARY = `Found ${MOCK_SUGGESTIONS.length} suggestions: 3 correctness issues (grammar, spelling, punctuation), 2 clarity improvements, 1 tone adjustment, and 1 engagement enhancement.`;

interface UseMockTextReviewOptions {
  editor: Editor | null;
  fileId: string;
  onReviewStart?: () => void;
  onReviewComplete?: (count: number, summary: string) => void;
  onReviewError?: (error: string) => void;
}

/**
 * Mock text review hook for demo mode.
 * Returns predefined suggestions without making API calls.
 */
export function useMockTextReview({
  editor,
  fileId: _fileId,
  onReviewStart,
  onReviewComplete,
  onReviewError,
}: UseMockTextReviewOptions) {
  const isReviewingRef = useRef(false);
  const abortRef = useRef(false);

  const triggerReview = useCallback(async () => {
    if (!editor) return null;
    if (isReviewingRef.current) return null;

    isReviewingRef.current = true;
    abortRef.current = false;

    // Set loading state
    editor.commands.setReviewLoading(true);
    onReviewStart?.();

    // Simulate processing delay (800-1500ms)
    const delay = 800 + Math.random() * 700;
    await new Promise((r) => setTimeout(r, delay));

    if (abortRef.current) {
      editor.commands.setReviewLoading(false);
      isReviewingRef.current = false;
      return null;
    }

    try {
      // Extract text with position mapping
      const { text, posMap } = extractTextWithPositions(editor.state.doc);
      const docSize = editor.state.doc.content.size;

      // Find suggestions in the document
      const suggestions: ReviewSuggestion[] = [];

      for (let i = 0; i < MOCK_SUGGESTIONS.length; i++) {
        const mockSuggestion = MOCK_SUGGESTIONS[i];
        const textIndex = text.indexOf(mockSuggestion.searchText);

        if (textIndex === -1) continue;

        const from = mapOffsetToPosition(posMap, textIndex);
        const to = mapOffsetToPosition(posMap, textIndex + mockSuggestion.searchText.length);

        // Validate positions
        if (from >= to || to > docSize || from < 0) continue;

        suggestions.push({
          id: `mock-review-${i}-${textIndex}`,
          category: mockSuggestion.category,
          type: mockSuggestion.type,
          from,
          to,
          originalText: mockSuggestion.searchText,
          replacement: mockSuggestion.replacement,
          explanation: mockSuggestion.explanation,
          status: "pending",
        });
      }

      // Set suggestions in editor
      editor.commands.setReviewSuggestions(suggestions, MOCK_SUMMARY);

      onReviewComplete?.(suggestions.length, MOCK_SUMMARY);
      isReviewingRef.current = false;

      return { suggestions, summary: MOCK_SUMMARY };
    } catch (error) {
      editor.commands.setReviewLoading(false);
      onReviewError?.((error as Error).message);
      isReviewingRef.current = false;
      return null;
    }
  }, [editor, onReviewStart, onReviewComplete, onReviewError]);

  const clearReview = useCallback(() => {
    abortRef.current = true;
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
