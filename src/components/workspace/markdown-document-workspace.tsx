"use client";

import { useEffect, useState } from "react";
import {
  BrowsingRuntime,
  type EditActivationContext,
} from "@/components/workspace/browsing-runtime";
import { MarkdownSkeleton } from "@/components/workspace/markdown-skeleton";
import { TRANSIENT_ID_PREFIX, type FileItem } from "@/stores/file-store";

type MarkdownRuntimeComponent =
  typeof import("@/components/workspace/markdown-runtime").MarkdownRuntime;

interface MarkdownDocumentWorkspaceProps {
  file: FileItem;
  reservedRightInset?: number;
}

interface EditSession extends EditActivationContext {
  fileId: string;
}

let markdownRuntimePromise: Promise<{ MarkdownRuntime: MarkdownRuntimeComponent }> | null = null;

function loadMarkdownRuntime() {
  markdownRuntimePromise ??= import("@/components/workspace/markdown-runtime");
  return markdownRuntimePromise;
}

export function MarkdownDocumentWorkspace({
  file,
  reservedRightInset = 0,
}: MarkdownDocumentWorkspaceProps) {
  const [MarkdownRuntime, setMarkdownRuntime] = useState<MarkdownRuntimeComponent | null>(null);
  const [editSession, setEditSession] = useState<EditSession | null>(null);
  const activeEditSession = editSession?.fileId === file.id ? editSession : null;
  const isTransient = file.id.startsWith(TRANSIENT_ID_PREFIX);
  const shouldMountEditor = isTransient || activeEditSession !== null;

  useEffect(() => {
    if (shouldMountEditor) {
      void loadMarkdownRuntime().then((mod) => setMarkdownRuntime(() => mod.MarkdownRuntime));
      return;
    }

    if (typeof window === "undefined") return;
    const preload = () => {
      void loadMarkdownRuntime().then((mod) => setMarkdownRuntime(() => mod.MarkdownRuntime));
    };
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(preload, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = globalThis.setTimeout(preload, 1200);
    return () => globalThis.clearTimeout(id);
  }, [shouldMountEditor]);

  if (shouldMountEditor) {
    if (!MarkdownRuntime) {
      return activeEditSession ? (
        <BrowsingRuntime file={file} reservedRightInset={reservedRightInset} />
      ) : (
        <MarkdownSkeleton file={{ name: file.name, outline: file.outline }} />
      );
    }

    return (
      <MarkdownRuntime
        file={file}
        reservedRightInset={reservedRightInset}
        initialScrollTop={activeEditSession?.scrollTop ?? 0}
        initialActivationIntent={activeEditSession?.intent}
      />
    );
  }

  return (
    <BrowsingRuntime
      file={file}
      reservedRightInset={reservedRightInset}
      onActivateEdit={(context) => setEditSession({ ...context, fileId: file.id })}
    />
  );
}
