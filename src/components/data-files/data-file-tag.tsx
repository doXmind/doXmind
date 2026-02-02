"use client";

import {
  X,
  FileSpreadsheet,
  FileJson,
  FileText,
  Image,
  Loader2,
  AlertCircle,
  Cloud,
  CloudOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DataFile,
  formatFileSize,
  INLINE_FILE_THRESHOLD,
  ClaudeUploadStatus,
} from "@/stores/data-files-store";
import { Tooltip } from "@/components/ui/tooltip";

interface DataFileTagProps {
  file: DataFile;
  onRemove: () => void;
  disabled?: boolean;
}

function getFileIcon(fileType: string) {
  switch (fileType.toLowerCase()) {
    case "csv":
    case "xlsx":
    case "xls":
      return FileSpreadsheet;
    case "json":
      return FileJson;
    case "txt":
      return FileText;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
      return Image;
    default:
      return FileText;
  }
}

// Check if file needs Claude pre-upload indicator
function needsClaudeIndicator(file: DataFile): boolean {
  const isImage = file.mimeType?.startsWith("image/");
  const isPdf = file.mimeType === "application/pdf";
  return !isImage && !isPdf && file.fileSize >= INLINE_FILE_THRESHOLD;
}

// Get Claude status indicator for tag
function getClaudeIndicator(status: ClaudeUploadStatus | undefined): {
  icon: React.ReactNode;
  tooltip: string;
  color: string;
} | null {
  switch (status) {
    case "pending":
    case "uploading":
      return {
        icon: <Loader2 className="h-2.5 w-2.5 animate-spin" />,
        tooltip: "Optimizing...",
        color: "text-blue-500",
      };
    case "ready":
      return {
        icon: <Cloud className="h-2.5 w-2.5" />,
        tooltip: "Optimized",
        color: "text-green-500",
      };
    case "error":
      return {
        icon: <CloudOff className="h-2.5 w-2.5" />,
        tooltip: "Will upload on send",
        color: "text-amber-500",
      };
    default:
      return null;
  }
}

export function DataFileTag({ file, onRemove, disabled }: DataFileTagProps) {
  const Icon = getFileIcon(file.fileType);
  const isUploading = file.status === "uploading";
  const isError = file.status === "error";
  const showClaudeIndicator = needsClaudeIndicator(file);
  const claudeIndicator = showClaudeIndicator ? getClaudeIndicator(file.claudeUploadStatus) : null;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs",
        "border transition-colors",
        isError
          ? "border-destructive/50 bg-destructive/10 text-destructive"
          : isUploading
            ? "border-green-500/30 bg-green-500/5 text-muted-foreground"
            : "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400"
      )}
    >
      {/* Icon */}
      {isUploading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : isError ? (
        <AlertCircle className="h-3 w-3" />
      ) : (
        <Icon className="h-3 w-3" />
      )}

      {/* Filename (truncated) */}
      <span className="max-w-[120px] truncate font-medium">{file.originalFilename}</span>

      {/* File size */}
      <span className="text-[10px] opacity-70">{formatFileSize(file.fileSize)}</span>

      {/* Row count for tabular data */}
      {file.rowCount !== undefined && file.rowCount > 0 && (
        <span className="text-[10px] opacity-70">({file.rowCount} rows)</span>
      )}

      {/* Claude optimization indicator */}
      {claudeIndicator && (
        <Tooltip content={claudeIndicator.tooltip} side="top" delayDuration={300}>
          <span className={cn("flex items-center", claudeIndicator.color)}>
            {claudeIndicator.icon}
          </span>
        </Tooltip>
      )}

      {/* Remove button */}
      {!disabled && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className={cn(
            "ml-0.5 rounded-full p-0.5 transition-colors",
            isError ? "hover:bg-destructive/20" : "hover:bg-green-500/20"
          )}
          aria-label={`Remove ${file.originalFilename}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// Compact version for inline display
export function DataFileTagCompact({ file, onRemove }: DataFileTagProps) {
  const Icon = getFileIcon(file.fileType);
  const isError = file.status === "error";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]",
        isError
          ? "bg-destructive/10 text-destructive"
          : "bg-green-500/10 text-green-700 dark:text-green-400"
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      <span className="max-w-[80px] truncate">{file.originalFilename}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="hover:opacity-70"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}
