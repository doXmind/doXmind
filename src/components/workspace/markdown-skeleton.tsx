"use client";

import type { DocumentOutlineItem } from "@/lib/storage/types";

/**
 * Placeholder shown while TipTap is mounting (markdown-runtime) or while
 * the file's content is in flight (desktop-editor). Notion-style: when the
 * caller hands us a file's cached metadata, we render the real title and
 * outline-derived heading shapes so the user gets immediate "this is the
 * doc I clicked" confirmation rather than a generic loader.
 *
 * Visually mirrors the real editor's box model — same outer flex column,
 * same scroll surface, same `editor-page-frame` padding — so the eventual
 * content slides in without a layout shift.
 */
export interface SkeletonFile {
  name?: string;
  outline?: ReadonlyArray<DocumentOutlineItem>;
}

interface MarkdownSkeletonProps {
  file?: SkeletonFile;
}

export function MarkdownSkeleton({ file }: MarkdownSkeletonProps = {}) {
  return (
    <div
      className="animate-in fade-in-0 flex h-full flex-col duration-200"
      data-testid="markdown-skeleton"
      aria-busy="true"
    >
      <div className="flex min-h-0 min-w-0 flex-1 overflow-x-hidden">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-hidden">
            <div className="editor-page-frame relative">
              <MarkdownSkeletonContent file={file} includeTitle />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface MarkdownSkeletonContentProps {
  file?: SkeletonFile;
  /**
   * When true the skeleton renders its own title row (used by the page-level
   * loader where there is no live DocumentTitle yet). When false the
   * caller's DocumentTitle is already visible above the overlay, so we skip
   * to body content to avoid double-painting the title.
   */
  includeTitle?: boolean;
}

export function MarkdownSkeletonContent({
  file,
  includeTitle = false,
}: MarkdownSkeletonContentProps) {
  const title = file?.name ? stripDocExtension(file.name) : null;
  const outline = file?.outline;
  const hasOutline = !!outline && outline.length > 0;

  return (
    <>
      {includeTitle && (
        <>
          {title ? (
            <h1 className="mt-1 truncate text-3xl font-bold text-foreground/70">{title}</h1>
          ) : (
            <div className="mt-1 h-9 w-2/3 rounded-md bg-muted/25" />
          )}
        </>
      )}

      {hasOutline ? (
        <OutlineSkeletonBody outline={outline} />
      ) : (
        <GenericSkeletonBody includeTitle={includeTitle} />
      )}
    </>
  );
}

function OutlineSkeletonBody({ outline }: { outline: ReadonlyArray<DocumentOutlineItem> }) {
  // Cap at the first ~12 headings to keep the overlay light on huge docs.
  // The real content will replace it within a frame anyway.
  const visible = outline.slice(0, 12);
  return (
    <div className="mt-8 space-y-7">
      {visible.map((item, index) => (
        <section key={`${item.id}-${index}`}>
          <HeadingGhost depth={item.depth} text={item.text} />
          <ParagraphBars />
        </section>
      ))}
    </div>
  );
}

function HeadingGhost({ depth, text }: { depth: number; text: string }) {
  const sizeClass =
    depth === 1
      ? "text-2xl font-bold"
      : depth === 2
        ? "text-xl font-semibold"
        : depth === 3
          ? "text-lg font-medium"
          : "text-base font-medium";
  return (
    <div className={`text-muted-foreground/45 ${sizeClass} truncate`} aria-hidden="true">
      {text}
    </div>
  );
}

function ParagraphBars() {
  return (
    <div className="mt-3 space-y-2.5" aria-hidden="true">
      <div className="h-3.5 w-full rounded bg-muted/20" />
      <div className="h-3.5 w-[94%] rounded bg-muted/20" />
      <div className="h-3.5 w-[80%] rounded bg-muted/20" />
    </div>
  );
}

function GenericSkeletonBody({ includeTitle }: { includeTitle: boolean }) {
  // Fallback when we don't have an outline yet (first-ever open of an
  // un-scanned file). Three paragraph clusters separated by a faint H2.
  return (
    <>
      <div className={`${includeTitle ? "mt-8" : ""} space-y-2.5`} aria-hidden="true">
        <div className="h-3.5 w-full rounded bg-muted/20" />
        <div className="h-3.5 w-[96%] rounded bg-muted/20" />
        <div className="h-3.5 w-[88%] rounded bg-muted/20" />
      </div>
      <div className="mt-8 h-6 w-1/3 rounded bg-muted/25" aria-hidden="true" />
      <div className="mt-4 space-y-2.5" aria-hidden="true">
        <div className="h-3.5 w-full rounded bg-muted/20" />
        <div className="h-3.5 w-[92%] rounded bg-muted/20" />
        <div className="h-3.5 w-[78%] rounded bg-muted/20" />
      </div>
      <div className="mt-4 space-y-2.5" aria-hidden="true">
        <div className="h-3.5 w-full rounded bg-muted/20" />
        <div className="h-3.5 w-[84%] rounded bg-muted/20" />
      </div>
    </>
  );
}

function stripDocExtension(name: string): string {
  return name.replace(/\.(md|markdown)$/i, "");
}
