import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "@/lib/api";
import { useAPISettingsStore } from "@/stores/api-settings-store";
import type { BillingStatus, CreditsInfo, StorageInfo } from "@/lib/api/billing";

interface BillingState {
  // State
  plan: BillingStatus["plan"] | null;
  isEarlyBird: boolean;
  status: BillingStatus["status"] | null;
  periodEnd: string | null;
  credits: CreditsInfo | null;
  storage: StorageInfo | null;
  earlyBirdRemaining: number;
  isLoading: boolean;
  isInitialized: boolean;
  // Computed helpers
  hasCredits: () => boolean;
  isAILocked: () => boolean;

  // Pricing modal
  showPricingModal: boolean;
  openPricingModal: () => void;
  closePricingModal: () => void;

  // Actions
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  updateCreditsFromStream: (creditsRemaining: number) => void;
  openUpgradeModal: (reason?: string) => void;
  reset: () => void;
}

export const useBillingStore = create<BillingState>()(
  persist(
    (set, get) => ({
      plan: null,
      isEarlyBird: false,
      status: null,
      periodEnd: null,
      credits: null,
      storage: null,
      earlyBirdRemaining: 0,
      isLoading: false,
      isInitialized: false,
      showPricingModal: false,
      openPricingModal: () => set({ showPricingModal: true }),
      closePricingModal: () => set({ showPricingModal: false }),

      hasCredits: () => {
        const { credits } = get();
        if (!credits) return true; // Not initialized yet — don't lock
        return credits.remaining > 0;
      },

      isAILocked: () => {
        // BYOK users are never locked
        if (useAPISettingsStore.getState().hasAPIKey) return false;
        return !get().hasCredits();
      },

      initialize: async () => {
        if (get().isInitialized) return;
        set({ isLoading: true });
        try {
          const data = await api.getBillingStatus();
          set({
            plan: data.plan,
            isEarlyBird: data.is_early_bird,
            status: data.status,
            periodEnd: data.period_end,
            credits: data.credits,
            storage: data.storage,
            earlyBirdRemaining: data.early_bird_remaining,
            isInitialized: true,
          });
        } catch {
          // Silently fail - billing info is non-critical
          set({ isInitialized: true });
        } finally {
          set({ isLoading: false });
        }
      },

      refresh: async () => {
        try {
          const data = await api.getBillingStatus();
          set({
            plan: data.plan,
            isEarlyBird: data.is_early_bird,
            status: data.status,
            periodEnd: data.period_end,
            credits: data.credits,
            storage: data.storage,
            earlyBirdRemaining: data.early_bird_remaining,
          });
        } catch {
          // Silently fail
        }
      },

      updateCreditsFromStream: (creditsRemaining: number) => {
        const current = get().credits;
        if (!current) return;
        const multiplier = 10;
        set({
          credits: {
            ...current,
            remaining: creditsRemaining,
            used: current.limit - creditsRemaining,
            display_remaining: creditsRemaining * multiplier,
            display_used: (current.limit - creditsRemaining) * multiplier,
          },
        });
      },

      openUpgradeModal: () => {
        set({ showPricingModal: true });
      },

      reset: () => {
        set({
          plan: null,
          isEarlyBird: false,
          status: null,
          periodEnd: null,
          credits: null,
          storage: null,
          earlyBirdRemaining: 0,
          isInitialized: false,
        });
      },
    }),
    {
      name: "billing-store",
      partialize: (state) => ({
        plan: state.plan,
      }),
    }
  )
);
