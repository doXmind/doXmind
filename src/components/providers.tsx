"use client";

import { ThemeProvider } from "next-themes";
import { MotionConfig } from "framer-motion";
import { useThemeManager } from "@/hooks/use-theme-manager";
import { TrayMenuListener } from "@/components/tray-menu-listener";
import { AppearanceInjector } from "@/components/appearance-injector";
import { MarkerDownloadPrompt } from "@/components/marker-download-prompt";

function ThemeInitializer() {
  useThemeManager();
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
        <TrayMenuListener />
        {children}
        <MarkerDownloadPrompt />
      </MotionConfig>
    </ThemeProvider>
  );
}
