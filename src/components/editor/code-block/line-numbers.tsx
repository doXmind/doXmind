"use client";

import { cn } from "@/lib/utils";

interface LineNumbersProps {
  count: number;
  className?: string;
}

export function LineNumbers({ count, className }: LineNumbersProps) {
  const numbers = Array.from({ length: count }, (_, i) => String(i + 1)).join("\n");

  return (
    <pre
      className={cn(
        "line-numbers",
        "select-none text-right font-mono",
        "text-muted-foreground/50 dark:text-muted-foreground/70",
        "border-r border-border/30",
        "bg-muted/20",
        "shrink-0",
        // Mobile optimizations
        "max-[374px]:hidden", // Hide on very small screens
        "sm:min-w-[3rem]", // Smaller minimum width on mobile
        className
      )}
      aria-hidden="true"
    >
      {numbers}
    </pre>
  );
}
