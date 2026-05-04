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
  // Latest URL on the node, read inside async callbacks to detect a URL change
  // mid-fetch. Mutating a ref during render is safe; we only need the freshest
  // value, not a re-render trigger.
  const latestUrlRef = useRef(url);
  latestUrlRef.current = url;

  // Decide whether the bookmark needs enrichment: we trust attrs that have a
  // real title (different from the URL) and at least *some* extra metadata.
  const needsUnfurl = !!url && (!title || title === url) && !description && !imageUrl;

  useEffect(() => {
    if (!needsUnfurl) return;
    if (attempted.current.has(url)) return;
    attempted.current.add(url);
    setIsLoading(true);
    unfurlLink(url)
      .then((meta) => {
        // Strict-mode-dev re-runs this effect on mount; URL is unchanged so the
        // result is still relevant. Only drop it if the user actually swapped
        // the bookmark URL while the fetch was in flight.
        if (latestUrlRef.current !== url) return;
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
        setIsLoading(false);
      });
  }, [needsUnfurl, url, updateAttributes]);

  if (!url) {
    return (
      <NodeViewWrapper className="not-prose my-2">
        <WebBookmarkEmptyState onSubmit={(newUrl) => updateAttributes({ url: newUrl })} />
      </NodeViewWrapper>
    );
  }

  const displayTitle = title || url;

  return (
    <NodeViewWrapper className="not-prose my-2" contentEditable={false}>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "group flex w-full overflow-hidden rounded-md border border-border/60 bg-card",
          // !-prefix overrides .ProseMirror a's text-primary + underline (which
          // beat plain Tailwind utilities on specificity).
          "!text-foreground !no-underline hover:!opacity-100",
          "transition-colors hover:border-border hover:bg-accent/30",
          isLoading && "animate-pulse"
        )}
      >
        {/* Text column */}
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 px-[14px] py-3">
          <div className="space-y-1">
            <div className="line-clamp-1 text-[14px] font-semibold leading-[1.3] text-foreground">
              {displayTitle}
            </div>
            {description ? (
              <div className="line-clamp-2 text-[12px] leading-[1.4] text-muted-foreground">
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
                className="h-4 w-4 shrink-0 rounded-[2px]"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <Globe className="h-4 w-4 shrink-0 opacity-60" />
            )}
            <span className="truncate">{url}</span>
          </div>
        </div>

        {/* OG image column — Notion uses a fixed ~2:1 thumbnail anchored right */}
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            className="hidden h-[120px] w-[140px] shrink-0 object-cover sm:block"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}
      </a>
    </NodeViewWrapper>
  );
}
