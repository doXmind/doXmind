"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
}

export function ConfirmDialog({
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  destructive = true,
}: ConfirmDialogProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  return createPortal(
    <div className="animate-in fade-in-0 fixed inset-0 z-[100] flex items-center justify-center duration-150">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="animate-in fade-in-0 zoom-in-[0.97] relative z-10 mx-4 w-full max-w-sm rounded-xl border border-border bg-background p-5 shadow-2xl duration-200">
        <p className="text-sm text-foreground">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors",
              destructive
                ? "bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600"
                : "bg-primary hover:bg-primary/90"
            )}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
