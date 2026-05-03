"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
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
import { useBlockKeyboardShortcuts } from "@/hooks/use-block-keyboard-shortcuts";
import { useFileStore, type FileItem, TRANSIENT_ID_PREFIX } from "@/stores/file-store";
import { pickNativeSaveLocation } from "@/lib/native-dialog";
import { navigateToEditorFile } from "@/lib/editor-navigation";
import { useEditorStore } from "@/stores/editor-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { cn, debounce } from "@/lib/utils";
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
  // Transient (untitled) buffer hooks — only relevant when file.id has the
  // transient prefix. The slot is a ref so persistContent's deps array
  // stays stable; we read the latest value via store snapshot inline.
  const setTransientContent = useFileStore((s) => s.setTransientContent);
  const materializeTransient = useFileStore((s) => s.materializeTransient);
  const isTransient = file.id.startsWith(TRANSIENT_ID_PREFIX);

  // Editor store — actions are stable refs, state values subscribed individually
  const setDirty = useEditorStore((s) => s.setDirty);
  const setSelection = useEditorStore((s) => s.setSelection);
  const setSaving = useEditorStore((s) => s.setSaving);
  const setLastSavedAt = useEditorStore((s) => s.setLastSavedAt);
  const imageModalOpen = useEditorStore((s) => s.imageModalOpen);
  const imageModalCallback = useEditorStore((s) => s.imageModalCallback);
  const closeImageModal = useEditorStore((s) => s.closeImageModal);

  // Layout state — use individual selectors to avoid re-renders on unrelated layout changes
  // fontFamily is applied at <html> by AppearanceInjector so the whole
  // app stays in one font; no per-editor wrapper needed here.
  const lineHeight = useLayoutStore((s) => s.lineHeight);

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const lastContentRef = useRef(file.content);
  const isFileSwitchingRef = useRef(false);
  // Track database block IDs in the document to detect removals on save
  const prevDbIdsRef = useRef<Set<string>>(new Set());
  // Track initial file.id to skip redundant setContent on first editor mount.
  // useEditor already initializes with the correct content; calling setContent
  // again destroys/recreates React node views, triggering flushSync errors.
  const initialFileIdRef = useRef<string | null>(file.id);

  const persistContent = useCallback(
    async (content: string, contentMarkdown?: string) => {
      // Skip save if content hasn't changed
      if (content === lastContentRef.current) {
        setDirty(false);
        return;
      }

      setSaving(true);
      try {
        // Untitled buffer (VSCode-style): the content lives only in the
        // in-memory transient slot until the user picks a save location.
        // The native Save-As dialog is the trigger to materialize.
        if (isTransient) {
          // Always update the in-memory copy first so a cancelled dialog
          // doesn't lose what the user just typed.
          setTransientContent(content, contentMarkdown ?? "");
          const transient = useFileStore.getState().transientFile;
          if (!transient) {
            // Slot was discarded mid-save (window closed, etc.) — bail.
            lastContentRef.current = content;
            setDirty(false);
            return;
          }
          const path = await pickNativeSaveLocation("Save as", transient.name, [
            { name: "Markdown", extensions: ["md"] },
          ]);
          if (!path) {
            // User dismissed the dialog. Keep typing in memory; the next
            // debounced save will prompt again.
            lastContentRef.current = content;
            setDirty(false);
            return;
          }
          // Re-read in case more typing happened during the dialog (the
          // dialog is modal but be defensive).
          const latest = useFileStore.getState().transientFile;
          if (
            latest &&
            (latest.content !== content || latest.contentMarkdown !== contentMarkdown)
          ) {
            setTransientContent(latest.content, latest.contentMarkdown);
          } else {
            setTransientContent(content, contentMarkdown ?? "");
          }
          const newId = await materializeTransient(path);
          lastContentRef.current = content;
          setLastSavedAt(new Date().toISOString());
          setDirty(false);
          if (newId) navigateToEditorFile(newId);
          return;
        }

        await updateFile(file.id, { content, contentMarkdown });
        setLastSavedAt(new Date().toISOString());
        setDirty(false);
        lastContentRef.current = content;

        // Detect removed database blocks and cascade-delete them
        const currentIds = extractDatabaseIds(contentMarkdown ?? content);
        for (const id of prevDbIdsRef.current) {
          if (!currentIds.has(id)) {
            // deleteDatabase emits "database:deleted" event on success,
            // which also cascade-deletes linked data files on the backend
            void useDatabaseStore.getState().deleteDatabase(id);
          }
        }
        prevDbIdsRef.current = currentIds;
      } finally {
        setSaving(false);
      }
    },
    [
      file.id,
      isTransient,
      updateFile,
      setSaving,
      setLastSavedAt,
      setDirty,
      setTransientContent,
      materializeTransient,
    ]
  );

  // Debounced save function
  const debouncedSave = useMemo(
    () =>
      debounce((content: string, contentMarkdown?: string) => {
        void persistContent(content, contentMarkdown);
      }, EDITOR_DEBOUNCE_DELAY),
    [persistContent]
  );

  const editor = useEditor({
    extensions: getEditorExtensions(),
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

  // Persist pending edits when the tab closes through the active storage
  // adapter. Browser shutdown can still interrupt async work, but this keeps
  // the save path consistent for DB and disk workspaces.
  useEffect(() => {
    const saveCurrentNow = async () => {
      if (!editor) return;
      const content = editor.getHTML();
      if (content === lastContentRef.current) return;
      const contentMarkdown = editor.getMarkdown();
      debouncedSave.cancel();
      await persistContent(content, contentMarkdown);
    };

    const handleBeforeUnload = () => {
      void saveCurrentNow();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handleBeforeUnload);

    let unlistenClose: (() => void) | null = null;
    let closingAfterFlush = false;
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        const appWindow = getCurrentWindow();
        return appWindow.onCloseRequested(async (event) => {
          if (closingAfterFlush) return;
          event.preventDefault();
          await saveCurrentNow();
          closingAfterFlush = true;
          await appWindow.close();
        });
      })
      .then((unlisten) => {
        unlistenClose = unlisten;
      })
      .catch(() => {});

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handleBeforeUnload);
      unlistenClose?.();
    };
  }, [debouncedSave, editor, persistContent]);

  useEffect(() => {
    if (editor && editor.commands.setBlockSelectionEnabled) {
      editor.commands.setBlockSelectionEnabled(true);
    }
  }, [editor]);

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

  // Sync editor when file content arrives late after navigation, and when a
  // document is refreshed after an external markdown edit.
  useEffect(() => {
    if (!editor) return;
    const editorHTML = editor.getHTML();
    const isEmpty =
      editorHTML === "" ||
      editorHTML === "<p></p>" ||
      editorHTML === "<p><br></p>" ||
      editorHTML === '<p><br class="ProseMirror-trailingBreak"></p>';
    const shouldApplyDiskRefresh = file.content !== lastContentRef.current;
    if (!isEmpty && !shouldApplyDiskRefresh) return;
    if (editorHTML === file.content) {
      lastContentRef.current = editorHTML;
      return;
    }

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

  useBlockKeyboardShortcuts(editor);

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
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 min-w-0 flex-1 overflow-x-hidden">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1" data-editor-scroll>
            <PageCover fileId={file.id} />
            {/* Notion full-width writing surface. The desktop IDE shows
              one document at a time in a wide window, so the writing
              area fills the main column with a symmetric 96px side
              padding (matches Notion's --theme--page-padding in
              full-width mode). */}
            <div
              className={cn(
                "relative px-6 pb-4 pt-2 md:px-24 md:py-8",
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
          <SearchBar />
          <StatusBar editor={editor} />
        </div>
      </div>

      {editor && <BlockHandle editor={editor} />}
      {editor && <TableHandles editor={editor} />}
      <BubbleMenuComponent editor={editor} />
      <LinkBubbleMenu editor={editor} />
      <EditorContextMenu editor={editor} />

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
