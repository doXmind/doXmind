"use client";

import Link from "next/link";
import { FileText, Search, Settings, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Logo } from "@/components/ui/logo";
import { FolderTree } from "./folder-tree";
import { SortDropdown } from "./sort-dropdown";
import { BulkActionBar } from "./bulk-action-bar";
import { TrashPanel } from "./trash-panel";
import { TemplatePicker, getLocalizedFileName, type FileTemplate } from "./template-picker";
import { NewButton } from "@/components/home/new-button";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { getErrorMessage, formatShortcut } from "@/lib/utils";
import { markdownToHtml } from "@/lib/markdown";
import { storeLogger } from "@/lib/logger";
import { useTranslations, useLocale } from "next-intl";

const log = storeLogger.child("FilesSidebar");

export function FilesSidebar() {
  const t = useTranslations("sidebar");
  const locale = useLocale();
  const router = useRouter();
  const {
    files,
    createFile,
    createFolder,
    importFile,
    currentFolderId,
    getFolders,
    isLoading,
    isSynced,
  } = useFileStore();
  const { openCommandPalette } = useLayoutStore();
  const [isImporting, setIsImporting] = useState(false);
  const [isTrashOpen, setIsTrashOpen] = useState(false);
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCreateFile = async () => {
    const currentFiles = files.filter((f) => !f.isFolder && f.parentId === currentFolderId);

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
      const newId = await createFile(name, "", currentFolderId);
      router.push(`/editor/${newId}`);
    } catch (error) {
      log.error("Failed to create file", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const handleTemplateSelect = async (template: FileTemplate) => {
    const currentFiles = files.filter((f) => !f.isFolder && f.parentId === currentFolderId);
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
      const newId = await createFile(name, htmlContent, currentFolderId);
      router.push(`/editor/${newId}`);
    } catch (error) {
      log.error("Failed to create file from template", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
      throw error;
    }
  };

  const handleCreateFolder = async () => {
    const folders = getFolders(currentFolderId);
    const name = `New Folder ${folders.length + 1}`;
    try {
      await createFolder(name, currentFolderId);
    } catch (error) {
      log.error("Failed to create folder", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = "";

    setIsImporting(true);
    const toastId = toast.loading(t("importing", { name: file.name }));
    try {
      const newId = await importFile(file, currentFolderId);
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
    <div className="bg-sidebar flex h-full flex-col border-r border-border/60 text-foreground">
      <div className="px-4 pb-3 pt-4">
        <div className="mb-4 flex items-center gap-2.5">
          <Logo variant="icon" size="sm" className="h-7 w-7 shrink-0" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight text-foreground">
              doXmind
            </div>
            <div className="text-[11px] font-medium text-muted-foreground">
              {t("localWorkspace")}
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <button
            onClick={handleCreateFile}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent/70"
          >
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span>{t("newDocument")}</span>
          </button>

          <button
            onClick={openCommandPalette}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent/70"
          >
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span>{t("search")}</span>
            <kbd className="ml-auto hidden text-[10px] font-semibold text-muted-foreground/70 md:inline">
              {formatShortcut("Ctrl+K")}
            </kbd>
          </button>
        </div>
      </div>

      <div className="px-4 pb-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
            {t("documents")}
          </div>
          <div className="flex items-center gap-1">
            <SortDropdown />
            <NewButton
              onCreateFile={handleCreateFile}
              onCreateFolder={handleCreateFolder}
              onOpenTemplatePicker={() => setIsTemplatePickerOpen(true)}
              onImportFile={handleImportClick}
              isImporting={isImporting}
            />
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.md,.markdown"
        onChange={handleFileSelect}
        className="hidden"
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 px-2 pb-3">
          {isLoading && !isSynced ? <FileListSkeleton /> : <FolderTree />}
        </div>
      </ScrollArea>

      <BulkActionBar />

      <div className="space-y-1 border-t border-border/60 px-3 pb-7 pt-3">
        <button
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
          onClick={() => setIsTrashOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
          {t("trash")}
        </button>
        <Link
          href="/settings"
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/70"
        >
          <Settings className="h-4 w-4 text-muted-foreground" />
          {t("settings")}
        </Link>
      </div>

      <TrashPanel open={isTrashOpen} onClose={() => setIsTrashOpen(false)} />

      <TemplatePicker
        open={isTemplatePickerOpen}
        onClose={() => setIsTemplatePickerOpen(false)}
        onSelect={handleTemplateSelect}
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
