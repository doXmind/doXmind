"use client";

import { Zap, AlertTriangle } from "lucide-react";
import { useBillingStore } from "@/stores/billing-store";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { toast } from "sonner";

export function CreditsExhaustedBanner() {
  const t = useTranslations("billing");
  const isAILocked = useBillingStore((s) => s.isAILocked)();
  const status = useBillingStore((s) => s.status);
  const openPricingModal = useBillingStore((s) => s.openPricingModal);

  // Past-due payment warning
  if (status === "past_due") {
    return (
      <div className="flex items-center justify-center gap-2 bg-amber-500/10 px-4 py-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5" />
        <span>{t("paymentFailed")}</span>
        <button
          onClick={async () => {
            try {
              const { portal_url } = await api.createPortal(window.location.href);
              window.location.href = portal_url;
            } catch {
              toast.error("Failed to open billing portal");
            }
          }}
          className="underline underline-offset-2 hover:text-amber-700 dark:hover:text-amber-300"
        >
          {t("manageSub")}
        </button>
      </div>
    );
  }

  // Credits exhausted warning
  if (!isAILocked) return null;

  return (
    <div className="flex items-center justify-center gap-2 bg-red-500/10 px-4 py-1.5 text-xs font-medium text-red-600 dark:text-red-400">
      <Zap className="h-3.5 w-3.5" />
      <span>{t("creditsExhaustedBanner")}</span>
      <button
        onClick={openPricingModal}
        className="underline underline-offset-2 hover:text-red-700 dark:hover:text-red-300"
      >
        {t("upgradeNow")}
      </button>
    </div>
  );
}
