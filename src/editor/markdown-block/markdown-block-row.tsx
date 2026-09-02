"use client";

import {
  ChevronRight,
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
  createContext,
  type CSSProperties,
  type DragEvent,
  Fragment,
  type KeyboardEvent,
  memo,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
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
  normalizeEditorLineEndings,
} from "@/editor/markdown-block/block-editing-projection";
import {
  editableMarkdownBlockSource,
  orderedListDisplayOrdinals,
} from "@/editor/markdown-block/markdown-block-source";
import { hasDesktopBridge, invokeDesktop } from "@/lib/native-shell";
import { MENU_PANEL_CLASS } from "@/components/ui/dropdown-menu";
import { InlineImageChip } from "@/editor/markdown-block/inline-image-chip";
import { isMarkdownSourceOnlyBlockKind } from "@/editor/markdown-block/markdown-block-document";
import { InlineFormatToolbar } from "@/editor/markdown-block/inline-format-toolbar";
import {
  markdownInlineFormatState,
  markdownLinkDestinationAt,
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
import { MarkdownCodeBlock } from "@/editor/markdown-block/markdown-code-block";
import { MarkdownContainerBlock } from "@/editor/markdown-block/markdown-container-block";
import { MarkdownFigureBlock } from "@/editor/markdown-block/markdown-figure-block";
import { MarkdownStaticBlock } from "@/editor/markdown-block/markdown-static-block";
import { MarkdownTableBlock } from "@/editor/markdown-block/markdown-table-block";
import { parseMarkdownToggle, type MarkdownToggle } from "@/editor/markdown-block/markdown-toggle";
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
import {
  searchWikiLinkPages,
  wikiLinkSource,
  type WikiLinkPage,
} from "@/editor/markdown-block/wiki-link-suggestions";
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

/**
 * The rendered view's grammar.
 *
 * `marked` has no `==highlight==` and no `%%comment%%`, so both used to render as their own
 * literal punctuation — which for a comment meant a Page displayed the text its author had
 * deliberately marked as not part of the document.
 */
const inlinePreviewLexer = new Marked({ gfm: true }).use({
  extensions: [
    {
      name: "inlineHighlight",
      level: "inline" as const,
      start: (src: string) => src.indexOf("=="),
      tokenizer(src: string) {
        const match = /^==(?=[^\s=])([\s\S]*?[^\s=])==/.exec(src);
        if (!match) return undefined;
        return {
          type: "inlineHighlight",
          raw: match[0],
          text: match[1],
          tokens: this.lexer.inlineTokens(match[1]),
        };
      },
    },
    {
      name: "inlineComment",
      level: "inline" as const,
      start: (src: string) => src.indexOf("%%"),
      tokenizer(src: string) {
        const match = /^%%([\s\S]*?)%%/.exec(src);
        if (!match) return undefined;
        // No `tokens` and no text: a comment is not part of the rendered document.
        return { type: "inlineComment", raw: match[0], text: "" };
      },
    },
  ],
});
let katexPromise: Promise<typeof import("katex").default> | null = null;

function loadKatex(): Promise<typeof import("katex").default> {
  katexPromise ??= import("katex").then((module) => module.default);
  return katexPromise;
}

/**
 * The marker column every list kind hangs its leading control in.
 *
 * 20px wide, its contents aligned to the column's right edge, followed by the row's own 8px gap —
 * so a bullet, an ordinal and a to-do checkbox all leave the label at one x per depth. The to-do
 * used to put its 16px checkbox straight into the row, which started its label 4.0px left of every
 * other list kind's at depth 0, 1 and 2, and a mixed checklist read with a ragged left edge that
 * nothing on screen explained.
 *
 * A flex column rather than `text-right`, because an ordinal can be wider than the column and the
 * two overflow in opposite directions. As `w-5 text-right`, "10." (20.66px of glyph in a 20.00px
 * box) wrapped: the period dropped to a second line and the row grew from 40px to 68px, which
 * happened to 22 of the first 33 ordinals. Right-aligned in a flex box the ordinal overflows
 * *leftward* into the 10px grip gap instead, so the label's x never moves.
 */
const LIST_MARKER_COLUMN = "flex w-5 shrink-0 justify-end";

/** The marker glyphs themselves: never wrapped, never shrunk to fit the 20px column. */
const LIST_MARKER_INK = "shrink-0 whitespace-nowrap";

interface MarkdownBlockRowProps {
  block: MarkdownBlockView;
  /**
   * Whether the Block has a sibling above/below to swap with. Computed by the runtime for the same
   * reason `listOrdinal` is: it is the only place that can see the siblings. Both are stable for
   * every row but the first and the last, so an insertion no longer moves them.
   */
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  /**
   * The ordinal to draw on an ordered list item, counted across its run rather than read from its
   * own source. Computed by the runtime, which is the only place that can see the siblings.
   */
  listOrdinal?: number;
  active: boolean;
  autoFocusEditor?: boolean;
  /** The find bar's current match in this Block, if the current match is in this Block. */
  searchHighlight?: { anchor: number; head: number };
  keyboardEntry?: boolean;
  blockSelected?: boolean;
  blockSelectionFocus?: boolean;
  dropBefore?: boolean;
  /**
   * Where the caret belongs when this Block takes it, and — when a vertical crossing is what put it
   * here — which way that crossing came. The offset serves the text surface; the direction serves
   * the two kinds that address their caret by cell or by region and cannot read one off an offset.
   */
  selection?: { anchor: number; head: number; entry?: -1 | 1 };
  onActivate: (blockId: string, selection?: { anchor: number; head: number }) => void;
  onSelectBlock?: (blockId: string, extend?: boolean) => void;
  onBlockSelectionKeyDown?: (blockId: string, event: KeyboardEvent<HTMLDivElement>) => void;
  /** Grows a text selection past the Block boundary into a Block selection. */
  onExtendSelectionToBlock?: (blockId: string, direction: -1 | 1) => boolean;
  onChange: (
    blockId: string,
    source: string,
    options?: { readonly surfaceChanges?: boolean; readonly caret?: number }
  ) => void;
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
  /**
   * Cross into the Block above or below.
   *
   * `caret` is supplied only by a vertical crossing, and carries both the column to aim at and the
   * offset it is leaving from — the runtime needs the offset to tell a walk it is still steering
   * from one it has to re-measure. A horizontal crossing passes nothing and lands on the edge.
   */
  onNavigate?: (
    blockId: string,
    direction: -1 | 1,
    caret?: { x: number; offset: number }
  ) => boolean;
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
  /** Every Page a Wiki Link could resolve to. Called only while a `[[` run is open. */
  onSuggestWikiLinks?: () => readonly WikiLinkPage[];
  /** Replace `run` with `source` (a complete `[[Link]]`) and put the caret after it. */
  onInsertWikiLink?: (blockId: string, source: string, run: MarkdownWikiLinkRun) => void;
  /**
   * Whether this Block owns a range that can be folded, and whether it is folded now.
   *
   * Always supplied, `"none"` included: `sameRowProps` compares key counts first, so a prop that
   * appears on some rows and not others makes the memo bail for every row.
   */
  foldState?: "none" | "folded" | "unfolded";
  /** Takes the Block id so the runtime can hand every row one stable callback. */
  onToggleFold?: (blockId: string) => void;
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

export interface MarkdownWikiLinkServices {
  /** Open the Page a `[[target]]` names, or report that there is none. */
  open: (target: string) => void;
  /** Whether that target names a Page that exists in the workspace. */
  resolves: (target: string) => boolean;
}

/**
 * How a rendered `[[Wiki Link]]` reaches the workspace.
 *
 * A context rather than a prop, because the only consumer is one leaf about twenty render sites
 * below the row and threading a resolver alongside `onOpenWikiLink` through all of them would be
 * churn for a single element. A row rendered without a provider keeps exactly its previous
 * behaviour: nothing is reported unresolved.
 */
export const MarkdownWikiLinkContext = createContext<MarkdownWikiLinkServices | null>(null);

export type MarkdownCollectionContext = PageCollectionPreviewContext;

export interface MarkdownImageContext {
  pagePath: string;
  readAsset: (path: string) => Promise<WorkspaceAssetRead>;
}

/**
 * Whether an arrow handed back by an in-place surface means "leave this Block".
 *
 * A surface that holds text keeps its arrows for its own caret, so most of them reach the Block
 * only after the caret has moved and the key is spent. Two decide for themselves before handing one
 * back: a code Block hands an arrow back only at the payload's own edge (`atPayloadEdge` in
 * markdown-code-block.tsx), and a table hands the vertical pair back only once the cell move it
 * would make turned out not to exist. For those the key arriving here is already a decision.
 *
 * The rest — a figure's source field, a container's heading and body — hand every arrow back
 * wherever the caret is, so the decision has to be made here instead, off the caret itself.
 * Dropping the key unconditionally left those Blocks with no way out but Escape or the mouse;
 * taking it unconditionally would have been worse, because it would have stopped the caret moving
 * inside a two-line equation or a multi-line callout body at all.
 */
function arrowLeavesInPlaceBlock(
  kind: MarkdownBlockView["kind"],
  event: KeyboardEvent<HTMLElement>
): boolean {
  if (kind === "fenced_code") return true;
  if (kind === "table") return event.key === "ArrowUp" || event.key === "ArrowDown";
  if (kind === "block_math" || kind === "mermaid" || kind === "callout" || kind === "toggle") {
    return caretAtSurfaceEdge(event.target, event.key);
  }
  return false;
}

/**
 * Whether an arrow at this caret would move off the end of `text` rather than inside it.
 *
 * The same test `atPayloadEdge` makes over a code Block's payload. Restated here rather than shared
 * because there it reads a payload the surface already holds, and here it reads whatever the DOM
 * says the surface currently contains — one caret rule, two places that can see a caret.
 */
function atTextEdge(text: string, key: string, start: number, end: number): boolean {
  if (start !== end) return false;
  if (key === "ArrowLeft") return start === 0;
  if (key === "ArrowRight") return start === text.length;
  if (key === "ArrowUp") return !text.slice(0, start).includes("\n");
  if (key === "ArrowDown") return !text.slice(start).includes("\n");
  return false;
}

/**
 * The caret-at-edge test, asked of the element the key was pressed in.
 *
 * A figure's field is a textarea and a container's two regions are contenteditable, so the offset
 * comes from `selectionStart` in one case and from a Range measured against the element's own text
 * in the other. A selection that is not collapsed, or one that sits outside the element, is never
 * an edge: an arrow there collapses the selection and belongs to the surface.
 */
function caretAtSurfaceEdge(target: EventTarget | null, key: string): boolean {
  if (target instanceof HTMLTextAreaElement) {
    const { selectionStart, selectionEnd, value } = target;
    if (selectionStart === null || selectionEnd === null) return false;
    return atTextEdge(value, key, selectionStart, selectionEnd);
  }
  if (!(target instanceof HTMLElement)) return false;
  // `isContentEditable` is the browser's own answer and the one that counts at runtime; jsdom does
  // not implement it, so the attribute the surface actually sets stands in under test.
  const contentEditable = target.getAttribute("contenteditable");
  if (!target.isContentEditable && contentEditable !== "" && contentEditable !== "true") {
    return false;
  }
  const selection = target.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
  const caret = selection.getRangeAt(0);
  if (!target.contains(caret.startContainer)) return false;
  const before = target.ownerDocument.createRange();
  before.selectNodeContents(target);
  before.setEnd(caret.startContainer, caret.startOffset);
  const offset = before.toString().length;
  return atTextEdge(target.textContent ?? "", key, offset, offset);
}

function MarkdownBlockRowView({
  block,
  canMoveUp,
  canMoveDown,
  active,
  autoFocusEditor = true,
  searchHighlight,
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
  foldState = "none",
  onToggleFold,
  onSuggestWikiLinks,
  onInsertWikiLink,
  onRunSlashCommand,
  listOrdinal,
}: MarkdownBlockRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorId = `native-block-editor-${block.id}`;
  const slashListboxId = `${editorId}-slash`;
  const descriptionId = NATIVE_BLOCK_SHORTCUTS_ID;
  const rawSource = editableMarkdownBlockSource(block.raw);
  const editingProjection = useMemo(() => createBlockEditingProjection(block), [block]);
  // The space every offset in this row is counted in: the find matcher normalises, and a
  // textarea's `.value` is LF whatever the file holds. The semantic surface renders the string it
  // is given, so handing it CRLF put its offsets one out per line ending.
  const source = normalizeEditorLineEndings(editingProjection.editorText);
  const sourceOnly = isMarkdownSourceOnlyBlockKind(block.kind);
  const inlineProjection = useMemo(() => projectMarkdownInline(source), [source]);
  const useSemanticInlineEditor =
    !sourceOnly &&
    // A heading carrying a newline is a setext heading, and its second line is structure rather
    // than prose. `====` also happens to be `==highlight==` delimiters to the inline grammar, so
    // the projection swallows the underline whole — 12 of its 25 characters reach no segment —
    // and a surface that cannot see those bytes must not be the one editing them. `----` survives
    // by luck, not by rule, so both levels stay on the textarea.
    !(block.kind === "heading" && /[\r\n]/.test(source)) &&
    parseWikiEmbedBlock(source) === null &&
    // A find match renders this surface even on text with no inline syntax to hide. The raw
    // textarea can only show a match as its own selection, and Chromium paints no selection in an
    // unfocused control — and the find bar keeps focus — so the counter said "2 of 5" while the
    // Page showed nothing. With no delimiters the projection is the identity, so offsets and the
    // caret are unchanged by taking this path.
    (inlineProjection.visibleText !== source || searchHighlight !== undefined);
  // Opening the grip menu moves focus into a portalled dropdown, which takes the row out of
  // `:hover`/`:focus-within` and used to fade the very control the menu is attached to.
  const [controlsMenuOpen, setControlsMenuOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  // Keyed on the trigger character's offset, not on the source string. Escaping a menu whose key
  // was the source text reopened it on the very next keystroke, so the menu fought the user.
  const [dismissedSlashStart, setDismissedSlashStart] = useState<number | null>(null);
  const [slashPosition, setSlashPosition] = useState<SlashMenuPosition | null>(null);
  const slashListRef = useRef<HTMLDivElement>(null);
  const [wikiIndex, setWikiIndex] = useState(0);
  const [dismissedWikiStart, setDismissedWikiStart] = useState<number | null>(null);
  const [wikiPosition, setWikiPosition] = useState<SlashMenuPosition | null>(null);
  const wikiListRef = useRef<HTMLDivElement>(null);
  const [linkEditor, setLinkEditor] = useState<{
    from: number;
    to: number;
    url: string;
    position: { top: number; left: number };
    selectionRects: readonly { top: number; left: number; width: number; height: number }[];
  } | null>(null);
  /** Where a dismissed link editor has to hand the caret back to. See `cancelLinkEditor`. */
  const linkEditorReturnRef = useRef<{ from: number; to: number; range: Range | null } | null>(
    null
  );
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
  const noteCaretOffset = (offset: number, text: string = source) => {
    // Only the slash run needs a live caret. Storing it unconditionally would re-render the row on
    // every arrow key; `null` short-circuits to React's bail-out when no trigger char is present.
    //
    // `text` defaults to the render's `source`, but a caller that already holds the newer text must
    // pass it. A committing IME hands over its result before React has re-rendered, so testing the
    // closure's `source` tested the text as it was *before* the commit: composing 、 into an empty
    // Block tested "", found no trigger, and stored `null`. The insert panel then never opened, which
    // made the fullwidth trigger unreachable from the CJK keyboards it exists for.
    setCaretOffset(SLASH_TRIGGER_PATTERN.test(text) || text.includes("[[") ? offset : null);
  };
  // While an IME composition is open the model deliberately lags the DOM, so the menu filters on the
  // live text. That is what makes `/` + pinyin narrow as you type, the way Feishu's insert panel
  // does — and it is safe because Enter belongs to the IME until the composition commits, so the
  // offsets used to execute a command always come from committed text.
  const liveSource = composingValue ?? source;
  const wikiCaret =
    composingValue === null ? (caretOffset ?? editorSelectionRef.current.head) : liveSource.length;
  const wikiRun =
    active && block.editable && !sourceOnly && onInsertWikiLink
      ? wikiLinkRunAt(liveSource, wikiCaret)
      : null;
  const wikiQuery = wikiRun?.query ?? null;
  const wikiStart = wikiRun?.start ?? null;
  const wikiPages = useMemo(
    () => (wikiQuery === null ? [] : (onSuggestWikiLinks?.() ?? [])),
    [wikiQuery, onSuggestWikiLinks]
  );
  const wikiMatches = useMemo(
    () => (wikiQuery === null ? [] : searchWikiLinkPages(wikiPages, wikiQuery)),
    [wikiPages, wikiQuery]
  );
  // Closes with no match, unlike the slash menu: `[[` is also ordinary Markdown, so a query that
  // matches nothing must let Enter split the Block instead of swallowing it.
  const wikiMenuOpen =
    wikiStart !== null && dismissedWikiStart !== wikiStart && wikiMatches.length > 0;
  const slashRun =
    // One popup at a time. `[[/foo` is inside a Wiki Link, not a command.
    active && block.editable && !sourceOnly && onRunSlashCommand && wikiRun === null
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
  const activeListItem = listItemPreview(rawSource, block.kind, listOrdinal);
  // Parsed once per render and addressed by row and column, never held as state: a cell's offsets
  // shift as soon as an earlier cell grows by a character.
  const tableGeometry = block.kind === "table" ? parseMarkdownTableSource(source) : null;

  /**
   * The Block-level keys an in-place surface must not swallow.
   *
   * Every kind that edits inside its rendered form owns its own keys — a cell owns Tab, a code Block
   * owns Enter — and would otherwise absorb the Block's as well. That is how a table became the one
   * Block you could edit and not undo. Listed explicitly rather than delegated to the text-surface
   * handler, which is built around a caret in the Block's own source and cannot read a cell's or a
   * cell-free shell's offsets.
   */
  const handleInPlaceKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const mod = event.metaKey || event.ctrlKey;
    // A Block with no text surface at all. Its shell is the only thing that can answer a key, so the
    // keys a caret would normally handle have to be answered here or not at all.
    const cellFree =
      block.kind === "image" || block.kind === "thematic_break" || block.kind === "collection";
    if (event.key === "Escape") {
      event.preventDefault();
      onSelectBlock?.(block.id);
      return;
    }
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.repeat) return;
      if (event.shiftKey) onRedo();
      else onUndo();
      return;
    }
    if (mod && !event.altKey && event.key.toLowerCase() === "d") {
      event.preventDefault();
      if (!event.repeat) onDuplicate(block.id);
      return;
    }
    if (mod && event.shiftKey && (event.key === "Backspace" || event.key === "Delete")) {
      event.preventDefault();
      if (!event.repeat) onDelete(block.id);
      return;
    }
    // A Block with nothing to type into is selected rather than edited, so a bare Backspace has no
    // text to remove and means "remove this Block" — which is what pressing it on a selected image
    // does in both reference products. A Block that holds text must never be deleted this way.
    if (
      !mod &&
      !event.altKey &&
      (event.key === "Backspace" || event.key === "Delete") &&
      cellFree
    ) {
      event.preventDefault();
      if (!event.repeat) onDelete(block.id);
      return;
    }
    // Enter on a Block with nothing to type into means what it means everywhere else in the editor:
    // a new Block here. Without it, inserting a divider, an image or a Collection as the *last* Block
    // of a Page was a dead end — there was no later Block for an arrow to escape into, so typing was
    // discarded with no feedback and no key could create anything after it. Notion leaves a fresh
    // paragraph below a divider for the same reason.
    if (!mod && !event.altKey && !event.shiftKey && event.key === "Enter" && cellFree) {
      event.preventDefault();
      if (!event.repeat) onInsertAfter(block.id);
      return;
    }
    // An arrow leaves the Block. There is no caret inside one of these to move first, so pressing
    // Down on a divider simply did nothing — the Block swallowed the key and the only way out was the
    // mouse. Every kind that *does* hold text keeps its arrows for its own caret, which is why this
    // is gated rather than applied to every in-place surface — except where the surface has already
    // decided the caret is at its own edge before handing the key back, in which case dropping it
    // made the Block a keyboard trap of exactly the same shape.
    if (
      !mod &&
      !event.altKey &&
      !event.shiftKey &&
      (event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight") &&
      (cellFree || arrowLeavesInPlaceBlock(block.kind, event))
    ) {
      const direction = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1;
      // A vertical crossing carries the column it is leaving from, exactly as the text surface's own
      // handler below does. Measured on the element the key came from rather than on the row's
      // textarea, because an in-place Block's caret lives in a code payload, an equation field, a
      // table cell or a container region — the row has no textarea at all for most of these. Passing
      // nothing left the runtime with no column to aim at, and it falls back to the destination's
      // source edge: every ArrowDown out of a code Block, a callout, a toggle or a table dropped the
      // caret at offset 0 of the Block below, however far right it had been. A horizontal crossing
      // still passes nothing, because landing on that edge is what Left and Right mean.
      const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
      const surface = event.target instanceof HTMLElement ? event.target : null;
      // Only a textarea needs the offset, to lay its value out and find the caret; a contenteditable
      // is measured from the live selection. The offset the runtime is handed alongside the column is
      // the identity of the caret it steered from, and a region's own offsets are not in the Block's
      // source, so 0 stands for "not an offset in this Block" and makes the walk re-measure.
      const offset = surface instanceof HTMLTextAreaElement ? (surface.selectionStart ?? 0) : 0;
      const boundary = vertical && surface ? caretLineBoundary(surface, offset) : null;
      if (
        onNavigate?.(block.id, direction, boundary ? { x: boundary.caretX, offset } : undefined)
      ) {
        event.preventDefault();
      }
      return;
    }
    if (event.altKey && !mod && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      if (onMove(block.id, event.key === "ArrowUp" ? -1 : 1) !== false) {
        event.preventDefault();
      }
    }
  };

  /**
   * The rendered Block, in both states, for every kind that has one.
   *
   * Deliberately computed here and rendered from ONE slot below rather than from the two arms of the
   * active/preview ternary. Rendering it from both arms would look equivalent and would not be: React
   * would unmount and remount it on activation, which is precisely the thing that used to drop a
   * table's borders, a code Block's highlighting and an image's rendering. `null` means the kind is
   * prose and takes the ordinary text surface.
   */
  const inPlaceCommon = {
    blockId: block.id,
    // The Block's own source, not the projected editor text. A delimited kind's projection has
    // already stripped the fences by the time it reaches `source`, so a component asking
    // `splitDelimitedBlockSource` for its info string found nothing and a code Block lost its
    // language chip. These components render the whole Block, so they need the whole Block.
    source: rawSource,
    editable: active && block.editable,
    // ...and hand back a whole Block, which has to be projected before the runtime sees it, or the
    // runtime would wrap an already-complete source in its delimiters a second time.
    onChange: (
      blockId: string,
      nextRaw: string,
      options?: { surfaceChanges?: boolean; caret?: number }
    ) =>
      onChange(
        blockId,
        createBlockEditingProjection({ kind: block.kind, raw: nextRaw }).editorText,
        options
      ),
    onKeyDown: handleInPlaceKeyDown,
    renderInline: (markdown: string) => (
      <InlineMarkdownPreview source={markdown} onOpenWikiLink={onOpenWikiLink} />
    ),
  };
  const inPlaceBlock: ReactNode =
    block.kind === "image" || block.kind === "thematic_break" || block.kind === "collection" ? (
      <MarkdownStaticBlock {...inPlaceCommon} kind={block.kind}>
        <BlockPreview
          block={block}
          listOrdinal={listOrdinal}
          readOnly
          onSetTaskChecked={onSetTaskChecked}
          onOpenWikiLink={onOpenWikiLink}
          wikiEmbedContext={wikiEmbedContext}
          collectionContext={collectionContext}
          imageContext={imageContext}
        />
      </MarkdownStaticBlock>
    ) : block.kind === "fenced_code" ? (
      <MarkdownCodeBlock {...inPlaceCommon} onSetLanguage={onSetCodeLanguage} />
    ) : block.kind === "block_math" || block.kind === "mermaid" ? (
      <MarkdownFigureBlock {...inPlaceCommon} kind={block.kind} />
    ) : block.kind === "callout" || block.kind === "toggle" ? (
      // `entry` for the same reason the table takes one: a container picks a region rather than an
      // offset, and which region is right depends on which way the caret arrived.
      <MarkdownContainerBlock {...inPlaceCommon} kind={block.kind} entry={selection?.entry} />
    ) : null;

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

  useEffect(() => {
    setWikiIndex(0);
  }, [wikiQuery]);

  useEffect(() => {
    // Forget the dismissal once the caret leaves the run it dismissed.
    if (dismissedWikiStart !== null && wikiStart !== dismissedWikiStart) {
      setDismissedWikiStart(null);
    }
  }, [dismissedWikiStart, wikiStart]);

  useEffect(() => {
    if (!wikiMenuOpen) {
      setWikiPosition(null);
      return;
    }
    const surface = rowRef.current?.querySelector<HTMLElement>("[data-native-block-editor]");
    if (!surface || wikiStart === null) return;
    const measure = () => setWikiPosition(slashMenuPosition(surface, wikiStart));
    measure();
    const scroller = surface.closest("[data-native-markdown-scroll]");
    scroller?.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      scroller?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [wikiMenuOpen, wikiStart, wikiMatches.length]);

  useEffect(() => {
    if (!wikiMenuOpen) return;
    wikiListRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [wikiIndex, wikiMenuOpen]);

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
    // `preventScroll`, and the scroll done deliberately below instead. Blink scrolls a focused
    // element with `CenterIfNeeded`, which is bimodal: a surface still partly on screen is nudged
    // to the edge, one entirely off screen is recentred on the port's midline. Walking Enter down
    // a Page therefore stepped 39, 39, 39 … and then 453 in a single frame, the new row landing at
    // 415 — 868/2 minus half a row — because press 20 was the first that mounted its surface below
    // the fold. Every other focus() in this editor already passes it.
    if (autoFocusEditor) textarea.focus({ preventScroll: true });
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
    if (!active) return;
    const row = rowRef.current;
    // Unless whoever activated the Block has already scrolled it where they want it. Outline
    // navigation sets this immediately before its own smooth `block: "start"` scroll, and an instant
    // scroll issued while that one is in flight cancels it — the Page then stops wherever `nearest`
    // decided, which on a 100-Block Page was 810.3px down the port instead of at its top. Consumed
    // here so it lasts exactly one activation.
    if (row?.hasAttribute("data-outline-scroll")) {
      row.removeAttribute("data-outline-scroll");
      return;
    }
    // The Block brings itself into view, since its own focus() no longer does. `nearest` is the
    // whole point: it moves by the smallest amount that clears the edge, so a walk down the Page
    // steps by one row rather than recentring, and it obeys the `scroll-padding-top` the scroll
    // container declares — which is what keeps a Block reached from below out from under the window
    // chrome. Optional call because jsdom implements no scrolling at all.
    row?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  useEffect(() => {
    if (blockSelectionFocus) rowRef.current?.focus();
  }, [blockSelectionFocus]);

  /**
   * Sit the gutter on the Block's first line, measured rather than declared.
   *
   * editor.css carries a `--controls-lead` per kind, arrived at as
   * `contentPaddingTop + (firstLineBoxHeight - 24) / 2` and then hand-corrected against the running
   * app. Arithmetic cannot reach the container kinds — their chrome is a card padding, a border, an
   * icon and a summary control, each of which can move without the constant beside it moving — and
   * five of them had drifted 4.00-10.50px off the line they point at while paragraphs, lists,
   * headings, code and unsupported stayed exact. A constant per kind is a snapshot of a layout; this
   * is the layout.
   *
   * A correction, not a replacement. The stylesheet still states the lead, and a measurement that
   * would move the handle further than its own height is rejected as measuring some other line:
   * `firstLineBox` skips text the Block derived rather than text the file holds, so a callout
   * written as `[!NOTE]` with no title of its own — whose visible first line is the derived label —
   * would otherwise have dropped the handle 28.00px onto its body.
   *
   * Only while the Block is at rest. The gutter points at the Block *as it is read*, and an editing
   * surface is entitled to differ from the preview it replaces — a raw Block's own surface pads
   * 16px against the preview's 8px, and an image grows an Edit control out of nothing. Re-measuring
   * on activation let that chrome drag the handle, and (before the change below) resize the Block
   * under the pointer: measured, an image went 38.50px -> 47.00px the moment it was pressed.
   *
   * Measured, then written — never measured, written, measured, written. See `scheduleGutterAlign`.
   */
  useLayoutEffect(() => {
    const row = rowRef.current;
    const content = row?.querySelector<HTMLElement>("[data-native-block-content]");
    const controls = row?.querySelector<HTMLElement>("[data-native-block-controls]");
    if (!row || !content || !controls || active) return;
    // Cleared here rather than inside the measurement, so the declaration read below is the
    // stylesheet's own answer rather than the last correction this made — and so that clearing it
    // is a write in React's commit phase beside every other row's, never one standing between two
    // rows' measurements.
    row.style.removeProperty("--controls-lead");
    // The stylesheet's own lead, read once. It is a function of the kind and the level, both of
    // which re-run this effect, so a resize never has to ask for it again — and asking again would
    // mean clearing the correction first, which is the write this exists to avoid.
    let declared: number | null = null;
    // What the row's lead currently resolves to, so a measurement that changes nothing writes
    // nothing. Measured on a 1000-Block Page, paragraphs, lists and quotes all measure the value
    // the stylesheet already gives them, so most of a Page never writes at all.
    let applied = 0;
    const measure = () => {
      if (declared === null) {
        declared = Number.parseFloat(window.getComputedStyle(controls).paddingTop) || 0;
        applied = declared;
      }
      // A picture or a rendered diagram has no first line to sit on. The declared lead is the
      // answer there, and it is a better one than the middle of a 300px image.
      const line = firstLineBox(content);
      const lead = line
        ? line.top + line.height / 2 - content.getBoundingClientRect().top - GUTTER_CONTROL_SIZE / 2
        : declared;
      const next =
        Math.abs(lead - declared) > GUTTER_CONTROL_SIZE ? declared : Math.round(lead * 100) / 100;
      if (next === applied) return null;
      applied = next;
      return () => row.style.setProperty("--controls-lead", `${next}px`);
    };
    scheduleGutterAlign(measure);
    // A Block whose first line arrives late still gets one: a Mermaid diagram renders
    // asynchronously, an image resolves its bytes over IPC, and a container's body can be typed
    // into. Each of those changes the content box, which is what this watches.
    const observer = new ResizeObserver(() => scheduleGutterAlign(measure));
    observer.observe(content);
    return () => {
      observer.disconnect();
      pendingGutterAligns.delete(measure);
    };
  }, [active, block.kind, block.level]);

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
    noteCaretOffset(event.target.selectionEnd, event.target.value);
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
    if (wikiMenuOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setWikiIndex((current) => (current + direction + wikiMatches.length) % wikiMatches.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const page = wikiMatches[wikiIndex] ?? wikiMatches[0];
        if (page && wikiRun) onInsertWikiLink?.(block.id, wikiLinkSource(page, wikiPages), wikiRun);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        // Leaves the literal `[[` the user typed in place — dismissing is never an edit.
        setDismissedWikiStart(wikiRun?.start ?? null);
        return;
      }
    }
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
        (from < to || markdownLinkDestinationAt(source, from, to))
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
      if (
        leaving &&
        onNavigate(block.id, direction, boundary ? { x: boundary.caretX, offset: from } : undefined)
      ) {
        event.preventDefault();
      }
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
      event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      useSemanticInlineEditor
    ) {
      // A soft break, written here rather than left to the browser. In a textarea the default
      // inserts exactly "\n"; in a contenteditable it inserts a block element, which came back
      // through the projection as a blank line — and a blank line ends the paragraph, so
      // Shift+Enter split the Block instead of adding a line to it. That is what kept every
      // multi-line Block on the raw textarea.
      event.preventDefault();
      onChange(block.id, `${source.slice(0, from)}\n${source.slice(to)}`, { caret: from + 1 });
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
        onIndent &&
        onIndent(block.id, -1, { anchor: 0, head: 0 }) !== false
      ) {
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
      // A refused outdent must not eat the keystroke — falling through to the merge keeps the
      // Block reachable instead of leaving the caret in a dead end.
      if (
        (block.depth ?? 0) > 0 &&
        isListBlockKind(block.kind) &&
        onIndent &&
        onIndent(block.id, -1, { anchor: 0, head: 0 }) !== false
      ) {
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
    // Captured here, while the Block still owns the selection. A moment later the popover's input
    // has focus and there is nothing left to read: a textarea keeps its own offsets across a blur,
    // but the document selection a semantic Block edits through is simply gone.
    const domSelection = window.getSelection();
    const range =
      surface && !(surface instanceof HTMLTextAreaElement) && domSelection?.rangeCount
        ? domSelection.getRangeAt(0).cloneRange()
        : null;
    linkEditorReturnRef.current = { from, to, range };
    setInlineSelection(null);
    setLinkEditor({
      from,
      to,
      url: markdownLinkDestinationAt(source, from, to),
      position,
      // What the link is about to apply to, drawn by this Block for as long as the popover holds
      // focus. Measured on a five-character run, 743px² of tint went to 0 the instant Mod+K was
      // pressed — neither surface paints an unfocused selection, and a semantic Block's document
      // selection is gone outright — so the reader was being asked about a run they could no longer
      // see. The boxes are read now and held: the popover's own position is a captured `fixed`
      // coordinate too, so both go stale together or not at all.
      selectionRects: surface ? selectionLineRects(surface, from, to, range) : [],
    });
  };

  /**
   * Close the link editor without writing anything, and give the keyboard back.
   *
   * Escaping the popover used to leave `document.activeElement` on `<body>` and the editor dead from
   * there: measured, 20 of 20 sampled frames on body, Escape/arrows/Enter/Backspace all leaving it
   * there, only Shift+Tab or a mouse press recovering, and three characters typed into that state
   * leaving the file byte-identical. The popover's `<input>` had taken focus, and when React
   * unmounted it the browser had nothing to hand focus back to.
   *
   * A committed link clears the return instead: the runtime has just rewritten the Block and holds a
   * selection of its own, around the link it wrote, and restoring the old one would fight it.
   */
  const cancelLinkEditor = () => {
    setLinkEditor(null);
  };

  /**
   * Hand focus and the caret back once the popover is actually gone.
   *
   * From an effect rather than from the handler, because the handler runs before the commit that
   * removes the input, and that removal is what puts focus on `<body>`. Addressed by the Block's own
   * offsets rather than by a reference to the element that had focus, because the row re-renders in
   * between — the saved `Range` is only a fast path for the semantic surface, whose caret lives in
   * text nodes this row does not own, and it is used only while its nodes are still in the document.
   * `preventScroll` for the same reason activation uses it: a restore must not move the Page.
   */
  useEffect(() => {
    if (linkEditor) return;
    const target = linkEditorReturnRef.current;
    if (!target) return;
    linkEditorReturnRef.current = null;
    const surface = rowRef.current?.querySelector<HTMLElement>("[data-native-block-editor]");
    if (!surface) return;
    surface.focus({ preventScroll: true });
    if (surface instanceof HTMLTextAreaElement) {
      surface.setSelectionRange(target.from, target.to);
      return;
    }
    const domSelection = window.getSelection();
    if (!target.range || !target.range.startContainer.isConnected || !domSelection) return;
    domSelection.removeAllRanges();
    domSelection.addRange(target.range);
  }, [linkEditor]);

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
      //
      // `outline-none` because keyboard focus is drawn below on the fill's own box. The UA outline
      // was on this element, which is the row: measured, `auto 1px rgb(229,151,0)` at left 312.00
      // against the fill's 377.00, wrapping the gutter controls at 347-371 and, in a run of selected
      // Blocks, cutting an amber line across the one continuous blue band.
      className="group/native-block relative flex min-h-9 items-start gap-[6px] rounded-md py-0.5 pl-1 pr-1 outline-none"
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
      // No `aria-label` here on purpose: the runtime writes it, for every row, in
      // `labelRowsWithOrdinals`. The name carries the Block's ordinal, which changes on every row
      // the moment one is inserted or removed — as a prop that invalidated `sameRowProps` for all N
      // rows and made each rebuild its editing projection and inline parse. React must not render
      // the attribute at all, or the two writers would fight over it every time a row re-renders.
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
      {blockSelected ? null : (
        // Keyboard focus, on the box the selection fill uses. Same top, same left, same radius, so
        // the two states are one rectangle that changes colour instead of two rectangles 65.00px
        // apart. Not drawn on a selected Block at all: the fill already says where the Block is, and
        // a ring inside a multi-Block band is a line across the middle of it.
        <div
          aria-hidden="true"
          data-native-block-focus-ring
          className="pointer-events-none absolute rounded-[3px] opacity-0 ring-1 ring-inset ring-[rgb(35,131,226)] group-focus-visible/native-block:opacity-100"
          // The geometry is `[data-native-block-row]::after`'s, byte for byte, and inline for that
          // reason: a pseudo-element and a class cannot be kept in step by reading one another.
          style={{
            top: "calc(var(--row-lead) - 1px)",
            left: "var(--editor-content-rail, 4rem)",
            right: 0,
            bottom: -1,
          }}
        />
      )}
      {/*
       * Width in the flow, height out of it.
       *
       * The row is a flex container, so it is as tall as its tallest item — and one of its items is
       * chrome that lives in the margin. That made the Block's height a function of the gutter: the
       * gutter is 24px of buttons plus `--controls-lead`, and any kind whose lead grows past its own
       * content grew the row with it. The 54px here is still in the flow, because the content rail
       * is `pl-1 + 54px + gap-[6px] = 4rem` and that arithmetic is what every overlay hangs off.
       * The controls themselves overflow it, which costs nothing: they are 24px tall inside a row
       * with a 36px floor, and `contain: layout style` does not clip.
       */}
      <div className="h-0 w-[54px] shrink-0">
        <div
          data-native-block-controls
          // Reveal/hide timing and first-line alignment live in editor.css.
          className="flex items-start justify-end"
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
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
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
            foldState={foldState}
            onToggleFold={onToggleFold ? () => onToggleFold(block.id) : undefined}
            onDelete={() => onDelete(block.id)}
            onDragStart={(event) => onDragStart(block.id, event)}
            onDragEnd={onDragEnd}
          />
        </div>
      </div>

      <div
        data-native-block-content
        // A quote's leftmost ink is a border, and a border sits outside padding: every other kind
        // pays its own `px-1` between the content rail and its first glyph, so a quote's bar landed
        // at 377.00 against 381.00 everywhere else and the grip->ink gap read 6.00px instead of
        // 10.00px. The 4px is on the column rather than on either surface so the rendered quote and
        // the one being edited cannot disagree about it.
        className={block.kind === "blockquote" ? "min-w-0 flex-1 pl-1" : "min-w-0 flex-1"}
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
        {tableGeometry ? (
          // Rendered from one place in both states, so the grid is never unmounted and the Block
          // cannot lose its borders, its height or its alignment row on activation.
          <MarkdownTableBlock
            blockId={block.id}
            source={source}
            geometry={tableGeometry}
            editable={active && block.editable}
            // The prop, not `restoredSelection`: a carried selection is this Block's own caret being
            // moved from one surface to another, which is not an entry at all.
            entry={selection?.entry}
            onChange={onChange}
            onCellKeyDown={handleInPlaceKeyDown}
            renderCell={(text) => (
              <InlineMarkdownPreview source={text} onOpenWikiLink={onOpenWikiLink} />
            )}
          />
        ) : inPlaceBlock ? (
          inPlaceBlock
        ) : active && block.editable ? (
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
                <span className={LIST_MARKER_COLUMN}>
                  <input
                    type="checkbox"
                    aria-label={activeListItem.content || "Empty task"}
                    className="mt-1.5 h-4 w-4 shrink-0 rounded border-muted-foreground/50"
                    checked={block.checked ?? false}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => onSetTaskChecked(block.id, event.target.checked)}
                  />
                </span>
              ) : activeListItem ? (
                <span
                  className={`${LIST_MARKER_COLUMN} select-none text-muted-foreground`}
                  aria-hidden
                >
                  <span className={LIST_MARKER_INK}>{activeListItem.marker}</span>
                </span>
              ) : null}
              {useSemanticInlineEditor ? (
                <SemanticInlineEditor
                  id={editorId}
                  describedBy={descriptionId}
                  source={source}
                  selection={restoredSelection}
                  autoFocus={autoFocusEditor}
                  searchHighlight={searchHighlight}
                  placeholder={source.length === 0 ? blockPlaceholder(block) : undefined}
                  className="native-block-textarea block min-w-0 flex-1 whitespace-pre-wrap break-words bg-transparent outline-none"
                  onSourceChange={(nextSource, nextSelection) => {
                    editorSelectionRef.current = nextSelection;
                    noteCaretOffset(nextSelection.head, nextSource);
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
                  // The slash panel never takes focus — the caret has to stay where the command
                  // will be written — so without these the panel was inaudible: a screen reader
                  // announced neither that it had opened nor which command the arrows were moving
                  // over, because nothing on the focused element pointed at it. Deliberately no
                  // `role="combobox"` and no `aria-expanded`: this surface is a real textarea whose
                  // multi-line editing behaviour is the point, and the role does not support them.
                  aria-haspopup="listbox"
                  aria-controls={slashMenuOpen ? slashListboxId : undefined}
                  aria-activedescendant={
                    slashMenuOpen && slashCommands[slashIndex]
                      ? `${slashListboxId}-${slashCommands[slashIndex].id}`
                      : undefined
                  }
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
                    const caret = event.currentTarget.selectionEnd;
                    setComposingValue(null);
                    onCompositionEnd(block.id);
                    // Every other input path mirrors the caret before issuing its command; this one
                    // did not, so after a composition the slash run fell back to a selection last
                    // written before the composition began — offset 0 on a Block that now held the
                    // trigger. Both have to be told about the committed text, not the stale one.
                    editorSelectionRef.current = {
                      anchor: event.currentTarget.selectionStart,
                      head: caret,
                    };
                    noteCaretOffset(caret, settled);
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
            {linkEditor
              ? // Portalled onto `document.body`, both of them. Their coordinates are viewport
                // coordinates — a caret rect and a selection rect, measured against the window —
                // but a `position: fixed` child of this row resolves against the *row*, which is a
                // containing block twice over: it carries `contain: layout style` and the page
                // frame above it a transform. Measured, the popover asked for top 101 / left 397.5
                // and was drawn at 193 / 727, so the link editor opened a row and a half below the
                // words it was about to wrap. `data-native-editor-overlay` for the same reason the
                // slash panel carries it: outside the editor's DOM, the runtime would otherwise
                // read a press in here as a press away from the Block.
                createPortal(
                  <div data-native-editor-overlay>
                    {linkEditor.selectionRects.map((rect, rectIndex) => (
                      <div
                        key={rectIndex}
                        aria-hidden
                        data-native-link-selection
                        className="pointer-events-none fixed"
                        style={{
                          top: rect.top,
                          left: rect.left,
                          width: rect.width,
                          height: rect.height,
                          // `.markdown-page ::selection`'s own colour, so the run reads as the same
                          // selection rather than as a second kind of highlight. One value for both
                          // themes: the dark rule differs only in alpha, 0.34 against 0.28, and an
                          // inline style cannot ask which theme is on.
                          backgroundColor: "rgba(35, 131, 226, 0.28)",
                        }}
                      />
                    ))}
                    <LinkEditPopover
                      url={linkEditor.url}
                      position={linkEditor.position}
                      onCancel={cancelLinkEditor}
                      onCommit={(url) => {
                        linkEditorReturnRef.current = null;
                        setLinkEditor(null);
                        if (url.trim()) onEditLink?.(block.id, linkEditor.from, linkEditor.to, url);
                      }}
                    />
                  </div>,
                  document.body
                )
              : null}
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
                    id={slashListboxId}
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
                    className={`z-50 w-[min(314px,calc(100vw-2rem))] overflow-y-auto overscroll-contain ${MENU_PANEL_CLASS}`}
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
                          id={`${slashListboxId}-${command.id}`}
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
            {wikiMenuOpen && wikiPosition
              ? createPortal(
                  <div
                    ref={wikiListRef}
                    role="listbox"
                    aria-label="Wiki link targets"
                    // Same exemption as the slash panel: portalled onto `document.body`, so without
                    // this the runtime's outside-press listener would close the Block being edited.
                    data-native-editor-overlay
                    style={{
                      position: "fixed",
                      top: wikiPosition.top,
                      left: wikiPosition.left,
                      maxHeight: wikiPosition.maxHeight,
                      transform: wikiPosition.flipped ? "translateY(-100%)" : undefined,
                    }}
                    className={`z-50 w-[min(314px,calc(100vw-2rem))] overflow-y-auto overscroll-contain ${MENU_PANEL_CLASS}`}
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    {wikiMatches.map((page, pageIndex) => (
                      <button
                        key={page.id}
                        type="button"
                        role="option"
                        tabIndex={-1}
                        aria-selected={pageIndex === wikiIndex}
                        className={`flex h-[31px] w-full items-center gap-2.5 rounded-md px-2 text-left transition-colors duration-[20ms] ease-in ${
                          pageIndex === wikiIndex ? "bg-accent text-accent-foreground" : ""
                        }`}
                        onMouseMove={() => setWikiIndex(pageIndex)}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (wikiRun) {
                            onInsertWikiLink?.(block.id, wikiLinkSource(page, wikiPages), wikiRun);
                          }
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate text-sm">{page.name}</span>
                        {page.folder ? (
                          <span className="min-w-0 max-w-[45%] shrink truncate text-[11px] text-muted-foreground">
                            {page.folder}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>,
                  document.body
                )
              : null}
            <div data-native-block-print-preview className="hidden">
              <BlockPreview
                block={block}
                listOrdinal={listOrdinal}
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
            listOrdinal={listOrdinal}
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

/**
 * The Block fields this row draws from.
 *
 * `from` and `to` are deliberately not compared, and that omission is the whole point: an edit
 * shifts the span of every Block after it, so comparing them would report every row as changed and
 * defeat the memo entirely. Nothing here reads them — the `.from`/`.to` sites in this file are all
 * `visibleRange`, `inlineSelection`, `cellFor()` and `line.from`, which are Block-relative offsets.
 */
function sameBlockView(previous: MarkdownBlockView, next: MarkdownBlockView): boolean {
  return (
    previous.id === next.id &&
    previous.kind === next.kind &&
    previous.level === next.level &&
    previous.depth === next.depth &&
    previous.raw === next.raw &&
    previous.editable === next.editable &&
    previous.checked === next.checked
  );
}

function sameRowSelection(
  previous: MarkdownBlockRowProps["selection"],
  next: MarkdownBlockRowProps["selection"]
): boolean {
  if (!previous || !next) return previous === next;
  return previous.anchor === next.anchor && previous.head === next.head;
}

/**
 * Whether a row can skip re-rendering.
 *
 * `MarkdownBlockDocument.getSnapshot()` rebuilds every Block view on every call, so each row's
 * `block` is a fresh object after every keystroke and a plain shallow `memo` could never skip
 * anything: one character re-ran `createBlockEditingProjection` and `projectMarkdownInline` for all
 * N rows, which is why typing latency grew with document length.
 *
 * Compared generically over every prop rather than by hand-enumerating them, so a prop added later
 * is covered by default instead of being silently ignored. Only the two props that are value-equal
 * but identity-unstable are special-cased.
 *
 * The key-count check stands in for a union of both key sets: a prop that disappeared between
 * renders is invisible to the loop, because a missing key reads as the same `undefined` a present
 * one holding `undefined` does. Building that union instead — two key arrays and a Set per row —
 * measured 16ms per keystroke on an 8000-Block Page, more than every comparison it performed.
 */
function sameRowProps(previous: MarkdownBlockRowProps, next: MarkdownBlockRowProps): boolean {
  if (Object.keys(previous).length !== Object.keys(next).length) return false;
  for (const name in next) {
    const key = name as keyof MarkdownBlockRowProps;
    if (key === "block") {
      if (!sameBlockView(previous.block, next.block)) return false;
    } else if (key === "selection") {
      if (!sameRowSelection(previous.selection, next.selection)) return false;
    } else if (!Object.is(previous[key], next[key])) {
      return false;
    }
  }
  return true;
}

export const MarkdownBlockRow = memo(MarkdownBlockRowView, sameRowProps);

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
export interface MarkdownWikiLinkRun {
  /** Offset of the opening `[[`. */
  readonly start: number;
  /** Caret offset — the end of what the user has typed so far. */
  readonly end: number;
  readonly query: string;
}

/**
 * The `[[` run the caret sits inside, or null.
 *
 * Unlike a slash run, whitespace does not end it: Page names have spaces in them, and stopping at
 * the first one would make every multi-word Page unreachable. A closing `]]` does end it, so the
 * popup does not reopen behind a link the user already finished.
 */
function wikiLinkRunAt(source: string, caret: number): MarkdownWikiLinkRun | null {
  const end = Math.min(Math.max(caret, 0), source.length);
  for (let index = end - 1; index >= 1; index -= 1) {
    const char = source[index];
    if (char === "\n" || char === "\r") return null;
    // A `]` between the caret and the `[[` closes the run, whichever half of `]]` it is.
    if (char === "]") return null;
    if (char !== "[" || source[index - 1] !== "[") continue;
    return { start: index - 1, end, query: source.slice(index + 1, end) };
  }
  return null;
}

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
    // 434, not 320. Notion's own command panel measures at most 434px tall
    // (docs/BLOCK_UX_REFERENCE.md), and the panel offers 21 commands at 31px
    // each — a 320px ceiling showed ten of them and put the rest behind a
    // scroll the caret cannot see. The clamp still yields to the viewport, so a
    // short window shrinks the panel exactly as before; only the ceiling moved.
    maxHeight: Math.max(Math.min(flipped ? above : below, 434), 120),
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
  // A preview that is not a verbatim rendering of its source can declare where one of its fragments
  // begins, and a point inside that fragment is then exact rather than counted from the top of a
  // Block that also renders chrome of its own. This is the general form of the `data-table-cell`
  // offsets a table already carries; a callout uses it per line, because each line loses a `>`
  // prefix of its own width.
  const anchor = node.parentElement?.closest<HTMLElement>("[data-source-offset]");
  if (anchor && container.contains(anchor)) {
    const within = textOffsetWithin(anchor, node, offset);
    const base = Number(anchor.dataset.sourceOffset);
    if (within !== null && Number.isFinite(base)) {
      return Math.min(base + within, source.length);
    }
  }
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

/** The gutter's controls are 24px square, so half of one is what a lead has to centre. */
const GUTTER_CONTROL_SIZE = 24;

/**
 * Every Block's gutter lead measured in one pass, then written in one pass.
 *
 * The measurement reads three geometries and writes one custom property. Run row by row as the
 * rows mount, that is write -> read -> write -> read down one shared flow container: each write
 * dirties layout for the whole document and the next row's read forces it again, so the cost of
 * opening a Page went with the square of its length. Measured in the packaged app on a 1000-Block
 * Page: 304 forced layouts, 3.005s inside layout, and the window still showing the previous screen
 * 3.9s after the click. Neutering only the write — every read left in place — took that to 7
 * layouts and 0.055s. The reads are free; the interleaving is the whole cost.
 *
 * So the rows hand in a measurement and get back a write. Every measurement runs first, then every
 * write, which costs one forced layout for the batch however many Blocks are in it. Measured
 * against the dev build, where the same interleave cost 0.7 forced layouts per Block to open a Page
 * and 0.2 per Block to resize the window: opening now costs 8 whether the Page is 250 Blocks or
 * 1000, and a resize costs 2.
 *
 * A microtask rather than a frame: React's layout effects and a ResizeObserver delivery both run
 * before the browser paints, and the microtask checkpoint that follows them does too. The gutter is
 * still correct in the first painted frame, which is the reason it is measured in a layout effect
 * at all.
 */
const pendingGutterAligns = new Set<() => (() => void) | null>();
let gutterAlignScheduled = false;

function scheduleGutterAlign(measure: () => (() => void) | null): void {
  pendingGutterAligns.add(measure);
  if (gutterAlignScheduled) return;
  gutterAlignScheduled = true;
  queueMicrotask(() => {
    gutterAlignScheduled = false;
    const measures = [...pendingGutterAligns];
    pendingGutterAligns.clear();
    const writes: (() => void)[] = [];
    for (const pending of measures) {
      const write = pending();
      if (write) writes.push(write);
    }
    for (const write of writes) write();
  });
}

/**
 * The box of the first line the reader can see inside a Block, or null if it draws none.
 *
 * Line boxes rather than element boxes, because a Block's first *element* is routinely not its
 * first line: a callout leads with an icon, a toggle with a chevron, a table with a border and a
 * row of handles. A `Range` over a text node reports the boxes that text actually occupies, which
 * is the thing the gutter is supposed to point at.
 *
 * Two runs are rejected. Text inside `aria-hidden` is chrome the Block derived rather than text the
 * file holds — a callout with no title of its own is labelled `Note`, and centring on that would
 * mean the gutter sat on different ink depending on whether the user had typed a title. Text with
 * no box is whitespace between elements, which has no line of its own to sit on.
 *
 * The `<hr>` fallback is the divider, whose single line of ink is not text at all.
 */
export function firstLineBox(content: HTMLElement): DOMRect | null {
  const walker = content.ownerDocument.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue?.trim()) continue;
    if (node.parentElement?.closest('[aria-hidden="true"]')) continue;
    const range = content.ownerDocument.createRange();
    range.selectNodeContents(node);
    // Guarded the way `caretLineBoundary` guards its own measurement: jsdom lays nothing out and
    // does not implement this, so a component rendered in a unit test would otherwise throw out of
    // a layout effect.
    const box = typeof range.getClientRects === "function" ? range.getClientRects()[0] : undefined;
    if (box) return box;
  }
  const rule = content.querySelector("hr");
  return rule ? rule.getBoundingClientRect() : null;
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
  // Guarded the way `firstLineBox` guards its own measurement: jsdom lays nothing out and does not
  // implement this on a Range, and the caret in a cell or a container region is now measured from
  // inside a key handler, so an unguarded call throws out of one under test rather than reporting
  // "no geometry here" the way every other measurement in this file does.
  if (typeof range.getClientRects !== "function") return null;
  const rects = range.getClientRects();
  const rect = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect();
  if (!rect || (rect.height === 0 && rect.top === 0)) return null;
  return rect as DOMRect;
}

/**
 * An off-screen copy of a textarea's box and type, for measuring glyphs the DOM cannot show.
 *
 * A textarea's value lives outside the DOM: no text nodes, no `Range`, no client rects, no caret
 * geometry. Laying the same string out in a div with the same box, font and wrapping is the only way
 * to ask where a character sits. Callers append their own content, measure it, and remove the mirror
 * — the three that do want three different answers out of the same layout.
 */
function textareaMirror(textarea: HTMLTextAreaElement): HTMLDivElement {
  const rect = textarea.getBoundingClientRect();
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
    textTransform: computed.textTransform,
    textIndent: computed.textIndent,
    tabSize: computed.tabSize,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    wordBreak: computed.wordBreak,
  });
  return mirror;
}

/**
 * Measure a textarea caret by laying out the same text in an off-screen mirror. A textarea gives
 * no caret geometry of its own, and this is the same technique the selection toolbar already uses.
 */
function textareaCaretRect(textarea: HTMLTextAreaElement, caret: number): DOMRect | null {
  if (textarea.getBoundingClientRect().height <= 0) return null;
  const mirror = textareaMirror(textarea);
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
  const mirror = textareaMirror(textarea);
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

/**
 * The boxes a selection paints, one per visual line, in viewport coordinates.
 *
 * Read while the Block still owns the selection, because a moment later it does not: an overlay that
 * takes focus wipes the document selection outright, and a blurred textarea keeps its offsets but
 * paints nothing. `range` is the semantic surface's own selection, already cloned by the caller.
 */
function selectionLineRects(
  surface: HTMLElement,
  from: number,
  to: number,
  range: Range | null
): readonly { top: number; left: number; width: number; height: number }[] {
  if (from >= to) return [];
  const boxes =
    surface instanceof HTMLTextAreaElement
      ? textareaSelectionRects(surface, from, to)
      : (range?.getClientRects() ?? []);
  return Array.from(boxes)
    .filter((box) => box.width > 0 && box.height > 0)
    .map((box) => ({ top: box.top, left: box.left, width: box.width, height: box.height }));
}

function textareaSelectionRects(
  textarea: HTMLTextAreaElement,
  from: number,
  to: number
): readonly DOMRect[] {
  const mirror = textareaMirror(textarea);
  mirror.append(document.createTextNode(textarea.value.slice(0, from)));
  const span = document.createElement("span");
  span.textContent = textarea.value.slice(from, to);
  mirror.append(span, document.createTextNode(textarea.value.slice(to)));
  document.body.append(mirror);
  const rects = Array.from(span.getClientRects());
  mirror.remove();
  return rects;
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

export function blockTypeLabel(block: MarkdownBlockView): string {
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
  listOrdinal,
}: {
  block: MarkdownBlockView;
  listOrdinal?: number;
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
      const nestedOrdinals = orderedListDisplayOrdinals(nestedBlocks);
      return (
        <TogglePreviewShell toggle={toggle} source={source} onOpenWikiLink={onOpenWikiLink}>
          <div
            data-native-toggle-content
            className="space-y-0.5 border-t border-border/70 px-3 py-2"
          >
            {nestedBlocks.length ? (
              nestedBlocks.map((nested) => (
                <BlockPreview
                  key={nested.id}
                  listOrdinal={nestedOrdinals.get(nested.id)}
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
        </TogglePreviewShell>
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
              <div className="font-semibold" data-source-offset={callout.titleFrom}>
                {callout.title}
              </div>
            ) : (
              // Derived from `[!TYPE]`, present in no byte of the file. Hidden from the caret
              // mapping the same way the icon is, and from screen readers too, since the `<aside>`
              // above already announces the type.
              <div className={`font-semibold ${style.accent}`} aria-hidden="true">
                {style.label}
              </div>
            )}
            {callout.body.length ? (
              <div className="whitespace-pre-wrap break-words">
                {callout.body.map((line, index) => (
                  <div key={`callout-line-${index}`} data-source-offset={line.from}>
                    {line.text ? (
                      <InlineMarkdownPreview source={line.text} onOpenWikiLink={onOpenWikiLink} />
                    ) : (
                      <br />
                    )}
                  </div>
                ))}
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
  const listItem = listItemPreview(source, block.kind, listOrdinal);
  if (listItem) {
    const content = listItem.content ? (
      <InlineMarkdownPreview source={listItem.content} onOpenWikiLink={onOpenWikiLink} />
    ) : null;
    if (block.kind === "task_list_item") {
      return (
        <div data-editor-kind="task_list_item" className="flex min-h-9 items-start gap-2 px-1 py-1">
          <span className={LIST_MARKER_COLUMN}>
            <input
              type="checkbox"
              aria-label={listItem.content || "Empty task"}
              className="mt-1.5 h-4 w-4 shrink-0 rounded border-muted-foreground/50"
              checked={block.checked ?? false}
              disabled={readOnly}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => onSetTaskChecked(block.id, event.target.checked)}
            />
          </span>
          <span className={block.checked ? "text-muted-foreground line-through" : undefined}>
            {content}
          </span>
        </div>
      );
    }
    return (
      <div data-editor-kind={block.kind} className="flex min-h-9 items-start gap-2 px-1 py-1">
        <span className={`${LIST_MARKER_COLUMN} select-none text-muted-foreground`} aria-hidden>
          <span className={LIST_MARKER_INK}>{listItem.marker}</span>
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
    // No `font-normal`. The focused surface's `::placeholder` inherits the heading's 600 from
    // `[data-editor-kind="heading"]`, so pinning this one to 400 made the grey "Heading 1" visibly
    // thicken and widen the moment an empty heading was clicked — the same mismatch that
    // `tracking-tight` caused here once already, in the property next door.
    <span data-block-placeholder aria-hidden="true" className="select-none">
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
  const embeddedOrdinals = useMemo(
    () => orderedListDisplayOrdinals(embeddedBlocks),
    [embeddedBlocks]
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
                listOrdinal={embeddedOrdinals.get(block.id)}
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
  kind: MarkdownBlockView["kind"],
  ordinal?: number
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
    const match = source.match(/^[ \t]*(\d{1,9})([.)])([ \t]+|$)/);
    if (!match) return null;
    // The counted ordinal, falling back to the source's own when there is no run context — the
    // separator stays whatever the file used, so a `1)` list keeps its parentheses.
    const number = ordinal ?? match[1];
    return { marker: `${number}${match[2]}`, content: source.slice(match[0].length) };
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

/**
 * A toggle's chrome, with the disclosure separated from the title.
 *
 * A `<summary>` natively owns every press inside it, and this one also stopped the press
 * propagating so the disclosure could keep it. Since a closed `<details>` shows nothing but its
 * summary, that left a toggle with no pixel a pointer could use to edit it: its title was reachable
 * from the keyboard only. Notion draws the same distinction the other way round — the triangle
 * toggles, the text is text — so the chevron takes the gesture and the title is left alone.
 *
 * The open state is view state, not document state. `<details open>` in the file is the initial
 * value, and expanding a toggle to read it must not rewrite the user's Markdown, so the override
 * lives here and is dropped whenever the source changes underneath it.
 */
function TogglePreviewShell({
  toggle,
  source,
  onOpenWikiLink,
  children,
}: {
  toggle: MarkdownToggle;
  source: string;
  onOpenWikiLink?: (target: string) => void;
  children: ReactNode;
}) {
  const [override, setOverride] = useState<boolean | null>(null);
  useEffect(() => setOverride(null), [source]);
  const open = override ?? toggle.open;
  return (
    <details
      data-testid="toggle-block"
      data-native-toggle
      open={open}
      className="my-1 min-h-9 rounded-lg border border-border bg-muted/20"
    >
      <summary
        // `gap-2.5` is the callout's, for the reason given in markdown-container-block.tsx: the two
        // kinds lead with the same 16px control at the same x, so their titles start at the same x.
        className="flex list-none items-start gap-2.5 break-words px-3 py-2 font-medium [&::-webkit-details-marker]:hidden"
        // Cancel the native disclosure but let the press keep travelling, so the row can activate
        // the Block the way it does for every other kind.
        onClick={(event) => event.preventDefault()}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Collapse toggle" : "Expand toggle"}
          className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors duration-[20ms] ease-in hover:bg-muted hover:text-foreground"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOverride(!open);
          }}
        >
          <ChevronRight
            className={`h-3.5 w-3.5 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
        </button>
        <span className="min-w-0 flex-1" data-source-offset={toggle.summaryFrom}>
          <InlineMarkdownPreview source={toggle.summary} onOpenWikiLink={onOpenWikiLink} />
        </span>
      </summary>
      {children}
    </details>
  );
}

interface CalloutPreviewLine {
  readonly text: string;
  /** Where this line's text begins in the Block's source, past its `>` prefix. */
  readonly from: number;
}

/**
 * A callout's parts, each carrying the source offset its text starts at.
 *
 * The offsets are the point. A callout's preview is not a verbatim rendering of its source: every
 * line loses a `>` prefix whose width varies, and the Block gains an icon and a type label that
 * exist nowhere in the file. Counting rendered characters to find a source position therefore lands
 * short by everything the preview added and by every prefix it removed, which is why pressing a
 * word in a callout used to put the caret several characters before it.
 */
function calloutPreview(
  source: string
): { type: string; title: string; titleFrom: number; body: CalloutPreviewLine[] } | null {
  const lines: CalloutPreviewLine[] = [];
  let offset = 0;
  for (const raw of source.split(/\r\n|\n|\r/)) {
    const prefix = /^ {0,3}>[ \t]?/.exec(raw)?.[0] ?? "";
    lines.push({ text: raw.slice(prefix.length), from: offset + prefix.length });
    // Splitting on the union of terminators loses which one matched, so read it back off the source
    // rather than assuming `\n` and drifting by one character per line in a CRLF file.
    offset += raw.length + (source.startsWith("\r\n", offset + raw.length) ? 2 : 1);
  }
  const header = lines[0]?.text.match(/^\[!([A-Za-z][A-Za-z0-9_-]*)\][+-]?(?:[ \t]+(.*))?$/);
  if (!header) return null;
  const title = header[2] ?? "";
  return {
    type: header[1].toUpperCase(),
    title,
    titleFrom: lines[0].from + (title ? lines[0].text.length - title.length : 0),
    body: lines.slice(1),
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
  let blocks: InlinePreviewToken[] = [];
  try {
    blocks = inlinePreviewLexer.lexer(source) as InlinePreviewToken[];
  } catch {
    blocks = [];
  }
  const renderable = blocks.filter((token) => token.type !== "space");
  if (renderable.length === 0) {
    return (
      <>
        {renderInlineTokens(
          [{ type: "text", raw: source, text: source }],
          "inline",
          onOpenWikiLink
        )}
      </>
    );
  }
  // The common case — one paragraph — renders exactly as it always has, which is what every
  // caller inside a table cell or a callout line depends on.
  if (renderable.length === 1) {
    const only = renderable[0];
    return (
      <>
        {renderInlineTokens(
          only.tokens ?? [{ type: "text", raw: source, text: source }],
          "inline",
          onOpenWikiLink
        )}
      </>
    );
  }
  // A list item can hold a second paragraph or an indented fence. Only the first token used to
  // be rendered, so that content was on disk and nowhere on screen — the bytes survived every
  // edit and the user could not see them.
  return (
    <>
      {renderable.map((token, index) => (
        <PreviewBlockToken
          key={`block-${index}`}
          token={token}
          keyPrefix={`block-${index}`}
          onOpenWikiLink={onOpenWikiLink}
        />
      ))}
    </>
  );
}

function PreviewBlockToken({
  token,
  keyPrefix,
  onOpenWikiLink,
}: {
  token: InlinePreviewToken;
  keyPrefix: string;
  onOpenWikiLink?: (target: string) => void;
}) {
  if (token.type === "code") {
    return (
      <pre className="my-1 overflow-x-auto rounded-md bg-muted px-2 py-1.5 font-mono text-[0.9em]">
        <code>{token.text ?? token.raw ?? ""}</code>
      </pre>
    );
  }
  const children = token.tokens
    ? renderInlineTokens(token.tokens, keyPrefix, onOpenWikiLink)
    : renderWikiText(token.text ?? token.raw ?? "", keyPrefix, onOpenWikiLink);
  return <div>{children}</div>;
}

/**
 * A destination this app will actually open, or null.
 *
 * Deliberately the same filter the main process applies in `shell_open_external` rather than a second
 * policy that could drift from it. This preview is built from `marked` tokens, not from the inline
 * projection, so nothing upstream has vetted the href — documents are untrusted input, and a
 * `javascript:` destination reaching a real `href` is the exact shape that rule exists to prevent.
 */
function externallyOpenableHref(href: string | undefined): string | null {
  const trimmed = href?.trim();
  if (!trimmed) return null;
  return /^(?:https?:|mailto:)/i.test(trimmed) ? trimmed : null;
}

/** Hand a vetted destination to the OS, or to a new tab when running in a browser. */
async function openExternalHref(href: string): Promise<void> {
  if (hasDesktopBridge()) {
    await invokeDesktop("shell_open_external", { url: href });
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
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
      case "inlineHighlight":
        return (
          <mark key={key} className="rounded-[2px] bg-primary/25 text-inherit">
            {children}
          </mark>
        );
      case "inlineComment":
        // Rendered as nothing at all — that is what writing a comment means.
        return <Fragment key={key} />;
      case "codespan":
        return (
          <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
            {token.text ?? ""}
          </code>
        );
      case "link": {
        const href = externallyOpenableHref(token.href);
        // Inert when the destination is not one this app will open. It keeps the label and the
        // styling, because the text is the user's; what it loses is an `href`, which is the point.
        if (!href) {
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
        }
        return (
          <a
            key={key}
            href={href}
            title={href}
            data-markdown-link
            className="text-primary underline decoration-primary/40 underline-offset-2"
            // The unfocused preview is not an editing surface, so a press here has no caret to place
            // and can mean what it looks like it means. A link was painted as a link in both states
            // and openable in neither: this one was a `span` with no destination at all, and the
            // editing surface's anchor cancels its own click so a press can put the caret in the
            // label. Wiki links have always opened from the preview; ordinary links now match.
            //
            // `stopPropagation` keeps the press from also activating the Block, the way the to-do
            // checkbox and the toggle chevron already do.
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void openExternalHref(href);
            }}
          >
            {children}
          </a>
        );
      }
      case "image":
        // The same chip the editing surface draws. These were written separately and drifted: this
        // one was an alt-text pill at `text-sm`, which globals.css pins to 12px inside 16px prose, so
        // clicking the sentence swapped a 59x19 label for a 24x24 icon and slid the rest of the line
        // sideways under the pointer.
        return <InlineImageChip key={key} alt={token.text ?? ""} target={token.href} />;
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
  const parts: ReactNode[] = [];
  text.split(/(\[\[[^\]\r\n]+\]\])/g).forEach((part, index) => {
    const match = part.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
    if (match) {
      parts.push(
        <WikiLink
          key={`${keyPrefix}-wiki-${index}`}
          target={match[1]}
          label={match[2] ?? match[1]}
          onOpen={onOpenWikiLink}
        />
      );
      return;
    }
    if (part) parts.push(part);
  });
  return parts;
}

/**
 * One rendered `[[Wiki Link]]`.
 *
 * A target with no Page behind it used to be indistinguishable from a live one — same colour, same
 * underline, the same "Open Page: X" label promising an action that did not exist — and clicking it
 * did nothing at all: no navigation, no message. It now reads as muted with a dashed underline, says
 * it is unresolved, and reports the missing target when pressed.
 */
function WikiLink({
  target,
  label,
  onOpen,
}: {
  target: string;
  label: string;
  onOpen?: (target: string) => void;
}) {
  const services = useContext(MarkdownWikiLinkContext);
  // Only a link this context owns can be resolved here. Inside an embed the target resolves against
  // the embedded Page's own index, which `onOpen` closes over and this context cannot see.
  const unresolved = !onOpen && services ? !services.resolves(target) : false;
  const open = onOpen ?? services?.open;
  const className = unresolved
    ? "rounded bg-muted px-0.5 text-muted-foreground underline decoration-dashed decoration-muted-foreground/50 underline-offset-2"
    : "rounded bg-primary/10 px-0.5 text-primary underline decoration-primary/30 underline-offset-2";
  if (!open) {
    return (
      <span
        title={target}
        data-wiki-link
        data-wiki-link-unresolved={unresolved ? "true" : undefined}
        className={className}
      >
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={target}
      aria-label={unresolved ? `Unresolved Page link: ${label}` : `Open Page: ${label}`}
      data-wiki-link
      data-wiki-link-unresolved={unresolved ? "true" : undefined}
      className={className}
      onClick={(event) => {
        event.stopPropagation();
        open(target);
      }}
    >
      {label}
    </button>
  );
}
