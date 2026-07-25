"use client";

import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  MarkdownBlockDocument,
  type MarkdownBlockApplyResult,
  type MarkdownBlockCommand,
  type MarkdownBlockView,
} from "@/editor/markdown-block/markdown-block-document";
import {
  createBlockEditingProjection,
  splitDelimitedBlockSource,
} from "@/editor/markdown-block/block-editing-projection";
import { createMarkdownInlineFormatEdit } from "@/editor/markdown-block/markdown-inline-format";
import { editableMarkdownBlockSource } from "@/editor/markdown-block/markdown-block-source";
import {
  MarkdownBlockRow,
  sourceOffsetAtPoint,
  type MarkdownCollectionContext,
  type MarkdownImageContext,
  type MarkdownWikiEmbedContext,
} from "@/editor/markdown-block/markdown-block-row";
import { projectMarkdownInline } from "@/editor/markdown-block/markdown-inline-projection";
import { parseWikiEmbedBlock, wikiEmbedIdentity } from "@/editor/markdown-block/wiki-embed";
import {
  markdownSlashCommandCaret,
  markdownSlashCommandSource,
  type MarkdownSlashCommandId,
} from "@/editor/markdown-block/slash-commands";
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
import { debounce } from "@/lib/utils";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useEditorStore } from "@/stores/editor-store";
import { TRANSIENT_ID_PREFIX, useFileStore, type FileItem } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { usePageSessionStore, type PageOutlineItem } from "@/stores/page-session-store";
import { projectWorkspacePageProperties } from "@/lib/workspace-page-catalog";

interface MarkdownBlockRuntimeProps {
  file: FileItem;
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
}

const defaultTransclusionServices: MarkdownTransclusionServices = {
  rebuild: async (root) => buildKnowledgeSourceCatalog(createStorageAdapter({ disk: { root } })),
};

const defaultImageServices: MarkdownImageServices = {
  read: async (root, path) => createStorageAdapter({ disk: { root } }).readAsset(path),
  import: async (root, input) => createStorageAdapter({ disk: { root } }).importAsset(input),
};

const NATIVE_BLOCK_DRAG_MIME = "application/x-doxmind-markdown-block";

/**
 * Native source-backed Page editor.
 *
 * The DOM is only an input/view Adapter. Every operation is applied to the
 * canonical Markdown string held by `MarkdownBlockDocument`, and autosave
 * crosses the storage boundary as Markdown only.
 */
