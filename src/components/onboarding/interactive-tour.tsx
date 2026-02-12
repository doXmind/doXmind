"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  useOnboardingStore,
  ONBOARDING_STEPS,
  type OnboardingStep,
} from "@/stores/onboarding-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useFileStore } from "@/stores/file-store";
import { markdownToHtml } from "@/lib/markdown";
import { getTutorialDocumentMarkdown, TUTORIAL_DOCUMENT_FILENAME } from "./tutorial-document";
import { TourTooltip } from "./tour-tooltip";
import { TourWelcomeModal } from "./tour-welcome-modal";
import { TourCompleteModal } from "./tour-complete-modal";

const TOOLTIP_WIDTH = 340;
const TOOLTIP_HEIGHT = 200;
const SPOTLIGHT_PADDING = 8;
const VIEWPORT_PADDING = 16;

/**
 * Ensure required panels are open for a given step.
 */
function ensurePanelsForStep(step: OnboardingStep) {
  if (step.page === "home") return;

  const layout = useLayoutStore.getState();

  switch (step.id) {
    case "ai-chat":
    case "knowledge-base":
      if (!layout.isChatOpen) layout.setChatOpen(true);
      break;
    case "mindlines":
      if (!layout.isSidebarOpen) layout.setSidebarOpen(true);
      break;
    case "export":
    case "version-history":
    case "writing-review":
      if (layout.isFocusMode) layout.setFocusMode(false);
      break;
    case "focus-mode":
      if (layout.isFocusMode) layout.setFocusMode(false);
      break;
  }
}

/**
 * Calculate tooltip position and arrow offset relative to the target element.
 */
function calculateTooltipPosition(
  targetRect: DOMRect,
  position: OnboardingStep["position"]
): { top: number; left: number; placement: OnboardingStep["position"]; arrowOffset: number } {
  let top = 0;
  let left = 0;
  let arrowOffset = TOOLTIP_WIDTH / 2;
  let placement = position;

  switch (position) {
    case "top":
      top = targetRect.top - TOOLTIP_HEIGHT - SPOTLIGHT_PADDING - 12;
      left = targetRect.left + targetRect.width / 2 - TOOLTIP_WIDTH / 2;
      break;
    case "bottom":
      top = targetRect.bottom + SPOTLIGHT_PADDING + 12;
      left = targetRect.left + targetRect.width / 2 - TOOLTIP_WIDTH / 2;
      break;
    case "left":
      top = targetRect.top + targetRect.height / 2 - TOOLTIP_HEIGHT / 2;
      left = targetRect.left - TOOLTIP_WIDTH - SPOTLIGHT_PADDING - 12;
      break;
    case "right":
      top = targetRect.top + targetRect.height / 2 - TOOLTIP_HEIGHT / 2;
      left = targetRect.right + SPOTLIGHT_PADDING + 12;
      break;
    case "center":
      top = window.innerHeight / 2 - TOOLTIP_HEIGHT / 2;
      left = window.innerWidth / 2 - TOOLTIP_WIDTH / 2;
      break;
  }

  // Flip vertically if out of bounds
  if (position === "top" && top < VIEWPORT_PADDING) {
    top = targetRect.bottom + SPOTLIGHT_PADDING + 12;
    placement = "bottom";
  } else if (
    position === "bottom" &&
    top + TOOLTIP_HEIGHT > window.innerHeight - VIEWPORT_PADDING
  ) {
    top = targetRect.top - TOOLTIP_HEIGHT - SPOTLIGHT_PADDING - 12;
    placement = "top";
  }

  // Calculate arrow offset before clamping left
  const idealCenter = targetRect.left + targetRect.width / 2;

  // Keep within viewport horizontally
  const clampedLeft = Math.max(
    VIEWPORT_PADDING,
    Math.min(left, window.innerWidth - TOOLTIP_WIDTH - VIEWPORT_PADDING)
  );

  // Arrow should point at the target center relative to the tooltip's new left
  if (placement === "top" || placement === "bottom") {
    arrowOffset = idealCenter - clampedLeft;
  }

  // Keep within viewport vertically
  top = Math.max(
    VIEWPORT_PADDING,
    Math.min(top, window.innerHeight - TOOLTIP_HEIGHT - VIEWPORT_PADDING)
  );

  return { top, left: clampedLeft, placement, arrowOffset };
}

