"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { useNotificationStore } from "@/stores/notification-store";

const RESOLVED_LINGER_MS = 600;

export function HeaderProgressStrip() {
  const progress = useNotificationStore((s) => s.progress);
  const removeProgress = useNotificationStore((s) => s.removeProgress);

  // Auto-clear resolved/failed entries after a brief linger so the strip
  // doesn't accumulate stale tasks.
  useEffect(() => {
    const timers: number[] = [];
    progress.forEach((task) => {
      if (task.status === "running") return;
      const elapsed = Date.now() - (task.finishedAt ?? Date.now());
      const remaining = Math.max(0, RESOLVED_LINGER_MS - elapsed);
      timers.push(window.setTimeout(() => removeProgress(task.id), remaining));
    });
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [progress, removeProgress]);

  const hasRunning = progress.some((task) => task.status === "running");

  return (
    <AnimatePresence>
      {hasRunning && (
        <motion.div
          key="progress-strip"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.15 } }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
          className="pointer-events-none fixed inset-x-0 top-0 z-[999] h-[2px] overflow-hidden bg-foreground/[0.04]"
        >
          <motion.div
            className="h-full bg-foreground/55"
            initial={{ x: "-40%", width: "40%" }}
            animate={{ x: "120%" }}
            transition={{
              duration: 1.4,
              ease: "easeInOut",
              repeat: Infinity,
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
