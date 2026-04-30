"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, Folder, FilePlus, Upload, Loader2 } from "lucide-react";
import { useFileStore, type FileItem } from "@/stores/file-store";
import { Button } from "@/components/ui/button";
import { AnimatedLogo } from "@/components/ui/animated-logo";
import { ImportFolderProgressModal } from "@/components/sidebar/import-folder-progress";
import {
  importLocalFolder,
  entriesFromFileList,
  entriesFromDataTransfer,
  type FolderImportProgress,
} from "@/lib/import-folder";
import { cn, getErrorMessage } from "@/lib/utils";
import { storeLogger } from "@/lib/logger";
import { toast } from "sonner";
import { WelcomeOcrRow } from "@/components/welcome-ocr-row";

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
  // Within the last week → weekday name; otherwise locale date.
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString();
}

export function WelcomeScreen() {
  const router = useRouter();
  const t = useTranslations("welcome");
  const files = useFileStore((s) => s.files);
  const createFile = useFileStore((s) => s.createFile);
  const importFile = useFileStore((s) => s.importFile);
  const createFolder = useFileStore((s) => s.createFolder);
  const setCurrentFile = useFileStore((s) => s.setCurrentFile);
  const currentFolderId = useFileStore((s) => s.currentFolderId);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Pinned to .pdf for the OCR row's "Open scanned PDF" affordance —
  // OCR doesn't apply to docx/pptx/md, so we narrow the picker.
  const ocrFileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const folderImportAbortRef = useRef<AbortController | null>(null);

  const [isCreating, setIsCreating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [folderImportProgress, setFolderImportProgress] = useState<FolderImportProgress | null>(
    null
  );

  const recentFiles = useMemo<FileItem[]>(
    () =>
      files
        .filter((f) => !f.isFolder)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, RECENT_LIMIT),
    [files]
  );

  const handleCreateFile = async () => {
    setIsCreating(true);
    try {
      const newId = await createFile("Untitled.md", "", currentFolderId);
      router.push(`/editor/${newId}`);
    } catch (error) {
      log.error("Failed to create file", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    } finally {
      setIsCreating(false);
    }
  };

  const handleOpenFileClick = () => fileInputRef.current?.click();
  const handleOpenFolderClick = () => folderInputRef.current?.click();
  const handleOpenOcrFileClick = () => ocrFileInputRef.current?.click();

  const makeFileInputChange =
    (mode: "auto" | "ocr") => async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";

      setIsImporting(true);
      const toastId = toast.loading(t("importingFile"));
      try {
        const newId = await importFile(
          file,
          currentFolderId,
          mode === "ocr" ? { mode } : undefined
        );
        if (newId) {
          router.push(`/editor/${newId}`);
          toast.success(file.name, { id: toastId });
        } else {
          // null = deferred behind the Marker download prompt — but on
          // the welcome screen the row already shows installed=true
          // before this code path can run, so this branch only fires if
          // the auto-fallback kicks in for a near-empty PDF.
          toast.dismiss(toastId);
        }
      } catch (error) {
        log.error("Failed to import file", error);
        const { title, description } = getErrorMessage(error);
        toast.error(title, { id: toastId, description });
      } finally {
        setIsImporting(false);
      }
    };

  const handleFileInputChange = makeFileInputChange("auto");
  const handleOcrFileInputChange = makeFileInputChange("ocr");

  /** Run the folder import pipeline given an already-normalized entry
      list. Used by both the picker change handler and folder-drop. */
  const runFolderImport = async (
    entries: ReturnType<typeof entriesFromFileList>,
    rootHint: string
  ) => {
    const abort = new AbortController();
    folderImportAbortRef.current = abort;
    setFolderImportProgress({
      total: 0,
      done: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      currentFileName: null,
      rootFolderName: rootHint,
      isComplete: false,
      cancelled: false,
    });

    try {
      await importLocalFolder({
        entries,
        parentId: null,
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

  const handleFolderInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files;
    if (!picked || picked.length === 0) return;
    const entries = entriesFromFileList(picked);
    e.target.value = "";
    const rootHint = picked[0]?.webkitRelativePath.split("/")[0] ?? "—";
    await runFolderImport(entries, rootHint);
  };

  const openRecent = (id: string) => {
    setCurrentFile(id);
    router.push(`/editor/${id}`);
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      // Walk the drop's FileSystem entries — this is the only way to
      // recurse into dropped directories (DataTransfer.files would just
      // hand back a single zero-byte File for the folder itself).
      const entries = await entriesFromDataTransfer(e.dataTransfer);

      // Folder drop: any entry has a path with a "/". A loose drop of
      // one or more standalone files goes to the single-file flow if
      // it's just one file, or to the folder-import flow otherwise.
      const isFolderDrop =
        !!entries && (entries.length > 1 || entries.some((en) => en.relPath.includes("/")));

      if (isFolderDrop && entries) {
        // Pull the rootHint from the first entry that actually lives
        // inside a directory; loose-file drops fall back to "Imported"
        // (matching importLocalFolder's own logic).
        const firstNested = entries.find((en) => en.relPath.includes("/"));
        const rootSeg = firstNested?.relPath.split("/")[0] ?? "Imported";
        await runFolderImport(entries, rootSeg);
        return;
      }

      // Single-file path: prefer the entry's File (it carries the real
      // bytes from the FS API); fall back to the legacy DataTransfer.files
      // shape on platforms that don't expose entries.
      const file = entries?.[0]?.file ?? e.dataTransfer.files?.[0];
      if (!file) return;
      setIsImporting(true);
      try {
        const newId = await importFile(file, currentFolderId);
        if (newId) {
          router.push(`/editor/${newId}`);
        }
      } catch (error) {
        log.error("Failed to import dropped file", error);
        const { title, description } = getErrorMessage(error);
        toast.error(title, { description });
      } finally {
        setIsImporting(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runFolderImport reads stable store actions
    [importFile, currentFolderId, router]
  );

  return (
    <div
      className={cn(
        "relative flex flex-1 items-start justify-center overflow-y-auto px-6 pb-12 pt-16 md:pt-24",
        "transition-colors duration-200",
        isDragging && "bg-primary/5"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <motion.div
        className="w-full max-w-md"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* Logo (the AnimatedLogo includes the doXmind wordmark; we don't
            render the name a second time below it). */}
        <motion.div variants={itemVariants} className="flex flex-col items-center gap-3 pb-8">
          <AnimatedLogo size="md" />
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </motion.div>

        {/* Action buttons */}
        <motion.div variants={itemVariants} className="space-y-2">
          <Button
            onClick={handleCreateFile}
            disabled={isCreating || isImporting}
            className="h-11 w-full justify-center gap-2 text-sm font-medium"
          >
            {isCreating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FilePlus className="h-4 w-4" />
            )}
            {t("newDocument")}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              onClick={handleOpenFileClick}
              disabled={isImporting}
              className="h-10 justify-center gap-2 text-sm"
            >
              {isImporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              {t("openFile")}
            </Button>
            <Button
              variant="secondary"
              onClick={handleOpenFolderClick}
              disabled={folderImportProgress !== null && !folderImportProgress.isComplete}
              className="h-10 justify-center gap-2 text-sm"
            >
              <Folder className="h-4 w-4" />
              {t("openFolder")}
            </Button>
          </div>
          {/* Status-aware row: lets the user install the offline OCR
              engine without leaving the welcome screen and, once
              installed, jump straight into a scanned-PDF picker. */}
          <WelcomeOcrRow onUseOcr={handleOpenOcrFileClick} />
        </motion.div>

        {/* Recent files */}
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
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-foreground">
                        {f.name.replace(/\.md$/i, "")}
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

        {/* Drop hint */}
        <motion.div
          variants={itemVariants}
          className={cn(
            "mt-8 flex items-center justify-center gap-2 text-xs text-muted-foreground/70",
            isDragging && "font-medium text-primary"
          )}
        >
          <Upload className="h-3.5 w-3.5" />
          <span>{isDragging ? t("dropToImport") : t("orDropFile")}</span>
        </motion.div>
      </motion.div>

      {/* Hidden inputs for native pickers */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.md,.markdown"
        onChange={handleFileInputChange}
        className="hidden"
      />
      <input
        ref={ocrFileInputRef}
        type="file"
        accept=".pdf"
        onChange={handleOcrFileInputChange}
        className="hidden"
      />
      {/* `webkitdirectory` / `directory` aren't in React's input typings,
          so the spread carries them through as plain HTML attributes —
          rendered into the DOM at JSX time, before any `.click()` can
          fire. (The previous mount-effect approach occasionally lost
          this race in dev/strict-mode and the picker fell back to
          single-file mode, which then yielded an empty entry list and
          the dreaded "Nothing to import" outcome.) */}
      <input
        ref={folderInputRef}
        type="file"
        multiple
        onChange={handleFolderInputChange}
        className="hidden"
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
      />

      {/* Drag overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            className="pointer-events-none absolute inset-4 rounded-xl border-2 border-dashed border-primary/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          />
        )}
      </AnimatePresence>

      {/* Folder import progress */}
      <ImportFolderProgressModal
        open={folderImportProgress !== null}
        progress={folderImportProgress}
        onCancel={() => folderImportAbortRef.current?.abort()}
        onClose={() => setFolderImportProgress(null)}
      />
    </div>
  );
}
