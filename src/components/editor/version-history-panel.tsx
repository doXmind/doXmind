"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Clock, RotateCcw, Loader2, FileText, Pencil, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, formatDate, formatTime } from "@/lib/utils";
import { api } from "@/lib/api";
import { useFileStore } from "@/stores/file-store";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface VersionHistoryPanelProps {
  fileId: string;
  isOpen: boolean;
  onClose: () => void;
}

interface Version {
  id: string;
  file_id: string;
  content: string;
  edit_type?: string;
  summary?: string;
  created_at: string;
}

const EDIT_TYPE_CONFIG: Record<string, { labelKey: string; icon: React.ReactNode; color: string }> =
  {
    manual: {
      labelKey: "versionPanel.manualEdit",
      icon: <Pencil className="h-3 w-3" />,
      color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    },
    restore: {
      labelKey: "versionPanel.restored",
      icon: <Undo2 className="h-3 w-3" />,
      color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    },
  };

function getEditTypeConfig(editType?: string) {
  return (
    EDIT_TYPE_CONFIG[editType || "manual"] || {
      labelKey: editType || "Edit",
      icon: <FileText className="h-3 w-3" />,
      color: "bg-muted text-muted-foreground",
    }
  );
}

export function VersionHistoryPanel({ fileId, isOpen, onClose }: VersionHistoryPanelProps) {
  const t = useTranslations("editor");
  const [versions, setVersions] = useState<Version[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<Version | null>(null);

  const { getFile, updateFile } = useFileStore();

  const fetchVersions = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await api.listVersions(fileId);
      setVersions(result);
    } catch (error) {
      console.error("Failed to load versions:", error);
      toast.error(t("versionPanel.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [fileId, t]);

  useEffect(() => {
    if (isOpen && fileId) {
      fetchVersions();
    }
  }, [isOpen, fileId, fetchVersions]);

  const handleRestore = useCallback(
    async (version: Version) => {
      const file = getFile(fileId);
      if (!file) {
        toast.error(t("versionPanel.fileNotFound"));
        return;
      }

      if (file.content === version.content) {
        toast.info(t("versionPanel.noChangesIdentical"));
        return;
      }

      try {
        await updateFile(fileId, { content: version.content });
        setPreviewVersion(null);
        onClose();
        toast.success(t("versionRestored"));
      } catch (error) {
        console.error("Failed to restore version:", error);
        toast.error(t("versionPanel.loadFailed"));
      }
    },
    [fileId, getFile, onClose, t, updateFile]
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
          <h3 className="text-sm font-semibold">{t("versionHistory")}</h3>
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
            <p className="text-sm text-muted-foreground">{t("noVersions")}</p>
            <p className="px-4 text-xs text-muted-foreground/70">
              {t("versionPanel.versionsAutoCreated")}
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
                      {t(config.labelKey as Parameters<typeof t>[0])}
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
            <span className="text-xs font-medium text-muted-foreground">
              {t("versionPanel.preview")}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => handleRestore(previewVersion)}
            >
              <RotateCcw className="h-3 w-3" />
              {t("restoreVersion")}
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
