"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { useCallback, useEffect, useRef } from "react";
import { BubbleMenuComponent } from "./bubble-menu";
import { LinkBubbleMenu } from "./link-bubble-menu";

import { ImageModal } from "./image-modal";
import { SpellcheckPopup } from "./spellcheck-popup";
import { InlineAICopilot } from "@/components/ai/inline-ai-copilot";
import { EditorContextMenu } from "./editor-context-menu";
import { DiffReviewToolbar } from "./diff-review-toolbar";
import { AIWorkingBar } from "./ai-working-bar";
import { ReviewPopup } from "./review-popup";
import { ReviewPanel } from "./review-panel";
import { SearchBar } from "./search-bar";
import { StatusBar } from "./status-bar";
import { DocumentTitle } from "./document-title";
import { useIsMobile } from "@/hooks/use-device-type";
import { getReviewState } from "@/extensions/text-review-extension";
import { useAutocomplete } from "@/hooks/use-autocomplete";
import { useSpellcheck } from "@/hooks/use-spellcheck";
import { useTextReview } from "@/hooks/use-text-review";
import { useMockTextReview } from "@/hooks/use-mock-text-review";
import { useDiffReview } from "@/hooks/use-diff-review";
import { useEditorShortcuts } from "@/hooks/use-editor-shortcuts";
import { useBlockKeyboardShortcuts } from "@/hooks/use-block-keyboard-shortcuts";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { useDemoStore } from "@/stores/demo-store";
import { useEditorStore, type LastAIOperation } from "@/stores/editor-store";
import { useLayoutStore } from "@/stores/layout-store";
import { telemetry, type UndoAfterAIEvent } from "@/lib/telemetry";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { cn, debounce } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getEditorExtensions, defaultEditorProps } from "./editor-extensions";
import { BlockHandle } from "./block-handle";
import { TableHandles } from "./table-handles";
import { applyPendingEdit } from "./editor-edit-operations";
import { EDITOR_DEBOUNCE_DELAY } from "@/lib/constants";
import { rangeToMarkdown } from "@/lib/markdown-selection";
import { useStreamingStore } from "@/stores/streaming-store";
import { useDiffReviewStore } from "@/stores/diff-review-store";

interface EditorProps {
  file: FileItem;
  isDemoMode?: boolean;
}

