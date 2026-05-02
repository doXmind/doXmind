"use client";

import { Header } from "./header";

interface AppShellProps {
  children: React.ReactNode;
  hideHeader?: boolean;
}

export function AppShell({ children, hideHeader = false }: AppShellProps) {
  return (
    <div
      className="desktop-app-shell flex flex-col bg-background"
      style={{
        height: "100dvh",
      }}
    >
      {!hideHeader && <Header />}
      <div className="relative flex flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
