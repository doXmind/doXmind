/**
 * Diff Review Extension - Position Mapping Utilities
 *
 * Functions for finding text positions in ProseMirror documents.
 * Supports exact match (primary) and normalized whitespace match (fallback).
 */

import type { Node as PMNode } from "@tiptap/pm/model";
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
 * Simple regex-based markdown stripping to get approximate plain text.
 * Used to estimate character offset in doc.textContent from a markdown offset.
 */
function stripMarkdownSyntax(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "") // heading markers
    .replace(/\*\*\*([\s\S]*?)\*\*\*/g, "$1") // bold+italic
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1") // bold
    .replace(/\*([\s\S]*?)\*/g, "$1") // italic
    .replace(/~~([\s\S]*?)~~/g, "$1") // strikethrough
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/^\s*[-*+]\s+/gm, "") // unordered list markers
    .replace(/^\s*\d+\.\s+/gm, "") // ordered list markers
    .replace(/^\s*>\s?/gm, "") // blockquote markers
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links → text only
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "") // images → remove
    .replace(/\n+/g, "") // newlines → nothing
    .trim();
}

/**
 * Markdown-first matching: use the document's markdown to locate old_str,
 * then find the corresponding position in the ProseMirror document.
 *
 * This mirrors the backend logic (simple indexOf on markdown) and uses
 * the markdown position to narrow the search in doc.textContent.
 */
export function findTextViaMarkdown(
  doc: PMNode,
  oldContent: string,
  markdown: string,
  excludePositions?: Set<number>,
  _preferredBlockType?: string | null
): TextPosition | null {
  if (!oldContent || !markdown) return null;

  // Step 1: Find oldContent in the markdown (same as backend's content.count(old_str))
  const markdownIdx = markdown.indexOf(oldContent);
  if (markdownIdx === -1) return null;

  // Step 2: Get the plain text of oldContent by stripping markdown syntax
  const searchPlainText = stripMarkdownSyntax(oldContent);
  if (!searchPlainText) return null;

  // Step 3: Estimate where in doc.textContent this text should appear
  // by stripping markdown from the prefix
  const markdownPrefix = markdown.slice(0, markdownIdx);
  const prefixPlainLength = stripMarkdownSyntax(markdownPrefix).length;

  // Step 4: Search for the plain text in doc.textContent near the estimated offset
  const entries = buildTextPositionMap(doc);
  const fullText = doc.textContent;

  // Search within a generous window around the estimated position
  const windowSize = 300;
  const searchFrom = Math.max(0, prefixPlainLength - windowSize);
  const searchTo = Math.min(
    fullText.length,
    prefixPlainLength + searchPlainText.length + windowSize
  );
  const searchRegion = fullText.slice(searchFrom, searchTo);

  const localIdx = searchRegion.indexOf(searchPlainText);
  if (localIdx === -1) return null;

  const globalIdx = searchFrom + localIdx;
  const pos = mapOffsetsToPosition(globalIdx, globalIdx + searchPlainText.length, entries);
  if (!pos) return null;

  // Check exclude positions
  if (excludePositions?.has(pos.from)) return null;

  // Resolve block type
  try {
    const $pos = doc.resolve(pos.from);
    for (let d = $pos.depth; d > 0; d--) {
      if ($pos.node(d).isBlock) {
        pos.blockTypeName = $pos.node(d).type.name;
        break;
      }
    }
  } catch {
    // Ignore
  }

  // If preferredBlockType specified and doesn't match, still return (better than nothing)
  return pos;
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
