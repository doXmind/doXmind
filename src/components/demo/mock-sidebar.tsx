import { cn } from "@/lib/utils";

const OUTLINE_ITEMS = [
  { level: 1, label: "The Future of AI-Powered Writing", active: true },
  { level: 2, label: "Key Features", active: false },
  { level: 2, label: "Implementation", active: false },
  { level: 2, label: "Results", active: false },
  { level: 1, label: "Conclusion", active: false },
  { level: 2, label: "Next Steps", active: false },
];

export function MockSidebar() {
  return (
    <div className="flex h-full w-[160px] shrink-0 flex-col border-r border-border bg-muted/30">
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Outline
        </span>
      </div>
      <div className="px-2 py-1">
        {OUTLINE_ITEMS.map((item, i) => (
          <div
            key={i}
            className={cn(
              "flex items-center gap-2 rounded px-2 py-1.5",
              item.active && "bg-primary/8"
            )}
            style={{ paddingLeft: item.level === 2 ? 24 : 8 }}
          >
            <div
              className={cn(
                "shrink-0 rounded-full",
                item.level === 1 ? "h-2 w-2" : "h-1.5 w-1.5",
                item.active ? "bg-primary" : "bg-muted-foreground/40"
              )}
            />
            <span
              className={cn(
                "truncate text-[11px] leading-tight",
                item.level === 1 ? "font-medium" : "font-normal",
                item.active ? "text-primary" : "text-muted-foreground"
              )}
            >
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
