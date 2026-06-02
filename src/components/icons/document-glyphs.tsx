/**
 * Inline SVG glyphs for the document types we create on disk.
 *
 * Lucide ships generic file icons but they're indistinguishable at sidebar
 * size — these custom marks bake the file label into the
 * sheet so a user can tell them apart in a dense file list. They also use
 * the dual-token color system (foreground + accent) so they read on both
 * light and dark themes without per-theme overrides.
 */

import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

interface GlyphProps extends SVGProps<SVGSVGElement> {
  className?: string;
}

function DocumentSheet({
  className,
  children,
  accentClassName,
  ...rest
}: GlyphProps & { accentClassName: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      {...rest}
    >
      {/* Page outline with the dog-eared corner. */}
      <path d="M14.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5L14.5 3Z" />
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      {/* Type-specific badge sits on the lower half of the sheet. */}
      <g className={accentClassName} stroke="none" fill="currentColor">
        {children}
      </g>
    </svg>
  );
}

export function MarkdownGlyph({ className, ...rest }: GlyphProps) {
  // Stylized "M" downstroke + arrow — the canonical CommonMark mark. Sized
  // and positioned to sit inside the page rectangle without crowding the
  // dog-ear.
  return (
    <DocumentSheet
      className={className}
      // Markdown leans on the foreground color directly so it stays neutral
      // in the file list — PDFs are the ones that pop with red.
      accentClassName="text-foreground/70"
      {...rest}
    >
      <path
        d="M7.4 16.4v-4.6l1.7 2.1 1.7-2.1v4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 12.5v3.5m0 0 1.4-1.4m-1.4 1.4-1.4-1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </DocumentSheet>
  );
}

export function HtmlGlyph({ className, ...rest }: GlyphProps) {
  // "</>" angle-bracket mark — the universal "this is markup" cue, in an
  // amber accent so it sits apart from Markdown's neutral mark and PDF's red.
  return (
    <DocumentSheet
      className={className}
      accentClassName="text-amber-600 dark:text-amber-500"
      {...rest}
    >
      <path
        d="M10.2 12.6 7.8 15l2.4 2.4M13.8 12.6 16.2 15l-2.4 2.4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </DocumentSheet>
  );
}

export function PdfGlyph({ className, ...rest }: GlyphProps) {
  // "PDF" wordmark in a rounded badge — Adobe-style red tag so it reads as
  // "this is a PDF" at a glance, even at 14px.
  return (
    <DocumentSheet
      className={className}
      accentClassName="text-rose-600 dark:text-rose-500"
      {...rest}
    >
      <rect x="6.5" y="12.5" width="11" height="5.2" rx="1.2" />
      <text
        x="12"
        y="16.7"
        textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
        fontSize="3.6"
        fontWeight={700}
        letterSpacing="0.1"
        fill="white"
      >
        PDF
      </text>
    </DocumentSheet>
  );
}

export function SpreadsheetGlyph({ className, ...rest }: GlyphProps) {
  return (
    <DocumentSheet
      className={className}
      accentClassName="text-emerald-600 dark:text-emerald-400"
      {...rest}
    >
      <rect
        x="7"
        y="11.4"
        width="10"
        height="7"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
      />
      <path
        d="M10.3 11.4v7M13.7 11.4v7M7 14.8h10"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
    </DocumentSheet>
  );
}

export function CsvGlyph({ className, ...rest }: GlyphProps) {
  return (
    <DocumentSheet
      className={className}
      accentClassName="text-cyan-600 dark:text-cyan-400"
      {...rest}
    >
      <rect x="6.4" y="12.5" width="11.2" height="5.2" rx="1.2" />
      <text
        x="12"
        y="16.65"
        textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
        fontSize="3.35"
        fontWeight={700}
        letterSpacing="0"
        fill="white"
      >
        CSV
      </text>
    </DocumentSheet>
  );
}
