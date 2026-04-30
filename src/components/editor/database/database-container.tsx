"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { useDatabaseStore } from "@/stores/database-store";
import { useFileStore } from "@/stores/file-store";
import type { DatabaseData } from "@/extensions/database/database-types";
import { ViewTabs } from "./view-tabs";
import { DatabaseToolbar } from "./database-toolbar";
import { TableView } from "./views/table-view";
import { BoardView } from "./views/board-view";
import { GalleryView } from "./views/gallery-view";
import { ListView } from "./views/list-view";
import { RowPageModal } from "./row-page-modal";
import { PropertyEditor } from "./property-editor";

interface DatabaseContainerProps {
  databaseId: string;
}

export function DatabaseContainer({ databaseId }: DatabaseContainerProps) {
  const t = useTranslations("database");
  const workspaceMode = useFileStore((s) => s.workspaceMode);

  // Manual subscription bypasses useSyncExternalStore which doesn't reliably
  // trigger re-renders inside TipTap's memo-wrapped portals in React 19.
  // useState + subscribe guarantees re-renders via React's native setState.
  const [database, setDatabase] = useState<DatabaseData | undefined>(
    () => useDatabaseStore.getState().databases[databaseId]
  );
  const [activeViewIds, setActiveViewIds] = useState(
    () => useDatabaseStore.getState().activeViewIds
  );

  useEffect(() => {
    // Sync immediately in case state changed between render and effect
    const s = useDatabaseStore.getState();
    setDatabase(s.databases[databaseId]);
    setActiveViewIds(s.activeViewIds);

    return useDatabaseStore.subscribe((state) => {
      setDatabase(state.databases[databaseId]);
      setActiveViewIds(state.activeViewIds);
    });
  }, [databaseId]);

  // Action refs are stable (created once in store), safe to read directly
  const { updateDatabase } = useDatabaseStore.getState();

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [rowPageModalRowId, setRowPageModalRowId] = useState<string | null>(null);
  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(null);
  const [showAddProperty, setShowAddProperty] = useState(false);
  const [insertPosition, setInsertPosition] = useState<number | undefined>();
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(
    null
  );
  const titleRef = useRef<HTMLInputElement>(null);

  const activeViewId = database ? (activeViewIds[databaseId] ?? database.views[0]?.id) : undefined;
  const activeView = database
    ? (database.views.find((v) => v.id === activeViewId) ?? database.views[0])
    : undefined;

  const dbTitle = database?.title;
  useEffect(() => {
    if (dbTitle !== undefined) setTitleDraft(dbTitle);
  }, [dbTitle]);

  useEffect(() => {
    if (editingTitle) titleRef.current?.focus();
  }, [editingTitle]);

  const commitTitle = useCallback(() => {
    const db = useDatabaseStore.getState().databases[databaseId];
    if (!db) return;
    setEditingTitle(false);
    if (titleDraft.trim() !== db.title) {
      updateDatabase(databaseId, {
        title: titleDraft.trim() || t("untitled"),
      });
    }
  }, [titleDraft, databaseId, updateDatabase, t]);

  const handleOpenRowPage = useCallback(
    (rowId: string) => {
      if (workspaceMode === "disk") return;
      setRowPageModalRowId(rowId);
    },
    [workspaceMode]
  );

  const handleEditProperty = useCallback((propId: string, pos?: { top: number; left: number }) => {
    setEditingPropertyId(propId);
    setShowAddProperty(false);
    if (pos) setPopoverPosition(pos);
  }, []);

  const handleAddProperty = useCallback((pos?: { top: number; left: number }) => {
    setShowAddProperty(true);
    setEditingPropertyId(null);
    setInsertPosition(undefined);
    if (pos) setPopoverPosition(pos);
  }, []);

  const handleOpenFilterPanel = useCallback(() => {
    setShowFilterPanel(true);
  }, []);

  const handleClosePropertyEditor = useCallback(() => {
    setEditingPropertyId(null);
    setShowAddProperty(false);
    setInsertPosition(undefined);
    setPopoverPosition(null);
  }, []);

  if (!database || !activeView) return null;

  const editingProperty = editingPropertyId
    ? database.properties_schema.find((p) => p.id === editingPropertyId)
    : undefined;

  return (
    <div className="w-full">
      {/* Title */}
      <div className="px-4 pb-1 pt-4">
        <input
          ref={titleRef}
          className="-mx-1 w-full cursor-text rounded-md border-none bg-transparent px-1 py-0.5 text-xl font-bold outline-none transition-colors placeholder:text-muted-foreground/40 hover:bg-accent/50 focus:bg-transparent"
          readOnly={!editingTitle}
          placeholder={t("untitledRow")}
          value={editingTitle ? titleDraft : database.title}
          onClick={() => {
            if (!editingTitle) {
              setTitleDraft(database.title);
              setEditingTitle(true);
            }
          }}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => {
            if (editingTitle) commitTitle();
          }}
          onKeyDown={(e) => {
            if (!editingTitle) return;
            if (e.key === "Enter") commitTitle();
            if (e.key === "Escape") {
              setTitleDraft(database.title);
              setEditingTitle(false);
              e.currentTarget.blur();
            }
          }}
        />
      </div>

      {/* View tabs */}
      <ViewTabs databaseId={database.id} views={database.views} activeViewId={activeView.id} />

      {/* Toolbar */}
      <DatabaseToolbar
        database={database}
        view={activeView}
        showFilterPanel={showFilterPanel}
        onShowFilterPanel={setShowFilterPanel}
      />

      {/* View content */}
      {activeView.type === "table" && (
        <TableView
          database={database}
          view={activeView}
          onOpenRowPage={handleOpenRowPage}
          onEditProperty={handleEditProperty}
          onAddProperty={handleAddProperty}
          onOpenFilterPanel={handleOpenFilterPanel}
        />
      )}
      {activeView.type === "board" && (
        <BoardView database={database} view={activeView} onOpenRowPage={handleOpenRowPage} />
      )}
      {activeView.type === "gallery" && (
        <GalleryView database={database} view={activeView} onOpenRowPage={handleOpenRowPage} />
      )}
      {activeView.type === "list" && (
        <ListView database={database} view={activeView} onOpenRowPage={handleOpenRowPage} />
      )}

      {/* Property editor popover */}
      {(editingPropertyId || showAddProperty) &&
        popoverPosition &&
        createPortal(
          <div className="fixed inset-0 z-[90]" onClick={handleClosePropertyEditor}>
            <div
              className="animate-in fade-in-0 zoom-in-95 fixed z-[95] rounded-lg border border-border bg-popover shadow-lg duration-150"
              style={{
                top: Math.min(popoverPosition.top, window.innerHeight - 420),
                left: Math.min(Math.max(8, popoverPosition.left), window.innerWidth - 296),
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <PropertyEditor
                databaseId={database.id}
                existingProperty={editingProperty}
                insertPosition={insertPosition}
                onClose={handleClosePropertyEditor}
              />
            </div>
          </div>,
          document.body
        )}

      {/* Row page modal */}
      {rowPageModalRowId && (
        <RowPageModal
          databaseId={database.id}
          rowId={rowPageModalRowId}
          database={database}
          onClose={() => setRowPageModalRowId(null)}
        />
      )}
    </div>
  );
}
