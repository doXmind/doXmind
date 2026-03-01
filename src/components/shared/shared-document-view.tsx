"use client";

import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { SearchBar } from "@/components/editor/search-bar";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useLayoutStore } from "@/stores/layout-store";
import { cn } from "@/lib/utils";
import { StickyOutline } from "@/components/shared/sticky-outline";
import { ReadingToolbar } from "@/components/shared/reading-toolbar";
import { ReadingStatsBar } from "@/components/shared/reading-stats-bar";
import { StickyReadingBar } from "@/components/shared/sticky-reading-bar";
import { PresentationMode } from "@/components/editor/presentation-mode";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import type { SharedItemResponse, SharedFolderItem } from "@/lib/api";

interface SharedDocumentViewProps {
  data: SharedItemResponse;
  breadcrumbs?: SharedFolderItem[];
  onNavigate?: (path: string | null) => void;
  /** When true, hides headers/outline/stats — just renders the content */
  embedded?: boolean;
}

export function SharedDocumentView({
  data,
  breadcrumbs,
  onNavigate,
  embedded = false,
}: SharedDocumentViewProps) {
  const { setEditor } = useEditorRefStore();
  const { setSearchBarOpen } = useLayoutStore();
  const headerRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: getEditorExtensions({ isMobile: false }),
    content: "",
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-lg max-w-none",
          "prose-headings:font-bold prose-headings:text-foreground",
          "prose-strong:text-foreground prose-em:text-foreground",
          "prose-p:text-foreground prose-p:leading-relaxed",
          "prose-li:text-foreground",
          "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
          "prose-code:text-foreground prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded",
          "prose-pre:bg-muted prose-pre:text-foreground prose-pre:border prose-pre:border-border prose-pre:whitespace-pre-wrap prose-pre:overflow-x-auto prose-pre:p-4 prose-pre:rounded-lg",
          "prose-blockquote:border-l-primary prose-blockquote:text-muted-foreground",
          "prose-img:rounded-lg prose-img:shadow-md",
          "prose-hr:border-border",
          "prose-table:border-collapse prose-table:text-foreground",
          "prose-thead:border-b prose-thead:border-border",
          "prose-tr:border-b prose-tr:border-border",
          "prose-th:px-4 prose-th:py-2 prose-th:text-left prose-th:font-semibold prose-th:bg-muted",
          "prose-td:px-4 prose-td:py-2",
          "focus:outline-none",
          "min-h-[calc(100vh-12rem)]"
        ),
      },
    },
  });

  // Register editor with store for SearchBar integration
  useEffect(() => {
    if (editor) {
      setEditor(editor);
    }
    return () => {
      setEditor(null);
    };
  }, [editor, setEditor]);

  // Keyboard shortcut: Ctrl+F / Cmd+F to open search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setSearchBarOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setSearchBarOpen]);

  // Set editor content when data changes
  useEffect(() => {
    if (editor && data.content) {
      setTimeout(() => {
        editor.commands.setContent(data.content!);
        editor.emit("update", { editor, transaction: editor.state.tr, appendedTransactions: [] });
      }, 0);
    }
  }, [editor, data.content]);

  // Set browser tab title
  useEffect(() => {
    window.document.title = data.name.replace(/\.md$/i, "");
  }, [data.name]);

  if (embedded) {
    return (
      <div className="bg-background">
        <div className="mx-auto max-w-none px-0">
          <EditorContent editor={editor} />
        </div>
        <SearchBar />
      </div>
    );
  }

  const formattedDate = new Date(data.updated_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const hasBreadcrumbs = breadcrumbs && breadcrumbs.length > 0 && onNavigate;
  const title = data.name.replace(/\.md$/, "");

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Scrollable content area — same pattern as community page */}
      <div className="flex-1 overflow-y-auto">
        {/* Sticky reading bar — appears when header scrolls out of view */}
        <StickyReadingBar title={title} triggerRef={headerRef} />

        {/* Editorial header */}
        <div ref={headerRef} className="border-b border-border/40">
          <div className="mx-auto max-w-3xl px-6 pb-10 pt-10 sm:px-8 lg:max-w-5xl">
            {/* Top row: Back link / breadcrumbs ... Reading toolbar */}
            <div className="mb-8 flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-2">
                {hasBreadcrumbs && (
                  <>
                    <button
                      onClick={() => onNavigate(null)}
                      className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground/70 transition-colors hover:text-foreground"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      {data.root_folder_name || "Folder"}
                    </button>
                    {breadcrumbs.map((crumb) => (
                      <span key={crumb.id} className="flex items-center gap-1 text-[13px]">
                        <span className="text-muted-foreground/50">/</span>
                        {crumb.is_folder ? (
                          <button
                            onClick={() => onNavigate(crumb.id)}
                            className="text-muted-foreground/70 transition-colors hover:text-foreground"
                          >
                            {crumb.name}
                          </button>
                        ) : (
                          <span className="font-medium text-muted-foreground">
                            {crumb.name.replace(/\.md$/, "")}
                          </span>
                        )}
                      </span>
                    ))}
                  </>
                )}
              </div>

              <ReadingToolbar />
            </div>

            {/* Title — editorial style, matches community page */}
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl">
              {title}
            </h1>

            {/* Meta row — matches community page pattern */}
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
              <span>{formattedDate}</span>
              {data.is_snapshot && (
                <>
                  <span className="text-border/60">&middot;</span>
                  <span>Snapshot</span>
                </>
              )}
              <span className="text-border/60">&middot;</span>
              <span>Read-Only</span>
            </div>
          </div>
        </div>

        {/* Content area with sticky outline — same pattern as community page */}
        <div className="mx-auto flex max-w-3xl gap-8 px-6 sm:px-8 lg:max-w-5xl">
          {/* Sticky outline sidebar (lg+ only) */}
          <StickyOutline maxHeight="calc(100vh - 8rem)" />

          {/* Main content column */}
          <div className="relative min-w-0 flex-1">
            {/* Document content */}
            <article className="py-10">
              <EditorContent editor={editor} />
            </article>
          </div>
        </div>

        <SearchBar />
      </div>

      {/* Fixed bottom stats bar */}
      <div className="border-t border-border/40 bg-background">
        <div className="mx-auto max-w-3xl px-6 sm:px-8 lg:max-w-5xl">
          <ReadingStatsBar />
        </div>
      </div>

      {/* Presentation Mode */}
      <PresentationMode title={title} author={data.owner_name || undefined} date={formattedDate} />
    </div>
  );
}
