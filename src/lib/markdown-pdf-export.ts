"use client";

/**
 * Markdown → PDF export orchestrator.
 *
 * Export path:
 *
 *   Native desktop save: pick a target path, send the rendered editor HTML to
 *   the local FastAPI sidecar, let Python/PyMuPDF generate the PDF bytes, then
 *   ask Tauri to write those bytes to disk. This avoids WebView print
 *   permissions, macOS print dialogs, and screenshot-style blank PDFs.
 */

import { invoke } from "@tauri-apps/api/core";
import { toPng } from "html-to-image";
import { pickNativeSaveLocation, isNativeDialogAvailable } from "@/lib/native-dialog";
import { apiUrl } from "@/lib/api/base";
import { renderBookmarkCardPng } from "@/lib/bookmark-card-renderer";
import { prepareHtmlForPdf } from "@/lib/pdf-export-html";
import { renderMermaidSvgLight } from "@/lib/mermaid-renderer";
import { useFileStore } from "@/stores/file-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { navigateToEditorFile } from "@/lib/editor-navigation";
import { notify } from "@/lib/notifications";

type ProgressReporter = (detail: string) => void;
const NOOP_REPORTER: ProgressReporter = () => {};

/**
 * Stash a rasterised PNG data URL on a node so the export pipeline can pick
 * it up after the live DOM has been serialised into a string.
 *
 * The PDF backend (PyMuPDF Story) cannot run JavaScript or render foreign
 * content inside SVG, so KaTeX trees and mermaid diagrams need to be turned
 * into bitmaps in the browser before the export request goes out. Doing the
 * rasterisation against the live (rendered) elements avoids the namespace /
 * font-loading pitfalls that broke earlier attempts at serialising the SVG
 * and asking the canvas to render the string.
 */
const PDF_PNG_ATTR = "data-pdf-png";
const PDF_PNG_WIDTH_ATTR = "data-pdf-png-w";
const PDF_PNG_HEIGHT_ATTR = "data-pdf-png-h";

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
  via: "native";
  error?: string;
}

const PDF_FILTER = [{ name: "PDF", extensions: ["pdf"] }];

function baseName(name: string): string {
  return name.replace(/\.(md|markdown)$/i, "");
}

/**
 * Mermaid bakes theme colors into the SVG at render time. Re-render every
 * mermaid chart with the light theme before reading DOM HTML, then restore the
 * original nodes once the backend has received the payload.
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

/**
 * Rasterise mermaid diagrams and KaTeX-rendered math into PNG data URLs
 * stashed on each block's outer wrapper. Runs against the LIVE DOM so
 * html-to-image can read computed styles, embed fonts, and capture
 * foreignObject content (mermaid uses HTML labels, KaTeX uses HTML+CSS).
 *
 * The data URLs are written into a `data-pdf-png` attribute that survives
 * the `editor.innerHTML` round-trip — `prepareHtmlForPdf` later replaces
 * the matching wrappers with `<img src="data:…">` tags.
 *
 * Returns a cleanup that strips the stashed attributes back off the live DOM
 * so the editor lands in exactly the visual state it was in pre-export.
 */
