"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { useCallback, useEffect, useRef } from "react";
import { BubbleMenuComponent } from "./bubble-menu";
import { LinkBubbleMenu } from "./link-bubble-menu";

import { ImageModal } from "./image-modal";
import { BookmarkModal } from "./bookmark-modal";
import { PagePickerModal } from "./page-picker-modal";
import { EditorContextMenu } from "./editor-context-menu";
import { SearchBar } from "./search-bar";
import { StatusBar } from "./status-bar";
import { DocumentTitle } from "./document-title";
import { PageCover } from "./page-cover";
import { useIsMobile } from "@/hooks/use-device-type";
import { useEditorShortcuts } from "@/hooks/use-editor-shortcuts";
import { useBlockKeyboardShortcuts } from "@/hooks/use-block-keyboard-shortcuts";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { useEditorStore } from "@/stores/editor-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { cn, debounce } from "@/lib/utils";
import { apiUrl } from "@/lib/api/base";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getEditorExtensions, defaultEditorProps } from "./editor-extensions";
import { BlockHandle } from "./block-handle";
import { TableHandles } from "./table-handles";
import { EDITOR_DEBOUNCE_DELAY } from "@/lib/constants";
import { rangeToMarkdown } from "@/lib/markdown-selection";
import { useDatabaseStore } from "@/stores/database-store";
import { eventBus } from "@/lib/events";

/** Extract database block IDs from HTML (data-database-id) or markdown (<!-- database:uuid -->) */
function extractDatabaseIds(content: string): Set<string> {
  const ids = new Set<string>();
  // Match both HTML attribute and markdown comment formats
  const re = /(?:data-database-id="([a-f0-9-]+)"|<!-- database:([a-f0-9-]+) -->)/g;
  let m;
  while ((m = re.exec(content)) !== null) ids.add(m[1] || m[2]);
  return ids;
}

interface EditorProps {
  file: FileItem;
}

