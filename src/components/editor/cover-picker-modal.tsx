"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Upload, Link, Loader2, AlertCircle, Images } from "lucide-react";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { notify } from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { parseUploadError } from "@/lib/utils/image-upload-errors";
import { coverPresetCategories, isCssBackground } from "@/lib/cover-presets";

interface CoverPickerModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (value: string) => void;
  currentValue?: string | null;
}

type CoverTab = "gallery" | "upload" | "url";

export function CoverPickerModal({
  open,
  onClose,
  onConfirm,
  currentValue,
}: CoverPickerModalProps) {
  const t = useTranslations("editor.coverPicker");
  const tc = useTranslations("common");
  const [tab, setTab] = React.useState<CoverTab>("gallery");
  const [url, setUrl] = React.useState("");
  const [isUploading, setIsUploading] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [currentFile, setCurrentFile] = React.useState<File | null>(null);
  const urlInputRef = React.useRef<HTMLInputElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setUrl("");
      setPreview(null);
      setIsUploading(false);
      setIsDragging(false);
      setUploadError(null);
      setCurrentFile(null);
      setTab("gallery");
    }
  }, [open]);

  // ---- Upload handlers ----

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) return;

    setCurrentFile(file);
    setUploadError(null);

    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);

    setIsUploading(true);
    try {
      const result = await api.uploadImage(file);
      onConfirm(result.url);
      onClose();
    } catch (error) {
      const errorMessage = parseUploadError(error);
      setUploadError(errorMessage);
      notify.error(errorMessage);
    } finally {
      setIsUploading(false);
    }
  };

  const handleRetry = () => {
    if (currentFile) handleFileUpload(currentFile);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith("image/")) handleFileUpload(file);
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
    if (file) handleFileUpload(file);
    e.target.value = "";
  };

  // ---- URL handler ----

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        notify.error("URL must start with http:// or https://");
        return;
      }
    } catch {
      notify.error("Invalid URL");
      return;
    }
    onConfirm(trimmed);
    onClose();
  };

  // ---- Gallery handler ----

  const handlePresetSelect = (value: string) => {
    onConfirm(value);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} className="max-w-lg">
      <ModalHeader onClose={onClose}>
        <span className="flex items-center gap-2">
          <Images className="h-5 w-5" />
          {t("title")}
        </span>
      </ModalHeader>

      {/* Tab switcher */}
      <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1">
        <button
          type="button"
          onClick={() => setTab("gallery")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab === "gallery"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Images className="h-4 w-4" />
          {t("galleryTab")}
        </button>
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

      {/* --- Gallery tab --- */}
      {tab === "gallery" && (
        <div className="max-h-[400px] space-y-4 overflow-y-auto pr-1">
          {coverPresetCategories.map((category) => (
            <div key={category.labelKey}>
              <p className="text-ui-xs mb-2 font-medium uppercase tracking-wider text-muted-foreground">
                {t(category.labelKey)}
              </p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {category.presets.map((preset) => {
                  const isSelected =
                    currentValue === preset.value ||
                    (currentValue &&
                      isCssBackground(currentValue) &&
                      currentValue === preset.value);
                  const isSolid = preset.value.startsWith("#");

                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handlePresetSelect(preset.value)}
                      title={preset.label}
                      className={cn(
                        "aspect-[3/1] rounded-lg border transition-all",
                        "hover:ring-2 hover:ring-primary/50 hover:ring-offset-1 hover:ring-offset-background",
                        isSelected
                          ? "border-primary ring-2 ring-primary ring-offset-2 ring-offset-background"
                          : "border-border/30"
                      )}
                      style={
                        isSolid ? { backgroundColor: preset.value } : { background: preset.value }
                      }
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* --- Upload tab --- */}
      {tab === "upload" && (
        <div className="space-y-4">
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
                alt="Preview"
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
        </div>
      )}

      {/* --- URL tab --- */}
      {tab === "url" && (
        <form onSubmit={handleUrlSubmit}>
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="cover-url" className="text-sm font-medium">
                {t("imageUrl")}
              </label>
              <Input
                ref={urlInputRef}
                id="cover-url"
                type="url"
                placeholder={t("imageUrlPlaceholder")}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
          </div>

          <ModalFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={!url.trim()}>
              {t("apply")}
            </Button>
          </ModalFooter>
        </form>
      )}
    </Modal>
  );
}
