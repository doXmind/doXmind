"use client";

import { ChevronDown, ClipboardCopy, Copy, Trash2 } from "lucide-react";
import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useId,
} from "react";

import {
  isMarkdownSourceOnlyBlockKind,
  MarkdownBlockDocument,
  type MarkdownBlockApplyResult,
  type MarkdownBlockCommand,
  type MarkdownBlockView,
  type MarkdownSettableBlockKind,
} from "@/editor/markdown-block/markdown-block-document";
import {
  createBlockEditingProjection,
  splitDelimitedBlockSource,
} from "@/editor/markdown-block/block-editing-projection";
import {
  BlockTypeOptionIcon,
  TURN_INTO_OPTIONS,
} from "@/editor/markdown-block/block-gutter-controls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  createMarkdownInlineFormatEdit,
  createMarkdownLinkEdit,
  type MarkdownInlineFormat,
} from "@/editor/markdown-block/markdown-inline-format";
import {
  editableMarkdownBlockSource,
  hiddenMarkdownBlockIds,
  isMarkdownFoldable,
  orderedListDisplayOrdinals,
} from "@/editor/markdown-block/markdown-block-source";
import {
  MarkdownBlockRow,
  MarkdownWikiLinkContext,
  NATIVE_BLOCK_SHORTCUTS_ID,
  blockTypeLabel,
  sourceOffsetAtPoint,
  type MarkdownCollectionContext,
  type MarkdownImageContext,
  type MarkdownSlashRun,
  type MarkdownWikiLinkRun,
  type MarkdownWikiEmbedContext,
  type MarkdownWikiLinkServices,
} from "@/editor/markdown-block/markdown-block-row";
import { projectMarkdownInline } from "@/editor/markdown-block/markdown-inline-projection";
import { parseWikiEmbedBlock, wikiEmbedIdentity } from "@/editor/markdown-block/wiki-embed";
import {
  markdownSlashCommandCaret,
  markdownSlashCommandSource,
  type MarkdownSlashCommandId,
} from "@/editor/markdown-block/slash-commands";
import { wikiLinkPages } from "@/editor/markdown-block/wiki-link-suggestions";
import { resolveWikiLinkTarget } from "@/editor/markdown-block/wiki-link";
import { markdownImageDestinationForPage } from "@/editor/markdown-block/markdown-image";
import { EDITOR_DEBOUNCE_DELAY } from "@/lib/constants";
import { navigateToEditorFile, navigateToWorkspacePage } from "@/lib/editor-navigation";
import { eventBus } from "@/lib/events";
import { buildKnowledgeSourceCatalog, type KnowledgeSourceCatalog } from "@/lib/knowledge-index";
import { pickNativeSaveLocation } from "@/lib/native-dialog";
import {
  createStorageAdapter,
  type WorkspaceAssetImportInput,
  type WorkspaceAssetImportResult,
  type WorkspaceAssetRead,
} from "@/lib/storage";
import { notify } from "@/lib/notifications";
import { storeLogger } from "@/lib/logger";
import { createPageForContext } from "@/lib/new-page";
import { debounce } from "@/lib/utils";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useEditorStore } from "@/stores/editor-store";
import { TRANSIENT_ID_PREFIX, useFileStore, type FileItem } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { usePageSessionStore, type PageOutlineItem } from "@/stores/page-session-store";
import { projectWorkspacePageProperties } from "@/lib/workspace-page-catalog";

interface MarkdownBlockRuntimeProps {
  file: FileItem;
  /**
   * Whether this is the pane the user is working in.
   *
   * Several listeners here sit on `window` or `document`, and the chrome — the find bar, the
   * outline, the caret — describes one Page at a time. With a second pane on screen each of them
   * asks this first.
   */
  isActivePane?: boolean;
  reservedRightInset?: number;
  transclusionServices?: MarkdownTransclusionServices;
  imageServices?: MarkdownImageServices;
}

export interface MarkdownTransclusionServices {
  rebuild: (root: string | null) => Promise<KnowledgeSourceCatalog>;
}

export interface MarkdownImageServices {
  read: (root: string | null, path: string) => Promise<WorkspaceAssetRead>;
  import: (
    root: string | null,
    input: WorkspaceAssetImportInput
  ) => Promise<WorkspaceAssetImportResult>;
}

interface TransclusionIndexState {
  key: string;
  status: MarkdownWikiEmbedContext["status"];
  index: KnowledgeSourceCatalog | null;
}

interface MarkdownBlockSelectionRange {
  blockId: string;
  anchor: number;
  head: number;
  /**
   * Which way a vertical crossing entered the Block, when a crossing is what put the caret here.
   *
   * An offset is not enough for a Block that addresses its caret by cell or by region. `anchor` is
   * an offset into the destination's Markdown source, and a table and a container both draw a box
   * whose glyphs have no linear mapping back to it — `caretOffsetOnBlockEdge` hit-testing a grid
   * returns a number that means nothing in the pipe source. The direction is the one fact the
   * crossing knows that the destination cannot recover, so it travels with the selection
   * `navigateBlock` sets, and every other route that places a caret leaves it undefined.
   */
  entry?: -1 | 1;
}

const defaultTransclusionServices: MarkdownTransclusionServices = {
  rebuild: async (root) => buildKnowledgeSourceCatalog(createStorageAdapter({ disk: { root } })),
};

const defaultImageServices: MarkdownImageServices = {
  read: async (root, path) => createStorageAdapter({ disk: { root } }).readAsset(path),
  import: async (root, input) => createStorageAdapter({ disk: { root } }).importAsset(input),
};

const NATIVE_BLOCK_DRAG_MIME = "application/x-doxmind-markdown-block";

/** How long the workspace catalog trails the caret. Long enough to span a typing run, short enough
 * that a Collection reflects an edit while the user is still looking at it. */
const CATALOG_SETTLE_DELAY = 400;

/**
 * `value`, held at its previous reading until it has stopped changing for `delayMs`.
 *
 * Not a general-purpose debounce: it exists so one expensive derived structure stops being rebuilt
 * per keystroke. The first reading is never delayed, so nothing waits on the first render.
 */
function useSettledValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(settled, value)) return;
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, settled, value]);
  return settled;
}

/**
 * Native source-backed Page editor.
 *
 * The DOM is only an input/view Adapter. Every operation is applied to the
 * canonical Markdown string held by `MarkdownBlockDocument`, and autosave
 * crosses the storage boundary as Markdown only.
 */
