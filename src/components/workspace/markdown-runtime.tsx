"use client";

import { useEditor, EditorContent, type Editor as TiptapEditor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { AnimatePresence, motion } from "framer-motion";
import type { EditorView } from "@tiptap/pm/view";
import {
  type CSSProperties,
  type MouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { BubbleMenuComponent } from "@/components/editor/bubble-menu";
import { LinkBubbleMenu } from "@/components/editor/link-bubble-menu";
import { PagePickerPopover } from "@/components/editor/page-picker-popover";
import { EditorContextMenu } from "@/components/editor/editor-context-menu";
import { SearchBar } from "@/components/editor/search-bar";
import { StatusBar } from "@/components/editor/status-bar";
import { DocumentTitle } from "@/components/editor/document-title";
import { BlockHandle } from "@/components/editor/block-handle";
import { TableHandles } from "@/components/editor/table-handles";
import { getEditorExtensions, defaultEditorProps } from "@/components/editor/editor-extensions";

import { useBlockKeyboardShortcuts } from "@/hooks/use-block-keyboard-shortcuts";
import { useFileStore, type FileItem, TRANSIENT_ID_PREFIX } from "@/stores/file-store";
import { pickNativeSaveLocation } from "@/lib/native-dialog";
import { navigateToEditorFile } from "@/lib/editor-navigation";
import { isHtmlFile } from "@/lib/document-types";
import { useEditorStore } from "@/stores/editor-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { cn, debounce } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MarkdownSkeleton,
  MarkdownSkeletonContent,
} from "@/components/workspace/markdown-skeleton";
import { EDITOR_DEBOUNCE_DELAY } from "@/lib/constants";
import { rangeToMarkdown } from "@/lib/markdown-selection";
import { useDatabaseStore } from "@/stores/database-store";
import { eventBus } from "@/lib/events";
import { perfMark, perfMeasure, perfSync } from "@/lib/perf";

// Per-file scroll memory keyed by fileId, kept at module scope so it survives
// MarkdownRuntime remounts — the workspace swaps in a skeleton (unmounting the
// runtime) whenever a file's content is still loading, which would discard any
// per-instance state. Missing entry => start the file at the top.
const scrollPositions = new Map<string, number>();

interface MarkdownRuntimeProps {
  file: FileItem;
  reservedRightInset?: number;
}

type EditActivationIntent =
  | { type: "pointer"; clientX: number; clientY: number }
  | { type: "keyboard"; key: string };

/**
 * Unified Markdown surface. Read/edit mode is a property of the same TipTap
 * editor instance, so activation never swaps the document DOM.
 */
export function MarkdownRuntime({ file, reservedRightInset = 0 }: MarkdownRuntimeProps) {
  const updateFile = useFileStore((s) => s.updateFile);
  const setTransientContent = useFileStore((s) => s.setTransientContent);
  const materializeTransient = useFileStore((s) => s.materializeTransient);
  const isTransient = file.id.startsWith(TRANSIENT_ID_PREFIX);

  const setDirty = useEditorStore((s) => s.setDirty);
  const setSelection = useEditorStore((s) => s.setSelection);
  const setSaving = useEditorStore((s) => s.setSaving);
  const setLastSavedAt = useEditorStore((s) => s.setLastSavedAt);

  const lineHeight = useLayoutStore((s) => s.lineHeight);

  // Mode is local state. Untitled buffers (transient) open straight into
  // edit mode; everything else starts in read mode and switches on the
  // user's first edit intent (click in the content area, or any printable
  // key while focus is elsewhere on the page).
  const [isEditing, setIsEditing] = useState(isTransient);
  const [activationIntent, setActivationIntent] = useState<EditActivationIntent | undefined>();
  // Hot-switch overlay: when file.id changes the desktop-editor skeleton is
  // bypassed (loadedContentIds already has the file), but `setContent` is
  // deferred to a macrotask so the PM DOM keeps showing the previous file
  // for one render cycle. The overlay paints skeleton bars on top of
  // EditorContent during that gap so the click feels acknowledged.
  const [isSwitching, setIsSwitching] = useState(false);

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const appliedActivationIntentRef = useRef<EditActivationIntent | undefined>(undefined);
  const lastContentRef = useRef(file.content);
  const isFileSwitchingRef = useRef(false);
  const prevDbIdsRef = useRef<Set<string>>(new Set());
  const initialFileIdRef = useRef<string | null>(file.id);

  const persistContent = useCallback(
    async (content: string, contentMarkdown?: string, options?: { explicit?: boolean }) => {
      if (content === lastContentRef.current) {
        setDirty(false);
        return true;
      }

      // A transient ("New file") buffer is never autosaved to disk — like a
      // VSCode untitled document it stays freely editable and dirty until the
      // user explicitly saves (⌘S, or on window close). Keystroke flushes only
      // keep the in-memory buffer current; only an explicit save opens the
      // location picker and materializes the file onto disk.
      if (isTransient && !options?.explicit) {
        setTransientContent(content, contentMarkdown ?? "");
        return true;
      }

      setSaving(true);
      try {
        if (isTransient) {
          setTransientContent(content, contentMarkdown ?? "");
          const transient = useFileStore.getState().transientFile;
          if (!transient) {
            lastContentRef.current = content;
            setDirty(false);
            return true;
          }
          const path = await pickNativeSaveLocation("Save as", transient.name, [
            { name: "Markdown", extensions: ["md"] },
          ]);
          if (!path) {
            // User dismissed the dialog. Keep `isDirty=true` and leave
            // `lastContentRef.current` pointing at the previous flush —
            // otherwise the header pill lies about being saved, and the
            // close-time `saveCurrentNow` early-returns on `content ===
            // lastContentRef.current`, silently dropping the typed buffer
            // when the user closes the window after cancelling.
            return false;
          }
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
          return true;
        }

        await updateFile(file.id, { content, contentMarkdown });
        setLastSavedAt(new Date().toISOString());
        setDirty(false);
        lastContentRef.current = content;

        const currentIds = extractDatabaseIds(contentMarkdown ?? content, "save");
        for (const id of prevDbIdsRef.current) {
          if (!currentIds.has(id)) {
            void useDatabaseStore.getState().deleteDatabase(id);
          }
        }
        prevDbIdsRef.current = currentIds;
        return true;
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

  // Defer the two TipTap serializers (getHTML + getMarkdown each walk the doc)
  // to the debounce-fire moment instead of running them on every keystroke.
  const debouncedSave = useMemo(
    () =>
      debounce((editor: TiptapEditor) => {
        if (editor.isDestroyed) return;
        const content = editor.getHTML();
        const contentMarkdown = editor.getMarkdown();
        void persistContent(content, contentMarkdown);
      }, EDITOR_DEBOUNCE_DELAY),
    [persistContent]
  );

  const editor = useEditor({
    extensions: getEditorExtensions(),
    content: file.content,
    editable: isTransient,
    editorProps: {
      ...defaultEditorProps,
      attributes: {
        ...(defaultEditorProps.attributes || {}),
      },
      handleKeyDown: (view, event) => {
        if (event.isComposing) return false;

        if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey
        ) {
          const { state, dispatch } = view;
          const { selection, schema } = state;
          const paragraph = schema.nodes.paragraph;

          if (selection.empty && paragraph) {
            const { $from } = selection;
            const parent = $from.parent;

            if (parent.type.name === "heading" && $from.parentOffset === parent.content.size) {
              event.preventDefault();

              if (parent.content.size === 0) {
                const tr = state.tr.setBlockType($from.before(), $from.after(), paragraph);
                dispatch(
                  tr
                    .setSelection(
                      TextSelection.create(tr.doc, Math.min($from.pos, tr.doc.content.size))
                    )
                    .scrollIntoView()
                );
                return true;
              }

              const insertPos = $from.after();
              const tr = state.tr.insert(insertPos, paragraph.create());
              dispatch(
                tr.setSelection(TextSelection.create(tr.doc, insertPos + 1)).scrollIntoView()
              );
              return true;
            }

            if (
              exitTextBlockContainerAtEnd(view, "blockquote", { exitOnNonEmptyEnd: true }) ||
              exitTextBlockContainerAtEnd(view, "callout")
            ) {
              event.preventDefault();
              return true;
            }
          }
        }

        return false;
      },
      handleDOMEvents: {
        mousedown: (view, event) => {
          // In read mode the outer ScrollArea handler activates edit mode;
          // running this fallback would mutate the doc and scroll to bottom
          // on the activation click.
          if (!view.editable) return false;
          if (event.button !== 0) return false;

          const editorDom = view.dom as HTMLElement;
          const target = event.target as Element | null;
          if (!target || !editorDom.contains(target)) return false;
          if (target.closest('button,a,input,textarea,select,[role="button"]')) return false;

          const lastBlock = Array.from(editorDom.children)
            .reverse()
            .find((child): child is HTMLElement => child instanceof HTMLElement);
          if (!lastBlock) return false;

          const editorRect = editorDom.getBoundingClientRect();
          const lastBlockRect = lastBlock.getBoundingClientRect();
          const isInsideEditorWidth =
            event.clientX >= editorRect.left && event.clientX <= editorRect.right;
          const isBelowLastBlock = event.clientY > lastBlockRect.bottom + 8;

          if (!isInsideEditorWidth || !isBelowLastBlock) return false;

          event.preventDefault();
          return focusTrailingParagraph(view);
        },
      },
    },
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      if (isFileSwitchingRef.current) return;
      setDirty(true);
      // Autosave can be turned off from the "..." menu. When off, edits stay in
      // the editor and are flushed only on an explicit save (⌘S) or on close.
      if (useLayoutStore.getState().autosaveEnabled) {
        debouncedSave(editor);
      }
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

  // Sync editable with mode. This is the ONE call that swaps the editor
  // between read and edit — the DOM stays mounted, no remount, no jitter.
  useEffect(() => {
    if (!editor) return;
    if (editor.isEditable !== isEditing) {
      const preservedScrollTop = scrollAreaRef.current?.scrollTop ?? null;
      editor.setEditable(isEditing);
      restoreScrollTop(scrollAreaRef.current, preservedScrollTop);
    }
  }, [editor, isEditing]);

  // Register editor in global store so SearchBar, the outline rail, command
  // palette, and presentation mode all see the same instance regardless of
  // read/edit state. Use the selector form (matching desktop-editor.tsx)
  // so the component doesn't re-render every time `setEditor` writes a new
  // state object — `setEditor` itself is reference-stable.
  const setEditor = useEditorRefStore((s) => s.setEditor);
  useEffect(() => {
    setEditor(editor);
    return () => setEditor(null);
  }, [editor, setEditor]);

  useEffect(() => {
    if (!editor) return;
    return eventBus.on("database:deleted", ({ databaseId }) => {
      prevDbIdsRef.current.delete(databaseId);
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

  useEffect(() => {
    const saveCurrentNow = async (): Promise<boolean> => {
      if (!editor) return true;
      const content = editor.getHTML();
      if (content === lastContentRef.current) return true;
      const contentMarkdown = editor.getMarkdown();
      debouncedSave.cancel();
      return await persistContent(content, contentMarkdown, { explicit: true });
    };

    // Expose an awaitable save so chrome (the header's close button) can
    // save-then-close. Cleared on unmount.
    useEditorRefStore.getState().setRequestSave(saveCurrentNow);

    const handleBeforeUnload = () => {
      void saveCurrentNow();
    };
    const handleSaveNow = () => {
      void saveCurrentNow();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handleBeforeUnload);
    window.addEventListener("doxmind:save-now", handleSaveNow);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handleBeforeUnload);
      window.removeEventListener("doxmind:save-now", handleSaveNow);
      useEditorRefStore.getState().setRequestSave(null);
    };
  }, [debouncedSave, editor, persistContent]);

  useEffect(() => {
    if (editor && editor.commands.setBlockSelectionEnabled) {
      editor.commands.setBlockSelectionEnabled(true);
    }
  }, [editor]);

  // File switch: replace content + reset scroll. The new file may be a
  // markdown different from the current one; we also reset isEditing back
  // to read (unless the new file is transient).
  useEffect(() => {
    if (!editor) return;

    if (initialFileIdRef.current === file.id) {
      initialFileIdRef.current = null;
      lastContentRef.current = editor.getHTML();
      prevDbIdsRef.current = extractDatabaseIds(file.content, "initialMount");
      // Capture the original Markdown so untouched blocks round-trip verbatim.
      editor.commands.setSourceBaseline(file.contentMarkdown ?? null);
      // #139: for an HTML doc, preserve its original HTML blocks on getHTML().
      editor.commands.setHtmlBaseline(isHtmlFile(file) ? file.content : null);
      // (Re)mount: restore this file's remembered scroll, or top if unseen.
      restoreScrollTop(scrollAreaRef.current, scrollPositions.get(file.id) ?? 0);
      return;
    }

    debouncedSave.cancel();
    setDirty(false);
    setIsEditing(file.id.startsWith(TRANSIENT_ID_PREFIX));
    setActivationIntent(undefined);
    appliedActivationIntentRef.current = undefined;
    isFileSwitchingRef.current = true;
    setIsSwitching(true);

    // Capture the rAF handle so a rapid A→B→C switch can cancel an inflight
    // rAF from the previous swap. Without this, a stale rAF can land between
    // the new swap's `setIsSwitching(true)` commit and its `setContent`,
    // clearing the overlay during the new swap and letting `editor.emit`
    // leak past the `isFileSwitchingRef` guard in `onUpdate`.
    let rafId: number | undefined;
    const timeoutId = setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domObserver is internal ProseMirror API
      const domObserver = (editor.view as any).domObserver;
      domObserver?.stop();

      perfSync(
        "doxmind.editor.setContent",
        () => editor.commands.setContent(file.content, { emitUpdate: false }),
        { bytes: file.content?.length ?? 0, branch: "fileSwitch" }
      );
      lastContentRef.current = editor.getHTML();
      prevDbIdsRef.current = extractDatabaseIds(file.content, "fileSwitch");
      editor.commands.setSourceBaseline(file.contentMarkdown ?? null);
      // #139: for an HTML doc, preserve its original HTML blocks on getHTML().
      editor.commands.setHtmlBaseline(isHtmlFile(file) ? file.content : null);
      editor.emit("update", { editor, transaction: editor.state.tr, appendedTransactions: [] });

      domObserver?.start();

      // Restore this file's remembered scroll position, or start at the top
      // for a file we haven't shown before. restoreScrollTop re-applies across
      // a couple of frames so it survives post-setContent layout settling.
      restoreScrollTop(scrollAreaRef.current, scrollPositions.get(file.id) ?? 0);

      rafId = requestAnimationFrame(() => {
        rafId = undefined;
        isFileSwitchingRef.current = false;
        setIsSwitching(false);
        if (typeof window !== "undefined") {
          const startMark = window.__doxmindSwitchStartMark;
          const fileIdAtStart = window.__doxmindSwitchFileId;
          if (startMark && fileIdAtStart === file.id) {
            perfMeasure("doxmind.switch.firstPaint", startMark, undefined, {
              fileId: file.id,
              documentType: "markdown",
            });
            window.__doxmindSwitchStartMark = undefined;
            window.__doxmindSwitchFileId = undefined;
          }
        }
      });
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      isFileSwitchingRef.current = false;
      setIsSwitching(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset on file.id change, not content
  }, [file.id, editor]);

  // Late-content / external-edit reconcile.
  useEffect(() => {
    if (!editor) return;
    // A file switch is handled by the effect above, which banks/restores the
    // per-file scroll position. Bail during a switch so this reconcile doesn't
    // re-apply the previous file's scrollTop (the cross-file scroll leak).
    if (isFileSwitchingRef.current) return;
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
    const preservedScrollTop = scrollAreaRef.current?.scrollTop ?? 0;
    const timeoutId = setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domObserver is internal ProseMirror API
      const domObserver = (editor.view as any).domObserver;
      domObserver?.stop();

      perfSync(
        "doxmind.editor.setContent",
        () => editor.commands.setContent(file.content, { emitUpdate: false }),
        { bytes: file.content?.length ?? 0, branch: "lateContent" }
      );
      lastContentRef.current = editor.getHTML();
      editor.commands.setSourceBaseline(file.contentMarkdown ?? null);
      // #139: for an HTML doc, preserve its original HTML blocks on getHTML().
      editor.commands.setHtmlBaseline(isHtmlFile(file) ? file.content : null);
      editor.emit("update", { editor, transaction: editor.state.tr, appendedTransactions: [] });

      domObserver?.start();

      if (scrollAreaRef.current) {
        if (isEmpty) {
          scrollAreaRef.current.scrollTop = 0;
        } else {
          scrollAreaRef.current.scrollTop = preservedScrollTop;
        }
      }

      requestAnimationFrame(() => {
        isFileSwitchingRef.current = false;
      });
    }, 0);
    return () => {
      clearTimeout(timeoutId);
      isFileSwitchingRef.current = false;
    };
  }, [file.content, editor]);

  // Apply a pending edit-activation intent (replay the printable key the
  // user pressed in read mode that triggered the mode switch).
  useEffect(() => {
    if (!editor || !activationIntent || appliedActivationIntentRef.current === activationIntent) {
      return;
    }
    if (!isEditing) return;

    appliedActivationIntentRef.current = activationIntent;
    applyActivationIntent(editor.view, activationIntent, scrollAreaRef.current);
  }, [activationIntent, editor, isEditing]);

  useEffect(() => {
    if (!editor || typeof window === "undefined") return;
    const startMark = window.__doxmindEditorActivationStartMark;
    const fileIdAtStart = window.__doxmindEditorActivationFileId;
    if (!startMark || fileIdAtStart !== file.id) return;
    const frame = requestAnimationFrame(() => {
      perfMeasure("doxmind.editor.activation.firstPaint", startMark, undefined, {
        fileId: file.id,
        documentType: "markdown",
        runtime: "markdown-runtime",
      });
      window.__doxmindEditorActivationStartMark = undefined;
      window.__doxmindEditorActivationFileId = undefined;
    });
    return () => cancelAnimationFrame(frame);
  }, [editor, file.id]);

  useBlockKeyboardShortcuts(editor);

  const activateEdit = useCallback(
    (intent?: EditActivationIntent) => {
      if (!editor || isEditing) return;
      const startMark = `doxmind.editor.activation.start:${file.id}:${performance.now()}`;
      perfMark(startMark);
      if (typeof window !== "undefined") {
        window.__doxmindEditorActivationStartMark = startMark;
        window.__doxmindEditorActivationFileId = file.id;
      }
      setActivationIntent(intent);
      setIsEditing(true);
    },
    [editor, file.id, isEditing]
  );

  // Keyboard edit-activation: in read mode, a printable key (or Enter /
  // Backspace / Delete / Space / "/") switches to edit mode and replays
  // the key. Skip when focus is in an editable field outside the document.
  useEffect(() => {
    if (isEditing) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEventFromEditableElement(event.target)) return;
      const intent = getKeyboardEditIntent(event);
      if (!intent) return;
      event.preventDefault();
      activateEdit(intent);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activateEdit, isEditing]);

  const pageFrameStyle = {
    "--editor-outline-gutter": `${reservedRightInset}px`,
  } as CSSProperties;

  // Click anywhere inside the content frame (read mode) → activate edit
  // mode and place caret near the click point. In edit mode, the same
  // handler delegates to focusTrailingParagraph when the click lands in
  // whitespace below the last block.
  const handleContentMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!editor || event.button !== 0) return;
      const target = event.target as Node | null;
      if (!target) return;
      if (isEventFromInteractiveElement(target)) return;

      if (!isEditing) {
        event.preventDefault();
        event.stopPropagation();
        activateEdit({
          type: "pointer",
          clientX: event.clientX,
          clientY: event.clientY,
        });
        return;
      }

      const editorDom = editor.view.dom;
      if (editorDom.contains(target)) return;

      const editorRect = editorDom.getBoundingClientRect();
      const wrapperRect = event.currentTarget.getBoundingClientRect();
      const isInsideEditorColumn =
        event.clientX >= wrapperRect.left && event.clientX <= wrapperRect.right;
      const isBelowEditorContent = event.clientY > editorRect.bottom;

      if (!isInsideEditorColumn || !isBelowEditorContent) return;

      event.preventDefault();
      focusTrailingParagraph(editor.view);
    },
    [editor, isEditing, activateEdit]
  );

  // Persist the current file's scroll position on the way out — this effect's
  // cleanup runs both on a hot switch (file.id changes, runtime reused) and on
  // unmount (the workspace tears the runtime down behind a loading skeleton).
  // We read scrollTop directly rather than listening for scroll events, which
  // don't fire for programmatic scrolls in the embedded webview, and capture
  // the element at setup so the cleanup still has it during DOM teardown.
  useLayoutEffect(() => {
    // `editor` is a dep so this re-runs once the editor is ready and the
    // ScrollArea is actually mounted (the early `if (!editor)` return means the
    // ref is null on the first pass). Capturing the element here — rather than
    // reading scrollAreaRef.current in the cleanup — keeps the reference stable
    // through the hot-switch/unmount teardown, when React nulls the ref.
    const scrollEl = scrollAreaRef.current;
    const fileId = file.id;
    return () => {
      if (scrollEl) scrollPositions.set(fileId, scrollEl.scrollTop);
    };
  }, [file.id, editor]);

  if (!editor) {
    return <MarkdownSkeleton file={{ name: file.name, outline: file.outline }} />;
  }

  return (
    <div className="flex h-full flex-col" data-testid="markdown-runtime">
      <div className="flex min-h-0 min-w-0 flex-1 overflow-x-hidden">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ScrollArea
            ref={scrollAreaRef}
            className="min-h-0 flex-1"
            data-editor-scroll
            onMouseDown={handleContentMouseDown}
          >
            {/* Reserve the floating header's height so the title clears the
                opaque chrome above the editor. */}
            <div aria-hidden className="h-11 shrink-0" />
            <div
              className={cn(
                "editor-page-frame relative",
                lineHeight === "compact" && "editor-leading-compact",
                lineHeight === "relaxed" && "editor-leading-relaxed"
              )}
              style={pageFrameStyle}
            >
              <DocumentTitle />
              <div className="relative">
                <EditorContent editor={editor} />
                <AnimatePresence>
                  {isSwitching && (
                    <motion.div
                      className="pointer-events-none absolute inset-0 bg-background"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                      aria-hidden="true"
                      data-testid="markdown-switch-overlay"
                    >
                      {/* DocumentTitle is already painted outside the overlay,
                          so skip the skeleton's own title row. The overlay
                          feeds the same cached outline that the page-level
                          loader uses, so hot-switching to a previously-seen
                          doc shows its real heading text immediately. */}
                      <MarkdownSkeletonContent file={{ name: file.name, outline: file.outline }} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </ScrollArea>
          <SearchBar />
          <StatusBar editor={editor} />
        </div>
      </div>

      {/* Floating edit-mode chrome — mounted only when editing so it
          doesn't fight pointer events or paint over the read surface. */}
      {isEditing && (
        <>
          <BlockHandle editor={editor} />
          <TableHandles editor={editor} />
          <BubbleMenuComponent editor={editor} />
          <LinkBubbleMenu editor={editor} />
          <EditorContextMenu editor={editor} />
          <PagePickerPopover />
        </>
      )}
    </div>
  );
}

/* ─── Helpers (mirror of Editor.tsx) ──────────────────── */

function extractDatabaseIdsRaw(content: string): Set<string> {
  const ids = new Set<string>();
  const re = /(?:data-database-id="([a-f0-9-]+)"|<!-- database:([a-f0-9-]+) -->)/g;
  let m;
  while ((m = re.exec(content)) !== null) ids.add(m[1] || m[2]);
  return ids;
}

function extractDatabaseIds(content: string, callsite: string): Set<string> {
  return perfSync(
    `doxmind.editor.extractDatabaseIds.${callsite}`,
    () => extractDatabaseIdsRaw(content),
    { bytes: content.length }
  );
}

function focusTrailingParagraph(view: EditorView): boolean {
  const { state, dispatch } = view;
  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph) return false;

  const { doc } = state;
  const lastChild = doc.lastChild;
  let tr = state.tr;
  let selectionPos: number;

  if (lastChild?.type === paragraph && lastChild.content.size === 0) {
    const lastStart = doc.content.size - lastChild.nodeSize;
    selectionPos = lastStart + 1;
  } else {
    const insertPos = doc.content.size;
    tr = tr.insert(insertPos, paragraph.create());
    selectionPos = insertPos + 1;
  }

  dispatch(tr.setSelection(TextSelection.create(tr.doc, selectionPos)).scrollIntoView());
  view.focus();
  return true;
}

function applyActivationIntent(
  view: EditorView,
  intent: EditActivationIntent,
  scrollParent: HTMLElement | null
) {
  const preservedScrollTop = scrollParent?.scrollTop ?? null;

  if (intent.type === "pointer") {
    const pos = view.posAtCoords({ left: intent.clientX, top: intent.clientY });
    const selectionPos = pos?.pos ?? getVisibleCaretPosition(view, scrollParent);
    if (selectionPos !== undefined) {
      setTextSelectionNear(view, selectionPos);
    }
    view.focus();
    restoreScrollTop(scrollParent, preservedScrollTop);
    return;
  }

  const replayText = getReplayableKeyboardText(intent.key);
  const pos = getVisibleCaretPosition(view, scrollParent) ?? view.state.selection.from;
  setTextSelectionNear(view, pos);

  if (replayText) {
    const { state, dispatch } = view;
    dispatch(state.tr.insertText(replayText));
  }
  view.focus();
  restoreScrollTop(scrollParent, preservedScrollTop);
}

function setTextSelectionNear(view: EditorView, pos: number) {
  const { state, dispatch } = view;
  const clamped = Math.max(0, Math.min(pos, state.doc.content.size));
  dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(clamped))));
}

