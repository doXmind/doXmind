// Server component shell for the editor route.
//
// Static export: only pre-render the bare /editor route. Per-file URLs like
// /editor/abc-123 are produced via client-side navigation (History API) inside
// the SPA — Tauri loads the app at "/" and never refreshes from the bundled
// HTML, so we never need a static .html for arbitrary file IDs.
//
// `generateStaticParams` cannot be exported from a "use client" file, so the
// real page logic lives in editor-client.tsx.

import { EditorClient } from "./editor-client";

export function generateStaticParams() {
  return [{ fileId: [] as string[] }];
}

export default function EditorPage() {
  return <EditorClient />;
}
