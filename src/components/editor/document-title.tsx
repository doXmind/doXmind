"use client";

// The document icon/cover affordances were removed. This component now only
// reserves the thin top strip above the H1 so the editor body sits flush
// under the chrome header (mirrors the browsing-view and skeleton spacers).
export function DocumentTitle() {
  return <div className="h-7" aria-hidden="true" />;
}
