"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { MermaidEditorPanel } from "./mermaid-editor-panel";

let renderCounter = 0;

/**
 * Mermaid Node View Component
 *
 * Renders mermaid diagrams with click-to-edit functionality (Notion-style).
 * Follows the same pattern as MathNodeView.
 */
export function MermaidNodeView({
  node,
  updateAttributes,
  selected,
  deleteNode,
  editor,
}: NodeViewProps) {
  const { code } = node.attrs;

  const [isEditing, setIsEditing] = useState(!code);
  const [localCode, setLocalCode] = useState(code || "");
  const [renderError, setRenderError] = useState<string | null>(null);
  const renderedRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Render mermaid diagram into a target element
  const renderMermaid = useCallback(async (targetEl: HTMLDivElement, mermaidCode: string) => {
    if (!mermaidCode?.trim()) {
      targetEl.innerHTML =
        '<span class="mermaid-empty-placeholder">Empty chart — click to edit</span>';
      setRenderError(null);
      return;
    }

    try {
      const { default: mermaid } = await import("mermaid");
      const isDark = document.documentElement.classList.contains("dark");
      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? "dark" : "default",
        securityLevel: "loose",
      });

      const id = `mermaid-${Date.now()}-${renderCounter++}`;
      const { svg } = await mermaid.render(id, mermaidCode);
      targetEl.innerHTML = svg;

      // Make SVG responsive
      const svgEl = targetEl.querySelector("svg");
      if (svgEl) {
        svgEl.style.maxWidth = "100%";
        svgEl.style.height = "auto";
      }

      setRenderError(null);
    } catch (err) {
      const message = (err as Error).message || "Render error";
      setRenderError(message);
      // HTML-escape mermaid code to prevent <br/>, <, > from being interpreted as HTML
      const safeCode = mermaidCode
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      targetEl.innerHTML = `<div class="text-destructive text-sm p-2"><p class="font-medium mb-1">Syntax error</p><pre class="text-xs opacity-70 whitespace-pre-wrap">${safeCode}</pre></div>`;
    }

    // Clean up any zombie elements mermaid.js may have left in the DOM
    document.querySelectorAll('svg[id^="mermaid-"]').forEach((el) => {
      if (el.parentElement && !targetEl.contains(el)) {
        el.remove();
      }
    });
  }, []);

  // Render final diagram when not editing
  useEffect(() => {
    if (!renderedRef.current || isEditing) return;
    renderMermaid(renderedRef.current, code);
  }, [code, isEditing, renderMermaid]);

  // Live debounced preview while editing
  useEffect(() => {
    if (!isEditing || !previewRef.current) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      if (previewRef.current) {
        renderMermaid(previewRef.current, localCode);
      }
    }, 500);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [localCode, isEditing, renderMermaid]);

  // Sync local code when prop changes
  useEffect(() => {
    if (!isEditing) {
      setLocalCode(code || "");
    }
  }, [code, isEditing]);

  // Click to edit
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isEditing && editor.isEditable) {
        setIsEditing(true);
        setLocalCode(code || "");
      }
    },
    [isEditing, code, editor.isEditable]
  );

  // Save and close
  const handleSave = useCallback(() => {
    const trimmed = localCode.trim();
    if (trimmed) {
      updateAttributes({ code: trimmed });
      setIsEditing(false);
    } else {
      deleteNode();
    }
  }, [localCode, updateAttributes, deleteNode]);

  // Cancel editing
  const handleCancel = useCallback(() => {
    if (code) {
      setLocalCode(code);
      setIsEditing(false);
    } else {
      deleteNode();
    }
  }, [code, deleteNode]);

  // Delete node
  const handleDelete = useCallback(() => {
    deleteNode();
  }, [deleteNode]);

  // Handle keyboard shortcuts in edit mode
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
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
      <NodeViewWrapper as="div" className="mermaid-chart-wrapper my-4 block">
        <MermaidEditorPanel
          code={localCode}
          onChange={setLocalCode}
          onSave={handleSave}
          onCancel={handleCancel}
          onDelete={handleDelete}
          onKeyDown={handleKeyDown}
          previewRef={previewRef}
          renderError={renderError}
        />
      </NodeViewWrapper>
    );
  }

  // Render mode
  return (
    <NodeViewWrapper as="div" className="mermaid-chart-wrapper my-4 block">
      <div
        ref={renderedRef}
        onClick={handleClick}
        className={cn(
          "mermaid-rendered cursor-pointer overflow-x-auto rounded-lg border border-border/40 bg-card p-4 text-center transition-all duration-150",
          "hover:border-border hover:bg-accent/20",
          selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
          renderError && "border-destructive/50"
        )}
        title={editor.isEditable ? "Click to edit" : undefined}
      />
    </NodeViewWrapper>
  );
}
