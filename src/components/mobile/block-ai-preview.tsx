"use client";

/**
 * Block AI Preview Component
 *
 * Full-screen preview for AI-generated edits.
 * Shows original vs proposed content with accept/reject options.
 */

import { useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Check, RotateCcw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useBlockSelectionStore } from "@/stores/block-selection-store";
import { haptics } from "@/lib/haptics";
import { Z_INDEX, MOBILE_SPRINGS } from "@/lib/constants";

interface BlockAIPreviewProps {
  /** Whether the preview is visible */
  isOpen: boolean;
  /** Callback to accept the edit */
  onAccept: () => void;
  /** Callback to reject the edit */
  onReject: () => void;
  /** Callback to retry with a different prompt */
  onRetry?: () => void;
  /** Whether AI is currently generating */
  isStreaming?: boolean;
}

export function BlockAIPreview({
  isOpen,
  onAccept,
  onReject,
  onRetry,
  isStreaming = false,
}: BlockAIPreviewProps) {
  const { editPreview, selectedBlocks } = useBlockSelectionStore();

  const handleAccept = useCallback(() => {
    haptics.success();
    onAccept();
  }, [onAccept]);

  const handleReject = useCallback(() => {
    haptics.medium();
    onReject();
  }, [onReject]);

  const handleRetry = useCallback(() => {
    haptics.light();
    onRetry?.();
  }, [onRetry]);

  if (!editPreview && !isStreaming) return null;

  const originalText = editPreview?.originalText || selectedBlocks.map((b) => b.text).join("\n\n");

  const proposedContent = editPreview?.proposedContent || "";
  const proposedHtml = editPreview?.proposedHtml || "";
  const voiceInstruction = editPreview?.voiceInstruction;
  const actionType = editPreview?.actionType;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className={cn("fixed inset-0 md:hidden", "flex flex-col bg-background")}
          style={{ zIndex: Z_INDEX.MODAL }}
          initial={{ opacity: 0, y: "100%" }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: "100%" }}
          transition={{ type: "spring", ...MOBILE_SPRINGS.SMOOTH }}
        >
          {/* Header */}
          <div className="safe-area-top flex items-center justify-between border-b px-4 py-3">
            <div>
              <h2 className="text-lg font-semibold">Review Changes</h2>
              {actionType && (
                <p className="text-xs capitalize text-muted-foreground">
                  Action: {actionType.replace("-", " ")}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={handleReject}
              className="rounded-full p-2 hover:bg-accent"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Voice instruction if present */}
          {voiceInstruction && (
            <div className="border-b bg-muted/30 px-4 py-2">
              <p className="text-xs text-muted-foreground">Your instruction:</p>
              <p className="mt-1 text-sm">&ldquo;{voiceInstruction}&rdquo;</p>
            </div>
          )}

          {/* Diff View */}
          <ScrollArea className="flex-1">
            <div className="space-y-4 p-4">
              {/* Original */}
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-destructive" />
                  <span className="text-sm font-medium text-muted-foreground">Original</span>
                </div>
                <div className="preview-original">
                  <div className="preview-original-text prose prose-sm max-w-none dark:prose-invert">
                    {originalText}
                  </div>
                </div>
              </div>

              {/* Arrow indicator */}
              <div className="flex justify-center py-2">
                <div className="h-6 w-0.5 bg-border" />
              </div>

              {/* Proposed */}
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-primary" />
                  <span className="text-sm font-medium text-muted-foreground">Proposed</span>
                  {isStreaming && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                </div>
                <div className="preview-proposed">
                  {proposedHtml ? (
                    <div
                      className="prose prose-sm max-w-none dark:prose-invert"
                      dangerouslySetInnerHTML={{ __html: proposedHtml }}
                    />
                  ) : proposedContent ? (
                    <div className="prose prose-sm max-w-none whitespace-pre-wrap dark:prose-invert">
                      {proposedContent}
                    </div>
                  ) : isStreaming ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">Generating...</span>
                    </div>
                  ) : (
                    <p className="text-sm italic text-muted-foreground">No changes proposed</p>
                  )}
                </div>
              </div>
            </div>
          </ScrollArea>

          {/* Action Buttons */}
          <div className={cn("flex items-center gap-3 border-t p-4", "safe-area-bottom")}>
            {onRetry && (
              <Button
                variant="outline"
                onClick={handleRetry}
                disabled={isStreaming}
                className="flex-1"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Retry
              </Button>
            )}
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={isStreaming}
              className="flex-1"
            >
              <X className="mr-2 h-4 w-4" />
              Reject
            </Button>
            <Button
              onClick={handleAccept}
              disabled={isStreaming || !proposedContent}
              className="flex-1"
            >
              <Check className="mr-2 h-4 w-4" />
              Accept
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Simplified inline preview for quick actions
 */
interface QuickPreviewProps {
  originalText: string;
  proposedText: string;
  isStreaming?: boolean;
  onAccept: () => void;
  onReject: () => void;
}

export function QuickPreview({
  originalText,
  proposedText,
  isStreaming,
  onAccept,
  onReject,
}: QuickPreviewProps) {
  return (
    <motion.div
      className="space-y-3 rounded-lg border bg-background p-4 shadow-lg"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
    >
      {/* Original - compact */}
      <div className="text-xs">
        <span className="text-muted-foreground">Original: </span>
        <span className="line-through opacity-60">
          {originalText.length > 100 ? originalText.slice(0, 100) + "..." : originalText}
        </span>
      </div>

      {/* Proposed */}
      <div className="text-sm">
        {isStreaming ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Generating...
          </span>
        ) : (
          proposedText
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            haptics.light();
            onReject();
          }}
          disabled={isStreaming}
        >
          <X className="mr-1 h-3 w-3" />
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => {
            haptics.success();
            onAccept();
          }}
          disabled={isStreaming || !proposedText}
        >
          <Check className="mr-1 h-3 w-3" />
          Apply
        </Button>
      </div>
    </motion.div>
  );
}
