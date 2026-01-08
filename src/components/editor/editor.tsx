"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import Typography from "@tiptap/extension-typography";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { useCallback, useEffect, useRef } from "react";
import { EditorToolbar } from "./editor-toolbar";
import { BubbleMenuComponent } from "./bubble-menu";
import { LinkBubbleMenu } from "./link-bubble-menu";
import { TableBubbleMenu } from "./table-bubble-menu";
import { SlashCommands } from "./slash-commands";
import { ImageModal } from "./image-modal";
import { QuickEditMenu } from "@/components/ai/quick-edit-menu";
import { AutocompleteExtension } from "@/extensions/autocomplete-extension";
import { AutocompleteKeymap } from "@/extensions/autocomplete-keymap";
import { useAutocomplete } from "@/hooks/use-autocomplete";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { useEditorStore, type PendingEdit } from "@/stores/editor-store";
import { debounce } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { htmlToMarkdown, markdownToHtml, isHtml } from "@/lib/markdown";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";

const lowlight = createLowlight(common);

import type { Editor as TiptapEditor } from "@tiptap/react";

/**
 * Apply a pending edit through ProseMirror's transaction system.
 * Uses replaceWith to properly replace document content while preserving undo history.
 */
function applyPendingEdit(
  editor: TiptapEditor,
  edit: PendingEdit,
  currentHtmlContent: string
): void {
  // Convert current HTML to markdown for text operations
  const currentMarkdown = isHtml(currentHtmlContent)
    ? htmlToMarkdown(currentHtmlContent)
    : currentHtmlContent;

  let newMarkdown = currentMarkdown;
  let success = false;

  switch (edit.type) {
    case "str_replace":
      if (edit.oldStr && edit.newStr !== undefined) {
        if (currentMarkdown.includes(edit.oldStr)) {
          newMarkdown = currentMarkdown.replace(edit.oldStr, edit.newStr);
          success = true;
        } else {
          console.warn("[Editor] str_replace: old_str not found, trying fuzzy match");
          const normalizedContent = currentMarkdown.replace(/\s+/g, " ");
          const normalizedOld = edit.oldStr.replace(/\s+/g, " ");
          if (normalizedContent.includes(normalizedOld)) {
            const regex = new RegExp(
              edit.oldStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"),
              "g"
            );
            newMarkdown = currentMarkdown.replace(regex, edit.newStr);
            success = true;
          }
        }
      }
      break;

    case "insert":
      if (edit.insertLine !== undefined && edit.newStr !== undefined) {
        const lines = currentMarkdown.split("\n");
        const insertIndex = Math.min(Math.max(0, edit.insertLine), lines.length);
        lines.splice(insertIndex, 0, edit.newStr);
        newMarkdown = lines.join("\n");
        success = true;
      }
      break;

    case "replace_all":
      if (edit.newContent !== undefined) {
        newMarkdown = edit.newContent;
        success = true;
      }
      break;
  }

  if (!success) {
    console.warn(`[Editor] Failed to apply ${edit.type} edit`);
    return;
  }

  // Convert back to HTML
  const newHtml = markdownToHtml(newMarkdown);

  // Parse the new HTML into a ProseMirror document
  const element = document.createElement("div");
  element.innerHTML = newHtml;
  const newDoc = ProseMirrorDOMParser.fromSchema(editor.schema).parse(element);

  // Use ProseMirror transaction to replace the entire document
  // This properly adds to undo history
  const { tr } = editor.state;
  tr.replaceWith(0, editor.state.doc.content.size, newDoc.content);
  editor.view.dispatch(tr);

  console.log(`[Editor] Applied ${edit.type} edit through ProseMirror transaction`);
}

interface EditorProps {
  file: FileItem;
}

