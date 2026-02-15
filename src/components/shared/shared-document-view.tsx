"use client";

import { useEffect, useMemo } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { SearchBar } from "@/components/editor/search-bar";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useLayoutStore } from "@/stores/layout-store";
import { cn } from "@/lib/utils";
import { Play, Search } from "lucide-react";
import { SharedOutline } from "@/components/shared/shared-outline";
import { SharedThemeToggle } from "@/components/shared/shared-theme-toggle";
import { Logo } from "@/components/ui/logo";
import { Tooltip } from "@/components/ui/tooltip";
import { PresentationMode } from "@/components/editor/presentation-mode";
import type { SharedItemResponse, SharedFolderItem } from "@/lib/api";

interface SharedDocumentViewProps {
  data: SharedItemResponse;
  breadcrumbs?: SharedFolderItem[];
  onNavigate?: (path: string | null) => void;
}

function getWordCount(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function getReadingTime(wordCount: number): string {
  const minutes = Math.ceil(wordCount / 200);
  if (minutes < 1) return "< 1 min read";
  return `${minutes} min read`;
}

export function SharedDocumentView({ data, breadcrumbs, onNavigate }: SharedDocumentViewProps) {
  const { setEditor } = useEditorRefStore();
  const { setSearchBarOpen, setPresentationMode } = useLayoutStore();

  const editor = useEditor({
    extensions: getEditorExtensions({ isMobile: false }),
    content: "",
    editable: false,
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
      queueMicrotask(() => {
        editor.commands.setContent(data.content!);
        editor.emit("update", { editor, transaction: editor.state.tr });
      });
    }
  }, [editor, data.content]);

  // Set browser tab title
  useEffect(() => {
    window.document.title = data.name.replace(/\.md$/i, "");
  }, [data.name]);

  // Document stats
  const stats = useMemo(() => {
    if (!editor) return { words: 0, characters: 0 };
    const text = editor.getText();
    const words = getWordCount(text);
    const characters = text.length;
    return { words, characters };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor?.state.doc.content.size]);

  const handleSearchClick = () => {
    setSearchBarOpen(true);
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Mobile Header */}
      <header className="border-b border-border bg-card md:hidden">
        <div className="flex h-12 items-center justify-between px-2">
          {/* Left: Logo + Back Button */}
          <div className="flex items-center gap-1">
            <a
              href="https://beta.doxmind.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent active:scale-95"
              aria-label="doXmind"
            >
              <Logo variant="icon" size="sm" className="h-5 w-5" />
            </a>
            {breadcrumbs && breadcrumbs.length > 0 && onNavigate && (
              <>
                <div className="mx-0.5 h-5 w-px bg-border" />
                <button
                  onClick={() => onNavigate(null)}
                  className="flex h-10 items-center rounded-full px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent active:scale-95"
                  aria-label="Back to folder"
                >
                  ← Folder
                </button>
              </>
            )}
          </div>

          {/* Center: Document Title */}
          <div className="flex-1 px-2 text-center">
            <h1 className="truncate text-sm font-semibold">{data.name.replace(/\.md$/, "")}</h1>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-1">
            <SharedThemeToggle />
            <button
              onClick={handleSearchClick}
              className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent active:scale-95"
              aria-label="Search"
            >
              <Search className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Desktop Header */}
      <header className="hidden border-b border-border bg-card px-6 py-3 shadow-sm md:block">
        <div className="flex items-center justify-between">
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

            {/* Breadcrumbs for documents inside shared folders */}
            {breadcrumbs && breadcrumbs.length > 0 && onNavigate && (
              <>
                <Tooltip content="Back to folder" side="bottom">
                  <button
                    onClick={() => onNavigate(null)}
                    className="flex-shrink-0 truncate text-sm font-medium text-foreground transition-colors hover:text-foreground/70"
                    style={{ maxWidth: "10rem" }}
                  >
                    {data.root_folder_name || "..."}
                  </button>
                </Tooltip>
                {breadcrumbs.map((crumb) => (
                  <span key={crumb.id} className="flex items-center gap-1">
                    <span className="text-muted-foreground">/</span>
                    {crumb.is_folder ? (
                      <button
                        onClick={() => onNavigate(crumb.id)}
                        className="flex-shrink-0 truncate text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {crumb.name}
                      </button>
                    ) : (
                      <span className="truncate text-sm font-medium text-foreground">
                        {crumb.name.replace(/\.md$/, "")}
                      </span>
                    )}
                  </span>
                ))}
              </>
            )}

            {/* Title when no breadcrumbs (standalone document share) */}
            {(!breadcrumbs || breadcrumbs.length === 0) && (
              <h1 className="truncate text-lg font-bold text-foreground">
                {data.name.replace(/\.md$/, "")}
              </h1>
            )}

            <span className="hidden flex-shrink-0 text-xs text-muted-foreground/60 sm:inline">
              {data.owner_name && <>{data.owner_name} · </>}
              Read-Only
              {data.is_snapshot && (
                <> · Snapshot {new Date(data.created_at).toLocaleDateString()}</>
              )}
              {" · "}
              {new Date(data.updated_at).toLocaleDateString()}
            </span>
          </div>

          <div className="flex flex-shrink-0 items-center gap-1">
            <SharedThemeToggle />

            <Tooltip content="Present" side="bottom">
              <button
                onClick={() => setPresentationMode(true)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Present"
              >
                <Play className="h-4 w-4" />
              </button>
            </Tooltip>

            <Tooltip content="Search" side="bottom">
              <button
                onClick={handleSearchClick}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Search in document"
              >
                <Search className="h-4 w-4" />
              </button>
            </Tooltip>
          </div>
        </div>
      </header>

      {/* Editor Content - Read-Only */}
      <div className="relative flex min-h-0 flex-1">
        <SharedOutline />
        <div className="relative flex min-w-0 flex-1 flex-col">
          <main className="relative min-w-0 flex-1 overflow-auto">
            <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8">
              <EditorContent editor={editor} />
            </div>
            <SearchBar />
          </main>

          {/* Fixed bottom stats bar */}
          {stats.words > 0 && (
            <div className="bg-background px-4 py-1.5 text-[11px] text-muted-foreground/60 md:px-12">
              <div className="flex items-center gap-3">
                <span className="text-border">&middot;</span>
                <span>
                  {stats.words.toLocaleString()} {stats.words === 1 ? "word" : "words"}
                </span>
                <span className="text-border">&middot;</span>
                <span>{stats.characters.toLocaleString()} characters</span>
                <span className="text-border">&middot;</span>
                <span>{getReadingTime(stats.words)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Presentation Mode */}
      <PresentationMode
        title={data.name.replace(/\.md$/, "")}
        date={new Date(data.updated_at).toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      />
    </div>
  );
}
