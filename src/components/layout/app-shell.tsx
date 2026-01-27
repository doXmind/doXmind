"use client";

import { Header } from "./header";

interface AppShellProps {
  children: React.ReactNode;
  hideHeader?: boolean;
}

export function AppShell({ children, hideHeader = false }: AppShellProps) {
  return (
    <div
      className="flex flex-col bg-background"
      style={{
        height: '100dvh',
        // Fallback for browsers without dvh support
        fallbacks: [{ height: '100vh' }]
      }}
    >
      {!hideHeader && <Header />}
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
