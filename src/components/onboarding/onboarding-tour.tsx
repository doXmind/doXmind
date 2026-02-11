"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronRight, Check, FileText, MessageSquare, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useOnboardingStore } from "@/stores/onboarding-store";

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  targetSelector: string;
  position: "top" | "bottom" | "left" | "right";
  spotlight?: boolean;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "editor",
    title: "Your Writing Space",
    description:
      "This is where you write. The welcome document has interactive examples — try AI autocomplete, quick edit, and slash commands right inside it.",
    icon: <FileText className="h-5 w-5" />,
    targetSelector: ".ProseMirror",
    position: "top",
    spotlight: true,
  },
  {
    id: "ai-chat",
    title: "AI Assistant",
    description:
      "Your AI writing partner lives here. Ask it to improve your writing, summarize, translate, or brainstorm ideas.",
    icon: <MessageSquare className="h-5 w-5" />,
    targetSelector: '[aria-label="Show AI Chat"], [aria-label="Hide AI Chat"]',
    position: "left",
    spotlight: true,
  },
  {
    id: "sidebar",
    title: "Your Documents",
    description:
      "All your files are here. Create new documents, organize in folders, search with Ctrl+K, or import existing files.",
    icon: <PanelLeft className="h-5 w-5" />,
    targetSelector: '[aria-label="Create New File"]',
    position: "bottom",
    spotlight: true,
  },
];

interface OnboardingTourProps {
  onComplete?: () => void;
}

export function OnboardingTour({ onComplete }: OnboardingTourProps) {
  const [mounted, setMounted] = React.useState(false);
  const [isOpen, setIsOpen] = React.useState(false);
  const [currentStep, setCurrentStep] = React.useState(0);
  const [targetRect, setTargetRect] = React.useState<DOMRect | null>(null);
  const [tooltipPosition, setTooltipPosition] = React.useState({ top: 0, left: 0 });

  const { tourCompleted, setTourCompleted } = useOnboardingStore();

  const step = ONBOARDING_STEPS[currentStep];
  const isLastStep = currentStep === ONBOARDING_STEPS.length - 1;

  // Check if onboarding was completed
  React.useEffect(() => {
    setMounted(true);
    if (!tourCompleted) {
      const timer = setTimeout(() => setIsOpen(true), 800);
      return () => clearTimeout(timer);
    }
  }, [tourCompleted]);

  // Find and highlight target element
  React.useEffect(() => {
    if (!isOpen || !step) return;

    const findTarget = () => {
      const selectors = step.targetSelector.split(",").map((s) => s.trim());
      let target: Element | null = null;

      for (const selector of selectors) {
        target = document.querySelector(selector);
        if (target) break;
      }

      if (target) {
        const rect = target.getBoundingClientRect();
        setTargetRect(rect);

        const padding = 16;
        const tooltipWidth = 320;
        const tooltipHeight = 180;
        let top = 0;
        let left = 0;

        switch (step.position) {
          case "top":
            top = rect.top - tooltipHeight - padding;
            left = rect.left + rect.width / 2 - tooltipWidth / 2;
            break;
          case "bottom":
            top = rect.bottom + padding;
            left = rect.left + rect.width / 2 - tooltipWidth / 2;
            break;
          case "left":
            top = rect.top + rect.height / 2 - tooltipHeight / 2;
            left = rect.left - tooltipWidth - padding;
            break;
          case "right":
            top = rect.top + rect.height / 2 - tooltipHeight / 2;
            left = rect.right + padding;
            break;
        }

        const viewportPadding = 16;
        top = Math.max(
          viewportPadding,
          Math.min(top, window.innerHeight - tooltipHeight - viewportPadding)
        );
        left = Math.max(
          viewportPadding,
          Math.min(left, window.innerWidth - tooltipWidth - viewportPadding)
        );

        setTooltipPosition({ top, left });
      } else {
        setTargetRect(null);
      }
    };

    findTarget();

    window.addEventListener("resize", findTarget);
    return () => window.removeEventListener("resize", findTarget);
  }, [isOpen, currentStep, step]);

  const handleNext = () => {
    if (currentStep < ONBOARDING_STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleComplete();
    }
  };

  const handleComplete = () => {
    setTourCompleted();
    setIsOpen(false);
    onComplete?.();
  };

  const handleSkip = () => {
    setTourCompleted();
    setIsOpen(false);
    onComplete?.();
  };

  if (!mounted || !isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <div className="pointer-events-none fixed inset-0 z-[60]">
        {/* Backdrop with cutout for spotlight */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-auto absolute inset-0"
          onClick={handleSkip}
        >
          <svg className="h-full w-full">
            <defs>
              <mask id="spotlight-mask">
                <rect x="0" y="0" width="100%" height="100%" fill="white" />
                {targetRect && step?.spotlight && (
                  <motion.rect
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    x={targetRect.left - 8}
                    y={targetRect.top - 8}
                    width={targetRect.width + 16}
                    height={targetRect.height + 16}
                    rx="8"
                    fill="black"
                  />
                )}
              </mask>
            </defs>
            <rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              fill="rgba(0, 0, 0, 0.6)"
              mask="url(#spotlight-mask)"
            />
          </svg>
        </motion.div>

        {/* Spotlight ring around target */}
        {targetRect && step?.spotlight && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="pointer-events-none absolute rounded-lg border-2 border-primary"
            style={{
              top: targetRect.top - 8,
              left: targetRect.left - 8,
              width: targetRect.width + 16,
              height: targetRect.height + 16,
            }}
          >
            <div className="absolute inset-0 animate-ping rounded-lg border-2 border-primary opacity-50" />
          </motion.div>
        )}

        {/* Tooltip */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className={cn(
            "pointer-events-auto absolute w-80",
            "rounded-xl border border-border bg-popover shadow-2xl",
            "overflow-hidden"
          )}
          style={{
            top: tooltipPosition.top,
            left: tooltipPosition.left,
          }}
        >
          {/* Close button */}
          <button
            onClick={handleSkip}
            className={cn(
              "absolute right-3 top-3 z-10 rounded-full p-1",
              "text-muted-foreground hover:text-foreground",
              "transition-colors hover:bg-muted"
            )}
            aria-label="Skip tour"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Progress indicator */}
          <div className="flex gap-1 px-4 pt-4">
            {ONBOARDING_STEPS.map((_, index) => (
              <div
                key={index}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors",
                  index <= currentStep ? "bg-primary" : "bg-muted"
                )}
              />
            ))}
          </div>

          {/* Content */}
          <div className="p-4 pt-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                {step.icon}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="mb-1 text-sm font-semibold">{step.title}</h3>
                <p className="text-xs leading-relaxed text-muted-foreground">{step.description}</p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 pb-4">
            <div className="text-xs text-muted-foreground">
              {currentStep + 1} of {ONBOARDING_STEPS.length}
            </div>
            <Button size="sm" onClick={handleNext}>
              {isLastStep ? (
                <>
                  Get Started
                  <Check className="ml-1 h-4 w-4" />
                </>
              ) : (
                <>
                  Next
                  <ChevronRight className="ml-1 h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}

// Hook to manually trigger onboarding
export function useOnboarding() {
  const { tourCompleted, setTourCompleted } = useOnboardingStore();

  const resetOnboarding = () => {
    // Clear the store state
    useOnboardingStore.setState({ tourCompleted: false });
    window.location.reload();
  };

  const isCompleted = () => tourCompleted;

  return { resetOnboarding, isCompleted, setTourCompleted };
}
