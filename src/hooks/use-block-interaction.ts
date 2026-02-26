"use client";

import { useState, useCallback, useEffect, useRef } from "react";

/**
 * Block interaction phase for the two-phase model:
 * idle → selected → editing
 */
export type BlockPhase = "idle" | "selected" | "editing";

interface UseBlockInteractionOptions {
  /** TipTap NodeViewProps.selected — true when ProseMirror has NodeSelection on this node */
  selected: boolean;
  /** Whether the editor is in editable mode */
  editorEditable: boolean;
  /** Whether the block has existing content (empty blocks start in edit mode) */
  hasContent: boolean;
  /** Whether to skip the selected phase (mobile: click goes directly to editing) */
  isMobile?: boolean;
  /** Whether this block type supports editing (images don't have an edit mode) */
  hasEditMode?: boolean;
  /** ProseMirror node position (for matching block-enter-edit events) */
  nodePos?: number;
}

interface UseBlockInteractionReturn {
  /** Current interaction phase */
  phase: BlockPhase;
  /** Handle single click on the block content */
  handleClick: (e: React.MouseEvent) => void;
  /** Handle double click on the block content */
  handleDoubleClick: (e: React.MouseEvent) => void;
  /** Programmatically enter edit mode */
  enterEditMode: () => void;
  /** Exit edit mode (back to selected) */
  exitEditMode: () => void;
}

/**
 * Two-phase block interaction hook.
 *
 * Provides Notion-style interaction for non-text blocks:
 * - Desktop: click → select (show toolbar), double-click/Enter → edit
 * - Mobile: click → edit directly (no intermediate select step)
 * - Empty blocks: start in edit mode immediately
 */
export function useBlockInteraction({
  selected,
  editorEditable,
  hasContent,
  isMobile = false,
  hasEditMode = true,
  nodePos,
}: UseBlockInteractionOptions): UseBlockInteractionReturn {
  const [phase, setPhase] = useState<BlockPhase>(() => {
    if (!hasContent && hasEditMode) return "editing";
    return "idle";
  });

  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // Sync with TipTap's selected prop
  useEffect(() => {
    if (selected && editorEditable) {
      if (phaseRef.current === "idle") {
        setPhase("selected");
      }
    } else if (!selected) {
      if (phaseRef.current === "selected") {
        setPhase("idle");
      }
      // If in editing and deselected, also go back to idle
      if (phaseRef.current === "editing") {
        setPhase("idle");
      }
    }
  }, [selected, editorEditable]);

  // Listen for block-enter-edit custom event (dispatched by block-selection-extension on Enter key)
  useEffect(() => {
    if (!hasEditMode) return;

    const handleEnterEdit = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.pos === nodePos && phaseRef.current === "selected") {
        setPhase("editing");
      }
    };

    document.addEventListener("block-enter-edit", handleEnterEdit);
    return () => document.removeEventListener("block-enter-edit", handleEnterEdit);
  }, [nodePos, hasEditMode]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!editorEditable) return;

      // On mobile, skip selected phase and go directly to editing
      if (isMobile && hasEditMode) {
        e.preventDefault();
        e.stopPropagation();
        setPhase("editing");
        return;
      }

      // Desktop: TipTap's NodeSelection handles the transition to selected
      // via the `selected` prop sync above. Nothing extra needed for single click.
    },
    [editorEditable, isMobile, hasEditMode]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!editorEditable || !hasEditMode) return;

      e.preventDefault();
      e.stopPropagation();

      // Double-click transitions to editing from any state
      setPhase("editing");
    },
    [editorEditable, hasEditMode]
  );

  const enterEditMode = useCallback(() => {
    if (!editorEditable || !hasEditMode) return;
    setPhase("editing");
  }, [editorEditable, hasEditMode]);

  const exitEditMode = useCallback(() => {
    // Go back to selected (not idle) so the toolbar stays visible
    setPhase("selected");
  }, []);

  return {
    phase,
    handleClick,
    handleDoubleClick,
    enterEditMode,
    exitEditMode,
  };
}
