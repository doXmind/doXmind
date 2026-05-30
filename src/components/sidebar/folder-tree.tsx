"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import {
  Check,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { PdfGlyph, SpreadsheetGlyph } from "@/components/icons/document-glyphs";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { FileItem } from "./file-item";
import { useFileStore } from "@/stores/file-store";
import type { FileItem as FileItemType } from "@/types";
import { notify } from "@/lib/notifications";
import { getErrorMessage, cn } from "@/lib/utils";
import { storeLogger } from "@/lib/logger";
import { revealFileInFinder } from "@/lib/storage/reveal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { evaluateSidebarDrop, type DnDNode } from "@/lib/sidebar-dnd-policy";
import { useHoverExpand } from "./use-hover-expand";
import {
  planExternalImport,
  resolveImportPlan,
  type CollisionItem,
  type CollisionResolution,
  type ImportAction,
} from "@/lib/external-import-resolver";
import { ImportError } from "@/lib/storage";
import { ImportConflictModal } from "./import-conflict-modal";

const log = storeLogger.child("FolderTree");

type FolderMenuItem = {
  id:
    | "new-file"
    | "new-pdf"
    | "new-excel"
    | "new-folder"
    | "refresh"
    | "rename"
    | "reveal"
    | "delete";
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
};

type EmptyMenuItem = {
  id: "new-file" | "new-pdf" | "new-excel" | "new-folder" | "refresh";
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
};

interface FolderTreeProps {
  onCreateFile: (parentId?: string | null) => void;
  onCreatePdf: (parentId?: string | null) => void;
  onCreateExcel: (parentId?: string | null) => void;
  onCreateFolder: (parentId?: string | null) => void;
}

export interface FolderTreeHandle {
  collapseAll: () => void;
  hasExpandedFolders: () => boolean;
}

