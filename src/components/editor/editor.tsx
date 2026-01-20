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
import { useDiffReview } from "@/hooks/use-diff-review";
import { useEditorShortcuts } from "@/hooks/use-editor-shortcuts";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { useEditorStore } from "@/stores/editor-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { debounce } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getEditorExtensions, defaultEditorProps } from "./editor-extensions";
import { applyPendingEdit } from "./editor-edit-operations";
import { EDITOR_DEBOUNCE_DELAY } from "@/lib/constants";

interface EditorProps {
  file: FileItem;
}

export function Editor({ file: initialFile }: EditorProps) {
  // Subscribe directly to file store to get real-time updates (for AI edits)
  const { updateFile, files } = useFileStore();
  const file = files.find((f) => f.id === initialFile.id) || initialFile;
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
  } = useEditorStore();

  // Search bar state
  const { isSearchBarOpen, toggleSearchBar } = useLayoutStore();

  const isMobile = useIsMobile();
  const lastContentRef = useRef(file.content);

  // Debounced save function
  // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce returns a new function, deps are intentionally limited
  const debouncedSave = useCallback(
    debounce((content: string) => {
      setSaving(true);
      updateFile(file.id, { content });
      setSaving(false);
      setLastSavedAt(new Date().toISOString());
      setDirty(false);
      lastContentRef.current = content;
    }, EDITOR_DEBOUNCE_DELAY),
    [file.id, updateFile, setSaving, setLastSavedAt, setDirty]
  );

  const editor = useEditor({
    extensions: getEditorExtensions({ enableBlockSelection: isMobile }),
    content: file.content,
    editorProps: defaultEditorProps,
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

  // Sync block selection enabled state with isMobile
  // This is needed because useEditor doesn't re-initialize on prop changes
  useEffect(() => {
    if (editor && editor.commands.setBlockSelectionEnabled) {
      editor.commands.setBlockSelectionEnabled(isMobile);
    }
  }, [editor, isMobile]);

  // Reset when file changes
  useEffect(() => {
    if (editor) {
      lastContentRef.current = file.content;
      queueMicrotask(() => {
        editor.commands.setContent(file.content, false);
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
  useAutocomplete({ editor, fileId: file.id, fileName: file.name });
  useSpellcheck({ editor, enabled: true });
  const { headings } = useHeadings(editor);

  const { triggerReview, clearReview } = useTextReview({
    editor,
    fileId: file.id,
    onReviewStart: () => setReviewPanelOpen(true),
    onReviewComplete: (count) => {
      console.log(`[Editor] Review complete with ${count} suggestions`);
    },
  });

  // Get review state for toolbar
  const reviewState = getReviewState(editor);
  const isReviewLoading = reviewState?.isLoading ?? false;
  const isReviewActive = reviewState?.isActive ?? false;

  // Use diff review hook
  const { isReviewMode, pendingCount, handleAcceptAll, handleRejectAll } = useDiffReview({
    editor,
    fileId: file.id,
  });

  // Use keyboard shortcuts hook (Ctrl+Shift+O for outline)
  useEditorShortcuts();

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
    <div className="flex h-full flex-col">
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
        onAcceptAll={handleAcceptAll}
        onRejectAll={handleRejectAll}
      />

      <div className="flex min-h-0 flex-1 overflow-x-hidden">
        {/* Outline toggle button - shows when outline is closed */}
        {!isMobile && <OutlineToggle headingsCount={headings.length} />}
        {/* Mindlines outline - hidden on mobile */}
        {!isMobile && <Mindlines editor={editor} />}
        {/* Main editor content area */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ScrollArea className="min-h-0 flex-1">
            <div className="mx-auto max-w-4xl px-4 py-4 md:px-8 md:py-6">
              <EditorContent editor={editor} />
            </div>
          </ScrollArea>
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
          <QuickEditMenu onApply={handleQuickEditApply} />
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