export function MarkdownBlockRuntime({
  file,
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
  const setSearchBarOpen = useLayoutStore((state) => state.setSearchBarOpen);
  const setDirty = useEditorStore((state) => state.setDirty);
  const setSaving = useEditorStore((state) => state.setSaving);
  const setLastSavedAt = useEditorStore((state) => state.setLastSavedAt);
  const setRequestSave = useEditorRefStore((state) => state.setRequestSave);
  const setRequestUndo = useEditorRefStore((state) => state.setRequestUndo);
  const setRequestRedo = useEditorRefStore((state) => state.setRequestRedo);
  const setDiscardPendingChanges = useEditorRefStore((state) => state.setDiscardPendingChanges);
  const publishOutline = usePageSessionStore((state) => state.publishOutline);
  const clearOutline = usePageSessionStore((state) => state.clearOutline);

  const initialMarkdown = file.content;
  const documentRef = useRef(MarkdownBlockDocument.fromMarkdown(initialMarkdown));
  const [snapshot, setSnapshot] = useState(documentRef.current.getSnapshot());
  const [activeBlockId, setActiveBlockId] = useState<string | null>(
    file.id.startsWith(TRANSIENT_ID_PREFIX) ? (snapshot.blocks[0]?.id ?? null) : null
  );
  const [blockSelection, setBlockSelection] = useState<{
    anchorId: string;
    focusId: string;
  } | null>(null);
  const [blockDropBeforeId, setBlockDropBeforeId] = useState<string | null | undefined>(undefined);
  const [pendingSelection, setPendingSelection] = useState<MarkdownBlockSelectionRange | null>(
    null
  );
  const [hasExternalConflict, setHasExternalConflict] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
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
   */
  const dragBoundariesRef = useRef<{ beforeId: string | null; y: number; depth: number }[]>([]);
  const dropTargetRef = useRef<{ beforeId: string | null } | null>(null);
  const dragAutoScrollRef = useRef<{ frame: number | null; clientY: number }>({
    frame: null,
    clientY: 0,
  });
  const dragGhostRef = useRef<HTMLElement | null>(null);
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
  const effectiveTransclusionIndex = useMemo(() => {
    const index = effectiveTransclusionState.index;
    if (!index) return null;
    return {
      ...index,
      sourcePages: index.sourcePages.map((page) =>
        page.id === file.id || sameWorkspacePath(page.path, pagePath)
          ? { ...page, markdown: snapshot.markdown }
          : page
      ),
      catalogPages: index.catalogPages?.map((page) =>
        page.id === file.id || sameWorkspacePath(page.path, pagePath)
          ? {
              ...page,
              markdown: snapshot.markdown,
              properties: projectWorkspacePageProperties(file.meta),
            }
          : page
      ),
    };
  }, [effectiveTransclusionState.index, file.id, file.meta, pagePath, snapshot.markdown]);
  const openIndexedPage = useCallback(
    (pageId: string) => {
      const target = effectiveTransclusionIndex?.sourcePages.find((page) => page.id === pageId);
      if (target) {
        void navigateToWorkspacePage(pageId, target.path);
      } else {
        void navigateToEditorFile(pageId);
      }
    },
    [effectiveTransclusionIndex?.sourcePages]
  );
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
      pages: effectiveTransclusionIndex?.catalogPages ?? null,
      onOpenPage: openIndexedPage,
    };
  }, [
    effectiveTransclusionIndex?.catalogPages,
    effectiveTransclusionState.status,
    hasCollections,
    openIndexedPage,
  ]);
  const imageContext = useMemo<MarkdownImageContext | undefined>(() => {
    if (!hasLocalImages && !hasWikiEmbeds) return undefined;
    return {
      pagePath,
      readAsset: (path) => imageServices.read(rootPath, path),
    };
  }, [hasLocalImages, hasWikiEmbeds, imageServices, pagePath, rootPath]);

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

  const searchMatches = useMemo(
    () => findMarkdownSearchMatches(snapshot.blocks, searchTerm),
    [searchTerm, snapshot.blocks]
  );
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
      element?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    },
    [file.id]
  );

  useEffect(() => {
    // The document projection is reset in a later effect on Page switches.
    // Do not relabel the previous Page's headings with the new Page id during
    // that intervening commit.
    if (fileIdRef.current !== file.id) return;
    publishOutline({
      pageId: file.id,
      headings: outlineHeadings,
      activeId: outlineHeadings.some((heading) => heading.id === activeBlockId)
        ? activeBlockId
        : null,
      navigateTo: navigateToOutline,
    });
  }, [activeBlockId, file.id, navigateToOutline, outlineHeadings, publishOutline]);

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
      if (isEventFromEditableElement(event.target)) return;
      const key = keyboardEditIntentKey(event);
      if (key === null) return;

      const current = documentRef.current.getSnapshot();
      const block = visibleEditableBlock(current.blocks, documentElementRef.current);
      if (!block) return;

      event.preventDefault();
      const source = editableMarkdownBlockSource(block.raw);
      if (key.length === 1) {
        apply({
          type: "replaceText",
          blockId: block.id,
          range: { from: source.length, to: source.length },
          text: key,
        });
        return;
      }

      const editorSource = normalizeEditorLineEndings(
        createBlockEditingProjection(block).editorText
      );
      setActiveBlockId(block.id);
      setPendingSelection({
        blockId: block.id,
        anchor: editorSource.length,
        head: editorSource.length,
      });
    };

    window.addEventListener("keydown", handleEditIntent);
    return () => window.removeEventListener("keydown", handleEditIntent);
  }, [activeBlockId, apply, blockSelection, isSearchBarOpen]);

  const undo = useCallback(() => {
    const next = documentRef.current.undo();
    setSnapshot(next);
    setBlockSelection(null);
    setBlockDropBeforeId(undefined);
    setActiveBlockId((current) =>
      current && next.blocks.some((block) => block.id === current)
        ? current
        : (next.blocks[0]?.id ?? null)
    );
    setPendingSelection(null);
    setDirty(next.markdown !== lastSavedMarkdownRef.current);
    scheduleAutosave(next.markdown);
  }, [scheduleAutosave, setDirty]);

  const redo = useCallback(() => {
    const next = documentRef.current.redo();
    setSnapshot(next);
    setBlockSelection(null);
    setBlockDropBeforeId(undefined);
    setActiveBlockId((current) =>
      current && next.blocks.some((block) => block.id === current)
        ? current
        : (next.blocks[0]?.id ?? null)
    );
    setPendingSelection(null);
    setDirty(next.markdown !== lastSavedMarkdownRef.current);
    scheduleAutosave(next.markdown);
  }, [scheduleAutosave, setDirty]);

  const saveCurrentNow = useCallback(async () => {
    debouncedSave.cancel();
    return persistMarkdown(documentRef.current.getSnapshot().markdown, { explicit: true });
  }, [debouncedSave, persistMarkdown]);

  const discardPendingChanges = useCallback(() => {
    discardRequestedRef.current = true;
    debouncedSave.cancel();
    conflictGenerationRef.current += 1;
    sessionGenerationRef.current += 1;
    setDirty(false);
  }, [debouncedSave, setDirty]);

  useEffect(() => {
    setRequestSave(saveCurrentNow);
    setRequestUndo(undo);
    setRequestRedo(redo);
    setDiscardPendingChanges(discardPendingChanges);
    return () => {
      setRequestSave(null);
      setRequestUndo(null);
      setRequestRedo(null);
      setDiscardPendingChanges(null);
    };
  }, [
    discardPendingChanges,
    redo,
    saveCurrentNow,
    setDiscardPendingChanges,
    setRequestRedo,
    setRequestSave,
    setRequestUndo,
    undo,
  ]);

  useEffect(() => {
    const handleSave = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveCurrentNow().catch(() => undefined);
      }
    };
    window.addEventListener("keydown", handleSave);
    return () => window.removeEventListener("keydown", handleSave);
  }, [saveCurrentNow]);

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
    (blockId: string, direction: -1 | 1, caretX?: number): boolean => {
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
      // Horizontal crossings pass no x and land on the Block's source edge.
      const goalOffset =
        caretX === undefined
          ? null
          : caretOffsetOnBlockEdge(target.id, caretX, direction < 0 ? "last" : "first", source);
      const offset = goalOffset ?? (direction < 0 ? source.length : 0);
      setActiveBlockId(target.id);
      setPendingSelection({ blockId: target.id, anchor: offset, head: offset });
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
      // An info string cannot carry whitespace or fence characters without changing what the line
      // means, so normalise rather than trust the field.
      const next = language.trim().replace(/[\s`~]+/g, "");
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
   * Clicks that land on the Page but not on a Block.
   *
   * Notion and Feishu both treat the empty space below the last Block as a click-to-append target,
   * and both clear a stale Block selection when you click away. Without either, a click in the
   * margin left the selection highlighted and the keyboard dead.
   */
  const handleDocumentPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-block-id]")) return;
      setBlockSelection(null);
      const blocks = documentRef.current.getSnapshot().blocks;
      const last = blocks[blocks.length - 1];
      if (!last) return;
      const lastRow = event.currentTarget.querySelector<HTMLElement>(
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
        const currentSelection = blockSelection ?? { anchorId: blockId, focusId: blockId };
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
        const currentSelection = blockSelection ?? { anchorId: blockId, focusId: blockId };
        const blockIds = selectedBlockIdsWithSubtrees(
          documentRef.current.getSnapshot().blocks,
          currentSelection
        );
        if (blockIds.length === 0) return;
        event.preventDefault();
        applyBlockSelectionCommand({ type: "duplicateBlocks", blockIds }, blockIds.length);
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        !event.altKey &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        const blocks = documentRef.current.getSnapshot().blocks;
        const currentSelection = blockSelection ?? { anchorId: blockId, focusId: blockId };
        const blockIds = selectedBlockIdsWithSubtrees(blocks, currentSelection);
        const move = hierarchySafeBlockMove(blocks, blockIds, event.key === "ArrowUp" ? -1 : 1);
        if (!move) return;
        event.preventDefault();
        applyBlockSelectionCommand({ type: "moveBlocks", ...move }, move.blockIds.length);
        return;
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        const currentSelection = blockSelection ?? { anchorId: blockId, focusId: blockId };
        const blockIds = selectedBlockIdsWithSubtrees(
          documentRef.current.getSnapshot().blocks,
          currentSelection
        );
        if (blockIds.length === 0) return;
        event.preventDefault();
        applyBlockSelectionCommand({ type: "deleteBlocks", blockIds });
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
    [applyBlockSelectionCommand, blockSelection, redo, undo]
  );

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
    const rows = Array.from(host.querySelectorAll<HTMLElement>("[data-native-block-row]"));
    const table: { beforeId: string | null; y: number; depth: number }[] = [];
    for (const row of rows) {
      const id = row.dataset.blockId ?? null;
      if (!id) continue;
      table.push({
        beforeId: id,
        y: row.getBoundingClientRect().top,
        depth: Number(row.dataset.blockDepth ?? 0),
      });
    }
    const last = rows[rows.length - 1];
    if (last) {
      table.push({
        beforeId: null,
        y: last.getBoundingClientRect().bottom,
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
   * somewhere already on screen. Speed ramps with proximity, from ~240px/s at the threshold to
   * ~1440px/s at the very edge, which is what makes a long reorder feel controllable.
   */
  const startDragAutoScroll = useCallback(() => {
    const state = dragAutoScrollRef.current;
    if (state.frame !== null) return;
    const step = () => {
      const scroller = scrollElementRef.current;
      if (!scroller || !dragSessionRef.current) {
        state.frame = null;
        return;
      }
      const rect = scroller.getBoundingClientRect();
      const threshold = 72;
      const fromTop = state.clientY - rect.top;
      const fromBottom = rect.bottom - state.clientY;
      let delta = 0;
      if (fromTop < threshold) delta = -(4 + 20 * (1 - Math.max(fromTop, 0) / threshold));
      else if (fromBottom < threshold) delta = 4 + 20 * (1 - Math.max(fromBottom, 0) / threshold);
      if (delta !== 0) {
        scroller.scrollTop += Math.round(delta);
        rebuildDragBoundaries();
      }
      state.frame = window.requestAnimationFrame(step);
    };
    state.frame = window.requestAnimationFrame(step);
  }, [rebuildDragBoundaries]);

  const startBlockDrag = useCallback(
    (blockId: string, event: DragEvent<HTMLButtonElement>) => {
      const blocks = documentRef.current.getSnapshot().blocks;
      const selectedIds = blockSelection
        ? selectedBlockIdsWithSubtrees(blocks, blockSelection)
        : [];
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
      startDragAutoScroll();
    },
    [blockSelection, file.id, rebuildDragBoundaries, startDragAutoScroll]
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
    let best = table[0];
    for (const boundary of table) {
      if (Math.abs(clientY - boundary.y) < Math.abs(clientY - best.y)) best = boundary;
    }
    // Far from every boundary the intent is ambiguous, so show nothing rather than guess.
    return Math.abs(clientY - best.y) > 160 ? null : best;
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

  const pageFrameStyle = {
    "--editor-outline-gutter": `${reservedRightInset}px`,
  } as CSSProperties;
  const wordCount = countWords(snapshot.markdown);
  const currentSearchMatch = searchMatches[currentSearchIndex];
  const searchSelectionBlockId =
    isSearchBarOpen &&
    currentSearchMatch &&
    sameBlockSelectionRange(pendingSelection, currentSearchMatch)
      ? currentSearchMatch.blockId
      : null;

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

  const moveSearchResult = (direction: -1 | 1) => {
    setCurrentSearchIndex((index) =>
      searchMatches.length === 0
        ? 0
        : (index + direction + searchMatches.length) % searchMatches.length
    );
  };

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      data-testid="markdown-block-runtime"
      data-native-markdown-runtime
    >
      {isSearchBarOpen ? (
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
                ? searchMatches.length > 0
                  ? `${currentSearchIndex + 1} of ${searchMatches.length}`
                  : "No matches"
                : null}
            </span>
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
        </div>
      ) : null}
      {hasExternalConflict ? (
        <div
          role="alert"
          data-native-editor-chrome
          className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm"
        >
          <span>This Page changed outside doXmind. Saving is paused to protect both versions.</span>
          <button
            type="button"
            className="shrink-0 rounded border px-2 py-1 text-xs hover:bg-muted"
            onClick={reloadExternalMarkdown}
          >
            Reload disk version
          </button>
        </div>
      ) : null}
      <div
        ref={scrollElementRef}
        className="min-h-0 flex-1 overflow-y-auto"
        data-native-markdown-scroll
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
            data-revision={snapshot.revision}
            onPointerDown={handleDocumentPointerDown}
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
            {snapshot.blocks.map((block, index) => (
              <MarkdownBlockRow
                key={block.id}
                block={block}
                index={index}
                count={snapshot.blocks.length}
                active={activeBlockId === block.id}
                autoFocusEditor={!isSearchBarOpen}
                highlightSelection={searchSelectionBlockId === block.id}
                keyboardEntry={!activeBlockId && !blockSelection && index === 0}
                blockSelected={selectedBlockIdSet.has(block.id)}
                blockSelectionFocus={blockSelection?.focusId === block.id}
                selection={pendingSelection?.blockId === block.id ? pendingSelection : undefined}
                onActivate={(blockId, clickedSelection) => {
                  if (isSearchBarOpen) setSearchBarOpen(false);
                  setActiveBlockId(blockId);
                  setBlockSelection(null);
                  setPendingSelection(clickedSelection ? { blockId, ...clickedSelection } : null);
                }}
                onSelectBlock={(blockId, extend = false) => {
                  setActiveBlockId(null);
                  setPendingSelection(null);
                  setBlockSelection((current) => {
                    if (extend && current) {
                      return { anchorId: current.anchorId, focusId: blockId };
                    }
                    if (
                      current &&
                      selectedBlockIdsWithSubtrees(snapshot.blocks, current).includes(blockId)
                    ) {
                      return current;
                    }
                    return { anchorId: blockId, focusId: blockId };
                  });
                }}
                onBlockSelectionKeyDown={handleBlockSelectionKeyDown}
                onChange={(blockId, source) => {
                  const current = documentRef.current
                    .getSnapshot()
                    .blocks.find((candidate) => candidate.id === blockId);
                  if (!current) return;
                  const currentSource = editableMarkdownBlockSource(current.raw);
                  const projection = createBlockEditingProjection(current);
                  const nextSource = editableMarkdownBlockSource(projection.toSource(source));
                  const patch = minimalEditorPatch(
                    currentSource,
                    nextSource,
                    preferredSourceLineEnding(current.raw, snapshot.markdown)
                  );
                  if (!patch) return;
                  const composing = composingBlockIdRef.current === blockId;
                  apply(
                    {
                      type: "replaceText",
                      blockId,
                      range: { from: patch.from, to: patch.to },
                      text: patch.text,
                      recordHistory: !composing || !compositionHasHistoryRef.current,
                    },
                    false
                  );
                  if (composing) compositionHasHistoryRef.current = true;
                  else scheduleTypingCheckpoint();
                }}
                onPaste={(blockId, from, to, text) => {
                  const current = documentRef.current
                    .getSnapshot()
                    .blocks.find((candidate) => candidate.id === blockId);
                  if (!current) return;
                  const lineEnding = preferredSourceLineEnding(current.raw, snapshot.markdown);
                  apply({
                    type: "replaceText",
                    blockId,
                    range: {
                      from: blockSourceOffsetForEditorOffset(current, from),
                      to: blockSourceOffsetForEditorOffset(current, to),
                    },
                    text: normalizeEditorLineEndings(text).replace(/\n/g, lineEnding),
                  });
                }}
                onApplyInlineFormat={(blockId, from, to, format) => {
                  const current = documentRef.current
                    .getSnapshot()
                    .blocks.find((candidate) => candidate.id === blockId);
                  if (!current) return;
                  const editorSource = normalizeEditorLineEndings(
                    createBlockEditingProjection(current).editorText
                  );
                  const edit = createMarkdownInlineFormatEdit(editorSource, from, to, format);
                  if (!edit) return;
                  const lineEnding = preferredSourceLineEnding(current.raw, snapshot.markdown);
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
                }}
                onImportImages={importImages}
                onCompositionStart={(blockId) => {
                  composingBlockIdRef.current = blockId;
                  compositionHasHistoryRef.current = false;
                  // A composition is one authored unit: end the surrounding typing run so undo
                  // takes back the whole committed word rather than half of it plus a few Latin
                  // characters typed before the IME opened.
                  documentRef.current.flushHistory();
                  debouncedSave.cancel();
                }}
                onCompositionEnd={(blockId) => {
                  if (composingBlockIdRef.current !== blockId) return;
                  composingBlockIdRef.current = null;
                  compositionHasHistoryRef.current = false;
                  documentRef.current.flushHistory();
                  scheduleAutosave(documentRef.current.getSnapshot().markdown);
                }}
                onSplit={(blockId, from, to) => {
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
                }}
                onMergeBackward={(blockId) => apply({ type: "mergeBackward", blockId })}
                onMergeForward={mergeForward}
                onSetCodeLanguage={setCodeLanguage}
                onInsertAfter={(blockId, placement) =>
                  apply({ type: "insertAfter", blockId, before: placement === "above" })
                }
                onCopyMarkdown={async (blockId) => {
                  const current = documentRef.current.getSnapshot();
                  const selectionIds = blockSelection
                    ? selectedBlockIdsWithSubtrees(current.blocks, blockSelection)
                    : [];
                  const selectedIds = expandSelectedListSubtrees(
                    current.blocks,
                    selectionIds.includes(blockId) ? selectionIds : [blockId]
                  );
                  const selectedSet = new Set(selectedIds);
                  const markdown = current.blocks
                    .filter((candidate) => selectedSet.has(candidate.id))
                    .map((candidate) => candidate.raw)
                    .join("");
                  try {
                    await navigator.clipboard.writeText(markdown);
                  } catch {
                    notify.error("Could not copy Markdown");
                  }
                }}
                onDuplicate={(blockId) => {
                  const current = documentRef.current.getSnapshot();
                  const selectedIds = blockSelection
                    ? selectedBlockIdsWithSubtrees(current.blocks, blockSelection)
                    : [];
                  if (selectedIds.includes(blockId)) {
                    applyBlockSelectionCommand(
                      { type: "duplicateBlocks", blockIds: selectedIds },
                      selectedIds.length
                    );
                    return;
                  }
                  apply({ type: "duplicate", blockId });
                }}
                onDelete={(blockId) => {
                  const current = documentRef.current.getSnapshot();
                  const selectedIds = blockSelection
                    ? selectedBlockIdsWithSubtrees(current.blocks, blockSelection)
                    : [];
                  if (selectedIds.includes(blockId)) {
                    applyBlockSelectionCommand({ type: "deleteBlocks", blockIds: selectedIds });
                    return;
                  }
                  apply({ type: "delete", blockId });
                }}
                onSetTaskChecked={(blockId, checked) =>
                  apply({ type: "setTaskChecked", blockId, checked }, false)
                }
                onMove={(blockId, direction) => {
                  const blocks = documentRef.current.getSnapshot().blocks;
                  const selectedIds = blockSelection
                    ? selectedBlockIdsWithSubtrees(blocks, blockSelection)
                    : [];
                  if (!selectedIds.includes(blockId)) return moveBlock(blockId, direction);
                  const move = hierarchySafeBlockMove(blocks, selectedIds, direction);
                  if (!move) return false;
                  applyBlockSelectionCommand({ type: "moveBlocks", ...move }, move.blockIds.length);
                  return true;
                }}
                onIndent={(blockId, direction, selection) => {
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
                }}
                onNavigate={navigateBlock}
                onSetKind={(blockId, kind, level) =>
                  apply({ type: "setKind", blockId, kind, level })
                }
                onUndo={undo}
                onRedo={redo}
                onDragStart={startBlockDrag}
                onDragEnd={clearBlockDrag}
                onOpenWikiLink={(target) => {
                  const destination = resolveWikiLinkTarget(
                    useFileStore.getState().files,
                    file.id,
                    target
                  );
                  if (destination) void navigateToEditorFile(destination.id);
                }}
                onRunSlashCommand={(blockId, commandId: MarkdownSlashCommandId, run) => {
                  const current = documentRef.current
                    .getSnapshot()
                    .blocks.find((candidate) => candidate.id === blockId);
                  if (!current) return;
                  const lineEnding = preferredSourceLineEnding(current.raw, snapshot.markdown);
                  const template = markdownSlashCommandSource(commandId, lineEnding);
                  // Replace only the `/query` the user typed, mapped from editor offsets to source
                  // offsets. Overwriting the whole Block discarded any text typed before the
                  // trigger, which is why `/` used to be usable only on an otherwise empty Block.
                  const from = blockSourceOffsetForEditorOffset(current, run.start);
                  const to = blockSourceOffsetForEditorOffset(current, run.end);
                  const result = documentRef.current.apply({
                    type: "replaceText",
                    blockId,
                    range: { from, to },
                    text: template,
                  });
                  publish(result, false);
                  // Land the caret inside the template — on a code fence's body line, in a table's
                  // first cell — instead of after its closing delimiter.
                  const caret = from + markdownSlashCommandCaret(commandId, lineEnding);
                  const insertedBlock = result.snapshot.blocks.find(
                    (candidate) => candidate.from <= caret && caret <= candidate.to
                  );
                  const targetBlock =
                    insertedBlock ??
                    result.snapshot.blocks.find((candidate) => candidate.id === blockId);
                  if (!targetBlock) return;
                  const offset = editorOffsetForBlockSourceOffset(
                    targetBlock,
                    caret - targetBlock.from
                  );
                  setActiveBlockId(targetBlock.id);
                  setBlockSelection(null);
                  setPendingSelection({ blockId: targetBlock.id, anchor: offset, head: offset });
                }}
                wikiEmbedContext={wikiEmbedContext}
                collectionContext={collectionContext}
                imageContext={imageContext}
              />
            ))}
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
  blockId: string,
  caretX: number,
  edge: "first" | "last",
  source: string
): number | null {
  if (typeof document === "undefined" || typeof CSS === "undefined") return null;
  const row = document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
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

function findMarkdownSearchMatches(
  blocks: readonly MarkdownBlockView[],
  searchTerm: string
): MarkdownSearchMatch[] {
  const query = normalizeEditorLineEndings(searchTerm);
  if (!query) return [];
  const pattern = new RegExp(escapeRegExp(query), "gi");
  const matches: MarkdownSearchMatch[] = [];

  for (const block of blocks) {
    if (!block.editable) continue;
    const source = normalizeEditorLineEndings(createBlockEditingProjection(block).editorText);
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const anchor = match.index;
      matches.push({
        blockId: block.id,
        anchor,
        head: anchor + match[0].length,
      });
    }
  }

  return matches;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
