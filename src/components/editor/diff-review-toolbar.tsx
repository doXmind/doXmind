"use client";

import { motion } from "framer-motion";
import { Editor } from "@tiptap/react";
import { Eye, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-device-type";

interface DiffReviewToolbarProps {
  editor: Editor | null;
  isActive: boolean;
  pendingCount: number;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

export function DiffReviewToolbar({
  editor,
  isActive,
  pendingCount,
  onAcceptAll,
  onRejectAll,
}: DiffReviewToolbarProps) {
  const isMobile = useIsMobile();

  if (!isActive || !editor) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={cn(
        "flex items-center border-b border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30",
        // Desktop: normal padding
        "gap-3 px-4 py-2",
        // Mobile: compact styling (not fixed - stays in document flow)
        isMobile && "gap-2 px-3 py-1.5"
      )}
    >
      {/* Status indicator with pulse */}
      <div className={cn("flex items-center gap-2", isMobile ? "text-xs" : "text-sm")}>
        <div className="relative">
          <Eye
            className={cn(
              "text-amber-600 dark:text-amber-400",
              isMobile ? "h-3.5 w-3.5" : "h-4 w-4"
            )}
          />
          <motion.span
            className={cn(
              "absolute rounded-full bg-amber-500",
              isMobile ? "-right-0.5 -top-0.5 h-1.5 w-1.5" : "-right-0.5 -top-0.5 h-2 w-2"
            )}
            animate={{
              scale: [1, 1.2, 1],
              opacity: [1, 0.7, 1],
            }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
        <span className="font-medium text-amber-800 dark:text-amber-200">
          {isMobile ? "Review" : "Review Mode"}
        </span>
        <motion.span
          key={pendingCount}
          initial={{ scale: 1.2 }}
          animate={{ scale: 1 }}
          className="text-amber-600 dark:text-amber-400"
        >
          {pendingCount} {isMobile ? "" : "change"}
          {isMobile ? "" : pendingCount !== 1 ? "s" : ""} pending
        </motion.span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Action buttons */}
      <motion.button
        type="button"
        onClick={onRejectAll}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 20 }}
        className={cn(
          "inline-flex items-center rounded-md font-medium",
          "text-red-600 dark:text-red-400",
          "hover:text-red-700 dark:hover:text-red-300",
          "hover:bg-red-100 dark:hover:bg-red-900/30",
          "transition-colors",
          isMobile ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"
        )}
      >
        <X className={cn(isMobile ? "h-3.5 w-3.5" : "mr-1 h-4 w-4")} />
        {!isMobile && "Reject All"}
      </motion.button>

      <motion.button
        type="button"
        onClick={onAcceptAll}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 20 }}
        className={cn(
          "inline-flex items-center rounded-md font-medium text-white",
          "bg-green-600 hover:bg-green-700",
          "dark:bg-green-700 dark:hover:bg-green-600",
          "transition-colors",
          isMobile ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"
        )}
      >
        <Check className={cn(isMobile ? "h-3.5 w-3.5" : "mr-1 h-4 w-4")} />
        {!isMobile && "Accept All"}
      </motion.button>
    </motion.div>
  );
}
