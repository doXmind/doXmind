"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import { useFileStore, type FileItem } from "@/stores/file-store";
import { useEditorStore } from "@/stores/editor-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { debounce } from "@/lib/utils";
import { EDITOR_DEBOUNCE_DELAY } from "@/lib/constants";

interface HtmlRuntimeProps {
  file: FileItem;
}

const BASE_MARKER = "data-doxmind-base";
const CSP_MARKER = "data-doxmind-csp";

/**
 * HTML editing surface. Unlike Markdown, the file is NOT parsed through the
 * TipTap schema — it is rendered faithfully (real HTML + CSS) inside an
 * iframe, and its text content is edited in place via `designMode`. On save
 * the whole document (doctype + head + body) is serialized back verbatim, so
 * tags, attributes, styles and inert `<script>` markup all survive the
 * round-trip (issue #139).
 *
 * Page scripts must never run (a deliberate non-goal). We block them with an
 * injected CSP `<meta script-src 'none'>` rather than the `sandbox` attribute:
 * a sandboxed `srcdoc` iframe is treated as a unique origin by WebKit
 * (Tauri's WKWebView), which makes `contentDocument` inaccessible and the
 * surface un-editable. A same-origin iframe + CSP keeps DOM access on every
 * engine while still neutralizing scripts; the `<script>` nodes stay in the
 * DOM, so serialization preserves them.
 */
