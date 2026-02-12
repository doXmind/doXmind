"use client";

import { useEffect } from "react";
import { useOnboardingStore, ONBOARDING_STEPS } from "@/stores/onboarding-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useDiffReviewStore } from "@/stores/diff-review-store";

/**
 * Subscribes to various stores and detects when onboarding steps are completed.
 * Should be mounted once in the editor page when interactive onboarding is active.
 *
 * Steps like autocomplete, slash-command, quick-edit, ai-chat, and export call
 * completeStep directly from their feature components. This hook handles the
 * remaining steps that are detected via store subscriptions.
 */
export function useOnboardingStepDetector() {
  const isActive = useOnboardingStore((s) => s.isOnboardingActive());
  const currentStepIndex = useOnboardingStore((s) => s.currentStepIndex);

  // Detect layout-based step completions (mindlines, version-history, focus-mode)
  useEffect(() => {
    if (!isActive) return;

    const unsub = useLayoutStore.subscribe((state, prev) => {
      const onboarding = useOnboardingStore.getState();
      const step = ONBOARDING_STEPS[onboarding.currentStepIndex];
      if (!step) return;

      if (step.id === "mindlines" && state.isSidebarOpen && !prev.isSidebarOpen) {
        onboarding.completeStep("mindlines");
      }

      if (
        step.id === "version-history" &&
        state.isVersionHistoryOpen &&
        !prev.isVersionHistoryOpen
      ) {
        onboarding.completeStep("version-history");
      }

      if (step.id === "focus-mode" && state.isFocusMode && !prev.isFocusMode) {
        onboarding.completeStep("focus-mode");
      }
    });

    return unsub;
  }, [isActive, currentStepIndex]);

  // Detect diff-review completion
  useEffect(() => {
    if (!isActive) return;

    const unsub = useDiffReviewStore.subscribe((state, prev) => {
      const onboarding = useOnboardingStore.getState();
      const step = ONBOARDING_STEPS[onboarding.currentStepIndex];
      if (!step || step.id !== "diff-review") return;

      // Complete when review mode ends after being active (user resolved hunks)
      if (prev.isReviewMode && !state.isReviewMode) {
        onboarding.completeStep("diff-review");
        return;
      }

      // Also complete if any hunk was accepted/rejected (even if session still going)
      if (state.diffSession && prev.diffSession) {
        const prevResolved = prev.diffSession.hunks.filter((h) => h.status !== "pending").length;
        const nowResolved = state.diffSession.hunks.filter((h) => h.status !== "pending").length;
        if (nowResolved > prevResolved) {
          onboarding.completeStep("diff-review");
        }
      }
    });

    return unsub;
  }, [isActive, currentStepIndex]);
}
