/**
 * Atom Block Lift Plugin
 *
 * Automatically lifts atom block nodes (mermaidChart, blockMath, image,
 * horizontalRule, tableOfContents) out of list items. These blocks should
 * always be top-level; if one ends up inside a listItem/taskItem (via paste,
 * input rule, slash command, or imported content), this plugin moves it to just
 * after the parent list.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/** Atom block types that should never be nested inside list items */
const ATOM_BLOCK_TYPES = new Set([
  "mermaidChart",
  "blockMath",
  "image",
  "horizontalRule",
  "tableOfContents",
]);

/** List item wrapper types */
const LIST_ITEM_TYPES = new Set(["listItem", "taskItem"]);

/** List container types */
const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

interface NestedAtom {
  atomPos: number;
  atomNode: ProseMirrorNode;
  /** Position of the outermost list ancestor (depth 1 = top-level) */
  listPos: number;
  listNodeSize: number;
}

/**
 * Find all atom blocks that are nested inside list items.
 */
function findNestedAtomBlocks(doc: ProseMirrorNode): NestedAtom[] {
  const results: NestedAtom[] = [];

  doc.descendants((node, pos) => {
    if (!ATOM_BLOCK_TYPES.has(node.type.name)) return true;

    const $pos = doc.resolve(pos);

    // Walk up ancestors looking for a list item
    for (let depth = $pos.depth; depth >= 1; depth--) {
      const ancestor = $pos.node(depth);

      if (LIST_ITEM_TYPES.has(ancestor.type.name)) {
        // Found a list item ancestor — now find the outermost list container
        // Walk further up to find the top-level list (handles nested lists)
        let listDepth = depth;
        for (let d = depth - 1; d >= 1; d--) {
          const upper = $pos.node(d);
          if (LIST_TYPES.has(upper.type.name) || LIST_ITEM_TYPES.has(upper.type.name)) {
            listDepth = d;
          } else {
            break;
          }
        }

        // Ensure we're pointing at the list container, not a list item
        const listNode = $pos.node(listDepth);
        if (LIST_ITEM_TYPES.has(listNode.type.name) && listDepth > 1) {
          listDepth -= 1;
        }

        const listPos = $pos.before(listDepth);
        const listContainer = $pos.node(listDepth);

        results.push({
          atomPos: pos,
          atomNode: node,
          listPos,
          listNodeSize: listContainer.nodeSize,
        });
        break; // only need innermost list item match
      }
    }

    return true;
  });

  return results;
}

/**
 * Create a transaction that lifts all nested atom blocks out of their
 * enclosing lists, placing each one right after its parent list.
 */
function liftNestedAtomBlocks(doc: ProseMirrorNode, tr: Transaction): Transaction | null {
  const nested = findNestedAtomBlocks(doc);
  if (nested.length === 0) return null;

  // Process in reverse document order to keep earlier positions stable
  nested.sort((a, b) => b.atomPos - a.atomPos);

  for (const { atomPos, atomNode, listPos, listNodeSize } of nested) {
    const mappedAtomPos = tr.mapping.map(atomPos);
    const mappedListEnd = tr.mapping.map(listPos + listNodeSize);

    // 1. Delete the atom node from inside the list
    tr.delete(mappedAtomPos, mappedAtomPos + atomNode.nodeSize);

    // 2. Insert it after the list
    const insertPos = tr.mapping.map(mappedListEnd);
    tr.insert(insertPos, atomNode);
  }

  // Make the auto-lift invisible to undo history
  tr.setMeta("addToHistory", false);

  return tr;
}

export const AtomBlockLiftPlugin = Extension.create({
  name: "atomBlockLift",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("atomBlockLift"),

        appendTransaction(transactions, _oldState, newState) {
          // Only act when the document actually changed
          const docChanged = transactions.some((t) => t.docChanged);
          if (!docChanged) return null;

          const { tr } = newState;
          return liftNestedAtomBlocks(newState.doc, tr);
        },
      }),
    ];
  },
});
