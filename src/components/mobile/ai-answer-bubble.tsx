"use client";

/**
 * AI Answer Bubble Component
 *
 * Floating bubble from top that shows AI responses for non-edit operations.
 * Features typewriter animation, loading state, and copy functionality.
 */

import { useState, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { X, Sparkles, Copy, Check, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { marked } from "marked";
import { Button } from "@/components/ui/button";
import { haptics } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { Z_INDEX, MOBILE_SPRINGS } from "@/lib/constants";

interface AIAnswerBubbleProps {
  /** The response content to display */
  response: string;
  /** Whether the bubble is visible */
  isVisible: boolean;
  /** Whether AI is currently loading/thinking */
  isLoading: boolean;
  /** Callback when close button is pressed */
  onClose: () => void;
  /** Callback when "View Chat" is pressed */
  onViewChat?: () => void;
  /** User's question to display for context */
  userQuestion?: string;
  /** Selected text context */
  selectedContext?: string;
}

export function AIAnswerBubble({
  response,
  isVisible,
  isLoading,
  onClose,
  onViewChat,
  userQuestion,
  selectedContext,
}: AIAnswerBubbleProps) {
  const t = useTranslations("mobile");
  const [copied, setCopied] = useState(false);

  // Parse markdown content
  const htmlContent = useMemo(() => {
    if (!response) return "";
    return marked.parse(response, { async: false }) as string;
  }, [response]);

  const handleCopy = useCallback(async () => {
    if (!response) return;
    try {
      await navigator.clipboard.writeText(response);
      haptics.light();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text:", err);
    }
  }, [response]);

  const handleClose = useCallback(() => {
    haptics.light();
    onClose();
  }, [onClose]);

  const handleViewChat = useCallback(() => {
    haptics.light();
    onViewChat?.();
  }, [onViewChat]);

  // Show bubble when loading or has visible response
  const show = isVisible || isLoading;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-x-4 md:hidden"
          style={{
            zIndex: Z_INDEX.MOBILE_PANEL + 5,
            top: "calc(env(safe-area-inset-top) + 60px)",
          }}
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ type: "spring", ...MOBILE_SPRINGS.SMOOTH }}
        >
          <div className="mx-auto max-w-xl">
            <div
              className={cn(
                "overflow-hidden rounded-2xl",
                "bg-background/95 backdrop-blur-2xl",
                "border border-border/50",
                "shadow-[0_8px_40px_rgba(0,0,0,0.12)]",
                "ring-1 ring-black/5",
                isLoading && "border-primary/30"
              )}
            >
              {/* Header */}
              <div
                className={cn(
                  "flex items-center justify-between px-4 py-3",
                  "border-b border-border/30",
                  "bg-gradient-to-r from-primary/5 to-primary/10"
                )}
              >
                <div className="flex items-center gap-2 text-primary">
                  <Sparkles
                    className={cn("h-4 w-4", isLoading && "animate-spin")}
                    style={{ animationDuration: "2s" }}
                  />
                  <span className="text-xs font-bold uppercase tracking-wider">
                    {t("aiInsight")}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {!isLoading && response && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleCopy}
                      className="h-8 w-8 rounded-full"
                      aria-label={t("copyResponse")}
                    >
                      {copied ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleClose}
                    className="h-8 w-8 rounded-full"
                    aria-label={t("close")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* User Question Context */}
              {(userQuestion || selectedContext) && (
                <div className="border-b border-border/30 bg-muted/30 px-4 py-2.5">
                  {userQuestion && (
                    <p className="line-clamp-3 text-xs text-muted-foreground">
                      <span className="font-medium">{t("questionLabel")}</span> {userQuestion}
                    </p>
                  )}
                  {selectedContext && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground/70">
                      <span className="font-medium">{t("contextLabel")}</span> &quot;
                      {selectedContext.slice(0, 120)}
                      {selectedContext.length > 120 ? "..." : ""}&quot;
                    </p>
                  )}
                </div>
              )}

              {/* Content */}
              <div className="max-h-[65vh] min-h-[60px] overflow-y-auto p-4">
                {isLoading && !response ? (
                  <div className="flex flex-col gap-2">
                    {/* Thinking dots */}
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span
                        className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary"
                        style={{ animationDelay: "0ms" }}
                      />
                      <span
                        className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary"
                        style={{ animationDelay: "150ms" }}
                      />
                      <span
                        className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary"
                        style={{ animationDelay: "300ms" }}
                      />
                      <span className="ml-1 font-medium text-primary/80">{t("thinkingDots")}</span>
                    </div>
                    {/* Shimmer placeholders */}
                    <div className="mt-2 space-y-2 opacity-50">
                      <div className="h-2 w-3/4 animate-pulse rounded bg-muted" />
                      <div className="h-2 w-1/2 animate-pulse rounded bg-muted" />
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <div
                      className="prose prose-sm max-w-none text-foreground dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                      dangerouslySetInnerHTML={{ __html: htmlContent }}
                    />
                    {/* Streaming cursor indicator */}
                    {isLoading && response && (
                      <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-primary/60 align-middle" />
                    )}
                  </div>
                )}
              </div>

              {/* Footer - View Chat button */}
              {!isLoading && response && onViewChat && (
                <div className="border-t border-border/30 px-4 py-2.5">
                  <button
                    type="button"
                    onClick={handleViewChat}
                    className={cn(
                      "flex w-full items-center justify-center gap-1.5",
                      "rounded-lg bg-muted/50 py-2.5 text-sm font-medium text-muted-foreground",
                      "transition-colors hover:bg-muted hover:text-foreground",
                      "active:scale-[0.98]"
                    )}
                  >
                    <span>{t("viewFullChat")}</span>
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