async function rasterizeBlocksForExport(
  reportStep: ProgressReporter = NOOP_REPORTER
): Promise<() => void> {
  if (typeof document === "undefined") return () => {};

  const cleanupTargets: HTMLElement[] = [];
  const stash = (
    wrapper: HTMLElement,
    dataUrl: string,
    cssDims?: { width: number; height: number }
  ) => {
    wrapper.setAttribute(PDF_PNG_ATTR, dataUrl);
    if (cssDims && cssDims.width > 0 && cssDims.height > 0) {
      wrapper.setAttribute(PDF_PNG_WIDTH_ATTR, String(Math.round(cssDims.width)));
      wrapper.setAttribute(PDF_PNG_HEIGHT_ATTR, String(Math.round(cssDims.height)));
    }
    cleanupTargets.push(wrapper);
  };

  const baseOptions = {
    backgroundColor: "#ffffff",
    pixelRatio: 2,
    cacheBust: true,
    skipAutoScale: true,
  } as const;

  // Shared CSS-px → pt scale factor (see math block for full reasoning).
  // Used for both mermaid and math so block sizes track PDF body 11pt rather
  // than the editor's 16px body. Hoisted here so the mermaid loop below can
  // reuse it.
  const editorEl = document.querySelector<HTMLElement>(".ProseMirror");
  const editorBodyPx = parseFloat(getComputedStyle(editorEl ?? document.body).fontSize) || 16;
  const PDF_BODY_PT = 11;
  const ptPerCssPx = PDF_BODY_PT / editorBodyPx;

  // Mermaid: capture `.mermaid-rendered` and strip its editor chrome
  // (`rounded-lg border border-border/40 bg-card p-4`) at capture time by
  // mutating live styles, then restore.
  //
  // We can't capture the inner `.mermaid-rendered-svg-host` directly:
  // `prepareMermaidForLightExport` does `host.innerHTML = svg` to swap in
  // a light-themed SVG, which destroys the React subtree (svg-host
  // included). Diagrams where the light-render succeeds lose the svg-host;
  // diagrams where it fails keep it. Different capture targets across
  // diagrams in the same export was producing a tiny / blank second
  // diagram in real exports.
  //
  // Mutating live `.mermaid-rendered` is stable (it always exists) and
  // gives us:
  //   - No chrome in the PNG (the 1px right border was being antialiased
  //     away after Story's downscale, hence "right border missing").
  //   - Bounding rect that reflects the SVG content alone (no padding
  //     inflating the captured size).
  // We also bump pixelRatio (3 vs 2) so labels survive the antialiasing
  // pass, and stash explicit pt dims so Story doesn't have to downscale —
  // downscaling washes thin SVG strokes, same root cause that turned the
  // inline math grey before we sized it explicitly.
  const mermaidWrappers = Array.from(
    document.querySelectorAll<HTMLElement>(".mermaid-chart-wrapper")
  );
  if (mermaidWrappers.length > 0) {
    reportStep(
      mermaidWrappers.length === 1
        ? "Capturing diagram…"
        : `Capturing diagrams (${mermaidWrappers.length})…`
    );
  }
  const MERMAID_PIXEL_RATIO = 3;
  await Promise.all(
    mermaidWrappers.map(async (wrapper) => {
      const target = wrapper.querySelector<HTMLElement>(".mermaid-rendered");
      if (!target) return;
      const targetStyle = target.style;
      const originalBorder = targetStyle.border;
      const originalBackground = targetStyle.background;
      const originalPadding = targetStyle.padding;
      const originalBoxShadow = targetStyle.boxShadow;
      // Strip everything that looks like editor chrome. `padding: 0` matters
      // most — without it, the captured rect includes 16px of empty space
      // around the SVG and the resulting PDF figure has odd whitespace.
      targetStyle.border = "none";
      targetStyle.background = "transparent";
      targetStyle.padding = "0";
      targetStyle.boxShadow = "none";
      try {
        // Force layout recompute so getBoundingClientRect reflects the
        // chrome-free shape we're about to capture.
        void target.getBoundingClientRect();
        const png = await toPng(target, {
          ...baseOptions,
          pixelRatio: MERMAID_PIXEL_RATIO,
        });
        if (png) {
          const rect = target.getBoundingClientRect();
          stash(wrapper, png, {
            width: rect.width * ptPerCssPx,
            height: rect.height * ptPerCssPx,
          });
        }
      } catch (err) {
        console.warn("[pdf export] mermaid rasterise failed", err);
      } finally {
        targetStyle.border = originalBorder;
        targetStyle.background = originalBackground;
        targetStyle.padding = originalPadding;
        targetStyle.boxShadow = originalBoxShadow;
      }
    })
  );

  // Math: capture the `.math-rendered` host. The wrapper we stash on is the
  // outermost block/inline math wrapper so the HTML transformer can swap the
  // entire node out in one go.
  //
  // Inline vs block split:
  //   - BLOCK math gets rasterised. It owns its own line, so PyMuPDF Story's
  //     opinionated line-box layout for inline images can't break alignment,
  //     and equations like ∫/∑/matrices need real typesetting fidelity that
  //     the LaTeX-source fallback can't deliver.
  //   - INLINE math intentionally falls through to the LaTeX-source fallback
  //     in `transformMathBlocks`. We tried multiple capture strategies for
  //     inline KaTeX (raw rasterise, top-padding compensation, baseline
  //     marker + height crop, padding-top + margin-top to recover overflow,
  //     per-image vertical-align) and every variant lost glyphs (operators,
  //     `²` superscripts) and/or floated above the body baseline in the
  //     final PDF. The root cause is that html-to-image's foreignObject
  //     pipeline doesn't reliably reproduce KaTeX's `position: relative;
  //     top: -<n>em` superscript layout, and PyMuPDF Story doesn't honour
  //     enough vertical-align to compensate after the fact. Showing the
  //     LaTeX source is unambiguously more useful than half-rendered math.
  const mathHosts = Array.from(document.querySelectorAll<HTMLElement>(".math-rendered")).filter(
    (host) => !host.closest(".inline-math-wrapper")
  );
  if (mathHosts.length > 0) {
    reportStep(
      mathHosts.length === 1 ? "Capturing equation…" : `Capturing equations (${mathHosts.length})…`
    );
  }
  // `ptPerCssPx` is computed up by the mermaid loop and shared with this
  // section. PyMuPDF Story is two-faced about image dimensions:
  //   - Natural PNG pixel dimensions are converted to pt at 96 DPI (1px = 0.75pt).
  //   - <img width=N height=N> HTML attributes are interpreted as POINTS (1 unit
  //     = 1pt; verified empirically — `width="50"` renders at 50pt, not 37.5pt).
  // Scaling CSS-px → pt by PDF_BODY_PT / editorBodyPx (≈ 11/16 = 0.6875)
  // keeps captured math/diagrams proportional to PDF body 11pt instead of the
  // editor's 16px body.

  await Promise.all(
    mathHosts.map(async (host) => {
      const wrapper =
        host.closest<HTMLElement>(".block-math-wrapper") ||
        host.closest<HTMLElement>(".math-node-wrapper") ||
        host;
      // Mutate the LIVE host before capture so html-to-image's computed-style
      // cloning sees max-contrast strokes. Setting `style: { color }` in the
      // toPng options only applies to the cloned root; descendants would each
      // get their own inherited `color: rgb(55,53,47)` inlined and the root
      // override wouldn't propagate. Mutating the live element pushes the new
      // color through computed-style inheritance to every descendant.
      const hostStyle = host.style as CSSStyleDeclaration & {
        webkitFontSmoothing?: string;
      };
      const originalColor = hostStyle.color;
      const originalSmoothing = hostStyle.webkitFontSmoothing ?? "";
      hostStyle.color = "#000000";
      // `subpixel-antialiased` produces visibly darker strokes than the body
      // default (`antialiased`), which compounds with the colour fix to keep
      // KaTeX from looking washed out next to PyMuPDF-rendered body text.
      hostStyle.webkitFontSmoothing = "subpixel-antialiased";
      try {
        const png = await toPng(host, baseOptions);
        if (png) {
          const rect = host.getBoundingClientRect();
          stash(wrapper, png, {
            width: rect.width * ptPerCssPx,
            height: rect.height * ptPerCssPx,
          });
        }
      } catch (err) {
        console.warn("[pdf export] math rasterise failed", err);
      } finally {
        hostStyle.color = originalColor;
        hostStyle.webkitFontSmoothing = originalSmoothing;
      }
    })
  );

  // Web bookmark cards: paint each card directly to a `<canvas>` via the
  // 2D drawing API — no DOM clone, no html-to-image, no Tailwind/CSS-var
  // dependency. PyMuPDF Story has no `border-radius`, so we have to ship
  // the rounded shape as a baked-in PNG; canvas is the lowest-friction way
  // to produce one deterministically, with no risk of canvas-taint from
  // the live editor's cross-origin OG image.
  //
  // Image fetching still goes through `/api/links/image` so the favicon
  // and OG thumbnail arrive same-origin as bytes the canvas can decode
  // without `crossOrigin` ceremony. When the proxy fails for an image we
  // just skip it and lay out the rest of the card; rounded text-only is
  // still strictly better than the sharp-cornered table fallback.
  const bookmarkWrappers = Array.from(
    document.querySelectorAll<HTMLElement>('[data-type="web-bookmark"]')
  ).filter((w) => (w.getAttribute("data-url") || "").trim().length > 0);
  if (bookmarkWrappers.length > 0) {
    reportStep(
      bookmarkWrappers.length === 1
        ? "Capturing bookmark…"
        : `Capturing bookmarks (${bookmarkWrappers.length})…`
    );
  }
  await Promise.all(
    bookmarkWrappers.map(async (wrapper) => {
      try {
        const png = await renderBookmarkCardPng({
          title: (wrapper.getAttribute("data-title") || "").trim(),
          description: (wrapper.getAttribute("data-description") || "").trim(),
          url: (wrapper.getAttribute("data-url") || "").trim(),
          faviconUrl: wrapper.getAttribute("data-favicon-url") || "",
          imageUrl: wrapper.getAttribute("data-image-url") || "",
        });
        if (png) {
          stash(wrapper, png.dataUrl, {
            width: png.cssWidth * ptPerCssPx,
            height: png.cssHeight * ptPerCssPx,
          });
        }
      } catch (err) {
        console.warn("[pdf export] bookmark rasterise failed", err);
      }
    })
  );

  return () => {
    cleanupTargets.forEach((node) => {
      node.removeAttribute(PDF_PNG_ATTR);
      node.removeAttribute(PDF_PNG_WIDTH_ATTR);
      node.removeAttribute(PDF_PNG_HEIGHT_ATTR);
    });
  };
}

