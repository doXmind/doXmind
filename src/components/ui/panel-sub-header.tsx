import { cn } from "@/lib/utils";

interface PanelSubHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function PanelSubHeader({ children, className }: PanelSubHeaderProps) {
  return (
    <div className={cn("flex h-9 shrink-0 items-center border-b border-border/30 px-3", className)}>
      {children}
    </div>
  );
}
