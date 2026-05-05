"use client";

/**
 * Render a web-bookmark card directly to a `<canvas>` and return a PNG
 * data URL.
 *
 * The PDF export pipeline (markdown-pdf-export.ts) needs a rasterised card
 * because the backend renderer (PyMuPDF Story) has no `border-radius` and
 * therefore can't draw the rounded editor card on its own. Earlier versions
 * tried html-to-image against the live editor `<a>`, then against a
 * synthetic DOM tree mounted off-screen — both paths kept silently failing
 * (cross-origin canvas taint, font availability, browser layout edge
 * cases). Direct 2D-canvas drawing has none of those failure modes:
 *
 *   - No DOM clone, no React reconciliation, no CSS-variable / Tailwind
 *     resolution. Fonts come from the system shorthand only.
 *   - Cross-origin OG / favicon images are pre-fetched as same-origin
 *     bytes via `/api/links/image`, decoded into `Image` objects, and
 *     drawn with `ctx.drawImage`. No tainted canvas.
 *   - When an image proxy fetch fails the card still renders without that
 *     image — strictly better than the table fallback the user sees today.
 */

import { apiUrl } from "@/lib/api/base";

export interface BookmarkCardMeta {
  title: string;
  description: string;
  url: string;
  faviconUrl: string;
  imageUrl: string;
}

export interface RenderedBookmarkCard {
  dataUrl: string;
  cssWidth: number;
  cssHeight: number;
}

const CARD_WIDTH = 700;
const CARD_HEIGHT = 120;
const CARD_RADIUS = 6;
const THUMB_W = 140;
const PIXEL_RATIO = 2;
const PADDING_X = 16;
const PADDING_Y = 14;
const FAVICON_SIZE = 16;
const FAVICON_GAP = 8;
const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * Fetch a remote image through the local sidecar's image proxy. Same-origin
 * response → no canvas taint. Returns null on any failure (network, 4xx,
 * non-image content type) so callers can degrade gracefully.
 */
async function fetchProxiedImage(src: string): Promise<HTMLImageElement | null> {
  if (!src) return null;
  let blobUrl: string | null = null;
  try {
    let objectSrc: string;
    if (src.startsWith("data:")) {
      objectSrc = src;
    } else {
      const proxied = apiUrl(`/api/links/image?url=${encodeURIComponent(src)}`);
      const resp = await fetch(proxied, { cache: "no-store" });
      if (!resp.ok) return null;
      const blob = await resp.blob();
      // Object URLs are fine for in-document <img>: same-origin, decode-able,
      // and we revoke right after the canvas has the pixels.
      blobUrl = URL.createObjectURL(blob);
      objectSrc = blobUrl;
    }
    const img = new Image();
    img.decoding = "async";
    // Even with same-origin object URLs some browsers still flag the
    // canvas; explicit `crossOrigin: anonymous` settles the question.
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image load failed"));
      img.src = objectSrc;
    });
    return img;
  } catch {
    return null;
  } finally {
    // Defer revoke so the just-decoded pixels remain readable for the
    // synchronous draw that follows (revoking before drawImage runs is a
    // race on some browsers).
    if (blobUrl) {
      setTimeout(() => URL.revokeObjectURL(blobUrl as string), 5_000);
    }
  }
}

/**
 * Truncate `text` with an ellipsis so its rendered width fits in `maxWidth`.
 * Canvas has no built-in ellipsis; binary-search-style trim is fine for the
 * one-line bookmark fields (title + url) since strings are short.
 */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (!text) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  // Trim from the end one char at a time. Worst case 200ish iterations for
  // a typical OG title; cheap.
  let trimmed = text;
  while (trimmed.length > 0) {
    trimmed = trimmed.slice(0, -1);
    if (ctx.measureText(trimmed + ellipsis).width <= maxWidth) {
      return trimmed + ellipsis;
    }
  }
  return ellipsis;
}

/**
 * Lay out `text` into up to `maxLines` lines that fit `maxWidth`. The last
 * line is ellipsised if the text overflows. Word-break greedy by spaces.
 */
function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  if (!text) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines) {
    // If there's leftover text past the cap, ellipsise the last line.
    const consumed = lines.join(" ").length;
    if (consumed < text.length) {
      lines[lines.length - 1] = ellipsize(ctx, lines[lines.length - 1] + "…", maxWidth);
    }
  }
  return lines;
}

/**
 * Paint the bookmark card to a canvas and return the PNG. Caller is
 * responsible for sizing the resulting `<img>` to the returned cssWidth/
 * cssHeight (NOT the canvas pixel dimensions, which are 2× for retina).
 */
