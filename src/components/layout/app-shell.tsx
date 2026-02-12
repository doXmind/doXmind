"use client";

import { Header } from "./header";
import { InteractiveTour } from "@/components/onboarding/interactive-tour";

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
      <div className="relative flex-1 overflow-hidden">{children}</div>
      <InteractiveTour />
    </div>
  );
}
