"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { cn } from "@/lib/utils";

interface NetworkStatusIndicatorProps {
  className?: string;
}

export function NetworkStatusIndicator({ className }: NetworkStatusIndicatorProps) {
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
          "fixed top-14 left-1/2 -translate-x-1/2 z-50",
          "px-4 py-2 rounded-full shadow-lg border",
          "flex items-center gap-2 text-sm font-medium",
          isOnline
            ? "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300"
            : "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300",
          className
        )}
        role="status"
        aria-live="polite"
      >
        {isOnline ? (
          <>
            <Wifi className="h-4 w-4" />
            <span>Back online</span>
          </>
        ) : (
          <>
            <WifiOff className="h-4 w-4" />
            <span>You&apos;re offline</span>
            <RefreshCw className="h-3 w-3 animate-spin ml-1 opacity-60" />
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
