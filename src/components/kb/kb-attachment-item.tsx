"use client";

import { Trash2, Loader2, CheckCircle2, AlertCircle, FileText, FileSpreadsheet, File } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { KBAttachment } from "@/stores/kb-store";
import { formatFileSize } from "@/stores/kb-store";

interface KBAttachmentItemProps {
  attachment: KBAttachment;
  onDelete: (id: string) => void;
  isDeleting?: boolean;
}

function getFileIcon(fileType: string) {
  switch (fileType.toLowerCase()) {
    case "pdf":
      return <FileText className="h-4 w-4 text-red-500" />;
    case "docx":
      return <FileText className="h-4 w-4 text-blue-500" />;
    case "pptx":
      return <FileSpreadsheet className="h-4 w-4 text-orange-500" />;
    default:
      return <File className="h-4 w-4 text-gray-500" />;
  }
}

function getStatusIcon(status: KBAttachment["status"]) {
  switch (status) {
    case "uploading":
    case "processing":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
    case "indexed":
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
    case "error":
      return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
  }
}

function getStatusText(attachment: KBAttachment) {
  switch (attachment.status) {
    case "uploading":
      return `Uploading... ${attachment.uploadProgress ?? 0}%`;
    case "processing":
      return "Processing...";
    case "indexed":
      return `${attachment.chunkCount} sections`;
    case "error":
      return attachment.errorMessage || "Error";
  }
}

export function KBAttachmentItem({ attachment, onDelete, isDeleting }: KBAttachmentItemProps) {
  return (
    <div
      className={cn(
        "group flex items-start gap-3 p-3 rounded-lg border transition-colors",
        attachment.status === "error"
          ? "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20"
          : "border-border hover:bg-muted/50"
      )}
    >
      {/* File icon */}
      <div className="flex-shrink-0 mt-0.5">
        {getFileIcon(attachment.fileType)}
      </div>

      {/* File info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate" title={attachment.originalFilename}>
            {attachment.originalFilename}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
          <span>{formatFileSize(attachment.fileSize)}</span>
          <span>·</span>
          <span className="flex items-center gap-1">
            {getStatusIcon(attachment.status)}
            {getStatusText(attachment)}
          </span>
        </div>

        {/* Progress bar for uploading */}
        {attachment.status === "uploading" && attachment.uploadProgress !== undefined && (
          <div className="mt-2 h-1 w-full bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${attachment.uploadProgress}%` }}
            />
          </div>
        )}
      </div>

      {/* Delete button - always enabled so users can cancel processing files */}
      <Button
        variant="ghost"
        size="icon"
        className="flex-shrink-0 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => onDelete(attachment.id)}
        disabled={isDeleting}
      >
        {isDeleting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
        )}
      </Button>
    </div>
  );
}
