"use client";

import { ChevronsDownUp, FolderPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Tooltip } from "@/components/ui/tooltip";
import { NewButton } from "@/components/home/new-button";
import { useFileStore } from "@/stores/file-store";

interface WorkspaceHeaderProps {
  onCreateFile: () => void;
  onCreatePdf: () => void;
  onCreateFolder: () => void;
  onOpenTemplatePicker: () => void;
  onCollapseAll: () => void;
  canCollapseAll?: boolean;
}

function rootLabel(root: string | null): string {
  if (!root) return "";
  const normalized = root.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).pop() ?? normalized;
}

export function WorkspaceHeader({
  onCreateFile,
  onCreatePdf,
  onCreateFolder,
  onOpenTemplatePicker,
  onCollapseAll,
  canCollapseAll = true,
}: WorkspaceHeaderProps) {
  const t = useTranslations("sidebar");
  const openTarget = useFileStore((s) => s.openTarget);
  const rootPath = useFileStore((s) => s.rootPath);
  const openFilePath = useFileStore((s) => s.openFilePath);
  // In file mode the rail represents one loose file. Showing the parent
  // directory's basename + create buttons would invite the user to spray
  // new files into wherever the loose file happened to live, which is
  // almost never their intent.
  const isFileMode = openTarget === "file";
  const label = isFileMode ? rootLabel(openFilePath) : rootLabel(rootPath);
  const titleAttr = isFileMode ? (openFilePath ?? undefined) : (rootPath ?? undefined);

  return (
    <div className="group flex h-11 items-center justify-between gap-2 px-3">
      <h2
        className="text-ui-sm min-w-0 flex-1 truncate font-semibold leading-none text-[var(--sidebar-title)]"
        title={titleAttr}
      >
        {label}
      </h2>
      {!isFileMode && (
        <div className="flex items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
          <NewButton
            onCreateFile={onCreateFile}
            onCreatePdf={onCreatePdf}
            onCreateFolder={onCreateFolder}
            onOpenTemplatePicker={onOpenTemplatePicker}
            hideFolder
          />
          <Tooltip content={t("newFolder")} side="bottom">
            <button
              onClick={onCreateFolder}
              className="sidebar-action-button flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
              aria-label={t("newFolder")}
            >
              <FolderPlus className="h-4 w-4" />
            </button>
          </Tooltip>
          {canCollapseAll && (
            <Tooltip content={t("collapseAll")} side="bottom">
              <button
                onClick={onCollapseAll}
                className="sidebar-action-button flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
                aria-label={t("collapseAll")}
              >
                <ChevronsDownUp className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
