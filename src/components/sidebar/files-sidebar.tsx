"use client";

import Link from "next/link";
import { FileText, Search, Settings } from "lucide-react";
import { toast } from "sonner";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FolderTree } from "./folder-tree";
import { BulkActionBar } from "./bulk-action-bar";
import { TemplatePicker, getLocalizedFileName, type FileTemplate } from "./template-picker";
import { ImportFolderProgressModal } from "./import-folder-progress";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { getErrorMessage } from "@/lib/utils";
import { markdownToHtml } from "@/lib/markdown";
import { storeLogger } from "@/lib/logger";
import { useTranslations, useLocale } from "next-intl";
import {
  importLocalFolder,
  entriesFromFileList,
  type FolderImportProgress,
} from "@/lib/import-folder";

const log = storeLogger.child("FilesSidebar");

export function FilesSidebar() {
  const t = useTranslations("sidebar");
  const locale = useLocale();
  const router = useRouter();
  const { files, createFile, createFolder, importFile, getFolders, isLoading, isSynced } =
    useFileStore();
  const { openCommandPalette } = useLayoutStore();
  const [isImporting, setIsImporting] = useState(false);
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const folderImportAbortRef = useRef<AbortController | null>(null);
  const [folderImportProgress, setFolderImportProgress] = useState<FolderImportProgress | null>(
    null
  );

  const handleCreateFile = async (parentId: string | null = null) => {
    const currentFiles = files.filter((f) => !f.isFolder && f.parentId === parentId);

    let maxNum = 0;
    currentFiles.forEach((file) => {
      const match = file.name.match(/^Untitled-(\d+)\.md$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    });

    const name = `Untitled-${maxNum + 1}.md`;
    try {
      const newId = await createFile(name, "", parentId);
      router.push(`/editor/${newId}`);
    } catch (error) {
      log.error("Failed to create file", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const handleTemplateSelect = async (template: FileTemplate) => {
    const currentFiles = files.filter((f) => !f.isFolder && f.parentId === null);
    const localName = getLocalizedFileName(template.id, template.defaultFileName, locale);

    let counter = 0;
    let name: string;
    do {
      counter++;
      name = counter === 1 ? `${localName}.md` : `${localName} ${counter}.md`;
    } while (currentFiles.some((f) => f.name === name));

    try {
      const markdown = template.getContent(locale);
      const htmlContent = markdown ? markdownToHtml(markdown) : "";
      const newId = await createFile(name, htmlContent, null);
      router.push(`/editor/${newId}`);
    } catch (error) {
      log.error("Failed to create file from template", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
      throw error;
    }
  };

  const handleCreateFolder = async () => {
    const folders = getFolders(null);
    const name = `New Folder ${folders.length + 1}`;
    try {
      await createFolder(name, null);
    } catch (error) {
      log.error("Failed to create folder", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFolderClick = () => {
    folderInputRef.current?.click();
  };

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files;
    if (!picked || picked.length === 0) return;
    // Snapshot before clearing the input value (some browsers null out
    // FileList once the input resets).
    const filesSnapshot = picked;
    e.target.value = "";

    const abort = new AbortController();
    folderImportAbortRef.current = abort;
    // Seed the modal with a synthetic initial progress so the dialog has
    // something to render before the first onProgress tick.
    setFolderImportProgress({
      total: 0,
      done: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      currentFileName: null,
      rootFolderName: filesSnapshot[0]?.webkitRelativePath.split("/")[0] ?? "—",
      isComplete: false,
      cancelled: false,
    });

    try {
      await importLocalFolder({
        entries: entriesFromFileList(filesSnapshot),
        parentId: null,
        // `silent: true` keeps the import from hijacking the editor: each
        // imported file would otherwise become the active doc, and each
        // created folder would open into rename mode in the sidebar.
        createFolder: (name, parentId) => createFolder(name, parentId, { silent: true }),
        importFile: (file, parentId) => importFile(file, parentId, { silent: true }),
        onProgress: (p) => setFolderImportProgress({ ...p }),
        signal: abort.signal,
      });
    } catch (error) {
      log.error("Folder import failed", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    } finally {
      folderImportAbortRef.current = null;
    }
  };

  const handleFolderImportCancel = () => {
    folderImportAbortRef.current?.abort();
  };

  const handleFolderImportClose = () => {
    setFolderImportProgress(null);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = "";

    setIsImporting(true);
    const toastId = toast.loading(t("importing", { name: file.name }));
    try {
      const newId = await importFile(file, null);
      router.push(`/editor/${newId}`);
      toast.success(t("imported", { name: file.name }), { id: toastId });
    } catch (error) {
      log.error("Failed to import file", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { id: toastId, description });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="sidebar-glass flex h-full flex-col border-r border-[var(--sidebar-active-border)] text-foreground">
      <div className="px-3 pb-2 pt-2">
        <div className="space-y-0.5">
          <button
            onClick={() => handleCreateFile()}
            className="text-ui-base flex h-8 w-full items-center gap-3 rounded-lg px-2.5 text-left font-semibold text-foreground transition-colors hover:bg-[var(--sidebar-hover)]"
          >
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span>{t("newDocument")}</span>
          </button>

          <button
            onClick={openCommandPalette}
            className="text-ui-base flex h-8 w-full items-center gap-3 rounded-lg px-2.5 text-left font-semibold text-foreground transition-colors hover:bg-[var(--sidebar-hover)]"
          >
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span>{t("search")}</span>
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.md,.markdown"
        onChange={handleFileSelect}
        className="hidden"
      />
      {/* `webkitdirectory` / `directory` aren't in React's input typings,
          so the spread carries them through as plain HTML attributes.
          Setting them at JSX time (rather than via a mount effect) makes
          sure they exist before the very first `.click()` could fire. */}
      <input
        ref={folderInputRef}
        type="file"
        multiple
        onChange={handleFolderSelect}
        className="hidden"
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
      />

      <ScrollArea className="sidebar-scrollbar min-h-0 flex-1">
        <div className="space-y-1 px-2.5 pb-3">
          {isLoading && !isSynced ? (
            <FileListSkeleton />
          ) : (
            <FolderTree
              onCreateFile={handleCreateFile}
              onCreateFolder={handleCreateFolder}
              onOpenTemplatePicker={() => setIsTemplatePickerOpen(true)}
              onImportFile={handleImportClick}
              onImportFolder={handleImportFolderClick}
              isImporting={isImporting}
            />
          )}
        </div>
      </ScrollArea>

      <BulkActionBar />

      <div className="space-y-0.5 px-3 pb-3 pt-2">
        <Link
          href="/settings"
          className="text-ui-base flex h-8 w-full items-center gap-3 rounded-lg px-2.5 font-semibold text-foreground transition-colors hover:bg-[var(--sidebar-hover)]"
        >
          <Settings className="h-4 w-4 text-muted-foreground" />
          {t("settings")}
        </Link>
      </div>

      <TemplatePicker
        open={isTemplatePickerOpen}
        onClose={() => setIsTemplatePickerOpen(false)}
        onSelect={handleTemplateSelect}
      />

      <ImportFolderProgressModal
        open={folderImportProgress !== null}
        progress={folderImportProgress}
        onCancel={handleFolderImportCancel}
        onClose={handleFolderImportClose}
      />
    </div>
  );
}

/** Skeleton placeholder shown while file list loads from backend */
function FileListSkeleton() {
  return (
    <div className="space-y-1">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-2">
          <div className="h-4 w-4 animate-pulse rounded bg-muted" />
          <div className="flex flex-1 flex-col gap-1">
            <div
              className="h-3.5 animate-pulse rounded bg-muted"
              style={{ width: `${50 + i * 12}%` }}
            />
            <div className="h-2.5 w-16 animate-pulse rounded bg-muted/60" />
          </div>
        </div>
      ))}
    </div>
  );
}
