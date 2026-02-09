"use client";

import {
  Trash2,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileText,
  FileSpreadsheet,
  File,
} from "lucide-react";
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
        "group flex items-start gap-3 rounded-lg border p-3 transition-colors",
        attachment.status === "error"
          ? "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20"
          : "border-border hover:bg-muted/50"
      )}
    >
      {/* File icon */}
      <div className="mt-0.5 flex-shrink-0">{getFileIcon(attachment.fileType)}</div>

      {/* File info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium" title={attachment.originalFilename}>
            {attachment.originalFilename}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatFileSize(attachment.fileSize)}</span>
          <span>·</span>
          <span className="flex items-center gap-1">
            {getStatusIcon(attachment.status)}
            {getStatusText(attachment)}
          </span>
        </div>

        {/* Progress bar for uploading */}
        {attachment.status === "uploading" && attachment.uploadProgress !== undefined && (
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
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
        className="h-7 w-7 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
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