function getVisibleCaretPosition(view: EditorView, scrollParent: HTMLElement | null) {
  const scrollRect = scrollParent?.getBoundingClientRect();
  const editorRect = view.dom.getBoundingClientRect();
  const top = scrollRect ? scrollRect.top + Math.min(140, scrollRect.height / 3) : editorRect.top;
  const left = editorRect.left + 12;
  return view.posAtCoords({ left, top })?.pos;
}

function getReplayableKeyboardText(key: string) {
  return key.length === 1 ? key : null;
}

function restoreScrollTop(scrollParent: HTMLElement | null, scrollTop: number | null) {
  if (!scrollParent || scrollTop === null) return;
  scrollParent.scrollTop = scrollTop;
  if (typeof requestAnimationFrame !== "function") return;
  requestAnimationFrame(() => {
    scrollParent.scrollTop = scrollTop;
    requestAnimationFrame(() => {
      scrollParent.scrollTop = scrollTop;
    });
  });
}

function exitTextBlockContainerAtEnd(
  view: EditorView,
  containerName: string,
  options: { exitOnNonEmptyEnd?: boolean } = {}
): boolean {
  const { state, dispatch } = view;
  const { selection } = state;
  const paragraph = state.schema.nodes.paragraph;
  if (!selection.empty || !paragraph) return false;

  const { $from } = selection;
  const parent = $from.parent;
  const shouldExitNonEmpty = options.exitOnNonEmptyEnd ?? false;
  const isEmptyParagraph = parent.content.size === 0;

  if (
    parent.type.name !== "paragraph" ||
    $from.parentOffset !== parent.content.size ||
    (!isEmptyParagraph && !shouldExitNonEmpty)
  ) {
    return false;
  }

  let containerDepth = 0;
  for (let depth = $from.depth - 1; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === containerName) {
      containerDepth = depth;
      break;
    }
  }

  if (
    containerDepth === 0 ||
    $from.indexAfter(containerDepth) !== $from.node(containerDepth).childCount
  ) {
    return false;
  }

  const containerNode = $from.node(containerDepth);
  const containerStart = $from.before(containerDepth);
  const containerEnd = $from.after(containerDepth);

  if (isEmptyParagraph && containerNode.childCount === 1) {
    const tr = state.tr.replaceWith(containerStart, containerEnd, paragraph.create());
    dispatch(tr.setSelection(TextSelection.create(tr.doc, containerStart + 1)).scrollIntoView());
    return true;
  }

  if (isEmptyParagraph) {
    const tr = state.tr.delete($from.before(), $from.after());
    const insertPos = tr.mapping.map(containerEnd);
    tr.insert(insertPos, paragraph.create());
    dispatch(tr.setSelection(TextSelection.create(tr.doc, insertPos + 1)).scrollIntoView());
    return true;
  }

  const tr = state.tr.insert(containerEnd, paragraph.create());
  dispatch(tr.setSelection(TextSelection.create(tr.doc, containerEnd + 1)).scrollIntoView());
  return true;
}

function getKeyboardEditIntent(event: KeyboardEvent): EditActivationIntent | null {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  ) {
    return null;
  }
  if (event.key === "Enter" || event.key === "Backspace" || event.key === "Delete") {
    return { type: "keyboard", key: event.key };
  }
  if (event.key === "/" || event.key === " ") return { type: "keyboard", key: event.key };
  return event.key.length === 1 ? { type: "keyboard", key: event.key } : null;
}

function isEventFromEditableElement(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return !!target.closest('input,textarea,select,[contenteditable="true"]');
}

function isEventFromInteractiveElement(target: Node | null) {
  if (!(target instanceof Element)) {
    const parent = target?.parentElement;
    if (!parent) return false;
    return !!parent.closest(
      'a,button,input,textarea,select,[role="button"],[contenteditable="true"]'
    );
  }
  return !!target.closest(
    'a,button,input,textarea,select,[role="button"],[contenteditable="true"]'
  );
}
