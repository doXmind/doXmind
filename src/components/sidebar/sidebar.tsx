"use client";

import {
  FilePlus,
  Loader2,
  Upload,
  Search,
  FolderPlus,
  Trash2,
  LayoutTemplate,
} from "lucide-react";
import { toast } from "sonner";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip } from "@/components/ui/tooltip";
import { FolderTree } from "./folder-tree";
import { SortDropdown } from "./sort-dropdown";
import { BulkActionBar } from "./bulk-action-bar";
import { TrashPanel } from "./trash-panel";
import { TemplatePicker, type FileTemplate } from "./template-picker";
import { GettingStartedChecklist } from "@/components/onboarding/getting-started-checklist";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { getErrorMessage, formatShortcut } from "@/lib/utils";
import { markdownToHtml } from "@/lib/markdown";
import { storeLogger } from "@/lib/logger";

const log = storeLogger.child("Sidebar");

export function Sidebar() {
  const router = useRouter();
  const { files, createFile, createFolder, importFile, currentFolderId, getFolders } =
    useFileStore();
  const { openCommandPalette } = useLayoutStore();
  const [isImporting, setIsImporting] = useState(false);
  const [isTrashOpen, setIsTrashOpen] = useState(false);
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCreateFile = async () => {
    // Get files in current location (folder or root)
    const currentFiles = files.filter((f) => !f.isFolder && f.parentId === currentFolderId);

    // Find the highest Untitled-X number
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

    // Generate unique filename based on template name
    let counter = 0;
    let name: string;
    do {
      counter++;
      name =
        counter === 1
          ? `${template.defaultFileName}.md`
          : `${template.defaultFileName} ${counter}.md`;
    } while (currentFiles.some((f) => f.name === name));

    try {
      const markdown = template.getContent();
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

    // Reset input so same file can be selected again
    e.target.value = "";

    setIsImporting(true);
    try {
      const newId = await importFile(file, currentFolderId);
      router.push(`/editor/${newId}`);
      toast.success(`Imported "${file.name}" successfully`);
    } catch (error) {
      log.error("Failed to import file", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    } finally {
      setIsImporting(false);
    }
  };

  const handleSearchClick = () => {
    openCommandPalette();
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border p-3">
        <div className="flex items-center justify-between">
          <div className="hidden md:flex">
            <h2 className="text-sm font-semibold">Files</h2>
          </div>
          <div className="flex w-full items-center justify-end gap-1 md:w-auto">
            <Tooltip content={`Search (${formatShortcut("Ctrl+K")})`} side="bottom">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleSearchClick}
                aria-label="Search"
                className="h-10 w-10 md:h-9 md:w-9"
              >
                <Search className="h-5 w-5 md:h-4 md:w-4" />
              </Button>
            </Tooltip>
            <SortDropdown />
            <Tooltip content="Import File (PDF, DOCX, MD)" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleImportClick}
                disabled={isImporting}
                aria-label="Import File"
                className="h-10 w-10 md:h-9 md:w-9"
              >
                {isImporting ? (
                  <Loader2 className="h-5 w-5 animate-spin md:h-4 md:w-4" />
                ) : (
                  <Upload className="h-5 w-5 md:h-4 md:w-4" />
                )}
              </Button>
            </Tooltip>
            <Tooltip content="Create New Folder" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCreateFolder}
                aria-label="Create New Folder"
                className="h-10 w-10 md:h-9 md:w-9"
              >
                <FolderPlus className="h-5 w-5 md:h-4 md:w-4" />
              </Button>
            </Tooltip>
            <Tooltip content="Create New File" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCreateFile}
                aria-label="Create New File"
                className="h-10 w-10 md:h-9 md:w-9"
              >
                <FilePlus className="h-5 w-5 md:h-4 md:w-4" />
              </Button>
            </Tooltip>
          </div>
          {/* Hidden file input for import */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.md,.markdown"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      </div>

      {/* File List with Folders */}
      <ScrollArea className="flex-1">
        <div className="space-y-1 p-2">
          <FolderTree />
        </div>
      </ScrollArea>

      {/* Bulk Action Bar */}
      <BulkActionBar />

      {/* Getting Started Checklist */}
      <GettingStartedChecklist />

      {/* Bottom actions */}
      <div className="flex gap-1 border-t border-border p-2">
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 justify-start gap-2 text-muted-foreground hover:text-foreground"
          onClick={() => setIsTemplatePickerOpen(true)}
        >
          <LayoutTemplate className="h-4 w-4" />
          Templates
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 justify-start gap-2 text-muted-foreground hover:text-foreground"
          onClick={() => setIsTrashOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
          Trash
        </Button>
      </div>

      {/* Trash panel modal */}
      <TrashPanel open={isTrashOpen} onClose={() => setIsTrashOpen(false)} />

      {/* Template picker modal */}
      <TemplatePicker
        open={isTemplatePickerOpen}
        onClose={() => setIsTemplatePickerOpen(false)}
        onSelect={handleTemplateSelect}
      />
    </div>
  );
}
