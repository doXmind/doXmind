"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus, FolderPlus, LayoutTemplate, Loader2, Plus, Upload } from "lucide-react";
import { motion } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { TemplatePicker, type FileTemplate } from "@/components/sidebar/template-picker";
import { useFileStore } from "@/stores/file-store";
import { haptics } from "@/lib/haptics";
import { MOBILE_SPRINGS, Z_INDEX } from "@/lib/constants";
import { markdownToHtml } from "@/lib/markdown";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";

export function MobileFAB() {
  const router = useRouter();
  const { files, createFile, createFolder, importFile, currentFolderId, getFolders } =
    useFileStore();
  const [isImporting, setIsImporting] = useState(false);
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCreateFile = async () => {
    haptics.light();
    try {
      const newId = await createFile(`Untitled-${files.length + 1}.md`, "", currentFolderId);
      router.push(`/editor/${newId}`);
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const handleCreateFolder = async () => {
    haptics.light();
    const folders = getFolders();
    const name = `New Folder ${folders.length + 1}`;
    try {
      await createFolder(name);
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const handleImportClick = () => {
    haptics.light();
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setIsImporting(true);
    const toastId = toast.loading(`Importing "${file.name}"...`);
    try {
      await importFile(file);
      toast.success(`Imported "${file.name}" successfully`, { id: toastId });
    } catch (error) {
      const { title, description } = getErrorMessage(error);
      toast.error(title, { id: toastId, description });
    } finally {
      setIsImporting(false);
    }
  };

  const handleTemplateSelect = async (template: FileTemplate) => {
    const currentFiles = files.filter((f) => !f.isFolder && f.parentId === currentFolderId);
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
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
      throw error;
    }
  };

  return (
    <>
      <div
        className="fixed bottom-[72px] right-5 md:hidden"
        style={{
          zIndex: Z_INDEX.FLOATING_BUTTON,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <motion.button
              className="flex h-14 w-14 items-center justify-center rounded-full bg-foreground text-background shadow-lg active:scale-95"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                type: "spring",
                ...MOBILE_SPRINGS.BOUNCY,
                delay: 0.6,
              }}
              whileTap={{ scale: 0.9 }}
              onClick={() => haptics.light()}
              aria-label="Create new"
            >
              <Plus className="h-7 w-7" strokeWidth={2.5} />
            </motion.button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="mb-2 w-48">
            <DropdownMenuItem onClick={handleCreateFile}>
              <FilePlus className="mr-2 h-4 w-4" />
              New Document
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleCreateFolder} disabled={!!currentFolderId}>
              <FolderPlus className="mr-2 h-4 w-4" />
              New Folder
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setIsTemplatePickerOpen(true)}>
              <LayoutTemplate className="mr-2 h-4 w-4" />
              From Template
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleImportClick} disabled={isImporting}>
              {isImporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Import File
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.md,.markdown"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Template Picker Modal */}
      <TemplatePicker
        open={isTemplatePickerOpen}
        onClose={() => setIsTemplatePickerOpen(false)}
        onSelect={handleTemplateSelect}
      />
    </>
  );
}
