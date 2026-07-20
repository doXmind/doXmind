"use client";

import { useFileStore } from "@/stores/file-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { normalizeFromEditor } from "@/components/editor/mindlines/canonical-outline";
import type { FileItem } from "@/types";

export const EDITOR_LOCATION_CHANGE_EVENT = "doxmind:editor-location-change";

export function editorPath(fileId: string | null): string {
  return fileId ? `/editor/${encodeURIComponent(fileId)}` : "/editor";
}

export function getEditorFileIdFromPathname(pathname?: string): string | null {
  const source = pathname ?? (typeof window !== "undefined" ? window.location.pathname : "/editor");
  const match = source.match(/^\/editor\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function setEditorLocation(fileId: string | null, options?: { replace?: boolean }) {
  if (typeof window === "undefined") return;

  const nextPath = `${editorPath(fileId)}${window.location.search}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current === nextPath) return;

  const method = options?.replace ? "replaceState" : "pushState";
  window.history[method]({ ...window.history.state, doxmindFileId: fileId }, "", nextPath);
  window.dispatchEvent(new CustomEvent(EDITOR_LOCATION_CHANGE_EVENT, { detail: { fileId } }));
}

export function navigateToEditorFile(fileId: string | null, options?: { replace?: boolean }) {
  useFileStore.getState().setCurrentFile(fileId);
  setEditorLocation(fileId, options);
}

// --- Document-relative links -------------------------------------------------
//
// A markdown link may point at another document in the workspace
// (`[spec](../notes/Other Doc.md)`) or at a heading (`[top](#overview)`). Both
// are in-app navigations: handing them to `window.open` resolves them against
// the current `/editor/<id>` URL and lands on a route that does not exist.

export type HrefKind =
  | { kind: "external" }
  | { kind: "anchor"; anchor: string }
  | { kind: "path"; path: string; anchor: string | null };

export type EditorLinkTarget =
  | { kind: "external" }
  | { kind: "anchor"; anchor: string }
  | { kind: "document"; fileId: string; anchor: string | null }
  | { kind: "unresolved"; path: string };

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
// Schemes this app will hand to the OS. Documents are untrusted input
// (docs/adr/0011), and this is the one place a href in one reaches a browser.
const OPENABLE_SCHEME_RE = /^(https?|mailto):/i;
// Documents the workspace can open by path. Anything else (an image, a zip) is
// not a navigation target and stays an external open.
const DOCUMENT_EXTENSIONS = [".md", ".markdown", ".pdf", ".xlsx", ".xlsm", ".csv", ".html"];

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A stray `%` is legal in a path but not in a percent-escape; keep it raw.
    return value;
  }
}

export function classifyHref(href: string): HrefKind | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#")) {
    const anchor = decodePath(trimmed.slice(1));
    return anchor ? { kind: "anchor", anchor } : null;
  }
  if (SCHEME_RE.test(trimmed) || trimmed.startsWith("//")) return { kind: "external" };

  const hashAt = trimmed.indexOf("#");
  const rawPath = hashAt === -1 ? trimmed : trimmed.slice(0, hashAt);
  const anchor = hashAt === -1 ? null : decodePath(trimmed.slice(hashAt + 1)) || null;
  const path = decodePath(rawPath.split("?")[0]);
  if (!path) return null;
  return { kind: "path", path, anchor };
}

/**
 * Resolve `href` against the directory holding the linking document, as a
 * workspace-root-relative path. `..` cannot climb above the root — the
 * workspace is the only thing the app can address.
 */
export function normalizeWorkspacePath(fromDir: string, href: string): string {
  const base = href.startsWith("/") ? [] : fromDir.split("/").filter(Boolean);
  for (const segment of href.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") base.pop();
    else base.push(segment);
  }
  return base.join("/");
}

