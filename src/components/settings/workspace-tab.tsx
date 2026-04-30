"use client";

import { useMemo, useState } from "react";
import { DatabaseBackup, FolderOpen, HardDrive, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { useFileStore } from "@/stores/file-store";

export function WorkspaceTab() {
  const t = useTranslations("settings");
  const workspaceMode = useFileStore((state) => state.workspaceMode);
  const workspaceRoot = useFileStore((state) => state.workspaceRoot);
  const recentWorkspaces = useFileStore((state) => state.recentWorkspaces);
  const openDiskWorkspace = useFileStore((state) => state.openDiskWorkspace);
  const switchToDbWorkspace = useFileStore((state) => state.switchToDbWorkspace);
  const [isMigrating, setIsMigrating] = useState(false);
  const [isOpening, setIsOpening] = useState(false);

  const isDesktop = typeof window !== "undefined" && "__TAURI_BACKEND_URL__" in window;
  const recent = useMemo(() => recentWorkspaces.slice(0, 4), [recentWorkspaces]);

  const chooseDirectory = async (title: string) => {
    if (!isDesktop) {
      toast.error(t("workspaceDesktopRequired"));
      return null;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false, title });
    return selected && !Array.isArray(selected) ? selected : null;
  };

  const handleOpenWorkspace = async () => {
    setIsOpening(true);
    try {
      const selected = await chooseDirectory(t("openWorkspace"));
      if (!selected) return;
      await openDiskWorkspace(selected);
      toast.success(t("workspaceOpened"));
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    } finally {
      setIsOpening(false);
    }
  };

  const handleMigrate = async () => {
    setIsMigrating(true);
    try {
      const selected = await chooseDirectory(t("migrateLibrary"));
      if (!selected) return;
      const result = await api.migrateDbToWorkspace(selected);
      await openDiskWorkspace(result.output_root);
      toast.success(t("migrationComplete"), {
        description: t("migrationCompleteDesc", {
          docs: result.documents_exported,
          folders: result.folders_exported,
        }),
      });
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">{t("workspace")}</h2>
        <div className="rounded-lg border border-border/40 bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <HardDrive className="h-4 w-4 text-muted-foreground" />
                {workspaceMode === "disk" ? t("diskWorkspace") : t("dbWorkspace")}
              </div>
              <p className="truncate text-sm text-muted-foreground">
                {workspaceMode === "disk" && workspaceRoot ? workspaceRoot : t("dbWorkspaceDesc")}
              </p>
            </div>
            {workspaceMode === "disk" && (
              <Button variant="outline" size="sm" onClick={switchToDbWorkspace}>
                <RotateCcw className="mr-2 h-4 w-4" />
                {t("returnToDb")}
              </Button>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleOpenWorkspace} disabled={isOpening}>
              <FolderOpen className="mr-2 h-4 w-4" />
              {t("openWorkspace")}
            </Button>
            <Button onClick={handleMigrate} disabled={isMigrating}>
              <DatabaseBackup className="mr-2 h-4 w-4" />
              {isMigrating ? t("migratingLibrary") : t("migrateLibrary")}
            </Button>
          </div>
        </div>
      </section>

      {recent.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">{t("recentWorkspaces")}</h2>
          <div className="rounded-lg border border-border/40 bg-card p-2">
            {recent.map((root) => (
              <button
                key={root}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => openDiskWorkspace(root)}
              >
                <FolderOpen className="h-4 w-4 shrink-0" />
                <span className="truncate">{root}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
