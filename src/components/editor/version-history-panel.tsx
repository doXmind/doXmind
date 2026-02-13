"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Clock, RotateCcw, Loader2, FileText, Sparkles, Pencil, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, formatDate, formatTime } from "@/lib/utils";
import { api } from "@/lib/api";
import { useFileStore } from "@/stores/file-store";
import { useDiffReviewStore } from "@/stores/diff-review-store";
import { computeDiffHunks } from "@/lib/diff-utils";
import { htmlToMarkdown } from "@/lib/markdown";
import { toast } from "sonner";

interface VersionHistoryPanelProps {
  fileId: string;
  isOpen: boolean;
  onClose: () => void;
}

interface Version {
  id: string;
  file_id: string;
  content: string;
  diff?: string;
  edit_type?: string;
  summary?: string;
  created_at: string;
}

const EDIT_TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  manual: {
    label: "Manual",
    icon: <Pencil className="h-3 w-3" />,
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  },
  ai_edit: {
    label: "AI Edit",
    icon: <Sparkles className="h-3 w-3" />,
    color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  },
  ai_quick_edit: {
    label: "Quick Edit",
    icon: <Sparkles className="h-3 w-3" />,
    color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  },
  restore: {
    label: "Restored",
    icon: <Undo2 className="h-3 w-3" />,
    color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  },
};

function getEditTypeConfig(editType?: string) {
  return (
    EDIT_TYPE_CONFIG[editType || "manual"] || {
      label: editType || "Edit",
      icon: <FileText className="h-3 w-3" />,
      color: "bg-muted text-muted-foreground",
    }
  );
}

export function VersionHistoryPanel({ fileId, isOpen, onClose }: VersionHistoryPanelProps) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<Version | null>(null);

  const { getFile } = useFileStore();

  const fetchVersions = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await api.listVersions(fileId);
      setVersions(result);
    } catch (error) {
      console.error("Failed to load versions:", error);
      toast.error("Failed to load version history");
    } finally {
      setIsLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    if (isOpen && fileId) {
      fetchVersions();
    }
  }, [isOpen, fileId, fetchVersions]);

  const handleRestore = useCallback(
    (version: Version) => {
      const { isReviewMode, startDiffReview } = useDiffReviewStore.getState();

      if (isReviewMode) {
        toast.error("Please finish the current diff review first");
        return;
      }

      const file = getFile(fileId);
      if (!file) {
        toast.error("File not found");
        return;
      }

      const versionMarkdown = htmlToMarkdown(version.content);

      const hunks = computeDiffHunks(file.content, {
        type: "replace_all",
        new_content: versionMarkdown,
        file_id: fileId,
        file_name: "",
        success: true,
      });

      if (hunks.length === 0) {
        toast.info("No differences — content is already identical");
        return;
      }

      startDiffReview(fileId, hunks, file.content);
      setPreviewVersion(null);
      onClose();
    },
    [fileId, getFile, onClose]
  );

  const handleVersionClick = (version: Version) => {
    if (previewVersion?.id === version.id) {
      setPreviewVersion(null);
    } else {
      setPreviewVersion(version);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="flex h-full w-80 flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Version History</h3>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Version List — shrinks when preview is open */}
      <ScrollArea className={cn("min-h-0", previewVersion ? "max-h-[40%]" : "flex-1")}>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : versions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Clock className="h-8 w-8 text-muted-foreground/30 dark:text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No versions yet</p>
            <p className="px-4 text-xs text-muted-foreground/70">
              Versions are created automatically when AI edits your document.
            </p>
          </div>
        ) : (
          <div className="p-2">
            {versions.map((version) => {
              const config = getEditTypeConfig(version.edit_type);
              const isPreview = previewVersion?.id === version.id;
              const date = new Date(version.created_at);

              return (
                <div
                  key={version.id}
                  onClick={() => handleVersionClick(version)}
                  className={cn(
                    "cursor-pointer rounded-md px-3 py-2.5 transition-colors",
                    isPreview ? "bg-accent" : "hover:bg-accent/50"
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                        config.color
                      )}
                    >
                      {config.icon}
                      {config.label}
                    </span>
                  </div>
                  {version.summary && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {version.summary}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-muted-foreground/70">
                    {formatDate(date)} at {formatTime(date)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Preview area — fills remaining space */}
      {previewVersion && (
        <div className="flex min-h-0 flex-1 flex-col border-t border-border">
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-xs font-medium text-muted-foreground">Preview</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => handleRestore(previewVersion)}
            >
              <RotateCcw className="h-3 w-3" />
              Restore
            </Button>
          </div>
          <ScrollArea className="min-h-0 flex-1 border-t border-border/50">
            <div
              className="prose prose-sm max-w-none px-4 py-3 text-xs dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: previewVersion.content }}
            />
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
