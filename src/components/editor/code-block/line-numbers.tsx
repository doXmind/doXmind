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
        "select-none pb-4 pl-4 pr-4 pt-4 text-right",
        "font-mono text-sm leading-relaxed",
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
      {Array.from({ length: count }, (_, i) => (
        // line-height matches the content's absolute `1.625rem` rule in
        // code-block.css. Using Tailwind's `leading-relaxed` (unitless
        // 1.625 × 14px = 22.75px) here while content is 26px caused the
        // gutter and content baselines to drift apart by ~2.6px per row.
        <div key={i + 1} className="h-[1.625rem] leading-[1.625rem]">
          {i + 1}
        </div>
      ))}
    </div>
  );
}
