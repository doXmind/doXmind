"use client";

import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-device-type";

interface AIWorkingBarProps {
  isActive: boolean;
}

export function AIWorkingBar({ isActive }: AIWorkingBarProps) {
  const isMobile = useIsMobile();

  return (
    <AnimatePresence>
      {isActive && (
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
          <div className={cn("flex items-center gap-2", isMobile ? "text-xs" : "text-sm")}>
            <div className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
            </div>
            <span className="font-medium text-foreground/80">
              {isMobile ? "AI editing..." : "AI is editing — editor is read-only"}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
