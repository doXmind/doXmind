import { create } from "zustand";
import { persist } from "zustand/middleware";

// --- Step definitions ---

export type OnboardingStepId =
  | "welcome"
  | "home-search"
  | "kb-agent"
  | "autocomplete"
  | "slash-command"
  | "quick-edit"
  | "diff-review"
  | "writing-review"
  | "ai-chat"
  | "knowledge-base"
  | "mindlines"
  | "version-history"
  | "focus-mode"
  | "export"
  | "new-button"
  | "recent-files"
  | "favorites"
  | "file-card"
  | "complete";

export interface OnboardingStep {
  id: OnboardingStepId;
  groupKey: string;
  titleKey: string;
  instructionKey: string;
  targetSelector: string;
  position: "top" | "bottom" | "left" | "right" | "center";
  allowInteraction: boolean;
  requiresAction: boolean;
  skippable?: boolean;
  autoSkipIfMissing?: boolean;
  icon: string; // Lucide icon name
  page: "home" | "editor" | "any";
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  // --- Welcome ---
  {
    id: "welcome",
    groupKey: "groupWelcome",
    titleKey: "tourStep1Title",
    instructionKey: "tourStep1Instruction",
    targetSelector: "",
    position: "center",
    allowInteraction: false,
    requiresAction: false,
    icon: "Sparkles",
    page: "any",
  },

  // --- Home: Search & KB ---
  {
    id: "home-search",
    groupKey: "groupHomeSearch",
    titleKey: "tourStep2Title",
    instructionKey: "tourStep2Instruction",
    targetSelector: "[data-onboarding='home-search']",
    position: "bottom",
    allowInteraction: false,
    requiresAction: false,
    icon: "Search",
    page: "home",
  },
  {
    id: "kb-agent",
    groupKey: "groupHomeSearch",
    titleKey: "tourStep3Title",
    instructionKey: "tourStep3Instruction",
    targetSelector: "[data-onboarding='search-mode-toggle']",
    position: "bottom",
    allowInteraction: false,
    requiresAction: false,
    icon: "Bot",
    page: "home",
  },

  // --- AI Writing ---
  {
    id: "autocomplete",
    groupKey: "groupAIWriting",
    titleKey: "tourStep4Title",
    instructionKey: "tourStep4Instruction",
    targetSelector: ".ProseMirror",
    position: "top",
    allowInteraction: true,
    requiresAction: true,
    icon: "Wand2",
    page: "editor",
  },
  {
    id: "slash-command",
    groupKey: "groupAIWriting",
    titleKey: "tourStep5Title",
    instructionKey: "tourStep5Instruction",
    targetSelector: ".ProseMirror",
    position: "top",
    allowInteraction: true,
    requiresAction: true,
    icon: "Slash",
    page: "editor",
  },

  // --- AI Editing ---
  {
    id: "quick-edit",
    groupKey: "groupAIEditing",
    titleKey: "tourStep6Title",
    instructionKey: "tourStep6Instruction",
    targetSelector: ".ProseMirror",
    position: "top",
    allowInteraction: true,
    requiresAction: true,
    icon: "Pencil",
    page: "editor",
  },
  {
    id: "diff-review",
    groupKey: "groupAIEditing",
    titleKey: "tourStep7Title",
    instructionKey: "tourStep7Instruction",
    targetSelector: ".diff-actions-row, [data-onboarding='diff-toolbar']",
    position: "top",
    allowInteraction: true,
    requiresAction: true,
    skippable: true,
    autoSkipIfMissing: true,
    icon: "GitCompare",
    page: "editor",
  },
  {
    id: "writing-review",
    groupKey: "groupAIEditing",
    titleKey: "tourStep8Title",
    instructionKey: "tourStep8Instruction",
    targetSelector: "[data-onboarding='more-menu']",
    position: "left",
    allowInteraction: true,
    requiresAction: true,
    icon: "ScanEye",
    page: "editor",
  },

  // --- AI Chat & Knowledge ---
  {
    id: "ai-chat",
    groupKey: "groupChatKnowledge",
    titleKey: "tourStep9Title",
    instructionKey: "tourStep9Instruction",
    targetSelector: "[data-onboarding='chat-toggle'], [data-onboarding='chat-composer']",
    position: "left",
    allowInteraction: true,
    requiresAction: true,
    icon: "MessageCircle",
    page: "editor",
  },
  {
    id: "knowledge-base",
    groupKey: "groupChatKnowledge",
    titleKey: "tourStep10Title",
    instructionKey: "tourStep10Instruction",
    targetSelector: "[data-onboarding='kb-button']",
    position: "left",
    allowInteraction: true,
    requiresAction: true,
    icon: "BookOpen",
    page: "editor",
  },

