"use client";

import { Plus, Loader2, Upload, Search } from "lucide-react";
import { toast } from "sonner";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip } from "@/components/ui/tooltip";
import { FileItem } from "./file-item";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
import { getErrorMessage } from "@/lib/utils";

export function Sidebar() {
  const { files, createFile, importFile } = useFileStore();
  const { openCommandPalette } = useLayoutStore();
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCreateFile = async () => {
    const name = `Untitled-${files.length + 1}.md`;
    try {
      await createFile(name);
    } catch (error) {
      console.error("Failed to create file:", error);
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
      await importFile(file);
      toast.success(`Imported "${file.name}" successfully`);
    } catch (error) {
      console.error("Failed to import file:", error);
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
          <h2 className="hidden text-sm font-semibold md:block">Files</h2>
          <div className="flex w-full items-center justify-end gap-1 md:w-auto">
            <Tooltip content="Search (⌘K)" side="bottom">
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
            <Tooltip content="Create New File" side="bottom">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCreateFile}
                aria-label="Create New File"
                className="h-10 w-10 md:h-9 md:w-9"
              >
                <Plus className="h-5 w-5 md:h-4 md:w-4" />
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

      {/* File List */}
      <ScrollArea className="flex-1">
        {files.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No files yet</div>
        ) : (
          <div className="space-y-1 p-2">
            {files.map((file) => (
              <FileItem key={file.id} file={file} />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
