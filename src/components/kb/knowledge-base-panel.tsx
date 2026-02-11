"use client";

import { useEffect, useState, useCallback } from "react";
import { BookOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { useKBStore, formatFileSize } from "@/stores/kb-store";
import { KBAttachmentItem } from "./kb-attachment-item";
import { KBUploadZone } from "./kb-upload-zone";

interface KnowledgeBasePanelProps {
  conversationId: string | null;
}

export function KnowledgeBasePanel({ conversationId }: KnowledgeBasePanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { isLoading, loadAttachments, uploadAttachments, deleteAttachment, getAttachments } =
    useKBStore();

  const attachments = conversationId ? getAttachments(conversationId) : [];
  const attachmentCount = attachments.filter((a) => a.status !== "error").length;
  const totalSize = attachments.reduce((sum, a) => sum + a.fileSize, 0);

  // Load attachments when conversation changes
  useEffect(() => {
    if (conversationId && isOpen) {
      loadAttachments(conversationId);
    }
  }, [conversationId, isOpen, loadAttachments]);

  const handleUpload = useCallback(
    async (files: File[]) => {
      if (!conversationId || files.length === 0) return;
      try {
        await uploadAttachments(conversationId, files);
      } catch {
        toast.error("Failed to upload files");
      }
    },
    [conversationId, uploadAttachments]
  );

  const handleDelete = useCallback(
    async (attachmentId: string) => {
      if (!conversationId) return;
      setDeletingId(attachmentId);
      try {
        await deleteAttachment(conversationId, attachmentId);
      } catch {
        toast.error("Failed to delete attachment");
      } finally {
        setDeletingId(null);
      }
    },
    [conversationId, deleteAttachment]
  );

  // Don't render if no conversation
  if (!conversationId) {
    return null;
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8" title="Knowledge Base">
          <BookOpen className="h-4 w-4" />
          {attachmentCount > 0 && (
            <Badge
              variant="secondary"
              className="absolute -right-1 -top-1 h-4 min-w-[16px] px-1 text-[10px] font-medium"
            >
              {attachmentCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0" sideOffset={8}>
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            <span className="text-sm font-medium">Knowledge Base</span>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsOpen(false)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Content */}
        <div className="space-y-4 p-4">
          {/* Upload zone */}
          <KBUploadZone
            onUpload={handleUpload}
            disabled={isLoading}
            compact={attachments.length > 0}
          />

          {/* Attachments list */}
          {attachments.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {attachmentCount} document{attachmentCount !== 1 ? "s" : ""}
                </span>
                <span>{formatFileSize(totalSize)}</span>
              </div>

              <ScrollArea className="max-h-[240px]">
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
            <p className="py-2 text-center text-xs text-muted-foreground">
              Upload documents to create a knowledge base for this conversation. The AI will be able
              to search and reference them.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
