"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, X } from "lucide-react";
import { useEffect } from "react";
import { useNotificationStore, type NotificationError } from "@/stores/notification-store";

const AUTO_DISMISS_MS = 5000;

export function InlineErrorBanner() {
  const errors = useNotificationStore((s) => s.errors);
  const dismissError = useNotificationStore((s) => s.dismissError);

  return (
    <div
      role="region"
      aria-label="Notifications"
      className="pointer-events-none fixed left-1/2 top-3 z-[1000] flex w-full max-w-[480px] -translate-x-1/2 flex-col gap-1.5 px-3"
    >
      <AnimatePresence initial={false}>
        {errors.map((error) => (
          <ErrorBannerRow key={error.id} error={error} onDismiss={() => dismissError(error.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

interface ErrorBannerRowProps {
  error: NotificationError;
  onDismiss: () => void;
}

function ErrorBannerRow({ error, onDismiss }: ErrorBannerRowProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [onDismiss]);

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
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="-mr-1 -mt-0.5 flex size-6 flex-shrink-0 cursor-pointer items-center justify-center rounded text-foreground/45 transition-colors hover:bg-foreground/[0.06] hover:text-foreground/80"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </motion.div>
  );
}
