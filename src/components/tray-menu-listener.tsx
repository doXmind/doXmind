"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { navigateToEditorFile } from "@/lib/editor-navigation";
import { useFileStore } from "@/stores/file-store";

// Bridges native macOS tray-menu clicks (emitted from src-tauri/src/lib.rs)
// to the same store actions the in-app UI uses, so behavior stays in sync.
export function TrayMenuListener() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("__TAURI_BACKEND_URL__" in window)) return;

    let unlistenNewFile: (() => void) | undefined;
    let unlistenSettings: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");

      const onNewFile = await listen("tray://new-file", async () => {
        const { files, createFile } = useFileStore.getState();
        const rootFiles = files.filter((f) => !f.isFolder && f.parentId === null);
        let maxNum = 0;
        for (const f of rootFiles) {
          const m = f.name.match(/^Untitled-(\d+)\.md$/);
          if (m) {
            const n = parseInt(m[1], 10);
            if (n > maxNum) maxNum = n;
          }
        }
        const name = `Untitled-${maxNum + 1}.md`;
        try {
          const newId = await createFile(name, "", null);
          navigateToEditorFile(newId);
        } catch {
          // The store already surfaces failures via the global toaster.
        }
      });

      const onSettings = await listen("tray://settings", () => {
        router.push("/settings");
      });

      if (cancelled) {
        onNewFile();
        onSettings();
      } else {
        unlistenNewFile = onNewFile;
        unlistenSettings = onSettings;
      }
    })();

    return () => {
      cancelled = true;
      unlistenNewFile?.();
      unlistenSettings?.();
    };
  }, [router]);

  return null;
}
