"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Network, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { navigateToWorkspacePage } from "@/lib/editor-navigation";
import { eventBus } from "@/lib/events";
import {
  buildKnowledgeGraph,
  layoutKnowledgeGraph,
  selectKnowledgeGraphNeighborhood,
} from "@/lib/knowledge-graph";
import { buildKnowledgeIndex, type KnowledgeIndex } from "@/lib/knowledge-index";
import { createStorageAdapter } from "@/lib/storage";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useFileStore } from "@/stores/file-store";
import type { FileItem } from "@/types";

const GRAPH_WIDTH = 720;
const GRAPH_HEIGHT = 420;
const GRAPH_NODE_LIMIT = 60;

export interface PageGraphServices {
  saveCurrentPage: (pageId: string) => Promise<boolean>;
  rebuild: () => Promise<KnowledgeIndex>;
  navigate: (pageId: string, workspacePath: string) => Promise<boolean>;
}

const defaultServices: PageGraphServices = {
  saveCurrentPage: async (pageId) => {
    // By Page, not by pane: with a split open this Page may be the one the OTHER editor is
    // holding, and returning true there would run this against stale bytes on disk.
    return useEditorRefStore.getState().requestSaveFor(pageId);
  },
  rebuild: async () => {
    const adapter = createStorageAdapter({ disk: { root: useFileStore.getState().rootPath } });
    return buildKnowledgeIndex(adapter);
  },
  navigate: navigateToWorkspacePage,
};

export function PageGraphPanel({
  file,
  services = defaultServices,
}: {
  file: FileItem;
  services?: PageGraphServices;
}) {
  const t = useTranslations("pageGraph");
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

  const rebuild = useCallback(async () => {
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
  }, [file.id, services, t]);

  useEffect(
    () =>
      eventBus.on("storage:changed", () => {
        setIndex(null);
        if (open && !isLoading) void rebuild();
      }),
    [isLoading, open, rebuild]
  );

  const graph = useMemo(() => (index ? buildKnowledgeGraph(index) : null), [index]);
  const focusId = useMemo(() => {
    if (!graph) return null;
    return (
      graph.nodes.find((node) => node.id === file.id || sameWorkspacePath(node.path, pagePath))
        ?.id ?? null
    );
  }, [file.id, graph, pagePath]);
  const visibleGraph = useMemo(
    () => (graph ? selectKnowledgeGraphNeighborhood(graph, focusId, GRAPH_NODE_LIMIT) : null),
    [focusId, graph]
  );
  const positioned = useMemo(
    () =>
      visibleGraph ? layoutKnowledgeGraph(visibleGraph, focusId, GRAPH_WIDTH, GRAPH_HEIGHT) : null,
    [focusId, visibleGraph]
  );
  const positions = useMemo(
    () => new Map(positioned?.nodes.map((node) => [node.id, node]) ?? []),
    [positioned]
  );

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen && !index && !isLoading) void rebuild();
  };

  const openPage = async (pageId: string, workspacePath: string) => {
    setError(null);
    try {
      if (!(await services.saveCurrentPage(file.id))) {
        setError(t("saveBeforeRebuild"));
        return;
      }
      if (await services.navigate(pageId, workspacePath)) setOpen(false);
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
          <Network className="h-3.5 w-3.5" />
          <span>{t("title")}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(48rem,calc(100vw-2rem))] p-4"
        data-testid="page-graph-panel"
      >
        <div className="space-y-3">
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

          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}

          {isLoading && !positioned ? (
            <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("loading")}
            </div>
          ) : positioned && positioned.nodes.length ? (
            <>
              <svg
                role="img"
                aria-label="Knowledge graph"
                viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
                className="h-auto w-full rounded-lg border border-border bg-muted/15"
              >
                <g aria-hidden="true">
                  {positioned.edges.map((edge) => {
                    const source = positions.get(edge.sourceId);
                    const target = positions.get(edge.targetId);
                    if (!source || !target) return null;
                    return (
                      <line
                        key={edge.id}
                        x1={source.x}
                        y1={source.y}
                        x2={target.x}
                        y2={target.y}
                        stroke="currentColor"
                        strokeOpacity={0.22}
                        strokeWidth={Math.min(3, 1 + Math.log2(edge.occurrences))}
                      />
                    );
                  })}
                </g>
                {positioned.nodes.map((node) => {
                  const focused = node.id === focusId;
                  const radius = focused ? 17 : Math.min(14, 7 + Math.sqrt(node.degree) * 2);
                  return (
                    <g
                      key={node.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open Page: ${node.title}`}
                      className="cursor-pointer outline-none"
                      onClick={() => void openPage(node.id, node.path)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          void openPage(node.id, node.path);
                        }
                      }}
                    >
                      <title>{node.path}</title>
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={radius}
                        className={focused ? "fill-primary" : "fill-muted-foreground/70"}
                      />
                      <text
                        x={node.x}
                        y={node.y + radius + 13}
                        textAnchor="middle"
                        className="pointer-events-none fill-foreground text-[10px]"
                      >
                        {graphLabel(node.title)}
                      </text>
                    </g>
                  );
                })}
              </svg>
              <p className="text-[11px] text-muted-foreground">
                {t("summary", {
                  nodes: graph?.nodes.length ?? 0,
                  edges: graph?.edges.length ?? 0,
                })}
                {(graph?.nodes.length ?? 0) > GRAPH_NODE_LIMIT ? ` ${t("limited")}` : ""}
              </p>
            </>
          ) : index ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function graphLabel(title: string): string {
  return title.length > 18 ? `${title.slice(0, 17)}…` : title;
}

function sameWorkspacePath(left: string, right: string): boolean {
  return (
    left.replaceAll("\\", "/").normalize("NFC").toLowerCase() ===
    right.replaceAll("\\", "/").normalize("NFC").toLowerCase()
  );
}
