"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const HINTS_STORAGE_KEY = "doxmind-feature-hints";

export type FeatureHintId =
  | "autocomplete-shown"
  | "slash-command-used"
  | "search-opened"
  | "quick-edit-shown";

interface FeatureHint {
  id: FeatureHintId;
  title: string;
  description: string;
  position?: "top" | "bottom";
}

const FEATURE_HINTS: Record<FeatureHintId, FeatureHint> = {
  "autocomplete-shown": {
    id: "autocomplete-shown",
    title: "AI Autocomplete",
    description: "Press Tab to accept the suggestion, or Escape to dismiss it.",
    position: "top",
  },
  "slash-command-used": {
    id: "slash-command-used",
    title: "Slash Commands",
    description: "Type / to see all available blocks: headings, lists, code, tables, and more.",
    position: "bottom",
  },
  "search-opened": {
    id: "search-opened",
    title: "Smart Search",
    description: "Use the AI tab for semantic search that understands meaning, not just keywords.",
    position: "bottom",
  },
  "quick-edit-shown": {
    id: "quick-edit-shown",
    title: "Quick Edit",
    description: "Select text and use the AI actions to improve, simplify, expand, or translate.",
    position: "top",
  },
};

function getSeenHints(): Set<FeatureHintId> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored = localStorage.getItem(HINTS_STORAGE_KEY);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

function markHintSeen(id: FeatureHintId) {
  const seen = getSeenHints();
  seen.add(id);
  localStorage.setItem(HINTS_STORAGE_KEY, JSON.stringify([...seen]));
}

interface FeatureHintTooltipProps {
  hint: FeatureHint;
  anchorRect: DOMRect;
  onDismiss: () => void;
}

function FeatureHintTooltip({ hint, anchorRect, onDismiss }: FeatureHintTooltipProps) {
  const position = hint.position ?? "bottom";
  const tooltipWidth = 260;

  let top: number;
  let left = anchorRect.left + anchorRect.width / 2 - tooltipWidth / 2;

  if (position === "top") {
    top = anchorRect.top - 80;
  } else {
    top = anchorRect.bottom + 8;
  }

  // Keep in viewport
  left = Math.max(8, Math.min(left, window.innerWidth - tooltipWidth - 8));
  top = Math.max(8, top);

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: position === "top" ? 8 : -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: position === "top" ? 8 : -8 }}
        className={cn(
          "pointer-events-auto fixed z-[55] rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 shadow-lg backdrop-blur-sm"
        )}
        style={{ top, left, width: tooltipWidth }}
      >
        <button
          onClick={onDismiss}
          className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
        <p className="text-xs font-medium text-primary">{hint.title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
          {hint.description}
        </p>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

/**
 * Hook to show contextual feature hints on first use.
 * Call `showHint(id, anchorElement)` when a feature is first triggered.
 */
export function useFeatureHints() {
  const [activeHint, setActiveHint] = useState<{
    hint: FeatureHint;
    rect: DOMRect;
  } | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showHint = useCallback((id: FeatureHintId, anchor?: HTMLElement | null) => {
    // Skip if already seen
    if (getSeenHints().has(id)) return;

    // Skip if onboarding hasn't been completed (don't overlap with tour)
    const onboardingDone = localStorage.getItem("doxmind-onboarding-completed");
    if (!onboardingDone) return;

    const hint = FEATURE_HINTS[id];
    if (!hint) return;

    const rect =
      anchor?.getBoundingClientRect() ??
      new DOMRect(window.innerWidth / 2 - 100, window.innerHeight / 2, 200, 20);

    markHintSeen(id);
    setActiveHint({ hint, rect });

    // Auto-dismiss after 6 seconds
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => {
      setActiveHint(null);
    }, 6000);
  }, []);

  const dismissHint = useCallback(() => {
    setActiveHint(null);
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
  }, []);

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  const HintPortal = activeHint ? (
    <FeatureHintTooltip
      hint={activeHint.hint}
      anchorRect={activeHint.rect}
      onDismiss={dismissHint}
    />
  ) : null;

  return { showHint, dismissHint, HintPortal };
}
