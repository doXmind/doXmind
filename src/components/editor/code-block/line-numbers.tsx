"use client";

import { cn } from "@/lib/utils";

interface LineNumbersProps {
  count: number;
  className?: string;
}

export function LineNumbers({ count, className }: LineNumbersProps) {
  return (
    <div
      className={cn(
        "line-numbers",
        "select-none text-right pr-4 pt-4 pb-4 pl-4",
        "font-mono text-sm leading-relaxed",
        "text-muted-foreground/50",
        "border-r border-border/30",
        "bg-muted/20",
        "shrink-0",
        // Mobile optimizations
        "max-[374px]:hidden",  // Hide on very small screens
        "sm:min-w-[3rem]",     // Smaller minimum width on mobile
        className
      )}
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i + 1} className="leading-relaxed h-[1.625rem]">
          {i + 1}
        </div>
      ))}
    </div>
  );
}