export const FolderTree = forwardRef<FolderTreeHandle, FolderTreeProps>(function FolderTree(
  { onCreateFile, onCreatePdf, onCreateExcel, onCreateFolder },
  ref
) {
  const t = useTranslations("sidebar");

  const files = useFileStore((s) => s.files);
  const activeParentId = useFileStore(
    (s) => s.files.find((file) => file.id === s.currentFileId)?.parentId ?? null
  );
  const currentFolderId = useFileStore((s) => s.currentFolderId);
  const getFolders = useFileStore((s) => s.getFolders);
  const getFilesInFolder = useFileStore((s) => s.getFilesInFolder);
  const setCurrentFolder = useFileStore((s) => s.setCurrentFolder);
  const moveFileToFolder = useFileStore((s) => s.moveFileToFolder);
  const importExternalFile = useFileStore((s) => s.importExternalFile);
  const renameFile = useFileStore((s) => s.renameFile);
  const deleteFile = useFileStore((s) => s.deleteFile);
  const loadFiles = useFileStore((s) => s.loadFiles);
  const justCreatedFileId = useFileStore((s) => s.justCreatedFileId);
  const clearJustCreatedFileId = useFileStore((s) => s.clearJustCreatedFileId);

  // Folders start collapsed: opening a workspace shows only the first level
  // (the root's direct children); deeper folders expand one level per click.
  // We track the EXPANDED set (empty = everything collapsed) rather than a
  // collapsed set so a freshly opened folder doesn't dump its whole nested
  // subtree into the sidebar.
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  // Tracks the in-flight folder drag source so dragover handlers can compute
  // D1 verdicts before the drop event (where `getData` becomes readable).
  const [draggingSourceId, setDraggingSourceId] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renamingFolderName, setRenamingFolderName] = useState("");

  // Folder context menu (right-click on a folder row)
  const [folderMenu, setFolderMenu] = useState<{
    x: number;
    y: number;
    items: FolderMenuItem[];
  } | null>(null);
  const [folderMenuFocus, setFolderMenuFocus] = useState(-1);
  const [folderMenuReady, setFolderMenuReady] = useState(false);
  const folderMenuRef = useRef<HTMLDivElement>(null);

  // Empty-area context menu (right-click on workspace root area)
  const [emptyMenu, setEmptyMenu] = useState<{
    x: number;
    y: number;
    items: EmptyMenuItem[];
  } | null>(null);
  const [emptyMenuFocus, setEmptyMenuFocus] = useState(-1);
  const emptyMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (currentFolderId) {
      setCurrentFolder(null);
    }
  }, [currentFolderId, setCurrentFolder]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- files triggers recomputation through store methods
  const viewFolders = useMemo(() => getFolders(null), [files, getFolders]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- same
  const rootFiles = useMemo(() => getFilesInFolder(null), [files, getFilesInFolder]);
  const allFolders = useMemo(() => files.filter((f) => f.isFolder), [files]);

  const hasExpandedFolders = allFolders.some((f) => expandedFolderIds.has(f.id));

  useImperativeHandle(
    ref,
    () => ({
      collapseAll: () => setExpandedFolderIds(new Set()),
      hasExpandedFolders: () => hasExpandedFolders,
    }),
    [hasExpandedFolders]
  );

  // Build a D1-shaped tree snapshot from the file store. The policy module
  // only needs the four fields it asks for, so we strip out everything else
  // — keeps the verdict path independent of FileItem evolution.
  const dndTree: DnDNode[] = useMemo(
    () =>
      files.map((f) => ({
        id: f.id,
        name: f.name,
        isFolder: f.isFolder,
        parentId: f.parentId,
      })),
    [files]
  );

  // D3: hover-expand. Dragging over a collapsed folder for ~500ms expands it
  // so the user can drop into a deeper subfolder without first interrupting
  // the drag. We only schedule the timer when the row is actually collapsed —
  // an already-open folder doesn't need expanding, and skipping the schedule
  // avoids a no-op setState round-trip mid-drag.
  const {
    onFolderDragOver: scheduleHoverExpand,
    onFolderDragLeave: cancelHoverExpand,
    cancel: cancelHoverExpandTimer,
  } = useHoverExpand((folderId) => {
    setExpandedFolderIds((prev) => {
      if (prev.has(folderId)) return prev;
      const next = new Set(prev);
      next.add(folderId);
      return next;
    });
  });

  // Pending collisions surface in the conflict modal. We hold the raw items
  // alongside the plan so a Replace / Keep both decision can map back to the
  // original srcPath / bytes payload at Apply time.
  const [pendingConflict, setPendingConflict] = useState<{
    folderId: string | null;
    collisions: CollisionItem[];
    /** Existing names at the destination — captured at plan time so successive
     *  `keep-both` renames are deterministic even if the file store changes
     *  underneath us while the modal is open. */
    existingNames: string[];
  } | null>(null);

  // Execute a list of resolved actions against the storage adapter. Pulled
  // out so both the accepted-bucket dispatch and the post-modal Apply share
  // the same error handling.
  const runActions = useCallback(
    async (actions: ImportAction[], folderId: string | null) => {
      for (const action of actions) {
        try {
          await importExternalFile({
            name: action.name,
            parentId: folderId,
            srcPath: action.item.srcPath,
            bytes: action.item.bytes,
            mode: action.mode,
          });
        } catch (error) {
          if (error instanceof ImportError && error.code === "destination-exists") {
            // Race window: an external edit / process landed a same-named
            // file between plan and copy. Surface the collision toast — we
            // don't re-open the modal because that would loop indefinitely
            // if a watcher keeps adding the file back.
            notify.error(t("externalImportCollision"));
            continue;
          }
          log.error("Failed to import external file", error);
          notify.error(t("externalImportFailed"));
        }
      }
    },
    [importExternalFile, t]
  );

  // External imports go through the D2 plan-phase resolver
  // (`src/lib/external-import-resolver.ts`) for whitelist + collision
  // detection. Accepted items are copied immediately; collisions surface
  // in the ImportConflictModal (#69) for per-row Replace / Keep both / Skip.
  const importItems = useCallback(
    async (
      items: Array<{ name: string; srcPath?: string; bytes?: Uint8Array }>,
      folderId: string | null
    ) => {
      // Resolve dest folder id → existing names at that destination so the
      // resolver can detect same-name collisions before we hit the backend.
      const filesAtDest = useFileStore
        .getState()
        .files.filter((file) => (file.parentId ?? null) === folderId);
      const existingNames = filesAtDest.map((file) => file.name);
      const plan = planExternalImport({
        items,
        destFolderId: folderId,
        existingNames,
      });

      // Whitelist rejection — single combined toast keeps a multi-file batch
      // from spamming the user with one banner per bad file.
      if (plan.rejected.length > 0) {
        notify.error(t("externalImportUnsupported"));
      }

      // Accepted items run immediately; the user shouldn't have to click
      // through a modal for files that don't conflict.
      if (plan.accepted.length > 0) {
        const acceptedActions: ImportAction[] = plan.accepted.map((entry) => ({
          item: entry.item,
          extension: entry.extension,
          name: entry.item.name,
          mode: "create",
        }));
        await runActions(acceptedActions, folderId);
      }

      // Collisions go through the modal. Capture `existingNames` at this
      // point — `keep-both` rename arithmetic should be stable even if the
      // file store changes while the modal is open.
      if (plan.collisions.length > 0) {
        setPendingConflict({
          folderId,
          collisions: plan.collisions,
          existingNames,
        });
      }
    },
    [runActions, t]
  );

  const handleConflictApply = useCallback(
    async (decisions: Record<string, CollisionResolution>) => {
      const conflict = pendingConflict;
      if (!conflict) return;
      setPendingConflict(null);
      // Re-run the resolve step now that we have decisions. We rebuild a
      // synthetic ImportPlan so resolveImportPlan's accepted/rejected
      // bookkeeping stays consistent — we pass an empty accepted list since
      // those items already ran above; the resolver only needs to walk
      // `collisions` here.
      const resolved = resolveImportPlan({
        plan: {
          destFolderId: conflict.folderId,
          accepted: [],
          rejected: [],
          collisions: conflict.collisions,
        },
        existingNames: conflict.existingNames,
        decisions,
      });
      if (resolved.actions.length === 0) return;
      await runActions(resolved.actions, conflict.folderId);
    },
    [pendingConflict, runActions]
  );

  const handleConflictCancelAll = useCallback(() => {
    // Cancel-all drops the entire collision sub-batch. Items already
    // accepted earlier in the same drop are unaffected — the modal only
    // controls the collision sub-batch, never the accepted one.
    setPendingConflict(null);
  }, []);

  // Drag & drop. Two distinct flows share the same drop targets:
  //   1. Internal moves (text/plain payload = a file id from `FileItem`),
  //      gated by D1 policy (cycle / would-be-self → not-allowed cursor;
  //      name-collision → toast on drop).
  //   2. External imports (HTML5 `DataTransfer.files` in browser dev mode;
  //      Tauri `tauri://drag-drop` window events in the desktop shell —
  //      subscribed in the effect below).

  const handleDragOver = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    e.stopPropagation();
    // External (OS) drag: `kind === "file"` on at least one item. Show the
    // copy cursor and skip the D1 verdict — folder cycle/self only applies
    // to internal moves.
    const isExternal = Array.from(e.dataTransfer.items ?? []).some((item) => item.kind === "file");
    if (isExternal) {
      e.dataTransfer.dropEffect = "copy";
      setDragOverFolderId(folderId);
      return;
    }
    // Internal folder drag: read the in-flight source from local state
    // (set on folder dragstart). File drags don't populate this state, but
    // they can never trigger cycle / would-be-self — only folder drags can.
    if (draggingSourceId) {
      const decision = evaluateSidebarDrop({
        sourceId: draggingSourceId,
        targetId: folderId,
        tree: dndTree,
      });
      if (decision.verdict === "cycle" || decision.verdict === "would-be-self") {
        e.dataTransfer.dropEffect = "none";
        setDragOverFolderId(null);
        // Don't schedule hover-expand for an invalid drop — there's no point
        // expanding a folder the user can't actually drop into.
        cancelHoverExpandTimer();
        return;
      }
    }
    e.dataTransfer.dropEffect = "move";
    setDragOverFolderId(folderId);
    // Only collapsed folders need expanding; the hook itself no-ops if the
    // expand callback finds the folder already open, but skipping the
    // schedule avoids a useless setState while the user drags inside an
    // already-expanded folder.
    if (!expandedFolderIds.has(folderId)) {
      scheduleHoverExpand(folderId);
    } else {
      cancelHoverExpandTimer();
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolderId(null);
    cancelHoverExpand();
  };

  const resolveDropFolderId = (rawTarget: string | null): string | null => {
    // file-row → file's parent. Folder-row → that folder. Empty area → root.
    if (!rawTarget) return null;
    const file = useFileStore.getState().files.find((f) => f.id === rawTarget);
    if (!file) return null;
    if (file.isFolder) return file.id;
    return file.parentId ?? null;
  };

  const handleDrop = async (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolderId(null);
    cancelHoverExpandTimer();

    // External file drop (browser dev mode): HTML5 DataTransfer.files. Each
    // File comes through as bytes — the disk adapter forwards them to
    // `doc_import_external`. In the Tauri shell this branch is unreachable
    // for OS DnD because the webview intercepts the event; only internal
    // drags reach here. The Tauri path is wired through the useEffect below.
    const droppedFiles = Array.from(e.dataTransfer.files ?? []);
    if (droppedFiles.length > 0) {
      const items = await Promise.all(
        droppedFiles.map(async (file) => ({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        }))
      );
      await importItems(items, folderId);
      return;
    }

    // Internal drag: file or folder id in the text/plain payload. Run D1
    // policy to filter cycles, self-drops, no-op same-parent moves, and
    // folder name collisions before dispatching the move.
    const draggedId = e.dataTransfer.getData("text/plain");
    if (!draggedId) return;

    const decision = evaluateSidebarDrop({
      sourceId: draggedId,
      targetId: folderId,
      tree: dndTree,
    });

    switch (decision.verdict) {
      case "cycle":
      case "would-be-self":
        // Cursor already showed not-allowed during the drag; nothing to do
        // on drop beyond eating the event so the parent doesn't pick it up.
        return;
      case "no-op-same-parent":
        return;
      case "name-collision":
        notify.error(t("folderExistsAtDestination"));
        return;
      case "ok":
        try {
          await moveFileToFolder(draggedId, decision.destinationParentId);
        } catch (error) {
          log.error("Failed to move file", error);
          notify.error(t("failedToMove"));
        }
        return;
    }
  };

  const handleFolderDragStart = (e: React.DragEvent, folderId: string) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", folderId);
    setDraggingSourceId(folderId);
  };
  const handleDragEnd = () => {
    setDraggingSourceId(null);
    cancelHoverExpandTimer();
  };

  // Tauri drag-drop integration. The webview consumes OS DnD events before
  // they reach the DOM, so we listen at the window level and hit-test the
  // reported pointer position against `data-drop-target-*` attributes that
  // the folder-row / file-row JSX advertises. The event is fire-once per
  // drop, batched across all paths the user dragged.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    void import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent(async (event) => {
          if (cancelled) return;
          if (event.payload.type !== "drop") return;
          const paths = event.payload.paths ?? [];
          if (paths.length === 0) return;

          const { x, y } = event.payload.position;
          // PhysicalPosition is in device pixels; CSS pixels are scaled by DPR.
          const cssX = x / window.devicePixelRatio;
          const cssY = y / window.devicePixelRatio;
          const element = document.elementFromPoint(cssX, cssY);
          const targetId =
            element?.closest<HTMLElement>("[data-drop-target-id]")?.dataset.dropTargetId ?? null;
          const folderId = resolveDropFolderId(targetId);

          const items = paths.map((srcPath) => ({
            name: srcPath.split(/[\\/]/).pop() || srcPath,
            srcPath,
          }));
          await importItems(items, folderId);
        })
      )
      .then((u) => {
        if (cancelled) {
          u();
        } else {
          unlisten = u;
        }
      })
      .catch(() => {
        // Browser dev mode (no Tauri runtime). The HTML5 onDrop handler on
        // the JSX below covers this case.
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [importItems]);

  // Folder rename
  const handleFolderRename = async () => {
    if (!renamingFolderId || !renamingFolderName.trim()) {
      setRenamingFolderId(null);
      setRenamingFolderName("");
      return;
    }
    try {
      await renameFile(renamingFolderId, renamingFolderName.trim());
    } catch (error) {
      log.error("Failed to rename folder", error);
      const { title, description } = getErrorMessage(error);
      notify.error(title, { description });
    }
    setRenamingFolderId(null);
    setRenamingFolderName("");
  };

  const cancelFolderRename = () => {
    setRenamingFolderId(null);
    setRenamingFolderName("");
  };

  // Auto-enter rename mode for newly created folders
  useEffect(() => {
    const folder = allFolders.find((f) => f.id === justCreatedFileId);
    if (folder) {
      setRenamingFolderId(folder.id);
      setRenamingFolderName(folder.name);
      clearJustCreatedFileId();
    }
  }, [allFolders, justCreatedFileId, clearJustCreatedFileId]);

  // OS Trash is the recovery path (per ADR 0005). Confirm is defense-in-depth
  // and surfaces how many children move with the folder so the user can
  // reconsider before triggering a multi-file delete.
  const [folderPendingDelete, setFolderPendingDelete] = useState<FileItemType | null>(null);

  // Count documents under a folder by walking the file-store entries
  // (already in memory) rather than hitting disk. Subfolders are traversed
  // but not counted themselves; sidecars are implicit (one per doc).
  const countDocsUnderFolder = (folder: FileItemType | null): number => {
    if (!folder) return 0;
    let docs = 0;
    const stack: string[] = [folder.id];
    while (stack.length > 0) {
      const parentId = stack.pop();
      const children = files.filter((f) => f.parentId === parentId);
      for (const child of children) {
        if (child.isFolder) {
          stack.push(child.id);
        } else {
          docs += 1;
        }
      }
    }
    return docs;
  };

  const handleDeleteFolderDirect = (folder: FileItemType) => {
    setFolderPendingDelete(folder);
  };

  const handleDeleteFolderConfirmed = async () => {
    const folder = folderPendingDelete;
    if (!folder) return;
    try {
      await deleteFile(folder.id);
    } catch (error) {
      log.error("Failed to delete folder", error);
      const { title, description } = getErrorMessage(error);
      notify.error(title, { description });
    } finally {
      setFolderPendingDelete(null);
    }
  };

  // Build the right-click menu for a folder. Encapsulating the items in
  // a single array makes keyboard navigation independent of which menu is
  // open and which entries are present.
  const handleRefresh = useCallback(() => {
    void loadFiles();
  }, [loadFiles]);

  const buildFolderMenu = useCallback(
    (folder: FileItemType): FolderMenuItem[] => [
      {
        id: "refresh",
        label: t("refresh"),
        icon: <RefreshCw className="mr-2 h-4 w-4" />,
        onClick: handleRefresh,
      },
      {
        id: "new-file",
        label: t("newDocument"),
        icon: <FilePlus2 className="mr-2 h-4 w-4" />,
        onClick: () => onCreateFile(folder.id),
      },
      {
        id: "new-pdf",
        label: t("newPdfDocument"),
        icon: <PdfGlyph className="mr-2 h-4 w-4" />,
        onClick: () => onCreatePdf(folder.id),
      },
      {
        id: "new-excel",
        label: t("newExcelDocument"),
        icon: <SpreadsheetGlyph className="mr-2 h-4 w-4" />,
        onClick: () => onCreateExcel(folder.id),
      },
      {
        id: "new-folder",
        label: t("newFolder"),
        icon: <FolderPlus className="mr-2 h-4 w-4" />,
        onClick: () => onCreateFolder(folder.id),
      },
      {
        id: "rename",
        label: t("rename"),
        icon: <Pencil className="mr-2 h-4 w-4" />,
        onClick: () => {
          setRenamingFolderId(folder.id);
          setRenamingFolderName(folder.name);
        },
      },
      {
        id: "reveal",
        label: t("revealInFinder"),
        icon: <FolderOpen className="mr-2 h-4 w-4" />,
        onClick: async () => {
          try {
            await revealFileInFinder(folder);
          } catch (error) {
            log.error("Failed to reveal folder in Finder", error);
            const { title, description } = getErrorMessage(error);
            notify.error(title, { description });
          }
        },
      },
      {
        id: "delete",
        label: t("moveToTrash"),
        icon: <Trash2 className="mr-2 h-4 w-4" />,
        onClick: () => handleDeleteFolderDirect(folder),
        destructive: true,
      },
    ],
    [t, handleRefresh, onCreateFile, onCreatePdf, onCreateExcel, onCreateFolder]
  );

  const buildEmptyMenu = useCallback(
    (): EmptyMenuItem[] => [
      {
        id: "refresh",
        label: t("refresh"),
        icon: <RefreshCw className="mr-2 h-4 w-4" />,
        onClick: handleRefresh,
      },
      {
        id: "new-file",
        label: t("newDocument"),
        icon: <FilePlus2 className="mr-2 h-4 w-4" />,
        onClick: () => onCreateFile(null),
      },
      {
        id: "new-pdf",
        label: t("newPdfDocument"),
        icon: <PdfGlyph className="mr-2 h-4 w-4" />,
        onClick: () => onCreatePdf(null),
      },
      {
        id: "new-excel",
        label: t("newExcelDocument"),
        icon: <SpreadsheetGlyph className="mr-2 h-4 w-4" />,
        onClick: () => onCreateExcel(null),
      },
      {
        id: "new-folder",
        label: t("newFolder"),
        icon: <FolderPlus className="mr-2 h-4 w-4" />,
        onClick: () => onCreateFolder(null),
      },
    ],
    [t, handleRefresh, onCreateFile, onCreatePdf, onCreateExcel, onCreateFolder]
  );

  // Position helpers — clamp to viewport so menus don't overflow.
  const positionForMouse = (clientX: number, clientY: number, w: number, h: number) => {
    let x = clientX;
    let y = clientY;
    if (x + w > window.innerWidth - 10) x = window.innerWidth - w - 10;
    if (y + h > window.innerHeight - 10) y = window.innerHeight - h - 10;
    return { x, y };
  };

  const handleFolderContextMenu = useCallback(
    (e: React.MouseEvent, folder: FileItemType) => {
      e.preventDefault();
      e.stopPropagation();
      const items = buildFolderMenu(folder);
      const { x, y } = positionForMouse(e.clientX, e.clientY, 200, items.length * 32 + 8);
      setFolderMenu({ x, y, items });
      setFolderMenuFocus(-1);
      setFolderMenuReady(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setFolderMenuReady(true));
      });
    },
    [buildFolderMenu]
  );

  const handleEmptyAreaContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const items = buildEmptyMenu();
      const { x, y } = positionForMouse(e.clientX, e.clientY, 180, items.length * 32 + 8);
      setEmptyMenu({ x, y, items });
      setEmptyMenuFocus(-1);
    },
    [buildEmptyMenu]
  );

  // Close menus on outside click / Escape, support arrow-key nav.
  useEffect(() => {
    if (!folderMenu && !emptyMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (folderMenuRef.current && !folderMenuRef.current.contains(e.target as Node)) {
        setFolderMenu(null);
        setFolderMenuFocus(-1);
      }
      if (emptyMenuRef.current && !emptyMenuRef.current.contains(e.target as Node)) {
        setEmptyMenu(null);
        setEmptyMenuFocus(-1);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = folderMenu ?? emptyMenu;
      if (!active) return;
      const length = active.items.length;
      const focus = folderMenu ? folderMenuFocus : emptyMenuFocus;
      const setFocus = folderMenu ? setFolderMenuFocus : setEmptyMenuFocus;
      const closeAll = () => {
        setFolderMenu(null);
        setFolderMenuFocus(-1);
        setEmptyMenu(null);
        setEmptyMenuFocus(-1);
      };
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          closeAll();
          break;
        case "ArrowDown":
          e.preventDefault();
          setFocus((focus + 1) % length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocus((focus - 1 + length) % length);
          break;
        case "Enter":
          e.preventDefault();
          if (focus >= 0 && focus < length) {
            const item = active.items[focus];
            closeAll();
            item.onClick();
          }
          break;
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [folderMenu, emptyMenu, folderMenuFocus, emptyMenuFocus]);

  const renderFolder = (folder: FileItemType) => {
    const folderFiles = getFilesInFolder(folder.id);
    const childFolders = getFolders(folder.id);
    const isCollapsed = !expandedFolderIds.has(folder.id);
    const isActiveFolder = activeParentId === folder.id;
    const hasChildren = folderFiles.length > 0 || childFolders.length > 0;

    return (
      <div key={folder.id} className="space-y-0.5">
        <div
          data-drop-target-id={folder.id}
          onDragOver={(e) => handleDragOver(e, folder.id)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, folder.id)}
          className={cn(
            "group/folder rounded-lg transition-colors duration-150 ease-out",
            dragOverFolderId === folder.id
              ? "bg-[var(--sidebar-active)] ring-1 ring-primary/40"
              : isActiveFolder
                ? "bg-[var(--sidebar-active)]"
                : "hover:bg-[var(--sidebar-hover)]"
          )}
        >
          {renamingFolderId === folder.id ? (
            <div className="flex w-full items-center gap-2 px-2.5 py-1.5 text-sm">
              <Folder className="h-[18px] w-[18px] shrink-0 text-[var(--sidebar-icon)]" />
              <Input
                value={renamingFolderName}
                onChange={(e) => setRenamingFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleFolderRename();
                  if (e.key === "Escape") cancelFolderRename();
                  e.stopPropagation();
                }}
                onClick={(e) => e.stopPropagation()}
                className="h-7 flex-1 text-sm"
                autoFocus
                onFocus={(e) => e.target.select()}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleFolderRename();
                }}
                className="flex-shrink-0 rounded p-0.5 hover:bg-accent"
                aria-label={t("confirmRename")}
              >
                <Check className="h-4 w-4 text-green-600 dark:text-green-500" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  cancelFolderRename();
                }}
                className="flex-shrink-0 rounded p-0.5 hover:bg-accent"
                aria-label={t("cancelRename")}
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          ) : (
            <div
              draggable={renamingFolderId !== folder.id}
              onDragStart={(e) => handleFolderDragStart(e, folder.id)}
              onDragEnd={handleDragEnd}
              onClick={() => {
                setExpandedFolderIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(folder.id)) next.delete(folder.id);
                  else next.add(folder.id);
                  return next;
                });
              }}
              onContextMenu={(e) => handleFolderContextMenu(e, folder)}
              className="flex h-7 w-full cursor-pointer select-none items-center gap-2 px-2.5 text-sm"
            >
              {isCollapsed ? (
                <Folder className="h-[18px] w-[18px] shrink-0 text-[var(--sidebar-icon)] transition-colors group-hover/folder:text-[var(--sidebar-text)]" />
              ) : (
                <FolderOpen className="h-[18px] w-[18px] shrink-0 text-[var(--sidebar-icon)] transition-colors group-hover/folder:text-[var(--sidebar-text)]" />
              )}
              <span className="text-ui-base min-w-0 flex-1 truncate font-semibold leading-5 text-[var(--sidebar-text)] transition-colors group-hover/folder:text-foreground">
                {folder.name}
              </span>
            </div>
          )}
        </div>
        {!isCollapsed && hasChildren && (
          <div className="ml-6 space-y-0.5 pl-1.5">
            {childFolders.map((child) => renderFolder(child))}
            {folderFiles.map((file) => (
              <FileItem key={file.id} file={file} />
            ))}
          </div>
        )}
      </div>
    );
  };

  const folderRows = viewFolders.map((folder) => renderFolder(folder));

  return (
    <div
      className="flex min-h-full flex-col"
      onContextMenu={handleEmptyAreaContextMenu}
      onDragOver={(e) => {
        e.preventDefault();
        const isExternal = Array.from(e.dataTransfer.items ?? []).some(
          (item) => item.kind === "file"
        );
        e.dataTransfer.dropEffect = isExternal ? "copy" : "move";
      }}
      onDrop={(e) => handleDrop(e, null)}
    >
      <div className="space-y-0.5">
        {folderRows}
        {rootFiles.map((file) => (
          <FileItem key={file.id} file={file} />
        ))}
      </div>

      {files.length === 0 && (
        <div className="px-1 pt-5">
          <div className="px-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
            {t("emptyEyebrow")}
          </div>

          <ol className="m-0 mt-3 flex list-none flex-col p-0">
            <li className="border-t border-border">
              <button
                type="button"
                onClick={() => onCreateFile(null)}
                className="group flex w-full items-baseline gap-3 px-2 py-2.5 text-left transition-colors duration-150 hover:bg-[var(--sidebar-hover)] focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span className="w-5 shrink-0 font-mono text-[11px] tabular-nums tracking-[0.02em] text-muted-foreground transition-colors duration-150 group-hover:font-medium group-hover:text-foreground group-focus-visible:font-medium group-focus-visible:text-foreground">
                  01
                </span>
                <span className="font-brand-sans min-w-0 flex-1 truncate text-[13px] tracking-[-0.012em] text-foreground/90 transition-colors duration-150 group-hover:text-foreground group-focus-visible:text-foreground">
                  {t("newDocument")}
                </span>
              </button>
            </li>
            <li className="border-b border-t border-border">
              <button
                type="button"
                onClick={() => onCreateFolder(null)}
                className="group flex w-full items-baseline gap-3 px-2 py-2.5 text-left transition-colors duration-150 hover:bg-[var(--sidebar-hover)] focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span className="w-5 shrink-0 font-mono text-[11px] tabular-nums tracking-[0.02em] text-muted-foreground transition-colors duration-150 group-hover:font-medium group-hover:text-foreground group-focus-visible:font-medium group-focus-visible:text-foreground">
                  02
                </span>
                <span className="font-brand-sans min-w-0 flex-1 truncate text-[13px] tracking-[-0.012em] text-foreground/90 transition-colors duration-150 group-hover:text-foreground group-focus-visible:text-foreground">
                  {t("newFolder")}
                </span>
              </button>
            </li>
          </ol>

          <p className="font-brand-sans mt-3 px-2 text-[11px] leading-snug text-muted-foreground/45">
            {t("emptyTailHint")}
          </p>
        </div>
      )}

      {/* Spacer captures right-clicks below the last item so users can
          create files anywhere in the empty area, not just on rows. */}
      <div className="flex-1" aria-hidden />

      {/* Folder context menu */}
      {folderMenu &&
        createPortal(
          <div
            ref={folderMenuRef}
            role="menu"
            className="fixed z-[9999] min-w-[200px] rounded-md border border-border bg-popover p-1 shadow-lg"
            style={{ left: folderMenu.x, top: folderMenu.y }}
          >
            {folderMenu.items.map((item, index) => (
              <button
                key={item.id}
                role="menuitem"
                onMouseEnter={() => folderMenuReady && setFolderMenuFocus(index)}
                onClick={() => {
                  setFolderMenu(null);
                  setFolderMenuFocus(-1);
                  item.onClick();
                }}
                className={cn(
                  "relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none",
                  item.destructive && "text-destructive",
                  folderMenuReady &&
                    (item.destructive
                      ? "hover:bg-destructive/10"
                      : "hover:bg-accent hover:text-accent-foreground"),
                  folderMenuFocus === index &&
                    (item.destructive ? "bg-destructive/10" : "bg-accent text-accent-foreground")
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>,
          document.body
        )}

      {/* Empty-area context menu */}
      {emptyMenu &&
        createPortal(
          <div
            ref={emptyMenuRef}
            role="menu"
            className="fixed z-[9999] min-w-[180px] rounded-md border border-border bg-popover p-1 shadow-lg"
            style={{ left: emptyMenu.x, top: emptyMenu.y }}
          >
            {emptyMenu.items.map((item, index) => (
              <button
                key={item.id}
                role="menuitem"
                onMouseEnter={() => setEmptyMenuFocus(index)}
                onClick={() => {
                  setEmptyMenu(null);
                  setEmptyMenuFocus(-1);
                  item.onClick();
                }}
                className={cn(
                  "relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none",
                  "hover:bg-accent hover:text-accent-foreground",
                  emptyMenuFocus === index && "bg-accent text-accent-foreground"
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>,
          document.body
        )}

      <ConfirmModal
        open={folderPendingDelete !== null}
        onClose={() => setFolderPendingDelete(null)}
        onConfirm={handleDeleteFolderConfirmed}
        title={t("moveToTrashTitleFolder", { name: folderPendingDelete?.name ?? "" })}
        description={t("moveToTrashDescFolder", {
          count: countDocsUnderFolder(folderPendingDelete),
        })}
        confirmLabel={t("moveToTrash")}
      />

      <ImportConflictModal
        open={pendingConflict !== null}
        collisions={pendingConflict?.collisions ?? []}
        onApply={handleConflictApply}
        onCancelAll={handleConflictCancelAll}
      />
    </div>
  );
});

FolderTree.displayName = "FolderTree";