export async function renderBookmarkCardPng(
  meta: BookmarkCardMeta
): Promise<RenderedBookmarkCard | null> {
  if (!meta.url.trim()) return null;
  if (typeof document === "undefined") return null;

  const [favicon, thumb] = await Promise.all([
    fetchProxiedImage(meta.faviconUrl),
    fetchProxiedImage(meta.imageUrl),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH * PIXEL_RATIO;
  canvas.height = CARD_HEIGHT * PIXEL_RATIO;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
  ctx.textBaseline = "alphabetic";
  // Higher-quality text rendering on retina displays.
  ctx.imageSmoothingQuality = "high";

  // Card background (rounded clip applied via path-fill).
  drawRoundedRect(ctx, 0, 0, CARD_WIDTH, CARD_HEIGHT, CARD_RADIUS);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  // Clip everything that follows so the thumbnail respects the rounded
  // corner and any text overflow is hidden.
  ctx.save();
  drawRoundedRect(ctx, 0, 0, CARD_WIDTH, CARD_HEIGHT, CARD_RADIUS);
  ctx.clip();

  // Right-anchored thumbnail (object-fit: cover). Drawn first so the text
  // column overlays it cleanly when descriptions get long.
  let textRightEdge = CARD_WIDTH - PADDING_X;
  if (thumb) {
    const dx = CARD_WIDTH - THUMB_W;
    drawCovered(ctx, thumb, dx, 0, THUMB_W, CARD_HEIGHT);
    textRightEdge = dx - PADDING_X;
  }

  // --- Text column ---
  const textLeft = PADDING_X;
  const textWidth = textRightEdge - textLeft;

  // Title (one line, ellipsised).
  ctx.fillStyle = "#0f172a";
  ctx.font = `600 14px ${FONT_FAMILY}`;
  const title = ellipsize(ctx, meta.title || meta.url, textWidth);
  let cursorY = PADDING_Y + 14; // baseline of first line
  ctx.fillText(title, textLeft, cursorY);
  cursorY += 6;

  // Description (up to 2 lines, ellipsised on overflow).
  if (meta.description) {
    ctx.fillStyle = "#6b7280";
    ctx.font = `400 12px ${FONT_FAMILY}`;
    const lines = wrapLines(ctx, meta.description, textWidth, 2);
    for (const line of lines) {
      cursorY += 14;
      ctx.fillText(line, textLeft, cursorY);
    }
  }

  // URL row (favicon + url) anchored to the bottom of the text column.
  const urlBaselineY = CARD_HEIGHT - PADDING_Y;
  let urlX = textLeft;
  if (favicon) {
    const favY = urlBaselineY - FAVICON_SIZE + 2;
    ctx.drawImage(favicon, urlX, favY, FAVICON_SIZE, FAVICON_SIZE);
    urlX += FAVICON_SIZE + FAVICON_GAP;
  }
  ctx.fillStyle = "#6b7280";
  ctx.font = `400 12px ${FONT_FAMILY}`;
  const urlText = ellipsize(ctx, meta.url, textRightEdge - urlX);
  ctx.fillText(urlText, urlX, urlBaselineY);

  ctx.restore();

  // Border last so it lays cleanly on top of the thumbnail edge. Inset by
  // half a pixel so a 1px stroke doesn't get clipped to 0.5px on retina.
  drawRoundedRect(ctx, 0.5, 0.5, CARD_WIDTH - 1, CARD_HEIGHT - 1, CARD_RADIUS);
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1;
  ctx.stroke();

  return {
    dataUrl: canvas.toDataURL("image/png"),
    cssWidth: CARD_WIDTH,
    cssHeight: CARD_HEIGHT,
  };
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  // CanvasRenderingContext2D.roundRect lands in 2023+ browsers (WKWebView
  // on macOS Sonoma and later); the manual fallback is identical and
  // covers older runtimes / test environments.
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** `object-fit: cover` for `ctx.drawImage` — crop to fill the destination. */
function drawCovered(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number
): void {
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  if (sw <= 0 || sh <= 0) return;
  const targetRatio = dw / dh;
  const sourceRatio = sw / sh;
  let cropW = sw;
  let cropH = sh;
  let cropX = 0;
  let cropY = 0;
  if (sourceRatio > targetRatio) {
    // Source is wider — crop horizontally.
    cropW = sh * targetRatio;
    cropX = (sw - cropW) / 2;
  } else {
    // Source is taller — crop vertically.
    cropH = sw / targetRatio;
    cropY = (sh - cropH) / 2;
  }
  ctx.drawImage(img, cropX, cropY, cropW, cropH, dx, dy, dw, dh);
}
