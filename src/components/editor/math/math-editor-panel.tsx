"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import katex from "katex";
import { CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface MathEditorPanelProps {
  latex: string;
  onChange: (latex: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  displayMode: boolean;
}

/**
 * Notion-style TeX equation editor:
 * - Header shows the live KaTeX preview when there is input, or a "TᴇX Add a TeX equation"
 *   placeholder when empty.
 * - LaTeX input row is hidden by default and reveals when the header is clicked.
 * - For an existing equation being edited (latex non-empty on mount), the input row
 *   starts expanded so the user sees their content immediately.
 */
export function MathEditorPanel({
  latex,
  onChange,
  onSave,
  onCancel,
  onKeyDown,
  displayMode,
}: MathEditorPanelProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const t = useTranslations("editor");
  const tc = useTranslations("common");

  const [isInputVisible, setIsInputVisible] = useState(() => !!latex.trim());

  // Focus + select textarea whenever the input row becomes visible.
  useEffect(() => {
    if (!isInputVisible) return;
    if (typeof window === "undefined" || window.innerWidth < 768) return;
    inputRef.current?.focus();
    if (latex.trim()) inputRef.current?.select();
  }, [isInputVisible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-grow textarea up to a sensible cap.
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta || !isInputVisible) return;
    ta.style.height = "0px";
    ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`;
  }, [latex, isInputVisible]);

  // Live KaTeX preview in the header when there is content.
  useEffect(() => {
    if (!previewRef.current) return;
    const code = latex.trim();
    if (!code) {
      previewRef.current.innerHTML = "";
      return;
    }
    try {
      katex.render(code, previewRef.current, {
        displayMode,
        throwOnError: false,
        errorColor: "#ef4444",
        trust: true,
      });
    } catch {
      previewRef.current.innerHTML = `<span class="text-destructive text-sm">${t("invalidLatex")}</span>`;
    }
  }, [latex, displayMode, t]);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value),
    [onChange]
  );

  const handleKeyDownInternal = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
      onKeyDown(e);
    },
    [onSave, onCancel, onKeyDown]
  );

  const handleHeaderClick = useCallback(() => {
    setIsInputVisible(true);
  }, []);

  // Collapse the input row back into the placeholder when the user clicks
  // elsewhere AND nothing was typed. If they typed content, keep it expanded
  // so their work isn't hidden behind the header.
  const handleTextareaBlur = useCallback(
    (e: React.FocusEvent<HTMLTextAreaElement>) => {
      const next = e.relatedTarget as HTMLElement | null;
      if (next?.closest?.(".math-editor-panel")) return;
      if (!latex.trim()) setIsInputVisible(false);
    },
    [latex]
  );

  return (
    <div
      className={cn(
        "math-editor-panel doxmind-block-placeholder relative flex flex-col overflow-hidden rounded-lg",
        displayMode ? "w-full" : cn("inline-flex max-w-[420px]", isInputVisible && "w-full")
      )}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header — preview when there's content, placeholder when empty.
          Click anywhere to expand the input row. */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleHeaderClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleHeaderClick();
          }
        }}
        className={cn(
          "w-full text-left transition-colors",
          displayMode ? "px-3 py-2.5" : "px-2 py-1",
          !isInputVisible && "cursor-pointer hover:bg-muted/30"
        )}
      >
        {latex.trim() ? (
          <div
            ref={previewRef}
            className={cn(
              "math-editor-preview-content overflow-x-auto",
              displayMode ? "min-h-[2rem] text-center" : "min-h-[1.25rem]"
            )}
          />
        ) : displayMode ? (
          <div className="flex items-center gap-3 text-muted-foreground">
            <span className="select-none font-serif text-[15px] leading-none">
              T<sub className="ml-[1px]">E</sub>X
            </span>
            <span className="text-sm">{t("addTexEquation")}</span>
          </div>
        ) : (
          <span className="select-none font-serif text-xs italic leading-none text-muted-foreground">
            √x
          </span>
        )}
      </div>

      {/* Input + Done — only visible when expanded */}
      {isInputVisible && (
        <div className="flex w-full items-end gap-2 border-t border-border/50 bg-muted/40 p-1.5">
          <textarea
            ref={inputRef}
            value={latex}
            onChange={handleInput}
            onKeyDown={handleKeyDownInternal}
            onBlur={handleTextareaBlur}
            placeholder={
              displayMode ? "e.g., \\frac{1}{2} + \\sum_{i=1}^{n} x_i" : "e.g., x^2 + y^2"
            }
            className={cn(
              "min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5",
              "font-mono text-[13px] leading-relaxed text-foreground",
              "placeholder:text-muted-foreground/60",
              "focus:outline-none",
              "max-h-[240px] min-h-[28px]"
            )}
            rows={1}
            spellCheck={false}
          />
          <button
            type="button"
            onClick={onSave}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5",
              "bg-primary text-xs font-medium text-primary-foreground",
              "transition-colors hover:bg-primary/90"
            )}
          >
            <span>{tc("done")}</span>
            <CornerDownLeft className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
