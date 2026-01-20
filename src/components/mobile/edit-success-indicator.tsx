"use client";

/**
 * Edit Success Indicator Component
 *
 * Toast-style indicator that appears when AI has applied edits to the document.
 * Shows edit count and auto-dismisses after a few seconds.
 */

import { useEffect, useCallback } from "react";
import { Check, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { haptics } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { Z_INDEX, MOBILE_SPRINGS } from "@/lib/constants";

interface EditSuccessIndicatorProps {
  /** Whether the indicator is visible */
  isVisible: boolean;
  /** Number of edits applied */
  editCount: number;
  /** Callback when indicator is dismissed */
  onDismiss: () => void;
  /** Callback when tapped to view details */
  onViewDetails?: () => void;
  /** Auto dismiss duration in ms (default: 3000) */
  autoDismissMs?: number;
}

export function EditSuccessIndicator({
  isVisible,
  editCount,
  onDismiss,
  onViewDetails,
  autoDismissMs = 3000,
}: EditSuccessIndicatorProps) {
  // Auto dismiss after timeout
  useEffect(() => {
    if (isVisible && autoDismissMs > 0) {
      const timer = setTimeout(() => {
        onDismiss();
      }, autoDismissMs);
      return () => clearTimeout(timer);
    }
  }, [isVisible, autoDismissMs, onDismiss]);

  // Trigger haptic feedback when shown
  useEffect(() => {
    if (isVisible) {
      haptics.success();
    }
  }, [isVisible]);

  const handleTap = useCallback(() => {
    haptics.light();
    if (onViewDetails) {
      onViewDetails();
    } else {
      onDismiss();
    }
  }, [onViewDetails, onDismiss]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="fixed inset-x-4 md:hidden"
          style={{
            zIndex: Z_INDEX.MOBILE_PANEL + 5,
            top: "calc(env(safe-area-inset-top) + 60px)",
          }}
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ type: "spring", ...MOBILE_SPRINGS.SNAPPY }}
        >
          <button
            type="button"
            onClick={handleTap}
            className={cn(
              "mx-auto flex items-center gap-3",
              "rounded-full px-4 py-2.5",
              "bg-primary text-primary-foreground",
              "shadow-lg",
              "transition-transform active:scale-95"
            )}
          >
            {/* Success icon with animation */}
            <div className="relative">
              <Check className="h-5 w-5" />
              <Sparkles
                className="absolute -right-1 -top-1 h-3 w-3 animate-bounce text-primary-foreground/80"
                style={{ animationDuration: "1s" }}
              />
            </div>

            {/* Message */}
            <span className="text-sm font-medium">
              {editCount === 1 ? "1 edit applied" : `${editCount} edits applied`}
            </span>

            {/* Tap hint */}
            {onViewDetails && (
              <span className="text-xs opacity-70">Tap to view</span>
            )}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
