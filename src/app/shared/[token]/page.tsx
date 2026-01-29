"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { EditorContent, useEditor } from "@tiptap/react";
import { AppShell } from "@/components/layout/app-shell";
import { LoadingScreen } from "@/components/loading-screen";
import { SearchBar } from "@/components/editor/search-bar";
import { getEditorExtensions } from "@/components/editor/editor-extensions";
import { api, type SharedDocumentResponse } from "@/lib/api";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useLayoutStore } from "@/stores/layout-store";
import { cn } from "@/lib/utils";
import { AlertCircle, Lock, Search } from "lucide-react";

export default function SharedDocumentPage() {
  const params = useParams();
  const token = params.token as string;

  const [document, setDocument] = useState<SharedDocumentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Zustand stores for search functionality
  const { setEditor } = useEditorRefStore();
  const { setSearchBarOpen } = useLayoutStore();

  // Read-only editor with minimal extensions
  const editor = useEditor({
    extensions: getEditorExtensions({
      enableBlockSelection: false,
      isMobile: false,
    }),
    content: "",
    editable: false, // CRITICAL: Read-only mode
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-lg max-w-none",
          "prose-headings:font-bold prose-headings:text-foreground",
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

        // Set editor content after loading (defer to avoid flushSync warning)
        if (editor && doc.content) {
          queueMicrotask(() => {
            editor.commands.setContent(doc.content);
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
    return <LoadingScreen isLoading={true} isMobile={false} />;
  }

  if (error || !document) {
    return (
      <AppShell hideHeader>
        <div className="flex h-screen items-center justify-center bg-background">
          <div className="text-center space-y-4 max-w-md px-6">
            <AlertCircle className="w-16 h-16 text-destructive mx-auto" />
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
        <header className="border-b border-border bg-card px-6 py-4 shadow-sm">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between">
              {/* Logo and Title */}
              <div className="flex items-center gap-3">
                <img
                  src="/icon.svg"
                  alt="doXmind"
                  className="w-8 h-8 flex-shrink-0"
                />
                <h1 className="text-2xl font-bold text-foreground">
                  {document.name.replace(/\.md$/, '')}
                </h1>
              </div>

              {/* Search Button */}
              <button
                onClick={handleSearchClick}
                className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
                title="Search in document"
              >
                <Search className="w-4 h-4" />
                <span className="hidden sm:inline">Search</span>
              </button>
            </div>

            <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Lock className="w-4 h-4" />
                Shared Document (Read-Only)
              </span>
              {document.is_snapshot && (
                <span className="bg-muted px-2 py-1 rounded text-xs font-medium">
                  Snapshot from {new Date(document.created_at).toLocaleDateString()}
                </span>
              )}
              <span className="text-xs">
                Last updated {new Date(document.updated_at).toLocaleDateString()}
              </span>
            </div>
          </div>
        </header>

        {/* Editor Content - Read-Only */}
        <main className="flex-1 overflow-auto">
          <div className="relative max-w-4xl mx-auto px-6 py-8">
            <EditorContent editor={editor} />
            {/* Search Bar - positioned within editor content area */}
            <SearchBar />
          </div>
        </main>

        {/* Footer - Branding */}
        <footer className="border-t border-border bg-card px-6 py-3 text-center text-sm text-muted-foreground">
          Powered by{" "}
          <a
            href="https://doxmind.com"
            className="text-primary hover:underline font-medium"
            target="_blank"
            rel="noopener noreferrer"
          >
            doXmind
          </a>
        </footer>
      </div>
    </AppShell>
  );
}
