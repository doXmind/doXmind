"use client";

import { ThemeProvider } from "next-themes";
import { useThemeManager } from "@/hooks/use-theme-manager";

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
      <ThemeInitializer />
      {children}
    </ThemeProvider>
  );
}