async function readEditorHtmlForPdf(): Promise<string> {
  const editor = document.querySelector<HTMLElement>(".ProseMirror");
  const domHtml = editor?.innerHTML?.trim();
  if (domHtml) {
    return prepareHtmlForPdf(`<article class="ProseMirror">${domHtml}</article>`);
  }

  const tiptapHtml = useEditorRefStore.getState().editor?.getHTML()?.trim();
  if (tiptapHtml) {
    return prepareHtmlForPdf(`<article class="ProseMirror">${tiptapHtml}</article>`);
  }

  return "";
}

async function createPdfBytes(
  suggestedName: string,
  reportStep: ProgressReporter = NOOP_REPORTER
): Promise<Uint8Array> {
  reportStep("Inlining images…");
  const html = await readEditorHtmlForPdf();
  reportStep("Generating PDF…");
  const response = await fetch(apiUrl("/api/export/html-pdf"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: suggestedName,
      html,
    }),
  });

  if (!response.ok) {
    let message = `PDF export failed (${response.status})`;
    try {
      const body = await response.json();
      message = body?.error?.message || body?.detail || message;
    } catch {
      // Keep the status-based message if the response body is not JSON.
    }
    throw new Error(message);
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (!bytes.length || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44) {
    throw new Error("Backend returned an invalid PDF payload");
  }
  return bytes;
}

