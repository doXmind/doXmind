"use client";

/**
 * Markdown → PDF export orchestrator.
 *
 * Two paths, in priority order:
 *
 *   1. Native (Tauri/macOS): `save_window_pdf` Rust command captures the
 *      current WebView using NSPrintOperation with the print-save-to-file
 *      disposition. No system print dialog is shown. NSPrintOperation
 *      honors `@media print`, so the comprehensive print stylesheet fully
 *      applies (light-mode forcing, chrome hidden, per-block rules).
 *
 *   2. Fallback (browser / unsupported platform): `window.print()`. The
 *      user picks "Save as PDF" in the system print dialog. Same Chromium
 *      engine, same fidelity, but with one extra dialog tap.
 *
 * Light-mode forcing is handled inside print.css via @media print rules
 * that override the .dark cascade and inline-style theme variables with
 * !important. We don't need to mutate `document.documentElement.classList`
 * here, which avoids a flash of light theme on screen during export.
 *
 * Document title is pre-set to the file name so the PDF defaults to
 * "<file>.pdf" instead of the app title.
 */

import { invoke } from "@tauri-apps/api/core";
import { pickNativeSaveLocation, isNativeDialogAvailable } from "@/lib/native-dialog";
import { renderMermaidSvgLight } from "@/lib/mermaid-renderer";
import { useFileStore } from "@/stores/file-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { navigateToEditorFile } from "@/lib/editor-navigation";

export interface ExportMarkdownAsPdfArgs {
  fileName: string;
  /**
   * If provided AND different from the currently active file, the
   * exporter navigates to that file first, waits for the editor to
   * mount + render, performs the export, then restores the user's
   * previous navigation. Used by the sidebar "Export as PDF" path
   * where the right-clicked file may not be the active document.
   */
  fileId?: string;
}

export interface ExportMarkdownAsPdfResult {
  ok: boolean;
  path?: string;
  via: "native" | "browser-print";
  error?: string;
}

const PDF_FILTER = [{ name: "PDF", extensions: ["pdf"] }];

function baseName(name: string): string {
  return name.replace(/\.(md|markdown)$/i, "");
}

/**
 * Mermaid bakes theme colors into the SVG at render time. CSS variable
 * overrides under @media print can't reach those fill/stroke attributes,
 * so a chart that was rendered in dark mode still prints dark even with
 * our light-mode forcing CSS. Re-render every mermaid chart with the
 * light theme just before triggering print, then restore on `afterprint`.
 *
 * Returns a restore function that swaps the original SVGs back. We cache
 * the original innerHTML rather than the source code so the editor lands
 * back in exactly the visual state it was in pre-export (avoids a flicker
 * where dark charts re-render after the user finishes saving).
 */
async function prepareMermaidForLightExport(): Promise<() => void> {
  if (typeof document === "undefined") return () => {};

  const containers = Array.from(
    document.querySelectorAll<HTMLElement>('[data-type="mermaid-chart"], .mermaid-chart-wrapper')
  );
  if (containers.length === 0) return () => {};

  // The actual SVG host inside a mermaid node view is a `.mermaid-rendered`
  // div. Some legacy markdown imports drop the SVG directly into the
  // `[data-type="mermaid-chart"]` container — handle both.
  const targets = containers
    .map((container) => {
      const host =
        container.querySelector<HTMLElement>(".mermaid-rendered") ||
        (container.matches(".mermaid-rendered") ? container : container);
      const code =
        container.getAttribute("data-code") ||
        container.querySelector<HTMLElement>("[data-code]")?.getAttribute("data-code") ||
        "";
      return { host, code };
    })
    .filter((entry) => entry.code.trim().length > 0);

  if (targets.length === 0) return () => {};

  const originals = new Map<HTMLElement, string>();

  await Promise.all(
    targets.map(async ({ host, code }) => {
      try {
        originals.set(host, host.innerHTML);
        const decoded = code
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"');
        const svg = await renderMermaidSvgLight(decoded);
        host.innerHTML = svg;
        const svgEl = host.querySelector("svg");
        if (svgEl) {
          svgEl.style.maxWidth = "100%";
          svgEl.style.height = "auto";
          svgEl.style.width = "auto";
          svgEl.style.margin = "0 auto";
        }
      } catch {
        // Leave the original SVG in place if light render fails.
      }
    })
  );

  return () => {
    originals.forEach((html, host) => {
      host.innerHTML = html;
    });
  };
}

