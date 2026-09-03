"use client";

import { navigateToEditorFile } from "@/lib/editor-navigation";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useEditorStore } from "@/stores/editor-store";
import { useFileStore } from "@/stores/file-store";
import type { PagePropertiesPatch } from "@/lib/page-properties";
import type { FileItem } from "@/types";

const DAILY_NOTES_FOLDER = "Daily Notes";

export interface DailyNoteWorkspace {
  files: FileItem[];
  createFolder: (
    name: string,
    parentId?: string | null,
    options?: { silent?: boolean }
  ) => Promise<string>;
  createFile: (
    name: string,
    markdown?: string,
    parentId?: string | null,
    properties?: PagePropertiesPatch
  ) => Promise<string>;
  requestCurrentFile: (id: string | null) => Promise<boolean>;
  prepareNavigation: () => Promise<boolean>;
}

/** Local calendar identity; deliberately does not round-trip through UTC. */
export function dailyNoteKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Open or create one Daily Note as an ordinary folder plus Markdown Page. */
export async function openOrCreateDailyNote(
  workspace: DailyNoteWorkspace,
  date = new Date()
): Promise<string | null> {
  if (!(await workspace.prepareNavigation())) return null;

  const key = dailyNoteKey(date);
  const existingFolder = workspace.files.find(
    (file) => file.isFolder && file.parentId === null && file.name === DAILY_NOTES_FOLDER
  );
  const existingPage = existingFolder
    ? workspace.files.find(
        (file) =>
          !file.isFolder && file.parentId === existingFolder.id && isDailyNotePage(file, key)
      )
    : undefined;

  if (existingPage) {
    return (await workspace.requestCurrentFile(existingPage.id)) ? existingPage.id : null;
  }

  const folderId =
    existingFolder?.id ??
    (await workspace.createFolder(DAILY_NOTES_FOLDER, null, {
      silent: true,
    }));
  return workspace.createFile(`${key}.md`, `# ${key}\n\n`, folderId, {
    date: key,
  });
}

/** Store Adapter used by the command palette and workspace home. */
export async function openTodayDailyNote(date = new Date()): Promise<string | null> {
  const state = useFileStore.getState();
  if (state.openTarget !== "folder") {
    throw new Error("Daily Notes require an open folder workspace");
  }

  const pageId = await openOrCreateDailyNote(
    {
      files: state.files,
      createFolder: state.createFolder,
      createFile: state.createFile,
      requestCurrentFile: state.requestCurrentFile,
      prepareNavigation: async () => {
        if (!useEditorStore.getState().isDirty) return true;
        const requestSave = useEditorRefStore.getState().requestSave;
        return requestSave ? requestSave() : false;
      },
    },
    date
  );
  if (!pageId) return null;
  return (await navigateToEditorFile(pageId)) ? pageId : null;
}

function isDailyNotePage(file: FileItem, key: string): boolean {
  const storedPath = file.storageHandle?.relPath ?? file.storageHandle?.path;
  const fileName = storedPath
    ? (storedPath.replaceAll("\\", "/").split("/").at(-1) ?? "")
    : file.name;
  const normalized = fileName.toLocaleLowerCase();
  return (
    normalized === `${key}.md` ||
    normalized === `${key}.markdown` ||
    (!storedPath && file.documentType === "markdown" && normalized === key)
  );
}
