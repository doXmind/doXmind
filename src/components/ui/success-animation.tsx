"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface SuccessAnimationProps {
  show: boolean;
  onComplete?: () => void;
  message?: string;
  className?: string;
  variant?: "inline" | "overlay" | "toast";
}

/**
 * Success checkmark animation component
 * Provides visual feedback for successful operations
 */
export function SuccessAnimation({
  show,
  onComplete,
  message,
  className,
  variant = "inline",
}: SuccessAnimationProps) {
  React.useEffect(() => {
    if (show && onComplete) {
      const timer = setTimeout(onComplete, 1500);
      return () => clearTimeout(timer);
    }
  }, [show, onComplete]);

  if (variant === "overlay") {
    return (
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={cn(
              "fixed inset-0 z-50 flex items-center justify-center",
              "bg-background/60 backdrop-blur-sm",
              className
            )}
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className="flex flex-col items-center gap-3"
            >
              <SuccessCircle />
              {message && (
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="text-sm font-medium text-foreground"
                >
                  {message}
                </motion.p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  if (variant === "toast") {
    return (
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            className={cn(
              "fixed bottom-6 left-1/2 -translate-x-1/2 z-50",
              "flex items-center gap-3 px-4 py-3",
              "bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800",
              "rounded-lg shadow-lg",
              className
            )}
          >
            <SuccessCircle size="sm" />
            {message && (
              <span className="text-sm font-medium text-green-700 dark:text-green-300">
                {message}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  // Inline variant
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0 }}
          className={cn("inline-flex items-center gap-2", className)}
        >
          <SuccessCircle size="sm" />
          {message && (
            <span className="text-sm text-green-600 dark:text-green-400">
              {message}
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface SuccessCircleProps {
  size?: "sm" | "md" | "lg";
}

function SuccessCircle({ size = "md" }: SuccessCircleProps) {
  const sizeClasses = {
    sm: "w-6 h-6",
    md: "w-12 h-12",
    lg: "w-16 h-16",
  };

  const iconSizes = {
    sm: "h-3 w-3",
    md: "h-6 w-6",
    lg: "h-8 w-8",
  };

  return (
    <motion.div
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{
        type: "spring",
        stiffness: 400,
        damping: 15,
        delay: 0.1,
      }}
      className={cn(
        "rounded-full bg-green-500 flex items-center justify-center",
        sizeClasses[size]
      )}
    >
      <motion.div
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.3 }}
      >
        <Check className={cn("text-white", iconSizes[size])} strokeWidth={3} />
      </motion.div>
    </motion.div>
  );
}

/**
 * Hook to trigger success animation
 */
export function useSuccessAnimation() {
  const [show, setShow] = React.useState(false);

  const trigger = React.useCallback(() => {
    setShow(true);
  }, []);

  const hide = React.useCallback(() => {
    setShow(false);
  }, []);

  return { show, trigger, hide };
}
