"use client";

import { useEffect, useRef, useState } from "react";
import { NodeViewWrapper, NodeViewProps } from "@tiptap/react";
import { Globe } from "lucide-react";
import { unfurlLink } from "@/lib/api/unfurl";
import { cn } from "@/lib/utils";
import { WebBookmarkEmptyState } from "./web-bookmark-empty-state";

interface BookmarkAttrs {
  url?: string;
  title?: string;
  description?: string | null;
  faviconUrl?: string | null;
  imageUrl?: string | null;
}

/**
 * Web bookmark node view. When the URL has no enriched metadata yet (title is
 * empty or equal to the URL), call the local sidecar's /api/links/unfurl
 * endpoint to populate Open Graph data and persist it via updateAttributes.
 */
export function WebBookmarkNodeView({ node, updateAttributes }: NodeViewProps) {
  const attrs = node.attrs as BookmarkAttrs;
  const url = attrs.url ?? "";
  const title = attrs.title ?? "";
  const description = attrs.description ?? null;
  const faviconUrl = attrs.faviconUrl ?? null;
  const imageUrl = attrs.imageUrl ?? null;

  const [isLoading, setIsLoading] = useState(false);
  // Track URLs we've already attempted to unfurl in this session so a failed
  // fetch doesn't retry on every keystroke.
  const attempted = useRef<Set<string>>(new Set());

  // Decide whether the bookmark needs enrichment: we trust attrs that have a
  // real title (different from the URL) and at least *some* extra metadata.
  const needsUnfurl = !!url && (!title || title === url) && !description && !imageUrl;

  useEffect(() => {
    if (!needsUnfurl) return;
    if (attempted.current.has(url)) return;
    attempted.current.add(url);
    let cancelled = false;
    setIsLoading(true);
    unfurlLink(url)
      .then((meta) => {
        if (cancelled) return;
        updateAttributes({
          url: meta.url,
          title: meta.title,
          description: meta.description,
          faviconUrl: meta.faviconUrl,
          imageUrl: meta.imageUrl,
        });
      })
      .catch(() => {
        // Server endpoint already degrades gracefully; if even that failed,
        // leave the bookmark with whatever the user typed.
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [needsUnfurl, url, updateAttributes]);

  if (!url) {
    return (
      <NodeViewWrapper className="my-2">
        <WebBookmarkEmptyState onSubmit={(newUrl) => updateAttributes({ url: newUrl })} />
      </NodeViewWrapper>
    );
  }

  const displayTitle = title || url;
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  })();

  return (
    <NodeViewWrapper className="my-2" contentEditable={false}>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "group flex w-full overflow-hidden rounded-md border border-border/60 bg-card no-underline",
          "transition-colors hover:border-border hover:bg-accent/30",
          isLoading && "animate-pulse"
        )}
      >
        {/* Text column */}
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-1.5 px-4 py-3">
          <div className="space-y-1">
            <div className="line-clamp-1 text-[15px] font-medium text-foreground">
              {displayTitle}
            </div>
            {description ? (
              <div className="line-clamp-2 text-[13px] leading-[1.45] text-muted-foreground">
                {description}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            {faviconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={faviconUrl}
                alt=""
                className="h-3.5 w-3.5 shrink-0 rounded-[2px]"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <Globe className="h-3.5 w-3.5 shrink-0 opacity-60" />
            )}
            <span className="truncate">{host}</span>
          </div>
        </div>

        {/* OG image column */}
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            className="hidden h-[112px] w-[180px] shrink-0 object-cover sm:block"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}
      </a>
    </NodeViewWrapper>
  );
}
