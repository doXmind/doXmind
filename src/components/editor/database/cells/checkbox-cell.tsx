"use client";

import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface CheckboxCellProps {
  value: boolean;
  onChange: (value: boolean) => void;
}

export function CheckboxCell({ value, onChange }: CheckboxCellProps) {
  return (
    <div className="flex h-full w-full items-center justify-center py-1.5">
      <button
        type="button"
        role="checkbox"
        aria-checked={!!value}
        className={cn(
          "flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-[4px] border-2 transition-colors duration-150",
          value
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/40 hover:border-muted-foreground/60"
        )}
        onClick={() => onChange(!value)}
      >
        {value && <Check className="h-3 w-3" strokeWidth={3} />}
      </button>
    </div>
  );
}