async function tryNativeSavePdf(suggestedName: string): Promise<ExportMarkdownAsPdfResult | null> {
  if (!isNativeDialogAvailable()) return null;

  const target = await pickNativeSaveLocation("Export as PDF", `${suggestedName}.pdf`, PDF_FILTER);
  if (!target) {
    return { ok: false, via: "native", error: "cancelled" };
  }

  const restoreMermaid = await prepareMermaidForLightExport();

  try {
    await invoke<void>("save_window_pdf", { targetPath: target });
    return { ok: true, path: target, via: "native" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The Rust command returns an explicit "unsupported" error on
    // platforms where headless capture isn't wired up. Bubble that up
    // so the caller can fall back to window.print(). Any other error
    // (permission, disk full, etc.) is surfaced as-is.
    if (/unsupported/i.test(message)) {
      return null;
    }
    return { ok: false, via: "native", error: message };
  } finally {
    restoreMermaid();
  }
}

async function browserPrintAsPdf(suggestedName: string): Promise<ExportMarkdownAsPdfResult> {
  const restoreMermaid = await prepareMermaidForLightExport();

  return new Promise((resolve) => {
    const originalTitle = document.title;
    document.title = suggestedName;

    let resolved = false;
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      document.title = originalTitle;
      restoreMermaid();
      window.removeEventListener("afterprint", cleanup);
      mediaQuery?.removeEventListener?.("change", onMediaChange);
      resolve({ ok: true, via: "browser-print" });
    };

    // Some browsers fire `afterprint`, others only flip the `print` media
    // query. Listen for both so we always restore the title + SVGs.
    window.addEventListener("afterprint", cleanup, { once: true });
    const mediaQuery = typeof window.matchMedia === "function" ? window.matchMedia("print") : null;
    const onMediaChange = (e: MediaQueryListEvent) => {
      if (!e.matches) cleanup();
    };
    mediaQuery?.addEventListener?.("change", onMediaChange);

    // Safety timeout — if neither event fires within 60s, restore anyway.
    window.setTimeout(cleanup, 60_000);

    // Defer one frame so the title change + mermaid swap land before the
    // print snapshot.
    window.requestAnimationFrame(() => {
      window.print();
    });
  });
}

/**
 * Wait until the editor is mounted and showing the given file. Polls the
 * file-ref + editor-ref stores plus a settle delay for async block renders
 * (mermaid lib import + render is the slowest).
 */
async function waitForEditorReady(targetFileId: string, timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const fileState = useFileStore.getState();
    const editor = useEditorRefStore.getState().editor;
    if (fileState.currentFileId === targetFileId && editor && !editor.isDestroyed) {
      break;
    }
    await new Promise((r) => setTimeout(r, 40));
  }

  if (useFileStore.getState().currentFileId !== targetFileId) {
    return false;
  }

  // Two RAFs: let React commit the doc tree, then let the browser paint
  // (and lazy effects fire). Then a settle delay for async block renders
  // (mermaid pulls in the library on first use; large diagrams take a
  // few hundred ms to layout).
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
  await new Promise((r) => setTimeout(r, 700));
  return true;
}

export async function exportMarkdownAsPdf(
  args: ExportMarkdownAsPdfArgs
): Promise<ExportMarkdownAsPdfResult> {
  const suggestedName = baseName(args.fileName);

  // If a specific fileId was passed and it isn't the active document,
  // navigate to it first so window.print() / NSPrintOperation captures
  // the right doc. Restore the user's previous navigation afterwards
  // so right-clicking "Export as PDF" doesn't disturb their session.
  let restoreNavigation: (() => void) | null = null;
  if (args.fileId) {
    const fileStore = useFileStore.getState();
    const previousFileId = fileStore.currentFileId;
    if (previousFileId !== args.fileId) {
      try {
        await fileStore.loadFileContent(args.fileId, { force: true });
      } catch {
        return {
          ok: false,
          via: "native",
          error: `Failed to load file content for export`,
        };
      }
      navigateToEditorFile(args.fileId);
      const ready = await waitForEditorReady(args.fileId);
      if (!ready) {
        return {
          ok: false,
          via: "native",
          error: "Editor did not become ready in time",
        };
      }
      restoreNavigation = () => {
        if (previousFileId !== useFileStore.getState().currentFileId) {
          navigateToEditorFile(previousFileId);
        }
      };
    }
  }

  try {
    const native = await tryNativeSavePdf(suggestedName);
    if (native) return native;
    return await browserPrintAsPdf(suggestedName);
  } finally {
    restoreNavigation?.();
  }
}
