"use client";

import { useState, useCallback, useEffect, useSyncExternalStore } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { cn } from "@/lib/utils";
import {
  renderMermaidSvg,
  getMermaidThemeKey,
  subscribeMermaidTheme,
} from "@/lib/mermaid-renderer";
import { MermaidEditorPanel } from "./mermaid-editor-panel";

/**
 * Module-level caches that survive ProseMirror node-view remounts during
 * initial setContent and React StrictMode double-invoke. Without these the
 * async mermaid render result is lost whenever the component unmounts before
 * the SVG resolves and the next mount has to start from scratch.
 *
 * Both caches are keyed on `${theme}::${code}` because mermaid bakes the
 * theme palette into the SVG as concrete fill/stroke attributes — flipping
 * light/dark must not serve the previous palette back.
 */
const svgCache = new Map<string, string>();
const inFlightRenders = new Map<string, Promise<string>>();

function chartCacheKey(theme: string, code: string): string {
  return `${theme}::${code}`;
}

function useMermaidThemeKey(): string {
  return useSyncExternalStore(subscribeMermaidTheme, getMermaidThemeKey, () => "ssr");
}

type RenderState =
  | { kind: "empty" }
  | { kind: "loading" }
  | { kind: "ready"; svg: string }
  | { kind: "error" };

/**
 * Renders the Mermaid chart in non-edit mode; click to enter edit mode.
 *
 * The SVG is held in React state and projected via `dangerouslySetInnerHTML`
 * rather than written imperatively, so a remount or re-render driven by
 * ProseMirror cannot wipe the chart between commit and the next paint.
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
  const [isEditing, setIsEditing] = useState(!code);
  const themeKey = useMermaidThemeKey();

  const trimmedCode = (code || "").trim();
  const cacheKey = trimmedCode ? chartCacheKey(themeKey, trimmedCode) : "";

  // Initialize state from cache if available so a remount paints the SVG on
  // the very first commit — no "Rendering mermaid…" flicker.
  const [renderState, setRenderState] = useState<RenderState>(() => {
    if (!trimmedCode) return { kind: "empty" };
    const cached = svgCache.get(cacheKey);
    return cached ? { kind: "ready", svg: cached } : { kind: "loading" };
  });

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

  // Drive the async render. State transitions are committed via setState so
  // React owns the DOM — no imperative innerHTML races with ProseMirror.
  useEffect(() => {
    if (isEditing) return;

    if (!trimmedCode) {
      setRenderState({ kind: "empty" });
      return;
    }

    const cached = svgCache.get(cacheKey);
    if (cached) {
      setRenderState({ kind: "ready", svg: cached });
      return;
    }

    setRenderState({ kind: "loading" });

    let inFlight = inFlightRenders.get(cacheKey);
    if (!inFlight) {
      inFlight = renderMermaidSvg(trimmedCode);
      inFlightRenders.set(cacheKey, inFlight);
      inFlight.then(
        (svg) => {
          svgCache.set(cacheKey, svg);
          if (inFlightRenders.get(cacheKey) === inFlight) {
            inFlightRenders.delete(cacheKey);
          }
        },
        () => {
          if (inFlightRenders.get(cacheKey) === inFlight) {
            inFlightRenders.delete(cacheKey);
          }
        }
      );
    }

    let cancelled = false;
    inFlight.then(
      (svg) => {
        if (cancelled) return;
        setRenderState({ kind: "ready", svg });
      },
      () => {
        if (cancelled) return;
        setRenderState({ kind: "error" });
      }
    );

    return () => {
      cancelled = true;
    };
  }, [trimmedCode, cacheKey, isEditing]);

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
        onClick={handleEnterEdit}
        className={cn(
          "mermaid-rendered cursor-pointer overflow-auto rounded-lg border border-border/40 bg-card p-4 text-center transition-all duration-150",
          "hover:border-border hover:bg-accent/20",
          renderState.kind === "error" && "border-destructive/50"
        )}
      >
        <MermaidRenderedContent state={renderState} code={trimmedCode} />
      </div>
    </NodeViewWrapper>
  );
}

function MermaidRenderedContent({ state, code }: { state: RenderState; code: string }) {
  if (state.kind === "empty") {
    return <span className="mermaid-empty-placeholder">Empty chart — click to edit</span>;
  }
  if (state.kind === "loading") {
    return <span className="mermaid-empty-placeholder text-xs">Rendering mermaid…</span>;
  }
  if (state.kind === "error") {
    return (
      <pre className="whitespace-pre-wrap p-2 text-left font-mono text-xs text-muted-foreground">
        <span className="select-none text-muted-foreground/70">mermaid{"\n"}</span>
        {code}
      </pre>
    );
  }
  // ready — project the SVG; React owns the subtree so ProseMirror can't wipe it.
  return (
    <div className="mermaid-rendered-svg-host" dangerouslySetInnerHTML={{ __html: state.svg }} />
  );
}

// Test-only hook to reset the module-level caches between cases.
export const __mermaidTestUtils = {
  clearCaches() {
    svgCache.clear();
    inFlightRenders.clear();
  },
  cacheKey: chartCacheKey,
  svgCacheSize: () => svgCache.size,
};
