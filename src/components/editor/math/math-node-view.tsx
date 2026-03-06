"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Pencil, Copy, Trash2, ArrowUpFromLine } from "lucide-react";
import katex from "katex";
import { cn } from "@/lib/utils";
import { isInsideList, liftAtomBlock } from "@/lib/block-operations";
import { useIsMobile } from "@/hooks/use-device-type";
import { Tooltip } from "@/components/ui/tooltip";
import { AiLogoIcon } from "@/components/ui/ai-logo-icon";
import { useEditorStore } from "@/stores/editor-store";
import { MathEditorPanel } from "./math-editor-panel";

/**
 * Math Node View Component
 *
 * Renders math expressions with hover overlay toolbar (matching image/chart pattern).
 * Hover → toolbar at top-right (block) or above (inline). Double-click or Edit button → edit mode.
 */
export function MathNodeView({
  node,
  updateAttributes,
  selected,
  deleteNode,
  editor,
  getPos,
}: NodeViewProps) {
  const t = useTranslations("editor");
  const tc = useTranslations("common");
  const { latex } = node.attrs;
  const isBlock = node.type.name === "blockMath";
  const isMobile = useIsMobile();

  const [localLatex, setLocalLatex] = useState(latex || "");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(!latex);
  const [isHovered, setIsHovered] = useState(false);
  const renderedRef = useRef<HTMLSpanElement>(null);

  let nodePos: number | undefined;
  try {
    nodePos = typeof getPos === "function" ? getPos() : undefined;
  } catch {
    // getPos() can throw during unmount
  }

  const isNested = isBlock && nodePos !== undefined && isInsideList(editor.state.doc, nodePos);

  const handleLiftOut = useCallback(() => {
    if (nodePos !== undefined) {
      liftAtomBlock(editor, nodePos);
    }
  }, [editor, nodePos]);

  // Show toolbar on hover or when selected (like image/chart blocks)
  const showToolbar = (isHovered || selected) && !isEditing;

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

  // Render KaTeX when not editing
  useEffect(() => {
    if (!renderedRef.current || isEditing) return;

    const latexToRender = latex || "";

    if (!latexToRender.trim()) {
      renderedRef.current.innerHTML = `<span class="math-empty-placeholder">${t("emptyEquation")}</span>`;
      return;
    }

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
  }, [latex, isBlock, isEditing, t]);

  // Sync local latex when prop changes
  useEffect(() => {
    if (!isEditing) {
      setLocalLatex(latex || "");
    }
  }, [latex, isEditing]);

  // Enter edit mode
  const handleEnterEdit = useCallback(() => {
    if (!editor.isEditable) return;
    setIsEditing(true);
  }, [editor.isEditable]);

  // Save and close
  const handleSave = useCallback(() => {
    const trimmed = localLatex.trim();
    if (trimmed) {
      updateAttributes({ latex: trimmed });
      setIsEditing(false);
    } else {
      deleteNode();
    }
  }, [localLatex, updateAttributes, deleteNode]);

  // Cancel editing
  const handleCancel = useCallback(() => {
    if (latex) {
      setLocalLatex(latex);
      setIsEditing(false);
    } else {
      deleteNode();
    }
  }, [latex, deleteNode]);

  // Delete node
  const handleDelete = useCallback(() => {
    deleteNode();
  }, [deleteNode]);

  // Handle keyboard shortcuts in edit mode
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

  // Copy LaTeX to clipboard
  const handleCopyLatex = useCallback(() => {
    if (latex) {
      navigator.clipboard.writeText(latex);
    }
  }, [latex]);

  // Ask AI about this equation
  const handleAskInChat = useCallback(() => {
    if (latex && nodePos !== undefined) {
      useEditorStore.getState().setSelection({
        from: nodePos,
        to: nodePos + node.nodeSize,
        text: latex,
      });
      const from = nodePos;
      const to = nodePos + node.nodeSize;
      const beforeStart = Math.max(0, from - 220);
      const afterEnd = Math.min(editor.state.doc.content.size, to + 220);
      useEditorStore
        .getState()
        .openInlineAI({ x: window.innerWidth / 2, y: window.innerHeight / 2 }, "ask", {
          from,
          to,
          beforeText: editor.state.doc.textBetween(beforeStart, from, "\n", "\n").slice(-220),
          afterText: editor.state.doc.textBetween(to, afterEnd, "\n", "\n").slice(0, 220),
        });
    }
  }, [latex, nodePos, node.nodeSize, editor]);

  // Overlay toolbar content (shared between block and inline)
  const renderToolbar = () => (
    <div
      className={cn("image-overlay-toolbar", !isBlock && "math-inline-toolbar")}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {isNested && (
        <>
          <Tooltip content={t("liftOutOfList")} side="top">
            <button type="button" className="image-toolbar-icon-btn" onClick={handleLiftOut}>
              <ArrowUpFromLine className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <div className="image-toolbar-sep" />
        </>
      )}
      <Tooltip content={t("blockAction.askInline")} side="top">
        <button type="button" className="image-toolbar-btn" onClick={handleAskInChat}>
          <AiLogoIcon className="h-3.5 w-3.5" />
          <span className="text-xs">{t("blockAction.askInline")}</span>
        </button>
      </Tooltip>
      <div className="image-toolbar-sep" />
      <Tooltip content={t("editEquation")} side="top">
        <button type="button" className="image-toolbar-icon-btn" onClick={handleEnterEdit}>
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
      <Tooltip content={t("copyLatex")} side="top">
        <button type="button" className="image-toolbar-icon-btn" onClick={handleCopyLatex}>
          <Copy className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
      <div className="image-toolbar-sep" />
      <Tooltip content={tc("delete")} side="top">
        <button
          type="button"
          className="image-toolbar-icon-btn"
          onClick={handleDelete}
          style={{ color: "hsl(var(--destructive))" }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </div>
  );

  // Editing mode
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
          onDelete={handleDelete}
          onKeyDown={handleKeyDown}
          displayMode={isBlock}
        />
      </NodeViewWrapper>
    );
  }

  // Render mode with hover overlay toolbar
  return (
    <NodeViewWrapper
      as={isBlock ? "div" : "span"}
      className={cn("math-node-wrapper", isBlock && "my-4 block")}
    >
      <span
        className={cn("group relative", isBlock ? "block" : "inline-block")}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Overlay toolbar */}
        {showToolbar && !isMobile && editor.isEditable && renderToolbar()}

        <span
          ref={renderedRef}
          onDoubleClick={handleEnterEdit}
          className={cn(
            "math-rendered cursor-pointer transition-all duration-150",
            isBlock
              ? "block rounded-lg px-4 py-2 text-center hover:bg-accent/30"
              : "inline-block rounded px-1 hover:bg-accent/50",
            renderError && "text-destructive"
          )}
        />
      </span>
    </NodeViewWrapper>
  );
}
