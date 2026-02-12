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
  | "quick-edit-shown"
  | "diff-review-shown"
  | "text-review-shown"
  | "knowledge-base-used"
  | "focus-mode-entered";

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
    description:
      "Press Tab to accept the full suggestion, Ctrl+Space for word-by-word, or Escape to dismiss.",
    position: "top",
  },
  "slash-command-used": {
    id: "slash-command-used",
    title: "Slash Commands",
    description:
      "Browse all blocks — headings, tables, code, math, callouts, and more. Type / anywhere to open.",
    position: "bottom",
  },
  "search-opened": {
    id: "search-opened",
    title: "Smart Search",
    description:
      "Switch to the AI tab for semantic search that understands meaning, not just keywords.",
    position: "bottom",
  },
  "quick-edit-shown": {
    id: "quick-edit-shown",
    title: "Quick Edit",
    description:
      "Choose an action to apply instantly, or click Ask in Chat for custom instructions.",
    position: "top",
  },
  "diff-review-shown": {
    id: "diff-review-shown",
    title: "Review Changes",
    description:
      "Accept or reject each AI edit individually, or use Accept All / Reject All for the entire batch.",
    position: "top",
  },
  "text-review-shown": {
    id: "text-review-shown",
    title: "Writing Review",
    description:
      "Color-coded suggestions appear as underlines. Click any underlined text to see details and apply fixes.",
    position: "top",
  },
  "knowledge-base-used": {
    id: "knowledge-base-used",
    title: "Knowledge Base",
    description:
      "Upload PDFs and documents as references — AI will search and cite them when answering your questions.",
    position: "bottom",
  },
  "focus-mode-entered": {
    id: "focus-mode-entered",
    title: "Focus Mode",
    description:
      "Distraction-free writing. Press F11 again or hover the top of the screen to exit.",
    position: "bottom",
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
          "pointer-events-auto fixed z-[55] rounded-lg border border-border bg-popover px-3 py-2 shadow-md"
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

    // Skip during active onboarding (don't overlap with tour)
    try {
      const storeData = localStorage.getItem("doxmind-onboarding");
      if (storeData) {
        const parsed = JSON.parse(storeData);
        const state = parsed?.state;
        // If onboarding is active, suppress all hints
        if (state?.currentStepIndex >= 0 && !state?.onboardingCompleted) {
          return;
        }
        // If onboarding hasn't been completed yet, suppress hints too
        if (!state?.onboardingCompleted) return;
      }
    } catch {
      // Ignore parse errors
    }

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