export function Editor({ file: initialFile }: EditorProps) {
  // Subscribe to specific file via selector — avoids re-render when OTHER files change
  const updateFile = useFileStore((s) => s.updateFile);
  const storeFile = useFileStore((s) => s.files.find((f) => f.id === initialFile.id));
  const file = storeFile || initialFile;

  // Editor store — actions are stable refs, state values subscribed individually
  const setDirty = useEditorStore((s) => s.setDirty);
  const setSelection = useEditorStore((s) => s.setSelection);
  const setSaving = useEditorStore((s) => s.setSaving);
  const setLastSavedAt = useEditorStore((s) => s.setLastSavedAt);
  const imageModalOpen = useEditorStore((s) => s.imageModalOpen);
  const imageModalCallback = useEditorStore((s) => s.imageModalCallback);
  const closeImageModal = useEditorStore((s) => s.closeImageModal);

  // Layout state — use individual selectors to avoid re-renders on unrelated layout changes
  const editorWidth = useLayoutStore((s) => s.editorWidth);
  // fontFamily is applied at <html> by AppearanceInjector so the whole
  // app stays in one font; no per-editor wrapper needed here.
  const lineHeight = useLayoutStore((s) => s.lineHeight);

  const isMobile = useIsMobile();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const lastContentRef = useRef(file.content);
  const isFileSwitchingRef = useRef(false);
  // Track database block IDs in the document to detect removals on save
  const prevDbIdsRef = useRef<Set<string>>(new Set());
  // Track initial file.id to skip redundant setContent on first editor mount.
  // useEditor already initializes with the correct content; calling setContent
  // again destroys/recreates React node views, triggering flushSync errors.
  const initialFileIdRef = useRef<string | null>(file.id);

  // Debounced save function
  // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce returns a new function, deps are intentionally limited
  const debouncedSave = useCallback(
    debounce((content: string, contentMarkdown?: string) => {
      // Skip save if content hasn't changed
      if (content === lastContentRef.current) {
        setDirty(false);
        return;
      }

      setSaving(true);
      updateFile(file.id, { content, contentMarkdown });
      setSaving(false);
      setLastSavedAt(new Date().toISOString());
      setDirty(false);
      lastContentRef.current = content;

      // Detect removed database blocks and cascade-delete them
      const currentIds = extractDatabaseIds(contentMarkdown ?? content);
      for (const id of prevDbIdsRef.current) {
        if (!currentIds.has(id)) {
          // deleteDatabase emits "database:deleted" event on success,
          // which also cascade-deletes linked data files on the backend
          useDatabaseStore.getState().deleteDatabase(id);
        }
      }
      prevDbIdsRef.current = currentIds;
    }, EDITOR_DEBOUNCE_DELAY),
    [file.id, updateFile, setSaving, setLastSavedAt, setDirty]
  );

  const editor = useEditor({
    extensions: getEditorExtensions({ isMobile }),
    content: file.content,
    editorProps: {
      ...defaultEditorProps,
      attributes: {
        ...(defaultEditorProps.attributes || {}),
      },
      handleKeyDown: (view, event) => {
        if (event.isComposing) return false;

        void view;
        return false;
      },
    },
    immediatelyRender: false, // Prevent SSR hydration mismatch
    onUpdate: ({ editor }) => {
      // Skip save during file switching — the emit("update") is only to
      // notify other components (mindlines, word count, etc.)
      if (isFileSwitchingRef.current) return;
      const html = editor.getHTML();
      const markdown = editor.getMarkdown();
      setDirty(true);
      debouncedSave(html, markdown);
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      if (from !== to) {
        const text = rangeToMarkdown(editor, from, to);
        if (text) {
          setSelection({ from, to, text });
        } else {
          setSelection(null);
        }
      } else {
        setSelection(null);
      }
    },
  });

  // Register editor instance in global store for Command Palette access
  const { setEditor } = useEditorRefStore();
  useEffect(() => {
    setEditor(editor);
    return () => setEditor(null);
  }, [editor, setEditor]);

  // Remove stale database block nodes when a database is deleted externally.
  useEffect(() => {
    if (!editor) return;
    return eventBus.on("database:deleted", ({ databaseId }) => {
      // Remove from tracking ref so the save-based detection doesn't re-trigger
      prevDbIdsRef.current.delete(databaseId);

      // Find and remove the matching node from the TipTap document
      editor.commands.command(({ tr, state }) => {
        let deleted = false;
        state.doc.descendants((node, pos) => {
          if (deleted) return false;
          if (node.type.name === "databaseBlock" && node.attrs.databaseId === databaseId) {
            tr.delete(pos, pos + node.nodeSize);
            deleted = true;
            return false;
          }
        });
        return deleted;
      });
    });
  }, [editor]);

  // Persist pending edits when the tab closes. Uses fetch with keepalive:true
  // so the browser is allowed to complete the request after page teardown —
  // the regular store path's async fetch would otherwise be aborted mid-flight.
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!editor) return;
      const content = editor.getHTML();
      if (content === lastContentRef.current) return;
      const contentMarkdown = editor.getMarkdown();
      fetch(apiUrl(`/api/files/${file.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, content_markdown: contentMarkdown }),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [editor, file.id]);

  // Block selection is desktop-only; mobile always uses direct editing (Notion-style)
  useEffect(() => {
    if (editor && editor.commands.setBlockSelectionEnabled) {
      editor.commands.setBlockSelectionEnabled(!isMobile);
    }
  }, [editor, isMobile]);

  // Reset when file changes
  useEffect(() => {
    if (!editor) return;

    // Skip on initial mount — useEditor already initialized with the correct
    // content. Calling setContent again would destroy/recreate React node views,
    // triggering "flushSync was called from inside a lifecycle method" and
    // "Maximum update depth exceeded" errors.
    if (initialFileIdRef.current === file.id) {
      initialFileIdRef.current = null;
      lastContentRef.current = editor.getHTML();
      // Snapshot database block IDs in the initial content
      prevDbIdsRef.current = extractDatabaseIds(file.content);
      return;
    }

    // Cancel any pending debounced save from the previous file to prevent
    // stale saves that would unnecessarily update the old file's updatedAt
    debouncedSave.cancel();
    // Reset dirty state — the new file's content is already saved on the server
    setDirty(false);
    // Mark as switching immediately so onUpdate skips saves
    isFileSwitchingRef.current = true;

    // Use setTimeout(0) to run content replacement in a new macrotask, AFTER
    // React's commit phase is fully complete. queueMicrotask runs during the
    // same task and conflicts with React 19's stricter render cycle enforcement
    // when TipTap's ReactRenderer.destroy → forceStoreRerender triggers state
    // updates during rendering.
    const timeoutId = setTimeout(() => {
      // Stop ProseMirror's DOM observer to prevent it from misinterpreting
      // content replacement DOM mutations as user input (e.g., Enter keypresses
      // that cause splitListItem, adding empty lines to the document).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domObserver is internal ProseMirror API
      const domObserver = (editor.view as any).domObserver;
      domObserver?.stop();

      editor.commands.setContent(file.content, { emitUpdate: false });
      editor.commands.focus("start");
      // Use editor.getHTML() (TipTap-normalized) rather than raw file.content
      // to prevent false-positive change detection in debouncedSave.
      lastContentRef.current = editor.getHTML();
      // Snapshot database block IDs for the new file
      prevDbIdsRef.current = extractDatabaseIds(file.content);
      editor.emit("update", { editor, transaction: editor.state.tr, appendedTransactions: [] });

      // Restart DOM observer after content is fully replaced
      domObserver?.start();

      // Delay resetting the file switching flag to allow any queued
      // DOM observer callbacks to be discarded
      requestAnimationFrame(() => {
        isFileSwitchingRef.current = false;
      });
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      isFileSwitchingRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset on file.id change, not content
  }, [file.id, editor]);

  // Sync editor when file content arrives late after navigation.
  // The list endpoint returns content="" for optimization; real content loads
  // asynchronously via loadFileContent. This effect catches that transition.
  useEffect(() => {
    if (!editor || !file.content) return;
    // Only sync if the editor is currently empty but the store has real content
    const editorHTML = editor.getHTML();
    const isEmpty =
      editorHTML === "" ||
      editorHTML === "<p></p>" ||
      editorHTML === "<p><br></p>" ||
      editorHTML === '<p><br class="ProseMirror-trailingBreak"></p>';
    if (!isEmpty) return;

    isFileSwitchingRef.current = true;
    const timeoutId = setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domObserver is internal ProseMirror API
      const domObserver = (editor.view as any).domObserver;
      domObserver?.stop();

      editor.commands.setContent(file.content, { emitUpdate: false });
      editor.commands.focus("start");
      lastContentRef.current = editor.getHTML();
      editor.emit("update", { editor, transaction: editor.state.tr, appendedTransactions: [] });

      domObserver?.start();
      requestAnimationFrame(() => {
        isFileSwitchingRef.current = false;
      });
    }, 0);
    return () => {
      clearTimeout(timeoutId);
      isFileSwitchingRef.current = false;
    };
  }, [file.content, editor]);

  // Initialize hooks
  useBlockKeyboardShortcuts(!isMobile ? editor : null);

  // Use keyboard shortcuts hook (Ctrl+Shift+O for outline)
  useEditorShortcuts();

  // Handle Image Modal confirm
  const handleImageModalConfirm = useCallback(
    (url: string, alt?: string) => {
      if (imageModalCallback) {
        imageModalCallback(url, alt);
      }
      closeImageModal();
    },
    [imageModalCallback, closeImageModal]
  );

  // Set --right-extend CSS variable for Notion-style table rightward breakout.
  // This is the exact pixel distance from PM content right edge to scroll area right edge.
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el || !editor) return;
    const update = () => {
      const pm = editor.view.dom;
      const elRect = el.getBoundingClientRect();
      const pmPaddingRight = parseFloat(getComputedStyle(pm).paddingRight) || 0;
      const pmContentRight = pm.getBoundingClientRect().right - pmPaddingRight;
      const rightExtend = Math.max(0, elRect.right - pmContentRight);
      el.style.setProperty("--right-extend", `${rightExtend}px`);
    };
    const observer = new ResizeObserver(() => update());
    observer.observe(el);
    // Also update once now in case ResizeObserver already fired before editor was ready
    update();
    return () => observer.disconnect();
  }, [editor]);

  if (!editor) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading editor...</div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", !isMobile && "h-full")}>
      <div className={cn("flex min-w-0 overflow-x-hidden", !isMobile && "min-h-0 flex-1")}>
        {/* Main editor content area */}
        <div
          className={cn(
            "relative flex min-w-0 flex-col overflow-hidden",
            !isMobile && "min-h-0 flex-1"
          )}
        >
          {/* On mobile, parent MobileEditorLayout handles scrolling, so skip ScrollArea entirely */}
          {isMobile ? (
            <div
              className={cn(
                "mx-auto w-full max-w-full px-4 pb-24 pt-0 sm:max-w-4xl",
                "mobile-edit-mode", // Always edit mode on mobile (Notion-style)
                lineHeight === "compact" && "editor-leading-compact",
                lineHeight === "relaxed" && "editor-leading-relaxed"
              )}
            >
              <EditorContent editor={editor} />
            </div>
          ) : (
            <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1" data-editor-scroll>
              <PageCover fileId={file.id} />
              <div
                className={cn(
                  "relative mx-auto px-6 pb-4 pt-2 md:px-12 md:py-8",
                  editorWidth === "narrow" && "max-w-3xl",
                  editorWidth === "normal" && "max-w-5xl",
                  editorWidth === "wide" && "max-w-7xl",
                  editorWidth === "full" && "max-w-none",
                  lineHeight === "compact" && "editor-leading-compact",
                  lineHeight === "relaxed" && "editor-leading-relaxed"
                )}
              >
                <DocumentTitle
                  fileId={file.id}
                  fileName={file.name}
                  onEnterEditor={() => editor.commands.focus("start")}
                />
                <EditorContent editor={editor} />
              </div>
            </ScrollArea>
          )}
          {/* Search Bar - positioned top right within editor area */}
          <SearchBar />
          {/* Status Bar - desktop only */}
          {!isMobile && <StatusBar editor={editor} />}
        </div>
      </div>

      {/* Block Handle - Desktop only (+ button and drag grip in left margin) */}
      {!isMobile && editor && <BlockHandle editor={editor} />}
      {/* Table Handles - Desktop only (column/row grips and edge + buttons) */}
      {!isMobile && editor && <TableHandles editor={editor} />}
      {/* Bubble Menus & Popups */}
      {/* Mobile shows simplified BubbleMenu; desktop shows full menus */}
      {/* Mobile uses MobileFormattingToolbar instead — BubbleMenu conflicts with native selection handles */}
      {!isMobile && <BubbleMenuComponent editor={editor} />}
      {!isMobile && (
        <>
          <LinkBubbleMenu editor={editor} />
          <EditorContextMenu editor={editor} />
        </>
      )}

      {/* Modals */}
      <ImageModal
        open={imageModalOpen}
        onClose={closeImageModal}
        onConfirm={handleImageModalConfirm}
      />
      <BookmarkModal />
      <PagePickerModal />
    </div>
  );
}
