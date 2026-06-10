"use client";

// The document icon/cover affordances were removed, and the thin spacer strip
// they used to sit in was pure dead space above the H1 — so this is now a
// no-op. The editor's top breathing room comes from `.editor-page-frame`'s
// padding alone (the browsing view and skeleton dropped their matching
// spacers too, so the three stay visually in sync).
export function DocumentTitle() {
  return null;
}
