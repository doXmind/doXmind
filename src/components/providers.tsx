"use client";

import { ThemeProvider } from "next-themes";
import { MotionConfig } from "framer-motion";
import { useThemeManager } from "@/hooks/use-theme-manager";
import { NativeMenuListener } from "@/components/native-menu-listener";
import { AppearanceInjector } from "@/components/appearance-injector";

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
        <NativeMenuListener />
        {children}
      </MotionConfig>
    </ThemeProvider>
  );
}