export function HtmlRuntime({ file }: HtmlRuntimeProps) {
  const updateFile = useFileStore((s) => s.updateFile);
  const setDirty = useEditorStore((s) => s.setDirty);
  const setSaving = useEditorStore((s) => s.setSaving);
  const setLastSavedAt = useEditorStore((s) => s.setLastSavedAt);
  const setEditor = useEditorRefStore((s) => s.setEditor);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  // The last HTML we serialized + persisted. Guards the save feedback loop:
  // a store update that echoes our own write must not reload the iframe.
  const lastSerializedRef = useRef<string>(file.content ?? "");
  const observerRef = useRef<MutationObserver | null>(null);

  // No TipTap editor exists for HTML docs — clear the shared ref so the
  // outline rail / search bar don't act on a stale editor from another doc.
  useEffect(() => {
    setEditor(null);
    return () => setEditor(null);
  }, [setEditor]);

  const baseHref = useMemo(() => {
    const root = useFileStore.getState().rootPath;
    const rel = file.storageHandle?.relPath || file.storageHandle?.path;
    if (!root || !rel) return null;
    const trimmedRoot = root.replace(/[/\\]+$/, "");
    const relDir = rel
      .replace(/^[/\\]+/, "")
      .split(/[/\\]/)
      .slice(0, -1)
      .join("/");
    const dir = relDir ? `${trimmedRoot}/${relDir}` : trimmedRoot;
    return `file://${encodeURI(dir)}/`;
  }, [file.storageHandle?.relPath, file.storageHandle?.path]);

  // Inject a script-blocking CSP into the document before it loads, so page
  // scripts never execute. Marked so it can be stripped on serialize.
  const withCsp = useCallback((html: string): string => {
    const meta = `<meta ${CSP_MARKER} http-equiv="Content-Security-Policy" content="script-src 'none'">`;
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${meta}`);
    if (/<html[^>]*>/i.test(html))
      return html.replace(/<html([^>]*)>/i, `<html$1><head>${meta}</head>`);
    return `${meta}${html}`;
  }, []);

  const serialize = useCallback((): string | null => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.documentElement) return null;
    // Clone so stripping our injected nodes doesn't disturb the live preview.
    const root = doc.documentElement.cloneNode(true) as HTMLElement;
    root.querySelectorAll(`[${BASE_MARKER}],[${CSP_MARKER}]`).forEach((n) => n.remove());
    const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>\n` : "";
    return `${doctype}${root.outerHTML}\n`;
  }, []);

  const persist = useCallback(
    async (html: string) => {
      if (html === lastSerializedRef.current) {
        setDirty(false);
        return;
      }
      lastSerializedRef.current = html;
      setSaving(true);
      try {
        await updateFile(file.id, { content: html });
        setLastSavedAt(new Date().toISOString());
        setDirty(false);
      } finally {
        setSaving(false);
      }
    },
    [file.id, updateFile, setDirty, setSaving, setLastSavedAt]
  );

  const debouncedSave = useMemo(
    () => debounce((html: string) => void persist(html), EDITOR_DEBOUNCE_DELAY),
    [persist]
  );

  const scheduleSave = useCallback(() => {
    const html = serialize();
    if (html === null) return;
    setDirty(true);
    debouncedSave(html);
  }, [serialize, debouncedSave, setDirty]);

  // Configure the iframe document after each (re)load: make it editable,
  // inject a best-effort <base> for relative assets, then wire change capture
  // (input event + MutationObserver — the observer is the reliable path in
  // WebKit, where the input event on a designMode doc is unreliable).
  const handleLoad = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;

    try {
      doc.designMode = "on";
    } catch {
      if (doc.body) doc.body.contentEditable = "true";
    }

    if (baseHref && doc.head && !doc.head.querySelector(`[${BASE_MARKER}]`)) {
      const base = doc.createElement("base");
      base.setAttribute("href", baseHref);
      base.setAttribute(BASE_MARKER, "");
      doc.head.insertBefore(base, doc.head.firstChild);
    }

    doc.addEventListener("input", scheduleSave);

    observerRef.current?.disconnect();
    const observer = new MutationObserver(scheduleSave);
    observer.observe(doc.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    observerRef.current = observer;
  }, [baseHref, scheduleSave]);

  // Reload the iframe only when the document identity changes or an external
  // edit lands (content differs from what we last wrote). Echoes of our own
  // saves are skipped so the caret isn't reset mid-edit.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const next = file.content ?? "";
    if (next === lastSerializedRef.current && iframe.getAttribute("data-doc-id") === file.id) {
      return;
    }
    lastSerializedRef.current = next;
    iframe.setAttribute("data-doc-id", file.id);
    observerRef.current?.disconnect();
    iframe.srcdoc = withCsp(next);
  }, [file.id, file.content, withCsp]);

  useEffect(() => {
    return () => observerRef.current?.disconnect();
  }, []);

  // Flush pending edits on close / explicit save, mirroring the Markdown
  // runtime's close-to-save handshake.
  useEffect(() => {
    const flush = async () => {
      const html = serialize();
      if (html === null || html === lastSerializedRef.current) return;
      debouncedSave.cancel();
      await persist(html);
    };
    const onSaveNow = () => void flush();
    window.addEventListener("beforeunload", onSaveNow);
    window.addEventListener("pagehide", onSaveNow);
    window.addEventListener("doxmind:save-now", onSaveNow);

    let unlistenClose: (() => void) | null = null;
    let closingAfterFlush = false;
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        const appWindow = getCurrentWindow();
        return appWindow.onCloseRequested(async (event) => {
          if (closingAfterFlush) return;
          closingAfterFlush = true;
          event.preventDefault();
          try {
            await Promise.race([
              flush(),
              new Promise<void>((resolve) => window.setTimeout(resolve, 1500)),
            ]);
          } catch (error) {
            console.error("[HtmlRuntime] failed to save before close", error);
          }
          await appWindow.destroy();
        });
      })
      .then((unlisten) => {
        unlistenClose = unlisten;
      })
      .catch(() => {});

    return () => {
      window.removeEventListener("beforeunload", onSaveNow);
      window.removeEventListener("pagehide", onSaveNow);
      window.removeEventListener("doxmind:save-now", onSaveNow);
      unlistenClose?.();
    };
  }, [serialize, persist, debouncedSave]);

  return (
    <div className="flex h-full flex-col bg-white" data-testid="html-runtime">
      <iframe
        ref={iframeRef}
        onLoad={handleLoad}
        title={file.name}
        className="h-full w-full flex-1 border-0 bg-white"
      />
    </div>
  );
}
