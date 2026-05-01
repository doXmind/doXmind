/**
 * PyMuPDF-backed paragraph-block client.
 *
 * Fetches layout-aware paragraph blocks from the FastAPI sidecar
 * (`POST /api/pdf/parse-blocks`). Falls back gracefully — callers should
 * treat a `null` return as "backend unavailable, stay in single-run mode."
 *
 * The block tree mirrors the schema documented in
 * `server/services/pdf_blocks.py`.
 */

import { ApiClient } from "@/lib/api/client";

export interface PdfBlocksSpan {
  text: string;
  bbox: [number, number, number, number];
  font: string;
  size: number;
  color: string;
  flags: number;
  bold: boolean;
  italic: boolean;
}

export interface PdfBlocksLine {
  bbox: [number, number, number, number];
  spans: PdfBlocksSpan[];
}

export interface PdfBlock {
  id: string;
  bbox: [number, number, number, number];
  lines: PdfBlocksLine[];
}

export interface PdfBlocksPage {
  pageIndex: number;
  width: number;
  height: number;
  blocks: PdfBlock[];
}

export interface PdfBlocksResponse {
  version: 2;
  pageCount: number;
  pages: PdfBlocksPage[];
}

/**
 * Frontend-side paragraph view derived from a backend block. Same shape as
 * the storage type but with `bbox` precomputed from the backend's bbox tuple.
 */
export interface PdfParagraph {
  id: string;
  pageIndex: number;
  bbox: { x: number; y: number; width: number; height: number };
  /**
   * Parse-time bbox from PyMuPDF — never mutated by user edits / drag.
   * Used as the redaction rect on export so original glyphs are erased
   * at their real location regardless of where the paragraph is moved.
   */
  originalBbox: { x: number; y: number; width: number; height: number };
  text: string;
  originalText: string;
  fontSize: number;
  fontFamily?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  textAlign?: "left" | "center" | "right";
  styleRanges?: import("@/lib/storage/types").PdfTextStyleRange[];
  deleted?: boolean;
  /** Preserved span/line geometry from PyMuPDF — needed for accurate export. */
  originalLines: PdfBlocksLine[];
}

const apiClient = new ApiClient();

/**
 * Fetch paragraph blocks for the entire PDF (or a subset of pages).
 *
 * Returns `null` if the backend is unreachable so callers can fall back to
 * the legacy single-run pipeline without surfacing an error.
 */
export async function fetchPdfBlocks(
  pdfBytes: Uint8Array,
  options: { pageIndexes?: number[]; signal?: AbortSignal } = {}
): Promise<PdfBlocksResponse | null> {
  const formData = new FormData();
  // Wrap in a Blob with the right MIME so FastAPI's UploadFile sees PDF.
  const blob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
  formData.append("file", blob, "document.pdf");
  if (options.pageIndexes?.length) {
    formData.append("pageIndexes", options.pageIndexes.join(","));
  }

  try {
    const response = await fetch(`${apiClient.resolveBaseUrl()}/api/pdf/parse-blocks`, {
      method: "POST",
      body: formData,
      signal: options.signal,
    });
    if (!response.ok) return null;
    const json = (await response.json()) as PdfBlocksResponse;
    if (json?.version !== 2 || !Array.isArray(json.pages)) return null;
    return json;
  } catch {
    return null;
  }
}

/**
 * Convert a single backend `PdfBlock` into the frontend paragraph view.
 *
 * Rules:
 * - Lines within a block are joined with " " (PyMuPDF emits soft-wrapped
 *   lines as separate entries; paragraph breaks are separate blocks).
 * - Span styles are flattened into character-offset `styleRanges` so the
 *   existing TipTap-style range pipeline can edit them.
 * - The dominant font / size / color come from the longest span.
 */
