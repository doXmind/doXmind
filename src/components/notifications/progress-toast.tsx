"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, X } from "lucide-react";
import { useEffect } from "react";
import { useNotificationStore, type ProgressTask } from "@/stores/notification-store";

const SUCCESS_LINGER_MS = 1800;
const ERROR_LINGER_MS = 4500;

/**
 * Bottom-right toast card used for long-running operations like the PDF
 * export pipeline. Shows the current step text so a 5–10 s export doesn't
 * feel like a hang.
 *
 * The toast renders any `ProgressTask` from the notification store that
 * carries a `detail` (or whose `status` flips to success/error).
 */
export function ProgressToast() {
  const tasks = useNotificationStore((s) => s.progress);
  const removeProgress = useNotificationStore((s) => s.removeProgress);

  // Auto-dismiss completed entries so the card doesn't pile up.
  useEffect(() => {
    const timers: number[] = [];
    tasks.forEach((task) => {
      if (task.status === "running") return;
      const linger = task.status === "error" ? ERROR_LINGER_MS : SUCCESS_LINGER_MS;
      const elapsed = Date.now() - (task.finishedAt ?? Date.now());
      const remaining = Math.max(0, linger - elapsed);
      timers.push(window.setTimeout(() => removeProgress(task.id), remaining));
    });
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [tasks, removeProgress]);

  // Only render tasks that opted into the rich card UI by supplying a
  // detail/message. The thin top strip is enough for ambient progress.
  const visible = tasks.filter((task) => task.detail || task.message || task.status !== "running");

  return (
    <div
      role="region"
      aria-label="Progress notifications"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[1000] flex w-[320px] flex-col gap-2"
    >
      <AnimatePresence initial={false}>
        {visible.map((task) => (
          <ProgressToastRow key={task.id} task={task} />
        ))}
      </AnimatePresence>
    </div>
  );
}

interface ProgressToastRowProps {
  task: ProgressTask;
}

function ProgressToastRow({ task }: ProgressToastRowProps) {
  const handleDismiss = () => useNotificationStore.getState().removeProgress(task.id);
  const showDismiss = task.status !== "running";
  const detail = task.status === "running" ? task.detail : (task.message ?? task.detail);

  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: 12 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] },
      }}
      exit={{
        opacity: 0,
        y: 8,
        transition: { duration: 0.14, ease: [0.7, 0, 0.84, 0] },
      }}
      layout
      className="pointer-events-auto flex items-start gap-3 rounded-lg border border-border/60 bg-popover/95 px-3.5 py-2.5 text-popover-foreground shadow-[0_2px_4px_rgba(15,15,15,0.04),0_8px_24px_rgba(15,15,15,0.08)] backdrop-blur"
    >
      <ProgressIcon status={task.status} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium leading-[1.35] text-foreground">{task.label}</div>
        {detail ? (
          <div className="mt-0.5 break-words text-[12px] leading-[1.4] text-foreground/65">
            {detail}
          </div>
        ) : null}
      </div>
      {showDismiss ? (
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="-mr-1 -mt-0.5 flex size-6 flex-shrink-0 cursor-pointer items-center justify-center rounded text-foreground/45 transition-colors hover:bg-foreground/[0.06] hover:text-foreground/80"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </motion.div>
  );
}

function ProgressIcon({ status }: { status: ProgressTask["status"] }) {
  if (status === "success") {
    return (
      <span className="mt-[1px] flex size-4 flex-shrink-0 items-center justify-center text-emerald-600 dark:text-emerald-400">
        <Check className="size-4" aria-hidden="true" />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="mt-[1px] flex size-4 flex-shrink-0 items-center justify-center text-destructive">
        <X className="size-4" aria-hidden="true" />
      </span>
    );
  }
  return (
    <Loader2
      className="mt-[1px] size-4 flex-shrink-0 animate-spin text-foreground/60"
      aria-hidden="true"
    />
  );
}
