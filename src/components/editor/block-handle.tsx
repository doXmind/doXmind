"use client";

import { useState, useEffect, useRef, useCallback, memo } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { GripVertical, Plus } from "lucide-react";
import { TextSelection } from "@tiptap/pm/state";
import { findBlockAtCoords } from "@/extensions/block-handle-extension";
import { useStreamingStore } from "@/stores/streaming-store";
import { useTranslations } from "next-intl";
import { BlockActionMenu } from "./block-action-menu";
import { BlockInsertMenu } from "./block-insert-menu";

interface BlockHandleProps {
  editor: Editor;
}

/**
 * Compute the x position for a menu so its right edge aligns with the block
 * content's left edge (Notion-style: menu extends leftward into the margin).
 */
function computeMenuAnchorX(
  editor: Editor,
  blockPos: number,
  menuWidth: number,
  fallbackX: number
): number {
  let blockDom = editor.view.nodeDOM(blockPos) as HTMLElement | null;

  // For list items, use parent list element for consistent alignment
  if (blockDom) {
    const node = editor.state.doc.nodeAt(blockPos);
    if (node && (node.type.name === "listItem" || node.type.name === "taskItem")) {
      try {
        const $pos = editor.state.doc.resolve(blockPos);
        if ($pos.depth >= 1) {
          const parentDom = editor.view.nodeDOM($pos.before($pos.depth)) as HTMLElement | null;
          if (parentDom) blockDom = parentDom;
        }
      } catch {
        /* fallback to listItem's own dom */
      }
    }
  }

  const contentLeft = blockDom ? blockDom.getBoundingClientRect().left : fallbackX;
  return Math.max(8, contentLeft - menuWidth);
}

/** Delay before hiding the handle when mouse leaves (ms) */
const HIDE_DELAY = 300;

/** Minimum mouse movement before initiating drag (px) */
const DRAG_THRESHOLD = 5;

/**
 * Block Handle Component
 *
 * Renders a floating [+] [⋮⋮] handle in the left margin of the hovered block.
 *
 * IMPORTANT: Hover detection is done entirely in this component via DOM event
 * listeners on editor.view.dom — NOT via ProseMirror plugin state/transactions.
 * This avoids the mouseleave timing gap when the mouse moves from the editor
 * to the handle (which lives in a portal on document.body).
 *
 * Drag & drop uses mousedown/mousemove/mouseup (NOT HTML5 drag API) to avoid
 * portal-to-editor drag conflicts. Drop indicator is Notion-style: a blue line
 * between blocks (above or below target depending on cursor vertical position).
 */