export function Editor({ file: initialFile }: EditorProps) {
  // Subscribe directly to file store to get real-time updates (for AI edits)
  const { updateFile, files } = useFileStore();
  const file = files.find(f => f.id === initialFile.id) || initialFile;
  const {
    setDirty, setSelection, setSaving, setLastSavedAt, pendingEdits, clearPendingEdit,
    imageModalOpen, imageModalCallback, closeImageModal
  } = useEditorStore();

  const lastContentRef = useRef(file.content);

  // Debounced save function
  const debouncedSave = useCallback(
    debounce((content: string) => {
      setSaving(true);
      updateFile(file.id, { content });
      setSaving(false);
      setLastSavedAt(new Date().toISOString());
      setDirty(false);
      lastContentRef.current = content;
    }, 1000),
    [file.id, updateFile, setSaving, setLastSavedAt, setDirty]
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: {
          levels: [1, 2, 3, 4],
        },
      }),
      Placeholder.configure({
        placeholder: "Start writing, or press '/' for commands...",
      }),
      Highlight.configure({
        multicolor: true,
      }),
      Typography,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-primary underline underline-offset-2 cursor-pointer",
        },
      }),
      Image.configure({
        HTMLAttributes: {
          class: "rounded-lg max-w-full",
        },
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableCell,
      TableHeader,
      CodeBlockLowlight.configure({
        lowlight,
      }),
      SlashCommands,
      AutocompleteExtension,
      AutocompleteKeymap,
    ],
    content: file.content,
    editorProps: {
      attributes: {
        class: "prose prose-sm sm:prose dark:prose-invert max-w-none focus:outline-none",
      },
    },
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

  // NOTE: We intentionally do NOT sync file.content changes back to the editor here.
  // AI edits now go through pendingEdits mechanism which uses proper ProseMirror transactions.
  // Using setContent() here would destroy the undo history.
  // The editor is the source of truth, and changes flow: editor -> onUpdate -> debouncedSave -> file store

  // Reset when file changes
  useEffect(() => {
    if (editor) {
      lastContentRef.current = file.content;
      editor.commands.setContent(file.content, false);
    }
  }, [file.id, editor]);

  // Apply pending edits from AI through the editor's transaction system (for undo support)
  useEffect(() => {
    if (!editor) return;

    // Get edits for the current file
    const editsForThisFile = pendingEdits.filter((e) => e.fileId === file.id);
    if (editsForThisFile.length === 0) return;

    // Process each edit using the editor's current content (not file.content)
    // This ensures we're editing what's currently visible in the editor
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

  // Initialize autocomplete hook
  useAutocomplete({
    editor,
    fileId: file.id,
    fileName: file.name,
  });

  // Handle Quick Edit apply - replace selected text with AI result
  const handleQuickEditApply = useCallback(
    (newText: string, savedSelection: { from: number; to: number }) => {
      if (!editor) return;

      // Replace the selected text with the new text using the saved selection
      editor
        .chain()
        .focus()
        .setTextSelection({ from: savedSelection.from, to: savedSelection.to })
        .insertContent(newText)
        .run();
    },
    [editor]
  );

  // Handle Image Modal confirm (for slash commands)
  const handleImageModalConfirm = useCallback((url: string, alt?: string) => {
    if (imageModalCallback) {
      imageModalCallback(url, alt);
    }
    closeImageModal();
  }, [imageModalCallback, closeImageModal]);

  if (!editor) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading editor...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <EditorToolbar editor={editor} />
      <ScrollArea className="flex-1">
        <div className="max-w-4xl mx-auto px-8 py-6">
          <EditorContent editor={editor} />
        </div>
      </ScrollArea>
      <BubbleMenuComponent editor={editor} />
      <LinkBubbleMenu editor={editor} />
      <TableBubbleMenu editor={editor} />
      <QuickEditMenu onApply={handleQuickEditApply} />
      {/* Global Image Modal for slash commands */}
      <ImageModal
        open={imageModalOpen}
        onClose={closeImageModal}
        onConfirm={handleImageModalConfirm}
      />
    </div>
  );
}
