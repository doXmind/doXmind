"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import katex from "katex";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Check, X, Trash2 } from "lucide-react";
import { SymbolPicker } from "./symbol-picker";

interface MathEditorPanelProps {
  latex: string;
  onChange: (latex: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  displayMode: boolean;
}

/**
 * Math Editor Panel Component
 *
 * Provides LaTeX input with live preview
 */
export function MathEditorPanel({
  latex,
  onChange,
  onSave,
  onCancel,
  onDelete,
  onKeyDown,
  displayMode,
}: MathEditorPanelProps) {
  const [showSymbols, setShowSymbols] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const t = useTranslations("editor");
  const tc = useTranslations("common");

  // Focus input on mount (desktop only to avoid mobile keyboard popup)
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth >= 768) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, []);

  // Live preview
  useEffect(() => {
    if (!previewRef.current) return;

    const latexToRender = latex.trim();

    if (!latexToRender) {
      previewRef.current.innerHTML = `<span class="text-muted-foreground italic text-sm">${t("mathPreviewPlaceholder")}</span>`;
      return;
    }

    try {
      katex.render(latexToRender, previewRef.current, {
        displayMode,
        throwOnError: false,
        errorColor: "#ef4444",
        trust: true,
      });
    } catch {
      previewRef.current.innerHTML = `<span class="text-destructive text-sm">${t("invalidLatex")}</span>`;
    }
  }, [latex, displayMode, t]);

  // Insert symbol at cursor position
  const insertSymbol = useCallback(
    (symbol: string) => {
      const input = inputRef.current;
      if (!input) {
        onChange(latex + symbol);
        return;
      }

      const start = input.selectionStart || 0;
      const end = input.selectionEnd || 0;
      const newLatex = latex.slice(0, start) + symbol + latex.slice(end);
      onChange(newLatex);

      // Move cursor after inserted symbol
      setTimeout(() => {
        const newPos = start + symbol.length;
        input.setSelectionRange(newPos, newPos);
        input.focus();
      }, 0);

      setShowSymbols(false);
    },
    [latex, onChange]
  );

  // Handle textarea input
  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
    },
    [onChange]
  );

  // Handle special keys
  const handleKeyDownInternal = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Allow Enter with Shift for newlines in block math
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSave();
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }

      // Forward other key events
      onKeyDown(e);
    },
    [onSave, onCancel, onKeyDown]
  );

  return (
    <div
      className={cn(
        "math-editor-panel relative",
        "rounded-lg border border-border bg-popover shadow-lg",
        "animate-in fade-in-0 zoom-in-95 duration-150",
        displayMode ? "mx-auto max-w-2xl p-4" : "inline-block p-2"
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Preview */}
      <div
        ref={previewRef}
        className={cn(
          "math-preview overflow-x-auto",
          displayMode
            ? "mb-3 min-h-[3rem] border-b border-border py-4 text-center text-xl"
            : "mb-2 min-h-[1.5rem] min-w-[60px] px-2 text-center"
        )}
      />

      {/* Input area */}
      <div className={cn("flex gap-2", displayMode ? "flex-col" : "items-start")}>
        <div className="relative flex-1">
          <textarea
            ref={inputRef}
            value={latex}
            onChange={handleInput}
            onKeyDown={handleKeyDownInternal}
            placeholder={
              displayMode ? "e.g., \\frac{1}{2} + \\sum_{i=1}^{n} x_i" : "e.g., x^2 + y^2"
            }
            className={cn(
              "w-full resize-none font-mono text-base md:text-sm",
              "rounded-md border border-input bg-background px-3 py-2",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
              "placeholder:text-muted-foreground",
              displayMode ? "min-h-[80px]" : "h-[36px] min-h-[36px]"
            )}
            rows={displayMode ? 3 : 1}
          />
        </div>

        {/* Action buttons */}
        <div className={cn("flex items-center gap-1", displayMode && "justify-end")}>
          {/* Symbol picker button */}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => setShowSymbols(!showSymbols)}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            title={t("insertSymbol")}
          >
            <span className="font-serif text-lg">Σ</span>
          </Button>

          {/* Save button */}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onSave}
            className="h-8 w-8 text-green-600 hover:bg-green-100 hover:text-green-700 dark:hover:bg-green-900/30"
            title={t("saveEnter")}
          >
            <Check className="h-4 w-4" />
          </Button>

          {/* Cancel button */}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onCancel}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            title={t("cancelEscape")}
          >
            <X className="h-4 w-4" />
          </Button>

          {/* Delete button */}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onDelete}
            className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
            title={tc("delete")}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Keyboard hints */}
      <div className="mt-2 text-xs text-muted-foreground">
        <span className="mr-3">
          <kbd className="rounded bg-muted px-1 py-0.5 text-[10px]">Enter</kbd> {t("enterToSave")}
        </span>
        <span className="mr-3">
          <kbd className="rounded bg-muted px-1 py-0.5 text-[10px]">Esc</kbd> {t("escToCancel")}
        </span>
        {displayMode && (
          <span>
            <kbd className="rounded bg-muted px-1 py-0.5 text-[10px]">Shift+Enter</kbd>{" "}
            {t("shiftEnterNewline")}
          </span>
        )}
      </div>

      {/* Symbol picker dropdown */}
      {showSymbols && (
        <SymbolPicker onSelect={insertSymbol} onClose={() => setShowSymbols(false)} />
      )}
    </div>
  );
}
