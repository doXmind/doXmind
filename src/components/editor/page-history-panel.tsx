"use client";

import { useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { hasDesktopBridge, invokeDesktop } from "@/lib/native-shell";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import type { FileItem } from "@/types";

interface PageSnapshot {
  id: string;
  capturedAt: number;
}

export interface PageHistoryServices {
  list: (workspacePath: string) => Promise<PageSnapshot[]>;
  read: (workspacePath: string, id: string) => Promise<string>;
  saveCurrentPage: (pageId: string) => Promise<boolean>;
  restore: (pageId: string, markdown: string) => Promise<void>;
}

const defaultServices: PageHistoryServices = {
  list: async (workspacePath) => {
    const root = useFileStore.getState().rootPath;
    const result = await invokeDesktop<{ snapshots: PageSnapshot[] }>("page_snapshot_list", {
      root,
      path: workspacePath,
    });
    return result.snapshots;
  },
  read: async (workspacePath, id) => {
    const root = useFileStore.getState().rootPath;
    const result = await invokeDesktop<{ markdown: string }>("page_snapshot_read", {
      root,
      path: workspacePath,
      id,
    });
    return result.markdown;
  },
  saveCurrentPage: async (pageId) => {
    if (useFileStore.getState().currentFileId !== pageId) return true;
    const requestSave = useEditorRefStore.getState().requestSave;
    return requestSave ? requestSave() : true;
  },
  // The ordinary revision-guarded write, not a restore command of its own: a snapshot coming back
  // is just another edit, and has to lose to a concurrent external change like any other.
  restore: async (pageId, markdown) => {
    await useFileStore.getState().updateFile(pageId, { content: markdown });
  },
};

export function PageHistoryPanel({
  file,
  services = defaultServices,
}: {
  file: FileItem;
  services?: PageHistoryServices;
}) {
  const t = useTranslations("pageHistory");
  const open = useLayoutStore((state) => state.isVersionHistoryOpen);
  const setOpen = useLayoutStore((state) => state.setVersionHistoryOpen);
  const [snapshots, setSnapshots] = useState<PageSnapshot[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workspacePath = file.storageHandle?.relPath ?? file.storageHandle?.path ?? null;

  useEffect(() => {
    if (!open || !workspacePath) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    services
      .list(workspacePath)
      .then((found) => {
        if (!cancelled) setSnapshots(found);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspacePath, services]);

  const restore = async (snapshot: PageSnapshot) => {
    if (!workspacePath) return;
    setError(null);
    setBusy(true);
    try {
      // Flush first: with a dirty editor the store-driven content change would be overwritten by
      // the pending autosave a moment later.
      if (!(await services.saveCurrentPage(file.id))) {
        setError(t("saveFirst"));
        return;
      }
      const markdown = await services.read(workspacePath, snapshot.id);
      await services.restore(file.id, markdown);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  // Snapshots are written by the Electron write path; in the browser there are none to show.
  if (!hasDesktopBridge() || !workspacePath) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="gap-1.5" aria-label={t("title")}>
          <History className="h-4 w-4" aria-hidden="true" />
          <span className="text-xs">{t("title")}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-3">
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("title")}
        </h3>
        <p className="mb-2 text-[11px] text-muted-foreground">{t("description")}</p>
        {error && <p className="mb-2 text-[11px] text-destructive">{error}</p>}
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {snapshots && snapshots.length === 0 && !busy && (
          <p className="py-4 text-center text-xs text-muted-foreground">{t("empty")}</p>
        )}
        <div className="space-y-1">
          {(snapshots ?? []).map((snapshot) => (
            <Button
              key={snapshot.id}
              type="button"
              variant="ghost"
              disabled={busy}
              className="h-auto w-full justify-start px-2 py-2 text-left text-xs"
              aria-label={t("restoreLabel", {
                time: new Date(snapshot.capturedAt).toLocaleString(),
              })}
              onClick={() => void restore(snapshot)}
            >
              {new Date(snapshot.capturedAt).toLocaleString()}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
