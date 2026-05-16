"use client";

/**
 * Placeholder shown while TipTap is mounting (MarkdownRuntime) or while
 * the file's content is in flight (desktop-editor). Visually mirrors the
 * real editor's box model — same outer flex column, same scroll surface,
 * same `editor-page-frame` padding — so the eventual content slides in
 * without a layout shift.
 *
 * The shaded bars use the same `bg-muted` palette as the editor chrome
 * so the skeleton reads as a quiet placeholder, not an attention-grabbing
 * loader.
 */
export function MarkdownSkeleton() {
  return (
    <div className="flex h-full flex-col" data-testid="markdown-skeleton" aria-busy="true">
      <div className="flex min-h-0 min-w-0 flex-1 overflow-x-hidden">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-hidden">
            <div className="editor-page-frame relative">
              {/* Title row — same collapsed h-7 as DocumentTitle without an icon */}
              <div className="h-7" aria-hidden="true" />
              {/* H1-shaped bar */}
              <div className="mt-1 h-9 w-2/3 animate-pulse rounded-md bg-muted/40" />
              {/* Paragraph 1 */}
              <div className="mt-6 space-y-2.5">
                <div className="h-4 w-full animate-pulse rounded bg-muted/30" />
                <div className="h-4 w-[96%] animate-pulse rounded bg-muted/30" />
                <div className="h-4 w-[88%] animate-pulse rounded bg-muted/30" />
              </div>
              {/* H2-shaped bar */}
              <div className="mt-8 h-6 w-1/3 animate-pulse rounded bg-muted/40" />
              {/* Paragraph 2 */}
              <div className="mt-4 space-y-2.5">
                <div className="h-4 w-full animate-pulse rounded bg-muted/30" />
                <div className="h-4 w-[92%] animate-pulse rounded bg-muted/30" />
                <div className="h-4 w-[78%] animate-pulse rounded bg-muted/30" />
              </div>
              {/* Paragraph 3 */}
              <div className="mt-4 space-y-2.5">
                <div className="h-4 w-full animate-pulse rounded bg-muted/30" />
                <div className="h-4 w-[84%] animate-pulse rounded bg-muted/30" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
