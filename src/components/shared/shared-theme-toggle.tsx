"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";

export function SharedThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <Tooltip content="Toggle Theme" side="bottom">
      <button
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Toggle theme"
      >
        <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      </button>
    </Tooltip>
  );
}