async function nativeSavePdf(
  suggestedName: string,
  reportStep: ProgressReporter
): Promise<ExportMarkdownAsPdfResult> {
  if (!isNativeDialogAvailable()) {
    return { ok: false, via: "native", error: "PDF export requires the desktop app." };
  }

  const target = await pickNativeSaveLocation("Export as PDF", `${suggestedName}.pdf`, PDF_FILTER);
  if (!target) {
    return { ok: false, via: "native", error: "cancelled" };
  }

  reportStep("Preparing diagrams…");
  const restoreMermaid = await prepareMermaidForLightExport();
  // Two RAFs let mermaid's freshly rerendered SVGs commit + paint before
  // html-to-image walks computed styles; without this the rasteriser sees
  // the stale dark-theme tree and produces a chart against the wrong palette.
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
  const restoreRasters = await rasterizeBlocksForExport(reportStep);

  try {
    const bytes = await createPdfBytes(suggestedName, reportStep);
    reportStep("Saving file…");
    await invoke<void>("save_window_pdf", {
      targetPath: target,
      bytes: Array.from(bytes),
    });
    return { ok: true, path: target, via: "native" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, via: "native", error: message };
  } finally {
    restoreRasters();
    restoreMermaid();
  }
}

function describeSavedPath(targetPath: string): string {
  // Show a friendly tail (basename + parent) instead of the full absolute
  // path; the absolute path is rarely useful and tends to overflow the toast.
  const normalised = targetPath.replace(/\\/g, "/");
  const parts = normalised.split("/").filter(Boolean);
  if (parts.length <= 2) return normalised;
  return `…/${parts.slice(-2).join("/")}`;
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
  const toastLabel = `Exporting ${suggestedName}.pdf`;

  // The progress toast is the only signal the user has during a 5–10 s
  // export. Drive it from the orchestrator so both call sites (sidebar
  // context menu, header dropdown) get identical UX without each having
  // to wire start/update/resolve/fail themselves.
  const progressId = notify.startProgress(toastLabel, "Preparing…");
  const reportStep: ProgressReporter = (detail) => {
    notify.updateProgress(progressId, { detail });
  };

  let restoreNavigation: (() => void) | null = null;
  if (args.fileId) {
    const fileStore = useFileStore.getState();
    const previousFileId = fileStore.currentFileId;
    if (previousFileId !== args.fileId) {
      reportStep("Loading document…");
      try {
        await fileStore.loadFileContent(args.fileId, { force: true });
      } catch {
        notify.failProgress(progressId, "Failed to load document");
        return {
          ok: false,
          via: "native",
          error: `Failed to load file content for export`,
        };
      }
      navigateToEditorFile(args.fileId);
      const ready = await waitForEditorReady(args.fileId);
      if (!ready) {
        notify.failProgress(progressId, "Editor did not become ready in time");
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
    const result = await nativeSavePdf(suggestedName, reportStep);
    if (result.ok && result.path) {
      notify.resolveProgress(progressId, `Saved to ${describeSavedPath(result.path)}`);
    } else if (result.error === "cancelled") {
      // User dismissed the save dialog — drop the toast silently rather
      // than flashing a "failed" state for an intentional action.
      notify.removeProgress(progressId);
    } else {
      notify.failProgress(progressId, result.error || "Export failed");
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    notify.failProgress(progressId, message || "Export failed");
    throw err;
  } finally {
    restoreNavigation?.();
  }
}
