"use client";

import {
  FileText,
  Info,
  Lightbulb,
  Link as LinkIcon,
  Loader2,
  MessageSquareWarning,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import { createPortal } from "react-dom";
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
import {
  createBlockEditingProjection,
  splitDelimitedBlockSource,
} from "@/editor/markdown-block/block-editing-projection";
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
import {
  highlightCodeTokens,
  resolveCodeLanguage,
  type CodeToken,
} from "@/editor/markdown-block/code-highlight";
import { parseMarkdownToggle } from "@/editor/markdown-block/markdown-toggle";
import {
  markdownTableBlankRow,
  markdownTableCellAt,
  markdownTableNeighbourCell,
  parseMarkdownTableSource,
} from "@/editor/markdown-block/markdown-table";
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
  dropBefore?: boolean;
  selection?: { anchor: number; head: number };
  onActivate: (blockId: string, selection?: { anchor: number; head: number }) => void;
  onSelectBlock?: (blockId: string, extend?: boolean) => void;
  onBlockSelectionKeyDown?: (blockId: string, event: KeyboardEvent<HTMLDivElement>) => void;
  /** Grows a text selection past the Block boundary into a Block selection. */
  onExtendSelectionToBlock?: (blockId: string, direction: -1 | 1) => boolean;
  onChange: (blockId: string, source: string) => void;
  onPaste: (blockId: string, from: number, to: number, text: string) => void;
  onApplyInlineFormat?: (
    blockId: string,
    from: number,
    to: number,
    format: MarkdownInlineFormat
  ) => void;
  /** Commits a link with a destination the user typed, over the given source range. */
  onEditLink?: (blockId: string, from: number, to: number, url: string) => void;
  /** Moves the caret to a source range inside the Block, without changing anything. */
  onSelectCellRange?: (blockId: string, from: number, to: number) => void;
  onImportImages?: (blockId: string, from: number, to: number, files: readonly File[]) => void;
  onCompositionStart: (blockId: string) => void;
  onCompositionEnd: (blockId: string) => void;
  onSplit: (blockId: string, from: number, to: number) => void;
  onMergeBackward: (blockId: string) => void;
  onMergeForward?: (blockId: string) => void;
  onInsertAfter: (blockId: string, placement?: "below" | "above") => void;
  onCopyMarkdown?: (blockId: string) => void | Promise<void>;
  onDuplicate: (blockId: string) => void;
  onDelete: (blockId: string) => void;
  onSetTaskChecked: (blockId: string, checked: boolean) => void;
  /** Rewrites just the info string on a fenced Block's opening delimiter line. */
  onSetCodeLanguage?: (blockId: string, language: string) => void;
  onMove: (blockId: string, direction: -1 | 1) => boolean | void;
  onIndent?: (
    blockId: string,
    direction: -1 | 1,
    selection: { anchor: number; head: number }
  ) => boolean | void;
  onNavigate?: (blockId: string, direction: -1 | 1, caretX?: number) => boolean;
  onSetKind: (
    blockId: string,
    kind: MarkdownSettableBlockKind,
    level?: 1 | 2 | 3 | 4 | 5 | 6
  ) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDragStart: (blockId: string, event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onOpenWikiLink?: (target: string) => void;
  wikiEmbedContext?: MarkdownWikiEmbedContext;
  collectionContext?: MarkdownCollectionContext;
  imageContext?: MarkdownImageContext;
  onRunSlashCommand?: (
    blockId: string,
    commandId: MarkdownSlashCommandId,
    run: MarkdownSlashRun
  ) => void;
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
  dropBefore = false,
  selection,
  onActivate,
  onSelectBlock,
  onBlockSelectionKeyDown,
  onExtendSelectionToBlock,
  onChange,
  onPaste,
  onApplyInlineFormat,
  onEditLink,
  onSelectCellRange,
  onImportImages,
  onCompositionStart,
  onCompositionEnd,
  onSplit,
  onMergeBackward,
  onMergeForward,
  onInsertAfter,
  onCopyMarkdown,
  onDuplicate,
  onDelete,
  onSetTaskChecked,
  onSetCodeLanguage,
  onMove,
  onIndent,
  onNavigate,
  onSetKind,
  onUndo,
  onRedo,
  onDragStart,
  onDragEnd,
  onOpenWikiLink,
  wikiEmbedContext,
  collectionContext,
  imageContext,
  onRunSlashCommand,
}: MarkdownBlockRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorId = `native-block-editor-${block.id}`;
  const descriptionId = NATIVE_BLOCK_SHORTCUTS_ID;
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
  // Opening the grip menu moves focus into a portalled dropdown, which takes the row out of
  // `:hover`/`:focus-within` and used to fade the very control the menu is attached to.
  const [controlsMenuOpen, setControlsMenuOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  // Keyed on the trigger character's offset, not on the source string. Escaping a menu whose key
  // was the source text reopened it on the very next keystroke, so the menu fought the user.
  const [dismissedSlashStart, setDismissedSlashStart] = useState<number | null>(null);
  const [slashPosition, setSlashPosition] = useState<SlashMenuPosition | null>(null);
  const slashListRef = useRef<HTMLDivElement>(null);
  const [linkEditor, setLinkEditor] = useState<{
    from: number;
    to: number;
    url: string;
    position: { top: number; left: number };
  } | null>(null);
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
  const pendingClickOffsetRef = useRef<number | null>(null);
  /** Where a press landed when it hit the row's own spacing rather than any child of it. */
  const rowPressRef = useRef<{ x: number; y: number } | null>(null);
  const composingRef = useRef(false);
  /**
   * The textarea's own value while an IME composition is open.
   *
   * A controlled `value={source}` fights the IME: every mid-composition keystroke round-trips
   * through the document, React writes the derived string back into the element, and Chromium
   * cancels the candidate window. Holding the DOM value locally until `compositionend` means React
   * never reassigns it mid-composition, and exactly one command is issued for the settled text.
   */
  const [composingValue, setComposingValue] = useState<string | null>(null);
  // The slash menu is anchored to the caret, not to the whole Block. Deriving the trigger from
  // `/^\/.*$/` over the entire source meant the menu only ever opened on a paragraph whose *only*
  // content was the query — you could not type `Next steps: /table`, and no list item, heading or
  // quote could reach it at all.
  const [caretOffset, setCaretOffset] = useState<number | null>(null);
  const noteCaretOffset = (offset: number) => {
    // Only the slash run needs a live caret. Storing it unconditionally would re-render the row on
    // every arrow key; `null` short-circuits to React's bail-out when no trigger char is present.
    setCaretOffset(SLASH_TRIGGER_PATTERN.test(source) ? offset : null);
  };
  // While an IME composition is open the model deliberately lags the DOM, so the menu filters on the
  // live text. That is what makes `/` + pinyin narrow as you type, the way Feishu's insert panel
  // does — and it is safe because Enter belongs to the IME until the composition commits, so the
  // offsets used to execute a command always come from committed text.
  const liveSource = composingValue ?? source;
  const slashRun =
    active && block.editable && !sourceOnly && onRunSlashCommand
      ? slashRunAt(
          liveSource,
          composingValue === null
            ? (caretOffset ?? editorSelectionRef.current.head)
            : liveSource.length
        )
      : null;
  const slashQuery = slashRun?.query ?? null;
  const slashStart = slashRun?.start ?? null;
  const slashCommands = useMemo(
    () => (slashQuery === null ? [] : searchMarkdownSlashCommands(slashQuery)),
    [slashQuery]
  );
  // Stays open with zero matches so Enter cannot silently split the Block behind an open menu.
  const slashMenuOpen = slashStart !== null && dismissedSlashStart !== slashStart;
  const activeListItem = listItemPreview(rawSource, block.kind);

  useEffect(() => {
    setSlashIndex(0);
  }, [slashQuery]);

  useEffect(() => {
    // Forget the dismissal once the caret leaves the run it dismissed, so a later `/` in the same
    // Block opens normally.
    if (dismissedSlashStart !== null && slashStart !== dismissedSlashStart) {
      setDismissedSlashStart(null);
    }
  }, [dismissedSlashStart, slashStart]);

  useEffect(() => {
    if (!slashMenuOpen) {
      setSlashPosition(null);
      return;
    }
    const surface = rowRef.current?.querySelector<HTMLElement>("[data-native-block-editor]");
    if (!surface || slashStart === null) return;
    const measure = () => setSlashPosition(slashMenuPosition(surface, slashStart));
    measure();
    const scroller = surface.closest("[data-native-markdown-scroll]");
    scroller?.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      scroller?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [slashMenuOpen, slashStart, slashCommands.length]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    slashListRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [slashIndex, slashMenuOpen]);

  // Which surface rendered last. Typing `**bold**` flips the Block from the raw textarea to the
  // semantic surface (and undo flips it back). React unmounts one and mounts the other, so unless
  // the caret is carried across explicitly it lands at offset 0 and the next keystroke goes to the
  // wrong place — the single worst "the caret lies" bug in the editor.
  const surfaceKind = useSemanticInlineEditor ? "semantic" : "textarea";
  const previousSurfaceRef = useRef(surfaceKind);
  const carriedSelectionRef = useRef<SemanticInlineSelection | null>(null);
  const lastSelectionPropRef = useRef(selection);
  if (selection !== lastSelectionPropRef.current) {
    lastSelectionPropRef.current = selection;
    carriedSelectionRef.current = null;
  }
  if (previousSurfaceRef.current !== surfaceKind) {
    previousSurfaceRef.current = surfaceKind;
    carriedSelectionRef.current = active ? editorSelectionRef.current : null;
  }
  const restoredSelection = selection ?? carriedSelectionRef.current ?? undefined;

  useEffect(() => {
    if (!active) return;
    editorSelectionRef.current = restoredSelection ?? {
      anchor: sourceLengthRef.current,
      head: sourceLengthRef.current,
    };
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (autoFocusEditor) textarea.focus();
    if (restoredSelection) {
      const anchor = Math.min(restoredSelection.anchor, textarea.value.length);
      const head = Math.min(restoredSelection.head, textarea.value.length);
      textarea.setSelectionRange(anchor, head);
    } else {
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
    autosizeTextarea(textarea);
  }, [active, autoFocusEditor, restoredSelection, surfaceKind]);

  useEffect(() => {
    if (blockSelectionFocus) rowRef.current?.focus();
  }, [blockSelectionFocus]);

  useEffect(() => {
    if (!active || sourceOnly) setInlineSelection(null);
  }, [active, sourceOnly]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    if (composingRef.current) {
      // Track the DOM value so React's controlled value keeps matching it, but issue no command:
      // an IME composition is one edit, committed once at `compositionend`.
      setComposingValue(event.target.value);
      autosizeTextarea(event.target);
      return;
    }
    setInlineSelection(null);
    // Mirror the post-input caret before the source change can swap the editing surface.
    editorSelectionRef.current = {
      anchor: event.target.selectionStart,
      head: event.target.selectionEnd,
    };
    noteCaretOffset(event.target.selectionEnd);
    onChange(block.id, event.target.value);
    autosizeTextarea(event.target);
  };

  const handleEditorKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    editorSelection: SemanticInlineSelection,
    editorLength: number
  ) => {
    const from = Math.min(editorSelection.anchor, editorSelection.head);
    const to = Math.max(editorSelection.anchor, editorSelection.head);
    if (event.nativeEvent.isComposing) return;
    // Boundary tests must run in the offsets the user can actually see. The semantic surface
    // hides Markdown delimiters, so source offset 2 of `**bold**` is visible offset 0 — testing
    // `from === 0` there makes every boundary key silently do nothing.
    const collapsed = from === to;
    const visibleRange = useSemanticInlineEditor
      ? inlineProjection.sourceRangeToVisible({ from, to })
      : { from, to };
    const visibleLength = useSemanticInlineEditor
      ? inlineProjection.visibleText.length
      : editorLength;
    const atVisibleStart = collapsed && visibleRange.from === 0;
    const atVisibleEnd = collapsed && visibleRange.to === visibleLength;
    if (slashMenuOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (slashCommands.length === 0) return;
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setSlashIndex(
          (current) => (current + direction + slashCommands.length) % slashCommands.length
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        // Swallowed even with no match: the menu is on screen, so Enter belongs to it.
        event.preventDefault();
        const command = slashCommands[slashIndex] ?? slashCommands[0];
        if (command && slashRun) onRunSlashCommand?.(block.id, command.id, slashRun);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        // Leaves the literal `/` the user typed in place — dismissing is never an edit.
        setDismissedSlashStart(slashRun?.start ?? null);
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
    if ((event.metaKey || event.ctrlKey) && !event.altKey) {
      // Inline formatting shortcuts. `stopPropagation` matters as much as `preventDefault`: the
      // window-level handler owns Mod+K for the command palette and the app menu shows Mod+B for
      // the sidebar, so without it one keystroke would fire two things.
      const shortcut = inlineFormatShortcut(event);
      // Mod+K also works from a collapsed caret inside an existing link, which is how you edit its
      // destination. Every other format needs something selected to act on.
      if (
        shortcut === "link" &&
        onEditLink &&
        (from < to || existingLinkDestination(source, from, to))
      ) {
        event.preventDefault();
        event.stopPropagation();
        openLinkEditor(from, to);
        return;
      }
      if (shortcut && shortcut !== "link" && onApplyInlineFormat && from < to) {
        event.preventDefault();
        event.stopPropagation();
        onApplyInlineFormat(block.id, from, to, shortcut);
        return;
      }
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
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "d") {
      // Both Mod+D (Notion, Feishu) and Mod+Shift+D (what this editor shipped) duplicate.
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
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === "/") {
      // Keyboard route into the Block menu. Tab is a structural key inside the editor (below), so
      // this replaces the old "Shift+Tab walks to the gutter buttons" route.
      event.preventDefault();
      openBlockActionsMenu();
      return;
    }
    if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      // Tab never leaves the document while a Block is being edited. Notion and Feishu both
      // treat it as a structural key inside the editor; letting the browser move focus to the
      // next tab stop drops the caret and the user's place in the Page.
      event.preventDefault();
      if (isListBlockKind(block.kind) && onIndent) {
        onIndent(block.id, event.shiftKey ? -1 : 1, {
          anchor: editorSelection.anchor,
          head: editorSelection.head,
        });
        return;
      }
      if (block.kind === "table" && onPaste) {
        const geometry = parseMarkdownTableSource(source);
        const current = geometry ? markdownTableCellAt(geometry, from) : null;
        if (geometry && current) {
          const next = markdownTableNeighbourCell(geometry, current, event.shiftKey ? -1 : 1);
          if (next) {
            onSelectCellRange?.(block.id, next.from, next.to);
          } else if (!event.shiftKey) {
            // Tab out of the last cell adds a row, the way it does in both reference products.
            onPaste(
              block.id,
              geometry.appendAt,
              geometry.appendAt,
              markdownTableBlankRow(geometry)
            );
          }
          return;
        }
      }
      if (indentsWithSpaces(block.kind)) {
        const shifted = shiftSourceIndent(source, from, to, event.shiftKey ? -1 : 1);
        if (shifted) {
          onPaste(block.id, shifted.from, shifted.to, shifted.text);
        }
      }
      return;
    }
    if (
      onExtendSelectionToBlock &&
      event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      ((event.key === "ArrowUp" && visibleRange.from === 0) ||
        (event.key === "ArrowDown" && visibleRange.to === visibleLength))
    ) {
      // The head has run out of text in this direction, so keep extending into the next Block.
      const direction = event.key === "ArrowUp" ? -1 : 1;
      if (onExtendSelectionToBlock(block.id, direction)) event.preventDefault();
      return;
    }
    if (
      onNavigate &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      collapsed &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      // Leave the Block only from its first/last *visual* line, so a wrapped paragraph lets the
      // caret walk its own lines first. `caretLineBoundary` reports the caret's x so the target
      // Block can place the caret in the same column instead of at offset 0 / end.
      const direction = event.key === "ArrowUp" ? -1 : 1;
      const boundary = caretLineBoundary(event.currentTarget, from);
      const leaving = boundary
        ? direction === -1
          ? boundary.atFirstLine
          : boundary.atLastLine
        : direction === -1
          ? atVisibleStart
          : atVisibleEnd;
      if (leaving && onNavigate(block.id, direction, boundary?.caretX)) event.preventDefault();
      return;
    }
    if (
      onNavigate &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      ((event.key === "ArrowLeft" && atVisibleStart) ||
        (event.key === "ArrowRight" && atVisibleEnd))
    ) {
      // ArrowLeft at the start lands at the END of the previous Block, and ArrowRight at the end
      // lands at offset 0 of the next one — `navigateBlock` already picks those offsets.
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      if (onNavigate(block.id, direction)) event.preventDefault();
      return;
    }
    if (
      onMergeForward &&
      event.key === "Delete" &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !sourceOnly &&
      atVisibleEnd
    ) {
      event.preventDefault();
      onMergeForward(block.id);
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
        isListBlockKind(block.kind) &&
        onIndent
      ) {
        onIndent(block.id, -1, { anchor: 0, head: 0 });
        return;
      }
      // At a visible boundary the source offset may sit *inside* a delimiter run, so splitting
      // there would tear `**bold**` into `**` and `bold**`. Snap to the Block's source edges.
      if (atVisibleStart) onSplit(block.id, 0, 0);
      else if (atVisibleEnd) onSplit(block.id, source.length, source.length);
      else onSplit(block.id, from, to);
      return;
    }
    if (!sourceOnly && event.key === "Backspace" && atVisibleStart) {
      event.preventDefault();
      if ((block.depth ?? 0) > 0 && isListBlockKind(block.kind) && onIndent) {
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
    }
    // A Block drop is left to bubble: the container owns the boundary and the command.
  };

  const updateInlineSelection = (textarea: HTMLTextAreaElement) => {
    const from = Math.min(textarea.selectionStart, textarea.selectionEnd);
    const to = Math.max(textarea.selectionStart, textarea.selectionEnd);
    editorSelectionRef.current = {
      anchor: textarea.selectionStart,
      head: textarea.selectionEnd,
    };
    noteCaretOffset(textarea.selectionEnd);
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
    noteCaretOffset(nextSelection.head);
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

  /**
   * Open the link editor over a selection.
   *
   * Prefilled from the link the selection already sits inside, so Mod+K on an existing link edits
   * its destination instead of nesting a new link inside it.
   */
  const openLinkEditor = (from: number, to: number) => {
    const surface = rowRef.current?.querySelector<HTMLElement>("[data-native-block-editor]");
    const position = surface
      ? surface instanceof HTMLTextAreaElement
        ? textareaSelectionToolbarPosition(surface, from, to)
        : domSelectionToolbarPosition(surface)
      : { top: 0, left: 0 };
    setInlineSelection(null);
    setLinkEditor({ from, to, url: existingLinkDestination(source, from, to), position });
  };

  const openBlockActionsMenu = () => {
    setInlineSelection(null);
    rowRef.current?.querySelector<HTMLButtonElement>('button[aria-label="Block actions"]')?.click();
  };

  return (
    <div
      ref={rowRef}
      // The selection fill is drawn by `[data-native-block-row]::after` in editor.css so it starts
      // at the content rail and never bleeds across the control gutter. Hovering paints nothing —
      // see the note there for why the tint that used to live on that pseudo-element is gone.
      className="group/native-block relative flex min-h-9 items-start gap-[6px] rounded-md py-0.5 pl-1 pr-1"
      data-block-id={block.id}
      data-block-kind={block.kind}
      data-block-level={block.level}
      data-block-depth={block.depth}
      data-native-block-row
      data-active={active ? "true" : "false"}
      data-block-selected={blockSelected ? "true" : undefined}
      data-drop-before={dropBefore ? "true" : undefined}
      data-controls-open={controlsMenuOpen ? "true" : undefined}
      role="group"
      aria-label={`${blockTypeLabel(block)}, block ${index + 1} of ${count}`}
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
      onPointerDown={(event) => {
        rowPressRef.current =
          event.target === event.currentTarget ? { x: event.clientX, y: event.clientY } : null;
      }}
      onClick={(event) => {
        // The row's leading spacing is `padding-top` on the row itself — up to 28px above an h1 —
        // so it belongs to the row and to no child, while every handler that activates a Block sits
        // on the content box. The strip therefore hovered like a live part of the Block, revealed
        // its controls, and then swallowed the press. A reader sees that gap as part of the heading
        // under it and expects a caret from it.
        const press = rowPressRef.current;
        rowPressRef.current = null;
        if (!press || event.target !== event.currentTarget) return;
        if (active || !block.editable) return;
        // A sweep that begins in this strip is a Block-selection gesture: the container engages a
        // marquee past 4px of travel, and activating on the click that follows would tear the
        // selection down again.
        if (Math.abs(event.clientX - press.x) > 4 || Math.abs(event.clientY - press.y) > 4) return;
        onActivate(block.id);
      }}
      onDragOver={(event) => {
        // Only image files are a row-level concern. Block reordering is decided once, at the
        // container, from a boundary table — a row can only see the pointer inside its own box, so
        // deciding there made the insertion line flip on whichever row got the event.
        if (!sourceOnly && rasterFiles(event.dataTransfer).length) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={handleDrop}
    >
      <div
        data-native-block-controls
        // Reveal/hide timing and first-line alignment live in editor.css.
        className="flex w-[54px] shrink-0 items-start justify-end"
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
          buttonTabIndex={active || blockSelectionFocus ? 0 : -1}
          describedBy={descriptionId}
          onMenuOpenChange={setControlsMenuOpen}
          onAdd={(placement) => onInsertAfter(block.id, placement)}
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
        data-native-block-content
        className="min-w-0 flex-1"
        onPointerDownCapture={(event) => {
          // Activating a Block must keep the caret where the user clicked. Without this the
          // rendered preview is replaced by an editing surface that focuses at end-of-Block, so
          // clicking into the middle of a paragraph silently jumps to its end.
          // `> 0` rather than `!== 0`, so a synthesised event with no `button` still counts as
          // primary instead of being silently ignored.
          if (active || !block.editable || event.button > 0 || event.shiftKey) return;
          if ((event.target as HTMLElement | null)?.closest("a,button,input,label")) return;
          // A table renders as a grid, so a plain caret hit-test would land nowhere useful. Each
          // cell carries the source offset of its own text instead.
          const tableCell = (event.target as HTMLElement | null)?.closest<HTMLElement>(
            "[data-table-cell]"
          );
          if (tableCell) {
            pendingClickOffsetRef.current = Number(tableCell.dataset.tableCell);
            return;
          }
          const offset = sourceOffsetAtPoint(
            event.clientX,
            event.clientY,
            event.currentTarget,
            source,
            sourceOnly ? null : inlineProjection
          );
          if (offset === null) return;
          pendingClickOffsetRef.current = offset;
        }}
        onClick={(event) => {
          // Inside the Block being edited, Shift+click is the browser's own "extend the text
          // selection to here". Hijacking it tore down the editor mid-gesture.
          if (event.shiftKey && !active) {
            event.preventDefault();
            onSelectBlock?.(block.id, true);
            return;
          }
          if (!active && block.editable) {
            const anchor = pendingClickOffsetRef.current;
            pendingClickOffsetRef.current = null;
            if (anchor === null) {
              onActivate(block.id);
              return;
            }
            // Press, drag, release is how text gets selected. Activating with a collapsed caret at
            // the press point threw the drag away, so selecting a word in a Block you were not
            // already editing selected nothing at all — the gesture worked only on the second try,
            // once the Block happened to be active. The release point is this event's own
            // coordinates, and the preview is still mounted here, so it can still be hit-tested.
            //
            // A table is excluded: its cells carry their own source offsets precisely because a
            // rendered grid has no linear mapping from a point to a source offset, so a range
            // measured across it would not mean anything.
            const fromTableCell = (event.target as HTMLElement | null)?.closest(
              "[data-table-cell]"
            );
            const head = fromTableCell
              ? anchor
              : (sourceOffsetAtPoint(
                  event.clientX,
                  event.clientY,
                  event.currentTarget,
                  source,
                  sourceOnly ? null : inlineProjection
                ) ?? anchor);
            onActivate(block.id, { anchor, head });
          }
        }}
      >
        {active && block.editable ? (
          <>
            <div
              data-native-block-edit-surface
              data-editor-kind={block.kind}
              data-editor-level={block.level}
              className={`relative ${activeEditorSurfaceClass(block)}`}
            >
              {block.kind === "fenced_code" && onSetCodeLanguage ? (
                <CodeLanguageChip
                  language={splitDelimitedBlockSource("fenced_code", rawSource)?.infoString ?? ""}
                  onCommit={(language) => onSetCodeLanguage(block.id, language)}
                />
              ) : null}
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
                  selection={restoredSelection}
                  autoFocus={autoFocusEditor}
                  highlightSelection={highlightSelection}
                  placeholder={source.length === 0 ? blockPlaceholder(block) : undefined}
                  className="native-block-textarea block min-w-0 flex-1 whitespace-pre-wrap break-words bg-transparent outline-none"
                  onSourceChange={(nextSource, nextSelection) => {
                    editorSelectionRef.current = nextSelection;
                    noteCaretOffset(nextSelection.head);
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
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Meta+D Control+D Meta+Shift+Backspace Control+Shift+Backspace"
                  data-native-block-editor
                  className={`native-block-textarea block min-w-0 flex-1 resize-none overflow-hidden bg-transparent outline-none ${
                    sourceOnly ? "font-mono" : ""
                  }`}
                  value={composingValue ?? source}
                  rows={1}
                  placeholder={source.length === 0 ? blockPlaceholder(block) : undefined}
                  // Browser spellcheck squiggles under code, LaTeX and diagram source are noise.
                  spellCheck={!sourceOnly}
                  onChange={handleChange}
                  onPaste={handlePaste}
                  onCompositionStart={(event) => {
                    composingRef.current = true;
                    setInlineSelection(null);
                    setComposingValue(event.currentTarget.value);
                    onCompositionStart(block.id);
                  }}
                  onCompositionUpdate={(event) => setComposingValue(event.currentTarget.value)}
                  onCompositionEnd={(event) => {
                    composingRef.current = false;
                    const settled = event.currentTarget.value;
                    setComposingValue(null);
                    onCompositionEnd(block.id);
                    if (settled !== source) onChange(block.id, settled);
                  }}
                  onKeyDown={handleTextareaKeyDown}
                  onKeyUp={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    updateInlineSelection(event.currentTarget);
                  }}
                  onMouseUp={(event) => updateInlineSelection(event.currentTarget)}
                  onSelect={(event) => {
                    if (composingRef.current) return;
                    updateInlineSelection(event.currentTarget);
                  }}
                />
              )}
            </div>
            {linkEditor ? (
              <LinkEditPopover
                url={linkEditor.url}
                position={linkEditor.position}
                onCancel={() => setLinkEditor(null)}
                onCommit={(url) => {
                  setLinkEditor(null);
                  if (url.trim()) onEditLink?.(block.id, linkEditor.from, linkEditor.to, url);
                }}
              />
            ) : null}
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
                if (inlineSelection) openLinkEditor(inlineSelection.from, inlineSelection.to);
              }}
              onCode={() => {
                if (inlineSelection) {
                  onApplyInlineFormat?.(block.id, inlineSelection.from, inlineSelection.to, "code");
                  setInlineSelection(null);
                }
              }}
              onMore={openBlockActionsMenu}
            />
            {slashMenuOpen && slashPosition
              ? createPortal(
                  <div
                    ref={slashListRef}
                    role="listbox"
                    aria-label="Block commands"
                    // Portalled onto `document.body`, so the runtime's "pressed outside the editor,
                    // release the caret" listener would otherwise close the Block this panel edits.
                    data-native-editor-overlay
                    style={{
                      position: "fixed",
                      top: slashPosition.top,
                      left: slashPosition.left,
                      maxHeight: slashPosition.maxHeight,
                      transform: slashPosition.flipped ? "translateY(-100%)" : undefined,
                    }}
                    // Notion's measured slash panel: 314px wide, 10px radius, opaque, layered
                    // shadow with a hairline ring. No transition on `top`/`left` — the panel is
                    // caret-anchored, and animating it would read as the menu lagging the caret.
                    className="z-50 w-[min(314px,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-[10px] bg-popover p-1.5 text-popover-foreground shadow-[0_20px_24px_rgba(25,25,25,0.05),0_5px_8px_rgba(25,25,25,0.027),0_0_0_1px_hsl(var(--border))]"
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    {slashCommands.length === 0 ? (
                      <p
                        role="option"
                        aria-selected={false}
                        aria-disabled="true"
                        className="px-3 py-5 text-center text-xs text-muted-foreground"
                      >
                        No matching blocks
                      </p>
                    ) : (
                      slashCommands.map((command, commandIndex) => (
                        <button
                          key={command.id}
                          type="button"
                          role="option"
                          tabIndex={-1}
                          aria-selected={commandIndex === slashIndex}
                          className={`flex h-[31px] w-full items-center gap-2.5 rounded-md px-2 text-left transition-colors duration-[20ms] ease-in ${
                            commandIndex === slashIndex ? "bg-accent text-accent-foreground" : ""
                          }`}
                          // `mousemove`, not `mouseenter`: a menu that repositions under a still
                          // pointer must not steal the keyboard cursor the user is driving.
                          onMouseMove={() => setSlashIndex(commandIndex)}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (slashRun) onRunSlashCommand?.(block.id, command.id, slashRun);
                          }}
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
                            <SlashCommandIcon name={command.icon} />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm">{command.title}</span>
                          {command.shortcut ? (
                            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                              {command.shortcut}
                            </span>
                          ) : null}
                        </button>
                      ))
                    )}
                  </div>,
                  document.body
                )
              : null}
            <div data-native-block-print-preview className="hidden">
              <BlockPreview
                block={block}
                onSetTaskChecked={onSetTaskChecked}
                onSetCodeLanguage={onSetCodeLanguage}
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
            onSetCodeLanguage={onSetCodeLanguage}
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

/** `/` is the Notion trigger; `、` is the fullwidth one Feishu accepts, so a CJK keyboard needs no
 * mode switch to reach the menu. */
const SLASH_TRIGGER_PATTERN = /[/、]/;

/**
 * Id of the one shortcut legend, rendered by the runtime.
 *
 * Every row used to render its own copy in an `sr-only` span. A DOM Range spanning two rows picked
 * those up, so copying across Blocks pasted "Press Enter to edit…" into the user's clipboard.
 */
export const NATIVE_BLOCK_SHORTCUTS_ID = "native-block-shortcuts";

export interface MarkdownSlashRun {
  /** Offset of the trigger character in the Block's editor source. */
  readonly start: number;
  /** Offset just past the caret — the end of the text the command will replace. */
  readonly end: number;
  readonly query: string;
}

/**
 * The `/query` run the caret currently sits in, or null.
 *
 * Scans back from the caret to the nearest trigger character with no whitespace in between, and
 * requires that character to start a word. That last rule is what keeps `src/lib`, `and/or` and
 * `2026/07` typeable without the menu jumping in.
 */
function slashRunAt(source: string, caret: number): MarkdownSlashRun | null {
  const end = Math.min(Math.max(caret, 0), source.length);
  for (let index = end - 1; index >= 0; index -= 1) {
    const char = source[index];
    if (char === "\n" || char === "\r") return null;
    if (!SLASH_TRIGGER_PATTERN.test(char)) {
      if (/\s/.test(char)) return null;
      continue;
    }
    const previous = index > 0 ? source[index - 1] : "";
    if (previous && !/[\s(（【[「]/.test(previous)) return null;
    return { start: index, end, query: source.slice(index + 1, end) };
  }
  return null;
}

interface SlashMenuPosition {
  top: number;
  left: number;
  maxHeight: number;
  flipped: boolean;
}

/**
 * Place the slash menu against the caret, flipping above it near the bottom of the viewport and
 * clamping horizontally so it is never clipped.
 */
function slashMenuPosition(surface: HTMLElement, triggerOffset: number): SlashMenuPosition {
  const rect =
    surface instanceof HTMLTextAreaElement
      ? textareaCaretRect(surface, triggerOffset)
      : domCaretRect(surface);
  const fallback = surface.getBoundingClientRect();
  const anchorTop = rect?.top ?? fallback.top;
  const anchorBottom = rect?.bottom ?? fallback.bottom;
  const anchorLeft = rect?.left ?? fallback.left;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const width = Math.min(314, Math.max(viewportWidth - 32, 200));
  const gap = 8;
  const below = viewportHeight - anchorBottom - gap - 16;
  const above = anchorTop - gap - 16;
  const flipped = below < 200 && above > below;
  return {
    top: flipped ? anchorTop - gap : anchorBottom + gap,
    left: Math.min(Math.max(anchorLeft, 8), Math.max(viewportWidth - width - 8, 8)),
    maxHeight: Math.max(Math.min(flipped ? above : below, 320), 120),
    flipped,
  };
}

/** Renders a command's Lucide icon by name, falling back to a neutral glyph. */
function SlashCommandIcon({ name }: { name: string }) {
  const icons = LucideIcons as unknown as Record<string, LucideIcon | undefined>;
  const Icon = icons[name] ?? LucideIcons.Pilcrow;
  return <Icon className="h-4 w-4" aria-hidden="true" />;
}

interface CaretPointHost {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
}

/**
 * Resolve a viewport point inside a Block's rendered preview to an offset in the Block's editor
 * source, so activating a Block can put the caret exactly where the pointer landed.
 *
 * The preview shows the *visible* projection (Markdown delimiters hidden), so the character index
 * measured against the DOM has to be mapped back through the inline projection. When the Block is
 * edited as raw source the preview text and the editor text are the same string and no mapping is
 * needed.
 */
export function sourceOffsetAtPoint(
  x: number,
  y: number,
  container: HTMLElement,
  source: string,
  projection: ReturnType<typeof projectMarkdownInline> | null
): number | null {
  const host = document as unknown as CaretPointHost;
  let node: Node | null = null;
  let offset = 0;
  const position = host.caretPositionFromPoint?.(x, y);
  if (position) {
    node = position.offsetNode;
    offset = position.offset;
  } else {
    const range = host.caretRangeFromPoint?.(x, y);
    if (!range) return null;
    node = range.startContainer;
    offset = range.startOffset;
  }
  if (!node || node.nodeType !== Node.TEXT_NODE || !container.contains(node)) return null;
  const visibleOffset = textOffsetWithin(container, node, offset);
  if (visibleOffset === null) return null;
  if (!projection || projection.visibleText === source) {
    return Math.min(visibleOffset, source.length);
  }
  const clamped = Math.min(visibleOffset, projection.visibleText.length);
  return projection.visibleOffsetToSource(clamped, "forward");
}

/**
 * Character offset of `(node, offset)` counted over the text content of `container`, skipping
 * decoration that is not part of the Block's text — the list bullet and ordinal are `aria-hidden`
 * spans rendered next to the content and counting them would shift every mapped offset.
 */
function textOffsetWithin(container: HTMLElement, node: Node, offset: number): number | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (candidate) =>
      candidate.parentElement?.closest('[aria-hidden="true"]')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  let total = 0;
  let current = walker.nextNode();
  while (current) {
    if (current === node) return total + offset;
    total += current.textContent?.length ?? 0;
    current = walker.nextNode();
  }
  return null;
}

let fieldSizingSupport: boolean | null = null;

/**
 * Grow the textarea to fit its content.
 *
 * The old implementation wrote `height: 0px`, read `scrollHeight`, then wrote the real height —
 * two forced synchronous layouts of the whole Page on every keystroke. Where `field-sizing` is
 * available (Chromium 123+, so every packaged build) CSS does this for free and we do nothing.
 */
function autosizeTextarea(textarea: HTMLTextAreaElement): void {
  fieldSizingSupport ??= "fieldSizing" in document.documentElement.style;
  if (fieldSizingSupport) return;
  textarea.style.height = "auto";
  const next = `${Math.max(textarea.scrollHeight, 36)}px`;
  if (textarea.style.height !== next) textarea.style.height = next;
}

/**
 * Icon and accent per GitHub-flavoured callout type.
 *
 * Derived from the `[!TYPE]` marker in the source, so the whole appearance round-trips through the
 * Markdown with nothing stored beside it.
 */
const CALLOUT_STYLES: Record<
  string,
  { icon: LucideIcon; label: string; container: string; accent: string }
> = {
  note: {
    icon: Info,
    label: "Note",
    container: "border-sky-500/25 bg-sky-500/[0.06]",
    accent: "text-sky-600 dark:text-sky-400",
  },
  tip: {
    icon: Lightbulb,
    label: "Tip",
    container: "border-emerald-500/25 bg-emerald-500/[0.06]",
    accent: "text-emerald-600 dark:text-emerald-400",
  },
  important: {
    icon: MessageSquareWarning,
    label: "Important",
    container: "border-violet-500/25 bg-violet-500/[0.06]",
    accent: "text-violet-600 dark:text-violet-400",
  },
  warning: {
    icon: TriangleAlert,
    label: "Warning",
    container: "border-amber-500/25 bg-amber-500/[0.06]",
    accent: "text-amber-600 dark:text-amber-500",
  },
  caution: {
    icon: OctagonAlert,
    label: "Caution",
    container: "border-red-500/25 bg-red-500/[0.06]",
    accent: "text-red-600 dark:text-red-400",
  },
};

/**
 * A code payload, highlighted once its grammar has loaded.
 *
 * Renders plain text first and upgrades in place, so a code Block is never blank while a grammar
 * loads and never disappears if one fails. Tokens are rendered as React elements — nothing derived
 * from the document becomes markup.
 */
function HighlightedCode({ code, language }: { code: string; language: string }) {
  const [tokens, setTokens] = useState<readonly CodeToken[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTokens(null);
    if (!resolveCodeLanguage(language)) return () => undefined;
    void highlightCodeTokens(code, language).then((next) => {
      if (!cancelled) setTokens(next);
    });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  if (!tokens) return <code>{code}</code>;
  return (
    <code>
      {tokens.map((token, index) => (
        <span key={index} className={token.className ?? undefined}>
          {token.text}
        </span>
      ))}
    </code>
  );
}

/** Destination of the link the selection already sits inside, or "" when there is none. */
function existingLinkDestination(source: string, from: number, to: number): string {
  const pattern = /\[(?:\\.|[^\]\\])*\]\(([^)]*)\)/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const start = match.index;
    const end = start + match[0].length;
    if (from >= start && to <= end) return match[1].replace(/^<|>$/g, "");
  }
  return "";
}

/**
 * A small popover for a link's destination.
 *
 * The toolbar's Link button used to write `[label](https://)` straight into the source: a link that
 * goes nowhere, with the selection left over the *label*, so the next keystroke rewrote the text
 * instead of the URL. Both reference products ask for the destination first.
 */
function LinkEditPopover({
  url,
  position,
  onCommit,
  onCancel,
}: {
  url: string;
  position: { top: number; left: number };
  onCommit: (url: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(url);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  return (
    <div
      role="group"
      aria-label="Link destination"
      style={{
        position: "fixed",
        top: position.top - 8,
        left: position.left,
        transform: "translate(-50%, -100%)",
        zIndex: 50,
      }}
      className="flex h-9 items-center gap-1 rounded-[10px] bg-popover p-1 text-popover-foreground shadow-[0_20px_24px_rgba(25,25,25,0.05),0_5px_8px_rgba(25,25,25,0.027),0_0_0_1px_hsl(var(--border))]"
    >
      <LinkIcon className="ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        ref={inputRef}
        aria-label="Link URL"
        placeholder="Paste or type a link"
        value={draft}
        spellCheck={false}
        className="h-7 w-56 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground/70"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit(draft);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <button
        type="button"
        aria-label="Apply link"
        className="flex h-7 items-center rounded-md px-2 text-xs font-medium transition-colors duration-[20ms] ease-in hover:bg-accent hover:text-accent-foreground"
        onClick={() => onCommit(draft)}
      >
        Link
      </button>
    </div>
  );
}

/** Which inline format a Mod-shortcut asks for, if any. */
function inlineFormatShortcut(event: KeyboardEvent<HTMLElement>): MarkdownInlineFormat | null {
  const key = event.key.toLowerCase();
  if (event.shiftKey) return key === "x" ? "strike" : null;
  if (key === "b") return "bold";
  if (key === "i") return "italic";
  if (key === "e") return "code";
  if (key === "k") return "link";
  return null;
}

/**
 * The code Block's language, as an editable chip.
 *
 * Projecting the ``` line out of the editing surface would otherwise make the info string
 * unreachable, so it gets its own control. A free-text field rather than a fixed menu, because the
 * info string is arbitrary in Markdown and a closed list would silently drop whatever the file
 * already says.
 */
function CodeLanguageChip({
  language,
  onCommit,
}: {
  language: string;
  onCommit: (language: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(language);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next !== language) onCommit(next);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        aria-label="Code language"
        value={draft}
        placeholder="language"
        spellCheck={false}
        className="absolute right-2 top-1.5 z-10 w-24 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onChange={(event) => setDraft(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        onBlur={commit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(language);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      data-code-language
      aria-label={language ? `Code language: ${language}` : "Set code language"}
      className="absolute right-2 top-1.5 rounded px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground opacity-0 transition-opacity duration-[20ms] hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/native-block:opacity-100"
      onClick={(event) => {
        event.stopPropagation();
        setDraft(language);
        setEditing(true);
      }}
    >
      {language || "plain text"}
    </button>
  );
}

function isListBlockKind(kind: MarkdownBlockView["kind"]): boolean {
  return kind === "bullet_list_item" || kind === "ordered_list_item" || kind === "task_list_item";
}

/** Kinds whose payload is indentation-significant, so Tab means "two spaces", not "outdent". */
function indentsWithSpaces(kind: MarkdownBlockView["kind"]): boolean {
  return kind === "fenced_code" || kind === "mermaid" || kind === "block_math";
}

/**
 * Shift every line touched by `[from, to)` by one two-space step. Returns the replacement as a
 * single span so the caller can commit it as one source edit (one undo entry).
 */
function shiftSourceIndent(
  source: string,
  from: number,
  to: number,
  direction: -1 | 1
): { from: number; to: number; text: string } | null {
  const lineStart = source.lastIndexOf("\n", Math.max(from - 1, 0)) + 1;
  const lineEndIndex = source.indexOf("\n", to);
  const lineEnd = lineEndIndex === -1 ? source.length : lineEndIndex;
  if (from === to && direction === 1) {
    return { from, to, text: "  " };
  }
  const lines = source.slice(lineStart, lineEnd).split("\n");
  const shifted = lines.map((line) =>
    direction === 1 ? `  ${line}` : line.replace(/^ {1,2}/, "")
  );
  const text = shifted.join("\n");
  if (text === source.slice(lineStart, lineEnd)) return null;
  return { from: lineStart, to: lineEnd, text };
}

/**
 * Where the caret sits inside the wrapped text of an editing surface.
 *
 * Vertical arrow keys must only leave a Block from its first or last *visual* line — a paragraph
 * that wraps over three lines has to let the caret walk them first, the way Notion and Feishu do.
 * `caretX` is the caret's viewport x so the destination Block can keep the same column.
 */
function caretLineBoundary(
  surface: HTMLElement,
  caret: number
): { atFirstLine: boolean; atLastLine: boolean; caretX: number } | null {
  const rect =
    surface instanceof HTMLTextAreaElement
      ? textareaCaretRect(surface, caret)
      : domCaretRect(surface);
  if (!rect) return null;
  const surfaceRect = surface.getBoundingClientRect();
  if (surfaceRect.height <= 0) return null;
  const lineHeight = rect.height > 0 ? rect.height : parseLineHeight(surface);
  if (lineHeight <= 0) return null;
  const tolerance = lineHeight / 2;
  return {
    atFirstLine: rect.top - surfaceRect.top < tolerance,
    atLastLine: surfaceRect.bottom - rect.bottom < tolerance,
    caretX: rect.left,
  };
}

function parseLineHeight(element: HTMLElement): number {
  const raw = window.getComputedStyle(element).lineHeight;
  const parsed = Number.parseFloat(raw);
  if (Number.isFinite(parsed)) return parsed;
  const fontSize = Number.parseFloat(window.getComputedStyle(element).fontSize);
  return Number.isFinite(fontSize) ? fontSize * 1.5 : 0;
}

function domCaretRect(surface: HTMLElement): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!surface.contains(range.startContainer)) return null;
  const rects = range.getClientRects();
  const rect = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect();
  if (!rect || (rect.height === 0 && rect.top === 0)) return null;
  return rect as DOMRect;
}

/**
 * Measure a textarea caret by laying out the same text in an off-screen mirror. A textarea gives
 * no caret geometry of its own, and this is the same technique the selection toolbar already uses.
 */
function textareaCaretRect(textarea: HTMLTextAreaElement, caret: number): DOMRect | null {
  const rect = textarea.getBoundingClientRect();
  if (rect.height <= 0) return null;
  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  Object.assign(mirror.style, {
    position: "fixed",
    visibility: "hidden",
    pointerEvents: "none",
    zIndex: "-1",
    boxSizing: computed.boxSizing,
    left: `${rect.left}px`,
    top: `${rect.top - textarea.scrollTop}px`,
    width: `${rect.width}px`,
    minHeight: `${rect.height}px`,
    padding: computed.padding,
    border: computed.border,
    font: computed.font,
    fontFamily: computed.fontFamily,
    fontSize: computed.fontSize,
    fontWeight: computed.fontWeight,
    fontStyle: computed.fontStyle,
    lineHeight: computed.lineHeight,
    letterSpacing: computed.letterSpacing,
    tabSize: computed.tabSize,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    wordBreak: computed.wordBreak,
  });
  const value = textarea.value;
  mirror.append(document.createTextNode(value.slice(0, caret)));
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.append(marker, document.createTextNode(value.slice(caret) || "​"));
  document.body.append(mirror);
  const markerRect = marker.getBoundingClientRect();
  mirror.remove();
  if (markerRect.height <= 0) return null;
  return markerRect as DOMRect;
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
  onSetCodeLanguage,
  onOpenWikiLink,
  wikiEmbedContext,
  collectionContext,
  imageContext,
  readOnly = false,
}: {
  block: MarkdownBlockView;
  onSetTaskChecked: (blockId: string, checked: boolean) => void;
  onSetCodeLanguage?: (blockId: string, language: string) => void;
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
            className="cursor-pointer select-none break-words px-3 py-2 text-sm font-medium"
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
      // Cell source ranges, so clicking a cell can put the caret in that cell rather than at the
      // end of the whole table's raw source.
      const geometry = parseMarkdownTableSource(source);
      const cellFor = (row: number, column: number) =>
        geometry?.cells.find((cell) => cell.row === row && cell.column === column);
      const alignClass = (column: number) => {
        const align = geometry?.alignments[column];
        return align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";
      };
      return (
        <div className="min-h-9 overflow-x-auto py-1">
          <table aria-label="Markdown table" className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                {table.header.map((cell, index) => (
                  <th
                    key={`header-${index}`}
                    data-table-cell={cellFor(0, index) ? `${cellFor(0, index)!.from}` : undefined}
                    className={`border border-border bg-muted/50 px-2 py-1.5 font-medium ${alignClass(index)}`}
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
                      data-table-cell={
                        cellFor(rowIndex + 1, cellIndex)
                          ? `${cellFor(rowIndex + 1, cellIndex)!.from}`
                          : undefined
                      }
                      className={`border border-border px-2 py-1.5 ${alignClass(cellIndex)}`}
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
      // Icon and accent are derived from the `[!TYPE]` in the source — nothing is stored outside
      // the Markdown. An uppercase `CALLOUT` label was the only signal before, which reads as
      // shouting rather than as the note/warning/tip distinction the type is actually making.
      const style = CALLOUT_STYLES[callout.type.toLowerCase()] ?? CALLOUT_STYLES.note;
      const Icon = style.icon;
      return (
        <aside
          data-testid="callout-block"
          aria-label={`${callout.type} callout`}
          className={`flex min-h-9 gap-2.5 rounded-md border px-3 py-2 ${style.container}`}
        >
          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.accent}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            {callout.title ? (
              <div className="font-semibold">{callout.title}</div>
            ) : (
              <div className={`font-semibold ${style.accent}`}>{style.label}</div>
            )}
            {callout.body ? (
              <div className="whitespace-pre-wrap break-words">
                <InlineMarkdownPreview source={callout.body} onOpenWikiLink={onOpenWikiLink} />
              </div>
            ) : null}
          </div>
        </aside>
      );
    }
  }
  if (block.kind === "fenced_code") {
    // Show the code, not the syntax that delimits it. Notion and Feishu both render a code Block
    // with no visible fence and put the language in a control instead.
    const fence = splitDelimitedBlockSource("fenced_code", source);
    return (
      <div className="relative">
        <pre
          data-testid="fenced-code-block"
          className="min-h-9 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2 font-mono text-sm leading-6"
        >
          <HighlightedCode
            code={fence ? fence.payload : source}
            language={fence?.infoString ?? ""}
          />
        </pre>
        {onSetCodeLanguage ? (
          <CodeLanguageChip
            language={fence?.infoString ?? ""}
            onCommit={(language) => onSetCodeLanguage(block.id, language)}
          />
        ) : fence?.infoString ? (
          <span
            data-code-language
            className="pointer-events-none absolute right-2 top-1.5 select-none font-mono text-[11px] text-muted-foreground"
          >
            {fence.infoString}
          </span>
        ) : null}
      </div>
    );
  }
  if (block.kind === "unsupported") {
    return (
      <pre className="min-h-9 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 px-3 py-2 font-mono text-sm leading-6 text-muted-foreground">
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
      // Chrome is byte-identical to `activeEditorSurfaceClass`'s blockquote arm. Previously the
      // preview drew a 4px muted bar around 13px italic grey text while the editing surface drew a
      // 3px foreground bar around 16px upright body text, so clicking a quote changed six things at
      // once. Notion and Feishu both keep a quote at body size and upright.
      <blockquote
        data-editor-kind="blockquote"
        className="min-h-9 whitespace-pre-wrap border-l-[3px] border-foreground py-1 pl-[14px] pr-0"
      >
        {text ? <InlineMarkdownPreview source={text} onOpenWikiLink={onOpenWikiLink} /> : null}
      </blockquote>
    );
  }
  const listItem = listItemPreview(source, block.kind);
  if (listItem) {
    const content = listItem.content ? (
      <InlineMarkdownPreview source={listItem.content} onOpenWikiLink={onOpenWikiLink} />
    ) : null;
    if (block.kind === "task_list_item") {
      return (
        <div data-editor-kind="task_list_item" className="flex min-h-9 items-start gap-2 px-1 py-1">
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
      <div data-editor-kind={block.kind} className="flex min-h-9 items-start gap-2 px-1 py-1">
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
    // The old `" "` filler was a real U+0020 that a cross-Block copy would pick up. Height now
    // comes from `min-h-9`, so an empty Block can render genuinely empty.
    return (
      // No `text-*` utility here: globals.css overrides Tailwind's `.text-base` with the 13px UI
      // type scale using `!important`, while the editing surface inherits `.markdown-page`'s 16px.
      // Sizing both from `data-editor-kind` in editor.css is what stops the text from jumping a
      // whole type step the moment the Block is clicked into.
      <p data-editor-kind="paragraph" className="min-h-9 whitespace-pre-wrap px-1 py-1">
        {text ? inline : null}
      </p>
    );
  }
  // An empty heading always shows its level, the way Notion and Feishu label one. `tracking-tight`
  // is gone: the editing surface uses -0.018em, and the two values made every glyph slide sideways
  // the moment the heading was clicked into.
  const classes = "min-h-9 whitespace-pre-wrap px-1 py-1 font-semibold";
  const headingProps = { "data-editor-kind": "heading", "data-editor-level": block.level ?? 1 };
  const body = text ? (
    inline
  ) : (
    <span data-block-placeholder aria-hidden="true" className="select-none font-normal">
      {`Heading ${block.level ?? 1}`}
    </span>
  );
  switch (block.level) {
    case 1:
      return (
        <h1 {...headingProps} className={classes}>
          {body}
        </h1>
      );
    case 2:
      return (
        <h2 {...headingProps} className={classes}>
          {body}
        </h2>
      );
    case 3:
      return (
        <h3 {...headingProps} className={classes}>
          {body}
        </h3>
      );
    case 4:
      return (
        <h4 {...headingProps} className={classes}>
          {body}
        </h4>
      );
    case 5:
      return (
        <h5 {...headingProps} className={classes}>
          {body}
        </h5>
      );
    default:
      return (
        <h6 {...headingProps} className={classes}>
          {body}
        </h6>
      );
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
  if (isListBlockKind(block.kind)) {
    const checkedTodo = block.kind === "task_list_item" && block.checked;
    // A checked to-do keeps its strikethrough while being edited; losing it on activation makes
    // the Block look like it silently unchecked itself.
    return `${base} gap-2 px-1 py-1${checkedTodo ? " text-muted-foreground line-through" : ""}`;
  }
  if (block.kind === "blockquote") {
    // 14px matches `.markdown-page blockquote`'s padding-left, so the text does not slide 2px
    // sideways the moment the Block is activated.
    return `${base} border-l-[3px] border-foreground py-1 pl-[14px] pr-0`;
  }
  // Activation must not strip a Block's container. Each arm mirrors the preview chrome for that
  // kind so clicking in never repaints the whole Block as bare text on the Page background.
  if (block.kind === "fenced_code" || block.kind === "unsupported") {
    return `${base} rounded-lg bg-muted p-4 font-mono text-sm leading-6`;
  }
  if (block.kind === "mermaid" || block.kind === "toggle") {
    return `${base} rounded-lg border border-border bg-muted/20 px-3 py-2 font-mono text-sm leading-6`;
  }
  if (block.kind === "callout") {
    // Same type-derived container as the preview, so clicking a warning callout does not repaint it
    // in the neutral palette.
    const type = /\[!([A-Za-z]+)\]/.exec(block.raw)?.[1]?.toLowerCase() ?? "note";
    const style = CALLOUT_STYLES[type] ?? CALLOUT_STYLES.note;
    return `${base} rounded-md border px-3 py-2 ${style.container}`;
  }
  if (block.kind === "block_math") {
    return `${base} rounded-md bg-muted/35 px-3 py-2 font-mono text-sm leading-6`;
  }
  return `${base} px-1 py-1`;
}

/**
 * Placeholder for an empty Block, shown only while it is being edited.
 *
 * Notion shows "Press 'space' for AI or '/' for commands" on the focused empty line and nothing on
 * unfocused ones; Feishu shows "输入 / 唤起更多". Both always label an empty heading. Raw-source kinds
 * get none — their syntax is the content.
 */
function blockPlaceholder(block: MarkdownBlockView): string | undefined {
  switch (block.kind) {
    case "paragraph":
      return "Write, or press '/' for commands";
    case "heading":
      return `Heading ${block.level ?? 1}`;
    case "bullet_list_item":
    case "ordered_list_item":
      return "List";
    case "task_list_item":
      return "To-do";
    case "blockquote":
      return "Empty quote";
    default:
      return undefined;
  }
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
