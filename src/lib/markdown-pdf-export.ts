"use client";

/** Local Markdown Page PDF export. No server participates in this pipeline. */

import { navigateToEditorFile } from "@/lib/editor-navigation";
import { hasDesktopBridge, invokeDesktop } from "@/lib/native-shell";
import { notify } from "@/lib/notifications";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useFileStore } from "@/stores/file-store";

export interface ExportMarkdownAsPdfArgs {
  fileName: string;
  /** Navigate to this Page before exporting, then restore the previous Page. */
  fileId: string;
}

export type ExportMarkdownAsPdfResult =
  | { ok: true; via: "local-pdf"; status: "saved"; path: string }
  | { ok: false; via: "local-pdf"; status: "cancelled"; error: "cancelled" }
  | { ok: false; via: "local-pdf"; status: "failed"; error: string };

type DesktopPdfExportResult = { status: "saved"; path: string } | { status: "cancelled" };

function baseName(name: string): string {
  return name.replace(/\.(md|markdown)$/i, "");
}

async function exportLocalPdf(
  suggestedName: string,
  targetFileId: string
): Promise<DesktopPdfExportResult> {
  if (!hasDesktopBridge()) {
    throw new Error("Local PDF export requires the Electron desktop app");
  }
  // The export prints the live DOM, and a folded Block has no row in it. Unfolding first is what
  // keeps a folded section — a reading convenience — from silently omitting itself from the PDF.
  useEditorRefStore.getState().requestFoldAll?.(false);
  await waitForAsyncPdfPreviews();
  await waitForPdfLayout();
  return invokeDesktop<DesktopPdfExportResult>("export_page_pdf", {
    suggestedName,
    targetFileId,
  });
}

async function waitForAsyncPdfPreviews(timeoutMs = 5000): Promise<void> {
  if (typeof document === "undefined") return;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (
      !document.querySelector(
        '[data-mermaid-print-ready="false"], [data-native-print-ready="false"]'
      )
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Page previews did not become ready for PDF export");
}

async function waitForPdfLayout(): Promise<void> {
  if (typeof document !== "undefined" && "fonts" in document) {
    await document.fonts.ready;
  }
  if (typeof requestAnimationFrame === "function") {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
  }
}

/** Wait until the requested native Markdown Page has mounted and settled. */
export async function waitForEditorReady(targetFileId: string, timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const fileState = useFileStore.getState();
    if (fileState.currentFileId === targetFileId && isNativePageMounted(targetFileId)) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }

  if (
    useFileStore.getState().currentFileId !== targetFileId ||
    !isNativePageMounted(targetFileId)
  ) {
    return false;
  }

  await waitForPdfLayout();
  // Mermaid and KaTeX load lazily after the Page DOM commits.
  await new Promise((resolve) => setTimeout(resolve, 700));
  return true;
}

function isNativePageMounted(targetFileId: string): boolean {
  if (typeof document === "undefined") return false;
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-native-markdown-document][data-file-id]")
  ).some((element) => element.dataset.fileId === targetFileId);
}

export async function exportMarkdownAsPdf(
  args: ExportMarkdownAsPdfArgs
): Promise<ExportMarkdownAsPdfResult> {
  const suggestedName = baseName(args.fileName);
  const progressId = notify.startProgress(`Exporting ${suggestedName}.pdf`, "Preparing Page…");

  let restoreNavigation: (() => Promise<void>) | null = null;
  if (args.fileId) {
    const fileStore = useFileStore.getState();
    const previousFileId = fileStore.currentFileId;
    if (previousFileId !== args.fileId) {
      notify.updateProgress(progressId, { detail: "Loading Page…" });
      try {
        await fileStore.loadFileContent(args.fileId, { force: true, throwOnError: true });
      } catch {
        const error = "Failed to load Page for PDF export";
        notify.failProgress(progressId, error);
        return { ok: false, via: "local-pdf", status: "failed", error };
      }
      const switched = await navigateToEditorFile(args.fileId);
      if (!switched) {
        const error = "Could not save the current Page before PDF export";
        notify.failProgress(progressId, error);
        return { ok: false, via: "local-pdf", status: "failed", error };
      }
      const restorePrevious = async () => {
        // Restore only if the export target is still active. A user may switch
        // Pages while the save dialog is open; that newer navigation
        // must win over this temporary export navigation.
        if (useFileStore.getState().currentFileId === args.fileId) {
          await navigateToEditorFile(previousFileId);
        }
      };
      restoreNavigation = restorePrevious;
    }

    const ready = await waitForEditorReady(args.fileId);
    if (!ready) {
      await restoreNavigation?.();
      restoreNavigation = null;
      const error = "Page did not become ready in time";
      notify.failProgress(progressId, error);
      return { ok: false, via: "local-pdf", status: "failed", error };
    }
  }

  try {
    notify.updateProgress(progressId, { detail: "Choosing destination…" });
    const result = await exportLocalPdf(suggestedName, args.fileId);
    if (result.status === "cancelled") {
      notify.removeProgress(progressId);
      return { ok: false, via: "local-pdf", status: "cancelled", error: "cancelled" };
    }
    notify.resolveProgress(progressId, `Saved ${suggestedName}.pdf`);
    return {
      ok: true,
      via: "local-pdf",
      status: "saved",
      path: result.path,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = message || "Could not export PDF";
    notify.failProgress(progressId, failure);
    return { ok: false, via: "local-pdf", status: "failed", error: failure };
  } finally {
    await restoreNavigation?.();
  }
}
