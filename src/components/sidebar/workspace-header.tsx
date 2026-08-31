"use client";

import { ChevronsDownUp, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { NewButton } from "@/components/home/new-button";
import { WorkspaceSwitcher } from "@/components/sidebar/workspace-switcher";
import { useFileStore } from "@/stores/file-store";

interface WorkspaceHeaderProps {
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onOpenTemplatePicker: () => void;
  onCollapseAll: () => void;
  onOpenSearch: () => void;
  canCollapseAll?: boolean;
}

function rootLabel(root: string | null): string {
  if (!root) return "";
  const normalized = root.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).pop() ?? normalized;
}

export function WorkspaceHeader({
  onCreateFile,
  onCreateFolder,
  onOpenTemplatePicker,
  onCollapseAll,
  onOpenSearch,
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
      <WorkspaceSwitcher label={label} titleAttr={titleAttr} />
      {!isFileMode && (
        <div className="flex items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
          <NewButton
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onOpenTemplatePicker={onOpenTemplatePicker}
          />
          <Tooltip content={t("search")} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenSearch}
              className="sidebar-action-button h-7 w-7 rounded-lg"
              aria-label={t("search")}
            >
              <Search className="h-4 w-4" />
            </Button>
          </Tooltip>
          {canCollapseAll && (
            <Tooltip content={t("collapseAll")} side="bottom">
              {/* Same Button as NewButton next to it, not a bare <button>. As a
                  bare button `.sidebar-action-button:hover` won and this filled
                  with the opaque --sidebar-hover while its neighbour filled with
                  the ghost variant's rgba(33,33,33,0.06) — two identical 28px
                  buttons in one cluster hovering to two different colours. */}
              <Button
                variant="ghost"
                size="icon"
                onClick={onCollapseAll}
                className="sidebar-action-button h-7 w-7 rounded-lg"
                aria-label={t("collapseAll")}
              >
                <ChevronsDownUp className="h-4 w-4" />
              </Button>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
