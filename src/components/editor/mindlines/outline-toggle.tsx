"use client";

import { ChevronRight } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useLayoutStore } from "@/stores/layout-store";
import { cn } from "@/lib/utils";
import { ANIMATION_DURATION } from "@/lib/constants";

// Easing function for smooth animations (consistent with mindlines.tsx)
const EASE_OUT_QUART = [0.4, 0, 0.2, 1] as const;

interface OutlineToggleProps {
  headingsCount?: number;
}

/**
 * A toggle button that appears on the left edge of the editor
 * when the Outline panel is closed. Features animated entry/exit
 * and a badge showing the number of headings in the document.
 */
export function OutlineToggle({ headingsCount = 0 }: OutlineToggleProps) {
  const { isMindlinesOpen, setMindlinesOpen } = useLayoutStore();
  const shouldReduceMotion = useReducedMotion();

  // Only show when outline is closed
  if (isMindlinesOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={shouldReduceMotion ? false : { x: -40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={shouldReduceMotion ? undefined : { x: -40, opacity: 0 }}
        transition={
          shouldReduceMotion
            ? { duration: 0 }
            : {
                duration: ANIMATION_DURATION.NORMAL / 1000,
                ease: EASE_OUT_QUART,
              }
        }
        className={cn(
          "shrink-0 flex flex-col items-center py-2 px-1.5",
          "border-r border-border/40",
          "bg-gradient-to-b from-muted/30 to-muted/10",
          "backdrop-blur-sm"
        )}
      >
        <Tooltip content="Open Outline (Ctrl+Shift+O)" side="right">
          <motion.div
            whileHover={
              shouldReduceMotion
                ? {}
                : {
                    scale: 1.05,
                  }
            }
            whileTap={shouldReduceMotion ? {} : { scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
          >
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMindlinesOpen(true)}
              aria-label={`Open document outline${headingsCount > 0 ? `. ${headingsCount} headings.` : ""}`}
              className="h-9 w-9 relative text-muted-foreground hover:text-foreground"
            >
              {/* Icon with subtle breathing animation */}
              <motion.div
                animate={
                  shouldReduceMotion
                    ? {}
                    : {
                        x: [0, 2, 0],
                        opacity: [0.7, 1, 0.7],
                      }
                }
                transition={{
                  duration: 2.5,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              >
                <ChevronRight className="h-4 w-4" />
              </motion.div>

              {/* Badge showing headings count */}
              {headingsCount > 0 && (
                <motion.span
                  initial={shouldReduceMotion ? false : { scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 15 }}
                  className={cn(
                    "absolute -top-0.5 -right-0.5",
                    "h-4 min-w-[16px] px-1",
                    "flex items-center justify-center",
                    "text-[10px] font-semibold",
                    "bg-primary text-primary-foreground",
                    "rounded-full"
                  )}
                >
                  {headingsCount > 9 ? "9+" : headingsCount}
                </motion.span>
              )}
            </Button>
          </motion.div>
        </Tooltip>
      </motion.div>
    </AnimatePresence>
  );
}
