"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Plus, ImageIcon, FileText, BookOpen, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useKBStore, formatFileSize } from "@/stores/kb-store";
import { KBAttachmentItem } from "@/components/kb/kb-attachment-item";

// Allowed document types for Knowledge Base
const ALLOWED_DOC_EXTENSIONS = [".pdf", ".docx", ".pptx"];
const ALLOWED_DOC_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];
const MAX_DOC_SIZE = 50 * 1024 * 1024; // 50MB

export interface AttachmentMenuProps {
  conversationId: string | null;
  onImageSelect: (files: FileList) => void;
  imageCount: number;
  maxImages: number;
  disabled?: boolean;
  className?: string;
}

type MenuView = "main" | "kb";

export function AttachmentMenu({
  conversationId,
  onImageSelect,
  imageCount,
  maxImages,
  disabled,
  className,
}: AttachmentMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<MenuView>("main");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  const {
    isLoading,
    loadAttachments,
    uploadAttachment,
    deleteAttachment,
    getAttachments,
  } = useKBStore();

  const attachments = conversationId ? getAttachments(conversationId) : [];
  const attachmentCount = attachments.filter(a => a.status !== "error").length;
  const totalSize = attachments.reduce((sum, a) => sum + a.fileSize, 0);

  // Total indicator count (images + kb docs)
  const totalIndicator = imageCount + attachmentCount;

  // Preload KB attachments when conversation changes
  // This ensures the badge count is accurate without requiring user to open the menu
  useEffect(() => {
    if (conversationId) {
      loadAttachments(conversationId);
    }
  }, [conversationId, loadAttachments]);

  // Load KB attachments when opening KB view (refresh)
  const handleOpenKB = useCallback(() => {
    if (conversationId) {
      loadAttachments(conversationId);
    }
    setView("kb");
  }, [conversationId, loadAttachments]);

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

  // Handle document upload
  const handleDocClick = () => {
    docInputRef.current?.click();
  };

  const validateDocFile = (file: File): string | null => {
    const extension = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ALLOWED_DOC_EXTENSIONS.includes(extension) && !ALLOWED_DOC_TYPES.includes(file.type)) {
      return `Unsupported file type. Allowed: ${ALLOWED_DOC_EXTENSIONS.join(", ")}`;
    }
    if (file.size > MAX_DOC_SIZE) {
      return `File too large. Maximum size: ${MAX_DOC_SIZE / (1024 * 1024)}MB`;
    }
    return null;
  };

  const handleDocChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !conversationId) return;

    setUploadError(null);

    for (const file of Array.from(e.target.files)) {
      const error = validateDocFile(file);
      if (error) {
        setUploadError(error);
        continue;
      }
      try {
        await uploadAttachment(conversationId, file);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed");
      }
    }

    e.target.value = "";
    // Switch to KB view to show uploaded files
    setView("kb");
  };

  // Handle KB attachment deletion
  const handleDelete = useCallback(
    async (attachmentId: string) => {
      if (!conversationId) return;
      setDeletingId(attachmentId);
      try {
        await deleteAttachment(conversationId, attachmentId);
      } finally {
        setDeletingId(null);
      }
    },
    [conversationId, deleteAttachment]
  );

  // Reset view when closing
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
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
        ref={docInputRef}
        type="file"
        accept={ALLOWED_DOC_EXTENSIONS.join(",")}
        multiple
        onChange={handleDocChange}
        className="hidden"
      />

      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={cn("relative h-7 w-7 flex-shrink-0 rounded-full text-muted-foreground hover:text-foreground", className)}
            disabled={disabled}
            aria-label="Add attachment"
          >
            <Plus className="h-4 w-4" />
            {totalIndicator > 0 && (
              <Badge
                variant="secondary"
                className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 text-[10px] font-medium"
              >
                {totalIndicator}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          side="top"
          className="w-72 p-0"
          sideOffset={8}
        >
          {view === "main" ? (
            // Main menu view
            <div className="py-1">
              {/* Attach Image option */}
              <button
                type="button"
                onClick={handleImageClick}
                disabled={imageCount >= maxImages}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-accent transition-colors",
                  imageCount >= maxImages && "opacity-50 cursor-not-allowed"
                )}
              >
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <ImageIcon className="h-4 w-4 text-blue-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">Attach Image</div>
                  <div className="text-xs text-muted-foreground">
                    {imageCount >= maxImages
                      ? `Max ${maxImages} images reached`
                      : "Paste or select images"}
                  </div>
                </div>
                {imageCount > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {imageCount}
                  </Badge>
                )}
              </button>

              {/* Upload Document option */}
              <button
                type="button"
                onClick={handleDocClick}
                disabled={!conversationId}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-accent transition-colors",
                  !conversationId && "opacity-50 cursor-not-allowed"
                )}
              >
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <FileText className="h-4 w-4 text-green-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">Upload Document</div>
                  <div className="text-xs text-muted-foreground">
                    PDF, DOCX, PPTX
                  </div>
                </div>
              </button>

              {/* Knowledge Base option */}
              <button
                type="button"
                onClick={handleOpenKB}
                disabled={!conversationId}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-accent transition-colors",
                  !conversationId && "opacity-50 cursor-not-allowed"
                )}
              >
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <BookOpen className="h-4 w-4 text-purple-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">Knowledge Base</div>
                  <div className="text-xs text-muted-foreground">
                    Manage uploaded docs
                  </div>
                </div>
                {attachmentCount > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {attachmentCount}
                  </Badge>
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          ) : (
            // Knowledge Base view
            <div>
              {/* KB Header */}
              <div className="flex items-center justify-between px-3 py-2.5 border-b">
                <button
                  type="button"
                  onClick={() => setView("main")}
                  className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors"
                >
                  <ChevronRight className="h-4 w-4 rotate-180" />
                  Knowledge Base
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

              {/* KB Content */}
              <div className="p-3 space-y-3">
                {/* Upload button */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2"
                  onClick={handleDocClick}
                  disabled={isLoading || !conversationId}
                >
                  <Plus className="h-4 w-4" />
                  Add files
                </Button>

                {uploadError && (
                  <p className="text-xs text-destructive">{uploadError}</p>
                )}

                {/* Attachments list */}
                {attachments.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{attachmentCount} document{attachmentCount !== 1 ? "s" : ""}</span>
                      <span>{formatFileSize(totalSize)}</span>
                    </div>

                    <ScrollArea className="max-h-[200px]">
                      <div className="space-y-2">
                        {attachments.map((attachment) => (
                          <KBAttachmentItem
                            key={attachment.id}
                            attachment={attachment}
                            onDelete={handleDelete}
                            isDeleting={deletingId === attachment.id}
                          />
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}

                {/* Empty state */}
                {attachments.length === 0 && !isLoading && (
                  <p className="text-xs text-center text-muted-foreground py-2">
                    Upload documents to create a knowledge base. The AI will be able to search and reference them.
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
