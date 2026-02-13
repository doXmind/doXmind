import { Check } from "lucide-react";

export function MockStatusBar() {
  return (
    <div className="flex items-center gap-1 border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground/60">
      <Check className="h-3 w-3 text-green-500" />
      <span className="text-green-500">Saved</span>
      <span className="mx-1">·</span>
      <span>847 words</span>
      <span className="mx-1">·</span>
      <span>4,231 characters</span>
      <span className="mx-1">·</span>
      <span>5 min read</span>
    </div>
  );
}
