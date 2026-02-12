/**
 * Block Handle Extension for TipTap
 *
 * Provides drop indicator and block highlight decorations.
 * Hover detection and drag logic are handled by the React component (block-handle.tsx)
 * using mousedown/mousemove/mouseup — NOT via ProseMirror DOM event handlers.
 * This avoids the mouseleave timing gap when the mouse moves from the editor
 * to the block handle portal, and avoids HTML5 drag issues with portal elements.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface BlockHandlePluginState {
  /** Drop target block position during drag */
  dropTargetPos: number | null;
  /** Which side of the target block the indicator appears on */
  dropSide: "before" | "after";
  /** Block position to highlight (when action menu is open) */
  highlightedBlockPos: number | null;
}

export const BlockHandlePluginKey = new PluginKey<BlockHandlePluginState>("blockHandle");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockHandle: {
      setDropTarget: (pos: number | null, side?: "before" | "after") => ReturnType;
      setHighlightedBlock: (pos: number | null) => ReturnType;
    };
  }
}

export interface BlockHandleOptions {
  /** Whether the extension is enabled (should be false on mobile) */
  enabled: boolean;
}

/**
 * Find the top-level block at given coordinates.
 * Returns the ProseMirror position of the block start, or null.
 * Exported so the React component can reuse it.
 */
export function findBlockAtCoords(
  view: {
    posAtCoords: (coords: { left: number; top: number }) => { pos: number } | null;
    state: {
      doc: {
        content: { size: number };
        resolve: (pos: number) => { depth: number; before: (depth: number) => number };
      };
    };
  },
  x: number,
  y: number
): number | null {
  const posInfo = view.posAtCoords({ left: x, top: y });
  if (!posInfo) return null;

  const { pos } = posInfo;
  if (pos < 0 || pos > view.state.doc.content.size) return null;

  try {
    const $pos = view.state.doc.resolve(pos);
    if ($pos.depth >= 1) {
      return $pos.before(1);
    }
  } catch {
    // Position out of range
  }

  return null;
}

export const BlockHandleExtension = Extension.create<BlockHandleOptions>({
  name: "blockHandle",

  addOptions() {
    return {
      enabled: true,
    };
  },

  addCommands() {
    return {
      setDropTarget:
        (pos: number | null, side: "before" | "after" = "before") =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(BlockHandlePluginKey, { dropTargetPos: pos, dropSide: side });
            tr.setMeta("addToHistory", false);
            dispatch(tr);
          }
          return true;
        },

      setHighlightedBlock:
        (pos: number | null) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(BlockHandlePluginKey, { highlightedBlockPos: pos });
            tr.setMeta("addToHistory", false);
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    if (!this.options.enabled) return [];

    return [
      new Plugin<BlockHandlePluginState>({
        key: BlockHandlePluginKey,

        state: {
          init: () => ({
            dropTargetPos: null,
            dropSide: "before" as const,
            highlightedBlockPos: null,
          }),

          apply(tr, value) {
            const meta = tr.getMeta(BlockHandlePluginKey);
            if (meta !== undefined) {
              return { ...value, ...meta };
            }

            // Remap positions on doc change
            if (tr.docChanged) {
              const mapped = { ...value };
              if (value.dropTargetPos !== null) {
                mapped.dropTargetPos = tr.mapping.map(value.dropTargetPos);
              }
              if (value.highlightedBlockPos !== null) {
                mapped.highlightedBlockPos = tr.mapping.map(value.highlightedBlockPos);
              }
              if (
                mapped.dropTargetPos !== value.dropTargetPos ||
                mapped.highlightedBlockPos !== value.highlightedBlockPos
              ) {
                return mapped;
              }
            }

            return value;
          },
        },

        props: {
          decorations(state) {
            const pluginState = this.getState(state);
            if (!pluginState) return DecorationSet.empty;

            const decorations: Decoration[] = [];

            // Drop indicator: Notion-style blue line above or below target block
            if (pluginState.dropTargetPos !== null) {
              try {
                const node = state.doc.nodeAt(pluginState.dropTargetPos);
                if (node) {
                  const className =
                    pluginState.dropSide === "before" ? "block-drop-before" : "block-drop-after";
                  decorations.push(
                    Decoration.node(
                      pluginState.dropTargetPos,
                      pluginState.dropTargetPos + node.nodeSize,
                      {
                        class: className,
                      }
                    )
                  );
                }
              } catch {
                // Invalid position
              }
            }

            // Highlighted block (action menu open)
            if (pluginState.highlightedBlockPos !== null) {
              try {
                const node = state.doc.nodeAt(pluginState.highlightedBlockPos);
                if (node) {
                  decorations.push(
                    Decoration.node(
                      pluginState.highlightedBlockPos,
                      pluginState.highlightedBlockPos + node.nodeSize,
                      {
                        class: "block-handle-active",
                      }
                    )
                  );
                }
              } catch {
                // Invalid position
              }
            }

            if (decorations.length === 0) return DecorationSet.empty;
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
