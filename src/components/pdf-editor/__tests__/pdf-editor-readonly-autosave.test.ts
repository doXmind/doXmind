/**
 * Regression test for the PDF autosave read-only surface.
 *
 * Why not a full-mount integration test like the Excel side?
 *
 * `PdfEditorWorkspace` boots through `pdfjs.getDocument(...).promise`,
 * `fetchPdfBlocks`, `sha256Hex`, paragraph normalisation, canvas rendering,
 * and a half-dozen other heavy paths before its autosave catch is even
 * reachable. Mocking that surface accurately enough to drive a real edit
 * through the debounced save effect would dwarf this test. The autosave
 * catch itself is a one-liner delegating to the shared helper:
 *
 *   if (!handleReadOnlyAutosaveError(error, readOnlySurfacedRef, notify.error)) {
 *     console.error("Auto-save failed", error);
 *   }
 *
 * So we verify the contract directly against that helper — the same
 * function the runtime catch invokes. The Excel integration test
 * (`excel-editor-workspace-load.test.tsx`) provides the end-to-end
 * coverage on the parallel code path, proving the helper behaves
 * correctly when wired into a real workspace catch.
 */

import { describe, expect, it, vi } from "vitest";
import {
  READ_ONLY_NOTICE_DESCRIPTION,
  READ_ONLY_NOTICE_TITLE,
  handleReadOnlyAutosaveError,
} from "@/lib/storage/read-only-error";

describe("PdfEditorWorkspace autosave read-only surface", () => {
  it("surfaces the read-only banner on the first rejection from writePdfEditorState", () => {
    const surfacedRef = { current: false };
    const notifyError = vi.fn();
    // Verbatim shape produced by `read_only_document_error()` in
    // src-tauri/src/lib.rs for the PDF write path
    // (`workspace_write_pdf_editor_state` returns it on the
    // DOXMIND_SIDECAR_MIGRATE=off legacy-sidecar branch).
    const err = new Error(
      "document at /tmp/Spec.pdf.doxmind is read-only (DOXMIND_SIDECAR_MIGRATE=0 against legacy sidecar)"
    );

    const handled = handleReadOnlyAutosaveError(err, surfacedRef, notifyError);

    expect(handled).toBe(true);
    expect(surfacedRef.current).toBe(true);
    expect(notifyError).toHaveBeenCalledTimes(1);
    expect(notifyError).toHaveBeenCalledWith(READ_ONLY_NOTICE_TITLE, {
      description: READ_ONLY_NOTICE_DESCRIPTION,
      persistent: true,
    });
  });

  it("does not re-surface on the second autosave attempt for the same file", () => {
    const surfacedRef = { current: false };
    const notifyError = vi.fn();
    const err = new Error(
      "document at /tmp/Spec.pdf.doxmind is read-only (DOXMIND_SIDECAR_MIGRATE=0 against legacy sidecar)"
    );

    // First autosave attempt — banner fires.
    handleReadOnlyAutosaveError(err, surfacedRef, notifyError);
    // Second + third — autosave keeps rejecting (the sidecar is still
    // read-only) but the user has already been told once.
    handleReadOnlyAutosaveError(err, surfacedRef, notifyError);
    handleReadOnlyAutosaveError(err, surfacedRef, notifyError);

    expect(notifyError).toHaveBeenCalledTimes(1);
  });

  it("re-arms after a file switch resets the ref", () => {
    // The load effect at the top of `PdfEditorWorkspace` resets
    // `readOnlySurfacedRef.current = false` for every file open so a
    // freshly-opened read-only file still gets its banner.
    const surfacedRef = { current: false };
    const notifyError = vi.fn();
    const err = new Error("read-only legacy sidecar");

    handleReadOnlyAutosaveError(err, surfacedRef, notifyError);
    expect(notifyError).toHaveBeenCalledTimes(1);

    // Simulate the load effect re-running on file switch.
    surfacedRef.current = false;
    handleReadOnlyAutosaveError(err, surfacedRef, notifyError);
    expect(notifyError).toHaveBeenCalledTimes(2);
  });

  it("returns false for unrelated autosave failures so the caller can fall through to console.error", () => {
    const surfacedRef = { current: false };
    const notifyError = vi.fn();

    const handled = handleReadOnlyAutosaveError(
      new Error("ENOSPC: no space left on device"),
      surfacedRef,
      notifyError
    );

    // PdfEditorWorkspace relies on this `false` return to keep its
    // existing `console.error("Auto-save failed", error)` path.
    expect(handled).toBe(false);
    expect(surfacedRef.current).toBe(false);
    expect(notifyError).not.toHaveBeenCalled();
  });
});
