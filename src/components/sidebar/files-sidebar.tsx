"use client";

import Link from "next/link";
import { ChevronDown, FilePlus, FileSymlink, FolderOpen, Search, Settings } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { MarkdownGlyph, PdfGlyph } from "@/components/icons/document-glyphs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FolderTree } from "./folder-tree";
import { BulkActionBar } from "./bulk-action-bar";
import { TemplatePicker, getLocalizedFileName, type FileTemplate } from "./template-picker";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";
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
  const isLoading = useFileStore((s) => s.isLoading);
  const isSynced = useFileStore((s) => s.isSynced);
  const openDiskWorkspace = useFileStore((s) => s.openDiskWorkspace);
  const openCommandPalette = useLayoutStore((s) => s.openCommandPalette);
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);
  // Workspace toggle is available in any Tauri shell (debug or release). It
  // used to be gated behind NODE_ENV / NEXT_PUBLIC_ENABLE_DISK_WORKSPACE,
  // which hid the entry point in production and left users stranded inside
  // disk mode with no way back; the gate has moved to the Tauri-presence
  // check that the dialog import already requires.
  const isDesktopShell = typeof window !== "undefined" && "__TAURI_BACKEND_URL__" in window;

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

  const handleCreateFolder = async () => {
    const folders = useFileStore.getState().getFolders(null);
    const name = `New Folder ${folders.length + 1}`;
    try {
      await createFolder(name, null);
    } catch (error) {
      log.error("Failed to create folder", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const handleOpenFolder = async () => {
    if (!isDesktopShell) {
      toast.error(t("openWorkspaceRequiresDesktop"));
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("openFolder"),
      });
      if (!selected || Array.isArray(selected)) return;
      await openDiskWorkspace(selected);
      toast.success(t("workspaceOpened"));
    } catch (error) {
      log.error("Failed to open folder", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const handleOpenFile = async () => {
    if (!isDesktopShell) {
      toast.error(t("openWorkspaceRequiresDesktop"));
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: false,
        multiple: false,
        title: t("openFile"),
        // Match the workspace's supported document types — anything else
        // wouldn't render in the editor anyway.
        filters: [
          {
            name: t("openFileFilter"),
            extensions: ["md", "markdown", "pdf"],
          },
        ],
      });
      if (!selected || Array.isArray(selected)) return;

      // VSCode-style semantics: opening a single file mounts its parent
      // directory as the workspace, then focuses the picked file. The
      // user gets the surrounding files in the sidebar for free.
      const normalized = selected.replace(/\\/g, "/");
      const lastSlash = normalized.lastIndexOf("/");
      if (lastSlash <= 0) {
        toast.error(t("openFileNoParent"));
        return;
      }
      const parentDir = selected.slice(0, lastSlash);
      const fileBase = normalized.slice(lastSlash + 1);

      await openDiskWorkspace(parentDir);
      // After loadFiles() resolves, the new workspace's files are in the
      // store. Match by relative path (top-level only — we only descended
      // one level by picking a single file).
      const match = useFileStore
        .getState()
        .files.find((f) => f.storageHandle?.relPath === fileBase);
      if (match) {
        navigateToEditorFile(match.id);
        toast.success(t("openedFile", { name: fileBase }));
      } else {
        // Workspace mounted but file vanished between pick + scan — rare,
        // tell the user the dir opened so the workspace switch isn't a
        // silent no-op.
        toast.success(t("workspaceOpened"));
      }
    } catch (error) {
      log.error("Failed to open file", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  return (
    <div className="sidebar-glass flex h-full flex-col border-r border-[var(--sidebar-active-border)] text-foreground">
      <div className="px-3 pb-2 pt-2">
        <div className="space-y-0.5">
          {/* Single "New File" entry — the document-type choice is one
              click deeper. Saves a row in the rail without hiding the
              capability. The trigger keeps the same row chrome as the
              other entries (icon + label + hover bg) plus a trailing
              chevron to telegraph "this opens a menu". */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="text-ui-base flex h-8 w-full items-center gap-3 rounded-lg px-2.5 text-left font-semibold text-foreground transition-colors hover:bg-[var(--sidebar-hover)] focus:outline-none focus-visible:bg-[var(--sidebar-hover)] data-[state=open]:bg-[var(--sidebar-hover)]"
                aria-label={t("newFile")}
              >
                <FilePlus className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1">{t("newFile")}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={4} className="w-52">
              <DropdownMenuItem onClick={() => handleCreateFile()}>
                <MarkdownGlyph className="mr-2 h-4 w-4" />
                {t("newMarkdown")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleCreatePdf()}>
                <PdfGlyph className="mr-2 h-4 w-4" />
                {t("newPdf")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            onClick={openCommandPalette}
            className="text-ui-base flex h-8 w-full items-center gap-3 rounded-lg px-2.5 text-left font-semibold text-foreground transition-colors hover:bg-[var(--sidebar-hover)]"
          >
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span>{t("search")}</span>
          </button>

          {/* Open Folder + Open File: always shown — this is a desktop
              product, the no-Tauri fallback is just a toast. The previous
              `isDesktopShell` gate hid these on the SSR pass and racily
              never re-rendered, leaving users stranded. */}
          <button
            onClick={handleOpenFolder}
            className="text-ui-base flex h-8 w-full items-center gap-3 rounded-lg px-2.5 text-left font-semibold text-foreground transition-colors hover:bg-[var(--sidebar-hover)]"
            title={t("openWorkspaceFolderHint")}
          >
            <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{t("openFolder")}</span>
          </button>

          <button
            onClick={handleOpenFile}
            className="text-ui-base flex h-8 w-full items-center gap-3 rounded-lg px-2.5 text-left font-semibold text-foreground transition-colors hover:bg-[var(--sidebar-hover)]"
            title={t("openFileHint")}
          >
            <FileSymlink className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{t("openFile")}</span>
          </button>
        </div>
      </div>

      <ScrollArea className="sidebar-scrollbar min-h-0 flex-1">
        <div className="space-y-1 px-2.5 pb-3">
          {isLoading && !isSynced ? (
            <FileListSkeleton />
          ) : (
            <FolderTree
              onCreateFile={handleCreateFile}
              onCreatePdf={handleCreatePdf}
              onCreateFolder={handleCreateFolder}
              onOpenTemplatePicker={() => setIsTemplatePickerOpen(true)}
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
