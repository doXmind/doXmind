"use client";

import { useState, useRef, useEffect } from "react";
import { Mail } from "lucide-react";

interface EmailCellProps {
  value: string;
  onChange: (value: string) => void;
}

export function EmailCell({ value, onChange }: EmailCellProps) {
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
            <span className="truncate text-sm text-primary underline underline-offset-2 transition-colors hover:text-primary/80">
              {value}
            </span>
            <a
              href={`mailto:${value}`}
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <Mail className="h-3 w-3 text-muted-foreground" />
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
      type="email"
      placeholder="email@example.com"
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
