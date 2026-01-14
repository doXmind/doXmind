"use client";

import { motion } from "framer-motion";
import { Editor } from "@tiptap/react";
import { Eye, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

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
  if (!isActive || !editor) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className={cn(
        "flex items-center gap-3 px-4 py-2",
        "bg-amber-50 dark:bg-amber-950/30",
        "border-b border-amber-200 dark:border-amber-800"
      )}
    >
      {/* Status indicator with pulse */}
      <div className="flex items-center gap-2 text-sm">
        <div className="relative">
          <Eye className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <motion.span
            className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-amber-500 rounded-full"
            animate={{
              scale: [1, 1.2, 1],
              opacity: [1, 0.7, 1]
            }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
        <span className="font-medium text-amber-800 dark:text-amber-200">
          Review Mode
        </span>
        <motion.span
          key={pendingCount}
          initial={{ scale: 1.2 }}
          animate={{ scale: 1 }}
          className="text-amber-600 dark:text-amber-400"
        >
          {pendingCount} change{pendingCount !== 1 ? "s" : ""} pending
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
        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
        className={cn(
          "inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md",
          "text-red-600 dark:text-red-400",
          "hover:text-red-700 dark:hover:text-red-300",
          "hover:bg-red-100 dark:hover:bg-red-900/30",
          "transition-colors"
        )}
      >
        <X className="h-4 w-4 mr-1" />
        Reject All
      </motion.button>

      <motion.button
        type="button"
        onClick={onAcceptAll}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
        className={cn(
          "inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md text-white",
          "bg-green-600 hover:bg-green-700",
          "dark:bg-green-700 dark:hover:bg-green-600",
          "transition-colors"
        )}
      >
        <Check className="h-4 w-4 mr-1" />
        Accept All
      </motion.button>
    </motion.div>
  );
}
