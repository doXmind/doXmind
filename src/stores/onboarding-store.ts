import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ChecklistState {
  createdDocument: boolean;
  triedAutocomplete: boolean;
  triedQuickEdit: boolean;
  triedSlashCommand: boolean;
  triedAIChat: boolean;
  triedExport: boolean;
}

interface OnboardingState {
  // Tour state
  tourCompleted: boolean;
  setTourCompleted: () => void;

  // Checklist items
  checklist: ChecklistState;
  completeChecklistItem: (item: keyof ChecklistState) => void;

  // Checklist visibility
  isChecklistVisible: boolean;
  dismissChecklist: () => void;

  // Computed helpers
  getChecklistProgress: () => number;
  isChecklistComplete: () => boolean;
}

const CHECKLIST_ITEMS: (keyof ChecklistState)[] = [
  "createdDocument",
  "triedAutocomplete",
  "triedQuickEdit",
  "triedSlashCommand",
  "triedAIChat",
  "triedExport",
];

export type ChecklistItemKey = keyof ChecklistState;

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      tourCompleted: false,
      setTourCompleted: () => set({ tourCompleted: true }),

      checklist: {
        createdDocument: false,
        triedAutocomplete: false,
        triedQuickEdit: false,
        triedSlashCommand: false,
        triedAIChat: false,
        triedExport: false,
      },

      completeChecklistItem: (item) =>
        set((state) => ({
          checklist: { ...state.checklist, [item]: true },
        })),

      isChecklistVisible: true,
      dismissChecklist: () => set({ isChecklistVisible: false }),

      getChecklistProgress: () => {
        const { checklist } = get();
        return CHECKLIST_ITEMS.filter((key) => checklist[key]).length;
      },

      isChecklistComplete: () => {
        const { checklist } = get();
        return CHECKLIST_ITEMS.every((key) => checklist[key]);
      },
    }),
    {
      name: "doxmind-onboarding",
      // Migrate from old localStorage keys on first load
      onRehydrateStorage: () => {
        return (state) => {
          if (!state) return;

          // Migration: old tour key → new store
          if (typeof window !== "undefined") {
            const oldTourCompleted = localStorage.getItem("doxmind-onboarding-completed");
            if (oldTourCompleted === "true" && !state.tourCompleted) {
              state.tourCompleted = true;
              // Clean up old key
              localStorage.removeItem("doxmind-onboarding-completed");
            }

            // Migration: old feature hints → mark checklist items
            const oldHints = localStorage.getItem("doxmind-feature-hints");
            if (oldHints) {
              try {
                const seenHints: string[] = JSON.parse(oldHints);
                if (seenHints.includes("autocomplete-shown")) {
                  state.checklist.triedAutocomplete = true;
                }
                if (seenHints.includes("quick-edit-shown")) {
                  state.checklist.triedQuickEdit = true;
                }
                if (seenHints.includes("slash-command-used")) {
                  state.checklist.triedSlashCommand = true;
                }
              } catch {
                // Ignore parse errors
              }
              // Don't remove old hints key — feature-hints.tsx still uses it
            }
          }
        };
      },
    }
  )
);
