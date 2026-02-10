"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { useCallback, useEffect, useRef } from "react";
import { EditorToolbar } from "./editor-toolbar";
import { BubbleMenuComponent } from "./bubble-menu";
import { LinkBubbleMenu } from "./link-bubble-menu";
import { TableBubbleMenu } from "./table-bubble-menu";
import { ImageBubbleMenu } from "./image-bubble-menu";
import { ImageModal } from "./image-modal";
import { SpellcheckPopup } from "./spellcheck-popup";
import { QuickEditMenu } from "@/components/ai/quick-edit-menu";
import { DiffReviewToolbar } from "./diff-review-toolbar";
import { ReviewPopup } from "./review-popup";
import { ReviewPanel } from "./review-panel";
import { SearchBar } from "./search-bar";
import { Mindlines, OutlineToggle, useHeadings } from "./mindlines";
import { useIsMobile } from "@/hooks/use-device-type";
import { getReviewState } from "@/extensions/text-review-extension";
import { useAutocomplete } from "@/hooks/use-autocomplete";
import { useSpellcheck } from "@/hooks/use-spellcheck";
import { useTextReview } from "@/hooks/use-text-review";
import { useMockTextReview } from "@/hooks/use-mock-text-review";
import { useDiffReview } from "@/hooks/use-diff-review";
import { useEditorShortcuts } from "@/hooks/use-editor-shortcuts";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { useDemoStore } from "@/stores/demo-store";
import { useEditorStore, type LastAIOperation } from "@/stores/editor-store";
import { useLayoutStore } from "@/stores/layout-store";
import { telemetry, type UndoAfterAIEvent } from "@/lib/telemetry";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { cn, debounce } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getEditorExtensions, defaultEditorProps } from "./editor-extensions";
import { applyPendingEdit } from "./editor-edit-operations";
import { EDITOR_DEBOUNCE_DELAY } from "@/lib/constants";

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
  } = useEditorStore();

  // Search bar state
  const { isSearchBarOpen, toggleSearchBar } = useLayoutStore();

  const isMobile = useIsMobile();
  const lastContentRef = useRef(file.content);

  // Debounced save function
  // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce returns a new function, deps are intentionally limited
  const debouncedSave = useCallback(
    debounce((content: string) => {
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
        // Normal mode: persist to server
        setSaving(true);
        updateFile(file.id, { content });
        setSaving(false);
        setLastSavedAt(new Date().toISOString());
        setDirty(false);
        lastContentRef.current = content;
      }
    }, EDITOR_DEBOUNCE_DELAY),
    [file.id, updateFile, updateDemoContent, isDemoMode, setSaving, setLastSavedAt, setDirty]
  );

  const editor = useEditor({
    extensions: getEditorExtensions({ enableBlockSelection: isMobile, isMobile }),
    content: file.content,
    editorProps: defaultEditorProps,
    editable: !isDemoMode, // Demo mode: read-only to ensure mock scenarios work
    immediatelyRender: false, // Prevent SSR hydration mismatch
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      setDirty(true);
      debouncedSave(html);
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      const text = editor.state.doc.textBetween(from, to, " ");
      if (text) {
        setSelection({ from, to, text });
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

  // Sync block selection enabled state with isMobile and edit mode
  // Block selection is active on mobile UNLESS edit mode is toggled on
  const { isMobileEditMode } = useLayoutStore();
  useEffect(() => {
    if (editor && editor.commands.setBlockSelectionEnabled) {
      editor.commands.setBlockSelectionEnabled(isMobile && !isMobileEditMode);
    }
  }, [editor, isMobile, isMobileEditMode]);

  // Sync editable state with isDemoMode
  // Demo mode: read-only to ensure mock scenarios work correctly
  useEffect(() => {
    if (editor) {
      editor.setEditable(!isDemoMode);
    }
  }, [editor, isDemoMode]);

  // Reset when file changes
  useEffect(() => {
    if (editor) {
      // Cancel any pending debounced save from the previous file to prevent
      // stale saves that would unnecessarily update the old file's updatedAt
      debouncedSave.cancel();
      queueMicrotask(() => {
        editor.commands.setContent(file.content, false);
        // Use editor.getHTML() (TipTap-normalized) rather than raw file.content
        // to prevent false-positive change detection in debouncedSave.
        // TipTap may normalize HTML during parse/serialize (attribute order,
        // whitespace, etc.), so raw stored HTML can differ from getHTML() output
        // even when content is semantically identical.
        lastContentRef.current = editor.getHTML();
        editor.emit("update", { editor, transaction: editor.state.tr });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset on file.id change, not content
  }, [file.id, editor]);

  // Apply pending edits from AI through the editor's transaction system
  useEffect(() => {
    if (!editor) return;

    const editsForThisFile = pendingEdits.filter((e) => e.fileId === file.id);
    if (editsForThisFile.length === 0) return;

    const currentEditorContent = editor.getHTML();

    for (const edit of editsForThisFile) {
      try {
        applyPendingEdit(editor, edit, currentEditorContent);
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
  const { headings } = useHeadings(editor);

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

  // Handle closing the review panel
  const handleReviewPanelClose = useCallback(() => {
    setReviewPanelOpen(false);
    if (!isReviewActive) {
      clearReview();
    }
  }, [setReviewPanelOpen, isReviewActive, clearReview]);

  // Handle Quick Edit apply
  const handleQuickEditApply = useCallback(
    (newText: string, savedSelection: { from: number; to: number }) => {
      if (!editor) return;
      editor
        .chain()
        .focus()
        .setTextSelection({ from: savedSelection.from, to: savedSelection.to })
        .insertContent(newText)
        .run();
    },
    [editor]
  );

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
    <div className={cn("flex flex-col", !isMobile && "h-full")}>
      {/* Desktop Toolbar - hidden on mobile (mobile uses block-based voice interactions) */}
      {!isMobile && (
        <EditorToolbar
          editor={editor}
          onSearchClick={toggleSearchBar}
          onReviewClick={handleReviewClick}
          isReviewLoading={isReviewLoading}
          isReviewActive={isReviewActive}
          isSearchActive={isSearchBarOpen}
        />
      )}

      {/* Diff Review Toolbar - shown on both desktop and mobile when active */}
      <DiffReviewToolbar
        editor={editor}
        isActive={isReviewMode}
        pendingCount={pendingCount}
        currentPendingPosition={currentPendingPosition}
        onAcceptAll={handleAcceptAll}
        onRejectAll={handleRejectAll}
        onNextHunk={handleNextHunk}
        onPreviousHunk={handlePreviousHunk}
      />

      <div className={cn("flex min-w-0 overflow-x-hidden", !isMobile && "min-h-0 flex-1")}>
        {/* Outline toggle button - shows when outline is closed */}
        {!isMobile && <OutlineToggle headingsCount={headings.length} />}
        {/* Mindlines outline - hidden on mobile */}
        {!isMobile && <Mindlines editor={editor} />}
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
                "mx-auto w-full max-w-full px-4 pb-2 pt-0 sm:max-w-4xl",
                isMobileEditMode && "mobile-edit-mode"
              )}
            >
              <EditorContent editor={editor} />
            </div>
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <div className="mx-auto max-w-4xl px-4 pb-2 pt-0 md:px-8 md:py-6">
                <EditorContent editor={editor} />
              </div>
            </ScrollArea>
          )}
          {/* Search Bar - positioned top right within editor area */}
          <SearchBar />
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

      {/* Bubble Menus & Popups - Desktop only */}
      {/* Mobile uses block-based selection with long-press, no text selection menus */}
      {!isMobile && (
        <>
          <BubbleMenuComponent editor={editor} />
          <LinkBubbleMenu editor={editor} />
          <TableBubbleMenu editor={editor} />
          <ImageBubbleMenu editor={editor} />
          <SpellcheckPopup editor={editor} />
          <ReviewPopup editor={editor} />
          {!isReviewMode && (
            <QuickEditMenu onApply={handleQuickEditApply} isDemoMode={isDemoMode} />
          )}
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
