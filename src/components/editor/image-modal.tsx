"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Image as ImageIcon, Upload, Link, Loader2, AlertCircle } from "lucide-react";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { parseUploadError } from "@/lib/utils/image-upload-errors";

interface ImageModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (url: string, alt?: string) => void;
}

type Tab = "upload" | "url";

export function ImageModal({ open, onClose, onConfirm }: ImageModalProps) {
  const t = useTranslations("editor");
  const tc = useTranslations("common");
  const [tab, setTab] = React.useState<Tab>("upload");
  const [url, setUrl] = React.useState("");
  const [alt, setAlt] = React.useState("");
  const [isUploading, setIsUploading] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [currentFile, setCurrentFile] = React.useState<File | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setUrl("");
      setAlt("");
      setPreview(null);
      setIsUploading(false);
      setIsDragging(false);
      setUploadError(null);
      setCurrentFile(null);
      setTab("upload");
      if (window.innerWidth >= 768) {
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    }
  }, [open]);

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      return;
    }

    // Save file for potential retry
    setCurrentFile(file);
    setUploadError(null);

    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);

    // Upload to server
    setIsUploading(true);
    try {
      const result = await api.uploadImage(file);
      onConfirm(result.url, alt.trim() || file.name.replace(/\.[^.]+$/, ""));
      onClose();
    } catch (error) {
      // Show error and keep modal open for retry
      const errorMessage = parseUploadError(error);
      setUploadError(errorMessage);
      toast.error(errorMessage);
      // Modal stays open, user can retry or cancel
    } finally {
      setIsUploading(false);
    }
  };

  const handleRetry = () => {
    if (currentFile) {
      handleFileUpload(currentFile);
    }
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      onConfirm(url.trim(), alt.trim() || undefined);
      onClose();
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      handleFileUpload(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
    e.target.value = "";
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader onClose={onClose}>
        <span className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5" />
          {t("insertImage")}
        </span>
      </ModalHeader>

      {/* Tab switcher */}
      <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1">
        <button
          type="button"
          onClick={() => setTab("upload")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab === "upload"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Upload className="h-4 w-4" />
          {t("uploadTab")}
        </button>
        <button
          type="button"
          onClick={() => setTab("url")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab === "url"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Link className="h-4 w-4" />
          {t("urlTab")}
        </button>
      </div>

      {tab === "upload" ? (
        <div className="space-y-4">
          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors",
              isDragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-accent/50"
            )}
          >
            {isUploading ? (
              <>
                <Loader2 className="mb-2 h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">{t("uploadingImage")}</p>
              </>
            ) : preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt={t("previewLabel")}
                className="max-h-32 max-w-full rounded object-contain"
              />
            ) : (
              <>
                <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">{t("dropImageHere")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("imageFormats")}</p>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Error display with retry */}
          {uploadError && (
            <div className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
              <div className="flex-1 space-y-2">
                <p className="text-sm text-destructive">{uploadError}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleRetry}
                  disabled={isUploading}
                  className="h-8"
                >
                  {t("retryUpload")}
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="upload-alt" className="text-sm font-medium">
              {t("altTextOptional")}
            </label>
            <Input
              id="upload-alt"
              type="text"
              placeholder={t("describeTheImage")}
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
            />
          </div>
        </div>
      ) : (
        <form onSubmit={handleUrlSubmit}>
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="image-url" className="text-sm font-medium">
                {t("imageUrl")}
              </label>
              <Input
                ref={inputRef}
                id="image-url"
                type="url"
                placeholder={t("imageUrlPlaceholder")}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="image-alt" className="text-sm font-medium">
                {t("altTextOptional")}
              </label>
              <Input
                id="image-alt"
                type="text"
                placeholder={t("describeTheImage")}
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
              />
            </div>
          </div>

          <ModalFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={!url.trim()}>
              {t("insert")}
            </Button>
          </ModalFooter>
        </form>
      )}
    </Modal>
  );
}
