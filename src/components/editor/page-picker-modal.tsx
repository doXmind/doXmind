"use client";

import { useState, useMemo } from "react";
import { FileText, Search } from "lucide-react";
import { Modal, ModalHeader } from "@/components/ui/modal";
import { useEditorStore } from "@/stores/editor-store";
import { useFileStore } from "@/stores/file-store";
import { cn } from "@/lib/utils";
import { useSearchParams } from "next/navigation";

export function PagePickerModal() {
  const { pagePickerOpen, pagePickerCallback, closePagePicker } = useEditorStore();
  const files = useFileStore((s) => s.files);
  const [query, setQuery] = useState("");
  const searchParams = useSearchParams();
  const currentFileId = searchParams.get("id");

  const filteredPages = useMemo(() => {
    const pages = Object.values(files).filter((f) => !f.isFolder && f.id !== currentFileId);

    if (!query.trim()) return pages;

    const q = query.toLowerCase();
    return pages.filter((f) => f.name.toLowerCase().includes(q));
  }, [files, query, currentFileId]);

  const handleSelect = (file: (typeof filteredPages)[0]) => {
    pagePickerCallback?.({
      pageId: file.id,
      pageTitle: file.name,
      pageIcon: file.icon,
    });
    handleClose();
  };

  const handleClose = () => {
    setQuery("");
    closePagePicker();
  };

  return (
    <Modal open={pagePickerOpen} onClose={handleClose}>
      <ModalHeader onClose={handleClose}>Link to Page</ModalHeader>

      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pages..."
          autoFocus
          className={cn(
            "w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm",
            "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          )}
        />
      </div>

      {/* Page list */}
      <div className="max-h-[300px] overflow-y-auto">
        {filteredPages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {query ? "No pages match your search" : "No pages available"}
          </p>
        ) : (
          <div className="space-y-0.5">
            {filteredPages.map((file) => (
              <button
                key={file.id}
                type="button"
                onClick={() => handleSelect(file)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left",
                  "transition-colors hover:bg-accent/50"
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center text-base">
                  {file.icon || <FileText className="h-4 w-4 text-muted-foreground" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name || "Untitled"}</p>
                  {file.preview && (
                    <p className="truncate text-xs text-muted-foreground">{file.preview}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
