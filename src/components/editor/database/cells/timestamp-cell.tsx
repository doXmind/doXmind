"use client";

interface TimestampCellProps {
  timestamp: string | null;
}

export function TimestampCell({ timestamp }: TimestampCellProps) {
  if (!timestamp) {
    return (
      <div className="h-full w-full px-2.5 py-1.5 text-sm text-muted-foreground/50">&nbsp;</div>
    );
  }

  const date = new Date(timestamp);
  const formatted = date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="h-full w-full px-2.5 py-1.5 text-sm text-muted-foreground">{formatted}</div>
  );
}
