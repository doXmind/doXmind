/**
 * Math Migration Plugin for TipTap
 *
 * This plugin converts text containing $ delimiters into proper math nodes
 * when content is loaded via setContent() or pasted.
 */

import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { containsCjk } from "./cjk";

export const MathMigrationPluginKey = new PluginKey("mathMigration");

// Regex patterns for math detection
// Block math: $$...$$ (can span multiple lines)
const BLOCK_MATH_PATTERN = /\$\$([\s\S]*?)\$\$/g;
// Inline math: $...$ but not $$ or \$
const INLINE_MATH_PATTERN = /(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g;

/**
 * Check if a text string contains at least one math delimiter pair whose
 * content does NOT contain CJK. CJK-only matches are gated out by ADR 0006
 * so they aren't migration targets — counting them would make the plugin
 * loop forever (replace → no-op → re-trigger).
 */
function containsMathDelimiters(text: string): boolean {
  return hasNonCjkMatch(text, BLOCK_MATH_PATTERN) || hasNonCjkMatch(text, INLINE_MATH_PATTERN);
}

function hasNonCjkMatch(text: string, re: RegExp): boolean {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!containsCjk(m[1] ?? "")) return true;
  }
  return false;
}

/**
 * Process text to extract math expressions and create appropriate nodes
 */
function processTextWithMath(text: string, schema: Schema): PMNode[] {
  const nodes: PMNode[] = [];
  let lastIndex = 0;

  // First pass: find all block math ($$...$$). CJK-content matches are
  // skipped per ADR 0006 — they fall through to be emitted verbatim as
  // text alongside the surrounding paragraph.
  const blockMatches: Array<{ start: number; end: number; latex: string }> = [];
  let blockMatch;
  BLOCK_MATH_PATTERN.lastIndex = 0;
  while ((blockMatch = BLOCK_MATH_PATTERN.exec(text)) !== null) {
    if (containsCjk(blockMatch[1] ?? "")) continue;
    blockMatches.push({
      start: blockMatch.index,
      end: blockMatch.index + blockMatch[0].length,
      latex: blockMatch[1],
    });
  }

  // If we have block math, process segments
  if (blockMatches.length > 0) {
    for (const match of blockMatches) {
      // Text before this block math - process for inline math
      if (match.start > lastIndex) {
        const beforeText = text.slice(lastIndex, match.start);
        nodes.push(...processInlineMath(beforeText, schema));
      }

      // Create block math node
      const blockMathType = schema.nodes.blockMath;
      if (blockMathType) {
        nodes.push(blockMathType.create({ latex: match.latex.trim() }));
      }

      lastIndex = match.end;
    }

    // Remaining text after last block math
    if (lastIndex < text.length) {
      nodes.push(...processInlineMath(text.slice(lastIndex), schema));
    }

    return nodes;
  }

  // No block math found - only process inline math
  return processInlineMath(text, schema);
}

/**
 * Process text for inline math ($...$)
 */
function processInlineMath(text: string, schema: Schema): PMNode[] {
  const nodes: PMNode[] = [];
  let lastIndex = 0;
  let inlineMatch;

  INLINE_MATH_PATTERN.lastIndex = 0;
  while ((inlineMatch = INLINE_MATH_PATTERN.exec(text)) !== null) {
    // CJK-content `$...$` is gated per ADR 0006: leave it as text. We don't
    // advance `lastIndex`, so the literal `$市值$` will be folded into the
    // next slice that gets emitted as a text node.
    if (containsCjk(inlineMatch[1] ?? "")) continue;

    // Text before this inline math
    if (inlineMatch.index > lastIndex) {
      const beforeText = text.slice(lastIndex, inlineMatch.index);
      if (beforeText) {
        nodes.push(schema.text(beforeText));
      }
    }

    // Create inline math node
    const inlineMathType = schema.nodes.inlineMath;
    if (inlineMathType) {
      nodes.push(inlineMathType.create({ latex: inlineMatch[1].trim() }));
    }

    lastIndex = inlineMatch.index + inlineMatch[0].length;
  }

  // Remaining text after last inline math
  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex);
    if (remainingText) {
      nodes.push(schema.text(remainingText));
    }
  } else if (lastIndex === 0 && text) {
    // No inline math found, return original text
    nodes.push(schema.text(text));
  }

  return nodes;
}

/**
 * Check if a document contains any text nodes with math delimiters
 */
function documentNeedsMigration(doc: PMNode): boolean {
  let needsMigration = false;

  doc.descendants((node) => {
    if (needsMigration) return false; // Stop early if already found

    if (node.isText && node.text) {
      if (containsMathDelimiters(node.text)) {
        needsMigration = true;
        return false;
      }
    }
    return true;
  });

  return needsMigration;
}

/**
 * Create the math migration plugin
 */
export function createMathMigrationPlugin() {
  let migrationScheduled = false;

  return new Plugin({
    key: MathMigrationPluginKey,

    appendTransaction(transactions, oldState, newState) {
      // Check if any transaction changed the document
      const docChanged = transactions.some((tr) => tr.docChanged);
      if (!docChanged) return null;

      // Check if this looks like a content replacement (setContent)
      // vs a normal user edit
      const isContentReplacement = transactions.some((tr) => {
        // Large replacements that span most of the document
        // or transactions without history (programmatic changes)
        return (
          tr.docChanged &&
          (tr.getMeta("addToHistory") === false ||
            (tr.steps.length > 0 &&
              tr.steps.some((step) => {
                const stepJson = step.toJSON();
                // Check if it's replacing a large portion
                return stepJson.from === 0 || stepJson.stepType === "replaceAround";
              })))
        );
      });

      // Skip normal user edits to avoid re-triggering on every keystroke
      if (!isContentReplacement && migrationScheduled) {
        return null;
      }

      // Check if migration is needed
      if (!documentNeedsMigration(newState.doc)) {
        migrationScheduled = true;
        return null;
      }

      // Perform migration
      const { tr } = newState;
      const schema = newState.schema;

      // Collect all text nodes that need migration
      const nodesToReplace: Array<{
        pos: number;
        node: PMNode;
        newNodes: PMNode[];
      }> = [];

      newState.doc.descendants((node, pos) => {
        if (node.isText && node.text && containsMathDelimiters(node.text)) {
          const newNodes = processTextWithMath(node.text, schema);
          if (newNodes.length > 0) {
            nodesToReplace.push({ pos, node, newNodes });
          }
        }
        return true;
      });

      // Apply replacements in reverse order to maintain positions
      nodesToReplace.reverse().forEach(({ pos, node, newNodes }) => {
        tr.replaceWith(pos, pos + node.nodeSize, newNodes);
      });

      migrationScheduled = true;

      if (tr.docChanged) {
        // Mark this transaction as not adding to history
        // so undo doesn't undo the migration
        tr.setMeta("addToHistory", false);
        return tr;
      }

      return null;
    },
  });
}
