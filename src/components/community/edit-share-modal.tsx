"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export interface EditableShareItem {
  shareId: string;
  title: string;
  description: string | null;
  tags: string[];
}

interface EditShareModalProps {
  open: boolean;
  onClose: () => void;
  item: EditableShareItem;
  onSave: (updated: { title: string; description: string | null; tags: string[] }) => void;
}

export function EditShareModal({ open, onClose, item, onSave }: EditShareModalProps) {
  const t = useTranslations("community");
  const ts = useTranslations("share");
  const tc = useTranslations("common");
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description || "");
  const [tagsInput, setTagsInput] = useState(item.tags.join(", "));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(item.title);
      setDescription(item.description || "");
      setTagsInput(item.tags.join(", "));
    }
  }, [open, item]);

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error(t("titleRequired"));
      return;
    }

    setIsSaving(true);
    try {
      const tagList = tagsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const result = await api.updateShareMetadata(item.shareId, {
        title: title.trim(),
        description: description.trim() || undefined,
        tags: tagList.length > 0 ? tagList : [],
      });

      onSave({
        title: result.title,
        description: result.description,
        tags: result.tags || [],
      });

      toast.success(t("postUpdated"));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("failedToUpdatePost"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader onClose={onClose}>{t("editShareTitle")}</ModalHeader>

      <div className="space-y-4 py-2">
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-foreground">
            {ts("title")}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={ts("titlePlaceholder")}
            className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-foreground">
            {ts("description")}{" "}
            <span className="font-normal text-muted-foreground">{ts("descriptionOptional")}</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={ts("descriptionPlaceholder")}
            rows={3}
            maxLength={500}
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <p className="mt-1 text-right text-[11px] text-muted-foreground/50">
            {description.length}/500
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-foreground">
            {ts("tags")}{" "}
            <span className="font-normal text-muted-foreground">{t("tagsMaxCount")}</span>
          </label>
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder={ts("tagsPlaceholder")}
            className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      <ModalFooter>
        <button
          onClick={onClose}
          className="rounded-lg px-4 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {tc("cancel")}
        </button>
        <Button onClick={handleSave} disabled={isSaving || !title.trim()} className="h-9 px-5">
          {isSaving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          {t("saveChanges")}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
