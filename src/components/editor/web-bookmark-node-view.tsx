"use client";

import { useState, useEffect } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { Globe, ExternalLink, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useEditorStore } from "@/stores/editor-store";

export function WebBookmarkNodeView({
  node,
  editor,
  updateAttributes,
  selected,
  deleteNode,
}: NodeViewProps) {
  const { url, title, description, faviconUrl, imageUrl } = node.attrs;
  const [loading, setLoading] = useState(!title && !!url);
  const [error, setError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const showToolbar = (isHovered || selected) && editor.isEditable;

  // Auto-fetch metadata if title is missing
  useEffect(() => {
    if (title || !url) return;

    let cancelled = false;
    setLoading(true);

    api
      .unfurlUrl(url)
      .then((meta) => {
        if (cancelled) return;
        updateAttributes({
          title: meta.title,
          description: meta.description,
          faviconUrl: meta.favicon_url,
          imageUrl: meta.image_url,
        });
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [url, title, updateAttributes]);

  const domain = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  })();

  const handleClick = () => {
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const { openBookmarkModal } = useEditorStore.getState();
    openBookmarkModal((attrs) => {
      // Reset loading state for new URL
      setLoading(false);
      setError(false);
      updateAttributes({
        url: attrs.url,
        title: attrs.title,
        description: attrs.description,
        faviconUrl: attrs.faviconUrl,
        imageUrl: attrs.imageUrl,
      });
    });
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    deleteNode();
  };

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    handleClick();
  };

  return (
    <NodeViewWrapper data-type="web-bookmark" contentEditable={false} className="not-prose my-2">
      <div
        className="relative"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Hover toolbar */}
        {showToolbar && (
          <div className="image-overlay-toolbar">
            <button
              type="button"
              className="image-toolbar-icon-btn"
              onClick={handleEdit}
              title="Change URL"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="image-toolbar-icon-btn"
              onClick={handleOpen}
              title="Open link"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
            <div className="image-toolbar-sep" />
            <button
              type="button"
              className="image-toolbar-icon-btn"
              onClick={handleDelete}
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Bookmark card */}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.preventDefault();
            handleClick();
          }}
          className={cn(
            "flex cursor-pointer items-stretch overflow-hidden rounded-lg border border-border",
            "transition-colors hover:bg-accent/30"
          )}
        >
          {/* Content side */}
          <div className="flex min-w-0 flex-1 flex-col justify-between gap-1.5 p-3">
            {loading ? (
              <div className="space-y-2">
                <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              </div>
            ) : (
              <>
                {/* Title */}
                <p className="truncate text-sm font-medium text-foreground">{title || domain}</p>
                {/* Description */}
                {description && (
                  <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                )}
                {/* Domain + favicon */}
                <div className="flex items-center gap-1.5">
                  {faviconUrl && !error ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={faviconUrl}
                      alt=""
                      className="h-3.5 w-3.5 rounded-sm"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span className="truncate text-xs text-muted-foreground">{domain}</span>
                  <ExternalLink className="ml-auto h-3 w-3 shrink-0 text-muted-foreground/50" />
                </div>
              </>
            )}
          </div>
          {/* Image side */}
          {imageUrl && !error && (
            <div className="hidden w-[200px] shrink-0 sm:block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt=""
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).parentElement!.style.display = "none";
                }}
              />
            </div>
          )}
        </a>
      </div>
    </NodeViewWrapper>
  );
}
