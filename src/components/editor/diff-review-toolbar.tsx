"use client";

import { motion } from "framer-motion";
import { Editor } from "@tiptap/react";
import { Check, X, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-device-type";

interface DiffReviewToolbarProps {
  editor: Editor | null;
  isActive: boolean;
  pendingCount: number;
  currentPendingPosition: number;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onNextHunk: () => void;
  onPreviousHunk: () => void;
}

export function DiffReviewToolbar({
  editor,
  isActive,
  pendingCount,
  currentPendingPosition,
  onAcceptAll,
  onRejectAll,
  onNextHunk,
  onPreviousHunk,
}: DiffReviewToolbarProps) {
  const isMobile = useIsMobile();

  if (!isActive || !editor) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={cn(
        "flex items-center border-b",
        "bg-[var(--diff-toolbar-bg)] backdrop-blur-xl",
        "border-[var(--diff-toolbar-border)]",
        "shadow-[var(--diff-toolbar-shadow)]",
        "gap-3 px-4 py-2",
        isMobile && "gap-2 px-3 py-1.5"
      )}
    >
      {/* Review indicator */}
      <div className={cn("flex items-center gap-2", isMobile ? "text-xs" : "text-sm")}>
        <div className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
        </div>
        <span className="font-medium text-foreground/80">
          {isMobile ? "Review" : "Reviewing Changes"}
        </span>
      </div>

      {/* Separator */}
      <div className="h-4 w-px bg-border/50" />

      {/* Navigation cluster */}
      <div className="flex items-center gap-0.5">
        <motion.button
          type="button"
          onClick={onPreviousHunk}
          disabled={pendingCount === 0}
          whileTap={{ scale: 0.9 }}
          className={cn(
            "rounded-md p-1 transition-colors",
            "hover:bg-accent disabled:opacity-40",
            isMobile && "p-0.5"
          )}
          aria-label="Previous change"
        >
          <ChevronUp className={cn(isMobile ? "h-3.5 w-3.5" : "h-4 w-4")} />
        </motion.button>

        <span
          className={cn(
            "min-w-[64px] text-center font-medium tabular-nums text-muted-foreground",
            isMobile ? "text-[10px]" : "text-xs"
          )}
        >
          {pendingCount > 0 ? `${currentPendingPosition} of ${pendingCount}` : "No changes"}
        </span>

        <motion.button
          type="button"
          onClick={onNextHunk}
          disabled={pendingCount === 0}
          whileTap={{ scale: 0.9 }}
          className={cn(
            "rounded-md p-1 transition-colors",
            "hover:bg-accent disabled:opacity-40",
            isMobile && "p-0.5"
          )}
          aria-label="Next change"
        >
          <ChevronDown className={cn(isMobile ? "h-3.5 w-3.5" : "h-4 w-4")} />
        </motion.button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Action buttons */}
      <motion.button
        type="button"
        onClick={onRejectAll}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        transition={{ type: "spring", stiffness: 400, damping: 20 }}
        className={cn(
          "inline-flex items-center rounded-lg font-medium transition-colors",
          "bg-[var(--diff-btn-reject-bg)] text-[var(--diff-btn-reject-fg)]",
          "hover:bg-[var(--diff-btn-reject-hover)]",
          isMobile ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"
        )}
      >
        <X className={cn(isMobile ? "h-3.5 w-3.5" : "mr-1 h-3.5 w-3.5")} />
        {!isMobile && "Reject All"}
      </motion.button>

      <motion.button
        type="button"
        onClick={onAcceptAll}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        transition={{ type: "spring", stiffness: 400, damping: 20 }}
        className={cn(
          "inline-flex items-center rounded-lg font-medium transition-colors",
          "bg-[var(--diff-btn-accept-bg)] text-[var(--diff-btn-accept-fg)]",
          "hover:bg-[var(--diff-btn-accept-hover)]",
          isMobile ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"
        )}
      >
        <Check className={cn(isMobile ? "h-3.5 w-3.5" : "mr-1 h-3.5 w-3.5")} />
        {!isMobile && "Accept All"}
      </motion.button>
    </motion.div>
  );
}
