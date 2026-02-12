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

type StepGroup =
  | "Welcome"
  | "Home"
  | "AI Writing"
  | "AI Editing"
  | "AI Chat & Knowledge"
  | "Navigation"
  | "File Management"
  | "Finishing";

export interface OnboardingStep {
  id: OnboardingStepId;
  group: StepGroup;
  title: string;
  instruction: string;
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
    group: "Welcome",
    title: "Welcome to doXmind!",
    instruction:
      "Let's walk through a complete tour of your AI writing workspace. You'll discover every feature hands-on — it only takes about 5 minutes.",
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
    group: "Home",
    title: "Search & Ask AI",
    instruction:
      "This is your search bar. In Ask AI mode, get AI answers from your knowledge base. Switch to Search mode to find documents by content.",
    targetSelector: "[data-onboarding='home-search']",
    position: "bottom",
    allowInteraction: false,
    requiresAction: false,
    icon: "Search",
    page: "home",
  },
  {
    id: "kb-agent",
    group: "Home",
    title: "AI Answers",
    instruction:
      "Ask any question and the AI will search your documents and give a cited answer. Perfect for research and quick lookups.",
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
    group: "AI Writing",
    title: "AI Autocomplete",
    instruction:
      'Place your cursor at the end of the incomplete paragraph (ending with "the way we") and pause. Ghost text will appear — press Tab to accept it.',
    targetSelector: ".ProseMirror",
    position: "top",
    allowInteraction: true,
    requiresAction: true,
    icon: "Wand2",
    page: "editor",
  },
  {
    id: "slash-command",
    group: "AI Writing",
    title: "Slash Commands",
    instruction:
      'Click on the empty line below the "Slash Commands" heading and type / to open the block menu. Pick any block to insert.',
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
    group: "AI Editing",
    title: "Quick Edit",
    instruction:
      'Select the verbose sentence under "Quick Edit" and choose an action (like "Simplify" or "Improve Writing") from the popup menu.',
    targetSelector: ".ProseMirror",
    position: "top",
    allowInteraction: true,
    requiresAction: true,
    icon: "Pencil",
    page: "editor",
  },
  {
    id: "diff-review",
    group: "AI Editing",
    title: "Review AI Changes",
    instruction:
      "The AI has suggested changes. Click Accept or Reject on each highlighted change, or use Accept All / Reject All.",
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
    group: "AI Editing",
    title: "Writing Review",
    instruction:
      'Open the More menu (\u2026) in the toolbar and click "AI Writing Review" to get color-coded writing feedback on your document.',
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
    group: "AI Chat & Knowledge",
    title: "AI Chat",
    instruction:
      'Open the chat panel and send a message like "Summarize this document" to see AI streaming in action.',
    targetSelector: "[data-onboarding='chat-toggle'], [data-onboarding='chat-composer']",
    position: "left",
    allowInteraction: true,
    requiresAction: true,
    icon: "MessageCircle",
    page: "editor",
  },
  {
    id: "knowledge-base",
    group: "AI Chat & Knowledge",
    title: "Knowledge Base",
    instruction:
      "Click the attachment icon in the chat input to see the Knowledge Base. You can upload PDFs and docs as context for AI.",
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
    group: "Navigation",
    title: "Outline & Mindlines",
    instruction:
      "Toggle the sidebar to view your document outline. Click any heading to jump to it.",
    targetSelector: "[data-onboarding='sidebar-toggle']",
    position: "right",
    allowInteraction: true,
    requiresAction: true,
    icon: "List",
    page: "editor",
  },
  {
    id: "version-history",
    group: "Navigation",
    title: "Version History",
    instruction:
      "Open the More menu (\u2026) in the toolbar, then click Version History. Every AI edit is automatically saved as a version.",
    targetSelector: "[data-onboarding='more-menu']",
    position: "left",
    allowInteraction: true,
    requiresAction: true,
    icon: "History",
    page: "editor",
  },
  {
    id: "focus-mode",
    group: "Navigation",
    title: "Focus Mode",
    instruction:
      "Press F11 or click the Focus Mode button for distraction-free writing. Press F11 again to exit.",
    targetSelector: "[data-onboarding='focus-mode'], .ProseMirror",
    position: "top",
    allowInteraction: true,
    requiresAction: true,
    icon: "Maximize",
    page: "editor",
  },
  {
    id: "export",
    group: "Navigation",
    title: "Export",
    instruction:
      "Open the More menu (\u2026) in the toolbar to export your document as Markdown, PDF, or Word.",
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
    group: "File Management",
    title: "Create New",
    instruction:
      "Click the + button to create a new document, folder, start from a template, or import a file.",
    targetSelector: "[data-onboarding='new-button']",
    position: "bottom",
    allowInteraction: false,
    requiresAction: false,
    icon: "Plus",
    page: "home",
  },
  {
    id: "recent-files",
    group: "File Management",
    title: "Recent Files",
    instruction: "Your most recently edited documents appear here for quick access.",
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
    group: "File Management",
    title: "Favorites",
    instruction:
      "Star important documents to pin them here. Use the menu on any file card to add favorites.",
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
    group: "File Management",
    title: "File Actions",
    instruction:
      "Hover over any document card to see its options — rename, share, export, or delete.",
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
    group: "Finishing",
    title: "You're All Set!",
    instruction: "You've explored all the key features of doXmind. Time to start writing!",
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
          // Clean up all legacy localStorage keys
          if (typeof window !== "undefined") {
            localStorage.removeItem("doxmind-onboarding-completed");
            localStorage.removeItem("doxmind-feature-hints");
            localStorage.removeItem("doxmind-mobile-hints-seen");
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