function encodeSegment(segment: string): string {
  // Parentheses are legal in a URI but end the destination of a markdown
  // inline link, so they have to be escaped even though encodeURIComponent
  // leaves them alone.
  return encodeURIComponent(segment).replace(/\(/g, "%28").replace(/\)/g, "%29");
}

/** The link text a `.md` file should carry to point at `toRelPath`. */
export function relativeDocumentHref(fromRelPath: string, toRelPath: string): string {
  const from = fromRelPath.split("/").filter(Boolean).slice(0, -1);
  const to = toRelPath.split("/").filter(Boolean);
  let shared = 0;
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) shared++;
  const up = Array.from({ length: from.length - shared }, () => "..");
  return [...up, ...to.slice(shared).map(encodeSegment)].join("/");
}

function relPathOf(file: FileItem | undefined): string | null {
  if (!file) return null;
  const handle = file.storageHandle;
  return handle?.relPath || handle?.path || null;
}

function findFileById(id: string | null): FileItem | undefined {
  if (!id) return undefined;
  return useFileStore.getState().files.find((f) => f.id === id);
}

export function resolveEditorLink(href: string, fromFileId?: string | null): EditorLinkTarget {
  const classified = classifyHref(href);
  if (!classified) return { kind: "unresolved", path: "" };
  if (classified.kind !== "path") return classified;

  const state = useFileStore.getState();
  const from = findFileById(fromFileId ?? state.currentFileId);
  const fromRel = relPathOf(from) ?? "";
  const fromDir = fromRel.split("/").slice(0, -1).join("/");
  const target = normalizeWorkspacePath(fromDir, classified.path);

  const lower = target.toLowerCase();
  const hasDocExtension = DOCUMENT_EXTENSIONS.some((ext) => lower.endsWith(ext));
  const candidates = hasDocExtension ? [target] : [target, `${target}.md`];

  for (const candidate of candidates) {
    const match = state.files.find((f) => !f.isFolder && relPathOf(f) === candidate);
    if (match) return { kind: "document", fileId: match.id, anchor: classified.anchor };
  }
  return { kind: "unresolved", path: target };
}

/** Where a page link/mention should point when serialized from `fromFileId`. */
export function documentHrefForPage(pageId: string, fromFileId?: string | null): string | null {
  if (!pageId) return null;
  const target = relPathOf(findFileById(pageId));
  if (!target) return null;
  const from = relPathOf(findFileById(fromFileId ?? useFileStore.getState().currentFileId)) ?? "";
  return relativeDocumentHref(from, target);
}

/** The target page's current name in the workspace. */
export function documentNameForPage(pageId: string): string | null {
  return findFileById(pageId)?.name || null;
}

export interface PageNodeAttrs {
  pageId?: string | null;
  pageTitle?: string | null;
  pageHref?: string | null;
}

/**
 * The portable markdown for a page link or mention: a relative link to the
 * target document, which any markdown reader can follow.
 *
 * The href is recomputed from the workspace whenever the target is known, so a
 * page moved or renamed since the node was inserted still links correctly; the
 * stored href is the fallback for a target the workspace can no longer see.
 * The label, in contrast, is whatever the node already carries, so serializing
 * never rewrites text that is already sitting in the user's file.
 *
 * With no href at all the node degrades to the bare title it has always
 * emitted: an unresolvable link is no reason to drop the text with it.
 */
export function renderPageMarkdownLink(attrs: PageNodeAttrs): string {
  const pageId = attrs.pageId || "";
  const href = documentHrefForPage(pageId) ?? attrs.pageHref ?? "";
  const title = attrs.pageTitle || (pageId ? documentNameForPage(pageId) : null) || "";
  if (!href) return title || (pageId ? "Untitled" : "");
  const label = (title || "Untitled").replace(/([[\]])/g, "\\$1");
  return `[${label}](${href})`;
}

/**
 * The id to hand a page node on parse. Workspace ids are only stable once a
 * document has a sidecar — a document that has never been opened is identified
 * by its path, so opening it for the first time changes its id and leaves every
 * link to it pointing at nothing. The stored href outlives that, so fall back
 * to it whenever the stored id names no document the workspace can see.
 */
