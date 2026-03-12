"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { Database, Loader2 } from "lucide-react";
import { useDatabaseStore } from "@/stores/database-store";
import { DatabaseContainer } from "./database-container";
import { DatabaseCreationDialog } from "./database-creation-dialog";
import type { ViewType } from "@/extensions/database/database-types";

/** View type label used as the default view name when auto-creating */
const VIEW_TYPE_LABELS: Record<string, string> = {
  board: "Board",
  gallery: "Gallery",
  list: "List",
};

export function DatabaseNodeView({ node, updateAttributes, editor: _editor }: NodeViewProps) {
  const t = useTranslations("database");
  const databaseId = node.attrs.databaseId as string | null;
  const defaultViewType = node.attrs.defaultViewType as string | null;
  const loadDatabase = useDatabaseStore((state) => state.loadDatabase);
  const createDatabase = useDatabaseStore((state) => state.createDatabase);
  const isLoaded = useDatabaseStore((state) =>
    databaseId ? !!state.databases[databaseId] : false
  );
  const [error, setError] = useState<string | null>(null);
  const autoCreatingRef = useRef(false);

  // Auto-create database for non-table views (board, gallery, list)
  useEffect(() => {
    if (databaseId || !defaultViewType || defaultViewType === "table") return;
    if (autoCreatingRef.current) return;
    autoCreatingRef.current = true;

    const viewName = VIEW_TYPE_LABELS[defaultViewType] || defaultViewType;
    createDatabase({
      views: [{ name: viewName, type: defaultViewType as ViewType }],
    })
      .then((data) => {
        updateAttributes({ databaseId: data.id, defaultViewType: null });
      })
      .catch(() => {
        setError(t("failedToCreate"));
        autoCreatingRef.current = false;
      });
  }, [databaseId, defaultViewType, createDatabase, updateAttributes, t]);

  // Load existing database data
  useEffect(() => {
    if (!databaseId) return;
    loadDatabase(databaseId).catch(() => {
      setError(t("failedToLoad"));
    });
  }, [databaseId, loadDatabase, t]);

  // No databaseId yet — show creation dialog or auto-creation spinner
  if (!databaseId) {
    // Non-table views auto-create — show spinner
    if (defaultViewType && defaultViewType !== "table") {
      return (
        <NodeViewWrapper data-type="database-block" contentEditable={false}>
          {error ? (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-8">
              <Database className="h-4 w-4 text-destructive" />
              <span className="text-sm text-destructive">{error}</span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-border p-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{t("creation.creating")}</span>
            </div>
          )}
        </NodeViewWrapper>
      );
    }

    // Table view or no view type — show creation dialog
    return (
      <NodeViewWrapper data-type="database-block" contentEditable={false}>
        {error ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-8">
            <Database className="h-4 w-4 text-destructive" />
            <span className="text-sm text-destructive">{error}</span>
          </div>
        ) : (
          <DatabaseCreationDialog
            onCreated={(id) => updateAttributes({ databaseId: id })}
            onError={(msg) => setError(msg)}
          />
        )}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper data-type="database-block" contentEditable={false}>
      {!isLoaded && !error && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-border p-8">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{t("loadingDatabase")}</span>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-8">
          <Database className="h-4 w-4 text-destructive" />
          <span className="text-sm text-destructive">{error}</span>
        </div>
      )}

      {isLoaded && databaseId && <DatabaseContainer databaseId={databaseId} />}
    </NodeViewWrapper>
  );
}
