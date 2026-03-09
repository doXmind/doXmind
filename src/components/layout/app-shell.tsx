"use client";

import { cn } from "@/lib/utils";
import { Header } from "./header";
import { BottomTabBar } from "./bottom-tab-bar";
import { LogoutAnimation } from "./logout-animation";
import { useAuthStore } from "@/stores/auth-store";

interface AppShellProps {
  children: React.ReactNode;
  hideHeader?: boolean;
}

export function AppShell({ children, hideHeader = false }: AppShellProps) {
  const user = useAuthStore((s) => s.user);

  return (
    <div
      className="flex flex-col bg-background"
      style={{
        height: "100dvh",
      }}
    >
      {!hideHeader && <Header />}
      <div
        className={cn(
          "relative flex flex-1 flex-col overflow-hidden",
          !hideHeader && user && "pb-14 md:pb-0"
        )}
      >
        {children}
      </div>
      {!hideHeader && <BottomTabBar />}
      <LogoutAnimation />
    </div>
  );
}
