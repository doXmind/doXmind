"use client";

import Link from "next/link";
import { Settings } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Tooltip } from "@/components/ui/tooltip";
import { ThemeQuickPicker } from "@/components/shared/shared-theme-toggle";

export function Header() {
  return (
    <header className="bg-sidebar relative z-20 flex h-12 shrink-0 items-center justify-between border-b border-border/40 px-6">
      <div className="flex items-center gap-1">
        <Tooltip content="Editor" side="bottom">
          <Link
            href="/editor"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent"
          >
            <Logo variant="icon" size="sm" className="h-6 w-6" />
          </Link>
        </Tooltip>
      </div>
      <div className="flex items-center gap-1">
        <ThemeQuickPicker />
        <div className="mx-1 h-5 w-px bg-border/40" />
        <Tooltip content="Settings" side="bottom">
          <Link
            href="/settings"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
          </Link>
        </Tooltip>
      </div>
    </header>
  );
}
