"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SettingsSectionDef {
  id: string;
  label: string;
}

export function SettingsSection({
  id,
  title,
  desc,
  children,
}: {
  id: string;
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mb-11 scroll-mt-16">
      <header className="mb-3.5">
        <h2 className="m-0 text-[18px] font-semibold tracking-[-0.005em] text-foreground">
          {title}
        </h2>
        {desc && (
          <p className="m-0 mt-1 max-w-[520px] text-[12.5px] leading-[1.5] text-muted-foreground">
            {desc}
          </p>
        )}
      </header>
      {children}
    </section>
  );
}

// Flat-card surface — transparent background, no outer border. Rows divide
// themselves with hairlines; the section itself has no chrome.
export function FlatCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col", className)}>{children}</div>;
}

// Cozy row used inside FlatCard. The outer container divides children with
// 1px hairlines so the visual rhythm matches the design.
export function FlatRow({
  children,
  first,
  className,
  align = "center",
}: {
  children: ReactNode;
  first?: boolean;
  className?: string;
  align?: "center" | "start";
}) {
  return (
    <div
      className={cn(
        "flex gap-4 px-[18px] py-3.5",
        align === "center" ? "items-center" : "items-start",
        first ? "" : "border-t border-border/60",
        className
      )}
    >
      {children}
    </div>
  );
}

// Title + description on the left side of a row; right side is the control.
export function RowLabel({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="text-[13px] font-medium text-foreground">{title}</div>
      {desc && (
        <div className="mt-0.5 max-w-[460px] text-[12px] leading-[1.45] text-muted-foreground">
          {desc}
        </div>
      )}
    </div>
  );
}

// 2-up metadata cell used in About.
export function KVCell({
  label,
  value,
  mono,
  borderTop,
  borderRight,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  borderTop?: boolean;
  borderRight?: boolean;
}) {
  return (
    <div
      className={cn(
        "px-[18px] py-3",
        borderTop && "border-t border-border/60",
        borderRight && "border-r border-border/60"
      )}
    >
      <div className="mb-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
        {label}
      </div>
      <div className={cn("text-[13px] text-foreground", mono && "font-mono")}>{value}</div>
    </div>
  );
}
