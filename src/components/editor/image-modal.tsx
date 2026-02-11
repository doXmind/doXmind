"use client";

import * as React from "react";
import { Image as ImageIcon, Upload, Link, Loader2 } from "lucide-react";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

interface ImageModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (url: string, alt?: string) => void;
}

type Tab = "upload" | "url";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ImageModal({ open, onClose, onConfirm }: ImageModalProps) {
  const [tab, setTab] = React.useState<Tab>("upload");
  const [url, setUrl] = React.useState("");
  const [alt, setAlt] = React.useState("");
  const [isUploading, setIsUploading] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const [preview, setPreview] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setUrl("");
      setAlt("");
      setPreview(null);
      setIsUploading(false);
      setIsDragging(false);
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
    } catch {
      // Fallback: if server upload fails, use data URL
      toast.error("Server upload failed, using embedded image instead");
      const dataUrl = await fileToDataUrl(file);
      onConfirm(dataUrl, alt.trim() || file.name.replace(/\.[^.]+$/, ""));
      onClose();
    } finally {
      setIsUploading(false);
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
          Insert Image
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
          Upload
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
          URL
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
                <p className="text-sm text-muted-foreground">Uploading...</p>
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
                <p className="text-sm font-medium">Drop an image here or click to browse</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  PNG, JPG, GIF, WebP, SVG (max 10MB)
                </p>
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

          <div className="space-y-2">
            <label htmlFor="upload-alt" className="text-sm font-medium">
              Alt Text <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="upload-alt"
              type="text"
              placeholder="Describe the image"
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
                Image URL
              </label>
              <Input
                ref={inputRef}
                id="image-url"
                type="url"
                placeholder="https://example.com/image.png"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="image-alt" className="text-sm font-medium">
                Alt Text <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="image-alt"
                type="text"
                placeholder="Describe the image"
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
              />
            </div>
          </div>

          <ModalFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!url.trim()}>
              Insert
            </Button>
          </ModalFooter>
        </form>
      )}
    </Modal>
  );
}
