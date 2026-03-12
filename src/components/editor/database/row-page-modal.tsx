"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { X, FileText, Trash2 } from "lucide-react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import type { DatabaseData, CellValue, SelectChoice } from "@/extensions/database/database-types";
import { useDatabaseStore } from "@/stores/database-store";
import { useFileStore } from "@/stores/file-store";
import { api } from "@/lib/api";
import { debounce } from "@/lib/utils";
import { TableCell } from "./table/table-cell";
import { ConfirmDialog } from "./confirm-dialog";

interface RowPageModalProps {
  databaseId: string;
  rowId: string;
  database: DatabaseData;
  onClose: () => void;
}

export function RowPageModal({ databaseId, rowId, database, onClose }: RowPageModalProps) {
  const t = useTranslations("database");
  const { updateRow, updateProperty, deleteRow } = useDatabaseStore();
  const { updateFile } = useFileStore();
  const [pageFileId, setPageFileId] = useState<string | null>(null);
  const [pageContent, setPageContent] = useState<string>("");
  const [loadingPage, setLoadingPage] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const row = database.rows.find((r) => r.id === rowId);

  // Create/get the page file
  useEffect(() => {
    if (!row) return;
    if (row.page_file_id) {
      setPageFileId(row.page_file_id);
      api
        .getFile(row.page_file_id)
        .then((file) => {
          setPageContent(file.content || "");
        })
        .catch(() => {});
    } else {
      setLoadingPage(true);
      api
        .createOrGetRowPage(databaseId, rowId)
        .then((result) => {
          setPageFileId(result.page_file_id);
          setLoadingPage(false);
        })
        .catch(() => setLoadingPage(false));
    }
  }, [databaseId, rowId, row]);

  // Close on Escape (only if no nested dialog open)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !showDeleteConfirm) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, showDeleteConfirm]);

  // Debounced auto-save
  const debouncedSave = useMemo(
    () =>
      debounce((fileId: string, content: string) => {
        updateFile(fileId, { content });
      }, 1000),
    [updateFile]
  );

  // Lightweight TipTap editor for page content
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
        }),
        Placeholder.configure({
          placeholder: t("startWriting"),
        }),
      ],
      content: pageContent || "",
      editable: true,
      immediatelyRender: false,
      onUpdate: ({ editor: ed }) => {
        if (pageFileId) {
          debouncedSave(pageFileId, ed.getHTML());
        }
      },
    },
    [pageFileId, pageContent]
  );

  const handleCellChange = useCallback(
    (propId: string, value: CellValue) => {
      updateRow(databaseId, rowId, { [propId]: value });
    },
    [databaseId, rowId, updateRow]
  );

  const handleChoicesChange = useCallback(
    (propId: string, choices: SelectChoice[]) => {
      updateProperty(databaseId, propId, { options: { choices } });
    },
    [databaseId, updateProperty]
  );

  const handleDelete = useCallback(() => {
    deleteRow(databaseId, rowId);
    onClose();
  }, [databaseId, rowId, deleteRow, onClose]);

  if (!row) return null;

  // Find title from first text property
  const titleProp = database.properties_schema.find((p) => p.type === "text");
  const title = titleProp
    ? (row.properties[titleProp.id] as string) || t("untitledRow")
    : t("untitledRow");

  return createPortal(
    <div className="animate-in fade-in-0 fixed inset-0 z-[60] flex items-center justify-center duration-200">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="animate-in fade-in-0 zoom-in-[0.97] relative z-10 mx-4 flex h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl duration-200">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h2 className="flex-1 text-base font-semibold">{title}</h2>
          <button
            className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
            onClick={() => setShowDeleteConfirm(true)}
            title={t("deleteRow")}
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button className="rounded-md p-1 transition-colors hover:bg-accent" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Properties */}
        <div className="border-b border-border px-5 py-3">
          <div className="space-y-1">
            {database.properties_schema.map((prop) => (
              <div
                key={prop.id}
                className="-mx-1 flex items-center gap-3 rounded-md px-1 transition-colors hover:bg-accent/30"
              >
                <span className="w-32 shrink-0 py-1.5 text-xs font-medium text-muted-foreground/80">
                  {prop.name}
                </span>
                <div className="min-h-[32px] flex-1 rounded-md border border-border/50">
                  <TableCell
                    property={prop}
                    value={row.properties[prop.id] ?? null}
                    onChange={(val) => handleCellChange(prop.id, val)}
                    onChoicesChange={
                      prop.type === "select" ||
                      prop.type === "multi_select" ||
                      prop.type === "status"
                        ? (choices) => handleChoicesChange(prop.id, choices)
                        : undefined
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Page content area - TipTap editor */}
        <div className="flex-1 overflow-y-auto p-5">
          {loadingPage ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              {t("creatingPage")}
            </div>
          ) : pageFileId ? (
            <div className="prose prose-sm max-w-none dark:prose-invert [&_.tiptap]:outline-none [&_.tiptap_p.is-editor-empty:first-child::before]:pointer-events-none [&_.tiptap_p.is-editor-empty:first-child::before]:float-left [&_.tiptap_p.is-editor-empty:first-child::before]:h-0 [&_.tiptap_p.is-editor-empty:first-child::before]:text-muted-foreground/40 [&_.tiptap_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]">
              <EditorContent editor={editor} />
            </div>
          ) : (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground/60">
              {t("startWriting")}
            </div>
          )}
        </div>
      </div>

      {showDeleteConfirm && (
        <ConfirmDialog
          message={t("confirmDeleteRow")}
          confirmLabel={t("delete")}
          cancelLabel={t("cancel")}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>,
    document.body
  );
}
