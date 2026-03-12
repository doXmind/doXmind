"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface NumberCellProps {
  value: number | null;
  onChange: (value: number | null) => void;
}

export function NumberCell({ value, onChange }: NumberCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value?.toString() ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!editing) setDraft(value?.toString() ?? "");
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = useCallback(
    (v: string) => {
      const num = v === "" ? null : Number(v);
      if (num !== value && (num === null || !isNaN(num))) onChange(num);
      setEditing(false);
    },
    [value, onChange]
  );

  const handleChange = useCallback(
    (v: string) => {
      setDraft(v);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const num = v === "" ? null : Number(v);
        if (num !== value && (num === null || !isNaN(num))) onChange(num);
      }, 300);
    },
    [value, onChange]
  );

  if (!editing) {
    return (
      <div
        className="h-full w-full cursor-text truncate px-2.5 py-1.5 text-right text-sm tabular-nums transition-colors hover:bg-accent/30"
        onClick={() => setEditing(true)}
      >
        {value != null ? value : "\u00A0"}
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      type="number"
      className="h-full w-full rounded-sm border-none bg-background px-2.5 py-1.5 text-right text-sm tabular-nums shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.4)] outline-none"
      value={draft}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(draft);
        if (e.key === "Escape") {
          setDraft(value?.toString() ?? "");
          setEditing(false);
        }
      }}
    />
  );
}
