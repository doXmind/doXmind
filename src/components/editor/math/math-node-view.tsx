"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { loadKatex } from "./katex-loader";
import { MathEditorPanel } from "./math-editor-panel";

/**
 * Renders the equation as KaTeX in non-edit mode; click to enter edit mode.
 */
export function MathNodeView({
  node,
  updateAttributes,
  deleteNode,
  editor,
  getPos,
}: NodeViewProps) {
  const t = useTranslations("editor");
  const { latex } = node.attrs;
  const isBlock = node.type.name === "blockMath";

  const [localLatex, setLocalLatex] = useState(latex || "");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(!latex);
  const renderedRef = useRef<HTMLSpanElement>(null);

  // Listen for block-enter-edit event (Enter key from block selection)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      let currentPos: number | undefined;
      try {
        currentPos = typeof getPos === "function" ? getPos() : undefined;
      } catch {
        // getPos() can throw during unmount
      }
      if (
        detail?.pos === currentPos &&
        (detail?.type === "blockMath" || detail?.type === "inlineMath")
      ) {
        setIsEditing(true);
      }
    };
    document.addEventListener("block-enter-edit", handler);
    return () => document.removeEventListener("block-enter-edit", handler);
  }, [getPos]);

  // Render KaTeX when not editing. KaTeX is lazy-loaded so the editor's
  // initial chunk doesn't ship ~280 KB of math typesetting code for docs
  // that may never contain math.
  useEffect(() => {
    if (!renderedRef.current || isEditing) return;

    const latexToRender = latex || "";

    if (!latexToRender.trim()) {
      renderedRef.current.innerHTML = `<span class="math-empty-placeholder">${t("emptyEquation")}</span>`;
      return;
    }

    let cancelled = false;
    void loadKatex().then((katex) => {
      if (cancelled || !renderedRef.current) return;
      try {
        katex.render(latexToRender, renderedRef.current, {
          displayMode: isBlock,
          throwOnError: false,
          errorColor: "#ef4444",
          trust: true,
        });
        setRenderError(null);
      } catch (err) {
        setRenderError((err as Error).message);
        renderedRef.current.innerHTML = `<span class="text-destructive">${latexToRender}</span>`;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [latex, isBlock, isEditing, t]);

  // Sync local latex when prop changes
  useEffect(() => {
    if (!isEditing) {
      setLocalLatex(latex || "");
    }
  }, [latex, isEditing]);

  const handleEnterEdit = useCallback(() => {
    if (!editor.isEditable) return;
    setIsEditing(true);
  }, [editor.isEditable]);

  const handleSave = useCallback(() => {
    const trimmed = localLatex.trim();
    if (trimmed) {
      updateAttributes({ latex: trimmed });
      setIsEditing(false);
    } else {
      deleteNode();
    }
  }, [localLatex, updateAttributes, deleteNode]);

  const handleCancel = useCallback(() => {
    if (latex) {
      setLocalLatex(latex);
      setIsEditing(false);
    } else {
      deleteNode();
    }
  }, [latex, deleteNode]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleSave, handleCancel]
  );

  if (isEditing) {
    return (
      <NodeViewWrapper
        as={isBlock ? "div" : "span"}
        className={cn("math-node-wrapper", isBlock && "my-4 block")}
        data-drag-handle={undefined}
      >
        <MathEditorPanel
          latex={localLatex}
          onChange={setLocalLatex}
          onSave={handleSave}
          onCancel={handleCancel}
          onKeyDown={handleKeyDown}
          displayMode={isBlock}
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as={isBlock ? "div" : "span"}
      className={cn("math-node-wrapper", isBlock && "my-4 block")}
    >
      <span
        ref={renderedRef}
        onClick={handleEnterEdit}
        className={cn(
          "math-rendered cursor-pointer transition-all duration-150",
          isBlock
            ? "block rounded-lg px-4 py-2 text-center hover:bg-accent/30"
            : "inline-block rounded px-1 hover:bg-accent/50",
          renderError && "text-destructive"
        )}
      />
    </NodeViewWrapper>
  );
}
