"use client";

import * as React from "react";
import { Image as ImageIcon } from "lucide-react";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ImageModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (url: string, alt?: string) => void;
}

export function ImageModal({ open, onClose, onConfirm }: ImageModalProps) {
  const [url, setUrl] = React.useState("");
  const [alt, setAlt] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setUrl("");
      setAlt("");
      // Only auto-focus on desktop to avoid keyboard popup on mobile
      if (window.innerWidth >= 768) {
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      onConfirm(url.trim(), alt.trim() || undefined);
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader onClose={onClose}>
        <span className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5" />
          Insert Image
        </span>
      </ModalHeader>

      <form onSubmit={handleSubmit}>
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
              Alt Text{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
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
    </Modal>
  );
}
