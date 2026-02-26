"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Pencil, Copy, Trash2, ArrowUpFromLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { renderMermaidSvg } from "@/lib/mermaid-renderer";
import { isInsideList, liftAtomBlock } from "@/lib/block-operations";
import { useIsMobile } from "@/hooks/use-device-type";
import { Tooltip } from "@/components/ui/tooltip";
import { AiLogoIcon } from "@/components/ui/ai-logo-icon";
import { useChatContextStore } from "@/stores/chat-context-store";
import { useLayoutStore } from "@/stores/layout-store";
import { MermaidEditorPanel } from "./mermaid-editor-panel";

/**
 * Mermaid Node View Component
 *
 * Renders mermaid diagrams with hover overlay toolbar (matching image block pattern).
 * Hover → toolbar at top-right. Double-click or Edit button → edit mode.
 */
export function MermaidNodeView({
  node,
  updateAttributes,
  selected,
  deleteNode,
  editor,
  getPos,
}: NodeViewProps) {
  const { code } = node.attrs;
  const isMobile = useIsMobile();

  const [localCode, setLocalCode] = useState(code || "");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(!code);
  const [isHovered, setIsHovered] = useState(false);
  const renderedRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  let nodePos: number | undefined;
  try {
    nodePos = typeof getPos === "function" ? getPos() : undefined;
  } catch {
    // getPos() can throw during unmount
  }

  const isNested = nodePos !== undefined && isInsideList(editor.state.doc, nodePos);

  const handleLiftOut = useCallback(() => {
    if (nodePos !== undefined) {
      liftAtomBlock(editor, nodePos);
    }
  }, [editor, nodePos]);

  // Show toolbar on hover or when selected (like image block)
  const showToolbar = (isHovered || selected) && !isEditing;

  // Listen for block-enter-edit event (Enter key from block selection)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      let nodePos: number | undefined;
      try {
        nodePos = typeof getPos === "function" ? getPos() : undefined;
      } catch {
        // getPos() can throw during unmount
      }
      if (detail?.pos === nodePos && detail?.type === "mermaidChart") {
        setIsEditing(true);
      }
    };
    document.addEventListener("block-enter-edit", handler);
    return () => document.removeEventListener("block-enter-edit", handler);
  }, [getPos]);

  // Render mermaid diagram into a target element
  const renderMermaid = useCallback(async (targetEl: HTMLDivElement, mermaidCode: string) => {
    if (!mermaidCode?.trim()) {
      targetEl.innerHTML =
        '<span class="mermaid-empty-placeholder">Empty chart — click to edit</span>';
      setRenderError(null);
      return;
    }

    try {
      const svg = await renderMermaidSvg(mermaidCode);
      targetEl.innerHTML = svg;

      // Make SVG responsive and constrained
      const svgEl = targetEl.querySelector("svg");
      if (svgEl) {
        svgEl.style.maxWidth = "100%";
        svgEl.style.maxHeight = "inherit";
        svgEl.style.height = "auto";
        svgEl.style.width = "auto";
      }

      setRenderError(null);
    } catch {
      setRenderError("render-failed");
      const safeCode = mermaidCode
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      targetEl.innerHTML = `<pre class="text-xs text-muted-foreground whitespace-pre-wrap font-mono p-2"><span class="text-muted-foreground/70 select-none">mermaid</span>\n${safeCode}</pre>`;
    }
  }, []);

  // Render final diagram when not editing
  useEffect(() => {
    if (!renderedRef.current || isEditing) return;
    renderMermaid(renderedRef.current, code);
  }, [code, isEditing, renderMermaid]);

  // Render preview immediately when entering edit mode
  const initialRenderDone = useRef(false);
  useEffect(() => {
    if (!isEditing) {
      initialRenderDone.current = false;
      return;
    }
    if (!initialRenderDone.current && previewRef.current && localCode) {
      initialRenderDone.current = true;
      renderMermaid(previewRef.current, localCode);
    }
  }, [isEditing, localCode, renderMermaid]);

  // Live debounced preview for subsequent edits
  const prevCodeRef = useRef(localCode);
  useEffect(() => {
    if (!isEditing || !previewRef.current) return;
    if (localCode === prevCodeRef.current && initialRenderDone.current) return;
    prevCodeRef.current = localCode;
    if (!initialRenderDone.current) return;

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

  // Enter edit mode
  const handleEnterEdit = useCallback(() => {
    if (!editor.isEditable) return;
    setIsEditing(true);
  }, [editor.isEditable]);

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

  // Copy code to clipboard
  const handleCopyCode = useCallback(() => {
    if (code) {
      navigator.clipboard.writeText(code);
    }
  }, [code]);

  // Ask AI about this chart
  const handleAskInChat = useCallback(() => {
    if (code && nodePos !== undefined) {
      useChatContextStore.getState().addChatContext({
        type: "selection",
        text: code,
        from: nodePos,
        to: nodePos + node.nodeSize,
      });
      useLayoutStore.getState().setChatOpen(true);
    }
  }, [code, nodePos, node.nodeSize]);

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

  // Render mode with hover overlay toolbar
  return (
    <NodeViewWrapper as="div" className="mermaid-chart-wrapper my-4 block">
      <div
        className="group relative"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Overlay toolbar - top-right inside chart (matching image block) */}
        {showToolbar && !isMobile && editor.isEditable && (
          <div
            className="image-overlay-toolbar"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {isNested && (
              <>
                <Tooltip content="Lift out of list" side="top">
                  <button type="button" className="image-toolbar-icon-btn" onClick={handleLiftOut}>
                    <ArrowUpFromLine className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
                <div className="image-toolbar-sep" />
              </>
            )}
            <Tooltip content="Ask AI" side="top">
              <button type="button" className="image-toolbar-btn" onClick={handleAskInChat}>
                <AiLogoIcon className="h-3.5 w-3.5" />
                <span className="text-xs">Ask AI</span>
              </button>
            </Tooltip>
            <div className="image-toolbar-sep" />
            <Tooltip content="Edit code" side="top">
              <button type="button" className="image-toolbar-icon-btn" onClick={handleEnterEdit}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <Tooltip content="Copy code" side="top">
              <button type="button" className="image-toolbar-icon-btn" onClick={handleCopyCode}>
                <Copy className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <div className="image-toolbar-sep" />
            <Tooltip content="Delete" side="top">
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
        )}

        {/* Rendered chart */}
        <div
          ref={renderedRef}
          onDoubleClick={handleEnterEdit}
          className={cn(
            "mermaid-rendered cursor-pointer overflow-x-auto rounded-lg border border-border/40 bg-card p-4 text-center transition-all duration-150",
            "hover:border-border hover:bg-accent/20",
            renderError && "border-destructive/50"
          )}
        />
      </div>
    </NodeViewWrapper>
  );
}