  // --- Navigation ---
  {
    id: "mindlines",
    groupKey: "groupNavigation",
    titleKey: "tourStep11Title",
    instructionKey: "tourStep11Instruction",
    targetSelector: "[data-onboarding='sidebar-toggle']",
    position: "right",
    allowInteraction: true,
    requiresAction: true,
    icon: "List",
    page: "editor",
  },
  {
    id: "version-history",
    groupKey: "groupNavigation",
    titleKey: "tourStep12Title",
    instructionKey: "tourStep12Instruction",
    targetSelector: "[data-onboarding='more-menu']",
    position: "left",
    allowInteraction: true,
    requiresAction: true,
    icon: "History",
    page: "editor",
  },
  {
    id: "focus-mode",
    groupKey: "groupNavigation",
    titleKey: "tourStep13Title",
    instructionKey: "tourStep13Instruction",
    targetSelector: "[data-onboarding='focus-mode'], .ProseMirror",
    position: "top",
    allowInteraction: true,
    requiresAction: true,
    icon: "Maximize",
    page: "editor",
  },
  {
    id: "export",
    groupKey: "groupNavigation",
    titleKey: "tourStep14Title",
    instructionKey: "tourStep14Instruction",
    targetSelector: "[data-onboarding='more-menu']",
    position: "left",
    allowInteraction: true,
    requiresAction: true,
    icon: "Download",
    page: "editor",
  },

  // --- File Management (home page) ---
  {
    id: "new-button",
    groupKey: "groupFileManagement",
    titleKey: "tourStep15Title",
    instructionKey: "tourStep15Instruction",
    targetSelector: "[data-onboarding='new-button']",
    position: "bottom",
    allowInteraction: false,
    requiresAction: false,
    icon: "Plus",
    page: "home",
  },
  {
    id: "recent-files",
    groupKey: "groupFileManagement",
    titleKey: "tourStep16Title",
    instructionKey: "tourStep16Instruction",
    targetSelector: "[data-onboarding='recent-files']",
    position: "bottom",
    allowInteraction: false,
    requiresAction: false,
    autoSkipIfMissing: true,
    icon: "Clock",
    page: "home",
  },
  {
    id: "favorites",
    groupKey: "groupFileManagement",
    titleKey: "tourStep17Title",
    instructionKey: "tourStep17Instruction",
    targetSelector: "[data-onboarding='favorites-section']",
    position: "bottom",
    allowInteraction: false,
    requiresAction: false,
    autoSkipIfMissing: true,
    icon: "Star",
    page: "home",
  },
  {
    id: "file-card",
    groupKey: "groupFileManagement",
    titleKey: "tourStep18Title",
    instructionKey: "tourStep18Instruction",
    targetSelector: "[data-onboarding='file-card']",
    position: "top",
    allowInteraction: false,
    requiresAction: false,
    icon: "FileText",
    page: "home",
  },

  // --- Finishing ---
  {
    id: "complete",
    groupKey: "groupFinishing",
    titleKey: "tourStep19Title",
    instructionKey: "tourStep19Instruction",
    targetSelector: "",
    position: "center",
    allowInteraction: false,
    requiresAction: false,
    icon: "PartyPopper",
    page: "any",
  },
];

// --- Store interface ---

interface OnboardingState {
  // Persisted state
  currentStepIndex: number;
  completedSteps: OnboardingStepId[];
  tutorialFileId: string | null;
  isPaused: boolean;
  onboardingCompleted: boolean;

  // Transient state (not persisted)
  isNavigating: boolean;

  // Actions
  startOnboarding: (tutorialFileId?: string) => void;
  setTutorialFileId: (id: string) => void;
  setNavigating: (v: boolean) => void;
  completeStep: (stepId: OnboardingStepId) => void;
  advanceToNextStep: () => void;
  goToPreviousStep: () => void;
  skipOnboarding: () => void;
  pauseOnboarding: () => void;
  resumeOnboarding: () => void;
  resetOnboarding: () => void;

  // Computed
  getCurrentStep: () => OnboardingStep | null;
  getProgress: () => { current: number; total: number; percentage: number };
  isStepCompleted: (stepId: OnboardingStepId) => boolean;
  isOnboardingActive: () => boolean;
  isOnboardingFinished: () => boolean;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      currentStepIndex: -1,
      completedSteps: [],
      tutorialFileId: null,
      isPaused: false,
      onboardingCompleted: true,
      isNavigating: false,

