"use client";

import { cn } from "@/lib/utils";
import type { SettingsSectionDef } from "./settings-atoms";

interface SettingsRailProps {
  sections: readonly SettingsSectionDef[];
  active: string;
  onJump: (id: string) => void;
  heading: string;
  footer?: React.ReactNode;
}

export function SettingsRail({ sections, active, onJump, heading, footer }: SettingsRailProps) {
  return (
    <aside className="sticky top-[72px] self-start">
      <div className="mb-3.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
        {heading}
      </div>
      <nav className="relative flex flex-col">
        {sections.map((s) => (
          <RailItem
            key={s.id}
            label={s.label}
            active={active === s.id}
            onClick={() => onJump(s.id)}
          />
        ))}
      </nav>
      {footer && (
        <div className="mt-5 border-t border-border/60 pt-3.5 font-mono text-[10.5px] leading-[1.7] text-muted-foreground/80">
          {footer}
        </div>
      )}
    </aside>
  );
}

function RailItem({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex items-center py-[7px] pl-0 pr-2 text-left text-[13px] tracking-[-0.005em] transition-colors",
        active
          ? "font-semibold text-foreground"
          : "font-normal text-muted-foreground hover:text-foreground"
      )}
    >
      {/* Underline minimal mark — short hairline at bottom-left of active item */}
      {active && (
        <span aria-hidden className="absolute bottom-1 left-0 h-[1.5px] w-[18px] bg-foreground" />
      )}
      <span>{label}</span>
    </button>
  );
}
