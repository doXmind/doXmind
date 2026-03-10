"use client";

import { ExternalLink, Crown, Rocket, Zap, Loader2, Check } from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useBillingStore } from "@/stores/billing-store";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

const PLAN_FEATURES: Record<string, string[]> = {
  free: ["freeFeature1", "freeFeature2", "freeFeature3", "freeFeature4", "freeFeature5"],
  pro: ["proFeature1", "proFeature2", "proFeature3", "proFeature4", "proFeature5", "proFeature6"],
  max: ["maxFeature1", "maxFeature2", "maxFeature3", "maxFeature4", "maxFeature5"],
};

interface PlanSettingsProps {
  onOpenPricing?: () => void;
}

export function PlanSettings({ onOpenPricing }: PlanSettingsProps) {
  const t = useTranslations("billing");
  const { plan, status, periodEnd, credits, storage, openPricingModal, refresh } =
    useBillingStore();
  const [isLoadingPortal, setIsLoadingPortal] = useState(false);

  // Safety refresh: if plan is set (from localStorage) but credits/storage are null,
  // the initial fetch may have failed. Retry once.
  useEffect(() => {
    if (plan && (!credits || !storage)) {
      refresh();
    }
  }, [plan, credits, storage, refresh]);

  const creditsPercentage =
    credits && credits.limit > 0 ? (credits.remaining / credits.limit) * 100 : 0;
  const isLow = creditsPercentage < 20;
  const isMedium = creditsPercentage >= 20 && creditsPercentage < 50;

  const storagePercentage =
    storage && storage.limit_bytes > 0 ? (storage.used_bytes / storage.limit_bytes) * 100 : 0;

  const handleManageSubscription = async () => {
    setIsLoadingPortal(true);
    try {
      const { portal_url } = await api.createPortal(window.location.href);
      window.location.href = portal_url;
    } catch {
      toast.error(t("portalFailed"));
    } finally {
      setIsLoadingPortal(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Current Plan Card */}
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {plan === "max" ? (
              <Crown className="h-4 w-4 text-amber-500" />
            ) : plan === "pro" ? (
              <Rocket className="h-4 w-4 text-primary" />
            ) : (
              <Zap className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="text-sm font-semibold">{plan ? t(plan) : "—"}</span>
            {status && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  status === "active" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                  status === "past_due" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                  status === "canceled" && "bg-red-500/10 text-red-600 dark:text-red-400"
                )}
              >
                {status === "active"
                  ? t("active")
                  : status === "past_due"
                    ? t("pastDue")
                    : t("canceled")}
              </span>
            )}
          </div>
        </div>
        {periodEnd && plan !== "free" && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("renewsOn", { date: new Date(periodEnd).toLocaleDateString() })}
          </p>
        )}
      </div>

      {/* Credits */}
      {credits && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("credits")}</span>
            <span
              className={cn("font-medium", isLow && "text-red-500", isMedium && "text-amber-500")}
            >
              {Math.round(creditsPercentage)}% {t("remaining")}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-border">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                isLow && "bg-red-500",
                isMedium && "bg-amber-500",
                !isLow && !isMedium && "bg-emerald-500"
              )}
              style={{ width: `${Math.max(creditsPercentage, 1)}%` }}
            />
          </div>
          {credits.period_end && (
            <p className="text-xs text-muted-foreground">
              {t("creditsResetOn", { date: new Date(credits.period_end).toLocaleDateString() })}
            </p>
          )}
        </div>
      )}

      {/* Storage */}
      {storage && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("storage")}</span>
            <span className="font-medium">
              {Math.round(storagePercentage)}% {t("used")}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-border">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                storagePercentage > 90
                  ? "bg-red-500"
                  : storagePercentage > 70
                    ? "bg-amber-500"
                    : "bg-emerald-500"
              )}
              style={{ width: `${Math.max(storagePercentage, 1)}%` }}
            />
          </div>
        </div>
      )}

      {/* Plan Features */}
      {plan && PLAN_FEATURES[plan] && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{t("includedFeatures")}</p>
          <ul className="space-y-1.5">
            {PLAN_FEATURES[plan].map((key) => (
              <li key={key} className="flex items-center gap-2 text-sm">
                <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                {t(key)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <Button onClick={onOpenPricing ?? openPricingModal} className="w-full">
          {plan === "free" ? t("upgradePlan") : t("choosePlan")}
        </Button>
        {plan !== "free" && (
          <Button
            variant="outline"
            onClick={handleManageSubscription}
            disabled={isLoadingPortal}
            className="w-full"
          >
            {isLoadingPortal ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="mr-2 h-4 w-4" />
            )}
            {t("manageSub")}
          </Button>
        )}
      </div>
    </div>
  );
}
