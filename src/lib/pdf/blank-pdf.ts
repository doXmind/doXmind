/**
 * Generates a single-page blank PDF (US Letter, 612×792) entirely client-side
 * via pdf-lib. The bytes are then written verbatim to disk through the
 * `doc_create_pdf` Tauri/HTTP path — pdf-lib already lives in the bundle for
 * the legacy export fallback, so reusing it here is free.
 */

import { PDFDocument } from "pdf-lib";

export const BLANK_PDF_PAGE_WIDTH = 612;
export const BLANK_PDF_PAGE_HEIGHT = 792;

export async function createBlankPdfBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([BLANK_PDF_PAGE_WIDTH, BLANK_PDF_PAGE_HEIGHT]);
  return await doc.save();
}
