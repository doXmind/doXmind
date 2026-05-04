"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Image as ImageIcon, Loader2 } from "lucide-react";
import { notify } from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { useFileStore } from "@/stores/file-store";
import { parseUploadError } from "@/lib/utils/image-upload-errors";

interface ImageEmptyStateProps {
  onSetSrc: (src: string, alt?: string) => void;
}

type Tab = "upload" | "link";

/**
 * Notion-style empty state for the image block:
 * - Header: image icon + "Add an image" callout-like row, always visible.
 * - On insert (mount), a floating popup auto-opens below the header with
 *   Upload / Link tabs.
 * - Click outside / Esc closes the popup; placeholder header stays so the
 *   user can click it to reopen.
 */
export function ImageEmptyState({ onSetSrc }: ImageEmptyStateProps) {
  const t = useTranslations("editor");
  const { currentFileId, files, rootPath } = useFileStore();

  // Start closed. The slash command opens a centralized image modal; this
  // empty state only shows for orphan empty image blocks (e.g. abandoned
  // inserts), so auto-opening would steal scroll/focus on every doc load.
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("upload");
  const [url, setUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && tab === "link") {
      urlInputRef.current?.focus({ preventScroll: true });
    }
  }, [isOpen, tab]);

  const handleHeaderClick = useCallback(() => setIsOpen(true), []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    }
  }, []);

  const handleFileUpload = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      setIsUploading(true);
      try {
        const uploadedUrl = await importDiskWorkspaceAsset({
          file,
          currentFile: files.find((item) => item.id === currentFileId),
          rootPath,
        });
        onSetSrc(uploadedUrl, file.name.replace(/\.[^.]+$/, ""));
      } catch (error) {
        notify.error(parseUploadError(error));
      } finally {
        setIsUploading(false);
      }
    },
    [files, currentFileId, rootPath, onSetSrc]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileUpload(file);
      e.target.value = "";
    },
    [handleFileUpload]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file?.type.startsWith("image/")) handleFileUpload(file);
    },
    [handleFileUpload]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleUrlSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = url.trim();
      if (trimmed) onSetSrc(trimmed);
    },
    [url, onSetSrc]
  );

  return (
    <div
      ref={containerRef}
      className="relative"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header — callout-like row, always visible */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleHeaderClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleHeaderClick();
          }
        }}
        className={cn(
          "doxmind-block-placeholder flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
          !isOpen && "cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
        )}
      >
        <ImageIcon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">{t("addAnImage")}</span>
      </div>

      {/* Floating popup with tabs + content */}
      {isOpen && (
        <div className="absolute left-1/2 top-full z-20 mt-2 w-[420px] max-w-[calc(100%-2rem)] -translate-x-1/2 overflow-hidden rounded-lg border border-border/60 bg-popover shadow-lg">
          {/* Tabs */}
          <div className="flex items-center gap-4 border-b border-border/50 px-3 pt-2">
            <button
              type="button"
              onClick={() => setTab("upload")}
              className={cn(
                "relative -mb-px border-b-2 pb-2 text-sm font-medium transition-colors",
                tab === "upload"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t("uploadTab")}
            </button>
            <button
              type="button"
              onClick={() => setTab("link")}
              className={cn(
                "relative -mb-px border-b-2 pb-2 text-sm font-medium transition-colors",
                tab === "link"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t("linkTab")}
            </button>
          </div>

          {/* Tab content */}
          <div className="p-3">
            {tab === "upload" ? (
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => !isUploading && fileInputRef.current?.click()}
                className={cn(
                  "flex w-full cursor-pointer items-center justify-center rounded-md border border-dashed px-3 py-3 text-sm font-medium transition-colors",
                  isDragging
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-border/70 text-foreground hover:bg-muted/40",
                  isUploading && "pointer-events-none opacity-60"
                )}
              >
                {isUploading ? (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("uploadingImage")}
                  </span>
                ) : (
                  t("uploadFile")
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>
            ) : (
              <form onSubmit={handleUrlSubmit} className="flex flex-col gap-2">
                <input
                  ref={urlInputRef}
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t("imageUrlPlaceholder")}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  type="submit"
                  disabled={!url.trim()}
                  className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("embedImage")}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

async function importDiskWorkspaceAsset({
  file,
  currentFile,
  rootPath,
}: {
  file: File;
  currentFile: ReturnType<typeof useFileStore.getState>["files"][number] | undefined;
  rootPath: string | null;
}): Promise<string> {
  const documentPath = currentFile?.storageHandle?.relPath ?? currentFile?.storageHandle?.path;
  if (!rootPath || !documentPath) {
    throw new Error("No document is open");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  const result = await invoke<{ path: string }>("workspace_import_asset", {
    root: rootPath,
    documentPath,
    filename: file.name,
    bytes,
  });
  return result.path;
}