      startOnboarding: (tutorialFileId?: string) =>
        set({
          currentStepIndex: 0,
          completedSteps: [],
          tutorialFileId: tutorialFileId ?? null,
          isPaused: false,
          onboardingCompleted: false,
        }),

      setTutorialFileId: (id: string) => set({ tutorialFileId: id }),

      setNavigating: (v: boolean) => set({ isNavigating: v }),

      completeStep: (stepId: OnboardingStepId) => {
        const state = get();
        if (state.onboardingCompleted || state.currentStepIndex < 0) return;

        const currentStep = ONBOARDING_STEPS[state.currentStepIndex];
        if (!currentStep || currentStep.id !== stepId) return;

        const newCompleted = state.completedSteps.includes(stepId)
          ? state.completedSteps
          : [...state.completedSteps, stepId];

        const nextIndex = state.currentStepIndex + 1;
        const isFinished = nextIndex >= ONBOARDING_STEPS.length;

        set({
          completedSteps: newCompleted,
          currentStepIndex: isFinished ? ONBOARDING_STEPS.length - 1 : nextIndex,
          onboardingCompleted: isFinished ? true : state.onboardingCompleted,
        });
      },

      advanceToNextStep: () => {
        const state = get();
        if (state.onboardingCompleted || state.currentStepIndex < 0) return;

        const nextIndex = state.currentStepIndex + 1;
        if (nextIndex < ONBOARDING_STEPS.length) {
          set({ currentStepIndex: nextIndex });
        }
      },

      goToPreviousStep: () => {
        const state = get();
        if (state.onboardingCompleted || state.currentStepIndex <= 0) return;
        set({ currentStepIndex: state.currentStepIndex - 1 });
      },

      skipOnboarding: () =>
        set({
          currentStepIndex: -1,
          onboardingCompleted: true,
          isPaused: false,
        }),

      pauseOnboarding: () => set({ isPaused: true }),

      resumeOnboarding: () => set({ isPaused: false }),

      resetOnboarding: () =>
        set({
          currentStepIndex: -1,
          completedSteps: [],
          tutorialFileId: null,
          isPaused: false,
          onboardingCompleted: false,
        }),

      getCurrentStep: () => {
        const { currentStepIndex, isPaused, onboardingCompleted } = get();
        if (onboardingCompleted || currentStepIndex < 0 || isPaused) return null;
        return ONBOARDING_STEPS[currentStepIndex] ?? null;
      },

      getProgress: () => {
        const { currentStepIndex } = get();
        const total = ONBOARDING_STEPS.length;
        const current = Math.max(0, currentStepIndex);
        return {
          current,
          total,
          percentage: Math.round((current / (total - 1)) * 100),
        };
      },

      isStepCompleted: (stepId: OnboardingStepId) => {
        return get().completedSteps.includes(stepId);
      },

      isOnboardingActive: () => {
        const { currentStepIndex, isPaused, onboardingCompleted } = get();
        return currentStepIndex >= 0 && !isPaused && !onboardingCompleted;
      },

      isOnboardingFinished: () => {
        return get().onboardingCompleted;
      },
    }),
    {
      name: "doxmind-onboarding",
      version: 2,
      partialize: (state) => ({
        currentStepIndex: state.currentStepIndex,
        completedSteps: state.completedSteps,
        tutorialFileId: state.tutorialFileId,
        isPaused: state.isPaused,
        onboardingCompleted: state.onboardingCompleted,
      }),
      migrate: (_persisted: unknown, version: number) => {
        // Any version < 2: force complete reset so ALL users re-onboard
        if (version < 2) {
          return {
            currentStepIndex: -1,
            completedSteps: [],
            tutorialFileId: null,
            isPaused: false,
            onboardingCompleted: false,
          };
        }
        return _persisted;
      },
      onRehydrateStorage: () => {
        return (state) => {
          // Clean up legacy onboarding key (one-time migration)
          if (typeof window !== "undefined") {
            localStorage.removeItem("doxmind-onboarding-completed");
          }
          // Validate step index against current steps array
          if (state && state.currentStepIndex >= ONBOARDING_STEPS.length) {
            state.currentStepIndex = -1;
            state.completedSteps = [];
          }
          // If mid-tour and completed steps reference unknown IDs, reset
          if (state && state.currentStepIndex > 0) {
            const validIds = new Set(ONBOARDING_STEPS.map((s) => s.id));
            const hasInvalidSteps = state.completedSteps.some(
              (id) => !validIds.has(id as OnboardingStepId)
            );
            if (hasInvalidSteps) {
              state.currentStepIndex = -1;
              state.completedSteps = [];
            }
          }
        };
      },
    }
  )
);
