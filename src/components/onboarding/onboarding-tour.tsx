"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Check,
  FileText,
  MessageSquare,
  BookOpen,
  Search,
  Keyboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Onboarding step configuration
interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  targetSelector: string; // CSS selector for the target element
  position: "top" | "bottom" | "left" | "right";
  spotlight?: boolean; // Whether to spotlight the target element
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "create-file",
    title: "Create a Document",
    description:
      "Click here to create a new document. You can also import PDF, DOCX, or Markdown files.",
    icon: <FileText className="h-5 w-5" />,
    targetSelector: '[aria-label="Create New File"]',
    position: "bottom",
    spotlight: true,
  },
  {
    id: "search",
    title: "Search Your Files",
    description:
      "Use the search bar to find files by name or content. AI semantic search helps find related content.",
    icon: <Search className="h-5 w-5" />,
    targetSelector: '[aria-label="Search files"]',
    position: "bottom",
    spotlight: true,
  },
  {
    id: "ai-chat",
    title: "AI Chat Assistant",
    description:
      "Click to open the AI chat panel. Ask questions, get writing suggestions, or let AI help improve your text.",
    icon: <MessageSquare className="h-5 w-5" />,
    targetSelector: '[aria-label="Show AI Chat"], [aria-label="Hide AI Chat"]',
    position: "left",
    spotlight: true,
  },
  {
    id: "knowledge-base",
    title: "Knowledge Base",
    description:
      "Click the + button to upload reference documents (PDF, DOCX, PPTX). AI will search and reference them for more accurate answers.",
    icon: <BookOpen className="h-5 w-5" />,
    targetSelector: '[aria-label="Add attachment"]',
    position: "top",
    spotlight: true,
  },
  {
    id: "shortcuts",
    title: "Keyboard Shortcuts",
    description:
      "Press Ctrl+K for the command palette, Ctrl+? for all shortcuts. Use Ctrl+B for bold, Ctrl+I for italic.",
    icon: <Keyboard className="h-5 w-5" />,
    targetSelector: '[aria-label="Keyboard Shortcuts"]',
    position: "bottom",
    spotlight: true,
  },
];

const STORAGE_KEY = "doxmind-onboarding-completed";

interface OnboardingTourProps {
  onComplete?: () => void;
}

export function OnboardingTour({ onComplete }: OnboardingTourProps) {
  const [mounted, setMounted] = React.useState(false);
  const [isOpen, setIsOpen] = React.useState(false);
  const [currentStep, setCurrentStep] = React.useState(0);
  const [targetRect, setTargetRect] = React.useState<DOMRect | null>(null);
  const [tooltipPosition, setTooltipPosition] = React.useState({ top: 0, left: 0 });

  const step = ONBOARDING_STEPS[currentStep];
  const isLastStep = currentStep === ONBOARDING_STEPS.length - 1;
  const isFirstStep = currentStep === 0;

  // Check if onboarding was completed
  React.useEffect(() => {
    setMounted(true);
    const completed = localStorage.getItem(STORAGE_KEY);
    if (!completed) {
      // Delay showing onboarding to let the page load
      const timer = setTimeout(() => setIsOpen(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  // Find and highlight target element
  React.useEffect(() => {
    if (!isOpen || !step) return;

    const findTarget = () => {
      // Handle multiple selectors (comma-separated)
      const selectors = step.targetSelector.split(",").map((s) => s.trim());
      let target: Element | null = null;

      for (const selector of selectors) {
        target = document.querySelector(selector);
        if (target) break;
      }

      if (target) {
        const rect = target.getBoundingClientRect();
        setTargetRect(rect);

        // Calculate tooltip position based on step.position
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

        // Keep tooltip in viewport
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

    // Re-calculate on resize
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

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleComplete = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setIsOpen(false);
    onComplete?.();
  };

  const handleSkip = () => {
    localStorage.setItem(STORAGE_KEY, "true");
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
            {/* Pulsing ring */}
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
            <div className="flex items-center gap-2">
              {!isFirstStep && (
                <Button variant="ghost" size="sm" onClick={handlePrev}>
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Back
                </Button>
              )}
              <Button size="sm" onClick={handleNext}>
                {isLastStep ? (
                  <>
                    Done
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
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}

// Hook to manually trigger onboarding
export function useOnboarding() {
  const resetOnboarding = () => {
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  };

  const isCompleted = () => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(STORAGE_KEY) === "true";
  };

  return { resetOnboarding, isCompleted };
}
