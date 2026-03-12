"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface TextCellProps {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}

export function TextCell({ value, onChange, autoFocus }: TextCellProps) {
  const [editing, setEditing] = useState(!!autoFocus);
  const [draft, setDraft] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Respond to autoFocus prop changes (e.g. when focusRowId is set after API returns)
  useEffect(() => {
    if (autoFocus && !editing) setEditing(true);
  }, [autoFocus]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = useCallback(
    (v: string) => {
      if (v !== value) onChange(v);
      setEditing(false);
    },
    [value, onChange]
  );

  const handleChange = useCallback(
    (v: string) => {
      setDraft(v);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (v !== value) onChange(v);
      }, 300);
    },
    [value, onChange]
  );

  if (!editing) {
    return (
      <div
        className="h-full w-full cursor-text truncate px-2.5 py-1.5 text-sm transition-colors hover:bg-accent/30"
        onClick={() => setEditing(true)}
      >
        {value || "\u00A0"}
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      type="text"
      className="h-full w-full rounded-sm border-none bg-background px-2.5 py-1.5 text-sm shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.4)] outline-none"
      value={draft}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(draft);
        if (e.key === "Escape") {
          setDraft(value ?? "");
          setEditing(false);
        }
      }}
    />
  );
}
