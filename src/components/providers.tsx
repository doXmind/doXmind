"use client";

import { ThemeProvider } from "next-themes";
import { MotionConfig } from "framer-motion";
import { useThemeManager } from "@/hooks/use-theme-manager";
import { TrayMenuListener } from "@/components/tray-menu-listener";

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
        <TrayMenuListener />
        {children}
      </MotionConfig>
    </ThemeProvider>
  );
}
