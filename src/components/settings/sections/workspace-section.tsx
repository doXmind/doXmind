"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Folder, Plus } from "lucide-react";
import { notify } from "@/lib/notifications";
import { useTranslations } from "next-intl";
import { getErrorMessage } from "@/lib/utils";
import { useFileStore } from "@/stores/file-store";
import { useIsTauri } from "@/hooks/use-is-tauri";
import { pickNativeFolder } from "@/lib/native-dialog";
import { FlatCard, SettingsSection } from "../settings-atoms";

export function WorkspaceSection() {
  const t = useTranslations("settings");
  const openTarget = useFileStore((s) => s.openTarget);
  const rootPath = useFileStore((s) => s.rootPath);
  const recents = useFileStore((s) => s.recents);
  const files = useFileStore((s) => s.files);
  const openFolder = useFileStore((s) => s.openFolder);
  const [isOpening, setIsOpening] = useState(false);
  const { isTauri: isDesktop } = useIsTauri();

  const recent = useMemo(() => recents.filter((r) => r.kind === "folder").slice(0, 4), [recents]);
  const currentFolder = openTarget === "folder" ? rootPath : null;

  const docCount = files.filter((f) => !f.isFolder).length;
  const folderCount = files.filter((f) => f.isFolder).length;

  const chooseDirectory = async (title: string) => {
    if (!isDesktop) {
      notify.error(t("workspaceDesktopRequired"));
      return null;
    }
    return await pickNativeFolder(title);
  };

  const handleChange = async () => {
    setIsOpening(true);
    try {
      const selected = await chooseDirectory(t("openWorkspace"));
      if (!selected) return;
      await openFolder(selected);
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      notify.error(title, { description });
    } finally {
      setIsOpening(false);
    }
  };

  const handleOpen = (path: string) => {
    void openFolder(path).catch((error) => {
      const { title, description } = getErrorMessage(error);
      notify.error(title, { description });
    });
  };

  return (
    <SettingsSection id="workspace" title={t("workspace")} desc={t("workspaceDesc")}>
      <FlatCard>
        {/* Active workspace row */}
        <div className="grid grid-cols-[1fr_auto] items-center gap-3.5 border-b border-border/60 px-[18px] py-[18px]">
          <div className="min-w-0">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
              {t("activeWorkspace")}
            </div>
            <div className="mt-1 truncate font-mono text-[13.5px] text-foreground">
              {currentFolder ?? t("workspaceNotSet")}
            </div>
            {currentFolder && (
              <div className="mt-1.5 font-mono text-[11.5px] text-muted-foreground">
                {t("workspaceMeta", { docs: docCount, folders: folderCount })}
              </div>
            )}
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={handleChange}
              disabled={isOpening}
              className="inline-flex h-[26px] items-center gap-1.5 rounded-md border border-foreground bg-foreground px-2.5 text-[11.5px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {t("changeWorkspace")}
            </button>
          </div>
        </div>

        {/* Recent workspaces header */}
        <div className="flex items-center justify-between border-b border-border/60 px-[18px] py-3">
          <div className="text-[11.5px] font-medium text-muted-foreground">
            {t("recentWorkspaces")}
          </div>
          <button
            type="button"
            onClick={handleChange}
            disabled={isOpening}
            className="inline-flex h-[22px] items-center gap-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
          >
            {t("openAnother")} <Plus className="h-3 w-3" />
          </button>
        </div>

        {recent.length === 0 ? (
          <div className="px-[18px] py-3 text-[12px] text-muted-foreground">
            {t("noRecentWorkspaces")}
          </div>
        ) : (
          recent.map((p, i) => (
            <button
              key={p.path}
              type="button"
              onClick={() => handleOpen(p.path)}
              className={`grid w-full grid-cols-[16px_1fr_auto] items-center gap-3 px-[18px] py-2.5 text-left transition-colors hover:bg-secondary ${
                i ? "border-t border-border/60" : ""
              }`}
            >
              <Folder className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate font-mono text-[12px] text-foreground">{p.path}</span>
              <ArrowRight className="h-3 w-3 text-muted-foreground/80" />
            </button>
          ))
        )}
      </FlatCard>
    </SettingsSection>
  );
}
