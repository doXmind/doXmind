"use client";

import { FileText, Loader2 } from "lucide-react";
import {
  type ChangeEvent,
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Marked } from "marked";

import {
  MarkdownBlockDocument,
  type MarkdownBlockView,
  type MarkdownSettableBlockKind,
} from "@/editor/markdown-block/markdown-block-document";
import {
  BlockGutterControls,
  TURN_INTO_OPTIONS,
} from "@/editor/markdown-block/block-gutter-controls";
import { createBlockEditingProjection } from "@/editor/markdown-block/block-editing-projection";
import { editableMarkdownBlockSource } from "@/editor/markdown-block/markdown-block-source";
import { isMarkdownSourceOnlyBlockKind } from "@/editor/markdown-block/markdown-block-document";
import { InlineFormatToolbar } from "@/editor/markdown-block/inline-format-toolbar";
import {
  markdownInlineFormatState,
  type MarkdownInlineFormat,
} from "@/editor/markdown-block/markdown-inline-format";
import { projectMarkdownInline } from "@/editor/markdown-block/markdown-inline-projection";
import {
  SemanticInlineEditor,
  type SemanticInlineSelection,
} from "@/editor/markdown-block/semantic-inline-editor";
import {
  parseWikiEmbedBlock,
  resolveWikiEmbed,
  type WikiEmbedProjectionStatus,
} from "@/editor/markdown-block/wiki-embed";
import { parseMarkdownToggle } from "@/editor/markdown-block/markdown-toggle";
import {
  MARKDOWN_IMAGE_EXTENSIONS,
  parseMarkdownImageBlock,
  resolveMarkdownImagePath,
} from "@/editor/markdown-block/markdown-image";
import {
  searchMarkdownSlashCommands,
  type MarkdownSlashCommandId,
} from "@/editor/markdown-block/slash-commands";
import { resolveKnowledgeWikiPage, type KnowledgeSourceCatalog } from "@/lib/knowledge-index";
import {
  PageCollectionPreview,
  type PageCollectionPreviewContext,
} from "@/editor/markdown-block/page-collection-preview";
import type { WorkspaceAssetRead } from "@/lib/storage";
import {
  getMermaidThemeKey,
  renderMermaidSvg,
  renderMermaidSvgLight,
  subscribeMermaidTheme,
} from "@/lib/mermaid-renderer";

const inlinePreviewLexer = new Marked({ gfm: true });
let katexPromise: Promise<typeof import("katex").default> | null = null;

function loadKatex(): Promise<typeof import("katex").default> {
  katexPromise ??= import("katex").then((module) => module.default);
  return katexPromise;
}

