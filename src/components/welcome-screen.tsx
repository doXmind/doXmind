"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useFileStore } from "@/stores/file-store";
import { useAppearanceStore } from "@/stores/appearance-store";
import { getErrorMessage } from "@/lib/utils";
import { storeLogger } from "@/lib/logger";
import { useIsTauri } from "@/hooks/use-is-tauri";
import { pickNativeFolder } from "@/lib/native-dialog";
import { navigateToEditorFile } from "@/lib/editor-navigation";
import { ContinuumWelcome } from "@/components/welcome/continuum";
import { StratigraphyWelcome } from "@/components/welcome/stratigraphy";
import { TerminalWelcome } from "@/components/welcome/terminal";
import { PaperWelcome } from "@/components/welcome/paper";
import type {
  WelcomeRecentFile,
  WelcomeRecentWorkspace,
  WelcomeVariantProps,
} from "@/components/welcome/types";

const log = storeLogger.child("Welcome");

const RECENT_FILE_LIMIT = 12;
const RECENT_WORKSPACE_LIMIT = 8;

function workspaceLabel(absolutePath: string): { name: string; parent: string } {
  const normalized = absolutePath.replaceAll("\\", "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  const name = parts.pop() ?? normalized;
  const parent = parts.length ? `/${parts.join("/")}` : "/";
  return { name, parent };
}

export function WelcomeScreen() {
  const tSidebar = useTranslations("sidebar");
  const welcomeMode = useAppearanceStore((s) => s.welcomeMode);
  const { isTauri: isDesktopShell } = useIsTauri();

  const recentWorkspacesRaw = useFileStore((s) => s.recentWorkspaces);
  const recentFilesRaw = useFileStore((s) => s.recentFiles);
  const workspaceRoot = useFileStore((s) => s.workspaceRoot);
  const isSingleFileMode = useFileStore((s) => s.isSingleFileMode);
  const openDiskWorkspace = useFileStore((s) => s.openDiskWorkspace);
  const openRecentFile = useFileStore((s) => s.openRecentFile);
  const createFile = useFileStore((s) => s.createFile);

  // The "New" action only makes sense when a folder is mounted — a new
  // file needs somewhere to live. Single-file mode counts as "no workspace"
  // because the loose file's parent dir isn't ours to write into.
  const hasWorkspace = workspaceRoot !== null && !isSingleFileMode;

  const recentWorkspaces = useMemo<WelcomeRecentWorkspace[]>(() => {
    const skip = isSingleFileMode ? null : workspaceRoot;
    return recentWorkspacesRaw
      .filter((p) => p !== skip)
      .slice(0, RECENT_WORKSPACE_LIMIT)
      .map((path) => {
        const { name, parent } = workspaceLabel(path);
        return { path, name, parent };
      });
  }, [recentWorkspacesRaw, workspaceRoot, isSingleFileMode]);

  const recentFiles = useMemo<WelcomeRecentFile[]>(() => {
    return recentFilesRaw
      .slice()
      .sort((a, b) => new Date(b.lastOpened).getTime() - new Date(a.lastOpened).getTime())
      .slice(0, RECENT_FILE_LIMIT);
  }, [recentFilesRaw]);

  const handleOpenFolder = async () => {
    if (!isDesktopShell) {
      toast.error(tSidebar("openWorkspaceRequiresDesktop"));
      return;
    }
    try {
      const selected = await pickNativeFolder(tSidebar("openFolder"));
      if (!selected) return;
      await openDiskWorkspace(selected);
      toast.success(tSidebar("workspaceOpened"));
    } catch (error) {
      log.error("Failed to open folder", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const handleCreateNew = async () => {
    if (!hasWorkspace) return;
    // Mirror the sidebar's Untitled-N convention so the new file slots in
    // next to whatever the user already has at the root.
    const rootFiles = useFileStore
      .getState()
      .files.filter((f) => !f.isFolder && f.parentId === null);
    let maxNum = 0;
    for (const file of rootFiles) {
      const match = file.name.match(/^Untitled-(\d+)\.md$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
    const name = `Untitled-${maxNum + 1}.md`;
    try {
      const newId = await createFile(name, "", null, { documentType: "markdown" });
      navigateToEditorFile(newId);
    } catch (error) {
      log.error("Failed to create new document", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const handleOpenRecentWorkspace = async (path: string) => {
    try {
      await openDiskWorkspace(path);
    } catch (error) {
      log.error("Failed to open recent workspace", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const handleOpenRecentFile = async (file: WelcomeRecentFile) => {
    try {
      await openRecentFile(file);
    } catch (error) {
      log.error("Failed to open recent file", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const variantProps: WelcomeVariantProps = {
    recentFiles,
    recentWorkspaces,
    isDesktopShell,
    hasWorkspace,
    onOpenFolder: handleOpenFolder,
    onCreateNew: handleCreateNew,
    onOpenRecentFile: handleOpenRecentFile,
    onOpenRecentWorkspace: handleOpenRecentWorkspace,
  };

  switch (welcomeMode) {
    case "continuum":
      return <ContinuumWelcome {...variantProps} />;
    case "terminal":
      return <TerminalWelcome {...variantProps} />;
    case "paper":
      return <PaperWelcome {...variantProps} />;
    case "stratigraphy":
    default:
      return <StratigraphyWelcome {...variantProps} />;
  }
}
