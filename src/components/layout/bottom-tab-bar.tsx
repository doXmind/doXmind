"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Users, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { Z_INDEX, MOBILE_PANEL } from "@/lib/constants";

interface TabItem {
  href: string;
  label: string;
  icon: typeof Home;
  match: (pathname: string) => boolean;
}

export function BottomTabBar() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);

  const tabs: TabItem[] = [
    {
      href: "/",
      label: "Home",
      icon: Home,
      match: (p) => p === "/",
    },
    {
      href: "/community",
      label: "Community",
      icon: Users,
      match: (p) => p.startsWith("/community"),
    },
    {
      href: user?.id ? `/profile/${user.id}` : "/login",
      label: "Profile",
      icon: User,
      match: (p) => p.startsWith("/profile"),
    },
  ];

  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0",
        "border-t border-border/50 bg-background/95 backdrop-blur-xl",
        "flex items-center justify-around",
        "pb-[env(safe-area-inset-bottom)]",
        "md:hidden"
      )}
      style={{
        zIndex: Z_INDEX.BOTTOM_NAV,
        height: MOBILE_PANEL.BOTTOM_NAV_HEIGHT,
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.match(pathname);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.label}
            href={tab.href}
            className={cn(
              "flex min-w-[64px] flex-col items-center justify-center gap-1",
              "rounded-lg px-3 py-2 transition-colors",
              "active:scale-95 active:bg-accent/50",
              isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <div className="flex h-6 w-6 items-center justify-center">
              <Icon className="h-5 w-5" />
            </div>
            <span className="text-[10px] font-medium">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
