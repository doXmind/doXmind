"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, FileText, Settings } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Z_INDEX, MOBILE_PANEL } from "@/lib/constants";
import { useScrollDirection } from "@/hooks/use-scroll-direction";

export function BottomTabBar() {
  const pathname = usePathname();
  const isVisible = useScrollDirection();

  const tabs = [
    {
      href: "/",
      label: "Home",
      icon: Home,
      match: (p: string) => p === "/",
    },
    {
      href: "/editor",
      label: "Editor",
      icon: FileText,
      match: (p: string) => p.startsWith("/editor"),
    },
    {
      href: "/settings",
      label: "Settings",
      icon: Settings,
      match: (p: string) => p.startsWith("/settings"),
    },
  ];

  return (
    <motion.nav
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
      animate={{ y: isVisible ? 0 : MOBILE_PANEL.BOTTOM_NAV_HEIGHT }}
      transition={{ type: "spring", stiffness: 400, damping: 35 }}
    >
      {tabs.map((tab) => {
        const isActive = tab.match(pathname);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.label}
            href={tab.href}
            className={cn(
              "relative flex min-w-[64px] flex-col items-center justify-center gap-1",
              "rounded-lg px-3 py-2 transition-colors",
              "active:scale-95 active:bg-accent/50",
              isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {isActive && (
              <div className="absolute -top-px left-1/2 h-[2px] w-6 -translate-x-1/2 rounded-full bg-primary" />
            )}
            <div className="flex h-6 w-6 items-center justify-center">
              <Icon className="h-5 w-5" />
            </div>
            <span className="text-[10px] font-medium">{tab.label}</span>
          </Link>
        );
      })}
    </motion.nav>
  );
}
