/**
 * Sanitize document-derived markup before it reaches the DOM.
 *
 * Documents are untrusted input. A `.md` file can be downloaded, cloned, or
 * shared, and doXmind renders the raw-HTML blocks inside it so the user sees
 * the real layout (centered badge rows, `<details>` toggles, …). Assigning
 * that markup straight to `innerHTML` does not run `<script>` tags — but it
 * *does* fire event-handler attributes such as `<img src=x onerror=…>` the
 * moment the node is inserted. Opening a file was therefore enough to run
 * arbitrary script inside the app, which can reach the localhost sidecar API
 * (workspace enumeration, document search previews) and, in the Electron
 * shell, the preload's `invoke` bridge.
 *
 * Sanitizing strips script-bearing constructs while keeping the presentational
 * markup these blocks exist for.
 *
 * IMPORTANT: sanitize only what is *rendered*. The stored attribute keeps the
 * original bytes so block-level source preservation still re-emits untouched
 * blocks byte-identically (ADR-0009 / issue #149).
 */

import DOMPurify from "dompurify";

/**
 * Schemes allowed on href/src. Blocks javascript:, vbscript:, and file:.
 *
 * `data:image/svg+xml` is deliberately NOT allowed: an inline SVG can carry its
 * own script, so permitting it would reopen the hole through the image path.
 */
const SAFE_URI =
  /^(?:(?:https?|mailto|tel|doxmind-asset):|data:image\/(?:png|jpe?g|gif|webp)[;,])/i;

let configured = false;

function ensureConfigured(): void {
  if (configured || typeof window === "undefined") return;
  // Relative links (./notes/spec.md) carry no scheme and are safe — the
  // scheme allowlist only applies once an explicit scheme is present.
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    for (const attr of ["href", "src", "xlink:href", "action"]) {
      const value = node.getAttribute?.(attr);
      if (!value) continue;
      const trimmed = value.trim();
      if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !SAFE_URI.test(trimmed)) {
        node.removeAttribute(attr);
      }
    }
  });
  configured = true;
}

/**
 * Sanitize a block of document HTML for display.
 *
 * Returns the input unchanged during SSR, where there is no DOM to inject
 * into and therefore nothing to execute.
 */
export function sanitizeDocumentHtml(html: string): string {
  if (!html) return "";
  if (typeof window === "undefined") return html;
  ensureConfigured();
  return DOMPurify.sanitize(html, {
    // Keep presentational + structural markup; drop script-bearing elements.
    FORBID_TAGS: ["script", "iframe", "object", "embed", "base", "meta", "link", "form"],
    // Belt and braces: DOMPurify already strips on* handlers, but naming them
    // documents the intent for the next reader.
    FORBID_ATTR: ["srcdoc", "formaction", "ping"],
    ALLOW_DATA_ATTR: true,
    // Embedded diagrams reference raster images inline; the hook above still
    // enforces the scheme allowlist, so svg+xml data URIs are rejected.
    ADD_DATA_URI_TAGS: ["img"],
    // `<details>`/`<summary>` and SVG badges are load-bearing for real READMEs.
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
  });
}

/**
 * Sanitize a mermaid- or katex-generated SVG string.
 *
 * These renderers take document-controlled source, so their output is only as
 * trustworthy as the document that produced it.
 */
export function sanitizeSvg(svg: string): string {
  if (!svg) return "";
  if (typeof window === "undefined") return svg;
  ensureConfigured();
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "foreignObject"],
    ADD_TAGS: ["use"],
  });
}
