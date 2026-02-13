"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function useIsMac() {
  const [isMac, setIsMac] = React.useState(false);

  React.useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().indexOf("MAC") >= 0);
  }, []);

  return isMac;
}

export function formatKey(key: string, isMac: boolean) {
  if (isMac && key === "Ctrl") return "\u2318";
  if (isMac && key === "Alt") return "\u2325";
  if (isMac && key === "Shift") return "\u21e7";
  return key;
}

export function ShortcutKey({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center",
        "h-6 min-w-[24px] px-1.5",
        "text-xs font-medium",
        "rounded border border-border bg-muted",
        "shadow-[0_1px_0_1px_rgba(0,0,0,0.05)]",
        "dark:shadow-[0_1px_0_1px_rgba(255,255,255,0.05)]"
      )}
    >
      {children}
    </kbd>
  );
}

export function ShortcutCombo({ keys }: { keys: string[] }) {
  const isMac = useIsMac();

  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((key, i) => (
        <React.Fragment key={i}>
          <ShortcutKey>{formatKey(key, isMac)}</ShortcutKey>
          {i < keys.length - 1 && <span className="text-xs text-muted-foreground">+</span>}
        </React.Fragment>
      ))}
    </span>
  );
}