export function resolvePageId(storedId: string | null, href: string | null): string | null {
  if (storedId && findFileById(storedId)) return storedId;
  if (href) {
    const target = resolveEditorLink(href);
    if (target.kind === "document") return target.fileId;
  }
  return storedId;
}

function soleAnchorChild(element: HTMLElement): HTMLAnchorElement | null {
  let anchor: HTMLAnchorElement | null = null;
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 3) {
      if ((child.textContent || "").trim()) return null;
      continue;
    }
    if (anchor || !(child instanceof HTMLElement) || child.tagName !== "A") return null;
    anchor = child as HTMLAnchorElement;
  }
  return anchor;
}

/**
 * Claim a paragraph that holds nothing but a link to another workspace
 * document as a page-link card — the shape a page link takes once it has been
 * written to markdown and read back without its sidecar.
 *
 * Deliberately narrow. A page link is never labelled by hand (the node is an
 * atom), so the label always is the target's name, and requiring that keeps
 * prose the user wrote themselves — `[the spec](Other Doc.md)` — an ordinary,
 * editable link. Links to documents the workspace cannot see are left alone
 * too: a dangling path should stay text the user can repair, not become a card.
 */
export function pageLinkAttrsFromParagraph(element: HTMLElement): PageNodeAttrs | false {
  const anchor = soleAnchorChild(element);
  if (!anchor) return false;
  const href = anchor.getAttribute("href") || "";
  const target = resolveEditorLink(href);
  if (target.kind !== "document" || target.anchor) return false;
  const label = (anchor.textContent || "").trim();
  if (!label || label !== findFileById(target.fileId)?.name) return false;
  return { pageId: target.fileId, pageTitle: label, pageHref: href };
}

// GitHub's heading slug: lowercase, punctuation dropped, spaces to hyphens.
function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

const ANCHOR_RETRY_MS = 120;
const ANCHOR_DEADLINE_MS = 2000;

/**
 * Put the caret on the heading `anchor` names and scroll it into view. After a
 * cross-document jump the target editor is still loading, so retry until it
 * has mounted rather than silently doing nothing.
 */
export function scrollToHeadingAnchor(anchor: string, deadlineMs = ANCHOR_DEADLINE_MS): void {
  if (typeof window === "undefined") return;
  const slug = slugifyHeading(anchor);
  const started = Date.now();

  const attempt = () => {
    const editor = useEditorRefStore.getState().editor;
    const heading = editor
      ? normalizeFromEditor(editor).find((h) => slugifyHeading(h.text) === slug)
      : undefined;
    if (heading && editor) {
      editor
        .chain()
        .setTextSelection(heading.pos + 1)
        .focus()
        .scrollIntoView()
        .run();
      return;
    }
    if (Date.now() - started < deadlineMs) window.setTimeout(attempt, ANCHOR_RETRY_MS);
  };
  attempt();
}

/**
 * Follow a link found in a document. In-workspace targets navigate in-app;
 * only genuine URLs reach the browser. Returns false when the href points at
 * nothing the workspace knows about, so callers can stay put instead of
 * opening a window on a dead route.
 */
export function openEditorLink(href: string): boolean {
  const target = resolveEditorLink(href);
  switch (target.kind) {
    case "external":
      if (!OPENABLE_SCHEME_RE.test(href.trim()) && !href.trim().startsWith("//")) return false;
      window.open(href, "_blank", "noopener,noreferrer");
      return true;
    case "anchor":
      scrollToHeadingAnchor(target.anchor);
      return true;
    case "document":
      if (target.fileId !== useFileStore.getState().currentFileId) {
        navigateToEditorFile(target.fileId);
      }
      if (target.anchor) scrollToHeadingAnchor(target.anchor);
      return true;
    case "unresolved":
      return false;
  }
}
