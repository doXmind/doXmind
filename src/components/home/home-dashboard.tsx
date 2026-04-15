"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FileText,
  Folder,
  Star,
  StarOff,
  Search,
  Trash2,
  Pencil,
  Settings as SettingsIcon,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { useFileStore, sortFilesByOption, type SortOption } from "@/stores/file-store";
import type { FileItem } from "@/types";
import { cn } from "@/lib/utils";

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Something went wrong";
}
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Logo } from "@/components/ui/logo";

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

function FileCard({ file }: { file: FileItem }) {
  const toggleFavorite = useFileStore((s) => s.toggleFavorite);
  const deleteFile = useFileStore((s) => s.deleteFile);
  const renameFile = useFileStore((s) => s.renameFile);
  const [renaming, setRenaming] = useState(false);
  const [nextName, setNextName] = useState(file.name);

  const Icon = file.isFolder ? Folder : FileText;
  const href = file.isFolder ? "/editor" : `/editor/${file.id}`;

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Move "${file.name}" to trash?`)) return;
    try {
      await deleteFile(file.id);
      toast.success("Moved to trash");
    } catch (err) {
      toast.error(errText(err));
    }
  };

  const handleToggleFavorite = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await toggleFavorite(file.id);
    } catch (err) {
      toast.error(errText(err));
    }
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nextName.trim() || nextName === file.name) {
      setRenaming(false);
      setNextName(file.name);
      return;
    }
    try {
      await renameFile(file.id, nextName.trim());
      setRenaming(false);
    } catch (err) {
      toast.error(errText(err));
    }
  };

  return (
    <Link
      href={href}
      className="group relative flex flex-col gap-2 rounded-lg border border-border/40 bg-card p-4 transition-colors hover:border-border hover:bg-accent/40"
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form onSubmit={handleRenameSubmit} onClick={(e) => e.preventDefault()}>
              <Input
                autoFocus
                value={nextName}
                onChange={(e) => setNextName(e.target.value)}
                onBlur={handleRenameSubmit}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setRenaming(false);
                    setNextName(file.name);
                  }
                }}
                className="h-7 text-sm"
              />
            </form>
          ) : (
            <div className="truncate text-sm font-medium" title={file.name}>
              {file.icon ? `${file.icon} ${file.name}` : file.name}
            </div>
          )}
          <div className="mt-0.5 text-xs text-muted-foreground">{formatDate(file.updatedAt)}</div>
        </div>
        <button
          type="button"
          onClick={handleToggleFavorite}
          aria-label={file.isFavorite ? "Unfavorite" : "Favorite"}
          className={cn(
            "rounded p-1 opacity-0 transition-opacity group-hover:opacity-100",
            file.isFavorite && "opacity-100"
          )}
        >
          {file.isFavorite ? (
            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
          ) : (
            <StarOff className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </div>

      {!file.isFolder && file.preview && (
        <p className="line-clamp-3 text-xs text-muted-foreground">{file.preview}</p>
      )}

      <div className="mt-auto flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setNextName(file.name);
            setRenaming(true);
          }}
          aria-label="Rename"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleDelete}
          aria-label="Delete"
          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </Link>
  );
}

export function HomeDashboard() {
  const router = useRouter();
  const files = useFileStore((s) => s.files);
  const loadFiles = useFileStore((s) => s.loadFiles);
  const isLoading = useFileStore((s) => s.isLoading);
  const createFile = useFileStore((s) => s.createFile);
  const createFolder = useFileStore((s) => s.createFolder);

  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("modified-newest");

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const { favorites, filtered } = useMemo(() => {
    const live = files.filter((f) => !f.isFolder || true);
    const q = query.trim().toLowerCase();
    const matched = q
      ? live.filter(
          (f) => f.name.toLowerCase().includes(q) || (f.preview || "").toLowerCase().includes(q)
        )
      : live;
    const sorted = sortFilesByOption(matched, sortBy);
    const favs = sorted.filter((f) => f.isFavorite && !f.isFolder);
    return { favorites: favs, filtered: sorted };
  }, [files, query, sortBy]);

  const handleCreateFile = async () => {
    try {
      const id = await createFile("Untitled", "");
      router.push(`/editor/${id}`);
    } catch (err) {
      toast.error(errText(err));
    }
  };

  const handleCreateFolder = async () => {
    const name = window.prompt("Folder name", "New Folder");
    if (!name?.trim()) return;
    try {
      await createFolder(name.trim(), null);
      toast.success("Folder created");
    } catch (err) {
      toast.error(errText(err));
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Logo variant="icon" size="md" className="h-8 w-8" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">doXmind</h1>
            <p className="text-sm text-muted-foreground">Local workspace</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            className="flex h-9 items-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <SettingsIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Settings</span>
          </Link>
        </div>
      </header>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files…"
            className="h-10 pl-9"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-10">
              Sort: {sortBy.replace("-", " ")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setSortBy("modified-newest")}>
              Modified (newest)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortBy("modified-oldest")}>
              Modified (oldest)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortBy("created-newest")}>
              Created (newest)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortBy("name-asc")}>Name (A–Z)</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortBy("name-desc")}>Name (Z–A)</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="h-10">
              <Plus className="mr-1 h-4 w-4" />
              New
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleCreateFile}>
              <FileText className="mr-2 h-4 w-4" />
              New document
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleCreateFolder}>
              <Folder className="mr-2 h-4 w-4" />
              New folder
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/editor")}>Open editor</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {favorites.length > 0 && !query && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
            Favorites
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {favorites.slice(0, 6).map((file) => (
              <FileCard key={file.id} file={file} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
          {query ? `Results (${filtered.length})` : "All files"}
        </h2>

        {isLoading && files.length === 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-lg border border-border/40 bg-muted/40"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 p-10 text-center">
            <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">
              {query ? "No files match your search." : "No files yet. Create your first document."}
            </p>
            {!query && (
              <Button onClick={handleCreateFile} className="mt-4" size="sm">
                <Plus className="mr-1 h-4 w-4" />
                New document
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((file) => (
              <FileCard key={file.id} file={file} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
