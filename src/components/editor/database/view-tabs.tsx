"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { Plus, Table2, LayoutGrid, GalleryHorizontalEnd, List, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DatabaseView, ViewType } from "@/extensions/database/database-types";
import { useDatabaseStore } from "@/stores/database-store";
import { ConfirmDialog } from "./confirm-dialog";

const VIEW_ICONS: Record<ViewType, React.ReactNode> = {
  table: <Table2 className="h-3.5 w-3.5" />,
  board: <LayoutGrid className="h-3.5 w-3.5" />,
  gallery: <GalleryHorizontalEnd className="h-3.5 w-3.5" />,
  list: <List className="h-3.5 w-3.5" />,
};

interface ViewTabsProps {
  databaseId: string;
  views: DatabaseView[];
  activeViewId: string;
}

export function ViewTabs({ databaseId, views, activeViewId }: ViewTabsProps) {
  const t = useTranslations("database");
  const { setActiveView, createView, updateView, deleteView } = useDatabaseStore();
  const [showNew, setShowNew] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ viewId: string; x: number; y: number } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  // Inline rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  // Close "add view" menu on outside click
  useEffect(() => {
    if (!showNew) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowNew(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showNew]);

  // Close context menu on outside click / scroll
  useEffect(() => {
    if (!ctxMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    const handleScroll = () => setCtxMenu(null);
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [ctxMenu]);

  // Auto-focus rename input
  useEffect(() => {
    if (renamingId) renameRef.current?.focus();
  }, [renamingId]);

  const VIEW_TYPE_NAMES: Record<ViewType, string> = {
    table: t("viewTypes.table"),
    board: t("viewTypes.board"),
    gallery: t("viewTypes.gallery"),
    list: t("viewTypes.list"),
  };

  const handleCreateView = (type: ViewType) => {
    createView(databaseId, { name: VIEW_TYPE_NAMES[type], type });
    setShowNew(false);
  };

  const handleContextMenu = useCallback((e: React.MouseEvent, viewId: string) => {
    e.preventDefault();
    e.stopPropagation();
    // Stop the native event from reaching TipTap's editor-level contextmenu listener
    e.nativeEvent.stopImmediatePropagation();
    setCtxMenu({ viewId, x: e.clientX, y: e.clientY });
  }, []);

  const startRename = useCallback(
    (viewId: string) => {
      const view = views.find((v) => v.id === viewId);
      if (!view) return;
      setRenameDraft(view.name);
      setRenamingId(viewId);
      setCtxMenu(null);
    },
    [views]
  );

  const commitRename = useCallback(() => {
    if (!renamingId) return;
    const trimmed = renameDraft.trim();
    const view = views.find((v) => v.id === renamingId);
    if (trimmed && view && trimmed !== view.name) {
      updateView(databaseId, renamingId, { name: trimmed });
    }
    setRenamingId(null);
    setRenameDraft("");
  }, [renamingId, renameDraft, views, databaseId, updateView]);

  const [pendingDeleteViewId, setPendingDeleteViewId] = useState<string | null>(null);

  const handleDelete = useCallback((viewId: string) => {
    setCtxMenu(null);
    setPendingDeleteViewId(viewId);
  }, []);

  const confirmDelete = useCallback(() => {
    if (pendingDeleteViewId) {
      deleteView(databaseId, pendingDeleteViewId);
      setPendingDeleteViewId(null);
    }
  }, [databaseId, pendingDeleteViewId, deleteView]);

  return (
    <div className="flex items-center gap-0.5 border-b border-border/60 px-3">
      {views.map((view) => (
        <div key={view.id}>
          {renamingId === view.id ? (
            <input
              ref={renameRef}
              className="my-0.5 w-28 rounded-md border border-primary/50 bg-transparent px-2.5 py-1 text-xs font-medium outline-none"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") {
                  setRenamingId(null);
                  setRenameDraft("");
                }
              }}
            />
          ) : (
            <button
              className={cn(
                "my-0.5 flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                view.id === activeViewId
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
              onClick={() => setActiveView(databaseId, view.id)}
              onContextMenu={(e) => handleContextMenu(e, view.id)}
            >
              {VIEW_ICONS[view.type]}
              {view.name}
            </button>
          )}
        </div>
      ))}

      {/* Add view button */}
      <div className="relative" ref={menuRef}>
        <button
          className="flex items-center rounded-md px-1.5 py-1 text-muted-foreground/60 transition-colors hover:bg-accent/50 hover:text-muted-foreground"
          onClick={() => setShowNew(!showNew)}
          title={t("addView")}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        {showNew && (
          <div className="animate-in fade-in-0 zoom-in-95 absolute left-0 top-full z-50 mt-1 w-44 rounded-lg border border-border bg-popover p-1 shadow-lg duration-150">
            {(["table", "board", "gallery", "list"] as ViewType[]).map((type) => (
              <button
                key={type}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-accent"
                onClick={() => handleCreateView(type)}
              >
                <span className="text-muted-foreground">{VIEW_ICONS[type]}</span>
                {VIEW_TYPE_NAMES[type]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Context menu via portal */}
      {ctxMenu &&
        createPortal(
          <div
            ref={ctxRef}
            className="animate-in fade-in-0 zoom-in-95 fixed z-[100] w-44 rounded-lg border border-border bg-popover p-1 shadow-lg duration-100"
            style={{
              top: Math.min(ctxMenu.y, window.innerHeight - 100),
              left: Math.min(ctxMenu.x, window.innerWidth - 180),
            }}
          >
            <button
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-accent"
              onClick={() => startRename(ctxMenu.viewId)}
            >
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              {t("renameView")}
            </button>
            {views.length > 1 && (
              <>
                <div className="my-1 border-b border-border" />
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                  onClick={() => handleDelete(ctxMenu.viewId)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("deleteView")}
                </button>
              </>
            )}
          </div>,
          document.body
        )}

      {pendingDeleteViewId && (
        <ConfirmDialog
          message={t("confirmDeleteView")}
          confirmLabel={t("delete")}
          cancelLabel={t("cancel")}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDeleteViewId(null)}
        />
      )}
    </div>
  );
}
