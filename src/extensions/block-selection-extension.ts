/**
 * Block Selection Extension for TipTap
 *
 * Mobile-only extension that enables block-level selection by long-press.
 * Long-press on a block to select the entire block.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { SelectableBlock } from "@/types/block-selection";
import { SELECTABLE_BLOCK_TYPES } from "@/types/block-selection";

/** Long-press duration in milliseconds */
const LONG_PRESS_DURATION = 500;

/**
 * Plugin key for accessing block selection state
 */
export const BlockSelectionPluginKey = new PluginKey<BlockSelectionPluginState>("blockSelection");

/**
 * Plugin state interface
 */
export interface BlockSelectionPluginState {
  /** IDs of currently selected blocks */
  selectedBlockIds: Set<string>;
  /** Whether the extension is enabled (mobile only) */
  isEnabled: boolean;
}

/**
 * Find the selectable block at a given position
 */
function findBlockAtPosition(doc: ProseMirrorNode, pos: number): SelectableBlock | null {
  // Ensure pos is within document bounds
  if (pos < 0 || pos > doc.content.size) {
    return null;
  }

  const $pos = doc.resolve(pos);

  // Walk up the tree to find a selectable block
  // Start from depth-1 since depth 0 is the doc node
  for (let depth = $pos.depth; depth >= 1; depth--) {
    const node = $pos.node(depth);
    const nodeType = node.type.name;

    // Check if this is a selectable block type
    if (SELECTABLE_BLOCK_TYPES.includes(nodeType as never)) {
      const from = $pos.before(depth);
      const to = $pos.after(depth);

      return {
        id: `block-${from}`,
        type: nodeType,
        from,
        to,
        text: node.textContent || "",
        level: node.attrs.level,
        depth,
      };
    }
  }

  return null;
}

/**
 * Extract all selectable blocks from a document
 */
export function extractBlocks(doc: ProseMirrorNode): SelectableBlock[] {
  const blocks: SelectableBlock[] = [];

  doc.descendants((node, pos, _parent, _index) => {
    const nodeType = node.type.name;

    // Check if this is a selectable block type
    if (SELECTABLE_BLOCK_TYPES.includes(nodeType as never)) {
      // Skip list items - we select the whole list instead
      if (nodeType === "listItem" || nodeType === "taskItem") {
        return false;
      }

      blocks.push({
        id: `block-${pos}`,
        type: nodeType,
        from: pos,
        to: pos + node.nodeSize,
        text: node.textContent || "",
        level: node.attrs?.level,
        depth: 0, // Will be recalculated if needed
      });

      // Don't descend into list items (we already got the list)
      if (nodeType === "bulletList" || nodeType === "orderedList" || nodeType === "taskList") {
        return false;
      }
    }

    return true;
  });

  return blocks;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockSelection: {
      /**
       * Set selected block IDs
       */
      setSelectedBlocks: (blockIds: string[]) => ReturnType;
      /**
       * Clear block selection
       */
      clearBlockSelection: () => ReturnType;
      /**
       * Enable/disable block selection mode
       */
      setBlockSelectionEnabled: (enabled: boolean) => ReturnType;
    };
  }
}

export interface BlockSelectionOptions {
  /**
   * Whether block selection is enabled (default: false, should be true on mobile)
   */
  enabled: boolean;
  /**
   * CSS class for selected blocks
   */
  selectedClass: string;
  /**
   * Callback when a block is selected (tap on mobile)
   */
  onBlockSelect?: (block: SelectableBlock, event: MouseEvent | TouchEvent) => void;
  /**
   * Selection mode:
   * - 'tap' for single tap (mobile)
   * - 'longpress' for long-press (mobile)
   * - 'desktop' for keyboard-driven selection (Esc to select, Shift+Arrow to extend)
   */
  selectionMode?: "tap" | "longpress" | "desktop";
  /**
   * Long-press duration in milliseconds (default: 500, only used in longpress mode)
   */
  longPressDuration?: number;
}

