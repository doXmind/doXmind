"use client";

import { useState, useEffect } from "react";
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
      toast.error("Title is required");
      return;
    }

    setIsSaving(true);
    try {
      const tagList = tagsInput
        .split(",")
        .map((t) => t.trim())
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

      toast.success("Post updated!");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update post");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader onClose={onClose}>Edit Post</ModalHeader>

      <div className="space-y-4 py-2">
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-foreground">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Document title"
            className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-foreground">
            Description <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this about?"
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
            Tags{" "}
            <span className="font-normal text-muted-foreground">(comma-separated, max 10)</span>
          </label>
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="e.g. tutorial, react, design"
            className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      <ModalFooter>
        <button
          onClick={onClose}
          className="rounded-lg px-4 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Cancel
        </button>
        <Button onClick={handleSave} disabled={isSaving || !title.trim()} className="h-9 px-5">
          {isSaving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Save Changes
        </Button>
      </ModalFooter>
    </Modal>
  );
}
