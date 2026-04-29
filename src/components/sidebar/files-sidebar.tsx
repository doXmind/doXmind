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
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { getErrorMessage } from "@/lib/utils";
import { markdownToHtml } from "@/lib/markdown";
import { storeLogger } from "@/lib/logger";
import { useTranslations, useLocale } from "next-intl";

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
    <div className="bg-sidebar flex h-full flex-col border-r border-border/50 text-foreground">
      <div className="px-4 pb-3 pt-3">
        <div className="space-y-1.5">
          <button
            onClick={() => handleCreateFile()}
            className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] font-semibold text-foreground transition-colors hover:bg-accent/70"
          >
            <FileText className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
            <span>{t("newDocument")}</span>
          </button>

          <button
            onClick={openCommandPalette}
            className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] font-semibold text-foreground transition-colors hover:bg-accent/70"
          >
            <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
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

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 px-2.5 pb-4">
          {isLoading && !isSynced ? (
            <FileListSkeleton />
          ) : (
            <FolderTree
              onCreateFile={handleCreateFile}
              onCreateFolder={handleCreateFolder}
              onOpenTemplatePicker={() => setIsTemplatePickerOpen(true)}
              onImportFile={handleImportClick}
              isImporting={isImporting}
            />
          )}
        </div>
      </ScrollArea>

      <BulkActionBar />

      <div className="space-y-1 px-4 pb-7 pt-3">
        <Link
          href="/settings"
          className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[15px] font-semibold text-foreground transition-colors hover:bg-accent/70"
        >
          <Settings className="h-[18px] w-[18px] text-muted-foreground" />
          {t("settings")}
        </Link>
      </div>

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
