"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Circle, ChevronDown, ChevronUp, X, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOnboardingStore, type ChecklistItemKey } from "@/stores/onboarding-store";

interface ChecklistItem {
  key: ChecklistItemKey;
  label: string;
  hint: string;
}

const CHECKLIST_ITEMS: ChecklistItem[] = [
  {
    key: "createdDocument",
    label: "Create a document",
    hint: "Click + in the sidebar or use a template",
  },
  {
    key: "triedAutocomplete",
    label: "Try AI autocomplete",
    hint: "Pause while typing — press Tab to accept",
  },
  {
    key: "triedQuickEdit",
    label: "Try Quick Edit",
    hint: "Select text to see AI actions",
  },
  {
    key: "triedSlashCommand",
    label: "Use a slash command",
    hint: "Type / in the editor",
  },
  {
    key: "triedAIChat",
    label: "Chat with AI",
    hint: "Open the chat panel and send a message",
  },
  {
    key: "triedExport",
    label: "Export a document",
    hint: "Click the download icon in the top-right header",
  },
];

export function GettingStartedChecklist() {
  const {
    tourCompleted,
    checklist,
    isChecklistVisible,
    dismissChecklist,
    getChecklistProgress,
    isChecklistComplete,
  } = useOnboardingStore();

  const [isExpanded, setIsExpanded] = useState(false);

  // Don't show if tour not completed, checklist dismissed, or all items done
  if (!tourCompleted || !isChecklistVisible) return null;

  const progress = getChecklistProgress();
  const total = CHECKLIST_ITEMS.length;
  const complete = isChecklistComplete();

  // Auto-hide after all items completed (show celebration briefly)
  if (complete) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="border-t border-border p-3"
      >
        <div className="flex items-center gap-2 rounded-lg bg-primary/5 p-3">
          <Sparkles className="h-4 w-4 text-primary" />
          <div className="flex-1">
            <p className="text-sm font-medium">All done!</p>
            <p className="text-xs text-muted-foreground">
              You&apos;ve explored all the key features.
            </p>
          </div>
          <button
            onClick={dismissChecklist}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="border-t border-border">
      {/* Collapsed: progress pill */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50"
      >
        {/* Circular progress ring */}
        <div className="relative h-5 w-5 flex-shrink-0">
          <svg className="h-5 w-5 -rotate-90" viewBox="0 0 20 20">
            <circle
              cx="10"
              cy="10"
              r="8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-muted/30"
            />
            <circle
              cx="10"
              cy="10"
              r="8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray={`${(progress / total) * 50.26} 50.26`}
              strokeLinecap="round"
              className="text-primary transition-all duration-500"
            />
          </svg>
        </div>
        <span className="flex-1 text-xs font-medium text-muted-foreground">
          Getting Started{" "}
          <span className="text-foreground">
            {progress}/{total}
          </span>
        </span>
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {/* Expanded: checklist */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-0.5 px-3 pb-2">
              {CHECKLIST_ITEMS.map((item) => {
                const isDone = checklist[item.key];
                return (
                  <div
                    key={item.key}
                    className={cn(
                      "flex items-start gap-2 rounded-md px-2 py-1.5",
                      isDone && "opacity-60"
                    )}
                  >
                    {isDone ? (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-primary" />
                    ) : (
                      <Circle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/40" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-xs font-medium", isDone && "line-through")}>
                        {item.label}
                      </p>
                      {!isDone && <p className="text-[11px] text-muted-foreground">{item.hint}</p>}
                    </div>
                  </div>
                );
              })}

              {/* Dismiss link */}
              <button
                onClick={dismissChecklist}
                className="mt-1 w-full text-center text-[11px] text-muted-foreground/50 hover:text-muted-foreground"
              >
                Dismiss
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
