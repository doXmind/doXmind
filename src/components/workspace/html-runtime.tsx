"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import { useFileStore, type FileItem, TRANSIENT_ID_PREFIX } from "@/stores/file-store";
import { useEditorStore } from "@/stores/editor-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useLayoutStore } from "@/stores/layout-store";
import { EDITOR_DEBOUNCE_DELAY } from "@/lib/constants";
import { debounce } from "@/lib/utils";

interface HtmlRuntimeProps {
  file: FileItem;
  // Accepted for API symmetry with the other runtimes; the iframe is full-bleed
  // so there is no outline gutter to reserve.
  reservedRightInset?: number;
}

/**
 * Native HTML surface. Unlike the Markdown runtime, an `.html` file is NOT
 * parsed into the TipTap/ProseMirror schema — that round-trip degrades any
 * markup the schema doesn't model (arbitrary tags, inline CSS, `<style>`/
 * `<head>`, layout). Instead the file's HTML is rendered verbatim inside a
 * sandboxed iframe (browser-native fidelity, isolated from the app's CSS, and
 * `<script>` inert because the sandbox grants no `allow-scripts`) and made
 * editable in place via `contentEditable`. On save we read the frame's own
 * serialization back out to disk.
 *
 * Known limitation: relatively-referenced assets (e.g. `assets/diagram.png`)
 * resolve against the app origin, not the file's directory, so they won't load
 * inside the frame. Absolute URLs and data URIs render fine.
 */
export function HtmlRuntime({ file }: HtmlRuntimeProps) {
  const updateFile = useFileStore((s) => s.updateFile);
  const isTransient = file.id.startsWith(TRANSIENT_ID_PREFIX);

  const setDirty = useEditorStore((s) => s.setDirty);
  const setSaving = useEditorStore((s) => s.setSaving);
  const setLastSavedAt = useEditorStore((s) => s.setLastSavedAt);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  // The HTML currently loaded into the frame — initial load or last save. Guards
  // the late-content/external-edit effect from clobbering the user's live edits.
  const loadedContentRef = useRef<string | null>(null);
  const initializedIdRef = useRef<string | null>(null);
  // A full document keeps its `<html>`/`<head>`; a fragment is written back as
  // just the body's innerHTML so it stays a fragment instead of being wrapped.
  const isFullDocRef = useRef(false);

  // Serialize the current frame DOM back to an HTML string for persistence.
  const serializeFrame = useCallback((): string | null => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return null;
    if (isFullDocRef.current) {
      const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>\n` : "";
      return doctype + doc.documentElement.outerHTML;
    }
    return doc.body?.innerHTML ?? "";
  }, []);

  const persist = useCallback(
    async (html: string) => {
      // `.html` files are always disk-backed in practice (no untitled-buffer
      // flow creates them); skip the transient picker dance entirely.
      if (isTransient) return;
      if (html === loadedContentRef.current) {
        setDirty(false);
        return;
      }
      setSaving(true);
      try {
        await updateFile(file.id, { content: html });
        loadedContentRef.current = html;
        setLastSavedAt(new Date().toISOString());
        setDirty(false);
      } finally {
        setSaving(false);
      }
    },
    [file.id, isTransient, updateFile, setDirty, setSaving, setLastSavedAt]
  );

  const debouncedSave = useMemo(
    () =>
      debounce(() => {
        const html = serializeFrame();
        if (html != null) void persist(html);
      }, EDITOR_DEBOUNCE_DELAY),
    [serializeFrame, persist]
  );

  // Load the file's HTML into the frame. Runs on file switch (id change) and
  // when content arrives late or changes externally — but never while the user
  // has unsaved edits (the live frame diverges from loadedContentRef).
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const content = file.content ?? "";

    const isNewFile = initializedIdRef.current !== file.id;
    if (!isNewFile && content === loadedContentRef.current) return;
    if (isNewFile && !content) return; // still loading; wait for content
    if (!isNewFile) {
      // Same file, content changed on disk: only re-init when the buffer is
      // clean (live frame still matches what we loaded). Mid-edit: keep edits.
      const live = serializeFrame();
      if (live !== null && live !== loadedContentRef.current) return;
    }

    initializedIdRef.current = file.id;
    loadedContentRef.current = content;
    isFullDocRef.current = /<html[\s>]/i.test(content);
    setDirty(false);

    iframe.srcdoc = content;
  }, [file.id, file.content, serializeFrame, setDirty]);

  // Wire editing onto the freshly-loaded frame document. A new document is
  // created on every `srcdoc` assignment, so listeners land on the live doc and
  // the old one is discarded with its frame — no manual teardown needed.
  const handleLoad = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body) return;

    // `designMode` makes the document editable via an internal flag rather than
    // a DOM attribute, so no `contenteditable`/`spellcheck` markup leaks into
    // the HTML we serialize back to disk.
    doc.designMode = "on";

    doc.addEventListener("input", () => {
      setDirty(true);
      // Autosave can be turned off from the "..." menu; edits then flush only on
      // ⌘S or window close. Mirrors MarkdownRuntime.
      if (useLayoutStore.getState().autosaveEnabled) {
        debouncedSave();
      }
    });
    doc.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        debouncedSave.cancel();
        const html = serializeFrame();
        if (html != null) void persist(html);
      }
    });
  }, [debouncedSave, serializeFrame, persist, setDirty]);

  // Expose an awaitable save for chrome (header close button), the app shell's
  // ⌘S, and window close — mirrors MarkdownRuntime.
  useEffect(() => {
    const saveNow = async (): Promise<boolean> => {
      const html = serializeFrame();
      if (html == null || html === loadedContentRef.current) return true;
      debouncedSave.cancel();
      await persist(html);
      return true;
    };
    useEditorRefStore.getState().setRequestSave(saveNow);

    const handleSaveNow = () => void saveNow();
    const handleUnload = () => void saveNow();
    window.addEventListener("doxmind:save-now", handleSaveNow);
    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("pagehide", handleUnload);

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
              saveNow(),
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
      window.removeEventListener("doxmind:save-now", handleSaveNow);
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);
      useEditorRefStore.getState().setRequestSave(null);
      unlistenClose?.();
    };
  }, [serializeFrame, persist, debouncedSave]);

  useEffect(() => () => debouncedSave.cancel(), [debouncedSave]);

  return (
    <div className="flex h-full flex-col" data-testid="html-runtime">
      <iframe
        ref={iframeRef}
        title={file.name}
        onLoad={handleLoad}
        sandbox="allow-same-origin"
        className="min-h-0 flex-1 border-0 bg-white"
      />
    </div>
  );
}
