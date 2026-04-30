"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Smile, Download, FilePlus, ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useFileStore } from "@/stores/file-store";
import { EmojiPicker } from "@/components/ui/emoji-picker";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CoverPickerModal } from "./cover-picker-modal";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";

interface DocumentTitleProps {
  fileId: string;
  fileName: string;
  onEnterEditor?: () => void;
}

export function DocumentTitle({ fileId, fileName, onEnterEditor }: DocumentTitleProps) {
  const {
    renameFile,
    getFile,
    setFileIcon,
    createFile,
    setCurrentFile,
    setCoverImage,
    workspaceMode,
  } = useFileStore();
  const router = useRouter();
  const file = getFile(fileId);
  const icon = file?.icon ?? null;
  const hasCover = !!file?.coverImageUrl;
  const displayName = fileName.replace(/\.md$/, "");
  const [value, setValue] = useState(displayName);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showCoverModal, setShowCoverModal] = useState(false);
  const t = useTranslations("editor");

  const handleExport = useCallback(
    (format: "markdown" | "pdf" | "docx") => {
      if (!file) return;
      const formatLabel = format === "markdown" ? "Markdown" : format.toUpperCase();

      if (workspaceMode === "disk") {
        if (format !== "markdown") {
          toast.error(t("diskExportOnlyMarkdown"));
          return;
        }
        const markdown = file.contentMarkdown ?? file.content ?? "";
        const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
        const baseName = fileName.replace(/\.md$/, "");
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${baseName}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success(t("exportedAs", { format: formatLabel }));
        return;
      }

      toast.promise(
        api.exportFile(fileId, format).then((blob) => {
          const baseName = fileName.replace(/\.md$/, "");
          const extension = format === "markdown" ? "md" : format;
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${baseName}.${extension}`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }),
        {
          loading: t("exportingAs", { format: formatLabel }),
          success: t("exportedAs", { format: formatLabel }),
          error: t("failedToExportAs", { format: formatLabel }),
        }
      );
    },
    [file, fileId, fileName, t, workspaceMode]
  );
  const [isHovered, setIsHovered] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const iconButtonRef = useRef<HTMLButtonElement>(null);
  const addIconButtonRef = useRef<HTMLButtonElement>(null);
  const isComposingRef = useRef(false);

  const handleCreateSubPage = useCallback(async () => {
    try {
      // Create sub-page nested under the current file
      const newFileId = await createFile("Untitled.md", "", fileId);
      setCurrentFile(newFileId);
      router.push(`/editor/${newFileId}`);
    } catch {
      // silently ignore if creation fails
    }
  }, [createFile, fileId, setCurrentFile, router]);

  // Sync value when file changes
  useEffect(() => {
    setValue(displayName);
  }, [displayName]);

  // Auto-resize textarea to fit content
  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [value]);

  const handleBlur = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setValue(displayName);
      return;
    }
    const newName = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
    if (newName !== fileName) {
      try {
        await renameFile(fileId, newName);
      } catch {
        setValue(displayName);
      }
    }
  }, [value, displayName, fileName, fileId, renameFile]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingRef.current) return;
    if (e.key === "Enter") {
      e.preventDefault();
      onEnterEditor?.();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setValue(displayName);
      inputRef.current?.blur();
    }
  };

  const handleEmojiSelect = useCallback(
    (emoji: string | null) => {
      setFileIcon(fileId, emoji);
      setShowEmojiPicker(false);
    },
    [fileId, setFileIcon]
  );

  return (
    <div
      className="mb-2 mt-4 px-0"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Action buttons — above title, Notion-style; opacity transition, no layout shift */}
      <div
        className="flex h-7 items-center gap-1 transition-opacity duration-150"
        style={{ opacity: isHovered ? 1 : 0, pointerEvents: isHovered ? "auto" : "none" }}
      >
        {!icon && (
          <button
            ref={addIconButtonRef}
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
          >
            <Smile className="h-3.5 w-3.5" />
            <span>Add icon</span>
          </button>
        )}
        {!hasCover && (
          <button
            onClick={() => setShowCoverModal(true)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
          >
            <ImagePlus className="h-3.5 w-3.5" />
            <span>Add cover</span>
          </button>
        )}
        <button
          onClick={handleCreateSubPage}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
        >
          <FilePlus className="h-3.5 w-3.5" />
          <span>New sub-page</span>
        </button>
      </div>

      <div className="flex items-start gap-2">
        {/* Emoji icon button — only shown when icon is set */}
        {icon && (
          <button
            ref={iconButtonRef}
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className="mt-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent"
            title="Change document icon"
          >
            <span className="text-2xl leading-none">{icon}</span>
          </button>
        )}

        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          placeholder="Untitled"
          rows={1}
          className="w-full resize-none overflow-hidden border-none bg-transparent text-3xl font-bold leading-tight tracking-tight text-foreground outline-none placeholder:text-muted-foreground/30 focus:ring-0 dark:placeholder:text-muted-foreground/50"
          style={{ letterSpacing: "-0.02em" }}
          spellCheck={false}
        />

        {/* Export menu — replaces the legacy share button (no sharing in
            the local-first build, but exporting the doc to md/pdf/docx is
            the natural action from this slot). */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Tooltip content={t("export")} side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="mt-1 h-9 w-9 flex-shrink-0 text-muted-foreground/40 hover:text-muted-foreground dark:text-muted-foreground/60"
                aria-label={t("export")}
              >
                <Download className="h-4 w-4" />
              </Button>
            </Tooltip>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => handleExport("markdown")}>
              <Download className="mr-2 h-4 w-4" />
              {t("exportAsMarkdown")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("pdf")}>
              <Download className="mr-2 h-4 w-4" />
              {t("exportAsPDF")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("docx")}>
              <Download className="mr-2 h-4 w-4" />
              {t("exportAsWord")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Emoji picker */}
      {showEmojiPicker && (iconButtonRef.current || addIconButtonRef.current) && (
        <EmojiPicker
          onSelect={handleEmojiSelect}
          onClose={() => setShowEmojiPicker(false)}
          anchorRect={(iconButtonRef.current ?? addIconButtonRef.current)!.getBoundingClientRect()}
        />
      )}

      {/* Cover picker modal */}
      <CoverPickerModal
        open={showCoverModal}
        onClose={() => setShowCoverModal(false)}
        onConfirm={(value) => {
          setCoverImage(fileId, value);
          setShowCoverModal(false);
        }}
      />
    </div>
  );
}