export const BlockHandle = memo(function BlockHandle({ editor }: BlockHandleProps) {
  const t = useTranslations("editor");
  // The block position we're showing the handle for
  const [hoveredBlockPos, setHoveredBlockPos] = useState<number | null>(null);
  // Computed screen position
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  // Action menu state (grip click)
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [actionMenuAnchor, setActionMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  // Insert menu state (plus click)
  const [isInsertMenuOpen, setIsInsertMenuOpen] = useState(false);
  const [insertMenuAnchor, setInsertMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  // Whether a drag is in progress
  const [isDragging, setIsDragging] = useState(false);

  const gripRef = useRef<HTMLButtonElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMouseOverHandleRef = useRef(false);
  const isMenuOpenRef = useRef(false); // true when any menu (action or insert) is open
  const hoveredBlockPosRef = useRef<number | null>(null);
  const isScrollingRef = useRef(false);
  const lastScrollTimeRef = useRef(0);
  const lastMousePosRef = useRef<{ x: number; y: number } | null>(null);

  // --- Drag state refs (not React state to avoid re-renders during drag) ---
  const dragStateRef = useRef<{
    active: boolean; // true once drag threshold exceeded
    startX: number; // mousedown position
    startY: number;
    sourceFrom: number; // block ProseMirror positions
    sourceTo: number;
    dropTargetPos: number | null; // target block start position
    dropSide: "before" | "after"; // which side of target to show line
    ghostEl: HTMLElement | null;
  } | null>(null);

  // Cancel any pending hide timer
  const cancelHide = useCallback(() => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  // Schedule hiding the handle after a delay
  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      // Only hide if the mouse isn't over the handle and action menu isn't open
      if (!isMouseOverHandleRef.current && !isMenuOpenRef.current) {
        hoveredBlockPosRef.current = null;
        setHoveredBlockPos(null);
        setPosition(null);
      }
    }, HIDE_DELAY);
  }, [cancelHide]);

  // Compute screen position from a ProseMirror block position
  const computePosition = useCallback(
    (blockPos: number): { top: number; left: number } | null => {
      try {
        const dom = editor.view.nodeDOM(blockPos) as HTMLElement | null;
        if (!dom) return null;

        const blockRect = dom.getBoundingClientRect();
        const node = editor.state.doc.nodeAt(blockPos);

        // For non-text blocks (image, math, chart, hr), align handle
        // with the top of the block rather than trying to match line-height
        const isMediaBlock =
          node &&
          (node.isAtom ||
            node.type.name === "image" ||
            node.type.name === "table" ||
            node.type.name === "codeBlock");

        let top: number;
        if (isMediaBlock) {
          // Align with the top of the block, vertically centered on first ~28px
          top = blockRect.top + 6;
        } else {
          // Read the actual line-height of the block's first text element
          // to center the handle precisely with the first line of text
          const computedStyle = window.getComputedStyle(dom);
          const lineHeight = parseFloat(computedStyle.lineHeight) || 24;
          const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
          // Center on the first line: block top + padding + half line height - half button height (14px)
          top = blockRect.top + paddingTop + lineHeight / 2 - 14;
        }

        // For list items, use the parent list element's left edge so the
        // handle aligns with other top-level blocks instead of being indented.
        let left = blockRect.left;
        if (node && (node.type.name === "listItem" || node.type.name === "taskItem")) {
          try {
            const $pos = editor.state.doc.resolve(blockPos);
            if ($pos.depth >= 1) {
              const parentPos = $pos.before($pos.depth);
              const parentDom = editor.view.nodeDOM(parentPos) as HTMLElement | null;
              if (parentDom) {
                left = parentDom.getBoundingClientRect().left;
              }
            }
          } catch {
            // Fall back to list item's own left
          }
        }

        // Place handle to the left of block content with a small gap
        left = left - 6;

        return { top, left };
      } catch {
        return null;
      }
    },
    [editor]
  );

  // --- Hover detection via DOM listeners on editor.view.dom ---
  useEffect(() => {
    const editorDOM = editor.view.dom;

    const handleMouseMove = (event: MouseEvent) => {
      if (isDragging) return;
      // Don't update hovered block while a menu is open — changing
      // hoveredBlockPos would cause BlockActionMenu to target a different block.
      if (isMenuOpenRef.current) return;
      // Hide block handle during AI streaming to prevent accidental edits
      if (useStreamingStore.getState().isStreaming) return;

      const { clientX, clientY } = event;
      const lastPos = lastMousePosRef.current;
      const mouseActuallyMoved = !lastPos || lastPos.x !== clientX || lastPos.y !== clientY;
      lastMousePosRef.current = { x: clientX, y: clientY };

      // During/after scroll, require both a cooldown period AND actual mouse
      // movement before showing handles again. This prevents flicker from
      // micro-movements during trackpad/wheel scrolling.
      if (isScrollingRef.current) {
        const timeSinceScroll = Date.now() - lastScrollTimeRef.current;
        if (!mouseActuallyMoved || timeSinceScroll < 150) return;
        isScrollingRef.current = false;
      }

      let blockPos = findBlockAtCoords(editor.view, clientX, clientY);

      // For lists, resolve to the individual list item instead of the list wrapper.
      // This makes the block handle and action menu work per-item (like Notion).
      if (blockPos !== null) {
        try {
          const node = editor.state.doc.nodeAt(blockPos);
          if (
            node &&
            (node.type.name === "bulletList" ||
              node.type.name === "orderedList" ||
              node.type.name === "taskList")
          ) {
            const posInfo = editor.view.posAtCoords({ left: clientX, top: clientY });
            if (posInfo) {
              const $pos = editor.state.doc.resolve(posInfo.pos);
              if ($pos.depth >= 2) {
                const depth1Name = $pos.node(1).type.name;
                if (
                  depth1Name === "bulletList" ||
                  depth1Name === "orderedList" ||
                  depth1Name === "taskList"
                ) {
                  blockPos = $pos.before(2);
                }
              }
            }
          }
        } catch {
          // Keep the original blockPos
        }
      }

      if (blockPos !== null && blockPos !== hoveredBlockPosRef.current) {
        // New block hovered
        cancelHide();
        hoveredBlockPosRef.current = blockPos;
        setHoveredBlockPos(blockPos);

        const pos = computePosition(blockPos);
        setPosition(pos);
      } else if (blockPos === null && hoveredBlockPosRef.current !== null) {
        // Mouse moved off all blocks (e.g., padding area)
        scheduleHide();
      }
    };

    const handleMouseLeave = () => {
      // Mouse left the editor — schedule hide (handle's mouseenter will cancel it)
      scheduleHide();
    };

    const handleScroll = () => {
      // When a menu (action or insert) is open, don't hide the handle —
      // the menus depend on hoveredBlockPos being non-null to stay mounted.
      if (isMenuOpenRef.current) return;
      // Immediately hide on scroll. Handles won't reappear until
      // 150ms after the last scroll event AND the mouse actually moves.
      isScrollingRef.current = true;
      lastScrollTimeRef.current = Date.now();
      cancelHide();
      hoveredBlockPosRef.current = null;
      setHoveredBlockPos(null);
      setPosition(null);
    };

    editorDOM.addEventListener("mousemove", handleMouseMove);
    editorDOM.addEventListener("mouseleave", handleMouseLeave);

    // Listen to scroll on the nearest scrollable parent
    const scrollParent =
      editorDOM.closest("[data-radix-scroll-area-viewport]") || editorDOM.parentElement;
    scrollParent?.addEventListener("scroll", handleScroll, { passive: true });
    // Also listen for wheel events — but only trigger when scrolling over the
    // editor area. Wheel events inside menus/popups should NOT hide handles.
    const handleWheel = (e: WheelEvent) => {
      const target = e.target as Node;
      if (scrollParent?.contains(target) || editorDOM.contains(target)) {
        handleScroll();
      }
    };
    document.addEventListener("wheel", handleWheel, { passive: true });

    return () => {
      editorDOM.removeEventListener("mousemove", handleMouseMove);
      editorDOM.removeEventListener("mouseleave", handleMouseLeave);
      scrollParent?.removeEventListener("scroll", handleScroll);
      document.removeEventListener("wheel", handleWheel);
      cancelHide();
    };
  }, [editor, isDragging, cancelHide, scheduleHide, computePosition]);

  // Recompute position when the document changes (blocks may shift)
  useEffect(() => {
    if (hoveredBlockPos === null) return;

    const updatePos = () => {
      if (hoveredBlockPosRef.current === null) return;
      const pos = computePosition(hoveredBlockPosRef.current);
      if (pos) {
        setPosition(pos);
      } else {
        // Block no longer valid
        hoveredBlockPosRef.current = null;
        setHoveredBlockPos(null);
        setPosition(null);
      }
    };

    editor.on("transaction", updatePos);
    return () => {
      editor.off("transaction", updatePos);
    };
  }, [editor, hoveredBlockPos, computePosition]);

  // --- Block highlight via ProseMirror Decoration (reliable across re-renders) ---
  const highlightBlock = useCallback(
    (blockPos: number) => {
      editor.commands.setHighlightedBlock(blockPos);
    },
    [editor]
  );

  const clearBlockHighlight = useCallback(() => {
    editor.commands.setHighlightedBlock(null);
  }, [editor]);

  // --- Handle mouse enter/leave on the handle itself ---
  const handleMouseEnter = useCallback(() => {
    isMouseOverHandleRef.current = true;
    cancelHide();
  }, [cancelHide]);

  const handleMouseLeave = useCallback(() => {
    isMouseOverHandleRef.current = false;
    // If any menu is open, don't hide
    if (!isActionMenuOpen && !isInsertMenuOpen) {
      scheduleHide();
    }
  }, [isActionMenuOpen, isInsertMenuOpen, scheduleHide]);

  // --- + button: open block insert menu ---
  const handlePlusClick = useCallback(
    (e: React.MouseEvent) => {
      const blockPos = hoveredBlockPosRef.current;
      if (blockPos === null) return;

      // Position menu to the left of content (Notion-style)
      const target = e.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      const x = computeMenuAnchorX(editor, blockPos, 280, rect.right);
      setInsertMenuAnchor({ x, y: rect.bottom + 4 });
      setIsInsertMenuOpen(true);
      isMenuOpenRef.current = true;
    },
    [editor]
  );

  // --- Grip click: open action menu ---
  const handleGripClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (!gripRef.current) return;
      const rect = gripRef.current.getBoundingClientRect();
      const blockPos = hoveredBlockPosRef.current;
      // Position menu to the left of content (Notion-style)
      const x =
        blockPos !== null ? computeMenuAnchorX(editor, blockPos, 220, rect.right) : rect.left;
      setActionMenuAnchor({ x, y: rect.bottom + 4 });
      setIsActionMenuOpen(true);
      isMenuOpenRef.current = true;
      // Highlight the block that the menu applies to
      if (blockPos !== null) {
        highlightBlock(blockPos);
      }
      // Dismiss any active autocomplete ghost text
      editor.commands.clearSuggestion();
      // Clear cursor focus so the caret doesn't show alongside the block highlight
      editor.commands.blur();
    },
    [editor, highlightBlock]
  );

  // --- Custom drag implementation (mousedown/mousemove/mouseup) ---
  // Cleanup helper for drag state
  const cleanupDrag = useCallback(() => {
    const ds = dragStateRef.current;
    if (ds?.ghostEl) {
      ds.ghostEl.remove();
    }
    dragStateRef.current = null;
    setIsDragging(false);
    editor.commands.setDropTarget(null);
    editor.view.dom.classList.remove("is-block-dragging");
  }, [editor]);

  // Compute the insert position from drop target + side
  const getInsertPos = useCallback(
    (targetPos: number, side: "before" | "after"): number | null => {
      if (side === "before") return targetPos;
      // "after": insert at the end of the target block
      try {
        const node = editor.state.doc.nodeAt(targetPos);
        if (node) return targetPos + node.nodeSize;
      } catch {
        /* invalid pos */
      }
      return null;
    },
    [editor]
  );

  // Perform the actual block move
  const performBlockMove = useCallback(
    (sourceFrom: number, sourceTo: number, insertPos: number) => {
      const { state } = editor.view;
      const docSize = state.doc.content.size;

      // Validate
      if (sourceFrom < 0 || sourceTo > docSize || sourceFrom >= sourceTo) return;
      if (insertPos < 0 || insertPos > docSize) return;
      // No-op: inserting right before or right after the source block
      if (insertPos === sourceFrom || insertPos === sourceTo) return;

      const tr = state.tr;
      const sourceSlice = state.doc.slice(sourceFrom, sourceTo);
      let newBlockPos: number;

      if (insertPos < sourceFrom) {
        // Moving up: insert first, then delete the original (now shifted)
        tr.insert(insertPos, sourceSlice.content);
        const shift = sourceSlice.content.size;
        tr.delete(sourceFrom + shift, sourceTo + shift);
        newBlockPos = insertPos;
      } else {
        // Moving down: delete source first, then insert at mapped position
        tr.delete(sourceFrom, sourceTo);
        const mappedInsertPos = tr.mapping.map(insertPos);
        tr.insert(mappedInsertPos, sourceSlice.content);
        newBlockPos = mappedInsertPos;
      }

      // Set cursor at start of moved block (collapsed selection).
      // Without this, ProseMirror maps the old selection through the
      // insert/delete changes, which can land the cursor in an unrelated
      // block and trigger the floating/bubble menu.
      try {
        const $pos = tr.doc.resolve(newBlockPos + 1);
        tr.setSelection(TextSelection.near($pos));
      } catch {
        // If position is invalid (e.g. complex node), keep default mapping
      }

      editor.view.dispatch(tr);
    },
    [editor]
  );

  // Grip mousedown → start tracking for potential drag
  const handleGripMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only left click
      if (e.button !== 0) return;
      e.preventDefault(); // prevent text selection and editor blur

      let blockPos = hoveredBlockPosRef.current;
      if (blockPos === null) return;

      let node = editor.state.doc.nodeAt(blockPos);
      if (!node) return;

      // For drag: if hovering a list item, drag the parent list instead.
      // Dragging individual list items to top-level positions would violate
      // the ProseMirror schema (listItem can't be a doc child).
      if (node.type.name === "listItem" || node.type.name === "taskItem") {
        try {
          const $pos = editor.state.doc.resolve(blockPos);
          if ($pos.depth >= 1) {
            blockPos = $pos.before($pos.depth);
            node = editor.state.doc.nodeAt(blockPos);
            if (!node) return;
          }
        } catch {
          return;
        }
      }

      // Initialize drag tracking (not yet active until threshold)
      dragStateRef.current = {
        active: false,
        startX: e.clientX,
        startY: e.clientY,
        sourceFrom: blockPos,
        sourceTo: blockPos + node.nodeSize,
        dropTargetPos: null,
        dropSide: "before",
        ghostEl: null,
      };
    },
    [editor]
  );

  // Document-level mousemove/mouseup during drag
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const ds = dragStateRef.current;
      if (!ds) return;

      if (!ds.active) {
        // Check threshold
        const dx = e.clientX - ds.startX;
        const dy = e.clientY - ds.startY;
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;

        // Activate drag
        ds.active = true;
        setIsDragging(true);
        editor.view.dom.classList.add("is-block-dragging");
        // Dismiss any active autocomplete ghost text
        editor.commands.clearSuggestion();
        // Clear cursor focus during drag so the caret doesn't distract
        editor.commands.blur();

        // Create ghost element
        try {
          const dom = editor.view.nodeDOM(ds.sourceFrom) as HTMLElement | null;
          if (dom) {
            const ghost = dom.cloneNode(true) as HTMLElement;
            ghost.style.position = "fixed";
            ghost.style.zIndex = "9999";
            ghost.style.opacity = "0.7";
            ghost.style.pointerEvents = "none";
            ghost.style.maxWidth = "400px";
            ghost.style.width = `${dom.getBoundingClientRect().width}px`;
            ghost.style.transform = "rotate(1deg)";
            ghost.style.boxShadow = "0 4px 16px rgba(0,0,0,0.15)";
            ghost.style.borderRadius = "4px";
            ghost.style.background = "var(--popover, #fff)";
            document.body.appendChild(ghost);
            ds.ghostEl = ghost;
          }
        } catch {
          // Could not create ghost
        }
      }

      // Update ghost position
      if (ds.ghostEl) {
        ds.ghostEl.style.left = `${e.clientX + 12}px`;
        ds.ghostEl.style.top = `${e.clientY - 12}px`;
      }

      // Calculate drop target and side (Notion-style: above/below midpoint)
      const blockPos = findBlockAtCoords(editor.view, e.clientX, e.clientY);
      if (blockPos !== null) {
        // Determine side: is cursor above or below the block's vertical midpoint?
        let side: "before" | "after" = "before";
        try {
          const dom = editor.view.nodeDOM(blockPos) as HTMLElement | null;
          if (dom) {
            const rect = dom.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            side = e.clientY < midY ? "before" : "after";
          }
        } catch {
          /* use default "before" */
        }

        // Compute effective insert position to check for no-op
        const insertPos =
          side === "before"
            ? blockPos
            : (() => {
                try {
                  const node = editor.state.doc.nodeAt(blockPos);
                  return node ? blockPos + node.nodeSize : null;
                } catch {
                  return null;
                }
              })();

        // Skip showing indicator for no-op drops (line adjacent to source block)
        const isNoOp =
          insertPos === null || insertPos === ds.sourceFrom || insertPos === ds.sourceTo;

        if (isNoOp) {
          // Clear indicator
          if (ds.dropTargetPos !== null) {
            ds.dropTargetPos = null;
            editor.commands.setDropTarget(null);
          }
        } else if (blockPos !== ds.dropTargetPos || side !== ds.dropSide) {
          ds.dropTargetPos = blockPos;
          ds.dropSide = side;
          editor.commands.setDropTarget(blockPos, side);
        }
      } else if (ds.dropTargetPos !== null) {
        ds.dropTargetPos = null;
        editor.commands.setDropTarget(null);
      }
    };

    const onMouseUp = () => {
      const ds = dragStateRef.current;
      if (!ds) return;

      if (ds.active && ds.dropTargetPos !== null) {
        // Compute actual insert position from target + side
        const insertPos = getInsertPos(ds.dropTargetPos, ds.dropSide);
        if (insertPos !== null) {
          performBlockMove(ds.sourceFrom, ds.sourceTo, insertPos);
        }
      }

      const wasDrag = ds.active;
      cleanupDrag();

      // Clear handle position after drag
      if (wasDrag) {
        hoveredBlockPosRef.current = null;
        setHoveredBlockPos(null);
        setPosition(null);
      }
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [editor, cleanupDrag, getInsertPos, performBlockMove]);

  // Cleanup drag on unmount
  useEffect(() => {
    return () => {
      if (dragStateRef.current) {
        cleanupDrag();
      }
    };
  }, [cleanupDrag]);

  const closeActionMenu = useCallback(() => {
    setIsActionMenuOpen(false);
    isMenuOpenRef.current = false;
    setActionMenuAnchor(null);
    clearBlockHighlight();
    // After closing menu, schedule hide so it disappears naturally
    scheduleHide();
  }, [scheduleHide, clearBlockHighlight]);

  const closeInsertMenu = useCallback(() => {
    setIsInsertMenuOpen(false);
    isMenuOpenRef.current = false;
    setInsertMenuAnchor(null);
    scheduleHide();
  }, [scheduleHide]);

  const isVisible = position !== null && !isDragging;

  return createPortal(
    <>
      {isVisible && (
        <div
          ref={handleRef}
          data-block-handle
          className="fixed z-20 flex items-center"
          style={{
            top: position.top,
            left: position.left,
            transform: "translateX(-100%)",
            transition: "top 0.1s ease",
          }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Plus button: insert new block */}
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-[4px] text-muted-foreground/60 transition-all duration-150 hover:bg-muted hover:text-muted-foreground"
            onMouseDown={(e) => {
              e.preventDefault(); // prevent editor blur
              handlePlusClick(e);
            }}
            title={t("blockHandle.addBelow")}
          >
            <Plus className="h-[18px] w-[18px]" strokeWidth={2.2} />
          </button>

          {/* Drag handle / action menu trigger */}
          <button
            ref={gripRef}
            type="button"
            className="flex h-7 w-7 cursor-grab items-center justify-center rounded-[4px] text-muted-foreground/60 transition-all duration-150 hover:bg-muted hover:text-muted-foreground active:cursor-grabbing"
            onMouseDown={handleGripMouseDown}
            onMouseUp={(e) => {
              // If no drag occurred (just a click), open action menu
              if (!dragStateRef.current?.active) {
                handleGripClick(e);
              }
            }}
            title={t("blockHandle.dragToMove")}
          >
            <GripVertical className="h-[18px] w-[18px]" />
          </button>
        </div>
      )}

      {/* Block Action Menu (grip click) */}
      {isActionMenuOpen && actionMenuAnchor && hoveredBlockPos !== null && (
        <BlockActionMenu
          editor={editor}
          blockPos={hoveredBlockPos}
          position={actionMenuAnchor}
          onClose={closeActionMenu}
        />
      )}

      {/* Block Insert Menu (plus click) */}
      {isInsertMenuOpen && insertMenuAnchor && hoveredBlockPos !== null && (
        <BlockInsertMenu
          editor={editor}
          insertAfterPos={hoveredBlockPos}
          anchor={insertMenuAnchor}
          onClose={closeInsertMenu}
        />
      )}
    </>,
    document.body
  );
});
