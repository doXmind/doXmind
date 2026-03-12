/**
 * Diff Review Extension - Position Mapping Utilities
 *
 * Functions for finding text positions in ProseMirror documents.
 * Primary strategy: "Apply and Diff" — replicate the backend's markdown replace,
 * parse both full markdowns via @tiptap/markdown, diff textContent to find positions.
 */

import {
  DOMParser as ProseMirrorDOMParser,
  type Node as PMNode,
  type Schema,
} from "@tiptap/pm/model";
import { markdownToHtml } from "@/lib/markdown";
import { useEditorRefStore } from "@/stores/editor-ref-store";
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

  // Boundary fallback: if startOff falls exactly on a text node boundary,
  // use the start of the matching text node
  if (from === null && entries.length > 0) {
    for (const tp of entries) {
      if (tp.start === startOff) {
        from = tp.pos;
        blockStart = tp.blockPos;
        break;
      }
    }
  }

  // Similarly for endOff at the exact end of the last entry
  if (to === null && entries.length > 0) {
    const last = entries[entries.length - 1];
    if (endOff === last.end) {
      to = last.pos + (endOff - last.start);
    }
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
 * Parse a full markdown string to a ProseMirror Node via @tiptap/markdown.
 * Uses the editor's MarkdownManager which has all extensions registered,
 * producing documents with identical structure to the live editor.
 * This eliminates textContent mismatches caused by the old HTML roundtrip path.
 */
function parseMarkdownToDoc(markdown: string, schema: Schema): PMNode {
  const editor = useEditorRefStore.getState().editor;
  if (editor?.markdown) {
    const json = editor.markdown.parse(markdown);
    return schema.nodeFromJSON(json);
  }
  // Fallback: HTML path (used in tests where no editor is available)
  const html = markdownToHtml(markdown);
  const el = document.createElement("div");
  el.innerHTML = html;
  return ProseMirrorDOMParser.fromSchema(schema).parse(el);
}

/**
 * Cache for the reference document (parsed from originalMarkdown).
 * Stores both textContent and the parsed PMNode so structural diff
 * can reuse the same parsed doc without re-parsing.
 * Map-based to support multiple markdown variants (original + cumulative for sequential edits).
 */
interface ReferenceCache {
  textContent: string;
  doc: PMNode;
}
const referenceDocCache = new Map<string, ReferenceCache>();

function getOrBuildReference(markdown: string, schema: Schema): ReferenceCache {
  const cached = referenceDocCache.get(markdown);
  if (cached) return cached;
  const doc = parseMarkdownToDoc(markdown, schema);
  const entry: ReferenceCache = { textContent: doc.textContent, doc };
  referenceDocCache.set(markdown, entry);
  return entry;
}

/** Clear the reference document cache (call when diff session ends). */
export function clearMarkdownCache(): void {
  referenceDocCache.clear();
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
 * apply the deletion, parse both full markdowns via @tiptap/markdown,
 * and diff textContent to find the exact position range.
 *
 * Since both the editor and this function use @tiptap/markdown for parsing,
 * the reference textContent always matches the actual document, making
 * the fast path reliable without lossy HTML roundtrip fallbacks.
 */
export function findTextViaMarkdown(
  doc: PMNode,
  oldContent: string,
  markdown: string,
  excludePositions?: Set<number>,
  _preferredBlockType?: string | null,
  schema?: Schema,
  markdownOffset?: number
): TextPosition | null {
  if (!oldContent || !markdown || !schema) return null;

  const actualText = doc.textContent;

  // Step 1: Replicate backend logic — find old_str in the full markdown
  // When backend offset is provided, use it directly (with verification) to avoid
  // ambiguity with multiple similar blocks (e.g., consecutive mermaid charts).
  let searchFrom = 0;
  let useOffsetOnFirstIter = false;
  if (markdownOffset !== undefined && markdownOffset >= 0) {
    if (
      markdownOffset + oldContent.length <= markdown.length &&
      markdown.slice(markdownOffset, markdownOffset + oldContent.length) === oldContent
    ) {
      searchFrom = markdownOffset;
      useOffsetOnFirstIter = true;
    }
  }

  while (searchFrom < markdown.length) {
    let mdIdx: number;
    if (useOffsetOnFirstIter) {
      mdIdx = markdownOffset!;
      useOffsetOnFirstIter = false;
    } else {
      mdIdx = markdown.indexOf(oldContent, searchFrom);
    }
    if (mdIdx === -1) return null;

    // Step 2: Delete old_str from markdown (to find what textContent it produced)
    const newMarkdown = markdown.slice(0, mdIdx) + markdown.slice(mdIdx + oldContent.length);

    // Step 3: Parse both full markdowns through ProseMirror and get textContent
    const refCache = getOrBuildReference(markdown, schema);
    const refOldText = refCache.textContent;
    const newDoc = parseMarkdownToDoc(newMarkdown, schema);
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
      // No textContent difference: old_str produces no visible text
      // (e.g., mermaid charts, images, math blocks — atom nodes without leafText).
      // Fall back to structural node-level diff between the two parsed documents.
      const structuralPos = findStructuralDiff(refCache.doc, newDoc);
      if (structuralPos) {
        // Verify structural positions are usable in the actual editor document.
        // When reference textContent matches actual, the documents have the same
        // structure, so positions from refDoc map directly to the actual doc.
        if (refOldText === actualText && !excludePositions?.has(structuralPos.from)) {
          resolveBlockInfo(doc, structuralPos);
          return structuralPos;
        }
        // Even when textContent differs, try if the position is valid in actual doc
        if (
          structuralPos.from < doc.content.size &&
          structuralPos.to <= doc.content.size &&
          !excludePositions?.has(structuralPos.from)
        ) {
          resolveBlockInfo(doc, structuralPos);
          return structuralPos;
        }
      }
      searchFrom = mdIdx + 1;
      continue;
    }

    // Step 5: Map to ProseMirror positions in the actual document
    const entries = buildTextPositionMap(doc);

    // Fast path: direct offset mapping when reference text matches actual document
    if (refOldText === actualText) {
      const pos = mapOffsetsToPosition(start, oldEnd, entries);
      if (pos && !excludePositions?.has(pos.from)) {
        // Check if structural diff gives a wider range that encompasses atom nodes.
        // Only attempt when oldContent contains atom-producing markdown patterns
        // (math blocks, mermaid charts) that are invisible to textContent.
        // Without this guard, pure text changes would be widened to full-block ranges.
        const hasAtomPatterns = /\$\$[\s\S]*?\$\$|```mermaid/i.test(oldContent);
        if (hasAtomPatterns) {
          const structPos = findStructuralDiff(refCache.doc, newDoc);
          if (
            structPos &&
            structPos.from <= pos.from &&
            structPos.to >= pos.to &&
            (structPos.from < pos.from || structPos.to > pos.to) &&
            !excludePositions?.has(structPos.from)
          ) {
            resolveBlockInfo(doc, structPos);
            return structPos;
          }
        }
        resolveBlockInfo(doc, pos);
        return pos;
      }
      // Direct mapping failed (offset at node boundary) — try next occurrence
    }

    // Slow path: reference text differs from actual doc (user edited during streaming,
    // or previous hunks were accepted). Extract the text identified by the reference
    // diff and search for it directly in the actual document.
    if (refOldText !== actualText && start < oldEnd) {
      const removedText = refOldText.slice(start, oldEnd);
      if (removedText.length >= 3) {
        // Resolve block type from reference doc for disambiguation
        const refEntries = buildTextPositionMap(refCache.doc);
        const refPos = mapOffsetsToPosition(start, oldEnd, refEntries);
        let prefBlockType: string | null = null;
        if (refPos) {
          resolveBlockInfo(refCache.doc, refPos);
          prefBlockType = refPos.blockTypeName || null;
        }

        const textFound = findTextInDocument(doc, removedText, excludePositions, prefBlockType);
        if (textFound) {
          resolveBlockInfo(doc, textFound);
          return textFound;
        }
      }
    }

    searchFrom = mdIdx + 1;
  }

  return null;
}

/**
 * Find the position range of diverging nodes between two ProseMirror documents.
 * Used when textContent diff fails (e.g., mermaid charts, images produce no text).
 * Compares top-level (block) children from front and back to find the diverging range.
 */
function findStructuralDiff(oldDoc: PMNode, newDoc: PMNode): TextPosition | null {
  const oldCount = oldDoc.content.childCount;
  const newCount = newDoc.content.childCount;

  if (oldCount === newCount && oldCount === 0) return null;

  // Find first diverging node from front
  let frontMatch = 0;
  while (frontMatch < Math.min(oldCount, newCount)) {
    if (!oldDoc.content.child(frontMatch).eq(newDoc.content.child(frontMatch))) break;
    frontMatch++;
  }

  // Find first diverging node from back
  let backMatch = 0;
  while (backMatch < Math.min(oldCount - frontMatch, newCount - frontMatch)) {
    if (
      !oldDoc.content
        .child(oldCount - 1 - backMatch)
        .eq(newDoc.content.child(newCount - 1 - backMatch))
    )
      break;
    backMatch++;
  }

  // Calculate ProseMirror positions for the diverging range in oldDoc
  // Position 0 = start of doc content (ProseMirror descendants use 0-based positions)
  let from = 0;
  for (let i = 0; i < frontMatch; i++) {
    from += oldDoc.content.child(i).nodeSize;
  }

  let to = from;
  for (let i = frontMatch; i < oldCount - backMatch; i++) {
    to += oldDoc.content.child(i).nodeSize;
  }

  if (from >= to) return null;
  return { from, to, blockStart: from };
}

/**
 * Find an atom node in the document matching the fragment's first atom child.
 * Used for mermaid charts, math blocks, and other atom nodes that have no textContent.
 * Matches by node type name and content-bearing attribute (code/latex).
 */
export function findAtomNode(
  doc: PMNode,
  fragmentDoc: PMNode,
  excludePositions?: Set<number>
): TextPosition | null {
  // Extract the first atom node from the parsed fragment
  let targetType = "";
  let targetAttrs: Record<string, unknown> = {};
  fragmentDoc.descendants((node) => {
    if (node.isAtom && !targetType) {
      targetType = node.type.name;
      targetAttrs = node.attrs as Record<string, unknown>;
      return false;
    }
    return true;
  });
  if (!targetType) return null;

  let result: TextPosition | null = null;
  doc.descendants((node, pos) => {
    if (result) return false;
    if (
      node.type.name === targetType &&
      node.isAtom &&
      attrsMatch(node.attrs, targetAttrs, targetType) &&
      !excludePositions?.has(pos)
    ) {
      result = { from: pos, to: pos + node.nodeSize, blockStart: pos };
      return false;
    }
    return true;
  });

  return result;
}

/** Compare content-bearing attributes for atom nodes. */
function attrsMatch(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  typeName: string
): boolean {
  switch (typeName) {
    case "mermaidChart":
      return a.code === b.code;
    case "blockMath":
    case "inlineMath":
      return a.latex === b.latex;
    case "databaseBlock":
      return a.databaseId === b.databaseId;
    case "webBookmark":
      return a.url === b.url;
    case "pageLink":
      return a.pageId === b.pageId;
    default:
      return JSON.stringify(a) === JSON.stringify(b);
  }
}

/**
 * Fuzzy matching fallback (Tier 4).
 *
 * When exact matching fails, normalise whitespace (`\s+` → single space) in both
 * the search text and the document textContent, then attempt a substring match.
 * Positions are mapped back through the original (un-normalised) document text.
 */
export function findTextFuzzy(
  doc: PMNode,
  oldContent: string,
  excludePositions?: Set<number>
): TextPosition | null {
  const editor = useEditorRefStore.getState().editor;
  if (!editor?.markdown) return null;

  let searchText: string;
  try {
    const json = editor.markdown.parse(oldContent);
    const fragmentDoc = doc.type.schema.nodeFromJSON(json);
    searchText = fragmentDoc.textContent;
  } catch {
    return null;
  }

  if (!searchText || searchText.length < 5) return null;

  const normalizedSearch = searchText.replace(/\s+/g, " ").trim();
  if (!normalizedSearch) return null;

  const docText = doc.textContent;

  // Build mapping from normalised index → original textContent index.
  // Runs of whitespace in original text collapse to a single space in normalised.
  const normToOrig: number[] = [];
  for (let oi = 0; oi < docText.length; oi++) {
    if (/\s/.test(docText[oi])) {
      // Only the first char of a whitespace run maps to the normalised space
      if (oi === 0 || !/\s/.test(docText[oi - 1])) {
        normToOrig.push(oi);
      }
      // subsequent whitespace chars are skipped in normalised text
    } else {
      normToOrig.push(oi);
    }
  }

  const normalizedDoc = docText.replace(/\s+/g, " ");
  const nIdx = normalizedDoc.indexOf(normalizedSearch);
  if (nIdx === -1) return null;

  const origStart = normToOrig[nIdx] ?? 0;
  const lastNormIdx = nIdx + normalizedSearch.length - 1;
  const origEnd = (normToOrig[lastNormIdx] ?? origStart) + 1;

  const entries = buildTextPositionMap(doc);
  const pos = mapOffsetsToPosition(origStart, origEnd, entries);
  if (pos && !excludePositions?.has(pos.from)) {
    resolveBlockInfo(doc, pos);
    return pos;
  }

  return null;
}
