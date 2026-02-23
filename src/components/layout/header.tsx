"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/ui/logo";
import { Tooltip } from "@/components/ui/tooltip";
import { ThemeQuickPicker } from "@/components/shared/shared-theme-toggle";
import { UserMenu } from "./user-menu";
import { useAuthStore } from "@/stores/auth-store";

const NAV_LINKS = [
  { href: "/", label: "Home", match: (p: string) => p === "/" },
  { href: "/community", label: "Community", match: (p: string) => p.startsWith("/community") },
];

export function Header() {
  const user = useAuthStore((s) => s.user);
  const pathname = usePathname();

  return (
    <header className="bg-sidebar relative z-20 flex h-12 shrink-0 items-center justify-between border-b border-border/40 px-6">
      <div className="flex items-center gap-1">
        <Tooltip content="Home" side="bottom">
          <Link
            href="/"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent"
          >
            <Logo variant="icon" size="sm" className="h-6 w-6" />
          </Link>
        </Tooltip>

        {/* Desktop navigation links */}
        <nav className="hidden items-center gap-0.5 md:flex">
          {NAV_LINKS.map((link) => {
            const isActive = link.match(pathname);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "relative px-3 py-1.5 text-[13px] font-medium transition-colors",
                  isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {link.label}
                {isActive && (
                  <span className="absolute bottom-0 left-1/2 h-[2px] w-4 -translate-x-1/2 rounded-full bg-foreground" />
                )}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-1">
        <ThemeQuickPicker />
        {user ? (
          <>
            <div className="mx-1 h-5 w-px bg-border/40" />
            <UserMenu compact />
          </>
        ) : (
          <>
            <div className="mx-1 h-5 w-px bg-border/40" />
            <Tooltip content="Sign in" side="bottom">
              <Link
                href="/login"
                className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <LogIn className="h-4 w-4" />
                <span className="hidden sm:inline">Sign in</span>
              </Link>
            </Tooltip>
          </>
        )}
      </div>
    </header>
  );
}
