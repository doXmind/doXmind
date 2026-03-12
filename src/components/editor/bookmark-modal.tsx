"use client";

import { useState, useEffect, useRef } from "react";
import { Globe, Loader2 } from "lucide-react";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/stores/editor-store";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export function BookmarkModal() {
  const { bookmarkModalOpen, bookmarkModalCallback, closeBookmarkModal } = useEditorStore();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (bookmarkModalOpen) {
      setUrl("");
      setLoading(false);
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [bookmarkModalOpen]);

  const handleSubmit = async () => {
    let trimmed = url.trim();
    if (!trimmed) return;

    if (!/^https?:\/\//i.test(trimmed)) {
      trimmed = "https://" + trimmed;
    }

    setLoading(true);
    setError(null);

    try {
      const meta = await api.unfurlUrl(trimmed);
      bookmarkModalCallback?.({
        url: meta.url,
        title: meta.title,
        description: meta.description,
        faviconUrl: meta.favicon_url,
        imageUrl: meta.image_url,
      });
      closeBookmarkModal();
    } catch {
      setError("Failed to fetch URL metadata. The bookmark will be created with the URL only.");
      // Insert with just the URL on error
      bookmarkModalCallback?.({
        url: trimmed,
        title: trimmed,
        description: null,
        faviconUrl: null,
        imageUrl: null,
      });
      closeBookmarkModal();
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loading) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Modal open={bookmarkModalOpen} onClose={closeBookmarkModal}>
      <ModalHeader onClose={closeBookmarkModal}>Web Bookmark</ModalHeader>

      <div className="space-y-3">
        <div className="relative">
          <Globe className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Paste a URL..."
            className={cn(
              "w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm",
              "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            )}
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={closeBookmarkModal} disabled={loading}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!url.trim() || loading}>
          {loading ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Fetching...
            </>
          ) : (
            "Embed"
          )}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
