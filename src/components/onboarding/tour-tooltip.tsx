"use client";

import { useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { ChevronRight, ChevronLeft, X, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OnboardingStep } from "@/stores/onboarding-store";

interface TourTooltipProps {
  step: OnboardingStep;
  stepIndex: number;
  totalSteps: number;
  position: { top: number; left: number };
  placement: "top" | "bottom" | "left" | "right" | "center";
  arrowOffset?: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function TourTooltip({
  step,
  stepIndex,
  totalSteps,
  position,
  placement,
  arrowOffset = 170,
  onNext,
  onBack,
  onSkip,
}: TourTooltipProps) {
  const t = useTranslations("onboarding");
  const tc = useTranslations("common");
  const isFirstStep = stepIndex <= 1; // hide back on welcome (0) and first real step (1)
  const isActionRequired = step.requiresAction;
  const progressPercent = Math.round((stepIndex / (totalSteps - 1)) * 100);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onSkip();
      } else if (e.key === "Enter" && !isActionRequired) {
        onNext();
      } else if (e.key === "ArrowRight" && !isActionRequired) {
        onNext();
      } else if (e.key === "ArrowLeft" && !isFirstStep) {
        onBack();
      }
    },
    [onSkip, onNext, onBack, isActionRequired, isFirstStep]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <motion.div
      key={step.id}
      initial={{ opacity: 0, scale: 0.95, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className={cn(
        "pointer-events-auto absolute z-[65] w-[340px]",
        "rounded-xl border border-border bg-popover shadow-lg"
      )}
      style={{ top: position.top, left: position.left }}
      role="dialog"
      aria-label={t(step.titleKey)}
    >
      {/* Directional arrow */}
      {placement !== "center" && (
        <div
          className={cn(
            "absolute h-2.5 w-2.5 rotate-45 border bg-popover",
            placement === "bottom" && "-top-[6px] border-l border-t border-border",
            placement === "top" && "-bottom-[6px] border-b border-r border-border",
            placement === "left" && "-right-[6px] border-r border-t border-border",
            placement === "right" && "-left-[6px] border-b border-l border-border"
          )}
          style={{
            ...(placement === "top" || placement === "bottom"
              ? { left: Math.min(Math.max(16, arrowOffset), 308) }
              : {}),
            ...(placement === "left" || placement === "right"
              ? { top: Math.min(Math.max(16, arrowOffset), 100) }
              : {}),
          }}
        />
      )}

      {/* Header: group label + close */}
      <div className="flex items-center justify-between px-4 pt-3.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-primary">
          {t(step.groupKey)}
        </span>
        <button
          onClick={onSkip}
          className="rounded-md p-0.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground dark:text-muted-foreground/70"
          aria-label={t("skipTutorial")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="px-4 pb-1 pt-1.5">
        <h3 className="text-sm font-semibold tracking-tight">{t(step.titleKey)}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t(step.instructionKey)}
        </p>
      </div>

      {/* Progress bar */}
      <div className="mx-4 mt-3">
        <div className="h-0.5 w-full overflow-hidden rounded-full bg-muted/40">
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={{ width: "0%" }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* Footer: step counter + buttons */}
      <div className="flex items-center justify-between px-4 pb-3.5 pt-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground/60 dark:text-muted-foreground/80">
            {stepIndex + 1} / {totalSteps}
          </span>
          {isActionRequired && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground/50 dark:text-muted-foreground/70">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("tryIt")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {!isFirstStep && (
            <Button variant="ghost" size="sm" onClick={onBack} className="h-7 px-2 text-xs">
              <ChevronLeft className="mr-0.5 h-3.5 w-3.5" />
              {tc("back")}
            </Button>
          )}
          {isActionRequired && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onNext}
              className="h-7 px-2 text-[11px] text-muted-foreground"
            >
              {t("skipStep")}
            </Button>
          )}
          {!isActionRequired && (
            <Button size="sm" onClick={onNext} className="h-7 px-3 text-xs">
              {tc("next")}
              <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
