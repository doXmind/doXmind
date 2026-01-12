"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Editor } from "@tiptap/react";
import { X, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SpellcheckPluginKey,
  type SpellcheckMatch,
} from "@/extensions/spellcheck-extension";

interface SpellcheckPopupProps {
  editor: Editor;
}

export function SpellcheckPopup({ editor }: SpellcheckPopupProps) {
  const [activeMatch, setActiveMatch] = useState<SpellcheckMatch | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null
  );
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

        // Position popup below the error
        const rect = errorElement.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const popupWidth = 280; // Approximate popup width

        // Calculate x position, ensuring it stays within viewport
        let x = rect.left;
        if (x + popupWidth > viewportWidth - 16) {
          x = viewportWidth - popupWidth - 16;
        }
        if (x < 16) {
          x = 16;
        }

        setPosition({ x, y: rect.bottom + 4 });
      }
    };

    // Close popup on scroll
    const handleScroll = () => {
      setActiveMatch(null);
      setPosition(null);
    };

    // Close popup on escape key
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveMatch(null);
        setPosition(null);
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

  // Apply a correction
  const handleApplyCorrection = useCallback(
    (replacement: string) => {
      if (!activeMatch) return;

      // Validate positions before applying
      const docSize = editor.state.doc.content.size;
      if (activeMatch.from < 0 || activeMatch.to > docSize) {
        setActiveMatch(null);
        setPosition(null);
        return;
      }

      editor.commands.applyCorrection(
        activeMatch.from,
        activeMatch.to,
        replacement
      );
      setActiveMatch(null);
      setPosition(null);
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
      return;
    }

    // Get the word text
    try {
      const word = editor.state.doc.textBetween(
        activeMatch.from,
        activeMatch.to
      );
      editor.commands.ignoreWord(word);
    } catch {
      // Position invalid, just close popup
    }
    setActiveMatch(null);
    setPosition(null);
  }, [editor, activeMatch]);

  // Close the popup
  const handleClose = useCallback(() => {
    setActiveMatch(null);
    setPosition(null);
  }, []);

  if (!activeMatch || !position) return null;

  // Validate positions are within document bounds
  const docSize = editor.state.doc.content.size;
  if (
    activeMatch.from < 0 ||
    activeMatch.to > docSize ||
    activeMatch.from >= activeMatch.to
  ) {
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
      className="fixed z-50 bg-popover border border-border rounded-lg shadow-lg w-72 spellcheck-popup"
      style={{ left: position.x, top: position.y }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <span className="underline decoration-wavy decoration-red-500">
            {word}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClose}
          className="h-6 w-6 -mr-1"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Error message */}
      <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border">
        {activeMatch.message}
      </div>

      {/* Suggestions */}
      {activeMatch.replacements.length > 0 && (
        <div className="py-1">
          <div className="px-3 py-1 text-xs text-muted-foreground uppercase tracking-wide">
            Suggestions
          </div>
          {activeMatch.replacements.map((replacement, i) => (
            <button
              key={i}
              className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors flex items-center gap-2"
              onClick={() => handleApplyCorrection(replacement)}
            >
              <span className="text-primary font-medium">{replacement}</span>
            </button>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="border-t border-border py-1">
        <button
          className="w-full px-3 py-1.5 text-xs text-left text-muted-foreground hover:bg-accent hover:text-foreground transition-colors flex items-center gap-2"
          onClick={handleIgnore}
        >
          <BookOpen className="h-3.5 w-3.5" />
          Add to dictionary
        </button>
      </div>
    </div>
  );
}
