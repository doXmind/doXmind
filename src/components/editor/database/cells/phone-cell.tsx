"use client";

import { useState, useRef, useEffect } from "react";
import { Phone } from "lucide-react";

interface PhoneCellProps {
  value: string;
  onChange: (value: string) => void;
}

export function PhoneCell({ value, onChange }: PhoneCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    if (draft !== value) onChange(draft);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div
        className="group flex h-full w-full cursor-text items-center gap-1 px-2.5 py-1.5 transition-colors hover:bg-accent/30"
        onClick={() => setEditing(true)}
      >
        {value ? (
          <>
            <span className="truncate text-sm">{value}</span>
            <a
              href={`tel:${value}`}
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <Phone className="h-3 w-3 text-muted-foreground" />
            </a>
          </>
        ) : (
          <span className="text-sm">&nbsp;</span>
        )}
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      type="tel"
      placeholder="+1 (555) 000-0000"
      className="h-full w-full rounded-sm border-none bg-background px-2.5 py-1.5 text-sm shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.4)] outline-none"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          setDraft(value ?? "");
          setEditing(false);
        }
      }}
    />
  );
}