export const BlockSelectionExtension = Extension.create<BlockSelectionOptions>({
  name: "blockSelection",

  addOptions() {
    return {
      enabled: false,
      selectedClass: "block-selected",
      onBlockSelect: undefined,
      selectionMode: "tap" as const, // Default to tap for mobile
      longPressDuration: LONG_PRESS_DURATION,
    };
  },

  addProseMirrorPlugins() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const extension = this;
    const isTapMode = extension.options.selectionMode === "tap";
    const isDesktopMode = extension.options.selectionMode === "desktop";

    // For longpress mode
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let pressStartPos: number | null = null;
    let pressStartEvent: MouseEvent | TouchEvent | null = null;

    // For tap mode - track touch start position to detect movement
    let touchStartX: number | null = null;
    let touchStartY: number | null = null;
    const TAP_THRESHOLD = 10; // Max pixels moved to still count as tap

    const clearLongPress = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      pressStartPos = null;
      pressStartEvent = null;
    };

    const selectBlockAtPosition = (
      doc: ProseMirrorNode,
      pos: number,
      event: MouseEvent | TouchEvent
    ) => {
      const block = findBlockAtPosition(doc, pos);
      if (block) {
        // Clear any text selection
        window.getSelection()?.removeAllRanges();

        // Dispatch custom event for React components
        const customEvent = new CustomEvent("block-select", {
          detail: { block, event },
        });
        document.dispatchEvent(customEvent);

        // Call callback if provided
        extension.options.onBlockSelect?.(block, event);

        // Haptic feedback on mobile
        if (navigator.vibrate) {
          navigator.vibrate(30);
        }

        return true;
      }
      return false;
    };

    return [
      new Plugin<BlockSelectionPluginState>({
        key: BlockSelectionPluginKey,

        state: {
          init: () => ({
            selectedBlockIds: new Set<string>(),
            isEnabled: extension.options.enabled,
          }),

          apply(tr, value) {
            const meta = tr.getMeta(BlockSelectionPluginKey);
            if (meta !== undefined) {
              return { ...value, ...meta };
            }

            // When document changes, remap selected block positions
            if (tr.docChanged && value.selectedBlockIds.size > 0) {
              const newSelectedIds = new Set<string>();

              for (const oldId of value.selectedBlockIds) {
                const match = oldId.match(/^block-(\d+)$/);
                if (match) {
                  const oldPos = parseInt(match[1], 10);
                  const newPos = tr.mapping.map(oldPos);
                  newSelectedIds.add(`block-${newPos}`);
                }
              }

              return { ...value, selectedBlockIds: newSelectedIds };
            }

            return value;
          },
        },

        props: {
          // Desktop mode: handle keyboard events for block selection
          ...(isDesktopMode
            ? {
                handleKeyDown(view, event) {
                  const pluginState = BlockSelectionPluginKey.getState(view.state);
                  if (!pluginState?.isEnabled) return false;

                  const hasSelection = pluginState.selectedBlockIds.size > 0;

                  // Escape: Select the current block (enter block selection mode)
                  if (event.key === "Escape" && !hasSelection) {
                    const { $from } = view.state.selection;
                    if ($from.depth >= 1) {
                      const block = findBlockAtPosition(view.state.doc, $from.pos);
                      if (block) {
                        const tr = view.state.tr.setMeta(BlockSelectionPluginKey, {
                          selectedBlockIds: new Set([block.id]),
                        });
                        view.dispatch(tr);

                        // Dispatch custom event for React
                        const customEvent = new CustomEvent("block-select", {
                          detail: { block, event },
                        });
                        document.dispatchEvent(customEvent);

                        return true;
                      }
                    }
                    return false;
                  }

                  // Escape with selection: clear block selection
                  if (event.key === "Escape" && hasSelection) {
                    const tr = view.state.tr.setMeta(BlockSelectionPluginKey, {
                      selectedBlockIds: new Set<string>(),
                    });
                    view.dispatch(tr);

                    // Dispatch clear event for React
                    document.dispatchEvent(new CustomEvent("block-selection-clear"));
                    return true;
                  }

                  // Enter: Return to text editing in the first selected block
                  if (event.key === "Enter" && hasSelection) {
                    const firstId = Array.from(pluginState.selectedBlockIds)[0];
                    const match = firstId?.match(/^block-(\d+)$/);
                    if (match) {
                      const pos = parseInt(match[1], 10);
                      const tr = view.state.tr.setMeta(BlockSelectionPluginKey, {
                        selectedBlockIds: new Set<string>(),
                      });
                      view.dispatch(tr);

                      // Focus into the block
                      try {
                        view.dispatch(
                          view.state.tr.setSelection(
                            // @ts-expect-error -- TextSelection is available
                            view.state.selection.constructor.near(view.state.doc.resolve(pos + 1))
                          )
                        );
                      } catch {
                        // Position might be invalid
                      }

                      document.dispatchEvent(new CustomEvent("block-selection-clear"));
                      return true;
                    }
                  }

                  // Shift+ArrowUp/Down: Extend block selection
                  if (
                    event.shiftKey &&
                    (event.key === "ArrowUp" || event.key === "ArrowDown") &&
                    hasSelection
                  ) {
                    event.preventDefault();
                    const blocks = extractBlocks(view.state.doc);
                    const selectedIds = pluginState.selectedBlockIds;

                    // Find the range of selected block indices
                    const selectedIndices = blocks
                      .map((b, i) => (selectedIds.has(b.id) ? i : -1))
                      .filter((i) => i >= 0);

                    if (selectedIndices.length === 0) return false;

                    const minIdx = Math.min(...selectedIndices);
                    const maxIdx = Math.max(...selectedIndices);

                    let newIds: Set<string>;
                    if (event.key === "ArrowUp" && minIdx > 0) {
                      // Add the block above
                      newIds = new Set(selectedIds);
                      newIds.add(blocks[minIdx - 1].id);
                    } else if (event.key === "ArrowDown" && maxIdx < blocks.length - 1) {
                      // Add the block below
                      newIds = new Set(selectedIds);
                      newIds.add(blocks[maxIdx + 1].id);
                    } else {
                      return false;
                    }

                    const tr = view.state.tr.setMeta(BlockSelectionPluginKey, {
                      selectedBlockIds: newIds,
                    });
                    view.dispatch(tr);
                    return true;
                  }

                  // Backspace/Delete: Delete all selected blocks
                  if ((event.key === "Backspace" || event.key === "Delete") && hasSelection) {
                    event.preventDefault();
                    const blocks = extractBlocks(view.state.doc);
                    const selectedIds = pluginState.selectedBlockIds;

                    // Get positions of selected blocks in reverse order
                    const toDelete = blocks
                      .filter((b) => selectedIds.has(b.id))
                      .sort((a, b) => b.from - a.from);

                    if (toDelete.length >= view.state.doc.childCount) {
                      // Don't delete everything, clear content instead
                      const tr = view.state.tr;
                      tr.replaceWith(
                        0,
                        view.state.doc.content.size,
                        view.state.schema.nodes.paragraph.create()
                      );
                      tr.setMeta(BlockSelectionPluginKey, {
                        selectedBlockIds: new Set<string>(),
                      });
                      view.dispatch(tr);
                    } else {
                      const tr = view.state.tr;
                      for (const block of toDelete) {
                        tr.delete(tr.mapping.map(block.from), tr.mapping.map(block.to));
                      }
                      tr.setMeta(BlockSelectionPluginKey, {
                        selectedBlockIds: new Set<string>(),
                      });
                      view.dispatch(tr);
                    }

                    document.dispatchEvent(new CustomEvent("block-selection-clear"));
                    return true;
                  }

                  return false;
                },
              }
            : {}),

          handleDOMEvents: {
            // Desktop mode: keyboard-only, no DOM event handlers
            // Tap mode: touch handlers for mobile tap selection
            // Longpress mode: touch/mouse handlers for long-press selection
            ...(isDesktopMode
              ? {}
              : isTapMode
                ? {
                    touchstart(view, event) {
                      const pluginState = BlockSelectionPluginKey.getState(view.state);
                      if (!pluginState?.isEnabled) return false;

                      const touch = event.touches[0];
                      if (!touch) return false;

                      // Record start position to detect tap vs scroll
                      touchStartX = touch.clientX;
                      touchStartY = touch.clientY;

                      const pos = view.posAtCoords({ left: touch.clientX, top: touch.clientY });
                      if (pos) {
                        pressStartPos = pos.pos;
                      }

                      // Blur editor immediately on touch to prevent keyboard from appearing
                      // This is safe because we're in block selection mode (not editing mode)
                      view.dom.blur();

                      // Prevent default to stop text selection and focus
                      // but allow scrolling by not returning true
                      return false;
                    },

                    touchend(view, event) {
                      const pluginState = BlockSelectionPluginKey.getState(view.state);
                      if (!pluginState?.isEnabled) return false;

                      const touch = event.changedTouches[0];
                      if (!touch || touchStartX === null || touchStartY === null) {
                        touchStartX = null;
                        touchStartY = null;
                        pressStartPos = null;
                        return false;
                      }

                      // Check if this was a tap (minimal movement)
                      const dx = Math.abs(touch.clientX - touchStartX);
                      const dy = Math.abs(touch.clientY - touchStartY);
                      const wasTap = dx < TAP_THRESHOLD && dy < TAP_THRESHOLD;

                      if (wasTap && pressStartPos !== null) {
                        // Prevent the editor from gaining focus (which would show keyboard)
                        event.preventDefault();
                        // Blur the editor to ensure keyboard doesn't appear
                        view.dom.blur();
                        selectBlockAtPosition(view.state.doc, pressStartPos, event);
                      }

                      // Reset tracking
                      touchStartX = null;
                      touchStartY = null;
                      pressStartPos = null;

                      return false;
                    },

                    touchmove() {
                      // If moved too far, cancel the tap
                      // (actual check happens in touchend)
                      return false;
                    },

                    touchcancel() {
                      touchStartX = null;
                      touchStartY = null;
                      pressStartPos = null;
                      return false;
                    },
                  }
                : {
                    mousedown(view, event) {
                      const pluginState = BlockSelectionPluginKey.getState(view.state);
                      if (!pluginState?.isEnabled) return false;

                      const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
                      if (!pos) return false;

                      pressStartPos = pos.pos;
                      pressStartEvent = event;

                      // Clear any existing text selection immediately
                      window.getSelection()?.removeAllRanges();

                      const currentDoc = view.state.doc;
                      longPressTimer = setTimeout(() => {
                        if (pressStartPos !== null && pressStartEvent) {
                          selectBlockAtPosition(currentDoc, pressStartPos, pressStartEvent);
                        }
                        clearLongPress();
                      }, extension.options.longPressDuration);

                      return false;
                    },

                    mouseup() {
                      clearLongPress();
                      return false;
                    },

                    mouseleave() {
                      clearLongPress();
                      return false;
                    },

                    touchstart(view, event) {
                      const pluginState = BlockSelectionPluginKey.getState(view.state);
                      if (!pluginState?.isEnabled) return false;

                      const touch = event.touches[0];
                      if (!touch) return false;

                      const pos = view.posAtCoords({ left: touch.clientX, top: touch.clientY });
                      if (!pos) return false;

                      pressStartPos = pos.pos;
                      pressStartEvent = event;

                      // Clear any existing text selection immediately
                      window.getSelection()?.removeAllRanges();

                      const currentDoc = view.state.doc;
                      longPressTimer = setTimeout(() => {
                        if (pressStartPos !== null && pressStartEvent) {
                          selectBlockAtPosition(currentDoc, pressStartPos, pressStartEvent);
                        }
                        clearLongPress();
                      }, extension.options.longPressDuration);

                      return false;
                    },

                    touchend() {
                      clearLongPress();
                      return false;
                    },

                    touchmove(view, event) {
                      // Cancel long-press if user moves finger
                      if (pressStartPos !== null && event.touches[0]) {
                        const touch = event.touches[0];
                        const pos = view.posAtCoords({ left: touch.clientX, top: touch.clientY });
                        if (!pos || Math.abs(pos.pos - pressStartPos) > 50) {
                          clearLongPress();
                        }
                      }
                      return false;
                    },

                    touchcancel() {
                      clearLongPress();
                      return false;
                    },
                  }),
          },

          // Create decorations for selected blocks
          decorations(state) {
            const pluginState = this.getState(state);
            if (!pluginState?.isEnabled || pluginState.selectedBlockIds.size === 0) {
              return DecorationSet.empty;
            }

            const decorations: Decoration[] = [];
            const blocks = extractBlocks(state.doc);

            for (const block of blocks) {
              if (pluginState.selectedBlockIds.has(block.id)) {
                decorations.push(
                  Decoration.node(block.from, block.to, {
                    class: extension.options.selectedClass,
                    "data-block-id": block.id,
                    "data-block-type": block.type,
                  })
                );
              }
            }

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setSelectedBlocks:
        (blockIds: string[]) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(BlockSelectionPluginKey, {
              selectedBlockIds: new Set(blockIds),
            });
            dispatch(tr);
          }
          return true;
        },

      clearBlockSelection:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(BlockSelectionPluginKey, {
              selectedBlockIds: new Set<string>(),
            });
            dispatch(tr);
          }
          return true;
        },

      setBlockSelectionEnabled:
        (enabled: boolean) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(BlockSelectionPluginKey, {
              isEnabled: enabled,
            });
            dispatch(tr);
          }
          return true;
        },
    };
  },
});

/**
 * Helper function to get current selected block IDs from editor state
 */
export function getSelectedBlockIds(editor: { state: { doc: unknown } } | null): Set<string> {
  if (!editor) return new Set();
  const pluginState = BlockSelectionPluginKey.getState(
    editor.state as Parameters<typeof BlockSelectionPluginKey.getState>[0]
  );
  return pluginState?.selectedBlockIds ?? new Set();
}

/**
 * Helper function to check if block selection is enabled
 */
export function isBlockSelectionEnabled(editor: { state: { doc: unknown } } | null): boolean {
  if (!editor) return false;
  const pluginState = BlockSelectionPluginKey.getState(
    editor.state as Parameters<typeof BlockSelectionPluginKey.getState>[0]
  );
  return pluginState?.isEnabled ?? false;
}
