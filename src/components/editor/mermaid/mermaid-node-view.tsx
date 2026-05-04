"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { renderMermaidSvg } from "@/lib/mermaid-renderer";
import { MermaidEditorPanel } from "./mermaid-editor-panel";

/**
 * Renders the Mermaid chart in non-edit mode; click to enter edit mode.
 */
export function MermaidNodeView({
  node,
  updateAttributes,
  deleteNode,
  editor,
  getPos,
}: NodeViewProps) {
  const { code } = node.attrs;

  const [localCode, setLocalCode] = useState(code || "");
  const [renderError, setRenderError] = useState(false);
  const [isEditing, setIsEditing] = useState(!code);
  const renderedRef = useRef<HTMLDivElement>(null);

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
      if (detail?.pos === currentPos && detail?.type === "mermaidChart") {
        setIsEditing(true);
      }
    };
    document.addEventListener("block-enter-edit", handler);
    return () => document.removeEventListener("block-enter-edit", handler);
  }, [getPos]);

  // Render the saved chart when not editing.
  useEffect(() => {
    if (!renderedRef.current || isEditing) return;
    const target = renderedRef.current;
    const mermaidCode = (code || "").trim();

    if (!mermaidCode) {
      target.innerHTML =
        '<span class="mermaid-empty-placeholder">Empty chart — click to edit</span>';
      setRenderError(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const svg = await renderMermaidSvg(mermaidCode);
        if (cancelled) return;
        target.innerHTML = svg;
        const svgEl = target.querySelector("svg");
        if (svgEl) {
          svgEl.style.maxWidth = "100%";
          svgEl.style.maxHeight = "460px";
          svgEl.style.height = "auto";
          svgEl.style.width = "auto";
          svgEl.style.margin = "0 auto";
        }
        setRenderError(false);
      } catch {
        if (cancelled) return;
        setRenderError(true);
        const safe = mermaidCode.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        target.innerHTML = `<pre class="text-xs text-muted-foreground whitespace-pre-wrap font-mono p-2"><span class="text-muted-foreground/70 select-none">mermaid</span>\n${safe}</pre>`;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, isEditing]);

  // Sync local code when prop changes
  useEffect(() => {
    if (!isEditing) {
      setLocalCode(code || "");
    }
  }, [code, isEditing]);

  const handleEnterEdit = useCallback(() => {
    if (!editor.isEditable) return;
    setIsEditing(true);
  }, [editor.isEditable]);

  const handleSave = useCallback(() => {
    const trimmed = localCode.trim();
    if (trimmed) {
      updateAttributes({ code: trimmed });
      setIsEditing(false);
    } else {
      deleteNode();
    }
  }, [localCode, updateAttributes, deleteNode]);

  const handleCancel = useCallback(() => {
    if (code) {
      setLocalCode(code);
      setIsEditing(false);
    } else {
      deleteNode();
    }
  }, [code, deleteNode]);

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

  if (isEditing) {
    return (
      <NodeViewWrapper as="div" className="mermaid-chart-wrapper my-4 block">
        <MermaidEditorPanel
          code={localCode}
          onChange={setLocalCode}
          onSave={handleSave}
          onCancel={handleCancel}
          onKeyDown={handleKeyDown}
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="div" className="mermaid-chart-wrapper my-4 block">
      <div
        ref={renderedRef}
        onClick={handleEnterEdit}
        className={cn(
          "mermaid-rendered cursor-pointer overflow-auto rounded-lg border border-border/40 bg-card p-4 text-center transition-all duration-150",
          "hover:border-border hover:bg-accent/20",
          renderError && "border-destructive/50"
        )}
      />
    </NodeViewWrapper>
  );
}
