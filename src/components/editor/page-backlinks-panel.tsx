"use client";

import { useEffect, useMemo, useState } from "react";
import { Link2, Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { navigateToWorkspacePage } from "@/lib/editor-navigation";
import {
  buildKnowledgeIndex,
  type KnowledgeIndex,
  type KnowledgeLink,
} from "@/lib/knowledge-index";
import { createStorageAdapter } from "@/lib/storage";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useFileStore } from "@/stores/file-store";
import type { FileItem } from "@/types";

export interface PageBacklinksServices {
  saveCurrentPage: (pageId: string) => Promise<boolean>;
  rebuild: () => Promise<KnowledgeIndex>;
  navigate: (pageId: string, workspacePath: string) => Promise<boolean>;
}

const defaultServices: PageBacklinksServices = {
  saveCurrentPage: async (pageId) => {
    if (useFileStore.getState().currentFileId !== pageId) return true;
    const requestSave = useEditorRefStore.getState().requestSave;
    return requestSave ? requestSave() : true;
  },
  rebuild: async () => {
    const adapter = createStorageAdapter({ disk: { root: useFileStore.getState().rootPath } });
    return buildKnowledgeIndex(adapter);
  },
  navigate: navigateToWorkspacePage,
};

export function PageBacklinksPanel({
  file,
  services = defaultServices,
}: {
  file: FileItem;
  services?: PageBacklinksServices;
}) {
  const t = useTranslations("pageBacklinks");
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState<KnowledgeIndex | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pagePath = file.storageHandle?.relPath ?? file.storageHandle?.path ?? file.name;

  useEffect(() => {
    setOpen(false);
    setIndex(null);
    setError(null);
  }, [file.id, pagePath]);

  const incoming = useMemo(() => {
    if (!index) return [];
    return (
      index.backlinks.find(
        (backlink) =>
          backlink.targetId === file.id || sameWorkspacePath(backlink.targetPath, pagePath)
      )?.links ?? []
    );
  }, [file.id, index, pagePath]);

  const unresolved = useMemo(() => {
    if (!index) return [];
    return index.links.filter(
      (link) =>
        link.status !== "resolved" &&
        (link.sourceId === file.id || sameWorkspacePath(link.sourcePath, pagePath))
    );
  }, [file.id, index, pagePath]);

  const unlinkedMentions = useMemo(() => {
    if (!index) return [];
    return index.unlinkedMentions.filter(
      (mention) => mention.targetId === file.id || sameWorkspacePath(mention.targetPath, pagePath)
    );
  }, [file.id, index, pagePath]);

  const rebuild = async () => {
    setError(null);
    setIsLoading(true);
    try {
      if (!(await services.saveCurrentPage(file.id))) {
        setError(t("saveBeforeRebuild"));
        return;
      }
      setIndex(await services.rebuild());
    } catch (rebuildError) {
      const detail = rebuildError instanceof Error ? rebuildError.message : String(rebuildError);
      setError(`${t("loadFailed")}: ${detail}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen && !index && !isLoading) void rebuild();
  };

  const openSource = async (source: Pick<KnowledgeLink, "sourceId" | "sourcePath">) => {
    setError(null);
    try {
      if (!(await services.saveCurrentPage(file.id))) {
        setError(t("saveBeforeRebuild"));
        return;
      }
      if (await services.navigate(source.sourceId, source.sourcePath)) setOpen(false);
    } catch (navigationError) {
      const detail =
        navigationError instanceof Error ? navigationError.message : String(navigationError);
      setError(`${t("navigationFailed")}: ${detail}`);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("title")}
          className="h-8 gap-2 rounded-lg bg-background/90 px-2.5 text-muted-foreground shadow-sm backdrop-blur hover:text-foreground"
        >
          <Link2 className="h-3.5 w-3.5" />
          <span>{t("title")}</span>
          {index && incoming.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
              {incoming.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))] p-4">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">{t("title")}</h2>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{t("description")}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              aria-label={t("refresh")}
              disabled={isLoading}
              onClick={() => void rebuild()}
            >
              {isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>

          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}

          <section aria-labelledby="page-backlinks-incoming">
            <h3
              id="page-backlinks-incoming"
              className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {t("incoming", { count: incoming.length })}
            </h3>
            {index && incoming.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("noIncoming")}</p>
            )}
            <div className="space-y-1">
              {incoming.map((link) => (
                <Button
                  key={`${link.sourceId}:${link.range.from}:${link.range.to}`}
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start px-2 py-2 text-left"
                  aria-label={`${link.sourcePath}: ${link.alias ?? link.targetText}`}
                  onClick={() => void openSource(link)}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{link.sourcePath}</span>
                    <span className="block truncate text-[11px] font-normal text-muted-foreground">
                      {link.alias ?? link.targetText}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          </section>

          {index && unlinkedMentions.length > 0 && (
            <section aria-labelledby="page-backlinks-unlinked">
              <h3
                id="page-backlinks-unlinked"
                className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {t("unlinked", { count: unlinkedMentions.length })}
              </h3>
              <div className="space-y-1">
                {unlinkedMentions.map((mention) => (
                  <Button
                    key={`${mention.sourceId}:${mention.range.from}:${mention.range.to}`}
                    type="button"
                    variant="ghost"
                    className="h-auto w-full justify-start px-2 py-2 text-left"
                    aria-label={t("unlinkedSource", {
                      path: mention.sourcePath,
                      text: mention.text,
                    })}
                    onClick={() => void openSource(mention)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">
                        {mention.sourcePath}
                      </span>
                      <span className="block truncate text-[11px] font-normal text-muted-foreground">
                        {mention.text}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
            </section>
          )}

          {index && unresolved.length > 0 && (
            <section aria-labelledby="page-backlinks-unresolved">
              <h3
                id="page-backlinks-unresolved"
                className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {t("unresolved")}
              </h3>
              <ul className="space-y-1">
                {unresolved.map((link) => (
                  <li
                    key={`${link.sourceId}:${link.range.from}:${link.range.to}`}
                    className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-2 py-1.5 text-xs"
                  >
                    <span className="min-w-0 truncate">{link.targetText}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {t(link.status === "ambiguous" ? "ambiguousStatus" : "unresolvedStatus")}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function sameWorkspacePath(left: string, right: string): boolean {
  return normalizeWorkspacePath(left) === normalizeWorkspacePath(right);
}

function normalizeWorkspacePath(value: string): string {
  return value.replaceAll("\\", "/").normalize("NFC").toLowerCase();
}