interface MarkdownBlockRowProps {
  block: MarkdownBlockView;
  index: number;
  count: number;
  active: boolean;
  autoFocusEditor?: boolean;
  highlightSelection?: boolean;
  keyboardEntry?: boolean;
  blockSelected?: boolean;
  blockSelectionFocus?: boolean;
  nextBlockId?: string;
  dropBefore?: boolean;
  selection?: { anchor: number; head: number };
  onActivate: (blockId: string) => void;
  onSelectBlock?: (blockId: string, extend?: boolean) => void;
  onBlockSelectionKeyDown?: (blockId: string, event: KeyboardEvent<HTMLDivElement>) => void;
  onChange: (blockId: string, source: string) => void;
  onPaste: (blockId: string, from: number, to: number, text: string) => void;
  onApplyInlineFormat?: (
    blockId: string,
    from: number,
    to: number,
    format: MarkdownInlineFormat
  ) => void;
  onImportImages?: (blockId: string, from: number, to: number, files: readonly File[]) => void;
  onCompositionStart: (blockId: string) => void;
  onCompositionEnd: (blockId: string) => void;
  onSplit: (blockId: string, from: number, to: number) => void;
  onMergeBackward: (blockId: string) => void;
  onInsertAfter: (blockId: string) => void;
  onCopyMarkdown?: (blockId: string) => void | Promise<void>;
  onDuplicate: (blockId: string) => void;
  onDelete: (blockId: string) => void;
  onSetTaskChecked: (blockId: string, checked: boolean) => void;
  onMove: (blockId: string, direction: -1 | 1) => boolean | void;
  onIndent?: (
    blockId: string,
    direction: -1 | 1,
    selection: { anchor: number; head: number }
  ) => boolean | void;
  onNavigate?: (blockId: string, direction: -1 | 1) => boolean;
  onSetKind: (
    blockId: string,
    kind: MarkdownSettableBlockKind,
    level?: 1 | 2 | 3 | 4 | 5 | 6
  ) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDragStart: (blockId: string, event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onCanDrop: (dataTransfer: DataTransfer) => boolean;
  onDragIntent?: (beforeId: string | null) => void;
  onClearDragIntent?: () => void;
  onDropBefore: (blockId: string | null, dataTransfer: DataTransfer) => boolean;
  onOpenWikiLink?: (target: string) => void;
  wikiEmbedContext?: MarkdownWikiEmbedContext;
  collectionContext?: MarkdownCollectionContext;
  imageContext?: MarkdownImageContext;
  onRunSlashCommand?: (blockId: string, commandId: MarkdownSlashCommandId) => void;
}

export interface MarkdownWikiEmbedContext {
  status: "loading" | "ready" | "error";
  index: KnowledgeSourceCatalog | null;
  sourcePageId: string;
  sourcePath: string;
  ancestry: readonly string[];
  depth: number;
  onOpenPage?: (pageId: string) => void;
}

export type MarkdownCollectionContext = PageCollectionPreviewContext;

export interface MarkdownImageContext {
  pagePath: string;
  readAsset: (path: string) => Promise<WorkspaceAssetRead>;
}

export function MarkdownBlockRow({
  block,
  index,
  count,
  active,
  autoFocusEditor = true,
  highlightSelection = false,
  keyboardEntry = true,
  blockSelected = false,
  blockSelectionFocus = false,
  nextBlockId,
  dropBefore = false,
  selection,
  onActivate,
  onSelectBlock,
  onBlockSelectionKeyDown,
  onChange,
  onPaste,
  onApplyInlineFormat,
  onImportImages,
  onCompositionStart,
  onCompositionEnd,
  onSplit,
  onMergeBackward,
  onInsertAfter,
  onCopyMarkdown,
  onDuplicate,
  onDelete,
  onSetTaskChecked,
  onMove,
  onIndent,
  onNavigate,
  onSetKind,
  onUndo,
  onRedo,
  onDragStart,
  onDragEnd,
  onCanDrop,
  onDragIntent,
  onClearDragIntent,
  onDropBefore,
  onOpenWikiLink,
  wikiEmbedContext,
  collectionContext,
  imageContext,
  onRunSlashCommand,
}: MarkdownBlockRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorId = `native-block-editor-${block.id}`;
  const descriptionId = `native-block-description-${block.id}`;
  const rawSource = editableMarkdownBlockSource(block.raw);
  const editingProjection = useMemo(() => createBlockEditingProjection(block), [block]);
  const source = editingProjection.editorText;
  const sourceOnly = isMarkdownSourceOnlyBlockKind(block.kind);
  const inlineProjection = useMemo(() => projectMarkdownInline(source), [source]);
  const useSemanticInlineEditor =
    !sourceOnly &&
    !/[\r\n]/.test(source) &&
    parseWikiEmbedBlock(source) === null &&
    inlineProjection.visibleText !== source;
  const slashQuery =
    active && block.kind === "paragraph" && /^\/[^\r\n]*$/.test(source) && onRunSlashCommand
      ? source.slice(1)
      : null;
  const slashCommands = useMemo(
    () => (slashQuery === null ? [] : searchMarkdownSlashCommands(slashQuery)),
    [slashQuery]
  );
  const [slashIndex, setSlashIndex] = useState(0);
  const [dismissedSlashSource, setDismissedSlashSource] = useState<string | null>(null);
  const [inlineSelection, setInlineSelection] = useState<{
    from: number;
    to: number;
    position: { top: number; left: number };
  } | null>(null);
  const editorSelectionRef = useRef<SemanticInlineSelection>({
    anchor: source.length,
    head: source.length,
  });
  const sourceLengthRef = useRef(source.length);
  sourceLengthRef.current = source.length;
  const slashMenuOpen =
    slashQuery !== null && slashCommands.length > 0 && dismissedSlashSource !== source;
  const activeListItem = listItemPreview(rawSource, block.kind);

  useEffect(() => {
    setSlashIndex(0);
    if (dismissedSlashSource !== null && dismissedSlashSource !== source) {
      setDismissedSlashSource(null);
    }
  }, [dismissedSlashSource, slashQuery, source]);

  useEffect(() => {
    if (!active) return;
    editorSelectionRef.current = selection ?? {
      anchor: sourceLengthRef.current,
      head: sourceLengthRef.current,
    };
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (autoFocusEditor) textarea.focus();
    if (selection) {
      const anchor = Math.min(selection.anchor, textarea.value.length);
      const head = Math.min(selection.head, textarea.value.length);
      textarea.setSelectionRange(anchor, head);
    } else {
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
    textarea.style.height = "0px";
    textarea.style.height = `${Math.max(textarea.scrollHeight, 36)}px`;
  }, [active, autoFocusEditor, selection]);

  useEffect(() => {
    if (blockSelectionFocus) rowRef.current?.focus();
  }, [blockSelectionFocus]);

  useEffect(() => {
    if (!active || sourceOnly) setInlineSelection(null);
  }, [active, sourceOnly]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setInlineSelection(null);
    onChange(block.id, event.target.value);
    event.target.style.height = "0px";
    event.target.style.height = `${Math.max(event.target.scrollHeight, 36)}px`;
  };

  const handleEditorKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    editorSelection: SemanticInlineSelection,
    editorLength: number
  ) => {
    const from = Math.min(editorSelection.anchor, editorSelection.head);
    const to = Math.max(editorSelection.anchor, editorSelection.head);
    if (event.nativeEvent.isComposing) return;
    if (slashMenuOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setSlashIndex(
          (current) => (current + direction + slashCommands.length) % slashCommands.length
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const command = slashCommands[slashIndex] ?? slashCommands[0];
        if (command) onRunSlashCommand?.(block.id, command.id);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedSlashSource(source);
        return;
      }
    }
    if (
      event.key === "Escape" &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      onSelectBlock?.(block.id);
      return;
    }
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "a"
    ) {
      const visibleRange = inlineProjection.sourceRangeToVisible({ from, to });
      if (visibleRange.from === 0 && visibleRange.to === inlineProjection.visibleText.length) {
        event.preventDefault();
        onSelectBlock?.(block.id);
        return;
      }
    }
    if (
      (event.metaKey || event.ctrlKey) &&
      event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "d"
    ) {
      event.preventDefault();
      if (!event.repeat) onDuplicate(block.id);
      return;
    }
    if (
      (event.metaKey || event.ctrlKey) &&
      event.shiftKey &&
      !event.altKey &&
      (event.key === "Backspace" || event.key === "Delete")
    ) {
      event.preventDefault();
      if (!event.repeat) onDelete(block.id);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) onRedo();
      else onUndo();
      return;
    }
    if (
      event.altKey &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      const direction = event.key === "ArrowUp" ? -1 : 1;
      if (onMove(block.id, direction) !== false) event.preventDefault();
      return;
    }
    if (
      event.key === "Tab" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      (block.kind === "bullet_list_item" ||
        block.kind === "ordered_list_item" ||
        block.kind === "task_list_item") &&
      onIndent
    ) {
      event.preventDefault();
      onIndent(block.id, event.shiftKey ? -1 : 1, {
        anchor: editorSelection.anchor,
        head: editorSelection.head,
      });
      return;
    }
    if (
      onNavigate &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      from === to &&
      ((event.key === "ArrowUp" && from === 0) ||
        (event.key === "ArrowDown" && to === editorLength))
    ) {
      const direction = event.key === "ArrowUp" ? -1 : 1;
      if (onNavigate(block.id, direction)) event.preventDefault();
      return;
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      if (sourceOnly) return;
      event.preventDefault();
      if (
        source.length === 0 &&
        (block.depth ?? 0) > 0 &&
        (block.kind === "bullet_list_item" ||
          block.kind === "ordered_list_item" ||
          block.kind === "task_list_item") &&
        onIndent
      ) {
        onIndent(block.id, -1, { anchor: 0, head: 0 });
        return;
      }
      onSplit(block.id, from, to);
      return;
    }
    if (!sourceOnly && event.key === "Backspace" && from === 0 && to === 0) {
      event.preventDefault();
      if (
        (block.depth ?? 0) > 0 &&
        (block.kind === "bullet_list_item" ||
          block.kind === "ordered_list_item" ||
          block.kind === "task_list_item") &&
        onIndent
      ) {
        onIndent(block.id, -1, { anchor: 0, head: 0 });
        return;
      }
      onMergeBackward(block.id);
    }
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    handleEditorKeyDown(
      event,
      {
        anchor: event.currentTarget.selectionStart,
        head: event.currentTarget.selectionEnd,
      },
      event.currentTarget.value.length
    );
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = rasterFiles(event.clipboardData);
    if (!sourceOnly && images.length && onImportImages) {
      event.preventDefault();
      onImportImages(
        block.id,
        event.currentTarget.selectionStart,
        event.currentTarget.selectionEnd,
        images
      );
      return;
    }
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    onPaste(block.id, event.currentTarget.selectionStart, event.currentTarget.selectionEnd, text);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    const images = rasterFiles(event.dataTransfer);
    if (!sourceOnly && images.length && onImportImages) {
      event.preventDefault();
      event.stopPropagation();
      const textarea = textareaRef.current;
      const editorSelection = editorSelectionRef.current;
      onImportImages(
        block.id,
        textarea?.selectionStart ?? editorSelection.anchor,
        textarea?.selectionEnd ?? editorSelection.head,
        images
      );
      return;
    }
    const beforeId = blockDropTarget(event.currentTarget, event.clientY, block.id, nextBlockId);
    if (onDropBefore(beforeId, event.dataTransfer)) event.preventDefault();
  };

  const updateInlineSelection = (textarea: HTMLTextAreaElement) => {
    const from = Math.min(textarea.selectionStart, textarea.selectionEnd);
    const to = Math.max(textarea.selectionStart, textarea.selectionEnd);
    editorSelectionRef.current = {
      anchor: textarea.selectionStart,
      head: textarea.selectionEnd,
    };
    if (sourceOnly || !onApplyInlineFormat || from === to) {
      setInlineSelection(null);
      return;
    }
    setInlineSelection({
      from,
      to,
      position: textareaSelectionToolbarPosition(textarea, from, to),
    });
  };

  const updateSemanticInlineSelection = (
    nextSelection: SemanticInlineSelection,
    editor: HTMLElement
  ) => {
    editorSelectionRef.current = nextSelection;
    const from = Math.min(nextSelection.anchor, nextSelection.head);
    const to = Math.max(nextSelection.anchor, nextSelection.head);
    if (!onApplyInlineFormat || from === to) {
      setInlineSelection(null);
      return;
    }
    setInlineSelection({
      from,
      to,
      position: domSelectionToolbarPosition(editor),
    });
  };

  const openBlockActionsMenu = () => {
    setInlineSelection(null);
    rowRef.current?.querySelector<HTMLButtonElement>('button[aria-label="Block actions"]')?.click();
  };

  return (
    <div
      ref={rowRef}
      className={`group/native-block relative flex min-h-9 items-start gap-1 rounded-md py-0.5 pl-1 pr-1 transition-colors ${
        blockSelected ? "bg-[rgba(35,131,226,0.09)]" : active ? "" : "hover:bg-muted/25"
      }`}
      data-block-id={block.id}
      data-block-kind={block.kind}
      data-block-level={block.level}
      data-block-depth={block.depth}
      data-native-block-row
      data-active={active ? "true" : "false"}
      data-block-selected={blockSelected ? "true" : undefined}
      data-drop-before={dropBefore ? "true" : undefined}
      role="group"
      aria-label={`Block ${index + 1} of ${count}`}
      aria-describedby={descriptionId}
      aria-current={active ? "true" : undefined}
      tabIndex={blockSelectionFocus || (!active && block.editable && keyboardEntry) ? 0 : -1}
      style={
        {
          marginLeft: `calc(-4rem + ${(block.depth ?? 0) * 1.5}rem)`,
        } satisfies CSSProperties
      }
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && blockSelected) {
          onBlockSelectionKeyDown?.(block.id, event);
          return;
        }
        if (
          event.target === event.currentTarget &&
          !active &&
          block.editable &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          onActivate(block.id);
        }
      }}
      onDragOver={(event) => {
        if (!sourceOnly && rasterFiles(event.dataTransfer).length) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          return;
        }
        if (!onCanDrop(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onDragIntent?.(blockDropTarget(event.currentTarget, event.clientY, block.id, nextBlockId));
      }}
      onDragLeave={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        onClearDragIntent?.();
      }}
      onDrop={handleDrop}
    >
      <span id={descriptionId} className="sr-only">
        {`Block ${index + 1} of ${count}. Press Enter to edit. Use Alt plus Arrow keys to move, Mod plus Shift plus D to duplicate, and Mod plus Shift plus Backspace to delete.`}
      </span>
      <div
        data-native-block-controls
        className="flex w-14 shrink-0 items-center justify-end pt-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/native-block:opacity-100"
        onPointerDownCapture={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest('button[aria-label="Block actions"]')) {
            onSelectBlock?.(block.id);
          }
        }}
      >
        <BlockGutterControls
          currentKind={block.kind}
          currentLevel={
            block.level === 1 ||
            block.level === 2 ||
            block.level === 3 ||
            block.level === 4 ||
            block.level === 5 ||
            block.level === 6
              ? block.level
              : undefined
          }
          canMoveUp={index > 0}
          canMoveDown={index < count - 1}
          canTurnInto={block.editable && !sourceOnly}
          draggable
          buttonTabIndex={active ? 0 : -1}
          describedBy={descriptionId}
          onAdd={() => onInsertAfter(block.id)}
          onTurnInto={(kind, level) => onSetKind(block.id, kind, level)}
          onCopyMarkdown={() =>
            onCopyMarkdown ? onCopyMarkdown(block.id) : navigator.clipboard?.writeText(block.raw)
          }
          onDuplicate={() => onDuplicate(block.id)}
          onMoveUp={() => onMove(block.id, -1)}
          onMoveDown={() => onMove(block.id, 1)}
          onDelete={() => onDelete(block.id)}
          onDragStart={(event) => onDragStart(block.id, event)}
          onDragEnd={onDragEnd}
        />
      </div>

      <div
        className="min-w-0 flex-1"
        onClick={(event) => {
          if (event.shiftKey) {
            event.preventDefault();
            onSelectBlock?.(block.id, true);
            return;
          }
          if (!active && block.editable) onActivate(block.id);
        }}
      >
        {active && block.editable ? (
          <>
            <div
              data-native-block-edit-surface
              data-editor-kind={block.kind}
              data-editor-level={block.level}
              className={activeEditorSurfaceClass(block)}
            >
              {block.kind === "task_list_item" && activeListItem ? (
                <input
                  type="checkbox"
                  aria-label={activeListItem.content || "Empty task"}
                  className="mt-1.5 h-4 w-4 shrink-0 rounded border-muted-foreground/50"
                  checked={block.checked ?? false}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => onSetTaskChecked(block.id, event.target.checked)}
                />
              ) : activeListItem ? (
                <span
                  className="w-5 shrink-0 select-none text-right text-muted-foreground"
                  aria-hidden
                >
                  {activeListItem.marker}
                </span>
              ) : null}
              {useSemanticInlineEditor ? (
                <SemanticInlineEditor
                  id={editorId}
                  describedBy={descriptionId}
                  source={source}
                  selection={selection}
                  autoFocus={autoFocusEditor}
                  highlightSelection={highlightSelection}
                  className="native-block-textarea block min-w-0 flex-1 whitespace-pre-wrap break-words bg-transparent outline-none"
                  onSourceChange={(nextSource, nextSelection) => {
                    editorSelectionRef.current = nextSelection;
                    setInlineSelection(null);
                    onChange(block.id, nextSource);
                  }}
                  onSelectionChange={(nextSelection) => {
                    const editor = rowRef.current?.querySelector<HTMLElement>(
                      "[data-native-semantic-editor]"
                    );
                    if (editor) updateSemanticInlineSelection(nextSelection, editor);
                  }}
                  onKeyDown={(event, nextSelection) =>
                    handleEditorKeyDown(event, nextSelection, source.length)
                  }
                  onPasteText={(text, nextSelection) => {
                    if (text) {
                      onPaste(block.id, nextSelection.anchor, nextSelection.head, text);
                    }
                    return true;
                  }}
                  onPasteFiles={
                    onImportImages
                      ? (files, nextSelection) => {
                          const images = files.filter(isRasterFile);
                          if (images.length) {
                            onImportImages(
                              block.id,
                              nextSelection.anchor,
                              nextSelection.head,
                              images
                            );
                          }
                        }
                      : undefined
                  }
                  onCompositionStart={() => onCompositionStart(block.id)}
                  onCompositionEnd={() => onCompositionEnd(block.id)}
                />
              ) : (
                <textarea
                  ref={textareaRef}
                  id={editorId}
                  aria-label="Markdown block"
                  aria-describedby={descriptionId}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Meta+Shift+D Control+Shift+D Meta+Shift+Backspace Control+Shift+Backspace"
                  data-native-block-editor
                  className={`native-block-textarea block min-w-0 flex-1 resize-none overflow-hidden bg-transparent outline-none ${
                    sourceOnly ? "font-mono" : ""
                  }`}
                  value={source}
                  rows={1}
                  spellCheck
                  onChange={handleChange}
                  onPaste={handlePaste}
                  onCompositionStart={() => onCompositionStart(block.id)}
                  onCompositionEnd={() => onCompositionEnd(block.id)}
                  onKeyDown={handleTextareaKeyDown}
                  onKeyUp={(event) => updateInlineSelection(event.currentTarget)}
                  onMouseUp={(event) => updateInlineSelection(event.currentTarget)}
                  onSelect={(event) => updateInlineSelection(event.currentTarget)}
                />
              )}
            </div>
            <InlineFormatToolbar
              visible={inlineSelection !== null}
              position={inlineSelection?.position}
              typeLabel={blockTypeLabel(block)}
              blockTypeOptions={TURN_INTO_OPTIONS}
              activeFormats={
                inlineSelection
                  ? markdownInlineFormatState(source, inlineSelection.from, inlineSelection.to)
                  : undefined
              }
              onTurnInto={(option) => {
                setInlineSelection(null);
                onSetKind(block.id, option.kind, option.level);
              }}
              onBold={() => {
                if (inlineSelection) {
                  onApplyInlineFormat?.(block.id, inlineSelection.from, inlineSelection.to, "bold");
                  setInlineSelection(null);
                }
              }}
              onItalic={() => {
                if (inlineSelection) {
                  onApplyInlineFormat?.(
                    block.id,
                    inlineSelection.from,
                    inlineSelection.to,
                    "italic"
                  );
                  setInlineSelection(null);
                }
              }}
              onStrike={() => {
                if (inlineSelection) {
                  onApplyInlineFormat?.(
                    block.id,
                    inlineSelection.from,
                    inlineSelection.to,
                    "strike"
                  );
                  setInlineSelection(null);
                }
              }}
              onLink={() => {
                if (inlineSelection) {
                  onApplyInlineFormat?.(block.id, inlineSelection.from, inlineSelection.to, "link");
                  setInlineSelection(null);
                }
              }}
              onCode={() => {
                if (inlineSelection) {
                  onApplyInlineFormat?.(block.id, inlineSelection.from, inlineSelection.to, "code");
                  setInlineSelection(null);
                }
              }}
              onMore={openBlockActionsMenu}
            />
            {slashMenuOpen ? (
              <div
                role="listbox"
                aria-label="Block commands"
                className="absolute left-10 top-full z-50 mt-1 max-h-80 w-[min(22rem,calc(100vw-5rem))] overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
              >
                {slashCommands.map((command, commandIndex) => (
                  <button
                    key={command.id}
                    type="button"
                    role="option"
                    aria-selected={commandIndex === slashIndex}
                    className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left ${
                      commandIndex === slashIndex ? "bg-muted" : "hover:bg-muted/70"
                    }`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRunSlashCommand?.(block.id, command.id);
                    }}
                  >
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border bg-background font-mono text-xs text-muted-foreground">
                      {command.title.slice(0, 1)}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{command.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {command.description}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            <div data-native-block-print-preview className="hidden">
              <BlockPreview
                block={block}
                onSetTaskChecked={onSetTaskChecked}
                onOpenWikiLink={onOpenWikiLink}
                wikiEmbedContext={wikiEmbedContext}
                collectionContext={collectionContext}
                imageContext={imageContext}
              />
            </div>
          </>
        ) : (
          <BlockPreview
            block={block}
            onSetTaskChecked={onSetTaskChecked}
            onOpenWikiLink={onOpenWikiLink}
            wikiEmbedContext={wikiEmbedContext}
            collectionContext={collectionContext}
            imageContext={imageContext}
          />
        )}
      </div>
    </div>
  );
}

function textareaSelectionToolbarPosition(
  textarea: HTMLTextAreaElement,
  from: number,
  to: number
): { top: number; left: number } {
  const textareaRect = textarea.getBoundingClientRect();
  const midpoint = Math.floor((from + to) / 2);
  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  Object.assign(mirror.style, {
    position: "fixed",
    visibility: "hidden",
    pointerEvents: "none",
    zIndex: "-1",
    boxSizing: computed.boxSizing,
    left: `${textareaRect.left}px`,
    top: `${textareaRect.top - textarea.scrollTop}px`,
    width: `${textareaRect.width}px`,
    minHeight: `${textareaRect.height}px`,
    padding: computed.padding,
    border: computed.border,
    font: computed.font,
    fontFamily: computed.fontFamily,
    fontSize: computed.fontSize,
    fontWeight: computed.fontWeight,
    fontStyle: computed.fontStyle,
    lineHeight: computed.lineHeight,
    letterSpacing: computed.letterSpacing,
    textTransform: computed.textTransform,
    textIndent: computed.textIndent,
    tabSize: computed.tabSize,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    wordBreak: computed.wordBreak,
  });
  mirror.append(document.createTextNode(textarea.value.slice(0, midpoint)));
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  mirror.append(marker, document.createTextNode(textarea.value.slice(midpoint) || "\u200b"));
  document.body.append(mirror);
  const markerRect = marker.getBoundingClientRect();
  mirror.remove();

  const rawLeft = markerRect.left || textareaRect.left + textareaRect.width / 2;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const left =
    viewportWidth > 320
      ? Math.max(160, Math.min(viewportWidth - 160, rawLeft))
      : Math.max(8, rawLeft);
  return {
    top: markerRect.top || textareaRect.top,
    left,
  };
}

function domSelectionToolbarPosition(editor: HTMLElement): { top: number; left: number } {
  const editorRect = editor.getBoundingClientRect();
  const selection = window.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const selectionRect =
    range && typeof range.getBoundingClientRect === "function"
      ? range.getBoundingClientRect()
      : null;
  const rawLeft =
    selectionRect && (selectionRect.width > 0 || selectionRect.left > 0)
      ? selectionRect.left + selectionRect.width / 2
      : editorRect.left + editorRect.width / 2;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  return {
    top:
      selectionRect && (selectionRect.height > 0 || selectionRect.top > 0)
        ? selectionRect.top
        : editorRect.top,
    left:
      viewportWidth > 320
        ? Math.max(160, Math.min(viewportWidth - 160, rawLeft))
        : Math.max(8, rawLeft),
  };
}

function blockDropTarget(
  row: HTMLDivElement,
  clientY: number,
  blockId: string,
  nextBlockId: string | undefined
): string | null {
  const rect = row.getBoundingClientRect();
  if (rect.height > 0 && clientY > rect.top + rect.height / 2) return nextBlockId ?? null;
  return blockId;
}

function blockTypeLabel(block: MarkdownBlockView): string {
  if (block.kind === "heading") return `Heading ${block.level ?? 1}`;
  if (block.kind === "bullet_list_item") return "Bulleted list";
  if (block.kind === "ordered_list_item") return "Numbered list";
  if (block.kind === "task_list_item") return "To-do";
  if (block.kind === "blockquote") return "Quote";
  if (block.kind === "fenced_code") return "Code";
  if (block.kind === "paragraph") return "Text";
  return "Markdown";
}

function rasterFiles(dataTransfer: DataTransfer): File[] {
  return Array.from(dataTransfer.files ?? []).filter(isRasterFile);
}

function isRasterFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type.startsWith("image/") ||
    MARKDOWN_IMAGE_EXTENSIONS.some((extension) => name.endsWith(extension))
  );
}

function BlockPreview({
  block,
  onSetTaskChecked,
  onOpenWikiLink,
  wikiEmbedContext,
  collectionContext,
  imageContext,
  readOnly = false,
}: {
  block: MarkdownBlockView;
  onSetTaskChecked: (blockId: string, checked: boolean) => void;
  onOpenWikiLink?: (target: string) => void;
  wikiEmbedContext?: MarkdownWikiEmbedContext;
  collectionContext?: MarkdownCollectionContext;
  imageContext?: MarkdownImageContext;
  readOnly?: boolean;
}) {
  const source = editableMarkdownBlockSource(block.raw);
  if (block.kind === "paragraph" && parseWikiEmbedBlock(source)) {
    return (
      <WikiEmbedPreview
        source={source}
        context={wikiEmbedContext}
        collectionContext={collectionContext}
        imageContext={imageContext}
      />
    );
  }
  if (block.kind === "thematic_break") {
    return (
      <div className="flex min-h-9 items-center px-1 py-2">
        <hr data-testid="thematic-break-block" className="w-full border-border" />
      </div>
    );
  }
  if (block.kind === "toggle") {
    const toggle = parseMarkdownToggle(source);
    if (toggle) {
      const nestedBlocks = toggle.markdown
        ? MarkdownBlockDocument.fromMarkdown(toggle.markdown).getSnapshot().blocks
        : [];
      return (
        <details
          data-testid="toggle-block"
          data-native-toggle
          open={toggle.open}
          className="my-1 min-h-9 rounded-lg border border-border bg-muted/20"
        >
          <summary
            className="cursor-pointer select-none px-3 py-2 text-sm font-medium"
            onClick={(event) => event.stopPropagation()}
          >
            <InlineMarkdownPreview source={toggle.summary} onOpenWikiLink={onOpenWikiLink} />
          </summary>
          <div
            data-native-toggle-content
            className="space-y-0.5 border-t border-border/70 px-3 py-2"
          >
            {nestedBlocks.length ? (
              nestedBlocks.map((nested) => (
                <BlockPreview
                  key={nested.id}
                  block={nested}
                  readOnly
                  onSetTaskChecked={() => undefined}
                  onOpenWikiLink={onOpenWikiLink}
                  wikiEmbedContext={wikiEmbedContext}
                  collectionContext={collectionContext}
                  imageContext={imageContext}
                />
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Empty toggle</p>
            )}
          </div>
        </details>
      );
    }
  }
  if (block.kind === "table") {
    const table = tablePreview(source);
    if (table) {
      return (
        <div className="min-h-9 overflow-x-auto py-1">
          <table aria-label="Markdown table" className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                {table.header.map((cell, index) => (
                  <th
                    key={`header-${index}`}
                    className="border border-border bg-muted/50 px-2 py-1.5 font-medium"
                  >
                    <InlineMarkdownPreview source={cell.text} onOpenWikiLink={onOpenWikiLink} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`cell-${rowIndex}-${cellIndex}`}
                      className="border border-border px-2 py-1.5"
                    >
                      <InlineMarkdownPreview source={cell.text} onOpenWikiLink={onOpenWikiLink} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
  }
  if (block.kind === "collection") {
    return <PageCollectionPreview source={source} context={collectionContext} />;
  }
  if (block.kind === "image") {
    return <LocalImagePreview source={source} context={imageContext} />;
  }
  if (block.kind === "block_math") {
    return <BlockMathPreview source={source} />;
  }
  if (block.kind === "mermaid") {
    return <MermaidBlockPreview source={source} />;
  }
  if (block.kind === "callout") {
    const callout = calloutPreview(source);
    if (callout) {
      return (
        <aside
          data-testid="callout-block"
          aria-label={`${callout.type} callout`}
          className="min-h-9 rounded-md border border-border bg-muted/35 px-3 py-2"
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {callout.title || callout.type}
          </div>
          {callout.body ? (
            <div className="mt-1 whitespace-pre-wrap text-sm leading-6">
              <InlineMarkdownPreview source={callout.body} onOpenWikiLink={onOpenWikiLink} />
            </div>
          ) : null}
        </aside>
      );
    }
  }
  if (block.kind === "fenced_code") {
    return (
      <pre
        data-testid="fenced-code-block"
        className="min-h-9 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted px-3 py-2 font-mono text-sm leading-6"
      >
        <code>{source || " "}</code>
      </pre>
    );
  }
  if (block.kind === "unsupported") {
    return (
      <pre className="min-h-9 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/60 px-3 py-2 font-mono text-sm leading-6 text-muted-foreground">
        <code>{source || " "}</code>
      </pre>
    );
  }
  if (block.kind === "blockquote") {
    const text = source
      .split(/\r\n|\n|\r/)
      .map((line) => line.replace(/^ {0,3}>[ \t]?/, ""))
      .join("\n");
    return (
      <blockquote className="min-h-9 whitespace-pre-wrap border-l-4 border-muted-foreground/35 px-3 py-1 text-base italic leading-7 text-muted-foreground">
        {text ? <InlineMarkdownPreview source={text} onOpenWikiLink={onOpenWikiLink} /> : " "}
      </blockquote>
    );
  }
  const listItem = listItemPreview(source, block.kind);
  if (listItem) {
    const content = listItem.content ? (
      <InlineMarkdownPreview source={listItem.content} onOpenWikiLink={onOpenWikiLink} />
    ) : (
      " "
    );
    if (block.kind === "task_list_item") {
      return (
        <div className="flex min-h-9 items-start gap-2 px-1 py-1 text-base leading-7">
          <input
            type="checkbox"
            aria-label={listItem.content || "Empty task"}
            className="mt-1.5 h-4 w-4 shrink-0 rounded border-muted-foreground/50"
            checked={block.checked ?? false}
            disabled={readOnly}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onSetTaskChecked(block.id, event.target.checked)}
          />
          <span className={block.checked ? "text-muted-foreground line-through" : undefined}>
            {content}
          </span>
        </div>
      );
    }
    return (
      <div className="flex min-h-9 items-start gap-2 px-1 py-1 text-base leading-7">
        <span className="w-5 shrink-0 select-none text-right text-muted-foreground" aria-hidden>
          {listItem.marker}
        </span>
        <span className="min-w-0 whitespace-pre-wrap">{content}</span>
      </div>
    );
  }
  const text = block.kind === "heading" ? source.replace(/^#{1,6}[ \t]+/, "") : source;
  const inline = <InlineMarkdownPreview source={text} onOpenWikiLink={onOpenWikiLink} />;
  if (block.kind !== "heading") {
    return (
      <p className="min-h-9 whitespace-pre-wrap px-1 py-1 text-base leading-7">
        {text ? inline : " "}
      </p>
    );
  }
  const classes = "min-h-9 whitespace-pre-wrap px-1 py-1 font-semibold tracking-tight";
  switch (block.level) {
    case 1:
      return <h1 className={`${classes} text-3xl`}>{text ? inline : " "}</h1>;
    case 2:
      return <h2 className={`${classes} text-2xl`}>{text ? inline : " "}</h2>;
    case 3:
      return <h3 className={`${classes} text-xl`}>{text ? inline : " "}</h3>;
    case 4:
      return <h4 className={`${classes} text-lg`}>{text ? inline : " "}</h4>;
    case 5:
      return <h5 className={`${classes} text-base`}>{text ? inline : " "}</h5>;
    default:
      return <h6 className={`${classes} text-sm`}>{text ? inline : " "}</h6>;
  }
}

function LocalImagePreview({
  source,
  context,
}: {
  source: string;
  context?: MarkdownImageContext;
}) {
  const parsed = parseMarkdownImageBlock(source);
  const destination = parsed.ok ? parsed.image.destination : "";
  const parseError = parsed.ok ? null : parsed.diagnostic.message;
  const [state, setState] = useState<{
    status: "loading" | "loaded" | "ready" | "error";
    url: string | null;
    error: string | null;
  }>({ status: "loading", url: null, error: null });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ status: "loading", url: null, error: null });
    if (parseError) {
      setState({ status: "error", url: null, error: parseError });
      return () => undefined;
    }
    if (!context) {
      setState({ status: "error", url: null, error: "Local image preview is unavailable." });
      return () => undefined;
    }
    const resolved = resolveMarkdownImagePath(context.pagePath, destination);
    if (!resolved.ok) {
      setState({ status: "error", url: null, error: resolved.diagnostic.message });
      return () => undefined;
    }

    void context
      .readAsset(resolved.imagePath.workspacePath)
      .then((asset) => {
        if (asset.path !== resolved.imagePath.workspacePath || !asset.mime.startsWith("image/")) {
          throw new Error("Local image response did not match the requested workspace asset.");
        }
        const bytes = decodeBase64Asset(asset.base64);
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: asset.mime }));
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          return;
        }
        setState({ status: "loaded", url: objectUrl, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            url: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [context, destination, parseError]);

  if (!parsed.ok) return <LocalImageError message={parsed.diagnostic.message} />;
  if (state.status === "error") {
    return <LocalImageError message={state.error ?? "Local image preview failed."} />;
  }
  if (!state.url) {
    return (
      <div
        data-testid="local-image-block"
        data-native-print-ready="false"
        className="my-1 rounded-md border border-border bg-muted/20 px-3 py-3 text-sm text-muted-foreground"
      >
        Loading local image…
      </div>
    );
  }
  return (
    <figure
      data-testid="local-image-block"
      data-native-print-ready={state.status === "ready" ? "true" : "false"}
      className="my-1 overflow-hidden rounded-lg border border-border bg-muted/10 p-2"
    >
      {/* Workspace bytes are exposed only through a revocable session Blob URL. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={state.url}
        alt={parsed.image.alt}
        title={parsed.image.title ?? undefined}
        className="mx-auto h-auto max-w-full rounded"
        onLoad={() => setState((current) => ({ ...current, status: "ready" }))}
        onError={() =>
          setState({ status: "error", url: null, error: "Local image could not be decoded." })
        }
      />
      {parsed.image.title ? (
        <figcaption className="pt-2 text-center text-xs text-muted-foreground">
          {parsed.image.title}
        </figcaption>
      ) : null}
    </figure>
  );
}

function LocalImageError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      data-testid="local-image-block"
      data-native-print-ready="true"
      className="my-1 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
    >
      {message}
    </div>
  );
}

function decodeBase64Asset(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  if (binary.length === 0 || binary.length > 20 * 1024 * 1024) {
    throw new Error("Local image payload has an invalid size.");
  }
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function WikiEmbedPreview({
  source,
  context,
  collectionContext,
  imageContext,
}: {
  source: string;
  context?: MarkdownWikiEmbedContext;
  collectionContext?: MarkdownCollectionContext;
  imageContext?: MarkdownImageContext;
}) {
  const reference = parseWikiEmbedBlock(source)!;
  const projection =
    context?.status === "ready" && context.index
      ? resolveWikiEmbed(context.index, context.sourcePath, source, {
          ancestry: context.ancestry,
          depth: context.depth,
        })
      : null;
  const embeddedBlocks = useMemo(
    () =>
      projection?.status === "resolved" && projection.markdown !== null
        ? MarkdownBlockDocument.fromMarkdown(projection.markdown).getSnapshot().blocks
        : [],
    [projection?.markdown, projection?.status]
  );
  const target = projection?.target ?? null;
  const label = reference.label ?? target?.title ?? reference.target;
  const loading = context?.status === "loading";
  const status = loading
    ? "Loading embedded Page…"
    : context?.status === "error" || !context?.index
      ? "Embedded Page preview is unavailable"
      : embedStatusText(projection?.status ?? "unresolved");
  const nestedContext =
    context && target && projection?.identity
      ? {
          ...context,
          sourcePageId: target.id,
          sourcePath: target.path,
          ancestry: [...context.ancestry, projection.identity],
          depth: context.depth + 1,
        }
      : undefined;
  const nestedImageContext =
    imageContext && target ? { ...imageContext, pagePath: target.path } : imageContext;
  const openNestedWikiLink = (rawTarget: string) => {
    if (!context?.index || !target) return;
    const resolution = resolveKnowledgeWikiPage(
      context.index.pages,
      target.path,
      wikiTargetPageText(rawTarget)
    );
    if (resolution.page) context.onOpenPage?.(resolution.page.id);
  };

  return (
    <figure
      data-testid="wiki-embed"
      data-wiki-embed
      data-native-print-ready={loading ? "false" : "true"}
      className="my-1 min-h-12 overflow-hidden rounded-lg border border-border bg-muted/20"
    >
      <figcaption className="flex items-center gap-2 border-b border-border/70 bg-muted/35 px-3 py-2 text-xs font-medium text-muted-foreground">
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {target && context?.onOpenPage ? (
          <button
            type="button"
            aria-label={`Open embedded Page: ${label}`}
            className="min-w-0 truncate text-left text-foreground hover:underline"
            onClick={(event) => {
              event.stopPropagation();
              context.onOpenPage?.(target.id);
            }}
          >
            {label}
          </button>
        ) : (
          <span className="min-w-0 truncate text-foreground">{label}</span>
        )}
        <code className="ml-auto max-w-[45%] truncate font-mono text-[10px] font-normal">
          {source}
        </code>
      </figcaption>

      {projection?.status === "resolved" ? (
        projection.markdown ? (
          <div className="space-y-0.5 px-3 py-2" data-wiki-embed-content>
            {embeddedBlocks.map((block) => (
              <BlockPreview
                key={block.id}
                block={block}
                readOnly
                onSetTaskChecked={() => undefined}
                onOpenWikiLink={openNestedWikiLink}
                wikiEmbedContext={nestedContext}
                collectionContext={collectionContext}
                imageContext={nestedImageContext}
              />
            ))}
          </div>
        ) : (
          <p className="px-3 py-2 text-sm text-muted-foreground">Empty Page</p>
        )
      ) : (
        <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
          {status}
        </p>
      )}
    </figure>
  );
}

function embedStatusText(status: WikiEmbedProjectionStatus): string {
  switch (status) {
    case "ambiguous":
      return "Embedded Page target is ambiguous";
    case "missing-fragment":
      return "Embedded heading is missing or ambiguous";
    case "cycle":
      return "Embed cycle detected";
    case "depth-exceeded":
      return "Embed depth limit reached";
    case "resolved":
      return "";
    default:
      return "Embedded Page was not found";
  }
}

function wikiTargetPageText(rawTarget: string): string {
  return rawTarget.split("|", 1)[0].split(/[\^#]/, 1)[0].trim();
}

function listItemPreview(
  source: string,
  kind: MarkdownBlockView["kind"]
): { marker: string; content: string } | null {
  if (kind === "task_list_item") {
    const match = source.match(/^[ \t]*[-+*][ \t]+\[[ xX]\]([ \t]+|$)/);
    return match ? { marker: "", content: source.slice(match[0].length) } : null;
  }
  if (kind === "bullet_list_item") {
    const match = source.match(/^[ \t]*[-+*]([ \t]+|$)/);
    return match ? { marker: "•", content: source.slice(match[0].length) } : null;
  }
  if (kind === "ordered_list_item") {
    const match = source.match(/^[ \t]*(\d{1,9}[.)])([ \t]+|$)/);
    return match ? { marker: match[1], content: source.slice(match[0].length) } : null;
  }
  return null;
}

function activeEditorSurfaceClass(block: MarkdownBlockView): string {
  const base = "native-block-editor-surface flex min-h-9 min-w-0 items-start";
  if (
    block.kind === "bullet_list_item" ||
    block.kind === "ordered_list_item" ||
    block.kind === "task_list_item"
  ) {
    return `${base} gap-2 px-1 py-1`;
  }
  if (block.kind === "blockquote") {
    return `${base} border-l-[3px] border-foreground px-3 py-1`;
  }
  return `${base} px-1 py-1`;
}

interface TablePreviewCell {
  text: string;
}

interface TablePreviewToken {
  type: "table";
  header: TablePreviewCell[];
  rows: TablePreviewCell[][];
}

function tablePreview(source: string): TablePreviewToken | null {
  try {
    const tokens = inlinePreviewLexer.lexer(source);
    const token = tokens.length === 1 ? tokens[0] : null;
    return token?.type === "table" ? (token as TablePreviewToken) : null;
  } catch {
    return null;
  }
}

function blockMathPreview(source: string): string {
  const lines = source.split(/\r\n|\n|\r/);
  if (lines.length >= 3 && /^ {0,3}\$\$[ \t]*$/.test(lines[0])) {
    return lines.slice(1, -1).join("\n").trim();
  }
  return source
    .replace(/^ {0,3}\$\$/, "")
    .replace(/\$\$[ \t]*$/, "")
    .trim();
}

function mermaidPreview(source: string): string {
  const lines = source.split(/\r\n|\n|\r/);
  return lines.length >= 2 ? lines.slice(1, -1).join("\n") : source;
}

function BlockMathPreview({ source }: { source: string }) {
  const latex = blockMathPreview(source);
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    if (!latex) return () => undefined;
    void loadKatex()
      .then((katex) => {
        if (cancelled) return;
        setHtml(
          katex.renderToString(latex, {
            displayMode: true,
            throwOnError: false,
            errorColor: "#ef4444",
            strict: "warn",
            trust: false,
          })
        );
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [latex]);

  return (
    <div
      data-testid="block-math-block"
      data-latex={latex}
      className="block-math-wrapper min-h-9 overflow-x-auto rounded-md bg-muted/35 px-3 py-2 text-center"
    >
      <div className="math-rendered">
        {html ? (
          <span dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code className="whitespace-pre-wrap font-serif text-base">{latex || " "}</code>
        )}
      </div>
    </div>
  );
}

function MermaidBlockPreview({ source }: { source: string }) {
  const code = mermaidPreview(source);
  const themeKey = useSyncExternalStore(subscribeMermaidTheme, getMermaidThemeKey, () => "ssr");
  const [svg, setSvg] = useState<string | null>(null);
  const [printSvg, setPrintSvg] = useState<string | null>(null);
  const [printReady, setPrintReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setPrintSvg(null);
    setPrintReady(false);
    if (!code.trim()) {
      setPrintReady(true);
      return () => undefined;
    }
    void (async () => {
      try {
        const rendered = await renderMermaidSvg(code);
        if (cancelled) return;
        setSvg(rendered);

        if (themeKey.endsWith("-dark")) {
          try {
            const printable = await renderMermaidSvgLight(code);
            if (!cancelled) setPrintSvg(printable);
          } catch {
            // The print-only fallback remains the local Mermaid source.
          }
        } else {
          setPrintSvg(rendered);
        }
      } catch {
        if (!cancelled) setSvg(null);
      } finally {
        if (!cancelled) setPrintReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, themeKey]);

  return (
    <figure
      data-testid="mermaid-block"
      data-code={code}
      data-mermaid-print-ready={printReady ? "true" : "false"}
      className="mermaid-chart-wrapper min-h-9 overflow-x-auto rounded-md border border-border bg-muted/25 px-3 py-2"
    >
      <figcaption className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Mermaid diagram
      </figcaption>
      <div data-mermaid-screen-preview className="mermaid-rendered">
        {svg ? (
          // Generated local SVGs have no stable dimensions or URL for next/image.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
            alt="Mermaid diagram"
            className="mx-auto h-auto max-w-full"
          />
        ) : (
          <pre className="whitespace-pre-wrap font-mono text-sm leading-6">
            <code>{code || " "}</code>
          </pre>
        )}
      </div>
      <div data-mermaid-print-preview className="hidden">
        {printSvg ? (
          // This light-themed copy exists only for local PDF output.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(printSvg)}`}
            alt=""
            aria-hidden="true"
            className="mx-auto h-auto max-w-full"
          />
        ) : (
          <pre className="whitespace-pre-wrap font-mono text-sm leading-6">
            <code>{code || " "}</code>
          </pre>
        )}
      </div>
    </figure>
  );
}

function calloutPreview(source: string): { type: string; title: string; body: string } | null {
  const lines = source.split(/\r\n|\n|\r/).map((line) => line.replace(/^ {0,3}>[ \t]?/, ""));
  const header = lines[0]?.match(/^\[!([A-Za-z][A-Za-z0-9_-]*)\][+-]?(?:[ \t]+(.*))?$/);
  if (!header) return null;
  return {
    type: header[1].toUpperCase(),
    title: header[2] ?? "",
    body: lines.slice(1).join("\n"),
  };
}

interface InlinePreviewToken {
  type: string;
  raw?: string;
  text?: string;
  href?: string;
  tokens?: InlinePreviewToken[];
}

function InlineMarkdownPreview({
  source,
  onOpenWikiLink,
}: {
  source: string;
  onOpenWikiLink?: (target: string) => void;
}) {
  let tokens: InlinePreviewToken[] = [];
  try {
    const block = inlinePreviewLexer.lexer(source)[0] as
      (InlinePreviewToken & { tokens?: InlinePreviewToken[] }) | undefined;
    tokens = block?.tokens ?? [{ type: "text", raw: source, text: source }];
  } catch {
    tokens = [{ type: "text", raw: source, text: source }];
  }
  return <>{renderInlineTokens(tokens, "inline", onOpenWikiLink)}</>;
}

function renderInlineTokens(
  tokens: InlinePreviewToken[],
  keyPrefix: string,
  onOpenWikiLink?: (target: string) => void
): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    const children = token.tokens?.length
      ? renderInlineTokens(token.tokens, key, onOpenWikiLink)
      : renderWikiText(token.text ?? token.raw ?? "", key, onOpenWikiLink);
    switch (token.type) {
      case "text":
      case "escape":
        return <Fragment key={key}>{children}</Fragment>;
      case "strong":
        return <strong key={key}>{children}</strong>;
      case "em":
        return <em key={key}>{children}</em>;
      case "del":
        return <del key={key}>{children}</del>;
      case "codespan":
        return (
          <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
            {token.text ?? ""}
          </code>
        );
      case "link":
        return (
          <span
            key={key}
            title={token.href}
            data-markdown-link
            className="text-primary underline decoration-primary/40 underline-offset-2"
          >
            {children}
          </span>
        );
      case "image":
        return (
          <span
            key={key}
            title={token.href}
            aria-label={`Image: ${token.text || token.href || "attachment"}`}
            className="rounded bg-muted px-1.5 py-0.5 text-sm text-muted-foreground"
          >
            {token.text || token.href || "Image"}
          </span>
        );
      case "br":
        return <br key={key} />;
      default:
        return <span key={key}>{children}</span>;
    }
  });
}

function renderWikiText(
  text: string,
  keyPrefix: string,
  onOpenWikiLink?: (target: string) => void
): ReactNode[] {
  return text.split(/(\[\[[^\]\r\n]+\]\])/g).map((part, index) => {
    const match = part.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
    if (!match) return part;
    const target = match[1];
    const label = match[2] ?? target;
    const className =
      "rounded bg-primary/10 px-0.5 text-primary underline decoration-primary/30 underline-offset-2";
    return onOpenWikiLink ? (
      <button
        type="button"
        key={`${keyPrefix}-wiki-${index}`}
        title={target}
        aria-label={`Open Page: ${label}`}
        data-wiki-link
        className={className}
        onClick={(event) => {
          event.stopPropagation();
          onOpenWikiLink(target);
        }}
      >
        {label}
      </button>
    ) : (
      <span key={`${keyPrefix}-wiki-${index}`} title={target} data-wiki-link className={className}>
        {label}
      </span>
    );
  });
}
