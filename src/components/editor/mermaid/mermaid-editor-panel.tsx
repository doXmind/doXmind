"use client";

import { useState, useRef, useEffect, useCallback, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  renderMermaidSvg,
  getMermaidThemeKey,
  subscribeMermaidTheme,
} from "@/lib/mermaid-renderer";

interface MermaidEditorPanelProps {
  code: string;
  onChange: (code: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

/**
 * Notion-style Mermaid chart editor:
 * - Header shows the live (debounced) Mermaid preview when there is code,
 *   or a "Mermaid · Add a Mermaid chart" placeholder when empty.
 * - The code input row is hidden by default and reveals when the header is clicked.
 * - For an existing chart being edited (code non-empty on mount), the input row
 *   starts expanded so the user sees their content immediately.
 */
export function MermaidEditorPanel({
  code,
  onChange,
  onSave,
  onCancel,
  onKeyDown,
}: MermaidEditorPanelProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const t = useTranslations("editor");
  const tc = useTranslations("common");

  const [isInputVisible, setIsInputVisible] = useState(() => !!code.trim());
  const [renderError, setRenderError] = useState(false);
  const themeKey = useSyncExternalStore(subscribeMermaidTheme, getMermaidThemeKey, () => "ssr");

  useEffect(() => {
    if (!isInputVisible) return;
    if (typeof window === "undefined" || window.innerWidth < 768) return;
    inputRef.current?.focus();
  }, [isInputVisible]);

  // Auto-grow textarea up to a sensible cap.
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta || !isInputVisible) return;
    ta.style.height = "0px";
    ta.style.height = `${Math.min(ta.scrollHeight, 320)}px`;
  }, [code, isInputVisible]);

  // Debounced live preview — Mermaid render is async and somewhat expensive.
  useEffect(() => {
    const target = previewRef.current;
    if (!target) return;
    const trimmed = code.trim();
    if (!trimmed) {
      target.innerHTML = "";
      setRenderError(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const el = previewRef.current;
      if (!el) return;
      try {
        const svg = await renderMermaidSvg(trimmed);
        el.innerHTML = svg;
        const svgEl = el.querySelector("svg");
        if (svgEl) {
          svgEl.style.maxWidth = "100%";
          svgEl.style.maxHeight = "320px";
          svgEl.style.height = "auto";
          svgEl.style.width = "auto";
          svgEl.style.margin = "0 auto";
        }
        setRenderError(false);
      } catch {
        const safeCode = trimmed.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        el.innerHTML = `<pre class="text-xs text-destructive font-mono whitespace-pre-wrap p-2">${safeCode}</pre>`;
        setRenderError(true);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // themeKey participates so flipping light/dark mode mid-edit re-renders
    // the live preview against the new palette.
  }, [code, themeKey]);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value),
    [onChange]
  );

  const handleKeyDownInternal = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Cmd/Ctrl+Enter saves; plain Enter inserts a newline (mermaid is multi-line).
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onSave();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const input = inputRef.current;
        if (!input) return;
        const start = input.selectionStart || 0;
        const end = input.selectionEnd || 0;
        const newCode = code.slice(0, start) + "    " + code.slice(end);
        onChange(newCode);
        setTimeout(() => {
          input.setSelectionRange(start + 4, start + 4);
        }, 0);
        return;
      }
      onKeyDown(e);
    },
    [code, onChange, onSave, onCancel, onKeyDown]
  );

  const handleHeaderClick = useCallback(() => {
    setIsInputVisible(true);
  }, []);

  const handleTextareaBlur = useCallback(
    (e: React.FocusEvent<HTMLTextAreaElement>) => {
      const next = e.relatedTarget as HTMLElement | null;
      if (next?.closest?.(".mermaid-editor-panel")) return;
      if (!code.trim()) setIsInputVisible(false);
    },
    [code]
  );

  return (
    <div
      className="mermaid-editor-panel doxmind-block-placeholder relative flex w-full flex-col overflow-hidden rounded-lg"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header — preview when there's code, placeholder when empty */}
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
          "w-full px-3 py-2.5 text-left transition-colors",
          !isInputVisible && "cursor-pointer hover:bg-muted/30"
        )}
      >
        {code.trim() ? (
          <div
            ref={previewRef}
            className={cn(
              "mermaid-editor-preview-content overflow-x-auto",
              "min-h-[3rem] text-center [&_svg]:mx-auto [&_svg]:max-h-[320px]",
              renderError && "text-destructive"
            )}
          />
        ) : (
          <div className="flex items-center gap-3 text-muted-foreground">
            <GitBranch className="h-4 w-4" />
            <span className="text-sm">{t("addMermaidChart")}</span>
          </div>
        )}
      </div>

      {/* Input + Done — hidden until expanded */}
      {isInputVisible && (
        <div className="flex w-full items-end gap-2 border-t border-border/50 bg-muted/40 p-1.5">
          <textarea
            ref={inputRef}
            value={code}
            onChange={handleInput}
            onKeyDown={handleKeyDownInternal}
            onBlur={handleTextareaBlur}
            placeholder="graph TD&#10;    A[Start] --> B[End]"
            className={cn(
              "min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5",
              "font-mono text-[13px] leading-relaxed text-foreground",
              "placeholder:text-muted-foreground/60",
              "focus:outline-none",
              "max-h-[320px] min-h-[28px]"
            )}
            rows={1}
            spellCheck={false}
          />
          <button
            type="button"
            onClick={onSave}
            className="inline-flex shrink-0 items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {tc("done")}
          </button>
        </div>
      )}
    </div>
  );
}
