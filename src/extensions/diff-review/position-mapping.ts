/**
 * Diff Review Extension - Position Mapping Utilities
 *
 * Functions for finding text positions in ProseMirror documents.
 * Primary strategy: "Apply and Diff" — replicate the backend's markdown replace,
 * parse both full markdowns through ProseMirror, diff textContent to find positions.
 * Fallback: exact match and normalized whitespace match on doc.textContent.
 */

import {
  DOMParser as ProseMirrorDOMParser,
  type Node as PMNode,
  type Schema,
} from "@tiptap/pm/model";
import { markdownToHtml } from "@/lib/markdown";
import { normalizeTableHtml, normalizeMermaidHtml } from "./replacement-utils";
import type { TextPosition } from "./diff-types";

/**
 * Internal: mapping from textContent offset to ProseMirror position.
 */
interface TextPosEntry {
  start: number; // textContent offset (inclusive)
  end: number; // textContent offset (exclusive)
  pos: number; // ProseMirror position of the text node
  blockPos: number; // ProseMirror position of containing block node
}

/**
 * Build mapping from doc.textContent character offsets to ProseMirror positions.
 * Also accounts for non-text leaf nodes (e.g., hardBreak) that contribute to textContent
 * via their schema's leafText spec.
 */
function buildTextPositionMap(doc: PMNode): TextPosEntry[] {
  let textOffset = 0;
  const entries: TextPosEntry[] = [];

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      const $pos = doc.resolve(pos);
      let blockPos = pos;
      for (let d = $pos.depth; d > 0; d--) {
        if ($pos.node(d).isBlock) {
          blockPos = $pos.before(d);
          break;
        }
      }

      entries.push({
        start: textOffset,
        end: textOffset + node.text.length,
        pos,
        blockPos,
      });
      textOffset += node.text.length;
    } else if (node.isLeaf && node.type.spec.leafText) {
      // Non-text leaf nodes like hardBreak contribute to doc.textContent
      const leafText = node.type.spec.leafText(node);
      if (leafText) textOffset += leafText.length;
    }
    return true;
  });

  return entries;
}

/**
 * Map a textContent offset range [startOff, endOff) to ProseMirror TextPosition.
 */
function mapOffsetsToPosition(
  startOff: number,
  endOff: number,
  entries: TextPosEntry[]
): TextPosition | null {
  let from: number | null = null;
  let to: number | null = null;
  let blockStart: number | null = null;

  for (const tp of entries) {
    if (from === null && startOff >= tp.start && startOff < tp.end) {
      from = tp.pos + (startOff - tp.start);
      blockStart = tp.blockPos;
    }
    if (to === null && endOff > tp.start && endOff <= tp.end) {
      to = tp.pos + (endOff - tp.start);
    }
    if (from !== null && to !== null) break;
  }

  if (from !== null && to !== null && blockStart !== null) {
    return { from, to, blockStart };
  }
  return null;
}

/**
 * Find ALL occurrences of a text string in the document (exact match only).
 * Maps results to ProseMirror positions with blockStart and blockTypeName info.
 */
export function findAllTextInDocument(doc: PMNode, searchText: string): TextPosition[] {
  if (!searchText) return [];

  const entries = buildTextPositionMap(doc);
  const fullText = doc.textContent;
  const results: TextPosition[] = [];
  let searchStart = 0;

  while (searchStart < fullText.length) {
    const idx = fullText.indexOf(searchText, searchStart);
    if (idx === -1) break;

    const pos = mapOffsetsToPosition(idx, idx + searchText.length, entries);
    if (pos) {
      // Resolve the block type name for disambiguation when multiple matches exist
      try {
        const $pos = doc.resolve(pos.from);
        for (let d = $pos.depth; d > 0; d--) {
          if ($pos.node(d).isBlock) {
            pos.blockTypeName = $pos.node(d).type.name;
            break;
          }
        }
      } catch {
        // Ignore resolution errors
      }
      results.push(pos);
    }

    searchStart = idx + 1;
  }

  return results;
}

/**
 * Find the ProseMirror position of a text string in the document (exact match).
 * Returns { from, to, blockStart } or null if not found.
 *
 * When multiple matches exist and preferredBlockType is provided, prefers the
 * occurrence inside a block of that type (e.g., "heading" over "listItem").
 * This prevents matching TOC entries instead of actual headings.
 *
 * @param doc - The ProseMirror document node
 * @param searchText - The text to search for
 * @param excludePositions - Set of 'from' positions to exclude (already used by other hunks)
 * @param preferredBlockType - Preferred block node type name for disambiguation
 */
