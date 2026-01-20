"use client";

/**
 * Mobile Bottom Bar Component
 *
 * Always-visible bottom bar with AI input that replaces the navigation bar.
 * Includes quick actions when text is selected.
 */

import { useCallback, useMemo } from "react";
import { Wand2, Scissors, Maximize2, Check, Languages } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { FloatingAIInput } from "./floating-ai-input";
import { useLayoutStore } from "@/stores/layout-store";
import { useFileStore } from "@/stores/file-store";
import { useChat } from "@/hooks/use-chat";
import { haptics } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { Z_INDEX, MOBILE_SPRINGS } from "@/lib/constants";

// Quick action button component
function QuickActionButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-2",
        "bg-accent/80 text-sm font-medium text-accent-foreground",
        "border border-border/50",
        "transition-transform active:scale-95",
        "whitespace-nowrap"
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

interface MobileBottomBarProps {
  onViewChat: () => void;
}

export function MobileBottomBar({ onViewChat }: MobileBottomBarProps) {
  const { pendingSelectionForAI, clearPendingSelectionForAI } = useLayoutStore();
  const { currentFileId } = useFileStore();
  const { sendMessage, isStreaming } = useChat();

  const hasSelection = Boolean(pendingSelectionForAI?.trim());

  // Handle quick AI actions on selected text
  const handleQuickAction = useCallback(
    (action: string) => {
      if (!pendingSelectionForAI || isStreaming) return;

      haptics.medium();
      const prompts: Record<string, string> = {
        improve: `Please improve the following text, making it clearer and more professional:\n\n"${pendingSelectionForAI}"`,
        shorten: `Please shorten the following text while keeping the main points:\n\n"${pendingSelectionForAI}"`,
        expand: `Please expand on the following text with more details:\n\n"${pendingSelectionForAI}"`,
        fix: `Please fix any grammar, spelling, or punctuation errors in the following text:\n\n"${pendingSelectionForAI}"`,
        translate: `Please translate the following text to English (or Chinese if it's already in English):\n\n"${pendingSelectionForAI}"`,
      };

      const prompt = prompts[action];
      if (prompt) {
        sendMessage(prompt, currentFileId ? [currentFileId] : [], null);
        clearPendingSelectionForAI();
      }
    },
    [pendingSelectionForAI, currentFileId, isStreaming, sendMessage, clearPendingSelectionForAI]
  );

  const quickActions = useMemo(
    () => [
      { icon: <Wand2 className="h-4 w-4" />, label: "Improve", action: "improve" },
      { icon: <Scissors className="h-4 w-4" />, label: "Shorten", action: "shorten" },
      { icon: <Maximize2 className="h-4 w-4" />, label: "Expand", action: "expand" },
      { icon: <Check className="h-4 w-4" />, label: "Fix", action: "fix" },
      { icon: <Languages className="h-4 w-4" />, label: "Translate", action: "translate" },
    ],
    []
  );

  return (
    <div
      data-action-bar
      className={cn(
        "fixed inset-x-0 bottom-0 md:hidden",
        "pointer-events-none" // Allow clicks through to content below
      )}
      style={{ zIndex: Z_INDEX.MOBILE_PANEL }}
    >
      <div className="pointer-events-auto mx-auto max-w-xl">
        <div
          className={cn(
            "bg-background/95 backdrop-blur-xl",
            "border-t border-border/50",
            "shadow-[0_-4px_20px_rgba(0,0,0,0.08)]",
            "rounded-t-2xl",
            "p-4"
          )}
          style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
        >
          {/* Quick Actions Row - shown when text is selected */}
          <AnimatePresence>
            {hasSelection && !isStreaming && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: "auto", marginBottom: 12 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={{ type: "spring", ...MOBILE_SPRINGS.SNAPPY }}
                className="overflow-hidden"
              >
                {/* Selection preview */}
                <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="truncate">
                    &quot;{pendingSelectionForAI?.slice(0, 30)}
                    {pendingSelectionForAI && pendingSelectionForAI.length > 30 ? "..." : ""}
                    &quot;
                  </span>
                </div>

                {/* Quick action buttons */}
                <div className="hide-scrollbar flex items-center gap-2 overflow-x-auto pb-1">
                  {quickActions.map((action) => (
                    <QuickActionButton
                      key={action.action}
                      icon={action.icon}
                      label={action.label}
                      onClick={() => handleQuickAction(action.action)}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* AI Input */}
          <FloatingAIInput onViewChat={onViewChat} />
        </div>
      </div>
    </div>
  );
}
