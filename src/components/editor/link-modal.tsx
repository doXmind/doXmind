"use client";

import * as React from "react";
import { Link as LinkIcon } from "lucide-react";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslations } from "next-intl";

interface LinkModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (url: string) => void;
  initialUrl?: string;
}

export function LinkModal({ open, onClose, onConfirm, initialUrl = "" }: LinkModalProps) {
  const t = useTranslations("editor");
  const tc = useTranslations("common");
  const [url, setUrl] = React.useState(initialUrl);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setUrl(initialUrl);
      // Focus input after modal opens (only on desktop to avoid keyboard popup on mobile)
      if (window.innerWidth >= 768) {
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    }
  }, [open, initialUrl]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      onConfirm(url.trim());
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmit(e);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader onClose={onClose}>
        <span className="flex items-center gap-2">
          <LinkIcon className="h-5 w-5" />
          {t("insertLink")}
        </span>
      </ModalHeader>

      <form onSubmit={handleSubmit}>
        <div className="space-y-2">
          <label htmlFor="link-url" className="text-sm font-medium">
            {t("linkUrl")}
          </label>
          <Input
            ref={inputRef}
            id="link-url"
            type="url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>

        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button type="submit" disabled={!url.trim()}>
            {tc("confirm")}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
