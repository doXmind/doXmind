import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "@/lib/api";
import { useAPISettingsStore } from "@/stores/api-settings-store";
import { eventBus } from "@/lib/events";
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
  refreshWithRetry: () => Promise<void>;
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
          // Don't set isInitialized on failure — allows retry on next call
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

      refreshWithRetry: async () => {
        const MAX_ATTEMPTS = 5;
        const INTERVAL_MS = 2000;
        const previousPlan = get().plan;

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
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

            // Plan upgraded — stop polling
            if (data.plan !== previousPlan && data.plan !== "free") {
              return;
            }
          } catch {
            // Continue retrying on network errors
          }

          // Wait before next attempt (skip wait on last attempt)
          if (attempt < MAX_ATTEMPTS - 1) {
            await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
          }
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

// Refresh billing when storage changes (file create/delete) and on window focus
if (typeof window !== "undefined") {
  let storageDebounce: ReturnType<typeof setTimeout> | null = null;
  eventBus.on("storage:changed", () => {
    if (storageDebounce) clearTimeout(storageDebounce);
    storageDebounce = setTimeout(() => {
      if (useBillingStore.getState().isInitialized) {
        useBillingStore.getState().refresh();
      }
    }, 2000);
  });

  let lastFocusRefresh = 0;
  window.addEventListener("focus", () => {
    const now = Date.now();
    if (now - lastFocusRefresh > 30_000 && useBillingStore.getState().isInitialized) {
      lastFocusRefresh = now;
      useBillingStore.getState().refresh();
    }
  });
}
