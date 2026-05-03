"use client";

import Link from "next/link";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import { useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FolderTree, type FolderTreeHandle } from "./folder-tree";
import { BulkActionBar } from "./bulk-action-bar";
import { TemplatePicker, getLocalizedFileName, type FileTemplate } from "./template-picker";
import { WorkspaceHeader } from "./workspace-header";
import { useFileStore } from "@/stores/file-store";
import { getErrorMessage } from "@/lib/utils";
import { markdownToHtml } from "@/lib/markdown";
import { storeLogger } from "@/lib/logger";
import { navigateToEditorFile } from "@/lib/editor-navigation";
import { useTranslations, useLocale } from "next-intl";

const log = storeLogger.child("FilesSidebar");

export function FilesSidebar() {
  const t = useTranslations("sidebar");
  const locale = useLocale();
  const createFile = useFileStore((s) => s.createFile);
  const createFolder = useFileStore((s) => s.createFolder);
  const files = useFileStore((s) => s.files);
  const isLoading = useFileStore((s) => s.isLoading);
  const isSynced = useFileStore((s) => s.isSynced);
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);
  const folderTreeRef = useRef<FolderTreeHandle>(null);

  const handleCreateFile = async (parentId: string | null = null) => {
    const currentFiles = useFileStore
      .getState()
      .files.filter((f) => !f.isFolder && f.parentId === parentId);

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
      const newId = await createFile(name, "", parentId, { documentType: "markdown" });
      navigateToEditorFile(newId);
    } catch (error) {
      log.error("Failed to create file", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const handleCreatePdf = async (parentId: string | null = null) => {
    const currentFiles = useFileStore
      .getState()
      .files.filter((f) => !f.isFolder && f.parentId === parentId);

    let maxNum = 0;
    currentFiles.forEach((file) => {
      const match = file.name.match(/^Untitled-(\d+)\.pdf$/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    });

    const name = `Untitled-${maxNum + 1}.pdf`;
    try {
      const newId = await createFile(name, "", parentId, { documentType: "pdf" });
      navigateToEditorFile(newId);
    } catch (error) {
      log.error("Failed to create PDF", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const handleTemplateSelect = async (template: FileTemplate) => {
    const currentFiles = useFileStore
      .getState()
      .files.filter((f) => !f.isFolder && f.parentId === null);
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
      navigateToEditorFile(newId);
    } catch (error) {
      log.error("Failed to create file from template", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
      throw error;
    }
  };

  const handleCreateFolder = async (parentId: string | null = null) => {
    const folders = useFileStore.getState().getFolders(parentId);
    const name = `New Folder ${folders.length + 1}`;
    try {
      await createFolder(name, parentId);
    } catch (error) {
      log.error("Failed to create folder", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  return (
    <div className="sidebar-glass flex h-full flex-col border-r border-[var(--sidebar-active-border)] text-[var(--sidebar-text)]">
      <WorkspaceHeader
        onCreateFile={() => handleCreateFile(null)}
        onCreatePdf={() => handleCreatePdf(null)}
        onCreateFolder={() => handleCreateFolder(null)}
        onOpenTemplatePicker={() => setIsTemplatePickerOpen(true)}
        onCollapseAll={() => folderTreeRef.current?.collapseAll()}
        canCollapseAll={files.some((file) => file.isFolder)}
      />

      <ScrollArea className="min-h-0 flex-1">
        {/* min-h-full lets FolderTree's spacer reach the bottom of the
            scroll viewport so right-clicks on empty space below the
            last row still hit the empty-area context menu. */}
        <div className="flex min-h-full flex-col px-2.5 pb-3 pt-2">
          {isLoading && !isSynced ? (
            <FileListSkeleton />
          ) : (
            <FolderTree
              ref={folderTreeRef}
              onCreateFile={handleCreateFile}
              onCreatePdf={handleCreatePdf}
              onCreateFolder={handleCreateFolder}
            />
          )}
        </div>
      </ScrollArea>

      <BulkActionBar />

      <div className="px-3 pb-3 pt-2">
        <Link
          href="/settings"
          className="text-ui-base flex h-8 w-full items-center gap-3 rounded-lg px-2.5 font-semibold text-[var(--sidebar-text)] transition-colors hover:bg-[var(--sidebar-hover)]"
        >
          <Settings className="h-4 w-4 text-[var(--sidebar-icon)]" />
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
