"use client";

import { useState, useEffect, useCallback, useRef, useLayoutEffect } from "react";
import { Editor } from "@tiptap/react";
import { X, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SpellcheckPluginKey, type SpellcheckMatch } from "@/extensions/spellcheck-extension";

interface SpellcheckPopupProps {
  editor: Editor;
}

export function SpellcheckPopup({ editor }: SpellcheckPopupProps) {
  const [activeMatch, setActiveMatch] = useState<SpellcheckMatch | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [_showAbove, setShowAbove] = useState(false);
  const [errorRect, setErrorRect] = useState<DOMRect | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Handle click on spellcheck error
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // Check if clicking inside the popup
      if (popupRef.current?.contains(target)) {
        return;
      }

      // Check if clicking on a spellcheck error
      const errorElement = target.closest(".spellcheck-error");

      if (!errorElement) {
        setActiveMatch(null);
        setPosition(null);
        setErrorRect(null);
        setShowAbove(false);
        return;
      }

      // Get match ID from the element
      const matchId = errorElement.getAttribute("data-spellcheck-id");
      if (!matchId) {
        return;
      }

      // Get match data from plugin state
      const pluginState = SpellcheckPluginKey.getState(editor.state);
      const match = pluginState?.matches.find((m) => m.id === matchId);

      if (match) {
        setActiveMatch(match);

        // Store the error element rect for positioning
        const rect = errorElement.getBoundingClientRect();
        setErrorRect(rect);

        // Calculate initial x position
        const viewportWidth = window.innerWidth;
        const popupWidth = 280; // Approximate popup width
        const gap = 4;

        let x = rect.left;
        if (x + popupWidth > viewportWidth - 16) {
          x = viewportWidth - popupWidth - 16;
        }
        if (x < 16) {
          x = 16;
        }

        // Initial position below the error (will be adjusted in useLayoutEffect)
        setShowAbove(false);
        setPosition({ x, y: rect.bottom + gap });
      }
    };

    // Close popup on scroll
    const handleScroll = () => {
      setActiveMatch(null);
      setPosition(null);
      setErrorRect(null);
      setShowAbove(false);
    };

    // Close popup on escape key
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveMatch(null);
        setPosition(null);
        setErrorRect(null);
        setShowAbove(false);
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

  // Measure actual popup height and reposition if needed
  useLayoutEffect(() => {
    if (!popupRef.current || !position || !errorRect) return;

    const popup = popupRef.current;
    const popupRect = popup.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const gap = 4;

    // Check if popup is cut off at the bottom
    if (popupRect.bottom > viewportHeight - 16) {
      const spaceAbove = errorRect.top - gap;
      const actualPopupHeight = popupRect.height;

      // If there's more space above, position above
      if (spaceAbove >= actualPopupHeight) {
        setShowAbove(true);
        setPosition((prev) =>
          prev ? { x: prev.x, y: errorRect.top - actualPopupHeight - gap } : null
        );
      } else if (spaceAbove > viewportHeight - errorRect.bottom - gap) {
        // More space above than below, position above even if it might be slightly cut
        setShowAbove(true);
        const y = Math.max(16, errorRect.top - actualPopupHeight - gap);
        setPosition((prev) => (prev ? { x: prev.x, y } : null));
      }
    }
  }, [position, errorRect, activeMatch]);

  // Apply a correction
  const handleApplyCorrection = useCallback(
    (replacement: string) => {
      if (!activeMatch) return;

      // Validate positions before applying
      const docSize = editor.state.doc.content.size;
      if (activeMatch.from < 0 || activeMatch.to > docSize) {
        setActiveMatch(null);
        setPosition(null);
        setErrorRect(null);
        setShowAbove(false);
        return;
      }

      editor.commands.applyCorrection(activeMatch.from, activeMatch.to, replacement);
      setActiveMatch(null);
      setPosition(null);
      setErrorRect(null);
      setShowAbove(false);
    },
    [editor, activeMatch]
  );

  // Ignore the word
  const handleIgnore = useCallback(() => {
    if (!activeMatch) return;

    // Validate positions before accessing text
    const docSize = editor.state.doc.content.size;
    if (activeMatch.from < 0 || activeMatch.to > docSize) {
      setActiveMatch(null);
      setPosition(null);
      setErrorRect(null);
      setShowAbove(false);
      return;
    }

    // Get the word text
    try {
      const word = editor.state.doc.textBetween(activeMatch.from, activeMatch.to);
      editor.commands.ignoreWord(word);
    } catch {
      // Position invalid, just close popup
    }
    setActiveMatch(null);
    setPosition(null);
    setErrorRect(null);
    setShowAbove(false);
  }, [editor, activeMatch]);

  // Close the popup
  const handleClose = useCallback(() => {
    setActiveMatch(null);
    setPosition(null);
    setErrorRect(null);
    setShowAbove(false);
  }, []);

  // Keyboard navigation state
  const [focusIndex, setFocusIndex] = useState(-1); // -1 = no focus, 0..N-1 = suggestions, N = "Add to dictionary"
  const totalItems = (activeMatch?.replacements.length ?? 0) + 1; // suggestions + add to dictionary

  // Reset focus when match changes
  useEffect(() => {
    setFocusIndex(activeMatch?.replacements.length ? 0 : -1);
  }, [activeMatch]);

  // Keyboard navigation for suggestions
  useEffect(() => {
    if (!activeMatch || !position) return;

    const handleNav = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIndex((prev) => (prev < totalItems - 1 ? prev + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIndex((prev) => (prev > 0 ? prev - 1 : totalItems - 1));
      } else if (e.key === "Tab") {
        e.preventDefault();
        setFocusIndex((prev) => (prev < totalItems - 1 ? prev + 1 : 0));
      } else if (e.key === "Enter" && focusIndex >= 0) {
        e.preventDefault();
        const suggestionsCount = activeMatch.replacements.length;
        if (focusIndex < suggestionsCount) {
          handleApplyCorrection(activeMatch.replacements[focusIndex]);
        } else {
          handleIgnore();
        }
      }
    };

    window.addEventListener("keydown", handleNav);
    return () => window.removeEventListener("keydown", handleNav);
  }, [activeMatch, position, focusIndex, totalItems, handleApplyCorrection, handleIgnore]);

  if (!activeMatch || !position) return null;

  // Validate positions are within document bounds
  const docSize = editor.state.doc.content.size;
  if (activeMatch.from < 0 || activeMatch.to > docSize || activeMatch.from >= activeMatch.to) {
    return null;
  }

  // Get the problematic word
  let word: string;
  try {
    word = editor.state.doc.textBetween(activeMatch.from, activeMatch.to);
  } catch {
    return null;
  }

  return (
    <div
      ref={popupRef}
      className="spellcheck-popup fixed z-50 w-72 rounded-lg border border-border bg-popover shadow-lg"
      style={{ left: position.x, top: position.y }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <span className="underline decoration-red-500 decoration-wavy">{word}</span>
        </div>
        <Button variant="ghost" size="icon" onClick={handleClose} className="-mr-1 h-6 w-6">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Error message */}
      <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
        {activeMatch.message}
      </div>

      {/* Suggestions */}
      {activeMatch.replacements.length > 0 && (
        <div className="py-1">
          <div className="px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">
            Suggestions
          </div>
          {activeMatch.replacements.map((replacement, i) => (
            <button
              key={i}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent ${focusIndex === i ? "bg-accent" : ""}`}
              onClick={() => handleApplyCorrection(replacement)}
              onMouseEnter={() => setFocusIndex(i)}
            >
              <span className="font-medium text-primary">{replacement}</span>
            </button>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="border-t border-border py-1">
        <button
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${focusIndex === activeMatch.replacements.length ? "bg-accent text-foreground" : ""}`}
          onClick={handleIgnore}
          onMouseEnter={() => setFocusIndex(activeMatch.replacements.length)}
        >
          <BookOpen className="h-3.5 w-3.5" />
          Add to dictionary
        </button>
      </div>
    </div>
  );
}
