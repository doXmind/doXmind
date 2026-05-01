"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { FileSymlink, Folder, Loader2 } from "lucide-react";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { Button } from "@/components/ui/button";
import { AnimatedLogo } from "@/components/ui/animated-logo";
import { MarkdownGlyph, PdfGlyph } from "@/components/icons/document-glyphs";
import { cn, getErrorMessage } from "@/lib/utils";
import { storeLogger } from "@/lib/logger";
import { navigateToEditorFile } from "@/lib/editor-navigation";
import { isPdfFile } from "@/lib/document-types";
import { toast } from "sonner";

const log = storeLogger.child("Welcome");

const RECENT_LIMIT = 6;

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] as const },
  },
};

/**
 * Format a recent file's updatedAt as a short, relative-ish label.
 * Today / Yesterday / weekday / locale date — same shape we use in the
 * sidebar so the welcome list reads consistently with the rest of the
 * app.
 */
function formatRecentDate(iso: string, t: (k: string) => string): string {
  const d = new Date(iso);
  const now = new Date();
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (isSameDay(d, now)) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(d, yesterday)) return t("yesterday");
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString();
}

export function WelcomeScreen() {
  const t = useTranslations("welcome");
  const tSidebar = useTranslations("sidebar");
  const files = useFileStore((s) => s.files);
  const createFile = useFileStore((s) => s.createFile);
  const currentFolderId = useFileStore((s) => s.currentFolderId);
  const openDiskWorkspace = useFileStore((s) => s.openDiskWorkspace);
  const openSingleFile = useFileStore((s) => s.openSingleFile);

  const [isCreatingMd, setIsCreatingMd] = useState(false);
  const [isCreatingPdf, setIsCreatingPdf] = useState(false);

  // The "Open Folder" button only does anything inside the Tauri shell —
  // the browser build can't pick a real disk path. Hide it on the web.
  const isDesktopShell = typeof window !== "undefined" && "__TAURI_BACKEND_URL__" in window;

  const recentFiles = useMemo<FileItem[]>(
    () =>
      files
        .filter((f) => !f.isFolder)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, RECENT_LIMIT),
    [files]
  );

  const handleCreateMarkdown = async () => {
    setIsCreatingMd(true);
    try {
      const newId = await createFile("Untitled.md", "", currentFolderId, {
        documentType: "markdown",
      });
      navigateToEditorFile(newId);
    } catch (error) {
      log.error("Failed to create file", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    } finally {
      setIsCreatingMd(false);
    }
  };

  const handleCreatePdf = async () => {
    setIsCreatingPdf(true);
    try {
      const newId = await createFile("Untitled.pdf", "", currentFolderId, {
        documentType: "pdf",
      });
      navigateToEditorFile(newId);
    } catch (error) {
      log.error("Failed to create PDF", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    } finally {
      setIsCreatingPdf(false);
    }
  };

  const handleOpenFolder = async () => {
    if (!isDesktopShell) {
      toast.error(tSidebar("openWorkspaceRequiresDesktop"));
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: tSidebar("openFolder"),
      });
      if (!selected || Array.isArray(selected)) return;
      await openDiskWorkspace(selected);
      toast.success(tSidebar("workspaceOpened"));
    } catch (error) {
      log.error("Failed to open folder", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const handleOpenFile = async () => {
    if (!isDesktopShell) {
      toast.error(tSidebar("openWorkspaceRequiresDesktop"));
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: false,
        multiple: false,
        title: tSidebar("openFile"),
        filters: [
          {
            name: tSidebar("openFileFilter"),
            extensions: ["md", "markdown", "pdf"],
          },
        ],
      });
      if (!selected || Array.isArray(selected)) return;

      // VSCode-style: opening a single file is just that — one file in
      // the editor, no folder mounted, no sibling tree leaked into the
      // sidebar. The store keeps any previously persisted workspace
      // around so the user can return to it later.
      const normalized = selected.replace(/\\/g, "/");
      const lastSlash = normalized.lastIndexOf("/");
      if (lastSlash <= 0) {
        toast.error(tSidebar("openFileNoParent"));
        return;
      }
      const fileBase = normalized.slice(lastSlash + 1);

      await openSingleFile(selected);
      const id = useFileStore.getState().currentFileId;
      if (id) navigateToEditorFile(id);
      toast.success(tSidebar("openedFile", { name: fileBase }));
    } catch (error) {
      log.error("Failed to open file", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const openRecent = (id: string) => {
    navigateToEditorFile(id);
  };

  return (
    <div className="relative flex flex-1 items-start justify-center overflow-y-auto px-6 pb-12 pt-16 transition-colors duration-200 md:pt-24">
      <motion.div
        className="w-full max-w-md"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={itemVariants} className="flex flex-col items-center gap-3 pb-8">
          <AnimatedLogo size="md" />
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </motion.div>

        <motion.div variants={itemVariants} className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={handleCreateMarkdown}
              disabled={isCreatingMd}
              className="h-11 justify-center gap-2 text-sm font-medium"
            >
              {isCreatingMd ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MarkdownGlyph className="h-4 w-4" />
              )}
              {tSidebar("newMarkdown")}
            </Button>
            <Button
              onClick={handleCreatePdf}
              disabled={isCreatingPdf}
              className="h-11 justify-center gap-2 text-sm font-medium"
            >
              {isCreatingPdf ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PdfGlyph className="h-4 w-4" />
              )}
              {tSidebar("newPdf")}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              onClick={handleOpenFolder}
              className="h-10 justify-center gap-2 text-sm"
            >
              <Folder className="h-4 w-4" />
              {tSidebar("openFolder")}
            </Button>
            <Button
              variant="secondary"
              onClick={handleOpenFile}
              className="h-10 justify-center gap-2 text-sm"
            >
              <FileSymlink className="h-4 w-4" />
              {tSidebar("openFile")}
            </Button>
          </div>
        </motion.div>

        <motion.div variants={itemVariants} className="mt-10 space-y-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
            {t("recent")}
          </h2>
          {recentFiles.length === 0 ? (
            <p className="px-1 py-3 text-sm text-muted-foreground/70">{t("noRecent")}</p>
          ) : (
            <ul className="space-y-1">
              {recentFiles.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => openRecent(f.id)}
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors",
                      "hover:bg-[var(--sidebar-hover)] focus:bg-[var(--sidebar-hover)] focus:outline-none"
                    )}
                  >
                    {isPdfFile(f) ? (
                      <PdfGlyph className="h-4 w-4 shrink-0" />
                    ) : (
                      <MarkdownGlyph className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-foreground">
                        {f.name.replace(/\.(md|markdown|pdf)$/i, "")}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">
                      {formatRecentDate(f.updatedAt, t)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
}