export function InteractiveTour() {
  const router = useRouter();
  const pathname = usePathname();
  const currentPage = pathname.startsWith("/editor") ? "editor" : "home";

  const [mounted, setMounted] = React.useState(false);
  const [targetRect, setTargetRect] = React.useState<DOMRect | null>(null);
  const [tooltipPos, setTooltipPos] = React.useState({ top: 0, left: 0 });
  const [placement, setPlacement] = React.useState<OnboardingStep["position"]>("bottom");
  const [arrowOffset, setArrowOffset] = React.useState(170);
  const [isPopoverOpen, setIsPopoverOpen] = React.useState(false);

  const currentStepIndex = useOnboardingStore((s) => s.currentStepIndex);
  const isPaused = useOnboardingStore((s) => s.isPaused);
  const onboardingCompleted = useOnboardingStore((s) => s.onboardingCompleted);
  const isNavigating = useOnboardingStore((s) => s.isNavigating);

  const step = React.useMemo(() => ONBOARDING_STEPS[currentStepIndex] ?? null, [currentStepIndex]);

  const isActive = currentStepIndex >= 0 && !isPaused && !onboardingCompleted;

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Page navigation: when step targets a different page, navigate there
  React.useEffect(() => {
    if (!isActive || !step) return;
    if (step.page === "any") {
      if (isNavigating) useOnboardingStore.getState().setNavigating(false);
      return;
    }
    if (step.page === currentPage) {
      if (isNavigating) useOnboardingStore.getState().setNavigating(false);
      return;
    }

    // Need to navigate to a different page
    useOnboardingStore.getState().setNavigating(true);

    if (step.page === "editor") {
      // Create tutorial file if needed, then navigate
      const ensureTutorialAndNavigate = async () => {
        let fileId = useOnboardingStore.getState().tutorialFileId;
        if (!fileId) {
          const fileStore = useFileStore.getState();
          const existing = fileStore.files.find((f) =>
            f.name.startsWith("Getting Started with doXmind")
          );
          if (existing) {
            fileId = existing.id;
          } else {
            const markdown = getTutorialDocumentMarkdown();
            const html = markdownToHtml(markdown);
            fileId = await fileStore.createFile(TUTORIAL_DOCUMENT_FILENAME, html);
          }
          useOnboardingStore.getState().setTutorialFileId(fileId);
        }
        router.push(`/editor/${fileId}`);
      };
      ensureTutorialAndNavigate();
    } else if (step.page === "home") {
      router.push("/");
    }
  }, [isActive, step, currentPage, isNavigating, router]);

  // Mark <html> so CSS can lift dropdown z-indices above the tour overlay
  React.useEffect(() => {
    if (isActive && step && !isNavigating && step.allowInteraction) {
      document.documentElement.setAttribute("data-onboarding-interactive", "");
    } else {
      document.documentElement.removeAttribute("data-onboarding-interactive");
    }
    return () => document.documentElement.removeAttribute("data-onboarding-interactive");
  }, [isActive, step, isNavigating]);

  // Detect when a Radix popover/dropdown is open — hide tooltip to avoid overlap
  React.useEffect(() => {
    if (!isActive || !step || !step.allowInteraction) {
      setIsPopoverOpen(false);
      return;
    }

    const check = () => {
      const popover = document.querySelector(
        "[data-radix-popper-content-wrapper], [data-dropdown-portal]"
      );
      setIsPopoverOpen(!!popover);
    };

    // Use MutationObserver to react to Radix portals appearing/disappearing
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    check(); // initial check

    return () => observer.disconnect();
  }, [isActive, step]);

  // Ensure panels are open for current step (with delay for animation)
  React.useEffect(() => {
    if (!isActive || !step || isNavigating) return;
    const timer = setTimeout(() => ensurePanelsForStep(step), 50);
    return () => clearTimeout(timer);
  }, [isActive, step, isNavigating]);

  // Find and track target element
  React.useEffect(() => {
    if (!isActive || !step || step.position === "center" || isNavigating) {
      setTargetRect(null);
      return;
    }

    let foundTarget = false;

    const findTarget = () => {
      const selectors = step.targetSelector.split(",").map((s) => s.trim());
      let target: Element | null = null;

      for (const selector of selectors) {
        if (!selector) continue;
        target = document.querySelector(selector);
        if (target) break;
      }

      if (target) {
        foundTarget = true;
        const rect = target.getBoundingClientRect();
        setTargetRect(rect);
        const pos = calculateTooltipPosition(rect, step.position);
        setTooltipPos({ top: pos.top, left: pos.left });
        setPlacement(pos.placement);
        setArrowOffset(pos.arrowOffset);
      } else {
        setTargetRect(null);
        setTooltipPos({
          top: window.innerHeight / 2 - 100,
          left: window.innerWidth / 2 - TOOLTIP_WIDTH / 2,
        });
        setPlacement("center");
      }
    };

    // Initial find with delay for panels to open
    const initialTimer = setTimeout(findTarget, 200);

    // Recalculate on resize/scroll
    window.addEventListener("resize", findTarget);
    window.addEventListener("scroll", findTarget, true);

    // Poll briefly for late-appearing elements
    const pollTimer = setInterval(findTarget, 500);
    const stopPoll = setTimeout(() => clearInterval(pollTimer), 5000);

    // Auto-skip if target not found after 3 seconds (for autoSkipIfMissing steps)
    const autoSkipTimer = step.autoSkipIfMissing
      ? setTimeout(() => {
          if (!foundTarget) {
            useOnboardingStore.getState().advanceToNextStep();
          }
        }, 3000)
      : undefined;

    return () => {
      clearTimeout(initialTimer);
      clearTimeout(stopPoll);
      clearInterval(pollTimer);
      if (autoSkipTimer) clearTimeout(autoSkipTimer);
      window.removeEventListener("resize", findTarget);
      window.removeEventListener("scroll", findTarget, true);
    };
  }, [isActive, step, currentStepIndex, isNavigating]);

  const handleNext = React.useCallback(() => {
    const currentStep = useOnboardingStore.getState().getCurrentStep();
    if (!currentStep) return;

    if (currentStep.requiresAction) {
      useOnboardingStore.getState().advanceToNextStep();
    } else {
      useOnboardingStore.getState().completeStep(currentStep.id);
    }
  }, []);

  const handleBack = React.useCallback(() => {
    useOnboardingStore.getState().goToPreviousStep();
  }, []);

  const handleSkip = React.useCallback(() => {
    useOnboardingStore.getState().skipOnboarding();
  }, []);

  const handleWelcomeStart = React.useCallback(() => {
    useOnboardingStore.getState().completeStep("welcome");
  }, []);

  const handleComplete = React.useCallback(() => {
    useOnboardingStore.getState().skipOnboarding();
  }, []);

  const handleRestart = React.useCallback(() => {
    const store = useOnboardingStore.getState();
    const tutorialFileId = store.tutorialFileId;
    store.resetOnboarding();
    if (tutorialFileId) {
      store.startOnboarding(tutorialFileId);
    }
  }, []);

  if (!mounted || !isActive || !step || isNavigating) return null;

  const isWelcome = step.id === "welcome";
  const isComplete = step.id === "complete";
  const totalSteps = ONBOARDING_STEPS.length;

  return createPortal(
    <AnimatePresence mode="wait">
      {/* Welcome modal */}
      {isWelcome && <TourWelcomeModal onStart={handleWelcomeStart} onSkip={handleSkip} />}

      {/* Complete modal */}
      {isComplete && <TourCompleteModal onFinish={handleComplete} onRestart={handleRestart} />}

      {/* Regular step: spotlight + tooltip */}
      {!isWelcome && !isComplete && (
        <div className="pointer-events-none fixed inset-0 z-[60]" aria-hidden="true">
          {/* Progress bar at top */}
          <div className="pointer-events-none absolute left-0 right-0 top-0 z-[66] h-0.5 bg-muted/30">
            <motion.div
              className="h-full bg-primary"
              initial={{ width: "0%" }}
              animate={{
                width: `${Math.round((currentStepIndex / (totalSteps - 1)) * 100)}%`,
              }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              role="progressbar"
              aria-valuenow={currentStepIndex}
              aria-valuemax={totalSteps - 1}
            />
          </div>

          {/* Spotlight overlay using box-shadow approach */}
          {targetRect && (
            <>
              {/* Dark overlay with spotlight cutout */}
              <motion.div
                className={cn(
                  "fixed rounded-lg",
                  step.allowInteraction ? "pointer-events-none" : "pointer-events-auto"
                )}
                style={{
                  boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.5)",
                }}
                initial={{ opacity: 0 }}
                animate={{
                  opacity: 1,
                  top: targetRect.top - SPOTLIGHT_PADDING,
                  left: targetRect.left - SPOTLIGHT_PADDING,
                  width: targetRect.width + SPOTLIGHT_PADDING * 2,
                  height: targetRect.height + SPOTLIGHT_PADDING * 2,
                }}
                transition={{
                  opacity: { duration: 0.2 },
                  top: { type: "spring", stiffness: 300, damping: 30 },
                  left: { type: "spring", stiffness: 300, damping: 30 },
                  width: { type: "spring", stiffness: 300, damping: 30 },
                  height: { type: "spring", stiffness: 300, damping: 30 },
                }}
              />

              {/* Spotlight pulse ring */}
              <motion.div
                className="pointer-events-none fixed rounded-lg border-2 border-primary/40"
                initial={{ opacity: 0 }}
                animate={{
                  opacity: 1,
                  top: targetRect.top - SPOTLIGHT_PADDING,
                  left: targetRect.left - SPOTLIGHT_PADDING,
                  width: targetRect.width + SPOTLIGHT_PADDING * 2,
                  height: targetRect.height + SPOTLIGHT_PADDING * 2,
                }}
                transition={{
                  opacity: { duration: 0.3 },
                  top: { type: "spring", stiffness: 300, damping: 30 },
                  left: { type: "spring", stiffness: 300, damping: 30 },
                  width: { type: "spring", stiffness: 300, damping: 30 },
                  height: { type: "spring", stiffness: 300, damping: 30 },
                }}
              >
                <motion.div
                  className="absolute inset-0 rounded-lg border-2 border-primary/30"
                  animate={{
                    scale: [1, 1.03, 1],
                    opacity: [0.5, 0.15, 0.5],
                  }}
                  transition={{
                    repeat: Infinity,
                    duration: 2,
                    ease: "easeInOut",
                  }}
                />
              </motion.div>
            </>
          )}

          {/* Dark overlay when no target found */}
          {!targetRect && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="pointer-events-none fixed inset-0 bg-black/50"
            />
          )}

          {/* Tooltip — hidden when user has opened a dropdown/popover */}
          {!isPopoverOpen && (
            <TourTooltip
              step={step}
              stepIndex={currentStepIndex}
              totalSteps={totalSteps}
              position={tooltipPos}
              placement={placement}
              arrowOffset={arrowOffset}
              onNext={handleNext}
              onBack={handleBack}
              onSkip={handleSkip}
            />
          )}
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
