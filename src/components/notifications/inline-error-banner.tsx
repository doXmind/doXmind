"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, X } from "lucide-react";
import { useEffect } from "react";
import { useNotificationStore, type NotificationError } from "@/stores/notification-store";

const AUTO_DISMISS_MS = 5000;

export function InlineErrorBanner() {
  const errors = useNotificationStore((s) => s.errors);

  return (
    <div
      role="region"
      aria-label="Notifications"
      className="pointer-events-none fixed left-1/2 top-3 z-[1000] flex w-full max-w-[480px] -translate-x-1/2 flex-col gap-1.5 px-3"
    >
      <AnimatePresence initial={false}>
        {errors.map((error) => (
          <ErrorBannerRow key={error.id} error={error} />
        ))}
      </AnimatePresence>
    </div>
  );
}

interface ErrorBannerRowProps {
  error: NotificationError;
}

function ErrorBannerRow({ error }: ErrorBannerRowProps) {
  // Read the action from the store directly so the dismiss timer's
  // dependencies depend only on the stable error id. An inline `onDismiss`
  // arrow from the parent would change identity on every parent render and
  // restart the auto-dismiss countdown — which would mean adding a second
  // error before 5 s had reset every older row's timer.
  const persistent = error.persistent === true;
  useEffect(() => {
    if (persistent) return;
    const id = error.id;
    const timer = window.setTimeout(() => {
      useNotificationStore.getState().dismissError(id);
    }, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [error.id, persistent]);

  const handleDismiss = () => useNotificationStore.getState().dismissError(error.id);

  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: -8 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] },
      }}
      exit={{
        opacity: 0,
        y: -4,
        transition: { duration: 0.12, ease: [0.7, 0, 0.84, 0] },
      }}
      layout
      className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-popover px-3.5 py-2.5 text-popover-foreground shadow-[0_1px_0_rgba(15,15,15,0.02),0_4px_16px_rgba(15,15,15,0.06)]"
    >
      <AlertCircle className="mt-[1px] size-4 flex-shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium leading-[1.35] text-foreground">{error.title}</div>
        {error.description && (
          <div className="mt-0.5 break-words text-[12px] leading-[1.4] text-foreground/65">
            {error.description}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss notification"
        className="-mr-1 -mt-0.5 flex size-6 flex-shrink-0 cursor-pointer items-center justify-center rounded text-foreground/45 transition-colors hover:bg-foreground/[0.06] hover:text-foreground/80"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </motion.div>
  );
}
