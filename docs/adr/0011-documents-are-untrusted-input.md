# ADR-0011: Documents are untrusted input — sanitize at render, never at rest

Status: accepted (July 2026)

## Context

doXmind renders raw-HTML blocks found inside Markdown documents so the user sees
the real layout — centered badge rows, `<details>` toggles, inline SVG. The
`rawHtml` node view did this by assigning the document's markup straight to
`innerHTML`, with a comment reasoning that "innerHTML does not execute
`<script>`".

That reasoning is half right and the wrong half is fatal. `innerHTML` does not
run `<script>` tags, but it _does_ fire event-handler attributes the moment the
node is inserted. A document containing

```html
<img src="x" onerror="…" />
```

executes arbitrary script **just from being opened** — no click required.

This matters because a `.md` file is not a trusted artifact. Users open files
they downloaded, cloned, received, or synced. The product's entire premise is
"point it at files on your disk."

The blast radius was not confined to the page. Script running in the renderer
can reach:

- the localhost sidecar API (`workspace_scan` enumerates the workspace tree;
  `workspace_markdown_search` returns line previews of document contents, which
  an attacker can iterate to reconstruct files);
- `workspace_read_binary` for PDF/Excel bytes;
- in the Electron shell, `window.__TAURI_INTERNALS__.invoke`, which the preload
  exposes to the main world and which forwards _every_ command to the main
  process;
- the network, for exfiltration.

`contextIsolation: true` does not help here: the vulnerable code and the exposed
bridge live in the same world by design.

Three further injection points shared the same root assumption: the math node
view interpolated raw LaTeX into an error `<span>` via `innerHTML`, KaTeX was
configured with `trust: true` (which enables `\href`/`\url` — a `javascript:`
smuggling route), and mermaid-generated SVG was projected through
`dangerouslySetInnerHTML` unfiltered.

## Decision

**Treat every document-derived string as untrusted, and sanitize it at the
boundary where it becomes DOM — never where it is stored.**

1. A single module, `src/lib/sanitize-html.ts`, wraps DOMPurify and owns the
   policy: `sanitizeDocumentHtml()` for document markup, `sanitizeSvg()` for
   renderer-generated SVG. One place to audit, one place to tighten.
2. Every sink routes through it: the `rawHtml` node view, the browsing runtime's
   `dangerouslySetInnerHTML`, and both mermaid surfaces. The math error path
   uses `textContent` instead of markup, and KaTeX runs with `trust: false`.
3. The URL policy is an allowlist of schemes (`https?`, `mailto`, `tel`,
   `doxmind-asset`, and raster `data:image/*`). Scheme-less relative URLs are
   explicitly allowed so doc-to-doc links (`docs/spec.md`) keep working.
   `data:image/svg+xml` is **excluded** — an inline SVG carries its own script
   and would reopen the hole through the image path.

**Sanitization is display-only.** The pristine bytes stay in the node's `html`
attribute and are re-emitted verbatim on save.

## Consequences

The two properties that must both hold, and are pinned by tests:

- **Opening a hostile document cannot run its script.**
  (`src/__tests__/lib/sanitize-html.test.ts`)
- **Saving a hostile document does not rewrite it.** Block-level source
  preservation (ADR-0009, issue #149) still re-emits untouched blocks
  byte-identically — including the markup that was stripped from the _view_.

That second property is deliberate and may look surprising: we render a
defanged version while leaving the user's file exactly as they had it. doXmind
is an editor for the user's own files, not a sanitizing rewriter; silently
"cleaning" someone's document on open would be its own kind of data loss.

Costs we accept: DOMPurify runs on every raw-HTML block render and on browsing
HTML preparation, and legitimate-but-exotic markup (forms, iframes, embeds) is
dropped from the view. Neither has shown up as a practical problem, and both
are the right trade against arbitrary code execution.

If a future change needs to render document markup somewhere new, it goes
through `sanitize-html.ts`. Adding a fresh `innerHTML` sink is a regression even
if nothing visibly breaks.
