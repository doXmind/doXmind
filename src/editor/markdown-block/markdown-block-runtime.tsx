"use client";

import {
  type CSSProperties,
  type DragEvent,
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
import { editableMarkdownBlockSource } from "@/editor/markdown-block/markdown-block-source";
import {
  MarkdownBlockRow,
  type MarkdownCollectionContext,
  type MarkdownImageContext,
  type MarkdownWikiEmbedContext,
} from "@/editor/markdown-block/markdown-block-row";
import { parseWikiEmbedBlock, wikiEmbedIdentity } from "@/editor/markdown-block/wiki-embed";
import {
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
  const [pendingSelection, setPendingSelection] = useState<{
    blockId: string;
    anchor: number;
    head: number;
  } | null>(null);
  const [hasExternalConflict, setHasExternalConflict] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const documentElementRef = useRef<HTMLDivElement>(null);
  const dragSessionRef = useRef<{ pageId: string; blockId: string; token: string } | null>(null);
  const dragSessionCounterRef = useRef(0);
  const composingBlockIdRef = useRef<string | null>(null);
  const compositionHasHistoryRef = useRef(false);
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
    if (!isSearchBarOpen || searchMatches.length === 0) {
      if (currentSearchIndex !== 0) setCurrentSearchIndex(0);
      return;
    }
    if (currentSearchIndex >= searchMatches.length) {
      setCurrentSearchIndex(0);
      return;
    }

    const match = searchMatches[currentSearchIndex];
    setActiveBlockId(match.blockId);
    setPendingSelection({
      blockId: match.blockId,
      anchor: match.anchor,
      head: match.head,
    });
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

  const publish = useCallback(
    (result: MarkdownBlockApplyResult, applySelection = true) => {
      setSnapshot(result.snapshot);
      if (applySelection && result.selection) {
        const selectedBlock = result.snapshot.blocks.find(
          (block) => block.id === result.selection?.blockId
        );
        const selectedSource = selectedBlock ? editableMarkdownBlockSource(selectedBlock.raw) : "";
        setActiveBlockId(result.selection.blockId);
        setPendingSelection({
          blockId: result.selection.blockId,
          anchor: editorOffsetForSourceOffset(selectedSource, result.selection.anchor),
          head: editorOffsetForSourceOffset(selectedSource, result.selection.head),
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
        const initialFrom = sourceOffsetForEditorOffset(initialSource, from);
        const initialTo = sourceOffsetForEditorOffset(initialSource, to);
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
    if (activeBlockId !== null || isSearchBarOpen) return;

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

      setActiveBlockId(block.id);
      setPendingSelection({
        blockId: block.id,
        anchor: source.length,
        head: source.length,
      });
    };

    window.addEventListener("keydown", handleEditIntent);
    return () => window.removeEventListener("keydown", handleEditIntent);
  }, [activeBlockId, apply, isSearchBarOpen]);

  const undo = useCallback(() => {
    const next = documentRef.current.undo();
    setSnapshot(next);
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
      const index = blocks.findIndex((block) => block.id === blockId);
      if (index < 0) return false;
      if (direction < 0 && index > 0) {
        apply({ type: "move", blockId, beforeId: blocks[index - 1].id });
        return true;
      } else if (direction > 0 && index < blocks.length - 1) {
        apply({
          type: "move",
          blockId,
          beforeId: blocks[index + 2]?.id ?? null,
        });
        return true;
      }
      return false;
    },
    [apply]
  );

  const navigateBlock = useCallback((blockId: string, direction: -1 | 1): boolean => {
    const blocks = documentRef.current.getSnapshot().blocks;
    const index = blocks.findIndex((block) => block.id === blockId);
    if (index < 0) return false;
    let targetIndex = index + direction;
    while (targetIndex >= 0 && targetIndex < blocks.length && !blocks[targetIndex].editable) {
      targetIndex += direction;
    }
    const target = blocks[targetIndex];
    if (!target?.editable) return false;
    const source = normalizeEditorLineEndings(editableMarkdownBlockSource(target.raw));
    const offset = direction < 0 ? source.length : 0;
    setActiveBlockId(target.id);
    setPendingSelection({ blockId: target.id, anchor: offset, head: offset });
    return true;
  }, []);

  const startBlockDrag = useCallback(
    (blockId: string, event: DragEvent<HTMLButtonElement>) => {
      dragSessionCounterRef.current += 1;
      const token = `${file.id}:${dragSessionCounterRef.current}`;
      dragSessionRef.current = { pageId: file.id, blockId, token };
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(NATIVE_BLOCK_DRAG_MIME, token);
    },
    [file.id]
  );

  const clearBlockDrag = useCallback(() => {
    dragSessionRef.current = null;
  }, []);

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
      if (session.blockId !== beforeId) {
        apply({ type: "move", blockId: session.blockId, beforeId });
      }
      return true;
    },
    [apply, canDropBlock, file.id]
  );

  const pageFrameStyle = {
    "--editor-outline-gutter": `${reservedRightInset}px`,
  } as CSSProperties;
  const wordCount = countWords(snapshot.markdown);

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
      <div className="min-h-0 flex-1 overflow-y-auto" data-native-markdown-scroll>
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
          >
            {snapshot.blocks.map((block, index) => (
              <MarkdownBlockRow
                key={block.id}
                block={block}
                index={index}
                count={snapshot.blocks.length}
                active={activeBlockId === block.id}
                selection={pendingSelection?.blockId === block.id ? pendingSelection : undefined}
                onActivate={(blockId) => {
                  setActiveBlockId(blockId);
                  setPendingSelection(null);
                }}
                onChange={(blockId, source) => {
                  const current = documentRef.current
                    .getSnapshot()
                    .blocks.find((candidate) => candidate.id === blockId);
                  if (!current) return;
                  const currentSource = editableMarkdownBlockSource(current.raw);
                  const patch = minimalEditorPatch(
                    currentSource,
                    source,
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
                }}
                onPaste={(blockId, from, to, text) => {
                  const current = documentRef.current
                    .getSnapshot()
                    .blocks.find((candidate) => candidate.id === blockId);
                  if (!current) return;
                  const currentSource = editableMarkdownBlockSource(current.raw);
                  const lineEnding = preferredSourceLineEnding(current.raw, snapshot.markdown);
                  apply({
                    type: "replaceText",
                    blockId,
                    range: {
                      from: sourceOffsetForEditorOffset(currentSource, from),
                      to: sourceOffsetForEditorOffset(currentSource, to),
                    },
                    text: normalizeEditorLineEndings(text).replace(/\n/g, lineEnding),
                  });
                }}
                onImportImages={importImages}
                onCompositionStart={(blockId) => {
                  composingBlockIdRef.current = blockId;
                  compositionHasHistoryRef.current = false;
                  debouncedSave.cancel();
                }}
                onCompositionEnd={(blockId) => {
                  if (composingBlockIdRef.current !== blockId) return;
                  composingBlockIdRef.current = null;
                  compositionHasHistoryRef.current = false;
                  scheduleAutosave(documentRef.current.getSnapshot().markdown);
                }}
                onSplit={(blockId, from, to) => {
                  const current = documentRef.current
                    .getSnapshot()
                    .blocks.find((candidate) => candidate.id === blockId);
                  if (!current) return;
                  const currentSource = editableMarkdownBlockSource(current.raw);
                  apply({
                    type: "split",
                    blockId,
                    at: sourceOffsetForEditorOffset(currentSource, from),
                    to: sourceOffsetForEditorOffset(currentSource, to),
                  });
                }}
                onMergeBackward={(blockId) => apply({ type: "mergeBackward", blockId })}
                onInsertAfter={(blockId) => apply({ type: "insertAfter", blockId })}
                onDuplicate={(blockId) => apply({ type: "duplicate", blockId })}
                onDelete={(blockId) => apply({ type: "delete", blockId })}
                onSetTaskChecked={(blockId, checked) =>
                  apply({ type: "setTaskChecked", blockId, checked }, false)
                }
                onMove={moveBlock}
                onNavigate={navigateBlock}
                onSetKind={(blockId, kind, level) =>
                  apply({ type: "setKind", blockId, kind, level })
                }
                onUndo={undo}
                onRedo={redo}
                onDragStart={startBlockDrag}
                onDragEnd={clearBlockDrag}
                onCanDrop={canDropBlock}
                onDropBefore={(beforeId, dataTransfer) => dropBlockBefore(beforeId, dataTransfer)}
                onOpenWikiLink={(target) => {
                  const destination = resolveWikiLinkTarget(
                    useFileStore.getState().files,
                    file.id,
                    target
                  );
                  if (destination) void navigateToEditorFile(destination.id);
                }}
                onRunSlashCommand={(blockId, commandId: MarkdownSlashCommandId) => {
                  const current = documentRef.current
                    .getSnapshot()
                    .blocks.find((candidate) => candidate.id === blockId);
                  if (!current) return;
                  const currentSource = editableMarkdownBlockSource(current.raw);
                  apply({
                    type: "replaceText",
                    blockId,
                    range: { from: 0, to: currentSource.length },
                    text: markdownSlashCommandSource(
                      commandId,
                      preferredSourceLineEnding(current.raw, snapshot.markdown)
                    ),
                  });
                }}
                wikiEmbedContext={wikiEmbedContext}
                collectionContext={collectionContext}
                imageContext={imageContext}
              />
            ))}
            <div
              aria-hidden
              data-native-block-drop-end
              className="h-6"
              onDragOver={(event) => {
                if (!canDropBlock(event.dataTransfer)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
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

function sameWorkspacePath(left: string, right: string): boolean {
  return normalizeWorkspacePath(left) === normalizeWorkspacePath(right);
}

function normalizeWorkspacePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").normalize("NFC").toLowerCase();
}

interface MarkdownSearchMatch {
  blockId: string;
  anchor: number;
  head: number;
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
    const source = normalizeEditorLineEndings(editableMarkdownBlockSource(block.raw));
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