export function findTextInDocument(
  doc: PMNode,
  searchText: string,
  excludePositions?: Set<number>,
  preferredBlockType?: string | null
): TextPosition | null {
  const allOccurrences = findAllTextInDocument(doc, searchText);

  if (allOccurrences.length === 0) return null;

  // Filter out excluded positions
  const candidates =
    excludePositions && excludePositions.size > 0
      ? allOccurrences.filter((occ) => !excludePositions.has(occ.from))
      : allOccurrences;

  if (candidates.length === 0) return null;
  if (candidates.length === 1 || !preferredBlockType) return candidates[0];

  // Multiple candidates: prefer the one in the matching block type
  const preferred = candidates.find((c) => c.blockTypeName === preferredBlockType);
  return preferred || candidates[0];
}

/**
 * Parse a full markdown string through ProseMirror.
 * Uses the same pipeline as the editor: markdown → HTML → normalize → ProseMirror DOM parser.
 */
function parseFullMarkdown(markdown: string, schema: Schema): PMNode {
  const html = markdownToHtml(markdown);
  const el = document.createElement("div");
  el.innerHTML = html;
  normalizeTableHtml(el);
  normalizeMermaidHtml(el);
  return ProseMirrorDOMParser.fromSchema(schema).parse(el);
}

/**
 * Cache for the reference document's textContent (parsed from originalMarkdown).
 * Map-based to support multiple markdown variants (original + cumulative for sequential edits).
 * Avoids re-parsing the full document for every hunk.
 */
const referenceTextCache = new Map<string, string>();

function getOrBuildReferenceText(markdown: string, schema: Schema): string {
  const cached = referenceTextCache.get(markdown);
  if (cached !== undefined) return cached;
  const doc = parseFullMarkdown(markdown, schema);
  const textContent = doc.textContent;
  referenceTextCache.set(markdown, textContent);
  return textContent;
}

/** Clear the reference text cache (call when diff session ends). */
export function clearMarkdownCache(): void {
  referenceTextCache.clear();
}

/**
 * Resolve blockStart and blockTypeName on a TextPosition by inspecting the document.
 */
function resolveBlockInfo(doc: PMNode, pos: TextPosition): void {
  try {
    const $pos = doc.resolve(pos.from);
    for (let d = $pos.depth; d > 0; d--) {
      if ($pos.node(d).isBlock) {
        pos.blockTypeName = $pos.node(d).type.name;
        break;
      }
    }
  } catch {
    // Ignore resolution errors
  }
}

/**
 * Markdown-first matching using the "Apply and Diff" approach.
 *
 * Replicates the backend's logic: find old_str in the document's markdown,
 * apply the deletion, parse both full markdowns through ProseMirror,
 * and diff textContent to find the exact position range.
 *
 * This avoids parsing markdown fragments (which fails for table rows, etc.)
 * because both old and new are complete documents that always parse correctly.
 *
 * Two-tier strategy:
 * - Fast path: direct offset mapping when parsed reference textContent matches
 *   the actual editor document's textContent.
 * - Fallback: "Extract and Search" — extracts the removed text from the clean
 *   reference diff and searches for it in the actual document. This handles
 *   textContent mismatches caused by lossy HTML→markdown→HTML roundtrip
 *   (nbsp, entity encoding, extension-specific parsing, etc.).
 */