export function Editor({ file: initialFile, isDemoMode = false }: EditorProps) {
  // Subscribe directly to file store to get real-time updates (for AI edits)
  const { updateFile, files } = useFileStore();
  const { updateDemoContent, demoFile } = useDemoStore();
  // In demo mode, use demoFile; otherwise use file from store
  const file = isDemoMode
    ? demoFile || initialFile
    : files.find((f) => f.id === initialFile.id) || initialFile;
  const {
    setDirty,
    setSelection,
    setSaving,
    setLastSavedAt,
    pendingEdits,
    clearPendingEdit,
    imageModalOpen,
    imageModalCallback,
    closeImageModal,
    isReviewPanelOpen,
    setReviewPanelOpen,
    lastAIOperation,
    clearLastAIOperation,
    spellcheckEnabled,
    reviewRequested,
    clearReviewRequest,
    setReviewState,
    openInlineAI,
    closeInlineAI,
    inlineAIOpen,
  } = useEditorStore();

  // Layout state — use individual selectors to avoid re-renders on unrelated layout changes
  const editorWidth = useLayoutStore((s) => s.editorWidth);
  const fontFamily = useLayoutStore((s) => s.fontFamily);
  const fontSize = useLayoutStore((s) => s.fontSize);
  const lineHeight = useLayoutStore((s) => s.lineHeight);

  const isMobile = useIsMobile();
  const lastContentRef = useRef(file.content);
  const isFileSwitchingRef = useRef(false);
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

      if (isDemoMode) {
        // Demo mode: only update in-memory state, no API calls
        updateDemoContent(content);
        setDirty(false);
        lastContentRef.current = content;
      } else {
        // Normal mode: persist to server (with pre-computed markdown from editor.getMarkdown())
        setSaving(true);
        updateFile(file.id, { content, contentMarkdown });
        setSaving(false);
        setLastSavedAt(new Date().toISOString());
        setDirty(false);
        lastContentRef.current = content;
      }
    }, EDITOR_DEBOUNCE_DELAY),
    [file.id, updateFile, updateDemoContent, isDemoMode, setSaving, setLastSavedAt, setDirty]
  );

  const editor = useEditor({
    extensions: getEditorExtensions({ isMobile }),
    content: file.content,
    editorProps: {
      ...defaultEditorProps,
      attributes: {
        ...(defaultEditorProps.attributes || {}),
        "data-inline-ai-boundary": "true",
      },
      handleKeyDown: (view, event) => {
        if (event.isComposing) return false;

        const buildInlineReference = (from: number, to: number) => {
          const safeFrom = Math.max(0, from);
          const safeTo = Math.max(safeFrom, to);
          const beforeStart = Math.max(0, safeFrom - 220);
          const afterEnd = Math.min(view.state.doc.content.size, safeTo + 220);
          return {
            from: safeFrom,
            to: safeTo,
            beforeText: view.state.doc.textBetween(beforeStart, safeFrom, "\n", "\n").slice(-220),
            afterText: view.state.doc.textBetween(safeTo, afterEnd, "\n", "\n").slice(0, 220),
          };
        };

        const isModJ =
          (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "j";
        if (isModJ) {
          event.preventDefault();
          const { from, to, empty } = view.state.selection;
          const coords = view.coordsAtPos(to);
          const domSelection = window.getSelection();
          const range =
            domSelection && domSelection.rangeCount > 0 ? domSelection.getRangeAt(0) : null;
          const rect = range && !range.collapsed ? range.getBoundingClientRect() : null;
          openInlineAI(
            { x: coords.left, y: coords.bottom },
            empty || from === to ? "ask" : "edit",
            buildInlineReference(from, to),
            rect ? { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right } : null
          );
          return true;
        }

        if (!isMobile && !event.repeat && event.key === " " && !event.shiftKey && !event.altKey) {
          const { selection } = view.state;
          if (!selection.empty) return false;

          const { $from } = selection;
          const parent = $from.parent;
          const isEmptyParagraph =
            parent.type.name === "paragraph" && parent.textContent.trim() === "";
          const isParagraphStart = $from.parentOffset === 0;

          if (isEmptyParagraph && isParagraphStart) {
            event.preventDefault();
            const coords = view.coordsAtPos(selection.from);
            openInlineAI(
              { x: coords.left, y: coords.bottom },
              "write",
              buildInlineReference(selection.from, selection.to)
            );
            return true;
          }
        }

        if (event.key === "Escape") {
          closeInlineAI();
        }

        return false;
      },
    },
    editable: !isDemoMode, // Demo mode: read-only to ensure mock scenarios work
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

  // Flush pending save on page unload to prevent false "unsaved changes" warnings
  // and ensure content is persisted before the page closes
  useEffect(() => {
    const handleBeforeUnload = () => {
      debouncedSave.flush();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [debouncedSave]);

  // Block selection is desktop-only; mobile always uses direct editing (Notion-style)
  useEffect(() => {
    if (editor && editor.commands.setBlockSelectionEnabled) {
      editor.commands.setBlockSelectionEnabled(!isMobile);
    }
  }, [editor, isMobile]);

  // Sync editable state with isDemoMode
  // Demo mode: read-only to ensure mock scenarios work correctly
  useEffect(() => {
    if (editor) {
      editor.setEditable(!isDemoMode);
    }
  }, [editor, isDemoMode]);

  // Lock editor to read-only during AI streaming to prevent position mismatches
  const isStreaming = useStreamingStore((s) => s.isStreaming);
  useEffect(() => {
    if (!editor || isDemoMode) return;
    if (isStreaming) {
      editor.setEditable(false);
    } else {
      // Only restore editability if not in diff review mode
      const isInDiffReview = useDiffReviewStore.getState().isReviewMode;
      if (!isInDiffReview) {
        editor.setEditable(true);
      }
    }
  }, [editor, isStreaming, isDemoMode]);

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

  // Sync editor when file content arrives late (e.g., after fork redirect).
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

  // Apply pending edits from AI through the editor's transaction system
  useEffect(() => {
    if (!editor) return;

    const editsForThisFile = pendingEdits.filter((e) => e.fileId === file.id);
    if (editsForThisFile.length === 0) return;

    for (const edit of editsForThisFile) {
      try {
        applyPendingEdit(editor, edit);
        clearPendingEdit(edit.id);
      } catch (error) {
        console.error(`[Editor] Failed to apply edit ${edit.id}:`, error);
        clearPendingEdit(edit.id);
      }
    }
  }, [editor, pendingEdits, file.id, clearPendingEdit]);

  // Initialize hooks
  // Disable autocomplete on mobile - it interferes with touch input
  useAutocomplete({ editor, fileId: file.id, fileName: file.name, enabled: !isMobile });
  useSpellcheck({ editor, enabled: spellcheckEnabled && !isMobile });
  useBlockKeyboardShortcuts(!isMobile ? editor : null);

  // Use mock text review in demo mode, real API otherwise
  const realTextReview = useTextReview({
    editor,
    fileId: file.id,
    onReviewStart: () => setReviewPanelOpen(true),
  });
  const mockTextReview = useMockTextReview({
    editor,
    fileId: file.id,
    onReviewStart: () => setReviewPanelOpen(true),
  });
  const { triggerReview, clearReview } = isDemoMode ? mockTextReview : realTextReview;

  // Get review state for toolbar
  const reviewState = getReviewState(editor);
  const isReviewLoading = reviewState?.isLoading ?? false;
  const isReviewActive = reviewState?.isActive ?? false;

  // Use diff review hook
  const {
    isReviewMode,
    pendingCount,
    currentPendingPosition,
    handleAcceptAll,
    handleRejectAll,
    handleNextHunk,
    handlePreviousHunk,
  } = useDiffReview({
    editor,
    fileId: file.id,
  });

  // Use keyboard shortcuts hook (Ctrl+Shift+O for outline)
  useEditorShortcuts();

  // Track undo after AI operations
  // We use a ref to store the last AI operation to avoid stale closure issues
  const lastAIOperationRef = useRef<LastAIOperation | null>(null);
  useEffect(() => {
    lastAIOperationRef.current = lastAIOperation;
  }, [lastAIOperation]);

  useEffect(() => {
    if (!editor) return;

    const UNDO_TRACKING_WINDOW_MS = 10000; // 10 seconds

    // Listen for transactions to detect undo operations
    const handleTransaction = ({
      transaction,
    }: {
      transaction: { getMeta: (key: string) => unknown };
    }) => {
      // Check if this is an undo operation from the history plugin
      const historyMeta = transaction.getMeta("history$");
      if (
        historyMeta &&
        typeof historyMeta === "object" &&
        "redo" in historyMeta &&
        !historyMeta.redo
      ) {
        // This is an undo operation
        const lastOp = lastAIOperationRef.current;
        if (lastOp && Date.now() - lastOp.timestamp < UNDO_TRACKING_WINDOW_MS) {
          // Track undo after AI event
          telemetry.track<UndoAfterAIEvent>({
            event_type: "undo_after_ai",
            ai_operation_type: lastOp.type,
            time_to_undo_ms: Date.now() - lastOp.timestamp,
          });
          // Clear the last AI operation after tracking
          clearLastAIOperation();
        }
      }
    };

    editor.on("transaction", handleTransaction);
    return () => {
      editor.off("transaction", handleTransaction);
    };
  }, [editor, clearLastAIOperation]);

  // Handle Review button click
  const handleReviewClick = useCallback(() => {
    if (isReviewActive) {
      setReviewPanelOpen(!isReviewPanelOpen);
    } else {
      triggerReview();
    }
  }, [isReviewActive, isReviewPanelOpen, setReviewPanelOpen, triggerReview]);

  // Sync review state to store (so header can read it)
  useEffect(() => {
    setReviewState(isReviewLoading, isReviewActive);
  }, [isReviewLoading, isReviewActive, setReviewState]);

  // Watch for review requests from header
  useEffect(() => {
    if (reviewRequested && editor) {
      clearReviewRequest();
      handleReviewClick();
    }
  }, [reviewRequested, editor, clearReviewRequest, handleReviewClick]);

  // Handle closing the review panel
  const handleReviewPanelClose = useCallback(() => {
    setReviewPanelOpen(false);
    if (!isReviewActive) {
      clearReview();
    }
  }, [setReviewPanelOpen, isReviewActive, clearReview]);

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

  if (!editor) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading editor...</div>
      </div>
    );
  }

  return (
    <div
      className={cn("flex flex-col", !isMobile && "h-full")}
      data-streaming={isStreaming || undefined}
    >
      {/* AI Working indicator - shown during streaming before diff review */}
      <AIWorkingBar isActive={isStreaming && !isReviewMode} />

      {/* Diff Review Toolbar - shown on both desktop and mobile when active */}
      <DiffReviewToolbar
        editor={editor}
        isActive={isReviewMode && !inlineAIOpen}
        pendingCount={pendingCount}
        currentPendingPosition={currentPendingPosition}
        onAcceptAll={handleAcceptAll}
        onRejectAll={handleRejectAll}
        onNextHunk={handleNextHunk}
        onPreviousHunk={handlePreviousHunk}
      />

      <div className={cn("flex min-w-0 overflow-x-hidden", !isMobile && "min-h-0 flex-1")}>
        {/* Main editor content area */}
        <div
          className={cn(
            "relative flex min-w-0 flex-col overflow-hidden",
            !isMobile && "min-h-0 flex-1"
          )}
        >
          {/* Demo mode indicator */}
          {isDemoMode && (
            <div className="flex items-center justify-center gap-2 border-b border-border bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
              <span className="inline-block h-2 w-2 rounded-full bg-yellow-500" />
              <span>Demo Mode - Use the AI actions to see changes. Editor is read-only.</span>
            </div>
          )}
          {/* On mobile, parent MobileEditorLayout handles scrolling, so skip ScrollArea entirely */}
          {isMobile ? (
            <div
              className={cn(
                "mx-auto w-full max-w-full px-4 pb-24 pt-0 sm:max-w-4xl",
                "mobile-edit-mode", // Always edit mode on mobile (Notion-style)
                // Typography settings
                fontFamily === "serif" && "editor-font-serif",
                fontFamily === "mono" && "editor-font-mono",
                fontSize === "small" && "editor-font-small",
                fontSize === "large" && "editor-font-large",
                lineHeight === "compact" && "editor-leading-compact",
                lineHeight === "relaxed" && "editor-leading-relaxed"
              )}
            >
              <EditorContent editor={editor} />
            </div>
          ) : (
            <ScrollArea className="min-h-0 flex-1" data-editor-scroll>
              <div
                className={cn(
                  "relative mx-auto px-6 pb-4 pt-2 md:px-12 md:py-8",
                  editorWidth === "narrow" && "max-w-2xl",
                  editorWidth === "normal" && "max-w-4xl",
                  editorWidth === "wide" && "max-w-6xl",
                  editorWidth === "full" && "max-w-none",
                  // Typography settings
                  fontFamily === "serif" && "editor-font-serif",
                  fontFamily === "mono" && "editor-font-mono",
                  fontSize === "small" && "editor-font-small",
                  fontSize === "large" && "editor-font-large",
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
        {/* Review Panel Sidebar - hidden on mobile */}
        {!isMobile && isReviewPanelOpen && (
          <ReviewPanel
            editor={editor}
            isOpen={isReviewPanelOpen}
            onClose={handleReviewPanelClose}
          />
        )}
      </div>

      {/* Block Handle - Desktop only (+ button and drag grip in left margin) */}
      {!isMobile && editor && <BlockHandle editor={editor} />}
      {/* Table Handles - Desktop only (column/row grips and edge + buttons) */}
      {!isMobile && editor && <TableHandles editor={editor} />}
      {!isMobile && editor && <InlineAICopilot fileId={file.id} isDemoMode={isDemoMode} />}

      {/* Bubble Menus & Popups */}
      {/* Mobile shows simplified BubbleMenu; desktop shows full menus */}
      {/* Mobile uses MobileFormattingToolbar instead — BubbleMenu conflicts with native selection handles */}
      {!isMobile && <BubbleMenuComponent editor={editor} />}
      {!isMobile && (
        <>
          <LinkBubbleMenu editor={editor} />

          <SpellcheckPopup editor={editor} />
          <ReviewPopup editor={editor} />
          <EditorContextMenu editor={editor} />
        </>
      )}

      {/* Modals */}
      <ImageModal
        open={imageModalOpen}
        onClose={closeImageModal}
        onConfirm={handleImageModalConfirm}
      />
    </div>
  );
}
