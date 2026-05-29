"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { notify } from "@/lib/notifications";
import { useFileStore } from "@/stores/file-store";
import { getErrorMessage } from "@/lib/utils";
import { storeLogger } from "@/lib/logger";
import { useIsTauri } from "@/hooks/use-is-tauri";
import { pickNativeFolder } from "@/lib/native-dialog";
import { navigateToEditorFile } from "@/lib/editor-navigation";
import { documentTypeFromName } from "@/lib/document-types";
import { StratigraphyWelcome } from "@/components/welcome/stratigraphy";
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
  const { isTauri: isDesktopShell } = useIsTauri();

  const recentsRaw = useFileStore((s) => s.recents);
  const openTarget = useFileStore((s) => s.openTarget);
  const rootPath = useFileStore((s) => s.rootPath);
  const openFilePath = useFileStore((s) => s.openFilePath);
  const openFolder = useFileStore((s) => s.openFolder);
  const openFile = useFileStore((s) => s.openFile);
  const createFile = useFileStore((s) => s.createFile);
  const nextUntitledName = useFileStore((s) => s.nextUntitledName);
  const createTransientFile = useFileStore((s) => s.createTransientFile);

  // With a mounted folder, New creates a real Markdown file in that workspace.
  // Without one, it starts an untitled buffer and asks for a save location on
  // first persist, matching the first-run "Start writing" path.
  const hasWorkspace = openTarget === "folder" && rootPath !== null;

  const recentWorkspaces = useMemo<WelcomeRecentWorkspace[]>(() => {
    const skip = openTarget === "folder" ? rootPath : null;
    return recentsRaw
      .filter((entry) => entry.kind === "folder" && entry.path !== skip)
      .slice(0, RECENT_WORKSPACE_LIMIT)
      .map((entry) => {
        const { name, parent } = workspaceLabel(entry.path);
        return { path: entry.path, name, parent };
      });
  }, [recentsRaw, openTarget, rootPath]);

  const recentFiles = useMemo<WelcomeRecentFile[]>(() => {
    // Only standalone files belong here — a file that lives inside a recent
    // workspace is represented by that workspace folder (VSCode-style), so we
    // drop it. This also sweeps out documents that older builds recorded as
    // file recents before workspace docs stopped being tracked individually.
    const workspaceDirs = recentsRaw
      .filter((entry) => entry.kind === "folder")
      .map((entry) => entry.path.replace(/\/+$/, ""));
    const isInsideWorkspace = (filePath: string) =>
      workspaceDirs.some((dir) => filePath === dir || filePath.startsWith(`${dir}/`));
    return recentsRaw
      .filter(
        (entry) =>
          entry.kind === "file" && entry.path !== openFilePath && !isInsideWorkspace(entry.path)
      )
      .slice(0, RECENT_FILE_LIMIT)
      .map((entry) => {
        const { name, parent } = workspaceLabel(entry.path);
        return {
          absolutePath: entry.path,
          workspacePath: parent,
          name,
          documentType: documentTypeFromName(name),
          lastOpened: "",
          editCount: 0,
          wordCount: 0,
          preview: parent,
        };
      });
  }, [recentsRaw, openFilePath]);

  const handleOpenFolder = async () => {
    if (!isDesktopShell) {
      notify.error(tSidebar("openWorkspaceRequiresDesktop"));
      return;
    }
    try {
      const selected = await pickNativeFolder(tSidebar("openFolder"));
      if (!selected) return;
      await openFolder(selected);
    } catch (error) {
      log.error("Failed to open folder", error);
      const { title, description } = getErrorMessage(error);
      notify.error(title, { description });
    }
  };

  const handleCreateNew = async () => {
    const name = nextUntitledName();
    if (!hasWorkspace) {
      handleStartWriting();
      return;
    }
    try {
      const newId = await createFile(name, "", null, { documentType: "markdown" });
      navigateToEditorFile(newId);
    } catch (error) {
      log.error("Failed to create new document", error);
      const { title, description } = getErrorMessage(error);
      notify.error(title, { description });
    }
  };

  // VSCode-style: spin up an in-memory untitled buffer and route to it.
  // The editor will prompt for a save location on the first persist via
  // pickNativeSaveLocation. Available regardless of hasWorkspace — that's
  // the whole point of the transient buffer pathway.
  const handleStartWriting = () => {
    try {
      const name = nextUntitledName();
      const id = createTransientFile(name);
      navigateToEditorFile(id);
    } catch (error) {
      log.error("Failed to start untitled buffer", error);
      const { title, description } = getErrorMessage(error);
      notify.error(title, { description });
    }
  };

  const handleOpenRecentWorkspace = async (path: string) => {
    try {
      await openFolder(path);
    } catch (error) {
      log.error("Failed to open recent workspace", error);
      const { title, description } = getErrorMessage(error);
      notify.error(title, { description });
    }
  };

  const handleOpenRecentFile = async (file: WelcomeRecentFile) => {
    try {
      await openFile(file.absolutePath);
    } catch (error) {
      log.error("Failed to open recent file", error);
      const { title, description } = getErrorMessage(error);
      notify.error(title, { description });
    }
  };

  const variantProps: WelcomeVariantProps = {
    recentFiles,
    recentWorkspaces,
    isDesktopShell,
    hasWorkspace,
    onOpenFolder: handleOpenFolder,
    onCreateNew: handleCreateNew,
    onStartWriting: handleStartWriting,
    onOpenRecentFile: handleOpenRecentFile,
    onOpenRecentWorkspace: handleOpenRecentWorkspace,
  };

  return <StratigraphyWelcome {...variantProps} />;
}
