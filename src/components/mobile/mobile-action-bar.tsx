"use client";

/**
 * Mobile Action Bar Component
 *
 * Fixed bottom action bar that appears when blocks are selected (via tap).
 * Provides actions: AI Voice, Copy, Cut, Delete.
 */

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Scissors, Trash2, Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBlockSelectionStore } from "@/stores/block-selection-store";
import { haptics } from "@/lib/haptics";
import { Z_INDEX, MOBILE_SPRINGS } from "@/lib/constants";

interface MobileActionBarProps {
  /** Callback when copy is requested */
  onCopy: () => void;
  /** Callback when cut is requested */
  onCut: () => void;
  /** Callback when delete is requested */
  onDelete: () => void;
  /** Callback when AI voice is requested */
  onAIVoice?: () => void;
}

export function MobileActionBar({ onCopy, onCut, onDelete, onAIVoice }: MobileActionBarProps) {
  const t = useTranslations("mobile");
  const tc = useTranslations("common");
  const tCom = useTranslations("community");
  const { selectedBlocks, isSelectionActive, clearSelection } = useBlockSelectionStore();
  const [copiedFeedback, setCopiedFeedback] = useState(false);

  const handleAIVoice = useCallback(() => {
    haptics.medium();
    onAIVoice?.();
  }, [onAIVoice]);

  const handleCopy = useCallback(() => {
    haptics.light();
    onCopy();
    setCopiedFeedback(true);
    setTimeout(() => setCopiedFeedback(false), 1500);
  }, [onCopy]);

  const handleCut = useCallback(() => {
    haptics.medium();
    onCut();
  }, [onCut]);

  const handleDelete = useCallback(() => {
    haptics.medium();
    onDelete();
  }, [onDelete]);

  const handleClear = useCallback(() => {
    haptics.light();
    clearSelection();
  }, [clearSelection]);

  const hasSelection = selectedBlocks.length > 0;

  return (
    <AnimatePresence>
      {isSelectionActive && (
        <motion.div
          data-action-bar
          className={cn(
            "fixed inset-x-0 bottom-0 md:hidden",
            "bg-background/95 backdrop-blur-xl",
            "border-t border-border/50",
            "pb-[env(safe-area-inset-bottom)]"
          )}
          style={{ zIndex: Z_INDEX.MOBILE_PANEL }}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", ...MOBILE_SPRINGS.SMOOTH }}
        >
          {/* Selection counter */}
          <div className="flex items-center justify-between border-b border-border/30 px-4 py-2">
            <span className="text-sm text-muted-foreground">
              {selectedBlocks.length > 1
                ? t("blocksSelectedPlural", { count: selectedBlocks.length })
                : t("blocksSelected", { count: selectedBlocks.length })}
            </span>
            <button
              type="button"
              onClick={handleClear}
              className="text-sm font-medium text-primary"
            >
              {tCom("clear")}
            </button>
          </div>

          {/* Action buttons - AI Voice, Copy, Cut, Delete */}
          <div className="flex items-center justify-center gap-6 px-4 py-3">
            {/* AI - Primary action */}
            <ActionButton
              icon={<Sparkles className="h-6 w-6" />}
              label="AI"
              onPress={handleAIVoice}
              disabled={!hasSelection}
              primary
            />

            {/* Copy */}
            <ActionButton
              icon={
                copiedFeedback ? (
                  <Check className="h-6 w-6 text-green-500" />
                ) : (
                  <Copy className="h-6 w-6" />
                )
              }
              label={copiedFeedback ? t("copied") : tc("copy")}
              onPress={handleCopy}
              disabled={!hasSelection}
            />

            {/* Cut */}
            <ActionButton
              icon={<Scissors className="h-6 w-6" />}
              label={tc("cut")}
              onPress={handleCut}
              disabled={!hasSelection}
            />

            {/* Delete */}
            <ActionButton
              icon={<Trash2 className="h-6 w-6" />}
              label={tc("delete")}
              onPress={handleDelete}
              disabled={!hasSelection}
              destructive
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Individual action button
 */
interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
  primary?: boolean;
}

function ActionButton({ icon, label, onPress, disabled, destructive, primary }: ActionButtonProps) {
  return (
    <motion.button
      type="button"
      onClick={onPress}
      disabled={disabled}
      whileTap={{ scale: 0.9 }}
      className={cn(
        "action-button",
        disabled && "pointer-events-none opacity-40",
        destructive && "text-destructive",
        primary && "text-primary"
      )}
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
    </motion.button>
  );
}
