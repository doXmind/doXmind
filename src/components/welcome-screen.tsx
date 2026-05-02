"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { File, FileSymlink, Folder } from "lucide-react";
import { useFileStore, type RecentEntry } from "@/stores/file-store";
import { openWindowForTarget } from "@/lib/window";
import { Button } from "@/components/ui/button";
import { cn, getErrorMessage } from "@/lib/utils";
import { storeLogger } from "@/lib/logger";
import { toast } from "sonner";

const log = storeLogger.child("Welcome");

const RECENT_LIMIT = 8;

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: [0.25, 0.1, 0.25, 1] as const },
  },
};

function pathLabel(absolutePath: string): { name: string; parent: string } {
  const normalized = absolutePath.replaceAll("\\", "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  const name = parts.pop() ?? normalized;
  const parent = parts.length ? `/${parts.join("/")}` : "/";
  return { name, parent };
}

export function WelcomeScreen() {
  const t = useTranslations("welcome");
  const tSidebar = useTranslations("sidebar");
  const recentsRaw = useFileStore((s) => s.recents);
  const openTarget = useFileStore((s) => s.openTarget);
  const rootPath = useFileStore((s) => s.rootPath);
  const openFilePath = useFileStore((s) => s.openFilePath);
  const openFolder = useFileStore((s) => s.openFolder);
  const openFile = useFileStore((s) => s.openFile);

  // Open Folder/File only do anything inside the Tauri shell — the browser
  // build can't pick a real disk path. Hide the buttons on the web.
  const isDesktopShell = typeof window !== "undefined" && "__TAURI_BACKEND_URL__" in window;

  // Drop the row that matches whatever is open right now to avoid a no-op
  // entry at the top.
  const recents = useMemo<RecentEntry[]>(() => {
    return recentsRaw
      .filter((r) => {
        if (openTarget === "folder" && r.kind === "folder" && r.path === rootPath) return false;
        if (openTarget === "file" && r.kind === "file" && r.path === openFilePath) return false;
        return true;
      })
      .slice(0, RECENT_LIMIT);
  }, [recentsRaw, openTarget, rootPath, openFilePath]);

  // VSCode-style: plain click reuses the current window (which is already on
  // the welcome screen, so there's nothing to lose). Holding ⌘ / Shift / Ctrl
  // routes through Rust, which focuses an existing window with the same
  // target or opens a fresh one.
  const wantsNewWindow = (event: React.MouseEvent | React.KeyboardEvent): boolean =>
    event.metaKey || event.ctrlKey || event.shiftKey;

  const dispatchOpen = async (entry: RecentEntry, inNewWindow: boolean): Promise<void> => {
    if (inNewWindow) {
      await openWindowForTarget(entry);
      return;
    }
    if (entry.kind === "folder") {
      await openFolder(entry.path);
    } else {
      await openFile(entry.path);
    }
  };

  const handleOpenFolder = async (event: React.MouseEvent) => {
    if (!isDesktopShell) {
      toast.error(tSidebar("openWorkspaceRequiresDesktop"));
      return;
    }
    const inNewWindow = wantsNewWindow(event);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: tSidebar("openFolder"),
      });
      if (!selected || Array.isArray(selected)) return;
      await dispatchOpen({ kind: "folder", path: selected }, inNewWindow);
      if (!inNewWindow) toast.success(tSidebar("workspaceOpened"));
    } catch (error) {
      log.error("Failed to open folder", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const handleOpenFile = async (event: React.MouseEvent) => {
    if (!isDesktopShell) {
      toast.error(tSidebar("openWorkspaceRequiresDesktop"));
      return;
    }
    const inNewWindow = wantsNewWindow(event);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: false,
        multiple: false,
        title: tSidebar("openFile"),
        filters: [
          {
            name: tSidebar("openFileFilter"),
            extensions: ["md", "markdown", "pdf"],
          },
        ],
      });
      if (!selected || Array.isArray(selected)) return;
      const normalized = selected.replace(/\\/g, "/");
      const lastSlash = normalized.lastIndexOf("/");
      if (lastSlash <= 0) {
        toast.error(tSidebar("openFileNoParent"));
        return;
      }
      const fileBase = normalized.slice(lastSlash + 1);
      await dispatchOpen({ kind: "file", path: selected }, inNewWindow);
      if (!inNewWindow) toast.success(tSidebar("openedFile", { name: fileBase }));
    } catch (error) {
      log.error("Failed to open file", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  const handleOpenRecent = async (entry: RecentEntry, event: React.MouseEvent) => {
    try {
      await dispatchOpen(entry, wantsNewWindow(event));
    } catch (error) {
      log.error("Failed to open recent", error);
      const { title, description } = getErrorMessage(error);
      toast.error(title, { description });
    }
  };

  return (
    <div className="relative flex flex-1 items-start justify-center overflow-y-auto px-6 pb-12 pt-24 transition-colors duration-200">
      <motion.div
        className="w-full max-w-md"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={itemVariants} className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            onClick={handleOpenFolder}
            className="h-11 justify-center gap-2 text-sm"
          >
            <Folder className="h-4 w-4" />
            {tSidebar("openFolder")}
          </Button>
          <Button
            variant="secondary"
            onClick={handleOpenFile}
            className="h-11 justify-center gap-2 text-sm"
          >
            <FileSymlink className="h-4 w-4" />
            {tSidebar("openFile")}
          </Button>
        </motion.div>

        <motion.div variants={itemVariants} className="mt-8 space-y-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
            {t("recentWorkspaces")}
          </h2>
          {recents.length === 0 ? (
            <p className="px-1 py-3 text-sm text-muted-foreground/70">{t("noRecentWorkspaces")}</p>
          ) : (
            <ul className="space-y-0.5">
              {recents.map((entry) => {
                const { name, parent } = pathLabel(entry.path);
                const Icon = entry.kind === "folder" ? Folder : File;
                return (
                  <li key={`${entry.kind}:${entry.path}`}>
                    <button
                      type="button"
                      onClick={(event) => handleOpenRecent(entry, event)}
                      title={`${entry.path}\n⌘ click to open in new window`}
                      className={cn(
                        "group flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors",
                        "hover:bg-[var(--sidebar-hover)] focus:bg-[var(--sidebar-hover)] focus:outline-none"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">{name}</div>
                        <div className="truncate text-xs text-muted-foreground/70">{parent}</div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
}
