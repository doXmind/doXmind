"use client";

import { useEffect } from "react";
import { Folder, FolderOpen, FileText, ChevronRight } from "lucide-react";
import type { SharedItemResponse } from "@/lib/api";
import { SharedThemeToggle } from "@/components/shared/shared-theme-toggle";
import { Logo } from "@/components/ui/logo";
import { Tooltip } from "@/components/ui/tooltip";

interface SharedFolderViewProps {
  data: SharedItemResponse;
  onNavigate: (path: string | null) => void;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function SharedFolderView({ data, onNavigate }: SharedFolderViewProps) {
  useEffect(() => {
    window.document.title = data.name;
  }, [data.name]);

  const items = data.items || [];
  const breadcrumbs = data.breadcrumbs || [];
  const isSubfolder = breadcrumbs.length > 0;

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Compact header with logo + breadcrumbs */}
      <header className="border-b border-border bg-card px-6 py-3 shadow-sm">
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <Tooltip content="doXmind" side="bottom">
              <a
                href="https://beta.doxmind.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent"
              >
                <Logo variant="icon" size="sm" className="h-6 w-6" />
              </a>
            </Tooltip>

            {/* Breadcrumb trail */}
            {isSubfolder && (
              <nav className="flex min-w-0 items-center gap-1 text-sm">
                <button
                  onClick={() => onNavigate(null)}
                  className="flex-shrink-0 truncate text-muted-foreground transition-colors hover:text-foreground"
                  style={{ maxWidth: "10rem" }}
                >
                  {data.root_folder_name || "Home"}
                </button>
                {breadcrumbs.map((crumb) => (
                  <span key={crumb.id} className="flex items-center gap-1">
                    <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground/50" />
                    <button
                      onClick={() => onNavigate(crumb.id)}
                      className="truncate text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {crumb.name}
                    </button>
                  </span>
                ))}
                <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground/50" />
                <span className="truncate font-medium text-foreground">{data.name}</span>
              </nav>
            )}
          </div>

          <SharedThemeToggle />
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-6">
          {/* Hero section */}
          <div className="pb-6 pt-12 text-center">
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-amber-500/10 dark:bg-amber-500/15">
              <FolderOpen
                className="h-10 w-10 text-amber-600 dark:text-amber-400"
                strokeWidth={1.5}
              />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{data.name}</h1>
            <div className="mt-2 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              {data.owner_name && (
                <>
                  <span>Shared by {data.owner_name}</span>
                  <span className="text-muted-foreground/40">·</span>
                </>
              )}
              <span>
                {items.length} {items.length === 1 ? "item" : "items"}
              </span>
              <span className="text-muted-foreground/40">·</span>
              <span>{formatDate(data.updated_at)}</span>
            </div>
          </div>

          {/* File list */}
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <Folder className="h-12 w-12 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">This folder is empty</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              {items.map((item, index) => (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={`flex w-full items-center gap-3.5 px-5 py-3.5 text-left transition-colors hover:bg-accent/50 ${
                    index !== items.length - 1 ? "border-b border-border" : ""
                  }`}
                >
                  {/* Icon */}
                  {item.is_folder ? (
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-amber-500/10 dark:bg-amber-500/15">
                      <Folder className="h-4.5 w-4.5 h-[18px] w-[18px] text-amber-600 dark:text-amber-400" />
                    </div>
                  ) : (
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
                      {item.icon ? (
                        <span className="text-lg leading-none">{item.icon}</span>
                      ) : (
                        <FileText className="h-[18px] w-[18px] text-muted-foreground" />
                      )}
                    </div>
                  )}

                  {/* Name + type label */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {item.is_folder ? item.name : item.name.replace(/\.md$/, "")}
                    </p>
                  </div>

                  {/* Date */}
                  <span className="flex-shrink-0 text-xs text-muted-foreground">
                    {formatDate(item.updated_at)}
                  </span>

                  {/* Arrow for folders */}
                  {item.is_folder && (
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground/50" />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Footer branding */}
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground/50">
            <Logo variant="icon" size="sm" className="h-3.5 w-3.5 opacity-40" />
            <span>
              Shared with{" "}
              <a
                href="https://beta.doxmind.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground/70 underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                doXmind
              </a>
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
