"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Folder, FolderOpen, FileText, ChevronRight, ArrowLeft, Calendar } from "lucide-react";
import Image from "next/image";
import type { SharedItemResponse } from "@/lib/api";
import { Logo } from "@/components/ui/logo";

interface SharedFolderViewProps {
  data: SharedItemResponse;
  onNavigate: (path: string | null) => void;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateLong(dateString: string): string {
  return new Date(dateString).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function SharedFolderView({ data, onNavigate }: SharedFolderViewProps) {
  const t = useTranslations("sharedView");
  useEffect(() => {
    window.document.title = data.name;
  }, [data.name]);

  const items = data.items || [];
  const breadcrumbs = data.breadcrumbs || [];
  const isSubfolder = breadcrumbs.length > 0;

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex-1 overflow-y-auto">
        {/* Editorial header — matches community / shared document pattern */}
        <div className="border-b border-border/40">
          <div className="mx-auto max-w-3xl px-6 pb-10 pt-10 sm:px-8 lg:max-w-5xl">
            {/* Breadcrumb navigation for subfolders */}
            {isSubfolder && (
              <div className="mb-8">
                <nav className="flex min-w-0 items-center gap-1.5 text-[13px]">
                  <button
                    onClick={() => onNavigate(null)}
                    className="inline-flex shrink-0 items-center gap-1.5 text-muted-foreground/70 transition-colors hover:text-foreground"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    {data.root_folder_name || t("folder")}
                  </button>
                  {breadcrumbs.map((crumb) => (
                    <span key={crumb.id} className="flex items-center gap-1">
                      <span className="text-muted-foreground/50">/</span>
                      <button
                        onClick={() => onNavigate(crumb.id)}
                        className="truncate text-muted-foreground/70 transition-colors hover:text-foreground"
                      >
                        {crumb.name}
                      </button>
                    </span>
                  ))}
                </nav>
              </div>
            )}

            {/* Title */}
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl">
              {data.name}
            </h1>

            {/* Meta row */}
            <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
              {data.owner_name && (
                <>
                  <span className="flex items-center gap-2.5 font-medium">
                    {data.owner_avatar_url ? (
                      <Image
                        src={data.owner_avatar_url}
                        alt=""
                        width={28}
                        height={28}
                        className="h-7 w-7 rounded-full ring-1 ring-border/50"
                      />
                    ) : (
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground ring-1 ring-border/50">
                        {data.owner_name[0].toUpperCase()}
                      </span>
                    )}
                    <span className="text-foreground/80">{data.owner_name}</span>
                  </span>
                  <span className="text-border/60">&middot;</span>
                </>
              )}

              <span className="flex items-center gap-1.5">
                <FolderOpen className="h-3.5 w-3.5 opacity-50" />
                {items.length === 1 ? t("oneItem") : t("itemCount", { count: items.length })}
              </span>

              <span className="text-border/60">&middot;</span>

              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 opacity-50" />
                {formatDateLong(data.updated_at)}
              </span>
            </div>
          </div>
        </div>

        {/* Content area */}
        <div className="mx-auto max-w-3xl px-6 sm:px-8 lg:max-w-5xl">
          <div className="py-10">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <Folder className="h-12 w-12 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground">{t("folderEmpty")}</p>
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
                    {item.is_folder ? (
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-amber-500/10 dark:bg-amber-500/15">
                        <Folder className="h-[18px] w-[18px] text-amber-600 dark:text-amber-400" />
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

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {item.is_folder ? item.name : item.name.replace(/\.md$/, "")}
                      </p>
                    </div>

                    <span className="flex-shrink-0 text-xs text-muted-foreground">
                      {formatDate(item.updated_at)}
                    </span>

                    {item.is_folder && (
                      <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground/50" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Footer branding */}
          <div className="flex items-center justify-center gap-2 pb-10 text-xs text-muted-foreground/50">
            <Logo variant="icon" size="sm" className="h-3.5 w-3.5 opacity-40" />
            <span>
              {t("sharedWith")}{" "}
              <a
                href="https://app.doxmind.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground/70 underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                doXmind
              </a>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