export function MarkdownBlockRuntime({
  file,
  isActivePane = true,
  reservedRightInset = 0,
  transclusionServices = defaultTransclusionServices,
  imageServices = defaultImageServices,
}: MarkdownBlockRuntimeProps) {
  const updateFile = useFileStore((state) => state.updateFile);
  const rootPath = useFileStore((state) => state.rootPath);
  const setTransientMarkdown = useFileStore((state) => state.setTransientMarkdown);
  const materializeTransient = useFileStore((state) => state.materializeTransient);
  const lineHeight = useLayoutStore((state) => state.lineHeight);
  const autosaveEnabled = useLayoutStore((state) => state.autosaveEnabled);
  const isSearchBarOpen = useLayoutStore((state) => state.isSearchBarOpen);
  const isReplaceOpen = useLayoutStore((state) => state.isReplaceOpen);
  const setSearchBarOpen = useLayoutStore((state) => state.setSearchBarOpen);
  const setDirty = useEditorStore((state) => state.setDirty);
  const setSaving = useEditorStore((state) => state.setSaving);
  const setLastSavedAt = useEditorStore((state) => state.setLastSavedAt);
  const registerEditor = useEditorRefStore((state) => state.registerEditor);
  const unregisterEditor = useEditorRefStore((state) => state.unregisterEditor);
  // One id per mounted runtime. Block ids restart per document and the file id changes as the
  // user navigates, so neither identifies *this editor* for the life of its mount.
  const editorInstanceId = useId();
  const runtimeRootRef = useRef<HTMLDivElement>(null);
  /**
   * Whether this is the editor the user is working in.
   *
   * Three listeners below sit on `window` or on `document` and were written when only one runtime
   * could be mounted. With a second Page on screen they all fire in both, so each one asks this
   * first. Read from the store at event time rather than subscribed to, because these handlers must
   * not re-register on every focus change.
   */
  const isActivePaneRef = useRef(isActivePane);
  isActivePaneRef.current = isActivePane;
  // Read through a ref, so a focus change never re-registers a window listener.
  const isActiveEditor = useCallback(() => isActivePaneRef.current, []);
  const publishOutline = usePageSessionStore((state) => state.publishOutline);
  const revealRequest = usePageSessionStore((state) => state.revealRequest);
  const clearReveal = usePageSessionStore((state) => state.clearReveal);
  const clearOutline = usePageSessionStore((state) => state.clearOutline);

  const initialMarkdown = file.content;
  /**
   * The canonical document, built once.
   *
   * `useRef(expr)` and `useState(expr)` both evaluate `expr` on every render and throw the result
   * away after the first, so writing the construction inline re-lexed the whole Markdown source and
   * rebuilt every Block view on every keystroke. That was the largest per-keystroke cost that scaled
   * with Page length. Both are now built lazily; the ref is reassigned on a Page switch as before.
   */
  const documentRef = useRef<MarkdownBlockDocument>(null as unknown as MarkdownBlockDocument);
  if (!documentRef.current) {
    documentRef.current = MarkdownBlockDocument.fromMarkdown(initialMarkdown);
  }
  const [snapshot, setSnapshot] = useState(() => documentRef.current.getSnapshot());
  // Markdown does not renumber, so the ordinal on disk is not the one to draw. Counted here because
  // this is the only place that can see an item's siblings.
  const listOrdinals = useMemo(
    () => orderedListDisplayOrdinals(snapshot.blocks),
    [snapshot.blocks]
  );
  /**
   * Which Blocks are folded shut.
   *
   * View state, never Markdown. A save applies Block commands to canonical source and writes only
   * the `.md`, so a fold has nowhere in the file to live that would not be an edit the user did
   * not make — and a Page folded here would arrive folded in every other editor. It is also not
   * persisted: a fold is about reading this Page right now.
   */
  const [foldedBlockIds, setFoldedBlockIds] = useState<ReadonlySet<string>>(() => new Set());
  const hiddenBlocks = useMemo(
    () => hiddenMarkdownBlockIds(snapshot.blocks, foldedBlockIds),
    [snapshot.blocks, foldedBlockIds]
  );
  const [activeBlockId, setActiveBlockId] = useState<string | null>(
    file.id.startsWith(TRANSIENT_ID_PREFIX) ? (snapshot.blocks[0]?.id ?? null) : null
  );
  const [blockSelection, setBlockSelection] = useState<{
    anchorId: string;
    focusId: string;
  } | null>(null);
  /**
   * Latest committed caret Block and Block selection, for handlers that must not change identity.
   *
   * Every row is memoised, so a handler that closed over these would hand all N rows a fresh
   * callback on each keystroke and skip nothing. They are read after commit, from event handlers, so
   * a ref carries exactly the value the closure used to.
   */
  const activeBlockIdRef = useRef(activeBlockId);
  activeBlockIdRef.current = activeBlockId;
  const blockSelectionRef = useRef(blockSelection);
  blockSelectionRef.current = blockSelection;
  const [blockDropBeforeId, setBlockDropBeforeId] = useState<string | null | undefined>(undefined);
  const [pendingSelection, setPendingSelection] = useState<MarkdownBlockSelectionRange | null>(
    null
  );
  const [hasExternalConflict, setHasExternalConflict] = useState(false);
  // Whether a save the user actually asked for has been refused by that conflict. Cmd+S and the
  // shell's flush-before-close both go through `saveCurrentNow`, and while a conflict is pending it
  // returns false — correctly, since writing would clobber one of the two versions. Returning it
  // silently was the bug: the keystroke did nothing and the close button no-opped, with the banner
  // still only offering to throw the local edits away.
  const [saveBlockedByConflict, setSaveBlockedByConflict] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const [findOptions, setFindOptions] = useState<MarkdownFindOptions>({
    caseSensitive: false,
    regex: false,
  });
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchSelectionRef = useRef<MarkdownBlockSelectionRange | null>(null);
  const documentElementRef = useRef<HTMLDivElement>(null);
  const dragSessionRef = useRef<{
    pageId: string;
    blockIds: string[];
    token: string;
  } | null>(null);
  const dragSessionCounterRef = useRef(0);
  const scrollElementRef = useRef<HTMLDivElement>(null);
  /**
   * Drop boundaries for the current drag, in document order, measured once at dragstart.
   *
   * Computing the target from `dragover` on each row made the insertion line jump: a row only sees
   * pointer events inside its own box, so the boundary flipped on whichever row happened to receive
   * the event rather than on which edge the pointer is actually nearest. One table, and the target is
   * the nearest boundary — the same answer wherever the pointer is, including over the page margins.
   * Boundaries that would not move anything are filtered out at dragstart, so a no-op drop can never
   * paint a line.
   *
   * `y` is a *scroller content* coordinate — the row's viewport top plus the scroll offset it was
   * read at — so autoscroll cannot invalidate the table. Held in viewport coordinates it had to be
   * remeasured on every frame the Page scrolled, one `getBoundingClientRect` per row: 102 rects a
   * frame on a 100-Block Page and 602 on a 600-Block one, against 1 now. That is layout work the
   * drag never needed rather than the reason it stutters — the frame rate over an autoscrolling
   * column measured 45.1fps before and 44.1fps after, against 119.3fps with the pointer held
   * mid-column, and what costs those frames is repainting a scrolling Page. Content coordinates
   * never move, so the table is built once and `nearestDropBoundary` shifts the pointer into its
   * space instead — O(1) a frame, and exact at any scroll position.
   */
  const dragBoundariesRef = useRef<{ beforeId: string | null; y: number; depth: number }[]>([]);
  const dropTargetRef = useRef<{ beforeId: string | null } | null>(null);
  const dragAutoScrollRef = useRef<{ frame: number | null; time: number; clientY: number }>({
    frame: null,
    time: 0,
    clientY: 0,
  });
  const dragGhostRef = useRef<HTMLElement | null>(null);
  /**
   * One pointer gesture, from press to release, that may become a Block selection.
   *
   * The browser's own text selection cannot span two Blocks here: each Block is its own editing
   * surface, so dragging from the middle of one into another produced a range the editor could not
   * represent and selected nothing at all. Past a 4px threshold this takes over and turns the gesture
   * into a Block selection — starting from a Block if the press landed on one, or as a marquee if it
   * landed in the margin.
   */
  const pointerSelectRef = useRef<{
    originBlockId: string | null;
    x: number;
    y: number;
    engaged: boolean;
  } | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const [blockSelectionAnnouncement, setBlockSelectionAnnouncement] = useState("");
  // The drag image lives in `document.body` because Chromium will not snapshot a detached node, so
  // it has to be torn down explicitly — including when the editor unmounts mid-drag.
  useEffect(
    () => () => {
      dragGhostRef.current?.remove();
      dragGhostRef.current = null;
    },
    []
  );
  const composingBlockIdRef = useRef<string | null>(null);
  const compositionHasHistoryRef = useRef(false);
  /** The column a run of vertical Block crossings is aiming at. See `navigateBlock`. */
  const verticalGoalRef = useRef<{ blockId: string; offset: number; x: number } | null>(null);
  const typingIdleTimerRef = useRef<number | null>(null);
  const fileIdRef = useRef(file.id);
  const lastSavedMarkdownRef = useRef(initialMarkdown);
  const externalMarkdownRef = useRef<string | null>(null);
  const conflictGenerationRef = useRef(0);
  const pendingMarkdownRef = useRef(new Set<string>());
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sessionGenerationRef = useRef(0);
  const discardRequestedRef = useRef(false);
  const renderedFileIdRef = useRef(file.id);
  if (renderedFileIdRef.current !== file.id) {
    renderedFileIdRef.current = file.id;
    sessionGenerationRef.current += 1;
  }
  const sessionGeneration = sessionGenerationRef.current;
  const isTransient = file.id.startsWith(TRANSIENT_ID_PREFIX);
  const pagePath = file.storageHandle?.relPath ?? file.storageHandle?.path ?? file.name;
  const [storageGeneration, setStorageGeneration] = useState(0);
  const hasWikiEmbeds = useMemo(
    () =>
      snapshot.blocks.some(
        (block) => block.kind === "paragraph" && parseWikiEmbedBlock(block.raw) !== null
      ),
    [snapshot.blocks]
  );
  const hasCollections = useMemo(
    () => snapshot.blocks.some((block) => block.kind === "collection"),
    [snapshot.blocks]
  );
  const hasLocalImages = useMemo(
    () => snapshot.blocks.some((block) => block.kind === "image"),
    [snapshot.blocks]
  );
  const needsWorkspaceCatalog = hasWikiEmbeds || hasCollections;
  const transclusionRequestKey = `${rootPath ?? ""}\u0000${file.id}\u0000${storageGeneration}`;
  const [transclusionState, setTransclusionState] = useState<TransclusionIndexState>({
    key: "",
    status: "loading",
    index: null,
  });

  useEffect(
    () => eventBus.on("storage:changed", () => setStorageGeneration((value) => value + 1)),
    []
  );

  useEffect(() => {
    if (!needsWorkspaceCatalog) return;
    let cancelled = false;
    setTransclusionState({ key: transclusionRequestKey, status: "loading", index: null });
    void transclusionServices
      .rebuild(rootPath)
      .then((index) => {
        if (!cancelled) {
          setTransclusionState({ key: transclusionRequestKey, status: "ready", index });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTransclusionState({ key: transclusionRequestKey, status: "error", index: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [needsWorkspaceCatalog, rootPath, transclusionRequestKey, transclusionServices]);

  const effectiveTransclusionState: TransclusionIndexState =
    transclusionState.key === transclusionRequestKey
      ? transclusionState
      : { key: transclusionRequestKey, status: "loading", index: null };
  // Live, deliberately: a Page that embeds itself has to follow the caret, so the embed half of the
  // index carries the snapshot as it is typed.
  const transclusionSourcePages = useMemo(
    () =>
      effectiveTransclusionState.index?.sourcePages.map((page) =>
        page.id === file.id || sameWorkspacePath(page.path, pagePath)
          ? { ...page, markdown: snapshot.markdown }
          : page
      ),
    [effectiveTransclusionState.index?.sourcePages, file.id, pagePath, snapshot.markdown]
  );
  // Settled, deliberately: the catalog half used to be rebuilt from the same live snapshot, which
  // handed every Collection Block a brand-new `catalogPages` array on every keystroke and made it
  // re-filter and re-sort the whole workspace once per character. A Collection row reads titles and
  // properties, and neither of those can differ between two keystrokes.
  const catalogMarkdown = useSettledValue(snapshot.markdown, CATALOG_SETTLE_DELAY);
  const transclusionCatalogPages = useMemo(
    () =>
      effectiveTransclusionState.index?.catalogPages?.map((page) =>
        page.id === file.id || sameWorkspacePath(page.path, pagePath)
          ? {
              ...page,
              markdown: catalogMarkdown,
              properties: projectWorkspacePageProperties(file.meta),
            }
          : page
      ),
    [catalogMarkdown, effectiveTransclusionState.index?.catalogPages, file.id, file.meta, pagePath]
  );
  const effectiveTransclusionIndex = useMemo(() => {
    const index = effectiveTransclusionState.index;
    if (!index || !transclusionSourcePages) return null;
    return {
      ...index,
      sourcePages: transclusionSourcePages,
      catalogPages: transclusionCatalogPages,
    };
  }, [effectiveTransclusionState.index, transclusionCatalogPages, transclusionSourcePages]);
  // Read through a ref rather than closed over, so the handler's identity never changes. It is a
  // prop on every row, and one rebuilt each time the live embed half is patched would put the
  // Collection rows back to re-rendering on every keystroke through the back door.
  const transclusionSourcePagesRef = useRef(transclusionSourcePages);
  transclusionSourcePagesRef.current = transclusionSourcePages;
  const openIndexedPage = useCallback((pageId: string) => {
    const target = transclusionSourcePagesRef.current?.find((page) => page.id === pageId);
    if (target) {
      void navigateToWorkspacePage(pageId, target.path);
    } else {
      void navigateToEditorFile(pageId);
    }
  }, []);
  const wikiEmbedContext = useMemo<MarkdownWikiEmbedContext | undefined>(() => {
    if (!hasWikiEmbeds) return undefined;
    return {
      status: effectiveTransclusionState.status,
      index: effectiveTransclusionIndex,
      sourcePageId: file.id,
      sourcePath: pagePath,
      ancestry: [wikiEmbedIdentity(file.id, null)],
      depth: 1,
      onOpenPage: openIndexedPage,
    };
  }, [
    effectiveTransclusionIndex,
    effectiveTransclusionState.status,
    hasWikiEmbeds,
    openIndexedPage,
    file.id,
    pagePath,
  ]);
  const collectionContext = useMemo<MarkdownCollectionContext | undefined>(() => {
    if (!hasCollections) return undefined;
    return {
      status: effectiveTransclusionState.status,
      pages: transclusionCatalogPages ?? null,
      onOpenPage: openIndexedPage,
    };
  }, [
    effectiveTransclusionState.status,
    hasCollections,
    openIndexedPage,
    transclusionCatalogPages,
  ]);
  const imageContext = useMemo<MarkdownImageContext | undefined>(() => {
    if (!hasLocalImages && !hasWikiEmbeds) return undefined;
    return {
      pagePath,
      readAsset: (path) => imageServices.read(rootPath, path),
    };
  }, [hasLocalImages, hasWikiEmbeds, imageServices, pagePath, rootPath]);

  const wikiLinkServices = useMemo<MarkdownWikiLinkServices>(() => {
    // One resolution per distinct target while the workspace is unchanged. `resolves` runs for every
    // rendered link and each call walks the whole file list, so a Page with many links to the same
    // few targets would otherwise pay for it repeatedly.
    const resolved = new Map<string, boolean>();
    return {
      resolves: (target) => {
        let hit = resolved.get(target);
        if (hit === undefined) {
          hit = resolveWikiLinkTarget(useFileStore.getState().files, file.id, target) !== null;
          resolved.set(target, hit);
        }
        return hit;
      },
      open: (target) => {
        const destination = resolveWikiLinkTarget(useFileStore.getState().files, file.id, target);
        if (destination) {
          void navigateToEditorFile(destination.id);
          return;
        }
        // An unresolved link is a Page the author intends to write, so clicking it writes one.
        // The heading and block fragments are addresses inside a Page, not part of its name.
        const name = target.split("#")[0].split("|")[0].trim();
        if (!name) {
          // Deliberately says only what is certain. A single Page opened outside a workspace
          // folder resolves nothing at all, so naming a workspace here would be wrong half the time.
          notify.error(`No Page named "${target}"`);
          return;
        }
        void createPageForContext(useFileStore.getState(), name)
          .then((newId) => navigateToEditorFile(newId))
          .catch((error) => {
            storeLogger.error("Failed to create a Page from an unresolved Wiki Link", error);
            notify.error(`Could not create "${name}"`);
          });
      },
    };
    // A Page created, renamed or deleted since this Page opened changes what resolves. Consumers
    // re-render on the new context value, so a link stops reading as unresolved once its Page exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- storageGeneration invalidates the cache
  }, [file.id, storageGeneration]);

  const outlineHeadings = useMemo<PageOutlineItem[]>(() => {
    const headings = snapshot.blocks.flatMap((block) => {
      if (block.kind !== "heading" || !block.level || block.level > 3) return [];
      const text = editableMarkdownBlockSource(block.raw)
        .replace(/^#{1,6}[ \t]+/, "")
        .trim();
      return [
        {
          id: block.id,
          level: block.level,
          text: text || "Untitled",
          pos: block.from,
        },
      ];
    });
    return headings.length >= 2 ? headings : [];
  }, [snapshot.blocks]);

  const findResult = useMemo(
    () => findMarkdownSearchMatches(snapshot.blocks, searchTerm, findOptions),
    [searchTerm, snapshot.blocks, findOptions]
  );
  const searchMatches = findResult.matches;
  const selectedBlockIdSet = useMemo(
    () =>
      new Set(
        blockSelection
          ? expandSelectedListSubtrees(
              snapshot.blocks,
              selectedBlockIds(snapshot.blocks, blockSelection)
            )
          : []
      ),
    [blockSelection, snapshot.blocks]
  );

  useEffect(() => {
    if (!isSearchBarOpen) {
      setSearchTerm("");
      setCurrentSearchIndex(0);
      return;
    }
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isSearchBarOpen]);

  useEffect(() => {
    if (!isSearchBarOpen) {
      searchSelectionRef.current = null;
      if (currentSearchIndex !== 0) setCurrentSearchIndex(0);
      return;
    }
    if (searchMatches.length === 0) {
      if (currentSearchIndex !== 0) setCurrentSearchIndex(0);
      const searchSelection = searchSelectionRef.current;
      searchSelectionRef.current = null;
      if (searchSelection) {
        setPendingSelection((current) =>
          sameBlockSelectionRange(current, searchSelection) ? null : current
        );
      }
      return;
    }
    if (currentSearchIndex >= searchMatches.length) {
      setCurrentSearchIndex(0);
      return;
    }

    const match = searchMatches[currentSearchIndex];
    setActiveBlockId(match.blockId);
    setBlockSelection(null);
    const nextSelection = {
      blockId: match.blockId,
      anchor: match.anchor,
      head: match.head,
    };
    searchSelectionRef.current = nextSelection;
    setPendingSelection(nextSelection);
    const frame = requestAnimationFrame(() => {
      const element = Array.from(
        documentElementRef.current?.querySelectorAll<HTMLElement>("[data-block-id]") ?? []
      ).find((candidate) => candidate.dataset.blockId === match.blockId);
      element?.scrollIntoView?.({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [currentSearchIndex, isSearchBarOpen, searchMatches]);

  useEffect(() => {
    if (isSearchBarOpen && pendingSelection) searchInputRef.current?.focus();
  }, [isSearchBarOpen, pendingSelection]);

  const navigateToOutline = useCallback(
    (heading: PageOutlineItem) => {
      if (fileIdRef.current !== file.id) return;
      const blockExists = documentRef.current
        .getSnapshot()
        .blocks.some((block) => block.id === heading.id && block.kind === "heading");
      if (!blockExists) return;

      setActiveBlockId(heading.id);
      setBlockSelection(null);
      setPendingSelection(null);
      const element = Array.from(
        documentElementRef.current?.querySelectorAll<HTMLElement>("[data-block-id]") ?? []
      ).find((candidate) => candidate.dataset.blockId === heading.id);
      // Stand the row's own activation scroll down for this one activation.
      //
      // A row that activates brings itself into view with `block: "nearest"`, because its focus()
      // deliberately no longer does. That instant scroll reaches the container after this smooth one
      // has been issued and before it has run a frame, and an instant scroll cancels a smooth one:
      // measured on a 100-Block Page, clicking an outline entry 2458px down moved the Page in a
      // single frame — no animation at all — and left the heading 810.3px below the top of the port
      // instead of the 84px `block: "start"` plus the container's scroll padding asks for. Set only
      // when the Block is not already active, so there is always exactly one activation to consume
      // it and the marker can never outlive this navigation.
      if (element && element.dataset.active !== "true") {
        element.setAttribute("data-outline-scroll", "true");
      }
      element?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    },
    [file.id]
  );

  useEffect(() => {
    // The document projection is reset in a later effect on Page switches.
    // Do not relabel the previous Page's headings with the new Page id during
    // that intervening commit.
    if (fileIdRef.current !== file.id) return;
    // One outline rail, one Page: the inactive pane would otherwise relabel it with its headings.
    if (!isActivePane) return;
    publishOutline({
      pageId: file.id,
      headings: outlineHeadings,
      activeId: outlineHeadings.some((heading) => heading.id === activeBlockId)
        ? activeBlockId
        : null,
      navigateTo: navigateToOutline,
    });
  }, [activeBlockId, file.id, isActivePane, navigateToOutline, outlineHeadings, publishOutline]);

  useEffect(
    () => () => {
      clearOutline(file.id);
    },
    [clearOutline, file.id]
  );

  const performMarkdownWrite = useCallback(
    async (
      markdown: string,
      options: { explicit?: boolean } | undefined,
      generation: number,
      pageId: string,
      transient: boolean
    ): Promise<boolean> => {
      const isCurrentSession = () => sessionGenerationRef.current === generation;
      if (!transient && markdown === lastSavedMarkdownRef.current) {
        if (isCurrentSession() && documentRef.current.getSnapshot().markdown === markdown) {
          setDirty(false);
        }
        return true;
      }

      if (transient && !options?.explicit) {
        if (isCurrentSession()) setTransientMarkdown(markdown);
        return true;
      }

      if (isCurrentSession()) setSaving(true);
      try {
        if (transient) {
          if (!isCurrentSession()) return false;
          setTransientMarkdown(markdown);
          const transient = useFileStore.getState().transientFile;
          if (!transient) return true;
          const path = await pickNativeSaveLocation("Save as", transient.name, [
            { name: "Markdown", extensions: ["md"] },
          ]);
          if (!path) return false;
          const newId = await materializeTransient(path);
          if (isCurrentSession()) {
            lastSavedMarkdownRef.current = markdown;
            setLastSavedAt(new Date().toISOString());
            setDirty(false);
            if (newId) navigateToEditorFile(newId);
          }
          return true;
        }

        const pendingKey = markdownPendingKey(pageId, markdown);
        pendingMarkdownRef.current.add(pendingKey);
        try {
          await updateFile(pageId, { content: markdown });
          if (isCurrentSession()) {
            lastSavedMarkdownRef.current = markdown;
            setLastSavedAt(new Date().toISOString());
            if (documentRef.current.getSnapshot().markdown === markdown) setDirty(false);
          }
          return true;
        } finally {
          pendingMarkdownRef.current.delete(pendingKey);
        }
      } catch (error) {
        if (!transient && isPageRevisionConflict(error)) {
          await useFileStore.getState().loadFileContent(pageId, { force: true });
          if (isCurrentSession()) {
            const state = useFileStore.getState();
            const refreshed =
              state.files.find((candidate) => candidate.id === pageId) ??
              (state.currentFileId
                ? state.files.find((candidate) => candidate.id === state.currentFileId)
                : undefined);
            externalMarkdownRef.current = refreshed?.content ?? "";
            conflictGenerationRef.current += 1;
            setHasExternalConflict(true);
          }
        }
        if (isCurrentSession()) setDirty(true);
        throw error;
      } finally {
        if (isCurrentSession()) setSaving(false);
      }
    },
    [materializeTransient, setDirty, setLastSavedAt, setSaving, setTransientMarkdown, updateFile]
  );

  const persistMarkdown = useCallback(
    (markdown: string, options?: { explicit?: boolean }): Promise<boolean> => {
      if (!isTransient && externalMarkdownRef.current !== null) {
        setDirty(true);
        return Promise.resolve(false);
      }

      const conflictGeneration = conflictGenerationRef.current;
      const result = saveQueueRef.current.then(() => {
        if (
          conflictGeneration !== conflictGenerationRef.current ||
          (!isTransient && externalMarkdownRef.current !== null)
        ) {
          setDirty(true);
          return false;
        }
        return performMarkdownWrite(markdown, options, sessionGeneration, file.id, isTransient);
      });
      saveQueueRef.current = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
    [file.id, isTransient, performMarkdownWrite, sessionGeneration, setDirty]
  );

  const debouncedSave = useMemo(
    () =>
      debounce((markdown: string) => {
        // Autosave failures keep the Page dirty inside `persistMarkdown`.
        // Consume the rejection here so a background debounce cannot become
        // an unhandled promise; explicit Cmd/Ctrl+S still returns the failure.
        void persistMarkdown(markdown).catch(() => undefined);
      }, EDITOR_DEBOUNCE_DELAY),
    [persistMarkdown]
  );

  const scheduleAutosave = useCallback(
    (markdown: string) => {
      if (isTransient || autosaveEnabled) debouncedSave(markdown);
    },
    [autosaveEnabled, debouncedSave, isTransient]
  );

  useEffect(() => {
    if (!autosaveEnabled && !isTransient) debouncedSave.cancel();
  }, [autosaveEnabled, debouncedSave, isTransient]);

  // Leaving a Block ends its typing run: undo should never merge words typed in two Blocks.
  useEffect(() => {
    documentRef.current.flushHistory();
  }, [activeBlockId]);

  const publish = useCallback(
    (result: MarkdownBlockApplyResult, applySelection = true) => {
      setSnapshot(result.snapshot);
      if (applySelection && result.selection) {
        const selectedBlock = result.snapshot.blocks.find(
          (block) => block.id === result.selection?.blockId
        );
        setActiveBlockId(result.selection.blockId);
        setBlockSelection(null);
        setPendingSelection({
          blockId: result.selection.blockId,
          anchor: selectedBlock
            ? editorOffsetForBlockSourceOffset(selectedBlock, result.selection.anchor)
            : 0,
          head: selectedBlock
            ? editorOffsetForBlockSourceOffset(selectedBlock, result.selection.head)
            : 0,
        });
      }
      setDirty(result.snapshot.markdown !== lastSavedMarkdownRef.current);
      if (composingBlockIdRef.current === null) {
        scheduleAutosave(result.snapshot.markdown);
      }
    },
    [scheduleAutosave, setDirty]
  );

  const apply = useCallback(
    (command: MarkdownBlockCommand, applySelection = true) =>
      publish(documentRef.current.apply(command), applySelection),
    [publish]
  );

  /**
   * Close the current typing run after a pause.
   *
   * The document folds a run by position, which cannot see the user stopping to think. 600ms is the
   * familiar checkpoint interval from desktop editors: long enough that ordinary typing stays one
   * step, short enough that a pause reliably starts a new one.
   */
  const scheduleTypingCheckpoint = useCallback(() => {
    if (typingIdleTimerRef.current !== null) window.clearTimeout(typingIdleTimerRef.current);
    typingIdleTimerRef.current = window.setTimeout(() => {
      typingIdleTimerRef.current = null;
      documentRef.current.flushHistory();
    }, 600);
  }, []);

  useEffect(
    () => () => {
      if (typingIdleTimerRef.current !== null) window.clearTimeout(typingIdleTimerRef.current);
    },
    []
  );

  const importImages = useCallback(
    (blockId: string, from: number, to: number, files: readonly File[]) => {
      void (async () => {
        if (!rootPath) {
          notify.error("Save the Page in a workspace before importing images");
          return;
        }
        const initialBlock = documentRef.current
          .getSnapshot()
          .blocks.find((candidate) => candidate.id === blockId);
        if (!initialBlock) return;
        const initialSource = editableMarkdownBlockSource(initialBlock.raw);
        const initialFrom = blockSourceOffsetForEditorOffset(initialBlock, from);
        const initialTo = blockSourceOffsetForEditorOffset(initialBlock, to);
        const imported: string[] = [];
        let failure: unknown = null;

        for (const file of files) {
          try {
            if (file.size <= 0 || file.size > 20 * 1024 * 1024) {
              throw new Error("Local images must be between 1 byte and 20 MiB");
            }
            const bytes = new Uint8Array(await file.arrayBuffer());
            const result = await imageServices.import(rootPath, { name: file.name, bytes });
            const destination = markdownImageDestinationForPage(pagePath, result.path);
            imported.push(`![${markdownImageAlt(file.name)}](${destination})`);
          } catch (error) {
            failure = error;
            break;
          }
        }

        if (imported.length) {
          const currentBlock = documentRef.current
            .getSnapshot()
            .blocks.find((candidate) => candidate.id === blockId);
          if (currentBlock) {
            const currentSource = editableMarkdownBlockSource(currentBlock.raw);
            const unchanged = currentSource === initialSource;
            const range = unchanged
              ? { from: initialFrom, to: initialTo }
              : { from: currentSource.length, to: currentSource.length };
            const lineEnding = preferredSourceLineEnding(
              currentBlock.raw,
              documentRef.current.getSnapshot().markdown
            );
            apply({
              type: "replaceText",
              blockId,
              range,
              text: markdownImageInsertion(
                currentSource,
                range.from,
                range.to,
                imported,
                lineEnding
              ),
            });
          }
        }
        if (failure) {
          notify.error(failure instanceof Error ? failure.message : "Could not import local image");
        }
      })();
    },
    [apply, imageServices, pagePath, rootPath]
  );

  useEffect(() => {
    if (activeBlockId !== null || blockSelection !== null || isSearchBarOpen) return;

    const handleEditIntent = (event: KeyboardEvent) => {
      // Without this, a keypress with no active Block in either pane — the state immediately after
      // a split — is applied to both Pages at once.
      if (!isActiveEditor()) return;
      if (isEventFromEditableElement(event.target)) return;
      if (isEventFromFocusedControl(event.target)) return;
      const key = keyboardEditIntentKey(event);
      if (key === null) return;

      const current = documentRef.current.getSnapshot();
      const block = visibleEditableBlock(current.blocks, documentElementRef.current);
      if (!block) return;

      event.preventDefault();
      const editorSource = normalizeEditorLineEndings(
        createBlockEditingProjection(block).editorText
      );
      if (key.length === 1) {
        // At the end of what the Block *edits*, not at the end of its source. A delimited kind's
        // source ends with its closing delimiter, so appending there wrote the character past the
        // closing fence — "```x" is no longer a close, and re-reading the file swallowed every
        // following Block into the code Block.
        const at = blockSourceOffsetForEditorOffset(block, editorSource.length);
        apply({
          type: "replaceText",
          blockId: block.id,
          range: { from: at, to: at },
          text: key,
        });
        return;
      }

      setActiveBlockId(block.id);
      setPendingSelection({
        blockId: block.id,
        anchor: editorSource.length,
        head: editorSource.length,
      });
    };

    window.addEventListener("keydown", handleEditIntent);
    return () => window.removeEventListener("keydown", handleEditIntent);
  }, [activeBlockId, apply, blockSelection, isSearchBarOpen, isActiveEditor]);

  const undo = useCallback(() => {
    const before = documentRef.current.getSnapshot().blocks;
    const next = documentRef.current.undo();
    setSnapshot(next);
    setBlockSelection(null);
    setBlockDropBeforeId(undefined);
    setActiveBlockId((current) => activeBlockIdAfterHistory(current, before, next.blocks));
    setPendingSelection(null);
    setDirty(next.markdown !== lastSavedMarkdownRef.current);
    scheduleAutosave(next.markdown);
  }, [scheduleAutosave, setDirty]);

  const redo = useCallback(() => {
    const before = documentRef.current.getSnapshot().blocks;
    const next = documentRef.current.redo();
    setSnapshot(next);
    setBlockSelection(null);
    setBlockDropBeforeId(undefined);
    setActiveBlockId((current) => activeBlockIdAfterHistory(current, before, next.blocks));
    setPendingSelection(null);
    setDirty(next.markdown !== lastSavedMarkdownRef.current);
    scheduleAutosave(next.markdown);
  }, [scheduleAutosave, setDirty]);

  const saveCurrentNow = useCallback(async () => {
    debouncedSave.cancel();
    if (!isTransient && externalMarkdownRef.current !== null) {
      // Still refused — writing here would silently pick a winner. What changes is that the refusal
      // is now on screen, next to the two buttons that end it.
      setSaveBlockedByConflict(true);
      return false;
    }
    return persistMarkdown(documentRef.current.getSnapshot().markdown, { explicit: true });
  }, [debouncedSave, isTransient, persistMarkdown]);

  // One place to forget the escalation, rather than a reset beside each of the sites that clear the
  // conflict.
  useEffect(() => {
    if (!hasExternalConflict) setSaveBlockedByConflict(false);
  }, [hasExternalConflict]);

  const discardPendingChanges = useCallback(() => {
    discardRequestedRef.current = true;
    debouncedSave.cancel();
    conflictGenerationRef.current += 1;
    sessionGenerationRef.current += 1;
    setDirty(false);
  }, [debouncedSave, setDirty]);

  useEffect(() => {
    if (isActivePane) useEditorRefStore.getState().setActiveEditor(editorInstanceId);
  }, [isActivePane, editorInstanceId]);

  const toggleFold = useCallback((blockId: string) => {
    setFoldedBlockIds((current) => {
      const next = new Set(current);
      if (!next.delete(blockId)) next.add(blockId);
      return next;
    });
  }, []);

  const foldAll = useCallback((folded: boolean) => {
    if (!folded) {
      setFoldedBlockIds(new Set());
      return;
    }
    const blocks = documentRef.current.getSnapshot().blocks;
    setFoldedBlockIds(
      new Set(blocks.filter((_, index) => isMarkdownFoldable(blocks, index)).map((b) => b.id))
    );
  }, []);

  useEffect(() => {
    registerEditor(editorInstanceId, {
      fileId: file.id,
      requestSave: saveCurrentNow,
      requestUndo: undo,
      requestRedo: redo,
      requestFoldAll: foldAll,
      discardPendingChanges,
    });
    return () => unregisterEditor(editorInstanceId);
  }, [
    file.id,
    editorInstanceId,
    registerEditor,
    unregisterEditor,
    foldAll,
    discardPendingChanges,
    redo,
    saveCurrentNow,
    undo,
  ]);

  useEffect(() => {
    const handleSave = (event: KeyboardEvent) => {
      if (!isActiveEditor()) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveCurrentNow().catch(() => undefined);
      }
    };
    window.addEventListener("keydown", handleSave);
    return () => window.removeEventListener("keydown", handleSave);
  }, [saveCurrentNow, isActiveEditor]);

  useEffect(() => {
    const markdown = file.content;
    if (fileIdRef.current === file.id) {
      if (
        markdown === lastSavedMarkdownRef.current ||
        pendingMarkdownRef.current.has(markdownPendingKey(file.id, markdown))
      ) {
        return;
      }

      const localMarkdown = documentRef.current.getSnapshot().markdown;
      if (markdown === localMarkdown) {
        lastSavedMarkdownRef.current = markdown;
        externalMarkdownRef.current = null;
        setHasExternalConflict(false);
        setDirty(false);
        return;
      }

      if (localMarkdown !== lastSavedMarkdownRef.current) {
        externalMarkdownRef.current = markdown;
        conflictGenerationRef.current += 1;
        setHasExternalConflict(true);
        setDirty(true);
        return;
      }

      conflictGenerationRef.current += 1;
      documentRef.current = MarkdownBlockDocument.fromMarkdown(markdown);
      const next = documentRef.current.getSnapshot();
      lastSavedMarkdownRef.current = markdown;
      externalMarkdownRef.current = null;
      setSnapshot(next);
      setActiveBlockId(null);
      setBlockSelection(null);
      setPendingSelection(null);
      setHasExternalConflict(false);
      setDirty(false);
      return;
    }

    debouncedSave.flush();
    discardRequestedRef.current = false;
    conflictGenerationRef.current += 1;
    documentRef.current = MarkdownBlockDocument.fromMarkdown(markdown);
    const next = documentRef.current.getSnapshot();
    fileIdRef.current = file.id;
    lastSavedMarkdownRef.current = markdown;
    externalMarkdownRef.current = null;
    setSnapshot(next);
    setActiveBlockId(file.id.startsWith(TRANSIENT_ID_PREFIX) ? (next.blocks[0]?.id ?? null) : null);
    setBlockSelection(null);
    setPendingSelection(null);
    setHasExternalConflict(false);
    setDirty(false);
    setSaving(false);
  }, [debouncedSave, file.content, file.id, setDirty, setSaving]);

  useEffect(
    () => () => {
      if (discardRequestedRef.current) debouncedSave.cancel();
      else debouncedSave.flush();
    },
    [debouncedSave]
  );

  // A search result asks for a body line; the caret has to land in whichever Block spans it.
  useEffect(() => {
    if (!revealRequest || revealRequest.pageId !== file.id) return;
    // The same Page can be open in both panes. Only the one the user is navigating consumes the
    // request; the other would swallow it and clear it before the active pane ever saw it.
    if (!isActiveEditor()) return;
    // `documentRef`, not `snapshot`: opening a different Page from a search result runs this on the
    // commit where the store's file has changed but the snapshot state has not caught up yet.
    const blocks = documentRef.current.getSnapshot().blocks;
    const target = markdownBlockIdAtLine(blocks, revealRequest.line);
    clearReveal();
    if (!target) return;
    setActiveBlockId(target);
    setBlockSelection(null);
    setPendingSelection({ blockId: target, anchor: 0, head: 0 });
    // `revealRequest.token` is in the deps so two clicks on the same line both land.
  }, [revealRequest, file.id, clearReveal, isActiveEditor]);

  const moveBlock = useCallback(
    (blockId: string, direction: -1 | 1): boolean => {
      const blocks = documentRef.current.getSnapshot().blocks;
      const move = hierarchySafeBlockMove(blocks, [blockId], direction);
      if (!move) return false;
      apply({ type: "moveBlocks", ...move });
      return true;
    },
    [apply]
  );

  const navigateBlock = useCallback(
    (blockId: string, direction: -1 | 1, caret?: { x: number; offset: number }): boolean => {
      const blocks = documentRef.current.getSnapshot().blocks;
      const index = blocks.findIndex((block) => block.id === blockId);
      if (index < 0) return false;
      let targetIndex = index + direction;
      while (targetIndex >= 0 && targetIndex < blocks.length && !blocks[targetIndex].editable) {
        targetIndex += direction;
      }
      const target = blocks[targetIndex];
      if (!target?.editable) return false;
      const source = normalizeEditorLineEndings(createBlockEditingProjection(target).editorText);
      // A vertical crossing keeps the caret's column. The destination Block is still rendered as a
      // preview at this point, so its glyph geometry can be hit-tested directly to find the offset
      // nearest the column the caret left from — which is how a crossing feels in one long field.
      // Horizontal crossings pass no caret and land on the Block's source edge.
      //
      // The column is the one the *walk* started from, not the one the caret happens to sit at now.
      // Re-reading the caret's x at every crossing meant one short Block in the way shortened the
      // rest of the walk permanently: measured on `long / Hi / long`, a caret at offset 42 arrived
      // at offset 2 two presses later — 40 characters of drift that no further ArrowUp could undo.
      // Native fields and both reference products keep the column until something moves the caret
      // horizontally, so it survives exactly as long as the caret is still where the last crossing
      // put it, and any other movement — a horizontal arrow, a keystroke, a press somewhere else —
      // re-measures.
      const carried = verticalGoalRef.current;
      const goalX =
        caret === undefined
          ? null
          : carried && carried.blockId === blockId && carried.offset === caret.offset
            ? carried.x
            : caret.x;
      const goalOffset =
        goalX === null
          ? null
          : caretOffsetOnBlockEdge(
              documentElementRef.current,
              target.id,
              goalX,
              direction < 0 ? "last" : "first",
              source
            );
      const offset = goalOffset ?? (direction < 0 ? source.length : 0);
      verticalGoalRef.current = goalX === null ? null : { blockId: target.id, offset, x: goalX };
      setActiveBlockId(target.id);
      setPendingSelection({ blockId: target.id, anchor: offset, head: offset, entry: direction });
      return true;
    },
    []
  );

  /**
   * Rewrite only the info string on a fenced Block's opening delimiter line.
   *
   * The delimiter lines are projected out of the editing surface, so this is the one route to the
   * language. Writing just that span keeps it a single command, a single undo entry, and leaves the
   * payload bytes untouched.
   */
  const setCodeLanguage = useCallback(
    (blockId: string, language: string) => {
      const block = documentRef.current
        .getSnapshot()
        .blocks.find((candidate) => candidate.id === blockId);
      if (!block) return;
      const fence = splitDelimitedBlockSource(block.kind, editableMarkdownBlockSource(block.raw));
      if (!fence) return;
      // Only what would change what the line *means* is stripped: a fence character, or a break
      // that would cut the opening line in two. Internal spaces are content — an info string is
      // arbitrary in Markdown and the chip is a free-text field over the whole of it, so squeezing
      // them out rewrote `ts title="example"` as one nonsense token and destroyed the metadata.
      const next = language.trim().replace(/[`~\r\n]+/g, "");
      if (next === fence.infoString) return;
      apply(
        {
          type: "replaceText",
          blockId,
          range: { from: fence.infoStringFrom, to: fence.infoStringTo },
          text: next,
        },
        false
      );
    },
    [apply]
  );

  const mergeForward = useCallback(
    (blockId: string) => {
      const blocks = documentRef.current.getSnapshot().blocks;
      const index = blocks.findIndex((block) => block.id === blockId);
      if (index < 0) return;
      let nextIndex = index + 1;
      while (nextIndex < blocks.length && !blocks[nextIndex].editable) nextIndex += 1;
      const next = blocks[nextIndex];
      if (!next?.editable) return;
      // Forward Delete at the end of a Block is backward merge measured from the *next* Block, so
      // both directions share one command and one undo entry.
      apply({ type: "mergeBackward", blockId: next.id });
    },
    [apply]
  );

  /**
   * Presses that land in the editor but not on a Block.
   *
   * Notion and Feishu both treat the empty space below the last Block as a click-to-append target,
   * and both clear a stale Block selection when you click away. Without either, a click in the
   * margin left the selection highlighted and the keyboard dead.
   *
   * They also both *release* the caret. We did not: `activeBlockId` was only ever cleared by a
   * pointer sweep of more than 4px, so a plain click anywhere off a Block left the pressed Block
   * still rendering its editing surface — visibly mid-edit, with its language chip and raw
   * delimiters showing — while `document.activeElement` had already fallen back to `<body>`. The
   * Block looked focused and was not. Every way out was affected: the page margins, the space below
   * the document, the chrome spacer, and Escape.
   *
   * Bound to the scroll container rather than to `.markdown-page`, because the frame is narrower
   * than the viewport and centred, so the margins either side of it are not inside the Page at all
   * and a press there used to reach no handler. Portalled UI — the slash panel, the inline toolbar,
   * the Block menu — hangs off `document.body`, outside this container, so those never trip it and
   * need no exception here.
   *
   * Releasing the caret is safe anywhere in that viewport. Arming a marquee and appending a Block
   * are not, so both stay confined to the Page exactly as they were before the binding moved. That
   * confinement is load-bearing, not tidiness: with the append reachable from the right-hand margin,
   * one click 60px below a one-line Page appended an empty paragraph and autosave wrote it to disk —
   * measured, `"Only paragraph.\n"` became `"Only paragraph.\n\n"`. Clicking away must never edit
   * the file.
   */
  const handleDocumentPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Primary button only. Written as `> 0` so a synthesised event with no `button` still counts
      // as primary rather than being silently ignored.
      if (event.button > 0) return;
      const target = event.target as HTMLElement | null;
      // React routes an event out of a portal up the *component* tree, not the DOM tree. The slash
      // panel and the inline format toolbar are both `createPortal(…, document.body)` from inside a
      // row, so their presses arrive here as though they were children of the Page while their DOM
      // ancestors are `<body>` — which means no `[data-block-id]` to recognise them by. Releasing
      // the caret on one tore the editing surface out from under the toolbar that was formatting it:
      // clicking Bold deactivated the Block and applied nothing.
      if (target?.closest("[data-native-editor-overlay], [data-radix-popper-content-wrapper]")) {
        return;
      }
      // The Block gutter's own menu portals the same way, and its press must NOT be exempted from
      // releasing the caret. Letting that half through unchanged is what hands the Block back
      // afterwards: the command runs, the Block it acted on re-activates, and its editing surface
      // takes the caret. Exempting the whole press left every gutter Duplicate, Delete and Move with
      // no active Block and no surface, so the next keystroke had nowhere to go.
      //
      // Clearing the Block *selection* is a different matter, and it was the reason every
      // whole-selection command behind a menu was dead to the mouse. `pointerdown` on a menu item
      // emptied `blockSelection` before the item's own `onClick` read it, so Turn into from the
      // selection toolbar did nothing at all and the gutter's Delete, Duplicate and Move each acted
      // on one Block out of a visibly highlighted three. The keyboard path worked, because a menu
      // driven by arrow keys sends no press. Nothing here needs the selection gone: the command
      // either replaces it or leaves it standing.
      const portalledMenuPress = !!target?.closest("[data-dropdown-portal]");
      // A classic (layout-occupying) scrollbar belongs to the scroll container, so a press on the
      // thumb targets it with an offset past its content box. Dragging to scroll must not cost the
      // caret. Where scrollbars are overlays `clientWidth` equals the border box and this can never
      // match, so it costs nothing there.
      if (
        target &&
        target === scrollElementRef.current &&
        (event.nativeEvent.offsetX >= target.clientWidth ||
          event.nativeEvent.offsetY >= target.clientHeight)
      ) {
        return;
      }
      const insidePage = !!target && !!documentElementRef.current?.contains(target);
      // Chrome for the Block itself owns its own gestures; a press there is not a selection sweep.
      if (
        insidePage &&
        !target?.closest("[data-native-block-controls], a, button, input, label, summary")
      ) {
        pointerSelectRef.current = {
          originBlockId: target?.closest<HTMLElement>("[data-block-id]")?.dataset.blockId ?? null,
          x: event.clientX,
          y: event.clientY,
          engaged: false,
        };
      }
      if (target?.closest("[data-block-id]")) return;
      if (!portalledMenuPress) setBlockSelection(null);
      // Release the caret before deciding whether this press also appends. The append branch below
      // re-assigns both, so clearing first costs it nothing.
      setActiveBlockId(null);
      setPendingSelection(null);
      if (!insidePage) return;
      const blocks = documentRef.current.getSnapshot().blocks;
      const last = blocks[blocks.length - 1];
      if (!last) return;
      const lastRow = documentElementRef.current?.querySelector<HTMLElement>(
        `[data-block-id="${CSS.escape(last.id)}"]`
      );
      if (!lastRow || event.clientY <= lastRow.getBoundingClientRect().bottom) return;
      event.preventDefault();
      const lastIsEmptyParagraph =
        last.kind === "paragraph" &&
        createBlockEditingProjection(last).editorText.trim().length === 0;
      if (lastIsEmptyParagraph) {
        setActiveBlockId(last.id);
        setPendingSelection({ blockId: last.id, anchor: 0, head: 0 });
        return;
      }
      apply({ type: "insertAfter", blockId: last.id });
    },
    [apply]
  );

  /**
   * Releasing the caret when the press lands outside the editor altogether.
   *
   * The container handler above only sees presses inside the scroll area, so clicking the file
   * sidebar or the window chrome still left the Block rendering its editing surface. Portalled
   * editor UI — the slash panel, the inline format toolbar, every Radix menu — mounts on
   * `document.body` and so counts as "outside" by DOM position while being very much inside the
   * gesture; each has to be exempted or opening a Block menu would tear down the Block it acts on.
   *
   * Only the caret is released here. A Block *selection* is left alone: its toolbar lives inside
   * the runtime and the in-editor handler already clears it, so touching it from here would only
   * add ways for a selection to disappear from under its own buttons.
   */
  useEffect(() => {
    const releaseCaret = (event: PointerEvent) => {
      if (event.button > 0) return;
      const target = event.target as HTMLElement | null;
      // A press that has already been detached from the document cannot be asked where it happened.
      // A Block that edits in place swaps the region under the pointer during the press — a pointer
      // event is discrete, so React re-renders synchronously — and a listener running afterwards
      // sees a target whose `closest` finds nothing and concludes the press was outside the editor.
      // That is how pressing a callout's body deactivated the whole Block: the caret could reach the
      // title and never the body.
      if (target && !target.isConnected) return;
      // `closest` on the shared attribute matches *any* runtime, so a press inside another Page
      // used to count as inside this one and left two live carets on screen. Only this root, and
      // the portalled overlays that belong to whichever editor opened them, keep the caret.
      const insideSomeRuntime = target?.closest("[data-native-markdown-runtime]");
      if (insideSomeRuntime && insideSomeRuntime === runtimeRootRef.current) return;
      if (target?.closest("[data-native-editor-overlay], [data-radix-popper-content-wrapper]")) {
        return;
      }
      setActiveBlockId(null);
      setPendingSelection(null);
    };
    // Capture, so the decision is made while the DOM still looks the way the user pressed it.
    document.addEventListener("pointerdown", releaseCaret, true);
    return () => document.removeEventListener("pointerdown", releaseCaret, true);
  }, []);

  useEffect(() => {
    if (!blockSelection) {
      setBlockSelectionAnnouncement("");
      return;
    }
    const count = selectedBlockIdsWithSubtrees(
      documentRef.current.getSnapshot().blocks,
      blockSelection
    ).length;
    setBlockSelectionAnnouncement(count === 1 ? "1 block selected" : `${count} blocks selected`);
  }, [blockSelection, snapshot.revision]);

  /**
   * Where to float the Block-selection toolbar: above the union of the selected rows.
   *
   * Recomputed from the DOM whenever the selection or the document changes, and hidden while a
   * pointer sweep is still in flight so it cannot flicker under the cursor mid-gesture.
   */
  const [blockSelectionToolbar, setBlockSelectionToolbar] = useState<{
    top: number;
    left: number;
    count: number;
  } | null>(null);

  // Every row's accessible name, written straight to the DOM.
  //
  // The name ends in the Block's ordinal ("Text, block 5 of 200"), which is how a screen reader
  // reading the Page in browse mode knows where it is. That ordinal changes on *every* row the
  // moment a Block is inserted or removed, so passing it as a prop invalidated `sameRowProps` for
  // all N rows and made each one rebuild its editing projection and inline parse: one Enter on a
  // 600-Block Page re-rendered 601 rows. Writing the attribute here costs N `setAttribute` calls
  // and no React render at all — `aria-label` takes no part in style or layout, and Chrome only
  // materialises the accessibility tree once an assistive technology attaches.
  //
  // This is the sole writer. `MarkdownBlockRow` deliberately renders no `aria-label`, so React
  // never clobbers what this sets when a row re-renders for an unrelated reason.
  // The effect runs on every commit, because `snapshot.blocks` is a fresh array per keystroke, so
  // each name is compared before it is written: typing changes a Block's text but not its name, and
  // an unchanged name must not cost a DOM write. `getAttribute` is a string lookup — no style, no
  // layout — which leaves a keystroke writing nothing at all and a split writing only the names
  // that actually moved.
  useLayoutEffect(() => {
    const host = documentElementRef.current;
    if (!host) return;
    const rows = host.querySelectorAll<HTMLElement>(":scope > [data-native-block-row]");
    // Folded rows are unmounted, so this has to enumerate what is on screen: pairing against the
    // whole document would name every row after the wrong Block from the first fold onwards.
    const visible = snapshot.blocks.filter((block) => !hiddenBlocks.has(block.id));
    const count = visible.length;
    visible.forEach((block, index) => {
      const row = rows[index];
      if (!row) return;
      const name = `${blockTypeLabel(block)}, block ${index + 1} of ${count}`;
      if (row.getAttribute("aria-label") !== name) row.setAttribute("aria-label", name);
    });
  }, [snapshot.blocks, hiddenBlocks]);

  // A caret can arrive inside a folded range — a search result, a Wiki Link, an undo — and a
  // Block with no row cannot be edited or even seen. Opening the anchors that hide it is the only
  // way the caret stays where it was put. A layout effect, so the row exists before the scroll
  // the find-in-page path schedules for the next frame.
  useLayoutEffect(() => {
    if (hiddenBlocks.size === 0) return;
    const focus = activeBlockId ?? blockSelection?.focusId ?? null;
    const anchors = focus ? hiddenBlocks.get(focus) : undefined;
    if (!anchors) return;
    setFoldedBlockIds((current) => {
      const next = new Set(current);
      for (const anchor of anchors) next.delete(anchor);
      return next;
    });
  }, [activeBlockId, blockSelection, hiddenBlocks]);

  // Measured after commit rather than during render: the rows have to exist before their union can
  // be read, and reading layout from a render pass is how you get a frame of stale geometry.
  useEffect(() => {
    const host = documentElementRef.current;
    if (!blockSelection || marqueeRect || !host || typeof CSS === "undefined") {
      setBlockSelectionToolbar(null);
      return;
    }
    const ids = selectedBlockIdsWithSubtrees(
      documentRef.current.getSnapshot().blocks,
      blockSelection
    );
    if (ids.length < 2) {
      setBlockSelectionToolbar(null);
      return;
    }
    let top = Number.POSITIVE_INFINITY;
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    for (const id of ids) {
      const rect = host
        .querySelector<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`)
        ?.getBoundingClientRect();
      if (!rect) continue;
      top = Math.min(top, rect.top);
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
    }
    setBlockSelectionToolbar(
      Number.isFinite(top) && Number.isFinite(left)
        ? { top, left: (left + right) / 2, count: ids.length }
        : null
    );
    // `snapshot.revision` keeps the measurement fresh after a bulk command reflows the rows.
  }, [blockSelection, marqueeRect, snapshot.revision]);

  const applyBlockSelectionCommand = useCallback(
    (command: MarkdownBlockCommand, selectedLength = 1) => {
      const result = documentRef.current.apply(command);
      publish(result, false);
      const focusId = result.selection?.blockId ?? result.snapshot.blocks[0]?.id;
      setActiveBlockId(null);
      setPendingSelection(null);
      if (!focusId) {
        setBlockSelection(null);
        return;
      }
      const firstIndex = result.snapshot.blocks.findIndex((block) => block.id === focusId);
      const lastId =
        firstIndex >= 0
          ? (result.snapshot.blocks[firstIndex + selectedLength - 1]?.id ?? focusId)
          : focusId;
      setBlockSelection({ anchorId: focusId, focusId: lastId });
    },
    [publish]
  );

  const handleBlockSelectionKeyDown = useCallback(
    (blockId: string, event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setBlockSelection(null);
        return;
      }
      if (event.key === "Enter") {
        const block = documentRef.current
          .getSnapshot()
          .blocks.find((candidate) => candidate.id === blockId);
        if (!block?.editable) return;
        event.preventDefault();
        const source = normalizeEditorLineEndings(createBlockEditingProjection(block).editorText);
        setBlockSelection(null);
        setActiveBlockId(block.id);
        setPendingSelection({
          blockId: block.id,
          anchor: source.length,
          head: source.length,
        });
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "a"
      ) {
        const blocks = documentRef.current.getSnapshot().blocks;
        const first = blocks[0];
        const last = blocks.at(-1);
        if (!first || !last) return;
        event.preventDefault();
        setBlockSelection({ anchorId: first.id, focusId: last.id });
        return;
      }
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const blocks = documentRef.current.getSnapshot().blocks;
        const currentSelection = blockSelectionRef.current ?? {
          anchorId: blockId,
          focusId: blockId,
        };
        const blockIds = selectedBlockIdsWithSubtrees(blocks, currentSelection);
        if (
          blockIds.length === 0 ||
          blockIds.some((selectedId) => {
            const selected = blocks.find((candidate) => candidate.id === selectedId);
            return !selected || !isListBlockKind(selected.kind);
          })
        ) {
          return;
        }
        event.preventDefault();
        try {
          applyBlockSelectionCommand(
            {
              type: event.shiftKey ? "outdentBlocks" : "indentBlocks",
              blockIds,
            },
            blockIds.length
          );
        } catch {
          // Invalid structural indentation is a source-preserving no-op.
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "d") {
        const currentSelection = blockSelectionRef.current ?? {
          anchorId: blockId,
          focusId: blockId,
        };
        const blockIds = selectedBlockIdsWithSubtrees(
          documentRef.current.getSnapshot().blocks,
          currentSelection
        );
        if (blockIds.length === 0) return;
        event.preventDefault();
        applyBlockSelectionCommand({ type: "duplicateBlocks", blockIds }, blockIds.length);
        return;
      }
      // Both spellings of "move this Block". The legend every focused row points a screen reader at
      // names Alt+Arrow, and Alt+Arrow is what the editing surface answers to — but a selected row
      // took only Mod+Shift+Arrow, so three of the four shortcuts the row announces did nothing in
      // exactly the state that announces them.
      if (
        (event.key === "ArrowUp" || event.key === "ArrowDown") &&
        (((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey) ||
          (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey))
      ) {
        const blocks = documentRef.current.getSnapshot().blocks;
        const currentSelection = blockSelectionRef.current ?? {
          anchorId: blockId,
          focusId: blockId,
        };
        const blockIds = selectedBlockIdsWithSubtrees(blocks, currentSelection);
        const move = hierarchySafeBlockMove(blocks, blockIds, event.key === "ArrowUp" ? -1 : 1);
        if (!move) return;
        event.preventDefault();
        applyBlockSelectionCommand({ type: "moveBlocks", ...move }, move.blockIds.length);
        return;
      }
      // Bare Backspace, and the Mod+Shift+Backspace the row announces — which a selected row used to
      // refuse outright, because this branch demanded no modifier at all.
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        !event.altKey &&
        (!(event.metaKey || event.ctrlKey) || event.shiftKey)
      ) {
        const currentSelection = blockSelectionRef.current ?? {
          anchorId: blockId,
          focusId: blockId,
        };
        const blockIds = selectedBlockIdsWithSubtrees(
          documentRef.current.getSnapshot().blocks,
          currentSelection
        );
        if (blockIds.length === 0) return;
        event.preventDefault();
        applyBlockSelectionCommand({ type: "deleteBlocks", blockIds });
        return;
      }
      if (
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        // Collapse the Block selection back to a caret, at the near edge of the near Block.
        const blocks = documentRef.current.getSnapshot().blocks;
        const currentSelection = blockSelectionRef.current ?? {
          anchorId: blockId,
          focusId: blockId,
        };
        const selected = selectedBlockIdsWithSubtrees(blocks, currentSelection);
        const targetId = event.key === "ArrowLeft" ? selected[0] : selected[selected.length - 1];
        const target = blocks.find((block) => block.id === targetId);
        if (!target?.editable) return;
        event.preventDefault();
        const source = normalizeEditorLineEndings(createBlockEditingProjection(target).editorText);
        const offset = event.key === "ArrowLeft" ? 0 : source.length;
        setBlockSelection(null);
        setActiveBlockId(target.id);
        setPendingSelection({ blockId: target.id, anchor: offset, head: offset });
        return;
      }
      if (
        event.key.length === 1 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.nativeEvent.isComposing
      ) {
        // Typing over a Block selection replaces it, the way typing over selected text does. This
        // used to be a dead keystroke: the selection stayed and the character went nowhere.
        const blocks = documentRef.current.getSnapshot().blocks;
        const currentSelection = blockSelectionRef.current ?? {
          anchorId: blockId,
          focusId: blockId,
        };
        const blockIds = selectedBlockIdsWithSubtrees(blocks, currentSelection);
        if (blockIds.length === 0) return;
        event.preventDefault();
        apply({
          type: "replaceBlocks",
          blockIds,
          markdown:
            event.key + preferredSourceLineEnding(documentRef.current.getSnapshot().markdown),
        });
        return;
      }
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const blocks = documentRef.current.getSnapshot().blocks;
      const index = blocks.findIndex((block) => block.id === blockId);
      if (index < 0) return;
      const target = blocks[index + (event.key === "ArrowUp" ? -1 : 1)];
      if (!target) return;
      event.preventDefault();
      setBlockSelection((current) => ({
        anchorId: event.shiftKey && current ? current.anchorId : target.id,
        focusId: target.id,
      }));
    },
    [apply, applyBlockSelectionCommand, redo, undo]
  );

  /**
   * Turn into, applied to every selected Block.
   *
   * With several Blocks selected this used to convert only the one whose menu was open, silently
   * ignoring the rest of the selection. Source-only kinds are skipped byte-identically rather than
   * rejected, so one unconvertible Block in the range does not abandon the whole command.
   */
  const setBlockKind = useCallback(
    (blockId: string, kind: MarkdownSettableBlockKind, level?: 1 | 2 | 3 | 4 | 5 | 6) => {
      const blocks = documentRef.current.getSnapshot().blocks;
      const selection = blockSelectionRef.current;
      const selected = selection ? selectedBlockIdsWithSubtrees(blocks, selection) : [];
      if (!selected.includes(blockId) || selected.length <= 1) {
        // `setKind` reports no selection of its own — the Block keeps its id and its text, so there
        // is nothing for the document to point at. Every other gutter command returns one, which is
        // what re-activates the Block after the menu's press released the caret; Turn into returned
        // none and left the Page with no active Block, no editing surface and focus on `<body>`. The
        // conversion was correct and the user was locked out of the result until they clicked.
        const result = documentRef.current.apply({ type: "setKind", blockId, kind, level });
        publish(result, false);
        const converted = result.snapshot.blocks.find((block) => block.id === blockId);
        setBlockSelection(null);
        if (!converted?.editable) return;
        const source = normalizeEditorLineEndings(
          createBlockEditingProjection(converted).editorText
        );
        setActiveBlockId(blockId);
        setPendingSelection({ blockId, anchor: source.length, head: source.length });
        return;
      }
      const lineEnding = preferredSourceLineEnding(documentRef.current.getSnapshot().markdown);
      // A list is written the way this editor writes every other list: tight. Emitting a blank line
      // between converted items produced a loose list — each item paragraph-wrapped by any other
      // Markdown renderer — in a file whose other lists, typed with Enter or read from disk, are
      // tight.
      const separator = isListBlockKind(kind) ? lineEnding : `${lineEnding}${lineEnding}`;
      const markdown = selected
        .map((id) => {
          const block = blocks.find((candidate) => candidate.id === id);
          if (!block) return "";
          if (isMarkdownSourceOnlyBlockKind(block.kind)) return block.raw;
          const content = normalizeEditorLineEndings(
            createBlockEditingProjection(block).editorText
          ).replace(/\n/g, lineEnding);
          return `${settableKindPrefix(kind, level)}${content}${separator}`;
        })
        .join("");
      // The boundary to whatever follows the range is the document's to draw — `replaceBlocks`
      // re-establishes it. At the end of the Page there is nothing to separate from, so the second
      // ending was a blank line appended to EOF by a command that only changed Block kinds.
      applyBlockSelectionCommand(
        {
          type: "replaceBlocks",
          blockIds: selected,
          markdown: markdown.endsWith(`${lineEnding}${lineEnding}`)
            ? markdown.slice(0, markdown.length - lineEnding.length)
            : markdown,
        },
        selected.length
      );
    },
    [applyBlockSelectionCommand, publish]
  );

  /**
   * Grow a text selection into a Block selection.
   *
   * Shift+Down at the end of a Block's text should keep extending, into the next Block. Without this
   * the selection simply stopped at the Block boundary with no way to continue by keyboard.
   */
  const extendSelectionToBlock = useCallback((blockId: string, direction: -1 | 1) => {
    const blocks = documentRef.current.getSnapshot().blocks;
    const index = blocks.findIndex((block) => block.id === blockId);
    const neighbour = blocks[index + direction];
    if (index < 0 || !neighbour) return false;
    setActiveBlockId(null);
    setPendingSelection(null);
    window.getSelection()?.removeAllRanges();
    setBlockSelection({ anchorId: blockId, focusId: neighbour.id });
    return true;
  }, []);

  /** Ids of the rows whose vertical extent intersects a viewport rectangle. */
  const blockIdsIntersecting = useCallback((top: number, bottom: number): string[] => {
    const host = documentElementRef.current;
    if (!host) return [];
    const hit: string[] = [];
    for (const row of Array.from(host.querySelectorAll<HTMLElement>("[data-native-block-row]"))) {
      const rect = row.getBoundingClientRect();
      const id = row.dataset.blockId;
      if (id && rect.bottom > top && rect.top < bottom) hit.push(id);
    }
    return hit;
  }, []);

  const endPointerSelect = useCallback(() => {
    pointerSelectRef.current = null;
    setMarqueeRect(null);
    documentElementRef.current?.removeAttribute("data-block-marquee");
  }, []);

  /**
   * Extend a Block selection as the pointer sweeps.
   *
   * Resolved from the rows' own vertical bands rather than from `elementFromPoint`, so it works over
   * the page margins as well as over text — which is what Notion does, and is also the only thing
   * that works when the pointer is beyond the content column.
   */
  const handleSelectionPointerMove = useCallback(
    (event: PointerEvent) => {
      const gesture = pointerSelectRef.current;
      if (!gesture) return;
      if (
        !gesture.engaged &&
        Math.abs(event.clientY - gesture.y) < 4 &&
        Math.abs(event.clientX - gesture.x) < 4
      ) {
        return;
      }
      const top = Math.min(gesture.y, event.clientY);
      const bottom = Math.max(gesture.y, event.clientY);
      const ids = blockIdsIntersecting(top, bottom);
      const startedInABlock = gesture.originBlockId !== null;
      // Inside a Block, the browser's own text selection stays in charge until the sweep reaches a
      // second Block. From the margin there is no text selection to respect, so a marquee starts
      // as soon as the threshold is crossed.
      if (startedInABlock && ids.length < 2) return;
      if (!gesture.engaged) {
        gesture.engaged = true;
        documentElementRef.current?.setAttribute("data-block-marquee", "true");
        setActiveBlockId(null);
        setPendingSelection(null);
        window.getSelection()?.removeAllRanges();
      }
      if (!startedInABlock) {
        const left = Math.min(gesture.x, event.clientX);
        const right = Math.max(gesture.x, event.clientX);
        setMarqueeRect({ top, left, width: right - left, height: bottom - top });
      }
      setBlockSelection(
        ids.length === 0
          ? null
          : {
              anchorId: event.clientY >= gesture.y ? ids[0] : ids[ids.length - 1],
              focusId: event.clientY >= gesture.y ? ids[ids.length - 1] : ids[0],
            }
      );
    },
    [blockIdsIntersecting]
  );

  useEffect(() => {
    const handleUp = () => {
      const gesture = pointerSelectRef.current;
      endPointerSelect();
      if (gesture?.engaged) {
        // Keyboard follows the pointer: focus the row so Escape, arrows and Backspace work at once.
        const focusId = blockSelection?.focusId;
        if (focusId && typeof CSS !== "undefined") {
          documentElementRef.current
            ?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(focusId)}"]`)
            ?.focus({ preventScroll: true });
        }
      }
    };
    window.addEventListener("pointermove", handleSelectionPointerMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleSelectionPointerMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [blockSelection?.focusId, endPointerSelect, handleSelectionPointerMove]);

  /** Would moving the dragged Blocks before `beforeId` change the document at all? */
  const blockDropWouldMove = useCallback((beforeId: string | null): boolean => {
    const session = dragSessionRef.current;
    if (!session) return false;
    const blocks = documentRef.current.getSnapshot().blocks;
    const firstIndex = blocks.findIndex((block) => block.id === session.blockIds[0]);
    const lastIndex = firstIndex + session.blockIds.length - 1;
    const beforeIndex =
      beforeId === null ? blocks.length : blocks.findIndex((block) => block.id === beforeId);
    if (firstIndex < 0 || beforeIndex < 0) return false;
    if (session.blockIds.includes(beforeId ?? "")) return false;
    if (beforeIndex === lastIndex + 1) return false;
    if (beforeId === null && lastIndex === blocks.length - 1) return false;
    return true;
  }, []);

  const rebuildDragBoundaries = useCallback(() => {
    const host = documentElementRef.current;
    if (!host) return;
    const scrollTop = scrollElementRef.current?.scrollTop ?? 0;
    const rows = Array.from(host.querySelectorAll<HTMLElement>("[data-native-block-row]"));
    const table: { beforeId: string | null; y: number; depth: number }[] = [];
    for (const row of rows) {
      const id = row.dataset.blockId ?? null;
      if (!id) continue;
      table.push({
        beforeId: id,
        y: row.getBoundingClientRect().top + scrollTop,
        depth: Number(row.dataset.blockDepth ?? 0),
      });
    }
    const last = rows[rows.length - 1];
    if (last) {
      table.push({
        beforeId: null,
        y: last.getBoundingClientRect().bottom + scrollTop,
        depth: Number(last.dataset.blockDepth ?? 0),
      });
    }
    dragBoundariesRef.current = table.filter((boundary) => blockDropWouldMove(boundary.beforeId));
  }, [blockDropWouldMove]);

  /**
   * Paint the insertion line straight onto the DOM.
   *
   * `dragover` fires continuously, and routing it through React state re-rendered every row on every
   * pointer move. The CSS already keys off these attributes, so setting them directly keeps the line
   * exact and costs nothing.
   */
  const paintDropIndicator = useCallback((beforeId: string | null | undefined) => {
    const host = documentElementRef.current;
    if (!host) return;
    for (const marked of Array.from(host.querySelectorAll("[data-drop-before]"))) {
      marked.removeAttribute("data-drop-before");
    }
    const tail = host.querySelector("[data-native-block-drop-end]");
    tail?.removeAttribute("data-drop-active");
    if (beforeId === undefined) return;
    if (beforeId === null) {
      tail?.setAttribute("data-drop-active", "true");
      return;
    }
    if (typeof CSS === "undefined") return;
    host
      .querySelector(`[data-block-id="${CSS.escape(beforeId)}"]`)
      ?.setAttribute("data-drop-before", "true");
  }, []);

  const stopDragAutoScroll = useCallback(() => {
    const state = dragAutoScrollRef.current;
    if (state.frame !== null) window.cancelAnimationFrame(state.frame);
    state.frame = null;
  }, []);

  /**
   * Scroll the Page while a Block is held near the top or bottom edge.
   *
   * HTML drag-and-drop suppresses wheel scrolling, so without this a Block can only be dropped
   * somewhere already on screen. Speed ramps with proximity, from 240px/s at the threshold to
   * 1440px/s at the very edge, which is what makes a long reorder feel controllable.
   *
   * Per *second*, multiplied by the frame's own duration. The ramp used to be added once per
   * animation frame, which is 240-1440px/s only on a display refreshing at exactly 60Hz: driven
   * through 500ms of frames with the pointer 60px inside the band, the same gesture travelled 210px
   * at 60Hz and 504px at 144Hz, and it slowed in step with any frame the Page dropped. It now
   * travels ~220px either way. A long frame is capped at 50ms, so a throttled or backgrounded
   * window cannot resume by scrolling most of a screenful in one step.
   */
  const startDragAutoScroll = useCallback(() => {
    const state = dragAutoScrollRef.current;
    if (state.frame !== null) return;
    state.time = 0;
    const step = (now: number) => {
      const scroller = scrollElementRef.current;
      if (!scroller || !dragSessionRef.current) {
        state.frame = null;
        return;
      }
      const seconds = state.time === 0 ? 0 : Math.min(now - state.time, 50) / 1000;
      state.time = now;
      const rect = scroller.getBoundingClientRect();
      const threshold = 72;
      const fromTop = state.clientY - rect.top;
      const fromBottom = rect.bottom - state.clientY;
      let speed = 0;
      if (fromTop < threshold) speed = -(240 + 1200 * (1 - Math.max(fromTop, 0) / threshold));
      else if (fromBottom < threshold) {
        speed = 240 + 1200 * (1 - Math.max(fromBottom, 0) / threshold);
      }
      if (speed !== 0) scroller.scrollTop += speed * seconds;
      state.frame = window.requestAnimationFrame(step);
    };
    state.frame = window.requestAnimationFrame(step);
  }, []);

  const startBlockDrag = useCallback(
    (blockId: string, event: DragEvent<HTMLButtonElement>) => {
      const blocks = documentRef.current.getSnapshot().blocks;
      const selection = blockSelectionRef.current;
      const selectedIds = selection ? selectedBlockIdsWithSubtrees(blocks, selection) : [];
      const blockIds = expandSelectedListSubtrees(
        blocks,
        selectedIds.includes(blockId) ? selectedIds : [blockId]
      );
      dragSessionCounterRef.current += 1;
      const token = `${file.id}:${dragSessionCounterRef.current}`;
      dragSessionRef.current = { pageId: file.id, blockIds, token };
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(NATIVE_BLOCK_DRAG_MIME, token);

      // Drag what the user grabbed, not the grip. Chromium snapshots the drag image synchronously,
      // so the clone has to be laid out — off-screen, never `display: none`.
      dragGhostRef.current?.remove();
      const ghost = buildBlockDragGhost(documentElementRef.current, blockIds);
      if (ghost) {
        dragGhostRef.current = ghost;
        event.dataTransfer.setDragImage(ghost, 16, 14);
        const dropGhost = () => {
          ghost.remove();
          if (dragGhostRef.current === ghost) dragGhostRef.current = null;
        };
        // The browser snapshots the image before either of these runs. Both are scheduled because a
        // backgrounded window may never run an animation frame, and a leaked clone would sit in the
        // body forever.
        window.requestAnimationFrame(dropGhost);
        window.setTimeout(dropGhost, 0);
      }
      for (const id of blockIds) {
        if (typeof CSS === "undefined") break;
        documentElementRef.current
          ?.querySelector(`[data-block-id="${CSS.escape(id)}"]`)
          ?.setAttribute("data-block-dragging", "true");
      }
      rebuildDragBoundaries();
      // Where the pointer actually is, before the first `dragover` says so. The autoscroll loop
      // starts here and reads this field on its very first frame; left at its initial 0 it read the
      // grip as being above the scroll port and ran the top ramp at full speed until a `dragover`
      // arrived. Measured on a 100-Block Page at scrollTop 900: the first drag of a session jerked
      // the Page 48-96px upward the moment it started, depending on how many frames went by before
      // that `dragover`, while every later drag — inheriting the previous drag's pointer — moved it
      // 0px, which is why this only ever showed up once.
      dragAutoScrollRef.current.clientY = event.clientY;
      startDragAutoScroll();
    },
    [file.id, rebuildDragBoundaries, startDragAutoScroll]
  );

  const clearBlockDrag = useCallback(() => {
    dragSessionRef.current = null;
    dropTargetRef.current = null;
    dragBoundariesRef.current = [];
    stopDragAutoScroll();
    paintDropIndicator(undefined);
    dragGhostRef.current?.remove();
    dragGhostRef.current = null;
    for (const dragging of Array.from(
      documentElementRef.current?.querySelectorAll("[data-block-dragging]") ?? []
    )) {
      dragging.removeAttribute("data-block-dragging");
    }
    setBlockDropBeforeId(undefined);
  }, [paintDropIndicator, stopDragAutoScroll]);

  const canDropBlock = useCallback(
    (dataTransfer: DataTransfer) => {
      const session = dragSessionRef.current;
      return (
        session !== null &&
        session.pageId === file.id &&
        Array.from(dataTransfer.types ?? []).includes(NATIVE_BLOCK_DRAG_MIME)
      );
    },
    [file.id]
  );

  const dropBlockBefore = useCallback(
    (beforeId: string | null, dataTransfer: DataTransfer): boolean => {
      const session = dragSessionRef.current;
      if (!session || session.pageId !== file.id || !canDropBlock(dataTransfer)) return false;
      try {
        if (dataTransfer.getData(NATIVE_BLOCK_DRAG_MIME) !== session.token) return false;
      } catch {
        return false;
      }

      dragSessionRef.current = null;
      dropTargetRef.current = null;
      dragBoundariesRef.current = [];
      stopDragAutoScroll();
      paintDropIndicator(undefined);
      dragGhostRef.current?.remove();
      dragGhostRef.current = null;
      for (const dragging of Array.from(
        documentElementRef.current?.querySelectorAll("[data-block-dragging]") ?? []
      )) {
        dragging.removeAttribute("data-block-dragging");
      }
      setBlockDropBeforeId(undefined);
      const blocks = documentRef.current.getSnapshot().blocks;
      const firstIndex = blocks.findIndex((block) => block.id === session.blockIds[0]);
      const lastIndex = firstIndex + session.blockIds.length - 1;
      const beforeIndex =
        beforeId === null ? blocks.length : blocks.findIndex((block) => block.id === beforeId);
      const noOp =
        firstIndex < 0 ||
        beforeIndex < 0 ||
        session.blockIds.includes(beforeId ?? "") ||
        beforeIndex === lastIndex + 1 ||
        (beforeId === null && lastIndex === blocks.length - 1);
      if (!noOp) {
        applyBlockSelectionCommand(
          { type: "moveBlocks", blockIds: session.blockIds, beforeId },
          session.blockIds.length
        );
      }
      return true;
    },
    [applyBlockSelectionCommand, canDropBlock, file.id, paintDropIndicator, stopDragAutoScroll]
  );

  /** Nearest drop boundary to the pointer, or null when nothing useful is in reach. */
  const nearestDropBoundary = useCallback((clientY: number) => {
    const table = dragBoundariesRef.current;
    if (table.length === 0 || !Number.isFinite(clientY)) return null;
    // Into the same content space the table was measured in. Every boundary shifted by exactly the
    // scroll delta, so moving the pointer by it instead is the same comparison for one addition.
    const y = clientY + (scrollElementRef.current?.scrollTop ?? 0);
    let best = table[0];
    for (const boundary of table) {
      if (Math.abs(y - boundary.y) < Math.abs(y - best.y)) best = boundary;
    }
    // Far from every boundary the intent is ambiguous, so show nothing rather than guess.
    return Math.abs(y - best.y) > 160 ? null : best;
  }, []);

  /**
   * Boundary implied by the element under the pointer, for drag events that carry no coordinates.
   *
   * A real `dragover` always has a `clientY`; this covers synthesised events, and it keeps the
   * element the user is actually over authoritative instead of falling back to "the first boundary",
   * which is what a `NaN` distance silently resolves to.
   */
  const boundaryFromDragTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) return null;
    const table = dragBoundariesRef.current;
    if (target.closest("[data-native-block-drop-end]")) {
      return table.find((boundary) => boundary.beforeId === null) ?? null;
    }
    const blockId = target.closest<HTMLElement>("[data-block-id]")?.dataset.blockId;
    return blockId ? (table.find((boundary) => boundary.beforeId === blockId) ?? null) : null;
  }, []);

  const handleBlockDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!canDropBlock(event.dataTransfer)) return;
      // Claimed unconditionally so the frame margins and the tail region are live drop targets, not
      // dead zones the pointer falls into between rows.
      event.preventDefault();
      dragAutoScrollRef.current.clientY = event.clientY;
      const boundary = Number.isFinite(event.clientY)
        ? nearestDropBoundary(event.clientY)
        : boundaryFromDragTarget(event.target);
      if (!boundary) {
        event.dataTransfer.dropEffect = "none";
        dropTargetRef.current = null;
        paintDropIndicator(undefined);
        return;
      }
      event.dataTransfer.dropEffect = "move";
      if (dropTargetRef.current?.beforeId !== boundary.beforeId) {
        dropTargetRef.current = { beforeId: boundary.beforeId };
        paintDropIndicator(boundary.beforeId);
      }
    },
    [boundaryFromDragTarget, canDropBlock, nearestDropBoundary, paintDropIndicator]
  );

  const handleBlockDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!canDropBlock(event.dataTransfer)) return;
      const target =
        dropTargetRef.current ??
        (Number.isFinite(event.clientY)
          ? nearestDropBoundary(event.clientY)
          : boundaryFromDragTarget(event.target));
      if (!target) {
        event.preventDefault();
        clearBlockDrag();
        return;
      }
      if (dropBlockBefore(target.beforeId, event.dataTransfer)) event.preventDefault();
    },
    [boundaryFromDragTarget, canDropBlock, clearBlockDrag, dropBlockBefore, nearestDropBoundary]
  );

  /**
   * Every callback a row is handed, hoisted out of the render so its identity is stable.
   *
   * Rows are memoised, and a memo comparator that sees fifteen fresh arrow functions per row per
   * keystroke skips nothing. Each of these reads the live document through `documentRef` or a latest
   * ref rather than closing over `snapshot`, so nothing here depends on a value that changes as the
   * user types.
   */
  const handleActivate = useCallback(
    (blockId: string, clickedSelection?: { anchor: number; head: number }) => {
      if (isSearchBarOpen) setSearchBarOpen(false);
      setActiveBlockId(blockId);
      setBlockSelection(null);
      setPendingSelection(clickedSelection ? { blockId, ...clickedSelection } : null);
    },
    [isSearchBarOpen, setSearchBarOpen]
  );

  const handleSelectBlock = useCallback((blockId: string, extend = false) => {
    const caretBlockId = activeBlockIdRef.current;
    setActiveBlockId(null);
    setPendingSelection(null);
    setBlockSelection((current) => {
      if (extend && current) {
        return { anchorId: current.anchorId, focusId: blockId };
      }
      // Shift+click while a caret is live extends from the caret's Block, so the
      // gesture selects a range instead of collapsing to the one Block clicked.
      if (extend && caretBlockId && caretBlockId !== blockId) {
        return { anchorId: caretBlockId, focusId: blockId };
      }
      if (
        current &&
        selectedBlockIdsWithSubtrees(documentRef.current.getSnapshot().blocks, current).includes(
          blockId
        )
      ) {
        return current;
      }
      return { anchorId: blockId, focusId: blockId };
    });
  }, []);

  const handleChange = useCallback(
    (
      blockId: string,
      source: string,
      options?: { readonly surfaceChanges?: boolean; readonly caret?: number }
    ) => {
      const latest = documentRef.current.getSnapshot();
      const current = latest.blocks.find((candidate) => candidate.id === blockId);
      if (!current) return;
      const currentSource = editableMarkdownBlockSource(current.raw);
      const projection = createBlockEditingProjection(current);
      const nextSource = editableMarkdownBlockSource(projection.toSource(source));
      const patch = minimalEditorPatch(
        currentSource,
        nextSource,
        preferredSourceLineEnding(current.raw, latest.markdown)
      );
      if (!patch) return;
      const composing = composingBlockIdRef.current === blockId;
      const result = documentRef.current.apply({
        type: "replaceText",
        blockId,
        range: { from: patch.from, to: patch.to },
        text: patch.text,
        recordHistory: !composing || !compositionHasHistoryRef.current,
      });
      // A text edit leaves the caret to the surface that produced it — that is what makes ordinary
      // typing cost no selection round-trip at all.
      //
      // Unless the edit moved the projection out from under it. A Markdown autoformat rewrites what
      // the Block *is*: the space in `## ` turns the paragraph into a heading, and the heading edits
      // as its payload alone, so the surface's `value` shrinks by the three characters that just
      // became the marker. React writes the shorter string back and the browser parks the caret at
      // the end of it — measured, typing `## ` at the start of `Heading text` left the caret at
      // offset 12 of 12 and the next character landed as `## Heading textX`. The document already
      // reports where the caret belongs in source offsets; when the projection has moved, that
      // answer is the only correct one. Never mid-composition: assigning a selection there closes
      // the IME's candidate window and drops the in-flight text.
      const edited = result.snapshot.blocks.find((candidate) => candidate.id === blockId);
      const projectionMoved =
        !composing &&
        (!edited ||
          normalizeEditorLineEndings(createBlockEditingProjection(edited).editorText) !== source);
      publish(result, options?.surfaceChanges === true || projectionMoved);
      if (typeof options?.caret === "number") {
        setPendingSelection({
          blockId,
          anchor: options.caret,
          head: options.caret,
        });
      }
      if (composing) compositionHasHistoryRef.current = true;
      else scheduleTypingCheckpoint();
    },
    [publish, scheduleTypingCheckpoint]
  );

  const handlePaste = useCallback(
    (blockId: string, from: number, to: number, text: string) => {
      const latest = documentRef.current.getSnapshot();
      const current = latest.blocks.find((candidate) => candidate.id === blockId);
      if (!current) return;
      const lineEnding = preferredSourceLineEnding(current.raw, latest.markdown);
      apply({
        type: "replaceText",
        blockId,
        range: {
          from: blockSourceOffsetForEditorOffset(current, from),
          to: blockSourceOffsetForEditorOffset(current, to),
        },
        text: normalizeEditorLineEndings(text).replace(/\n/g, lineEnding),
      });
    },
    [apply]
  );

  const handleApplyInlineFormat = useCallback(
    (blockId: string, from: number, to: number, format: MarkdownInlineFormat) => {
      const latest = documentRef.current.getSnapshot();
      const current = latest.blocks.find((candidate) => candidate.id === blockId);
      if (!current) return;
      const editorSource = normalizeEditorLineEndings(
        createBlockEditingProjection(current).editorText
      );
      const edit = createMarkdownInlineFormatEdit(editorSource, from, to, format);
      if (!edit) return;
      const lineEnding = preferredSourceLineEnding(current.raw, latest.markdown);
      const result = documentRef.current.apply({
        type: "replaceText",
        blockId,
        range: {
          from: blockSourceOffsetForEditorOffset(current, edit.from),
          to: blockSourceOffsetForEditorOffset(current, edit.to),
        },
        text: edit.text.replace(/\n/g, lineEnding),
      });
      publish(result, false);
      setActiveBlockId(blockId);
      setBlockSelection(null);
      setPendingSelection({ blockId, ...edit.selection });
    },
    [publish]
  );

  const handleEditLink = useCallback(
    (blockId: string, from: number, to: number, url: string) => {
      const latest = documentRef.current.getSnapshot();
      const current = latest.blocks.find((candidate) => candidate.id === blockId);
      if (!current) return;
      const editorSource = normalizeEditorLineEndings(
        createBlockEditingProjection(current).editorText
      );
      const edit = createMarkdownLinkEdit(editorSource, from, to, url);
      if (!edit) return;
      const lineEnding = preferredSourceLineEnding(current.raw, latest.markdown);
      const result = documentRef.current.apply({
        type: "replaceText",
        blockId,
        range: {
          from: blockSourceOffsetForEditorOffset(current, edit.from),
          to: blockSourceOffsetForEditorOffset(current, edit.to),
        },
        text: edit.text.replace(/\n/g, lineEnding),
      });
      publish(result, false);
      setActiveBlockId(blockId);
      setBlockSelection(null);
      setPendingSelection({ blockId, ...edit.selection });
    },
    [publish]
  );

  const handleSelectCellRange = useCallback((blockId: string, from: number, to: number) => {
    setActiveBlockId(blockId);
    setBlockSelection(null);
    setPendingSelection({ blockId, anchor: from, head: to });
  }, []);

  const handleCompositionStart = useCallback(
    (blockId: string) => {
      composingBlockIdRef.current = blockId;
      compositionHasHistoryRef.current = false;
      // A composition is one authored unit: end the surrounding typing run so undo
      // takes back the whole committed word rather than half of it plus a few Latin
      // characters typed before the IME opened.
      documentRef.current.flushHistory();
      debouncedSave.cancel();
    },
    [debouncedSave]
  );

  const handleCompositionEnd = useCallback(
    (blockId: string) => {
      if (composingBlockIdRef.current !== blockId) return;
      composingBlockIdRef.current = null;
      compositionHasHistoryRef.current = false;
      documentRef.current.flushHistory();
      scheduleAutosave(documentRef.current.getSnapshot().markdown);
    },
    [scheduleAutosave]
  );

  const handleSplit = useCallback(
    (blockId: string, from: number, to: number) => {
      const current = documentRef.current
        .getSnapshot()
        .blocks.find((candidate) => candidate.id === blockId);
      if (!current) return;
      apply({
        type: "split",
        blockId,
        at: blockSourceOffsetForEditorOffset(current, from),
        to: blockSourceOffsetForEditorOffset(current, to),
      });
    },
    [apply]
  );

  const handleMergeBackward = useCallback(
    (blockId: string) => apply({ type: "mergeBackward", blockId }),
    [apply]
  );

  const handleInsertAfter = useCallback(
    (blockId: string, placement?: "below" | "above") =>
      apply({ type: "insertAfter", blockId, before: placement === "above" }),
    [apply]
  );

  const handleCopyBlockMarkdown = useCallback(async (blockId: string) => {
    const current = documentRef.current.getSnapshot();
    const selection = blockSelectionRef.current;
    const selectionIds = selection ? selectedBlockIdsWithSubtrees(current.blocks, selection) : [];
    const selectedIds = expandSelectedListSubtrees(
      current.blocks,
      selectionIds.includes(blockId) ? selectionIds : [blockId]
    );
    const selectedSet = new Set(selectedIds);
    const markdown = current.blocks
      .filter((candidate) => selectedSet.has(candidate.id))
      .map((candidate) => candidate.raw)
      .join("");
    // Copy is the one command in the Block menu that changes nothing, and it was the only one that
    // left the Page with no caret: the others re-activate through the selection their command
    // returns, and this one issues no command at all. The menu's press had already released the
    // caret, so the next key was routed by edit intent into whichever Block was near the top of the
    // viewport — a read-only gesture that ended in a stray edit to an untouched Block. Restored
    // before the write is awaited, so the caret does not depend on the clipboard answering.
    const copied = current.blocks.find((candidate) => candidate.id === blockId);
    if (selectedIds.length <= 1 && copied?.editable) {
      const source = normalizeEditorLineEndings(createBlockEditingProjection(copied).editorText);
      setActiveBlockId(blockId);
      setBlockSelection(null);
      setPendingSelection({ blockId, anchor: source.length, head: source.length });
    }
    try {
      await navigator.clipboard.writeText(markdown);
    } catch {
      notify.error("Could not copy Markdown");
    }
  }, []);

  const handleDuplicateBlock = useCallback(
    (blockId: string) => {
      const current = documentRef.current.getSnapshot();
      const selection = blockSelectionRef.current;
      const selectedIds = selection ? selectedBlockIdsWithSubtrees(current.blocks, selection) : [];
      // Only a selection the user can actually see takes the whole-selection route. Opening the gutter
      // menu marks its own row selected, so `includes(blockId)` alone was true for an ordinary
      // single-Block Duplicate — which then went through `applyBlockSelectionCommand`, and that path
      // deliberately ends on a Block selection rather than a caret. Measured on the packaged app,
      // that is what left a plain gutter Duplicate with `active: 0, editors: 0` and the editor
      // keyboard-dead, the state 37 e2e cases encode. One Block is a Block command; a band is a
      // selection command.
      if (selectedIds.length > 1 && selectedIds.includes(blockId)) {
        applyBlockSelectionCommand(
          { type: "duplicateBlocks", blockIds: selectedIds },
          selectedIds.length
        );
        return;
      }
      apply({ type: "duplicate", blockId });
    },
    [apply, applyBlockSelectionCommand]
  );

  const handleDeleteBlock = useCallback(
    (blockId: string) => {
      const current = documentRef.current.getSnapshot();
      const selection = blockSelectionRef.current;
      const selectedIds = selection ? selectedBlockIdsWithSubtrees(current.blocks, selection) : [];
      if (selectedIds.length > 1 && selectedIds.includes(blockId)) {
        applyBlockSelectionCommand({ type: "deleteBlocks", blockIds: selectedIds });
        return;
      }
      apply({ type: "delete", blockId });
    },
    [apply, applyBlockSelectionCommand]
  );

  const handleSetTaskChecked = useCallback(
    (blockId: string, checked: boolean) =>
      apply({ type: "setTaskChecked", blockId, checked }, false),
    [apply]
  );

  const handleMoveBlock = useCallback(
    (blockId: string, direction: -1 | 1) => {
      const blocks = documentRef.current.getSnapshot().blocks;
      const selection = blockSelectionRef.current;
      const selectedIds = selection ? selectedBlockIdsWithSubtrees(blocks, selection) : [];
      // Same rule as Duplicate and Delete: a band moves as a band, one Block moves as a Block. The
      // gutter menu marks its own row selected, so without the length test an ordinary Move up went
      // through the selection path and ended on a selection instead of a caret.
      if (selectedIds.length <= 1 || !selectedIds.includes(blockId)) {
        return moveBlock(blockId, direction);
      }
      const move = hierarchySafeBlockMove(blocks, selectedIds, direction);
      if (!move) return false;
      applyBlockSelectionCommand({ type: "moveBlocks", ...move }, move.blockIds.length);
      return true;
    },
    [applyBlockSelectionCommand, moveBlock]
  );

  const handleIndent = useCallback(
    (blockId: string, direction: -1 | 1, selection: { anchor: number; head: number }) => {
      try {
        const current = documentRef.current.getSnapshot();
        const result = documentRef.current.apply({
          type: direction < 0 ? "outdentBlocks" : "indentBlocks",
          blockIds: expandSelectedListSubtrees(current.blocks, [blockId]),
        });
        publish(result, false);
        setActiveBlockId(blockId);
        setBlockSelection(null);
        setPendingSelection({ blockId, ...selection });
        return true;
      } catch {
        return false;
      }
    },
    [publish]
  );

  const handleRunSlashCommand = useCallback(
    (blockId: string, commandId: MarkdownSlashCommandId, run: MarkdownSlashRun) => {
      const latest = documentRef.current.getSnapshot();
      const current = latest.blocks.find((candidate) => candidate.id === blockId);
      if (!current) return;
      const lineEnding = preferredSourceLineEnding(current.raw, latest.markdown);
      const template = markdownSlashCommandSource(commandId, lineEnding);
      // Replace only the `/query` the user typed, mapped from editor offsets to source
      // offsets. Overwriting the whole Block discarded any text typed before the
      // trigger, which is why `/` used to be usable only on an otherwise empty Block.
      const from = blockSourceOffsetForEditorOffset(current, run.start);
      const to = blockSourceOffsetForEditorOffset(current, run.end);
      const source = editableMarkdownBlockSource(current.raw);
      const retained = source.slice(0, from) + source.slice(to);
      // Land the caret inside the template — on a code fence's body line, in a table's
      // first cell — instead of after its closing delimiter.
      //
      // `documentCaret` is document-relative, because Block spans are
      // (`raw: markdown.slice(block.from, block.to)`). Passing a Block-relative offset found
      // whichever Block happened to span that small number, which is always the first one, so
      // running a slash command in any Block but the first left the caret in Block 1 — and
      // everything typed next went into Block 1's text.
      const landCaret = (
        result: MarkdownBlockApplyResult,
        documentCaret: number,
        fallback: MarkdownBlockView | undefined
      ) => {
        // The *last* Block that contains the caret, not the first. Block spans are contiguous —
        // one ends exactly where the next begins — so a caret sitting on a boundary is inside both
        // of them, and scanning forwards always answered with the Block before it. `/text` is where
        // that shows: its template is the empty string, so running it on a Block of its own leaves
        // that Block empty and the caret on its opening boundary. Measured on `Alpha` / `/text`, the
        // caret landed at offset 5 of `Alpha` and the next two characters were written into it. The
        // Block the command acted on is always the later one.
        const targetBlock =
          result.snapshot.blocks.findLast(
            (candidate) => candidate.from <= documentCaret && documentCaret <= candidate.to
          ) ?? fallback;
        if (!targetBlock) return;
        const offset = editorOffsetForBlockSourceOffset(
          targetBlock,
          documentCaret - targetBlock.from
        );
        setActiveBlockId(targetBlock.id);
        setBlockSelection(null);
        setPendingSelection({ blockId: targetBlock.id, anchor: offset, head: offset });
      };

      // A template that is a Block of its own cannot be spliced into a line of text. Doing it anyway
      // wrote the table — or the fence, or the divider — into the middle of the user's sentence:
      // `Alpha /table` became a table whose last row read `|  |  |Alpha`, so the word "Alpha" was
      // still in the file but on no row and reachable by no caret. The text the user already had
      // stays exactly where it is, byte for byte, and the Block the command inserts goes after it.
      // An inline template — `[[Page]]`, `![[Page]]` — still lands at the caret, which is the whole
      // point of those.
      if (retained.trim() && !isInlineSlashTemplate(template)) {
        const result = documentRef.current.apply({
          type: "replaceBlocks",
          blockIds: [blockId],
          markdown: `${retained}${lineEnding}${lineEnding}${template}${lineEnding}`,
        });
        publish(result, false);
        const keptIndex = result.snapshot.blocks.findIndex((candidate) => candidate.id === blockId);
        const templateBlock = result.snapshot.blocks[keptIndex + 1];
        if (!templateBlock) return;
        landCaret(
          result,
          templateBlock.from + markdownSlashCommandCaret(commandId, lineEnding),
          templateBlock
        );
        return;
      }

      const result = documentRef.current.apply({
        type: "replaceText",
        blockId,
        range: { from, to },
        text: template,
      });
      publish(result, false);
      const edited = result.snapshot.blocks.find((candidate) => candidate.id === blockId);
      landCaret(
        result,
        (edited?.from ?? current.from) + from + markdownSlashCommandCaret(commandId, lineEnding),
        edited
      );
    },
    [publish]
  );

  const suggestWikiLinks = useCallback(() => wikiLinkPages(useFileStore.getState().files), []);

  const handleInsertWikiLink = useCallback(
    (blockId: string, linkSource: string, run: MarkdownWikiLinkRun) => {
      const latest = documentRef.current.getSnapshot();
      const current = latest.blocks.find((candidate) => candidate.id === blockId);
      if (!current) return;
      // Replace exactly the `[[query` the user typed, mapped from editor offsets to source
      // offsets — the text before the trigger stays byte for byte where it was.
      const from = blockSourceOffsetForEditorOffset(current, run.start);
      const to = blockSourceOffsetForEditorOffset(current, run.end);
      const result = documentRef.current.apply({
        type: "replaceText",
        blockId,
        range: { from, to },
        text: linkSource,
      });
      publish(result, false);
      const edited = result.snapshot.blocks.find((candidate) => candidate.id === blockId);
      if (!edited) return;
      // Just past the closing `]]`, so typing continues after the link rather than inside it.
      const offset = editorOffsetForBlockSourceOffset(edited, from + linkSource.length);
      setActiveBlockId(edited.id);
      setBlockSelection(null);
      setPendingSelection({ blockId: edited.id, anchor: offset, head: offset });
    },
    [publish]
  );

  const pageFrameStyle = {
    "--editor-outline-gutter": `${reservedRightInset}px`,
  } as CSSProperties;
  const wordCount = countWords(snapshot.markdown);
  const currentSearchMatch = searchMatches[currentSearchIndex];
  // Derived from the match itself. Requiring `pendingSelection` to still equal it meant the
  // highlight vanished the moment the selection was consumed — which is immediately — so the
  // counter said "2 of 5" while nothing on the Page was marked.
  const searchHighlight = isSearchBarOpen && currentSearchMatch ? currentSearchMatch : null;

  const reloadExternalMarkdown = () => {
    const markdown = externalMarkdownRef.current;
    if (markdown === null) return;
    debouncedSave.cancel();
    conflictGenerationRef.current += 1;
    documentRef.current = MarkdownBlockDocument.fromMarkdown(markdown);
    const next = documentRef.current.getSnapshot();
    lastSavedMarkdownRef.current = markdown;
    externalMarkdownRef.current = null;
    setSnapshot(next);
    setActiveBlockId(null);
    setBlockSelection(null);
    setPendingSelection(null);
    setHasExternalConflict(false);
    setDirty(false);
  };

  /**
   * The other exit from the conflict: the text in the editor becomes the file.
   *
   * The disk read that raised the conflict already refreshed the revision this Page writes against,
   * so this is the ordinary save it would have been. Deliberate, and reachable only from the button
   * beside the one that reloads — before this existed the banner offered exactly one resolution,
   * and it was the one that threw away everything the user had typed.
   */
  const keepLocalMarkdown = () => {
    if (externalMarkdownRef.current === null) return;
    externalMarkdownRef.current = null;
    conflictGenerationRef.current += 1;
    setHasExternalConflict(false);
    // A write that conflicts again raises the banner again, which is the right answer: the file
    // moved under us a second time and neither version may be picked without being asked.
    void saveCurrentNow().catch(() => undefined);
  };

  const moveSearchResult = (direction: -1 | 1) => {
    setCurrentSearchIndex((index) =>
      searchMatches.length === 0
        ? 0
        : (index + direction + searchMatches.length) % searchMatches.length
    );
  };

  /** Rewrite one match through the ordinary source-backed text command. */
  const replaceMatch = (match: MarkdownSearchMatch): boolean => {
    const latest = documentRef.current.getSnapshot();
    const block = latest.blocks.find((candidate) => candidate.id === match.blockId);
    if (!block) return false;
    const from = blockSourceOffsetForEditorOffset(block, Math.min(match.anchor, match.head));
    const to = blockSourceOffsetForEditorOffset(block, Math.max(match.anchor, match.head));
    publish(
      documentRef.current.apply({
        type: "replaceText",
        blockId: match.blockId,
        range: { from, to },
        text: replaceTerm,
      }),
      false
    );
    return true;
  };

  const replaceCurrent = () => {
    const match = searchMatches[currentSearchIndex];
    if (!match || !replaceMatch(match)) return;
    // The list is recomputed from the new text, so the index stays put and lands on what is now
    // the next match — except at the end, where it has to wrap rather than point past the array.
    setCurrentSearchIndex((index) => (index >= searchMatches.length - 1 ? 0 : index));
  };

  const replaceAllMatches = () => {
    // Last to first: replacing shifts every offset after the match, and walking backwards means
    // the offsets still ahead of the cursor are the ones that have not moved yet.
    for (let index = searchMatches.length - 1; index >= 0; index -= 1) {
      replaceMatch(searchMatches[index]);
    }
    setCurrentSearchIndex(0);
  };

  return (
    <div
      ref={runtimeRootRef}
      className="relative flex h-full min-h-0 flex-col"
      data-testid="markdown-block-runtime"
      data-native-markdown-runtime
    >
      {isSearchBarOpen && isActivePane ? (
        <div
          role="search"
          data-native-editor-chrome
          aria-label="Find in Page"
          className="absolute left-2 right-2 top-12 z-[45] rounded-lg border border-border bg-popover shadow-lg md:left-auto md:right-4 md:w-[420px]"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setSearchBarOpen(false);
            } else if (event.target === searchInputRef.current && event.key === "Enter") {
              event.preventDefault();
              moveSearchResult(event.shiftKey ? -1 : 1);
            }
          }}
        >
          <div className="flex items-center gap-2 px-3 py-2.5">
            <input
              ref={searchInputRef}
              type="search"
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value);
                setCurrentSearchIndex(0);
              }}
              placeholder="Search"
              className="min-w-[80px] flex-1 bg-transparent text-base placeholder:text-muted-foreground focus:outline-none md:text-sm"
              aria-label="Search text"
            />
            <span
              aria-live="polite"
              className="min-w-[60px] whitespace-nowrap text-center text-xs text-muted-foreground"
            >
              {searchTerm
                ? findResult.invalid
                  ? "Bad pattern"
                  : searchMatches.length > 0
                    ? `${currentSearchIndex + 1} of ${searchMatches.length}`
                    : "No matches"
                : null}
            </span>
            <button
              type="button"
              aria-label="Match case"
              title="Match case"
              aria-pressed={findOptions.caseSensitive}
              className={`rounded-md px-1.5 py-1 font-mono text-xs ${
                findOptions.caseSensitive ? "bg-accent text-accent-foreground" : "hover:bg-accent"
              }`}
              onClick={() =>
                setFindOptions((current) => ({
                  ...current,
                  caseSensitive: !current.caseSensitive,
                }))
              }
            >
              Aa
            </button>
            <button
              type="button"
              aria-label="Use regular expression"
              title="Use regular expression"
              aria-pressed={findOptions.regex}
              className={`rounded-md px-1.5 py-1 font-mono text-xs ${
                findOptions.regex ? "bg-accent text-accent-foreground" : "hover:bg-accent"
              }`}
              onClick={() => setFindOptions((current) => ({ ...current, regex: !current.regex }))}
            >
              .*
            </button>
            <button
              type="button"
              aria-label="Previous result"
              title="Previous result"
              disabled={searchMatches.length === 0}
              className="rounded-md px-2 py-1 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => moveSearchResult(-1)}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Next result"
              title="Next result"
              disabled={searchMatches.length === 0}
              className="rounded-md px-2 py-1 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => moveSearchResult(1)}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label="Close search"
              title="Close search"
              className="rounded-md px-2 py-1 hover:bg-accent"
              onClick={() => setSearchBarOpen(false)}
            >
              ×
            </button>
          </div>
          {isReplaceOpen ? (
            <div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
              <input
                type="text"
                value={replaceTerm}
                onChange={(event) => setReplaceTerm(event.target.value)}
                placeholder="Replace with"
                aria-label="Replace with"
                className="min-w-[80px] flex-1 bg-transparent text-base placeholder:text-muted-foreground focus:outline-none md:text-sm"
              />
              <button
                type="button"
                aria-label="Replace"
                disabled={searchMatches.length === 0}
                className="rounded-md px-2 py-1 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                onClick={replaceCurrent}
              >
                Replace
              </button>
              <button
                type="button"
                aria-label="Replace all"
                disabled={searchMatches.length === 0}
                className="rounded-md px-2 py-1 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                onClick={replaceAllMatches}
              >
                All
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {hasExternalConflict ? (
        <div
          role="alert"
          data-native-editor-chrome
          className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm"
        >
          <span>
            {saveBlockedByConflict
              ? "This Page changed outside doXmind. Saving — and closing the window — stays blocked until you choose which version to keep."
              : "This Page changed outside doXmind. Saving is paused to protect both versions."}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              title="Replace what is in the editor with the file as it is on disk. Your unsaved edits are lost."
              className="shrink-0 rounded border px-2 py-1 text-xs hover:bg-muted"
              onClick={reloadExternalMarkdown}
            >
              Reload disk version
            </button>
            <button
              type="button"
              title="Write what is in the editor over the file. The change made outside doXmind is lost."
              className="shrink-0 rounded border px-2 py-1 text-xs hover:bg-muted"
              onClick={keepLocalMarkdown}
            >
              Keep my version
            </button>
          </div>
        </div>
      ) : null}
      <div
        ref={scrollElementRef}
        className="min-h-0 flex-1 overflow-y-auto"
        data-native-markdown-scroll
        // The safe area the window chrome eats, declared once for every scroll into this container.
        //
        // The scroll port starts at y=0 and the chrome is painted opaque over the top of it — the
        // title bar occupies 0-44 and the Page controls 44-80 — while the 44px spacer below scrolls
        // away with the text. Every scroll the browser performed on our behalf aligned to the raw
        // port, so a Block reached with the keyboard could land entirely underneath it: measured on
        // a 200-Block Page at 1440x900, a 40-press ArrowUp walk put 4 rows completely behind the
        // chrome and 9 more with their first line inside the opaque band, the worst at [-9.1, 29.9]
        // with 0.0px of a 39.0px row visible. WCAG 2.2 SC 2.4.11 asks for the focused thing to be
        // visible.
        //
        // Declared rather than corrected a frame later, because the browser honours it on the
        // scrolls we never see: the focus() a row does when it activates, and the reflow when the
        // editing surface replaces the preview and the row changes height under an already-settled
        // scroll. A correction that ran in a rAF after the fact left the row behind the chrome for
        // the frame in between — measured, 7 of the same 40 presses, at top 41 and top 2. With this
        // declared, 0 of 40. 84 is the 80px of chrome plus a 4px hairline, so the row's first line
        // is not flush against the controls.
        style={{ scrollPaddingTop: "84px" }}
        onPointerDown={handleDocumentPointerDown}
        onDragOver={handleBlockDragOver}
        onDrop={handleBlockDrop}
      >
        <div aria-hidden data-native-editor-chrome className="h-11 shrink-0" />
        <div
          className={`editor-page-frame relative ${
            lineHeight === "compact"
              ? "editor-leading-compact"
              : lineHeight === "relaxed"
                ? "editor-leading-relaxed"
                : ""
          }`}
          style={pageFrameStyle}
        >
          <div
            ref={documentElementRef}
            className="markdown-page max-w-none focus:outline-none"
            data-native-markdown-document
            data-file-id={file.id}
            // Read by the PDF export guard and by print.css, which must resolve to one Page.
            data-pane-active={isActivePane ? "true" : "false"}
            data-revision={snapshot.revision}
            onCopy={(event) => {
              if (!blockSelection) return;
              const selectedIds = new Set(
                selectedBlockIdsWithSubtrees(snapshot.blocks, blockSelection)
              );
              if (selectedIds.size === 0) return;
              event.clipboardData.setData(
                "text/plain",
                snapshot.blocks
                  .filter((block) => selectedIds.has(block.id))
                  .map((block) => block.raw)
                  .join("")
              );
              event.preventDefault();
            }}
            onCut={(event) => {
              if (!blockSelection) return;
              const blockIds = selectedBlockIdsWithSubtrees(snapshot.blocks, blockSelection);
              if (blockIds.length === 0) return;
              const selectedIds = new Set(blockIds);
              event.clipboardData.setData(
                "text/plain",
                snapshot.blocks
                  .filter((block) => selectedIds.has(block.id))
                  .map((block) => block.raw)
                  .join("")
              );
              event.preventDefault();
              applyBlockSelectionCommand({ type: "deleteBlocks", blockIds });
            }}
            onPaste={(event) => {
              if (!blockSelection) return;
              const markdown = event.clipboardData.getData("text/plain");
              if (!markdown) return;
              const blockIds = selectedBlockIdsWithSubtrees(snapshot.blocks, blockSelection);
              if (blockIds.length === 0) return;
              const lineEnding = preferredSourceLineEnding(snapshot.markdown);
              event.preventDefault();
              apply({
                type: "replaceBlocks",
                blockIds,
                markdown: normalizeEditorLineEndings(markdown).replace(/\n/g, lineEnding),
              });
            }}
          >
            {blockSelectionToolbar ? (
              <BlockSelectionToolbar
                position={blockSelectionToolbar}
                count={blockSelectionToolbar.count}
                onTurnInto={(kind, level) => {
                  const focus = blockSelection?.focusId;
                  if (focus) setBlockKind(focus, kind, level);
                }}
                onCopyMarkdown={() => {
                  const blocks = documentRef.current.getSnapshot().blocks;
                  const ids = new Set(
                    blockSelection ? selectedBlockIdsWithSubtrees(blocks, blockSelection) : []
                  );
                  // Told, not swallowed. The write can be refused outright — the desktop shell hands
                  // the renderer no clipboard permission — and this call site had no rejection
                  // handler, so the button was indistinguishable from a successful copy and the
                  // user's next paste delivered whatever was on the clipboard before.
                  void navigator.clipboard
                    ?.writeText(
                      blocks
                        .filter((block) => ids.has(block.id))
                        .map((block) => block.raw)
                        .join("")
                    )
                    .catch(() => notify.error("Could not copy Markdown"));
                }}
                onDuplicate={() => {
                  const blockIds = blockSelection
                    ? selectedBlockIdsWithSubtrees(
                        documentRef.current.getSnapshot().blocks,
                        blockSelection
                      )
                    : [];
                  if (blockIds.length) {
                    applyBlockSelectionCommand(
                      { type: "duplicateBlocks", blockIds },
                      blockIds.length
                    );
                  }
                }}
                onDelete={() => {
                  const blockIds = blockSelection
                    ? selectedBlockIdsWithSubtrees(
                        documentRef.current.getSnapshot().blocks,
                        blockSelection
                      )
                    : [];
                  if (blockIds.length)
                    applyBlockSelectionCommand({ type: "deleteBlocks", blockIds });
                }}
              />
            ) : null}
            {marqueeRect ? (
              <div
                aria-hidden
                data-native-block-marquee
                style={{
                  position: "fixed",
                  top: marqueeRect.top,
                  left: marqueeRect.left,
                  width: marqueeRect.width,
                  height: marqueeRect.height,
                  background: "rgba(35, 131, 226, 0.08)",
                  border: "1px solid rgba(35, 131, 226, 0.5)",
                  borderRadius: "2px",
                  pointerEvents: "none",
                  zIndex: 40,
                }}
              />
            ) : null}
            <span id={NATIVE_BLOCK_SHORTCUTS_ID} className="sr-only">
              Press Enter to edit. Use Alt plus Arrow keys to move, Mod plus Shift plus D to
              duplicate, and Mod plus Shift plus Backspace to delete.
            </span>
            <span role="status" aria-live="polite" className="sr-only">
              {blockSelectionAnnouncement}
            </span>
            <MarkdownWikiLinkContext.Provider value={wikiLinkServices}>
              {snapshot.blocks.map((block, index) => {
                // Unmounted, not hidden: row spacing is an adjacent-sibling rule, so a
                // `display: none` row would still separate the two rows around it.
                if (hiddenBlocks.has(block.id)) return null;
                const active = activeBlockId === block.id;
                const keyboardEntry = !activeBlockId && !blockSelection && index === 0;
                const blockSelectionFocus = blockSelection?.focusId === block.id;
                return (
                  <MarkdownBlockRow
                    key={block.id}
                    block={block}
                    listOrdinal={listOrdinals.get(block.id)}
                    canMoveUp={index > 0}
                    canMoveDown={index < snapshot.blocks.length - 1}
                    active={active}
                    autoFocusEditor={!isSearchBarOpen}
                    searchHighlight={
                      searchHighlight?.blockId === block.id ? searchHighlight : undefined
                    }
                    keyboardEntry={keyboardEntry}
                    blockSelected={selectedBlockIdSet.has(block.id)}
                    blockSelectionFocus={blockSelectionFocus}
                    selection={
                      pendingSelection?.blockId === block.id ? pendingSelection : undefined
                    }
                    onActivate={handleActivate}
                    onSelectBlock={handleSelectBlock}
                    onBlockSelectionKeyDown={handleBlockSelectionKeyDown}
                    onExtendSelectionToBlock={extendSelectionToBlock}
                    onChange={handleChange}
                    onPaste={handlePaste}
                    onApplyInlineFormat={handleApplyInlineFormat}
                    onEditLink={handleEditLink}
                    onSelectCellRange={handleSelectCellRange}
                    onImportImages={importImages}
                    onCompositionStart={handleCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    onSplit={handleSplit}
                    onMergeBackward={handleMergeBackward}
                    onMergeForward={mergeForward}
                    onSetCodeLanguage={setCodeLanguage}
                    onInsertAfter={handleInsertAfter}
                    onCopyMarkdown={handleCopyBlockMarkdown}
                    onDuplicate={handleDuplicateBlock}
                    onDelete={handleDeleteBlock}
                    onSetTaskChecked={handleSetTaskChecked}
                    onMove={handleMoveBlock}
                    onIndent={handleIndent}
                    foldState={
                      isMarkdownFoldable(snapshot.blocks, index)
                        ? foldedBlockIds.has(block.id)
                          ? "folded"
                          : "unfolded"
                        : "none"
                    }
                    onToggleFold={toggleFold}
                    onSuggestWikiLinks={suggestWikiLinks}
                    onInsertWikiLink={handleInsertWikiLink}
                    onNavigate={navigateBlock}
                    onSetKind={setBlockKind}
                    onUndo={undo}
                    onRedo={redo}
                    onDragStart={startBlockDrag}
                    onDragEnd={clearBlockDrag}
                    onRunSlashCommand={handleRunSlashCommand}
                    wikiEmbedContext={wikiEmbedContext}
                    collectionContext={collectionContext}
                    imageContext={imageContext}
                  />
                );
              })}
            </MarkdownWikiLinkContext.Provider>
            <div
              aria-hidden
              data-native-block-drop-end
              data-drop-active={blockDropBeforeId === null ? "true" : undefined}
              className="h-6"
              onDragOver={(event) => {
                if (!canDropBlock(event.dataTransfer)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setBlockDropBeforeId(null);
              }}
              onDragLeave={() => setBlockDropBeforeId(undefined)}
              onDrop={(event) => {
                if (dropBlockBefore(null, event.dataTransfer)) event.preventDefault();
              }}
            />
          </div>
        </div>
      </div>
      <div
        data-native-editor-chrome
        className="flex h-8 shrink-0 items-center justify-end border-t px-4 text-xs text-muted-foreground"
      >
        {wordCount} {wordCount === 1 ? "word" : "words"}
      </div>
    </div>
  );
}

function countWords(markdown: string): number {
  const text = markdown.replace(/^#{1,6}\s+/gm, "").trim();
  if (!text) return 0;
  const cjk = text.match(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
  );
  const words = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
  const nonCjkWords = words.filter(
    (word) => !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(word)
  );
  return (cjk?.length ?? 0) + nonCjkWords.length;
}

function selectedBlockIds(
  blocks: readonly MarkdownBlockView[],
  selection: { anchorId: string; focusId: string }
): string[] {
  const anchorIndex = blocks.findIndex((block) => block.id === selection.anchorId);
  const focusIndex = blocks.findIndex((block) => block.id === selection.focusId);
  if (anchorIndex < 0 || focusIndex < 0) return [];
  const from = Math.min(anchorIndex, focusIndex);
  const to = Math.max(anchorIndex, focusIndex);
  return blocks.slice(from, to + 1).map((block) => block.id);
}

function selectedBlockIdsWithSubtrees(
  blocks: readonly MarkdownBlockView[],
  selection: { anchorId: string; focusId: string }
): string[] {
  return expandSelectedListSubtrees(blocks, selectedBlockIds(blocks, selection));
}

function expandSelectedListSubtrees(
  blocks: readonly MarkdownBlockView[],
  blockIds: readonly string[]
): string[] {
  const selected = new Set(blockIds);
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!selected.has(block.id) || !isListBlockKind(block.kind)) continue;
    const depth = block.depth ?? 0;
    for (let descendantIndex = index + 1; descendantIndex < blocks.length; descendantIndex += 1) {
      const descendant = blocks[descendantIndex];
      if (!isListBlockKind(descendant.kind) || (descendant.depth ?? 0) <= depth) break;
      selected.add(descendant.id);
    }
  }
  return blocks.filter((block) => selected.has(block.id)).map((block) => block.id);
}

function hierarchySafeBlockMove(
  blocks: readonly MarkdownBlockView[],
  requestedBlockIds: readonly string[],
  direction: -1 | 1
): { blockIds: string[]; beforeId: string | null } | null {
  const blockIds = expandSelectedListSubtrees(blocks, requestedBlockIds);
  if (blockIds.length === 0) return null;

  const firstIndex = blocks.findIndex((block) => block.id === blockIds[0]);
  const lastIndex = firstIndex + blockIds.length - 1;
  if (
    firstIndex < 0 ||
    blockIds.some((blockId, offset) => blocks[firstIndex + offset]?.id !== blockId)
  ) {
    return null;
  }

  const selectedBlocks = blocks.slice(firstIndex, lastIndex + 1);
  const listOnly = selectedBlocks.every((block) => isListBlockKind(block.kind));
  const rootDepth = listOnly ? (selectedBlocks[0].depth ?? 0) : null;
  if (rootDepth !== null && selectedBlocks.some((block) => (block.depth ?? 0) < rootDepth)) {
    return null;
  }

  if (direction < 0) {
    const previousIndex = firstIndex - 1;
    if (previousIndex < 0) return null;
    let previousUnitStart = previousIndex;

    if (rootDepth !== null && rootDepth > 0) {
      while (
        previousUnitStart >= 0 &&
        isListBlockKind(blocks[previousUnitStart].kind) &&
        (blocks[previousUnitStart].depth ?? 0) > rootDepth
      ) {
        previousUnitStart -= 1;
      }
      const previousSibling = blocks[previousUnitStart];
      if (
        !previousSibling ||
        !isListBlockKind(previousSibling.kind) ||
        (previousSibling.depth ?? 0) !== rootDepth
      ) {
        return null;
      }
    } else if (isListBlockKind(blocks[previousUnitStart].kind)) {
      while (
        previousUnitStart > 0 &&
        isListBlockKind(blocks[previousUnitStart - 1].kind) &&
        (blocks[previousUnitStart].depth ?? 0) > 0
      ) {
        previousUnitStart -= 1;
      }
    }

    return { blockIds, beforeId: blocks[previousUnitStart].id };
  }

  const nextIndex = lastIndex + 1;
  const next = blocks[nextIndex];
  if (!next) return null;

  if (rootDepth !== null && rootDepth > 0) {
    if (!isListBlockKind(next.kind) || (next.depth ?? 0) !== rootDepth) return null;
    const nextEnd = listSubtreeEndIndex(blocks, nextIndex);
    return { blockIds, beforeId: blocks[nextEnd]?.id ?? null };
  }

  const nextEnd = isListBlockKind(next.kind)
    ? listSubtreeEndIndex(blocks, nextIndex)
    : nextIndex + 1;
  return { blockIds, beforeId: blocks[nextEnd]?.id ?? null };
}

function listSubtreeEndIndex(blocks: readonly MarkdownBlockView[], rootIndex: number): number {
  const root = blocks[rootIndex];
  if (!root || !isListBlockKind(root.kind)) return rootIndex + 1;
  const rootDepth = root.depth ?? 0;
  let endIndex = rootIndex + 1;
  while (
    endIndex < blocks.length &&
    isListBlockKind(blocks[endIndex].kind) &&
    (blocks[endIndex].depth ?? 0) > rootDepth
  ) {
    endIndex += 1;
  }
  return endIndex;
}

function isListBlockKind(kind: MarkdownBlockView["kind"]): boolean {
  return kind === "bullet_list_item" || kind === "ordered_list_item" || kind === "task_list_item";
}

function sameWorkspacePath(left: string, right: string): boolean {
  return normalizeWorkspacePath(left) === normalizeWorkspacePath(right);
}

function normalizeWorkspacePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").normalize("NFC").toLowerCase();
}

type MarkdownSearchMatch = MarkdownBlockSelectionRange;

function sameBlockSelectionRange(
  left: MarkdownBlockSelectionRange | null | undefined,
  right: MarkdownBlockSelectionRange | null | undefined
): boolean {
  return (
    left !== null &&
    left !== undefined &&
    right !== null &&
    right !== undefined &&
    left.blockId === right.blockId &&
    left.anchor === right.anchor &&
    left.head === right.head
  );
}

/**
 * Offset in `source` nearest the viewport column `caretX` on the first or last visual line of a
 * Block that is currently rendered as a preview. Returns null when the Block is not on screen or
 * the platform cannot hit-test text, in which case the caller falls back to a source edge.
 */
function caretOffsetOnBlockEdge(
  host: HTMLElement | null,
  blockId: string,
  caretX: number,
  edge: "first" | "last",
  source: string
): number | null {
  if (typeof document === "undefined" || typeof CSS === "undefined") return null;
  // Scoped to this Page's own container, like every other lookup here. Block ids are session-local
  // and restart at `block-1` for each document, so a document-wide query would find whichever
  // Page happens to sit first in the DOM once more than one is mounted.
  const row = host?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
  const content = row?.querySelector<HTMLElement>("[data-native-block-content]") ?? null;
  if (!content) return null;
  const range = document.createRange();
  range.selectNodeContents(content);
  const lines = Array.from(range.getClientRects()).filter((line) => line.height > 0);
  const rect = edge === "first" ? lines[0] : lines[lines.length - 1];
  if (!rect) return null;
  const y = rect.top + rect.height / 2;
  const x = Math.min(Math.max(caretX, rect.left + 1), Math.max(rect.right - 1, rect.left + 1));
  return sourceOffsetAtPoint(x, y, content, source, projectMarkdownInline(source));
}

/**
 * A translucent snapshot of the Blocks being dragged, for `setDragImage`.
 *
 * Without one the browser drags the 24px grip button, which tells the user nothing about what they
 * picked up. Multiple Blocks stack with a small offset and a count badge, the way Notion shows a
 * multi-Block drag.
 */
function buildBlockDragGhost(
  host: HTMLElement | null,
  blockIds: readonly string[]
): HTMLElement | null {
  if (!host || typeof document === "undefined" || typeof CSS === "undefined") return null;
  const rows = blockIds
    .map((id) => host.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`))
    .filter((row): row is HTMLElement => row !== null);
  if (rows.length === 0) return null;
  const firstContent = rows[0].querySelector<HTMLElement>("[data-native-block-content]");
  if (!firstContent) return null;

  const ghost = document.createElement("div");
  const width = Math.round(firstContent.getBoundingClientRect().width);
  Object.assign(ghost.style, {
    position: "fixed",
    top: "0",
    left: "-10000px",
    width: `${width}px`,
    opacity: "0.75",
    pointerEvents: "none",
    borderRadius: "6px",
    padding: "4px 8px",
    background: "hsl(var(--background))",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
  } satisfies Partial<CSSStyleDeclaration>);

  for (const [index, row] of rows.slice(0, 3).entries()) {
    const content = row.querySelector<HTMLElement>("[data-native-block-content]");
    if (!content) continue;
    const clone = content.cloneNode(true) as HTMLElement;
    for (const chrome of Array.from(
      clone.querySelectorAll("[data-native-block-controls], .sr-only, [data-code-language]")
    )) {
      chrome.remove();
    }
    clone.style.marginLeft = `${index * 4}px`;
    clone.style.opacity = index === 0 ? "1" : "0.6";
    ghost.append(clone);
  }
  if (rows.length > 1) {
    const badge = document.createElement("div");
    badge.textContent = `${rows.length} blocks`;
    Object.assign(badge.style, {
      marginTop: "4px",
      fontSize: "11px",
      opacity: "0.6",
    } satisfies Partial<CSSStyleDeclaration>);
    ghost.append(badge);
  }
  document.body.append(ghost);
  return ghost;
}

/**
 * Floating actions for a multi-Block selection.
 *
 * A Block selection has no active editor, so the inline formatting toolbar — which is anchored to a
 * text range inside one Block — never appeared for it. Feishu shows a toolbar for a multi-Block
 * selection offering Turn into, Copy, Duplicate and Delete; this is that, using the same chrome as
 * the Notion-measured Block menu.
 */
function BlockSelectionToolbar({
  position,
  count,
  onTurnInto,
  onCopyMarkdown,
  onDuplicate,
  onDelete,
}: {
  position: { top: number; left: number };
  count: number;
  onTurnInto: (kind: MarkdownSettableBlockKind, level?: 1 | 2 | 3 | 4 | 5 | 6) => void;
  onCopyMarkdown: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const action =
    "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors duration-[20ms] ease-in hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
  return (
    <div
      role="toolbar"
      aria-label={`${count} blocks selected`}
      // Rendered inside the Page rather than portalled, so the document's own pointer handler sees
      // the press that operates it. Without the marker every button here was inert: the pointerdown
      // cleared the selection and unmounted the toolbar before its click could arrive.
      data-native-editor-overlay
      style={{
        position: "fixed",
        top: position.top - 8,
        left: position.left,
        transform: "translate(-50%, -100%)",
        zIndex: 50,
      }}
      className="flex h-9 items-center gap-0.5 rounded-[10px] bg-popover p-1 text-popover-foreground shadow-[0_20px_24px_rgba(25,25,25,0.05),0_5px_8px_rgba(25,25,25,0.027),0_0_0_1px_hsl(var(--border))]"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={action}>
            Turn into
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={8}
          aria-label="Turn selected blocks into"
          className="max-h-[min(24rem,calc(100vh-2rem))] w-52 rounded-[10px] border-0 bg-popover p-1.5 shadow-[0_20px_24px_rgba(25,25,25,0.05),0_5px_8px_rgba(25,25,25,0.027),0_0_0_1px_hsl(var(--border))]"
        >
          {TURN_INTO_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={`${option.kind}-${option.level ?? "base"}`}
              aria-label={option.label}
              className="h-7 gap-2.5 rounded-md px-2 transition-colors duration-[20ms] ease-in"
              onClick={() => onTurnInto(option.kind, option.level)}
            >
              <BlockTypeOptionIcon option={option} />
              <span className="min-w-0 flex-1 truncate text-left">{option.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <button type="button" className={action} onClick={onCopyMarkdown}>
        <ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />
        Copy
      </button>
      <button type="button" className={action} onClick={onDuplicate}>
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        Duplicate
      </button>
      <button
        type="button"
        className={`${action} text-destructive`}
        aria-label="Delete selected blocks"
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        Delete
      </button>
    </div>
  );
}

/** Source marker for a settable Block kind, e.g. `"## "` or `"- [ ] "`. */
function settableKindPrefix(
  kind: MarkdownSettableBlockKind,
  level?: 1 | 2 | 3 | 4 | 5 | 6
): string {
  switch (kind) {
    case "heading":
      return `${"#".repeat(level ?? 1)} `;
    case "bullet_list_item":
      return "- ";
    case "ordered_list_item":
      return "1. ";
    case "task_list_item":
      return "- [ ] ";
    case "blockquote":
      return "> ";
    default:
      return "";
  }
}

/**
 * The Block containing 1-based body `line`, or null.
 *
 * Block spans are byte offsets into the same Markdown the line number was counted over, so the
 * mapping is a line-ending count rather than anything the projection has to be asked about.
 */
function markdownBlockIdAtLine(blocks: readonly MarkdownBlockView[], line: number): string | null {
  if (!Number.isFinite(line) || line < 1) return null;
  let current = 1;
  for (const block of blocks) {
    const lines = block.raw.split(/\r\n|\n|\r/).length - 1 || 1;
    if (line < current + lines) return block.id;
    current += lines;
  }
  return blocks.at(-1)?.id ?? null;
}

export interface MarkdownFindOptions {
  caseSensitive: boolean;
  regex: boolean;
}

/**
 * Every match of `searchTerm`, and whether the pattern itself was unusable.
 *
 * `invalid` matters because a regex is typed one character at a time: `/(` is a syntax error on
 * the way to `/(a)/`, and throwing there would take the find bar down mid-keystroke.
 */
function findMarkdownSearchMatches(
  blocks: readonly MarkdownBlockView[],
  searchTerm: string,
  options: MarkdownFindOptions = { caseSensitive: false, regex: false }
): { matches: MarkdownSearchMatch[]; invalid: boolean } {
  const query = normalizeEditorLineEndings(searchTerm);
  if (!query) return { matches: [], invalid: false };

  let pattern: RegExp;
  try {
    pattern = new RegExp(
      options.regex ? query : escapeRegExp(query),
      options.caseSensitive ? "g" : "gi"
    );
  } catch {
    return { matches: [], invalid: true };
  }

  const matches: MarkdownSearchMatch[] = [];
  for (const block of blocks) {
    if (!block.editable) continue;
    const source = normalizeEditorLineEndings(createBlockEditingProjection(block).editorText);
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      // A zero-length match — `/a*/` against `b` — would advance nothing and make Next a no-op
      // that looks like a hang.
      if (match[0].length === 0) continue;
      const anchor = match.index;
      matches.push({ blockId: block.id, anchor, head: anchor + match[0].length });
    }
  }

  return { matches, invalid: false };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Can a slash command's template live inside another Block's line of text?
 *
 * A wiki link and an embed can — they are inline spans, and inserting one mid-sentence is exactly
 * what they are for. A heading marker, a divider, a table, a fence, an image cannot: each one *is* a
 * Block, and splicing it at the caret produced source that no longer means what either half of it
 * said. Read from the template itself rather than from a second list of command ids beside the one
 * in `slash-commands.ts`, so a command added there cannot forget to answer this.
 */
function isInlineSlashTemplate(template: string): boolean {
  if (template.trim().length === 0) return true;
  const blocks = MarkdownBlockDocument.fromMarkdown(template).getSnapshot().blocks;
  return blocks.length === 1 && blocks[0].kind === "paragraph";
}

function markdownPendingKey(fileId: string, markdown: string): string {
  return `${fileId}\u0000${markdown}`;
}

function markdownImageAlt(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

function markdownImageInsertion(
  source: string,
  from: number,
  to: number,
  images: readonly string[],
  lineEnding: "\r\n" | "\n" | "\r"
): string {
  const before = source.slice(0, from);
  const after = source.slice(to);
  const separator = `${lineEnding}${lineEnding}`;
  return `${before.trim() ? separator : ""}${images.join(separator)}${after.trim() ? separator : ""}`;
}

function isPageRevisionConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes("page_revision_conflict");
}

function keyboardEditIntentKey(event: KeyboardEvent): string | null {
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
    return event.key;
  }
  return event.key.length === 1 ? event.key : null;
}

function isEventFromEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('input,textarea,select,[contenteditable="true"]') !== null;
}

/**
 * A key pressed while a control has focus belongs to that control, not to the Page.
 *
 * Edit intent exists for the state where nothing is focused — the caret has been released and the
 * keydown arrives on `window` or `<body>` — so that typing puts the character back into the Page
 * instead of dropping it. It was matching every keydown in the window, so the first key a
 * keyboard-only user pressed after tabbing to any chrome button was swallowed, inserted into
 * Block 1 and autosaved: the button never activated and a Page nobody had opened for editing gained
 * text. A focused control answers its own keys.
 */
function isEventFromFocusedControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest(
      'a[href], button, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="switch"]'
    ) !== null
  );
}

function visibleEditableBlock(
  blocks: readonly MarkdownBlockView[],
  documentElement: HTMLElement | null
): MarkdownBlockView | null {
  const editableBlocks = blocks.filter((block) => block.editable);
  if (editableBlocks.length === 0 || !documentElement) return editableBlocks[0] ?? null;

  const byId = new Map(editableBlocks.map((block) => [block.id, block]));
  const scrollElement = documentElement.closest<HTMLElement>("[data-native-markdown-scroll]");
  const scrollRect = scrollElement?.getBoundingClientRect();
  const targetY = scrollRect
    ? scrollRect.top + Math.min(140, scrollRect.height / 3)
    : documentElement.getBoundingClientRect().top;
  let lastEditable: MarkdownBlockView | null = null;

  for (const row of documentElement.querySelectorAll<HTMLElement>("[data-block-id]")) {
    const block = row.dataset.blockId ? byId.get(row.dataset.blockId) : undefined;
    if (!block) continue;
    lastEditable = block;
    if (row.getBoundingClientRect().bottom >= targetY) return block;
  }

  return lastEditable ?? editableBlocks[0] ?? null;
}

/**
 * Textareas expose every line ending as LF. Map their smallest changed range
 * back to the original source so an edit on one line cannot normalize the
 * untouched CRLF (or CR) lines in that block.
 */
function minimalEditorPatch(
  currentSource: string,
  nextEditorSource: string,
  lineEnding: "\r\n" | "\n" | "\r"
): { from: number; to: number; text: string } | null {
  const currentEditorSource = normalizeEditorLineEndings(currentSource);
  const nextSource = normalizeEditorLineEndings(nextEditorSource);
  if (currentEditorSource === nextSource) return null;

  let prefix = 0;
  const prefixLimit = Math.min(currentEditorSource.length, nextSource.length);
  while (prefix < prefixLimit && currentEditorSource[prefix] === nextSource[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < currentEditorSource.length - prefix &&
    suffix < nextSource.length - prefix &&
    currentEditorSource[currentEditorSource.length - suffix - 1] ===
      nextSource[nextSource.length - suffix - 1]
  ) {
    suffix += 1;
  }

  const from = sourceOffsetForEditorOffset(currentSource, prefix);
  const to = sourceOffsetForEditorOffset(currentSource, currentEditorSource.length - suffix);
  const inserted = nextSource.slice(prefix, nextSource.length - suffix);
  return {
    from,
    to,
    text: inserted.replace(/\n/g, lineEnding),
  };
}

function preferredSourceLineEnding(...sources: string[]): "\r\n" | "\n" | "\r" {
  for (const source of sources) {
    const match = source.match(/\r\n|\n|\r/);
    if (match) return match[0] as "\r\n" | "\n" | "\r";
  }
  return "\n";
}

function normalizeEditorLineEndings(source: string): string {
  return source.replace(/\r\n|\r/g, "\n");
}

/**
 * Which Block holds the caret after a history step.
 *
 * History stores Blocks, not a selection, so the active id can simply be absent from the state it
 * restores: `split`, `insertAfter` and `duplicate` mint an id for the Block they create, and taking
 * any of them back takes that id away again. Falling back to the Page's first Block threw the caret
 * — and, because the row focuses its editor, the viewport — to the top of the document from wherever
 * the user was working.
 *
 * The Block to land on is the one the undone command grew out of, and every command that mints an id
 * puts the new Block immediately *after* its origin. So it is the neighbour before the vanished
 * Block, not the one that slid into its index: taking that index gave the Block *following* the
 * origin, which is how undoing a duplicate of the first Block left the caret on the second and the
 * next keyboard command deleted the wrong Block.
 *
 * With no caret at all — the state every Block-selection command leaves behind — the step is read
 * from the Blocks themselves instead. Falling straight through to the first Block of the Page put
 * the caret, and with it the viewport, at the top of the document after undoing a delete forty
 * Blocks down: the restored content was off screen and the next keystroke appended to a Block the
 * user had never touched. Content the step brought back, or the first Block it reordered, is where
 * the user was working.
 */
function activeBlockIdAfterHistory(
  current: string | null,
  before: readonly MarkdownBlockView[],
  after: readonly MarkdownBlockView[]
): string | null {
  if (!current) {
    const beforeIds = new Set(before.map((block) => block.id));
    const restored = after.find((block) => !beforeIds.has(block.id));
    if (restored) return restored.id;
    // Same Blocks, different order: a reorder taken back. Only when the counts match, so undoing a
    // duplicate — where the first differing index is the Block *after* the copies — still lands on
    // the Block the copies were made from.
    if (before.length === after.length) {
      const reordered = after.find((block, index) => before[index]?.id !== block.id);
      if (reordered) return reordered.id;
    }
    return after[0]?.id ?? null;
  }
  if (after.some((block) => block.id === current)) return current;
  const index = before.findIndex((block) => block.id === current);
  if (index < 0) return after[0]?.id ?? null;
  return after[Math.min(Math.max(index - 1, 0), after.length - 1)]?.id ?? null;
}

function blockSourceOffsetForEditorOffset(block: MarkdownBlockView, editorOffset: number): number {
  const projection = createBlockEditingProjection(block);
  return projection.editorOffsetToSource(
    sourceOffsetForEditorOffset(projection.editorText, editorOffset)
  );
}

function editorOffsetForBlockSourceOffset(block: MarkdownBlockView, sourceOffset: number): number {
  const projection = createBlockEditingProjection(block);
  return editorOffsetForSourceOffset(
    projection.editorText,
    projection.sourceOffsetToEditor(sourceOffset)
  );
}

function sourceOffsetForEditorOffset(source: string, editorOffset: number): number {
  let sourceOffset = 0;
  let normalizedOffset = 0;
  while (sourceOffset < source.length && normalizedOffset < editorOffset) {
    if (source[sourceOffset] === "\r" && source[sourceOffset + 1] === "\n") {
      sourceOffset += 2;
    } else {
      sourceOffset += 1;
    }
    normalizedOffset += 1;
  }
  return sourceOffset;
}

function editorOffsetForSourceOffset(source: string, sourceOffset: number): number {
  return normalizeEditorLineEndings(source.slice(0, sourceOffset)).length;
}
