"use client";

import Link from "next/link";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { Tooltip } from "@/components/ui/tooltip";
import { UserMenu } from "./user-menu";

export function Header() {
  const { theme, setTheme } = useTheme();

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <header className="bg-sidebar relative z-20 flex h-12 shrink-0 items-center justify-between border-b border-border/40 px-6">
      <div className="flex items-center">
        <Tooltip content="Home" side="bottom">
          <Link
            href="/"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent"
          >
            <Logo variant="icon" size="sm" className="h-6 w-6" />
          </Link>
        </Tooltip>
      </div>
      <div className="flex items-center gap-1">
        <Tooltip content="Toggle Theme" side="bottom">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={toggleTheme}
            aria-label="Toggle Theme"
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          </Button>
        </Tooltip>
        <div className="mx-1 h-5 w-px bg-border/40" />
        <UserMenu compact />
      </div>
    </header>
  );
}
