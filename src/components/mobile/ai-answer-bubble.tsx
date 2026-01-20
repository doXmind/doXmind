"use client";

/**
 * AI Answer Bubble Component
 *
 * Floating bubble from top that shows AI responses for non-edit operations.
 * Features typewriter animation, loading state, and copy functionality.
 */

import { useState, useCallback, useMemo } from "react";
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
                "ring-1 ring-black/5"
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
                  <span className="text-xs font-bold uppercase tracking-wider">AI Insight</span>
                </div>
                <div className="flex items-center gap-1">
                  {!isLoading && response && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleCopy}
                      className="h-8 w-8 rounded-full"
                      aria-label="Copy response"
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
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* User Question Context */}
              {(userQuestion || selectedContext) && (
                <div className="border-b border-border/30 px-4 py-2 bg-muted/30">
                  {userQuestion && (
                    <p className="text-xs text-muted-foreground truncate">
                      <span className="font-medium">Q:</span> {userQuestion}
                    </p>
                  )}
                  {selectedContext && (
                    <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
                      <span className="font-medium">Context:</span> &quot;{selectedContext.slice(0, 50)}{selectedContext.length > 50 ? "..." : ""}&quot;
                    </p>
                  )}
                </div>
              )}

              {/* Content */}
              <div className="max-h-[300px] min-h-[60px] overflow-y-auto p-4">
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
                      <span className="ml-1 font-medium text-primary/80">Thinking...</span>
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
                      className="prose prose-sm max-w-none dark:prose-invert text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                      dangerouslySetInnerHTML={{ __html: htmlContent }}
                    />
                    {/* Streaming cursor indicator */}
                    {isLoading && response && (
                      <span className="inline-block w-2 h-4 bg-primary/60 animate-pulse ml-0.5 align-middle" />
                    )}
                  </div>
                )}
              </div>

              {/* Footer - View Chat button */}
              {!isLoading && response && onViewChat && (
                <div className="border-t border-border/30 px-4 py-2">
                  <button
                    type="button"
                    onClick={handleViewChat}
                    className={cn(
                      "flex w-full items-center justify-center gap-1",
                      "py-1 text-xs font-medium text-muted-foreground",
                      "transition-colors hover:text-foreground"
                    )}
                  >
                    <span>View full chat</span>
                    <ChevronDown className="h-3 w-3" />
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
