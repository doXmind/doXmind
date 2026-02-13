"use client";

import { motion } from "framer-motion";
import { PenLine, Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TourCompleteModalProps {
  onFinish: () => void;
  onRestart: () => void;
}

const COMPLETED_FEATURES = [
  "Search & Ask AI",
  "KB Agent",
  "Autocomplete",
  "Slash Commands",
  "Quick Edit",
  "Diff Review",
  "Writing Review",
  "AI Chat",
  "Knowledge Base",
  "Mindlines",
  "Version History",
  "Focus Mode",
  "Export",
  "New Button",
  "Recent Files",
  "Favorites",
  "File Actions",
];

export function TourCompleteModal({ onFinish, onRestart }: TourCompleteModalProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="pointer-events-auto fixed inset-0 z-[65] flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      {/* Subtle celebration dots */}
      {[...Array(6)].map((_, i) => (
        <motion.div
          key={i}
          className="pointer-events-none absolute h-1.5 w-1.5 rounded-full"
          style={{
            backgroundColor: i % 2 === 0 ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
            left: `${30 + Math.random() * 40}%`,
            top: `${40 + Math.random() * 20}%`,
          }}
          initial={{ opacity: 0, y: 0, scale: 0 }}
          animate={{
            opacity: [0, 0.6, 0],
            y: [0, -60 - Math.random() * 40],
            scale: [0, 1, 0.5],
          }}
          transition={{
            duration: 1.5 + Math.random() * 0.5,
            delay: 0.3 + i * 0.15,
            ease: "easeOut",
          }}
        />
      ))}

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className={cn(
          "relative mx-4 w-full max-w-md",
          "rounded-2xl border border-border bg-popover shadow-2xl"
        )}
      >
        {/* Animated checkmark */}
        <div className="flex justify-center pt-8">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 15, delay: 0.2 }}
            className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10"
          >
            <motion.svg viewBox="0 0 24 24" className="h-7 w-7">
              <motion.circle
                cx="12"
                cy="12"
                r="10"
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="1.5"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.6, delay: 0.4, ease: "easeOut" }}
              />
              <motion.path
                d="M8 12l3 3 5-5"
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.4, delay: 0.8, ease: "easeOut" }}
              />
            </motion.svg>
          </motion.div>
        </div>

        {/* Content */}
        <div className="px-8 pb-2 pt-5 text-center">
          <h2 className="text-xl font-semibold tracking-tight">You&apos;re All Set!</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            You&apos;ve explored all {COMPLETED_FEATURES.length} key features. You&apos;re ready to
            create amazing content with AI by your side.
          </p>
        </div>

        {/* Feature summary grid */}
        <div className="mx-8 mt-4 rounded-xl bg-muted/30 p-4">
          <div className="grid grid-cols-3 gap-x-2 gap-y-2">
            {COMPLETED_FEATURES.map((feature, i) => (
              <motion.div
                key={feature}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 + i * 0.05 }}
                className="flex items-center gap-1.5"
              >
                <Check className="h-3 w-3 flex-shrink-0 text-primary" />
                <span className="truncate text-[11px] text-muted-foreground">{feature}</span>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 px-8 pb-8 pt-6">
          <Button onClick={onFinish} className="w-full gap-2">
            <PenLine className="h-4 w-4" />
            Start Writing
          </Button>
          <button
            onClick={onRestart}
            className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground/50 transition-colors hover:text-muted-foreground dark:text-muted-foreground/70"
          >
            <RotateCcw className="h-3 w-3" />
            Restart Tour
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
