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
    <header className="bg-sidebar flex h-11 items-center justify-between border-b border-border/40 px-4 md:px-5">
      <div className="flex items-center">
        <Link href="/" className="flex items-center">
          <Logo variant="icon" size="sm" />
        </Link>
      </div>
      <div className="flex items-center gap-1.5">
        <Tooltip content="Toggle Theme" side="bottom">
          <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle Theme">
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          </Button>
        </Tooltip>
        <div className="mx-1 h-4 w-px bg-border/60" />
        <UserMenu />
      </div>
    </header>
  );
}
