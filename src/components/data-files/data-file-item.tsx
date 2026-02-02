"use client";

import {
  Trash2,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  FileText,
  FileJson,
  Image,
  Cloud,
  CloudOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DataFile, ClaudeUploadStatus } from "@/stores/data-files-store";
import { formatFileSize, INLINE_FILE_THRESHOLD } from "@/stores/data-files-store";

interface DataFileItemProps {
  file: DataFile;
  onDelete: (id: string) => void;
  isDeleting?: boolean;
}

function getFileIcon(fileType: string) {
  switch (fileType.toLowerCase()) {
    case "csv":
      return <FileSpreadsheet className="h-4 w-4 text-green-500" />;
    case "xlsx":
    case "xls":
      return <FileSpreadsheet className="h-4 w-4 text-green-600" />;
    case "json":
      return <FileJson className="h-4 w-4 text-yellow-500" />;
    case "txt":
      return <FileText className="h-4 w-4 text-gray-500" />;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
      return <Image className="h-4 w-4 text-purple-500" />;
    default:
      return <FileText className="h-4 w-4 text-gray-500" />;
  }
}

function getStatusIcon(status: DataFile["status"]) {
  switch (status) {
    case "uploading":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
    case "ready":
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
    case "error":
      return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
  }
}

function getStatusText(file: DataFile) {
  switch (file.status) {
    case "uploading":
      return `Uploading... ${file.uploadProgress ?? 0}%`;
    case "ready":
      if (file.rowCount && file.rowCount > 0) {
        return `${file.rowCount} rows`;
      }
      return "Ready";
    case "error":
      return file.errorMessage || "Error";
  }
}

// Check if file needs Claude pre-upload (large non-image files)
function needsClaudeUpload(file: DataFile): boolean {
  const isImage = file.mimeType?.startsWith("image/");
  const isPdf = file.mimeType === "application/pdf";
  return !isImage && !isPdf && file.fileSize >= INLINE_FILE_THRESHOLD;
}

// Get Claude upload status display info
function getClaudeStatusInfo(status: ClaudeUploadStatus | undefined): {
  icon: React.ReactNode;
  text: string;
  color: string;
} | null {
  switch (status) {
    case "pending":
      return {
        icon: <Cloud className="h-3 w-3" />,
        text: "Preparing for analysis...",
        color: "text-muted-foreground",
      };
    case "uploading":
      return {
        icon: <Loader2 className="h-3 w-3 animate-spin" />,
        text: "Optimizing for faster analysis...",
        color: "text-blue-500",
      };
    case "ready":
      return {
        icon: <Cloud className="h-3 w-3" />,
        text: "Optimized for fast analysis",
        color: "text-green-500",
      };
    case "error":
      return {
        icon: <CloudOff className="h-3 w-3" />,
        text: "Pre-upload failed (will upload on send)",
        color: "text-amber-500",
      };
    case "skipped":
    default:
      return null; // Don't show for small files
  }
}

export function DataFileItem({ file, onDelete, isDeleting }: DataFileItemProps) {
  const showClaudeStatus = needsClaudeUpload(file);
  const claudeStatus = showClaudeStatus ? getClaudeStatusInfo(file.claudeUploadStatus) : null;

  return (
    <div
      className={cn(
        "group flex items-start gap-3 rounded-lg border p-3 transition-colors",
        file.status === "error"
          ? "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20"
          : "border-border hover:bg-muted/50"
      )}
    >
      {/* File icon */}
      <div className="mt-0.5 flex-shrink-0">{getFileIcon(file.fileType)}</div>

      {/* File info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium" title={file.originalFilename}>
            {file.originalFilename}
          </span>
          {/* Claude optimization indicator */}
          {claudeStatus && (
            <Tooltip content={claudeStatus.text} side="top" delayDuration={300}>
              <span className={cn("flex items-center", claudeStatus.color)}>
                {claudeStatus.icon}
              </span>
            </Tooltip>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatFileSize(file.fileSize)}</span>
          <span>·</span>
          <span className="flex items-center gap-1">
            {getStatusIcon(file.status)}
            {getStatusText(file)}
          </span>
        </div>

        {/* Progress bar for uploading */}
        {file.status === "uploading" && file.uploadProgress !== undefined && (
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-green-500 transition-all duration-300"
              style={{ width: `${file.uploadProgress}%` }}
            />
          </div>
        )}
      </div>

      {/* Delete button */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={() => onDelete(file.id)}
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