export function paragraphFromBlock(block: PdfBlock, pageIndex: number): PdfParagraph {
  const [x0, y0, x1, y1] = block.bbox;
  const bbox = {
    x: x0,
    y: y0,
    width: Math.max(1, x1 - x0),
    height: Math.max(1, y1 - y0),
  };

  // Flatten lines → text + style ranges.
  const parts: string[] = [];
  const ranges: import("@/lib/storage/types").PdfTextStyleRange[] = [];
  let cursor = 0;
  block.lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      parts.push(" ");
      cursor += 1;
    }
    for (const span of line.spans) {
      const start = cursor;
      parts.push(span.text);
      cursor += span.text.length;
      const end = cursor;
      if (end <= start) continue;
      ranges.push({
        start,
        end,
        color: span.color,
        bold: span.bold || undefined,
        italic: span.italic || undefined,
      });
    }
  });

  // Dominant style: pick the span with the most characters.
  const allSpans = block.lines.flatMap((l) => l.spans);
  const dominant = allSpans.reduce<PdfBlocksSpan | null>(
    (acc, span) => (!acc || span.text.length > acc.text.length ? span : acc),
    null
  );

  const text = parts.join("");
  return {
    id: block.id,
    pageIndex,
    bbox,
    originalBbox: { ...bbox },
    text,
    originalText: text,
    fontSize: dominant?.size ?? 12,
    fontFamily: dominant?.font || undefined,
    color: dominant?.color,
    bold: dominant?.bold || undefined,
    italic: dominant?.italic || undefined,
    styleRanges: ranges.length ? ranges : undefined,
    originalLines: block.lines,
  };
}

/**
 * Build the per-page paragraph list from a backend response.
 */
export function paragraphsFromResponse(response: PdfBlocksResponse): PdfParagraph[] {
  return response.pages.flatMap((page) =>
    page.blocks.map((block) => paragraphFromBlock(block, page.pageIndex))
  );
}

// ---------------------------------------------------------------------------
// v1 → v2 migration
// ---------------------------------------------------------------------------

interface LegacyTextEdit {
  pageIndex: number;
  text: string;
  originalText: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  originalFontSize?: number;
  fontName?: string;
  fontFamily?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  styleRanges?: import("@/lib/storage/types").PdfTextStyleRange[];
}

/**
 * Map legacy single-run edits (keyed by `p${page}-t${index}`) onto the new
 * paragraph model.
 *
 * Strategy: spatial containment + substring match. For each legacy edit:
 *   1. Find paragraphs on the same page whose bbox overlaps the legacy bbox.
 *   2. Among those, find one whose `originalText` contains the legacy
 *      `originalText` as a substring.
 *   3. Splice the user's new text into that paragraph at the matched offset.
 *
 * Edits that don't match (e.g. crossing block boundaries) are returned as
 * `unmatched` so the caller can keep them as v1 fallback or warn the user.
 */
export function migrateLegacyTextEdits(
  legacy: Record<string, LegacyTextEdit>,
  paragraphs: PdfParagraph[]
): {
  paragraphs: PdfParagraph[];
  unmatched: Array<{ id: string; edit: LegacyTextEdit }>;
} {
  const paragraphsByPage = new Map<number, PdfParagraph[]>();
  for (const p of paragraphs) {
    if (!paragraphsByPage.has(p.pageIndex)) paragraphsByPage.set(p.pageIndex, []);
    paragraphsByPage.get(p.pageIndex)!.push(p);
  }

  // Working copy keyed by id so we can mutate idempotently.
  const byId = new Map<string, PdfParagraph>(paragraphs.map((p) => [p.id, { ...p }]));
  const unmatched: Array<{ id: string; edit: LegacyTextEdit }> = [];

  for (const [legacyId, edit] of Object.entries(legacy)) {
    if (edit.text === edit.originalText) continue; // not actually changed

    const candidates = paragraphsByPage.get(edit.pageIndex) ?? [];
    let target: PdfParagraph | undefined;
    let matchOffset = -1;

    for (const para of candidates) {
      if (!rectsOverlap(para.bbox, edit)) continue;
      const offset = para.originalText.indexOf(edit.originalText);
      if (offset >= 0) {
        target = para;
        matchOffset = offset;
        break;
      }
    }

    if (!target || matchOffset < 0) {
      unmatched.push({ id: legacyId, edit });
      continue;
    }

    const before = target.text.slice(0, matchOffset);
    const after = target.text.slice(matchOffset + edit.originalText.length);
    const merged = byId.get(target.id)!;
    merged.text = `${before}${edit.text}${after}`;
    if (edit.styleRanges?.length) {
      const offsetRanges = edit.styleRanges.map((r) => ({
        ...r,
        start: r.start + matchOffset,
        end: r.end + matchOffset,
      }));
      merged.styleRanges = [...(merged.styleRanges ?? []), ...offsetRanges];
    }
    if (edit.bold !== undefined) merged.bold = edit.bold;
    if (edit.italic !== undefined) merged.italic = edit.italic;
    if (edit.color) merged.color = edit.color;
    if (edit.fontSize && Math.abs(edit.fontSize - merged.fontSize) > 0.5) {
      merged.fontSize = edit.fontSize;
    }
    byId.set(target.id, merged);
  }

  return {
    paragraphs: Array.from(byId.values()),
    unmatched,
  };
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
