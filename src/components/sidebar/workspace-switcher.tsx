"use client";

import { useMemo, useState } from "react";
import { ChevronDown, FolderOpen, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { notify } from "@/lib/notifications";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useFileStore } from "@/stores/file-store";
import { useIsTauri } from "@/hooks/use-is-tauri";
import { pickNativeFolder } from "@/lib/native-dialog";
import { openNewWindow } from "@/lib/window";
import { switchWorkspace } from "@/lib/workspace-switch";
import { getErrorMessage } from "@/lib/utils";
import { storeLogger } from "@/lib/logger";
import { cn } from "@/lib/utils";

const log = storeLogger.child("WorkspaceSwitcher");

const RECENT_MENU_LIMIT = 5;

function workspaceLabel(absolutePath: string): { name: string; parent: string } {
  const normalized = absolutePath.replaceAll("\\", "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  const name = parts.pop() ?? normalized;
  const parent = parts.length ? `/${parts.join("/")}` : "/";
  return { name, parent };
}

interface WorkspaceSwitcherProps {
  /** The label shown on the trigger — usually the basename of the active root. */
  label: string;
  /** Full path tooltip for the trigger. */
  titleAttr?: string;
}

export function WorkspaceSwitcher({ label, titleAttr }: WorkspaceSwitcherProps) {
  const t = useTranslations("sidebar");
  const { isTauri: isDesktopShell } = useIsTauri();

  const recents = useFileStore((s) => s.recents);
  const rootPath = useFileStore((s) => s.rootPath);
  const openFilePath = useFileStore((s) => s.openFilePath);
  const openTarget = useFileStore((s) => s.openTarget);
  const closeOpened = useFileStore((s) => s.closeOpened);

  const [pendingFolderPath, setPendingFolderPath] = useState<string | null>(null);

  // Hide the active target from the recents shortlist — pointing at "the
  // workspace you're already in" wastes a slot and is surprising on click.
  const activePath = openTarget === "folder" ? rootPath : openFilePath;
  const recentItems = useMemo(() => {
    return recents
      .filter((entry) => entry.path !== activePath)
      .slice(0, RECENT_MENU_LIMIT)
      .map((entry) => ({ ...entry, ...workspaceLabel(entry.path) }));
  }, [recents, activePath]);

  const handleOpenFolderPicker = async () => {
    if (!isDesktopShell) {
      notify.error(t("openWorkspaceRequiresDesktop"));
      return;
    }
    try {
      const selected = await pickNativeFolder(t("openFolder"));
      if (!selected) return;
      setPendingFolderPath(selected);
    } catch (error) {
      log.error("Failed to pick folder", error);
      const { title, description } = getErrorMessage(error);
      notify.error(title, { description });
    }
  };

  const handleNewWindow = async () => {
    try {
      await openNewWindow();
    } catch (error) {
      log.error("Failed to open new window", error);
      const { title, description } = getErrorMessage(error);
      notify.error(title, { description });
    }
  };

  const handleRecentClick = async (
    entry: { kind: "file" | "folder"; path: string },
    event: React.MouseEvent
  ) => {
    // Cmd/Ctrl click → force new window. Matches the browser/Finder
    // convention so users with the muscle memory don't need a second menu
    // item; the tooltip on the trigger surfaces the hint.
    const newWindow = event.metaKey || event.ctrlKey;
    try {
      await switchWorkspace({ kind: entry.kind, path: entry.path }, { newWindow });
    } catch (error) {
      log.error("Failed to open recent target", error);
      const { title, description } = getErrorMessage(error);
      notify.error(title, { description });
    }
  };

  const handleCloseFolder = () => {
    closeOpened();
  };

  const handleConfirmTarget = async (newWindow: boolean) => {
    const path = pendingFolderPath;
    if (!path) return;
    setPendingFolderPath(null);
    try {
      await switchWorkspace({ kind: "folder", path }, { newWindow });
    } catch (error) {
      log.error("Failed to switch workspace", error);
      const { title, description } = getErrorMessage(error);
      notify.error(title, { description });
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={titleAttr}
            className={cn(
              "group/switcher -mx-1.5 flex min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 py-1 text-left",
              "hover:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            )}
            aria-label={t("switchWorkspace")}
          >
            <span className="text-ui-base min-w-0 flex-1 truncate font-semibold leading-5 text-[var(--sidebar-title)]">
              {label}
            </span>
            <ChevronDown
              className="h-3.5 w-3.5 shrink-0 text-[var(--sidebar-title)] opacity-50 transition-opacity group-hover/switcher:opacity-100"
              aria-hidden="true"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[16rem]">
          {recentItems.length > 0 && (
            <>
              <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
                {t("recentWorkspaces")}
              </DropdownMenuLabel>
              {recentItems.map((entry) => (
                <DropdownMenuItem
                  key={`${entry.kind}:${entry.path}`}
                  onClick={(e) => void handleRecentClick(entry, e)}
                  title={`${entry.path}\n${t("openInNewWindowHint")}`}
                  className="flex flex-col items-start gap-0 py-1.5"
                >
                  <span className="truncate text-sm">{entry.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{entry.parent}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onClick={() => void handleOpenFolderPicker()}>
            <FolderOpen className="mr-2 h-4 w-4" />
            {t("openFolderEllipsis")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void handleNewWindow()}>
            <Plus className="mr-2 h-4 w-4" />
            {t("newWindow")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCloseFolder}>
            <X className="mr-2 h-4 w-4" />
            {t("closeFolder")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <OpenFolderTargetModal
        path={pendingFolderPath}
        onCancel={() => setPendingFolderPath(null)}
        onConfirm={handleConfirmTarget}
      />
    </>
  );
}

interface OpenFolderTargetModalProps {
  path: string | null;
  onCancel: () => void;
  onConfirm: (newWindow: boolean) => void;
}

function OpenFolderTargetModal({ path, onCancel, onConfirm }: OpenFolderTargetModalProps) {
  const t = useTranslations("sidebar");
  const open = path !== null;
  const labelInfo = path ? workspaceLabel(path) : null;

  return (
    <Modal open={open} onClose={onCancel}>
      <ModalHeader onClose={onCancel}>{t("openFolder")}</ModalHeader>
      {labelInfo && (
        <div className="mb-4 rounded-md border border-border bg-muted/30 px-3 py-2">
          <div className="truncate text-sm font-medium">{labelInfo.name}</div>
          <div className="truncate text-xs text-muted-foreground">{labelInfo.parent}</div>
        </div>
      )}
      <p className="text-sm text-muted-foreground">{t("openFolderTargetPrompt")}</p>
      <ModalFooter>
        <Button variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button variant="outline" onClick={() => onConfirm(true)}>
          {t("openInNewWindow")}
        </Button>
        <Button onClick={() => onConfirm(false)}>{t("openInCurrentWindow")}</Button>
      </ModalFooter>
    </Modal>
  );
}
