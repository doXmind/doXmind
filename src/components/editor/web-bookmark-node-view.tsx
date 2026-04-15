"use client";

import { NodeViewWrapper, NodeViewProps } from "@tiptap/react";

/**
 * Web bookmark node view — local desktop edition keeps a minimal renderer.
 * The original implementation called a server-side unfurl endpoint; that
 * endpoint is gone, so we just render the URL as a clickable link card.
 */
export function WebBookmarkNodeView(props: NodeViewProps) {
  const { node } = props;
  const url = (node.attrs as { url?: string }).url ?? "";
  const title = (node.attrs as { title?: string }).title ?? url;
  return (
    <NodeViewWrapper className="my-2">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="block rounded-md border border-border p-3 text-sm no-underline hover:bg-muted"
      >
        <div className="font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{url}</div>
      </a>
    </NodeViewWrapper>
  );
}
