"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { EditorContent, useEditor } from "@tiptap/react";
import { AppShell } from "@/components/layout/app-shell";
import { LoadingScreen } from "@/components/loading-screen";
import { SearchBar } from "@/components/editor/search-bar";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { api, type SharedDocumentResponse } from "@/lib/api";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useLayoutStore } from "@/stores/layout-store";
import { cn } from "@/lib/utils";
import { AlertCircle, Play, Search } from "lucide-react";
import { SharedOutline } from "@/components/shared/shared-outline";
import { PresentationMode } from "@/components/editor/presentation-mode";

export default function SharedDocumentPage() {
  const params = useParams();
  const token = params.token as string;

  const [document, setDocument] = useState<SharedDocumentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Zustand stores for search functionality
  const { setEditor } = useEditorRefStore();
  const { setSearchBarOpen, setPresentationMode } = useLayoutStore();

  // Read-only editor with minimal extensions
  const editor = useEditor({
    extensions: getEditorExtensions({
      isMobile: false,
    }),
    content: "",
    editable: false, // CRITICAL: Read-only mode
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
      // Ctrl+F or Cmd+F - Open search bar
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault(); // Prevent browser's default find
        setSearchBarOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setSearchBarOpen]);

  useEffect(() => {
    async function loadSharedDocument() {
      try {
        setLoading(true);
        setError(null);
        const doc = await api.getSharedDocument(token);
        setDocument(doc);

        // Set browser tab title to document name
        window.document.title = doc.name.replace(/\.md$/i, "");

        // Set editor content after loading (defer to avoid flushSync warning)
        if (editor && doc.content) {
          queueMicrotask(() => {
            editor.commands.setContent(doc.content);
            editor.emit("update", { editor, transaction: editor.state.tr });
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load document");
      } finally {
        setLoading(false);
      }
    }

    loadSharedDocument();
  }, [token, editor]);

  const handleSearchClick = () => {
    // Open the SearchBar component
    setSearchBarOpen(true);
  };

  if (loading) {
    return (
      <LoadingScreen isLoading={true} isMobile={false}>
        {null}
      </LoadingScreen>
    );
  }

  if (error || !document) {
    return (
      <AppShell hideHeader>
        <div className="flex h-screen items-center justify-center bg-background">
          <div className="max-w-md space-y-4 px-6 text-center">
            <AlertCircle className="mx-auto h-16 w-16 text-destructive" />
            <h1 className="text-2xl font-bold text-foreground">Document Not Found</h1>
            <p className="text-muted-foreground">
              {error || "This shared document may have expired or been removed."}
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell hideHeader>
      <div className="flex h-screen flex-col bg-background">
        {/* Header - Document Title */}
        <header className="border-b border-border bg-card px-6 py-3 shadow-sm">
          <div className="flex items-center justify-between">
            {/* Logo, Title & Meta */}
            <div className="flex min-w-0 items-center gap-2.5">
              <a
                href="https://beta.doxmind.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0"
              >
                <Image src="/icon.svg" alt="doXmind" width={28} height={28} />
              </a>
              <h1 className="truncate text-lg font-bold text-foreground">
                {document.name.replace(/\.md$/, "")}
              </h1>
              <span className="hidden flex-shrink-0 text-xs text-muted-foreground/60 sm:inline">
                Read-Only
                {document.is_snapshot && (
                  <> · Snapshot {new Date(document.created_at).toLocaleDateString()}</>
                )}
                {" · "}
                {new Date(document.updated_at).toLocaleDateString()}
              </span>
            </div>

            <div className="flex flex-shrink-0 items-center gap-1">
              {/* Present Button */}
              <button
                onClick={() => setPresentationMode(true)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Present"
              >
                <Play className="h-4 w-4" />
              </button>

              {/* Search Button */}
              <button
                onClick={handleSearchClick}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Search in document"
              >
                <Search className="h-4 w-4" />
                <span className="hidden sm:inline">Search</span>
              </button>
            </div>
          </div>
        </header>

        {/* Editor Content - Read-Only */}
        <div className="relative flex min-h-0 flex-1">
          {/* Outline sidebar - separate scroll context, desktop only */}
          <SharedOutline />
          <main className="relative min-w-0 flex-1 overflow-auto">
            <div className="mx-auto max-w-4xl px-6 py-8">
              <EditorContent editor={editor} />
            </div>
            {/* SearchBar inside main so it stays pinned to this area */}
            <SearchBar />
          </main>
        </div>

        {/* Presentation Mode */}
        <PresentationMode
          title={document.name.replace(/\.md$/, "")}
          date={new Date(document.updated_at).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        />
      </div>
    </AppShell>
  );
}
