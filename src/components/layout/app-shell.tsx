"use client";

import { cn } from "@/lib/utils";
import { Header } from "./header";
import { BottomTabBar } from "./bottom-tab-bar";
import { InteractiveTour } from "@/components/onboarding/interactive-tour";
import { LogoutAnimation } from "./logout-animation";

interface AppShellProps {
  children: React.ReactNode;
  hideHeader?: boolean;
}

export function AppShell({ children, hideHeader = false }: AppShellProps) {
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
          !hideHeader && "pb-14 md:pb-0"
        )}
      >
        {children}
      </div>
      {!hideHeader && <BottomTabBar />}
      <InteractiveTour />
      <LogoutAnimation />
    </div>
  );
}
