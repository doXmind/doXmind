/**
 * Resolve an editor image src into a URL the webview can actually load.
 *
 * The data model stores portable Markdown-style sources — relative paths like
 * `./assets/foo.png`, the sidecar HTTP path `/api/images/...`, or full external
 * URLs. The webview can load HTTP(S) and data: URLs directly, but local file
 * paths need to be converted via Tauri's asset protocol (`asset://` /
 * `convertFileSrc`).
 *
 * This helper takes the raw src plus the active document's location in the
 * workspace and returns a string suitable for `<img src=...>`. It is a no-op
 * when the src is already loadable, when no document context is available, or
 * when the asset protocol API is unavailable (browser dev mode).
 */

import { convertFileSrc } from "@tauri-apps/api/core";

const PASSTHROUGH = /^(?:https?:|data:|blob:|asset:|tauri:|file:)/i;

export function resolveImageSrc(
  src: string,
  rootPath: string | null | undefined,
  docRelPath: string | null | undefined
): string {
  if (!src) return src;
  if (PASSTHROUGH.test(src)) return src;
  if (src.startsWith("/api/")) return src; // local sidecar
  if (!rootPath) return src;

  const absolutePath = src.startsWith("/")
    ? src
    : joinPosix(rootPath, dirname(docRelPath ?? ""), stripLeadingDot(src));

  try {
    return convertFileSrc(absolutePath);
  } catch {
    return src;
  }
}

function stripLeadingDot(p: string): string {
  return p.startsWith("./") ? p.slice(2) : p;
}

function dirname(p: string): string {
  if (!p) return "";
  const idx = p.lastIndexOf("/");
  return idx >= 0 ? p.slice(0, idx) : "";
}

function joinPosix(...segments: string[]): string {
  return segments.filter(Boolean).join("/").replace(/\/+/g, "/");
}
