"use client";

import { useCallback, useState } from "react";
import { Upload, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface KBUploadZoneProps {
  onUpload: (file: File) => Promise<void>;
  disabled?: boolean;
  compact?: boolean;
}

const ALLOWED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".pptx"];
const MAX_SIZE = 50 * 1024 * 1024; // 50MB

export function KBUploadZone({ onUpload, disabled, compact }: KBUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateFile = useCallback((file: File): string | null => {
    // Check file type
    const extension = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension) && !ALLOWED_TYPES.includes(file.type)) {
      return `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`;
    }

    // Check file size
    if (file.size > MAX_SIZE) {
      return `File too large. Maximum size: ${MAX_SIZE / (1024 * 1024)}MB`;
    }

    return null;
  }, []);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;

      setError(null);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const validationError = validateFile(file);

        if (validationError) {
          setError(validationError);
          continue;
        }

        try {
          await onUpload(file);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Upload failed");
        }
      }
    },
    [onUpload, validateFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      setIsDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (disabled) return;

      const files = e.dataTransfer.files;
      handleFiles(files);
    },
    [disabled, handleFiles]
  );

  const handleClick = useCallback(() => {
    if (disabled) return;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ALLOWED_EXTENSIONS.join(",");
    input.multiple = true;

    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      handleFiles(files);
    };

    input.click();
  }, [disabled, handleFiles]);

  if (compact) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="w-full gap-2"
        onClick={handleClick}
        disabled={disabled}
      >
        <Plus className="h-4 w-4" />
        Add files
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "relative border-2 border-dashed rounded-lg p-4 transition-colors cursor-pointer",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-primary/50",
          disabled && "opacity-50 cursor-not-allowed"
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <Upload
            className={cn(
              "h-8 w-8 transition-colors",
              isDragging ? "text-primary" : "text-muted-foreground"
            )}
          />
          <div className="text-sm">
            <span className="font-medium text-primary">Click to upload</span>
            <span className="text-muted-foreground"> or drag and drop</span>
          </div>
          <p className="text-xs text-muted-foreground">
            PDF, DOCX, PPTX (max 50MB)
          </p>
        </div>
      </div>

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
