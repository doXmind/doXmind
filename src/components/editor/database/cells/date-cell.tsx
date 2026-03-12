"use client";

import { useState, useRef, useEffect } from "react";

interface DateCellProps {
  value: string | null;
  onChange: (value: string | null) => void;
}

export function DateCell({ value, onChange }: DateCellProps) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.showPicker?.();
  }, [editing]);

  const formatDate = (v: string | null) => {
    if (!v) return null;
    try {
      return new Date(v).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return v;
    }
  };

  if (!editing) {
    return (
      <div
        className="h-full w-full cursor-text truncate px-2.5 py-1.5 text-sm transition-colors hover:bg-accent/30"
        onClick={() => setEditing(true)}
      >
        {formatDate(value) || "\u00A0"}
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      type="date"
      className="h-full w-full rounded-sm border-none bg-background px-2.5 py-1.5 text-sm shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.4)] outline-none"
      value={value ?? ""}
      onChange={(e) => {
        onChange(e.target.value || null);
        setEditing(false);
      }}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}
