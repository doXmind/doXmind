"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Plus, ImageIcon, FileText, FolderOpen, ChevronRight, X, Globe, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useKBStore, formatFileSize } from "@/stores/kb-store";
import { useDataFilesStore, isKBFile, isDataFile } from "@/stores/data-files-store";
import { useSettingsStore } from "@/stores/settings-store";
import { KBAttachmentItem } from "@/components/kb/kb-attachment-item";
import { DataFileItem } from "@/components/data-files/data-file-item";

// All allowed file extensions (KB + Data files)
const ALLOWED_EXTENSIONS = [
  // KB files (vectorized for RAG)
  ".pdf",
  ".docx",
  ".pptx",
  // Data files (for code execution)
  ".csv",
  ".xlsx",
  ".xls",
  ".json",
  ".txt",
];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export interface AttachmentMenuProps {
  conversationId: string | null;
  onImageSelect: (files: FileList) => void;
  onDataFileSelect?: (fileIds: string[]) => void;
  imageCount: number;
  maxImages: number;
  disabled?: boolean;
  className?: string;
}

type MenuView = "main" | "files";

export function AttachmentMenu({
  conversationId,
  onImageSelect,
  onDataFileSelect,
  imageCount,
  maxImages,
  disabled,
  className,
}: AttachmentMenuProps) {
  const t = useTranslations("chat");
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<MenuView>("main");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // KB store for PDF, DOCX, PPTX
  const {
    isLoading: isKBLoading,
    loadAttachments,
    uploadAttachments: uploadKBAttachments,
    deleteAttachment: deleteKBAttachment,
    getAttachments,
  } = useKBStore();

  // Data files store for CSV, XLSX, JSON, TXT
  const {
    isLoading: isDataLoading,
    loadDataFiles,
    uploadDataFile,
    deleteDataFile,
    getDataFiles,
  } = useDataFilesStore();

  const { webSearchEnabled, setWebSearchEnabled } = useSettingsStore();

  // Get both KB attachments and data files
  const kbAttachments = conversationId ? getAttachments(conversationId) : [];
  const dataFiles = conversationId ? getDataFiles(conversationId) : [];

  const kbCount = kbAttachments.filter((a) => a.status !== "error").length;
  const dataCount = dataFiles.filter((f) => f.status !== "error").length;
  const totalFileCount = kbCount + dataCount;
  const totalSize =
    kbAttachments.reduce((sum, a) => sum + a.fileSize, 0) +
    dataFiles.reduce((sum, f) => sum + f.fileSize, 0);

  // Total indicator count (images + all files)
  const totalIndicator = imageCount + totalFileCount;
  const isLoading = isKBLoading || isDataLoading;

  // Preload all files when conversation changes
  // This ensures the badge count is accurate without requiring user to open the menu
  useEffect(() => {
    if (conversationId) {
      loadAttachments(conversationId);
      loadDataFiles(conversationId);
    }
  }, [conversationId, loadAttachments, loadDataFiles]);

  // Load all files when opening files view (refresh)
  const handleOpenFiles = useCallback(() => {
    if (conversationId) {
      loadAttachments(conversationId);
      loadDataFiles(conversationId);
    }
    setView("files");
  }, [conversationId, loadAttachments, loadDataFiles]);

  // Handle image selection
  const handleImageClick = () => {
    imageInputRef.current?.click();
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onImageSelect(e.target.files);
      e.target.value = ""; // Reset to allow same file selection
    }
    setIsOpen(false);
  };

  // Handle file upload (unified for all types)
  const handleFileClick = () => {
    fileInputRef.current?.click();
  };

  const validateFile = (file: File): string | null => {
    const extension = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      return t("unsupportedFileType", { formats: ALLOWED_EXTENSIONS.join(", ") });
    }
    if (file.size > MAX_FILE_SIZE) {
      return t("fileTooLargeMessage", { size: MAX_FILE_SIZE / (1024 * 1024) });
    }
    return null;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !conversationId) return;

    setUploadError(null);

    // Classify files by type
    const kbFiles: File[] = [];
    const dataFilesToUpload: File[] = [];

    for (const file of Array.from(e.target.files)) {
      const error = validateFile(file);
      if (error) {
        setUploadError(error);
        continue;
      }

      // Route to appropriate backend based on file type
      if (isKBFile(file.name)) {
        kbFiles.push(file);
      } else if (isDataFile(file.name)) {
        dataFilesToUpload.push(file);
      }
    }

    try {
      // Upload KB files (PDF, DOCX, PPTX) -> vectorized for RAG
      if (kbFiles.length > 0) {
        await uploadKBAttachments(conversationId, kbFiles);
      }

      // Upload data files (CSV, XLSX, JSON, TXT) -> for code execution
      const uploadedDataFileIds: string[] = [];
      for (const file of dataFilesToUpload) {
        const uploaded = await uploadDataFile(conversationId, file);
        if (uploaded && uploaded.status === "ready") {
          uploadedDataFileIds.push(uploaded.id);
        }
      }

      // Notify parent of new data files (for auto-selection)
      if (uploadedDataFileIds.length > 0 && onDataFileSelect) {
        onDataFileSelect(uploadedDataFileIds);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    }

    e.target.value = "";
    // Switch to files view to show uploaded files
    setView("files");
  };

  // Handle KB attachment deletion
  const handleDeleteKB = useCallback(
    async (attachmentId: string) => {
      if (!conversationId) return;
      setDeletingId(attachmentId);
      try {
        await deleteKBAttachment(conversationId, attachmentId);
      } finally {
        setDeletingId(null);
      }
    },
    [conversationId, deleteKBAttachment]
  );

  // Handle data file deletion
  const handleDeleteDataFile = useCallback(
    async (fileId: string) => {
      if (!conversationId) return;
      setDeletingId(fileId);
      try {
        await deleteDataFile(conversationId, fileId);
      } finally {
        setDeletingId(null);
      }
    },
    [conversationId, deleteDataFile]
  );

  // Reset view when closing
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      // Track onboarding step
      import("@/stores/onboarding-store")
        .then(({ useOnboardingStore }) => {
          useOnboardingStore.getState().completeStep("knowledge-base");
        })
        .catch(() => {});
    }
    if (!open) {
      setView("main");
      setUploadError(null);
    }
  };

  return (
    <>
      {/* Hidden file inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
        onChange={handleImageChange}
        className="hidden"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_EXTENSIONS.join(",")}
        multiple
        onChange={handleFileChange}
        className="hidden"
      />

      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            data-onboarding="kb-button"
            className={cn(
              "relative flex-shrink-0 text-muted-foreground hover:text-foreground",
              "h-8 w-8 rounded-full",
              className
            )}
            disabled={disabled}
            aria-label={t("addAttachment")}
          >
            <Plus className="h-4 w-4" />
            {totalIndicator > 0 && (
              <Badge
                variant="secondary"
                className="absolute -right-0.5 -top-0.5 h-4 min-w-[16px] px-1 text-[10px] font-medium"
              >
                {totalIndicator}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>

        <PopoverContent align="start" side="top" className="w-72 p-0" sideOffset={8}>
          {view === "main" ? (
            // Main menu view
            <div className="py-1">
              {/* Web Search toggle */}
              <button
                type="button"
                onClick={() => setWebSearchEnabled(!webSearchEnabled)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent"
              >
                <div
                  className={cn(
                    "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg",
                    webSearchEnabled ? "bg-blue-500 text-white" : "bg-muted"
                  )}
                >
                  <Globe className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{t("webSearchOption")}</div>
                  <div className="text-xs text-muted-foreground">{t("findRealtimeInfo")}</div>
                </div>
                {webSearchEnabled && <Check className="h-4 w-4 text-blue-500" />}
              </button>

              {/* Attach Image option */}
              <button
                type="button"
                onClick={handleImageClick}
                disabled={imageCount >= maxImages}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent",
                  imageCount >= maxImages && "cursor-not-allowed opacity-50"
                )}
              >
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-green-500/10">
                  <ImageIcon className="h-4 w-4 text-green-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{t("attachImageOption")}</div>
                  <div className="text-xs text-muted-foreground">
                    {imageCount >= maxImages
                      ? t("maxImagesReached", { count: maxImages })
                      : t("pasteOrSelectImages")}
                  </div>
                </div>
                {imageCount > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {imageCount}
                  </Badge>
                )}
              </button>

              {/* Upload Files option */}
              <button
                type="button"
                onClick={handleFileClick}
                disabled={!conversationId}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent",
                  !conversationId && "cursor-not-allowed opacity-50"
                )}
              >
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-orange-500/10">
                  <FileText className="h-4 w-4 text-orange-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{t("uploadFilesOption")}</div>
                  <div className="text-xs text-muted-foreground">{t("pdfDocxCsvEtc")}</div>
                </div>
              </button>

              {/* Uploaded Files option (view/manage) */}
              <button
                type="button"
                onClick={handleOpenFiles}
                disabled={!conversationId}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent",
                  !conversationId && "cursor-not-allowed opacity-50"
                )}
              >
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-purple-500/10">
                  <FolderOpen className="h-4 w-4 text-purple-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{t("uploadedFilesOption")}</div>
                  <div className="text-xs text-muted-foreground">{t("manageYourFiles")}</div>
                </div>
                {totalFileCount > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {totalFileCount}
                  </Badge>
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          ) : (
            // Files view (unified KB + data files)
            <div>
              {/* Header */}
              <div className="flex items-center justify-between border-b px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => setView("main")}
                  className="flex items-center gap-2 text-sm font-medium transition-colors hover:text-primary"
                >
                  <ChevronRight className="h-4 w-4 rotate-180" />
                  {t("uploadedFilesOption")}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setIsOpen(false)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Content */}
              <div className="space-y-3 p-3">
                {/* Upload button */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2"
                  onClick={handleFileClick}
                  disabled={isLoading || !conversationId}
                >
                  <Plus className="h-4 w-4" />
                  {t("addFilesButton")}
                </Button>

                {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}

                {/* Files list */}
                {(kbAttachments.length > 0 || dataFiles.length > 0) && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {totalFileCount !== 1
                          ? t("fileCountPlural", { count: totalFileCount })
                          : t("fileCountSingular", { count: totalFileCount })}
                      </span>
                      <span>{formatFileSize(totalSize)}</span>
                    </div>

                    <ScrollArea className="max-h-[200px]">
                      <div className="space-y-2">
                        {/* KB attachments (PDF, DOCX, PPTX) */}
                        {kbAttachments.map((attachment) => (
                          <KBAttachmentItem
                            key={attachment.id}
                            attachment={attachment}
                            onDelete={handleDeleteKB}
                            isDeleting={deletingId === attachment.id}
                          />
                        ))}
                        {/* Data files (CSV, XLSX, JSON, TXT) */}
                        {dataFiles.map((file) => (
                          <DataFileItem
                            key={file.id}
                            file={file}
                            onDelete={handleDeleteDataFile}
                            isDeleting={deletingId === file.id}
                          />
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}

                {/* Empty state */}
                {kbAttachments.length === 0 && dataFiles.length === 0 && !isLoading && (
                  <p className="py-2 text-center text-xs text-muted-foreground">
                    {t("uploadEmptyState")}
                  </p>
                )}
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}
