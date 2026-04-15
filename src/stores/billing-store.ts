/**
 * Billing store stub — local desktop edition has no billing.
 *
 * Reports an "unlimited free" plan so legacy gates always pass.
 */

import { create } from "zustand";

type Plan = "free" | "pro" | "max" | null;

interface BillingState {
  plan: Plan;
  status: string;
  creditsRemaining: number;
  creditsLimit: number;
  storageUsedBytes: number;
  storageLimitBytes: number;
  isLoading: boolean;
  isInitialized: boolean;
  isAILocked: () => boolean;
  refresh: () => Promise<void>;
  refreshWithRetry: () => Promise<void>;
  hasCredits: () => boolean;
  openUpgradeModal: (..._args: unknown[]) => void;
  updateCreditsFromStream: (_payload: unknown) => void;
}

export const useBillingStore = create<BillingState>(() => ({
  plan: "max",
  status: "active",
  creditsRemaining: Number.MAX_SAFE_INTEGER,
  creditsLimit: Number.MAX_SAFE_INTEGER,
  storageUsedBytes: 0,
  storageLimitBytes: Number.MAX_SAFE_INTEGER,
  isLoading: false,
  isInitialized: true,
  isAILocked: () => false,
  refresh: async () => {},
  refreshWithRetry: async () => {},
  hasCredits: () => true,
  openUpgradeModal: () => {},
  updateCreditsFromStream: () => {},
}));
