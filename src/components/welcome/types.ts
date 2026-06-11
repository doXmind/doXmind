// Shared contract for the welcome screen.

import type { WorkspaceDocumentType } from "@/lib/storage/types";

// One row in the persisted "recently opened files" list. Records survive
// across workspace switches because they store the absolute path; the
// `workspacePath` field is the parent workspace root we should re-mount when
// the user clicks the row.
export interface WelcomeRecentFile {
  absolutePath: string;
  workspacePath: string;
  name: string;
  documentType: WorkspaceDocumentType;
  lastOpened: string; // ISO timestamp
  editCount: number; // bumps each time the file is saved
  wordCount: number; // last known
  preview: string; // first-line excerpt (may be empty)
}

// One row in the legacy recent-workspaces list (folder paths only). Already
// labeled (basename + parent dir) so variants can render without splitting
// paths themselves.
export interface WelcomeRecentWorkspace {
  path: string;
  name: string;
  parent: string;
}

// Props every variant receives. Action handlers are wired by welcome-screen.tsx
// so variants stay presentational and testable.
//
// Action surface is intentionally minimal (mirrors VSCode/Typora's
// folder-scoped welcome): a window owns one folder, so there is no Import
// or Open File. The user opens a folder, or creates a new file inside the
// folder that's already open.
export interface WelcomeVariantProps {
  recentFiles: WelcomeRecentFile[];
  recentWorkspaces: WelcomeRecentWorkspace[];
  isDesktopShell: boolean;
  // True when a workspace folder is mounted; gates the "New" action because
  // a new file needs somewhere to live.
  hasWorkspace: boolean;
  onOpenFolder: () => void;
  onCreateNew: () => void;
  // Start an in-memory untitled buffer (VSCode-style). Available even
  // when no workspace is mounted; the editor will prompt for a save
  // location on first persist.
  onStartWriting: () => void;
  onOpenRecentFile: (file: WelcomeRecentFile) => void;
  onOpenRecentWorkspace: (path: string) => void;
  // Open OS-dropped items by path: a dropped folder mounts as a workspace, a
  // dropped file opens standalone. Desktop-shell only; a no-op in the browser.
  onDropFiles: (files: File[]) => void;
}

// Helper that variants may use for "12 min ago" / "yesterday" style stamps.
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "just now";
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day} days ago`;
  const week = Math.round(day / 7);
  if (week < 5) return `${week}w ago`;
  return then.toLocaleDateString();
}