export function findTextViaMarkdown(
  doc: PMNode,
  oldContent: string,
  markdown: string,
  excludePositions?: Set<number>,
  _preferredBlockType?: string | null,
  schema?: Schema
): TextPosition | null {
  if (!oldContent || !markdown || !schema) return null;

  const actualText = doc.textContent;

  // Step 1: Replicate backend logic — find old_str in the full markdown
  let searchFrom = 0;

  while (searchFrom < markdown.length) {
    const mdIdx = markdown.indexOf(oldContent, searchFrom);
    if (mdIdx === -1) return null;

    // Step 2: Delete old_str from markdown (to find what textContent it produced)
    const newMarkdown = markdown.slice(0, mdIdx) + markdown.slice(mdIdx + oldContent.length);

    // Step 3: Parse both full markdowns through ProseMirror and get textContent
    const refOldText = getOrBuildReferenceText(markdown, schema);
    const newDoc = parseFullMarkdown(newMarkdown, schema);
    const refNewText = newDoc.textContent;

    // Step 4: Diff reference textContent to find the removed range
    let start = 0;
    const minLen = Math.min(refOldText.length, refNewText.length);
    while (start < minLen && refOldText[start] === refNewText[start]) {
      start++;
    }
    let oldEnd = refOldText.length;
    let newEnd = refNewText.length;
    while (oldEnd > start && newEnd > start && refOldText[oldEnd - 1] === refNewText[newEnd - 1]) {
      oldEnd--;
      newEnd--;
    }

    if (start >= oldEnd) {
      // No text difference found (old_str produces no visible text — e.g., image-only)
      // Fall through to next occurrence
      searchFrom = mdIdx + 1;
      continue;
    }

    // Step 5: Map to ProseMirror positions in the actual document
    const entries = buildTextPositionMap(doc);

    // Fast path: direct offset mapping when reference text matches actual document
    if (refOldText === actualText) {
      const pos = mapOffsetsToPosition(start, oldEnd, entries);
      if (pos && !excludePositions?.has(pos.from)) {
        resolveBlockInfo(doc, pos);
        return pos;
      }
      // Direct mapping failed (offset at node boundary) — try Extract and Search below
    }

    // Fallback: "Extract and Search"
    // The parsed reference textContent may differ from the actual editor document
    // (lossy HTML→markdown→HTML roundtrip: nbsp, entities, custom nodes, etc.)
    // Extract the removed text from the clean reference diff and search in the actual doc.
    const removedText = refOldText.slice(start, oldEnd);
    if (removedText) {
      const allOccurrences = findAllTextInDocument(doc, removedText);
      const candidates =
        excludePositions && excludePositions.size > 0
          ? allOccurrences.filter((occ) => !excludePositions.has(occ.from))
          : allOccurrences;

      if (candidates.length > 0) {
        // Single match or first match — findAllTextInDocument already resolves blockInfo
        return candidates[0];
      }

      // Last resort: normalized whitespace search for the removed text
      const normalizedResult = findTextNormalized(doc, removedText, excludePositions);
      if (normalizedResult) return normalizedResult;
    }

    searchFrom = mdIdx + 1;
  }

  return null;
}

/**
 * Disambiguate among multiple candidates using preferredBlockType.
 */
function disambiguate(
  candidates: TextPosition[],
  preferredBlockType?: string | null
): TextPosition | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1 || !preferredBlockType) return candidates[0];
  const preferred = candidates.find((c) => c.blockTypeName === preferredBlockType);
  return preferred || candidates[0];
}

/**
 * Find text in document with normalized whitespace matching.
 * Collapses consecutive whitespace to single spaces before comparing.
 * Used as a fallback when exact match fails due to whitespace differences.
 */
export function findTextNormalized(
  doc: PMNode,
  searchText: string,
  excludePositions?: Set<number>,
  preferredBlockType?: string | null
): TextPosition | null {
  if (!searchText) return null;

  const normalizedSearch = searchText.replace(/\s+/g, " ").trim();
  if (!normalizedSearch) return null;

  const entries = buildTextPositionMap(doc);
  const fullText = doc.textContent;

  // Build normalized version of doc text, tracking original char indices
  const normalizedChars: { char: string; origIdx: number }[] = [];
  let lastWasSpace = true; // treat start as space to trim leading
  for (let i = 0; i < fullText.length; i++) {
    const ch = fullText[i];
    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        normalizedChars.push({ char: " ", origIdx: i });
        lastWasSpace = true;
      }
    } else {
      normalizedChars.push({ char: ch, origIdx: i });
      lastWasSpace = false;
    }
  }
  // Trim trailing space
  if (normalizedChars.length > 0 && normalizedChars[normalizedChars.length - 1].char === " ") {
    normalizedChars.pop();
  }

  const normalizedFullText = normalizedChars.map((c) => c.char).join("");
  const results: TextPosition[] = [];
  let start = 0;

  while (start < normalizedFullText.length) {
    const idx = normalizedFullText.indexOf(normalizedSearch, start);
    if (idx === -1) break;

    // Map back to original offsets
    const origStart = normalizedChars[idx].origIdx;
    const lastIdx = idx + normalizedSearch.length - 1;
    const origEnd = normalizedChars[lastIdx].origIdx + 1;

    const pos = mapOffsetsToPosition(origStart, origEnd, entries);
    if (pos) {
      try {
        const $pos = doc.resolve(pos.from);
        for (let d = $pos.depth; d > 0; d--) {
          if ($pos.node(d).isBlock) {
            pos.blockTypeName = $pos.node(d).type.name;
            break;
          }
        }
      } catch {
        // Ignore resolution errors
      }
      results.push(pos);
    }
    start = idx + 1;
  }

  if (results.length === 0) return null;

  const candidates =
    excludePositions && excludePositions.size > 0
      ? results.filter((occ) => !excludePositions.has(occ.from))
      : results;

  return disambiguate(candidates, preferredBlockType);
}
