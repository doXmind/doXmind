/**
 * PyMuPDF-backed export client.
 *
 * Sends the original PDF bytes plus a JSON edit payload to
 * ``POST /api/pdf/export-edited`` and returns the new PDF bytes.
 * Returns ``null`` on any failure so callers can fall back to the legacy
 * pdf-lib export path without surfacing an error to the user.
 *
 * The edit payload schema is documented in
 * ``server/services/pdf_export.py``. The frontend only emits paragraph /
 * single-run / free-text / highlight rects in PDF user space (top-left).
 */

import { ApiClient } from "@/lib/api/client";

export interface ExportTextEditPayload {
  rect: [number, number, number, number];
  /**
   * Optional override for the redaction rect. When the user drags a paragraph
   * the visible content moves, but the original glyphs are still at the
   * parse-time location — that's where redaction has to happen.
   * Defaults to ``rect`` when omitted.
   */
  originalRect?: [number, number, number, number];
  text: string;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  deleted?: boolean;
  styleRanges?: Array<{
    start: number;
    end: number;
    color?: string;
    highlightColor?: string;
    bold?: boolean;
    italic?: boolean;
  }>;
}

export interface ExportHighlightPayload {
  rect: [number, number, number, number];
  color?: string;
  opacity?: number;
}

export interface ExportPagePayload {
  pageIndex: number;
  textEdits?: ExportTextEditPayload[];
  freeText?: ExportTextEditPayload[];
  highlights?: ExportHighlightPayload[];
}

export interface ExportEditsPayload {
  pages: ExportPagePayload[];
}

const apiClient = new ApiClient();

export async function exportEditedPdfViaBackend(
  pdfBytes: Uint8Array,
  edits: ExportEditsPayload,
  options: { signal?: AbortSignal } = {}
): Promise<Uint8Array | null> {
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
  formData.append("file", blob, "document.pdf");
  formData.append("edits", JSON.stringify(edits));

  try {
    const response = await fetch(`${apiClient.resolveBaseUrl()}/api/pdf/export-edited`, {
      method: "POST",
      body: formData,
      signal: options.signal,
    });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}
