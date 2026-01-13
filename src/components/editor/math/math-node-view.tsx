"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import katex from "katex";
import { cn } from "@/lib/utils";
import { MathEditorPanel } from "./math-editor-panel";

/**
 * Math Node View Component
 *
 * Renders math expressions with click-to-edit functionality (Notion-style)
 */
export function MathNodeView({
  node,
  updateAttributes,
  selected,
  deleteNode,
  editor,
}: NodeViewProps) {
  const { latex } = node.attrs;
  const isBlock = node.type.name === "blockMath";

  const [isEditing, setIsEditing] = useState(!latex);
  const [localLatex, setLocalLatex] = useState(latex || "");
  const [renderError, setRenderError] = useState<string | null>(null);
  const renderedRef = useRef<HTMLSpanElement>(null);

  // Render KaTeX when not editing
  useEffect(() => {
    if (!renderedRef.current || isEditing) return;

    const latexToRender = latex || "";

    if (!latexToRender.trim()) {
      renderedRef.current.innerHTML =
        '<span class="math-empty-placeholder">Empty equation</span>';
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
  }, [latex, isBlock, isEditing]);

  // Sync local latex when prop changes
  useEffect(() => {
    if (!isEditing) {
      setLocalLatex(latex || "");
    }
  }, [latex, isEditing]);

  // Click to edit
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isEditing && editor.isEditable) {
        setIsEditing(true);
        setLocalLatex(latex || "");
      }
    },
    [isEditing, latex, editor.isEditable]
  );

  // Save and close
  const handleSave = useCallback(() => {
    const trimmed = localLatex.trim();
    if (trimmed) {
      updateAttributes({ latex: trimmed });
      setIsEditing(false);
    } else {
      // Delete empty math node
      deleteNode();
    }
  }, [localLatex, updateAttributes, deleteNode]);

  // Cancel editing
  const handleCancel = useCallback(() => {
    if (latex) {
      // Has existing content, revert
      setLocalLatex(latex);
      setIsEditing(false);
    } else {
      // New empty node, delete it
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

  // Editing mode
  if (isEditing) {
    return (
      <NodeViewWrapper
        as={isBlock ? "div" : "span"}
        className={cn(
          "math-node-wrapper",
          isBlock && "block my-4"
        )}
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

  // Render mode
  return (
    <NodeViewWrapper
      as={isBlock ? "div" : "span"}
      className={cn(
        "math-node-wrapper",
        isBlock && "block my-4"
      )}
    >
      <span
        ref={renderedRef}
        onClick={handleClick}
        className={cn(
          "math-rendered cursor-pointer transition-all duration-150",
          isBlock
            ? "block text-center py-2 px-4 rounded-lg hover:bg-accent/30"
            : "inline-block px-1 rounded hover:bg-accent/50",
          selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
          renderError && "text-destructive"
        )}
        title={editor.isEditable ? "Click to edit" : undefined}
      />
    </NodeViewWrapper>
  );
}
