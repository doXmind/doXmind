"use client";

import { ThemeProvider } from "next-themes";
import { MotionConfig } from "framer-motion";
import { useEffect } from "react";
import { useThemeManager } from "@/hooks/use-theme-manager";
import { NativeMenuListener } from "@/components/native-menu-listener";
import { WorkspaceChangeListener } from "@/components/workspace-change-listener";
import { ContextMenuGuard } from "@/components/context-menu-guard";
import { AppearanceInjector } from "@/components/appearance-injector";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useEditorStore } from "@/stores/editor-store";
import { onShellCloseRequested } from "@/lib/shell/close";

function ThemeInitializer() {
  useThemeManager();
  return null;
}

export function ShellCloseListener() {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void onShellCloseRequested(async () => {
      // Every pane, not the focused one. Unsaved edits sitting in the other pane are just
      // as real, and saving only the active editor dropped them on close.
      const { editors, saveAllEditors } = useEditorRefStore.getState();
      if (Object.keys(editors).length > 0) return saveAllEditors();
      return !useEditorStore.getState().isDirty;
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      storageKey="doxmind-next-theme"
      disableTransitionOnChange
      themes={["light", "dark"]}
    >
      <MotionConfig reducedMotion="user">
        <ThemeInitializer />
        <AppearanceInjector />
        <ShellCloseListener />
        <NativeMenuListener />
        <WorkspaceChangeListener />
        <ContextMenuGuard />
        {children}
      </MotionConfig>
    </ThemeProvider>
  );
}
