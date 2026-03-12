"use client";

import { ChevronRight, Home } from "lucide-react";
import { useFileStore } from "@/stores/file-store";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface BreadcrumbNavProps {
  fileId: string;
}

export function BreadcrumbNav({ fileId }: BreadcrumbNavProps) {
  const { getFile, getFolderAncestors, setCurrentFile } = useFileStore();
  const router = useRouter();
  const file = getFile(fileId);

  if (!file || !file.parentId) return null;

  const ancestors = getFolderAncestors(file.parentId);

  const navigateTo = (targetId: string) => {
    const target = getFile(targetId);
    if (!target) return;
    if (target.isFolder) {
      // Navigate to folder view — open the first file in that folder or just
      // set the current folder in the sidebar
      useFileStore.getState().setCurrentFolder(targetId);
      useFileStore.getState().setFolderExpanded(targetId, true);
    } else {
      setCurrentFile(targetId);
      router.push(`/editor/${targetId}`);
    }
  };

  return (
    <nav className="flex items-center gap-0.5 overflow-hidden text-xs text-muted-foreground">
      <button
        onClick={() => {
          useFileStore.getState().setCurrentFolder(null);
        }}
        className="flex flex-shrink-0 items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-accent hover:text-foreground"
      >
        <Home className="h-3 w-3" />
      </button>

      {ancestors.map((ancestor) => (
        <span key={ancestor.id} className="flex items-center gap-0.5">
          <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground/50" />
          <button
            onClick={() => navigateTo(ancestor.id)}
            className={cn(
              "max-w-[120px] truncate rounded px-1 py-0.5 transition-colors hover:bg-accent hover:text-foreground"
            )}
            title={ancestor.name.replace(/\.md$/, "")}
          >
            {ancestor.icon && <span className="mr-0.5">{ancestor.icon}</span>}
            {ancestor.name.replace(/\.md$/, "")}
          </button>
        </span>
      ))}

      <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground/50" />
      <span className="max-w-[150px] truncate px-1 py-0.5 text-foreground/70">
        {file.icon && <span className="mr-0.5">{file.icon}</span>}
        {file.name.replace(/\.md$/, "")}
      </span>
    </nav>
  );
}
