"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface NetworkStatusIndicatorProps {
  className?: string;
}

export function NetworkStatusIndicator({ className }: NetworkStatusIndicatorProps) {
  const t = useTranslations("common");
  const { isOnline, wasOffline } = useNetworkStatus();
  const [showReconnected, setShowReconnected] = React.useState(false);

  // Show "reconnected" message when coming back online after being offline
  React.useEffect(() => {
    if (isOnline && wasOffline) {
      setShowReconnected(true);
      const timer = setTimeout(() => setShowReconnected(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, wasOffline]);

  // Only show indicator when offline or just reconnected
  if (isOnline && !showReconnected) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className={cn(
          "fixed left-1/2 top-14 z-50 -translate-x-1/2",
          "rounded-full border px-4 py-2 shadow-lg",
          "flex items-center gap-2 text-sm font-medium",
          isOnline
            ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300"
            : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
          className
        )}
        role="status"
        aria-live="polite"
      >
        {isOnline ? (
          <>
            <Wifi className="h-4 w-4" />
            <span>{t("backOnline")}</span>
          </>
        ) : (
          <>
            <WifiOff className="h-4 w-4" />
            <span>{t("youreOffline")}</span>
            <RefreshCw className="ml-1 h-3 w-3 animate-spin opacity-60" />
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
